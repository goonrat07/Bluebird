"""Builds Bluebird's characters in Blender and exports them as glTF.

Run headless with Blender's Python module (pip install bpy) from the repo root:
    python tools/blender/characters.py

Writes src/assets/models/rider.glb (a rigged rider the game poses bone by bone) and
src/assets/models/villager.glb (posed villager bodies plus hair, hats, beards, glasses and bags, drawn instanced).

The look follows the Tiny Bookshop references in the project files: real proportions with simple, smooth
forms, and faces made of a few plain shapes. These are original characters in that style, not copies of
the game's own. Bodies come from MakeHuman's CC0 base mesh (tools/blender/human.py, assets in
tools/blender/makehuman) for their proportions, then melt into smooth volumes (human.simplify). Each head is
an egg, wider at the crown and tipped back a little, with an egg for a nose (painted a little redder), two
dark brows and sometimes a beard: no eyes, no mouth, no ears. Hands are mittens with a thumb. Clothes are
grown from the smoothed body, one flat colour each, and the game shades it all softly (painted() in
src/render/characterAssets.ts).

Coordinates are Blender's: Z up, the character faces -Y, their left hand is at +X. The glTF
exporter turns that into three.js's Y up with the character facing +Z.
"""

import math
import os
import sys

import bpy  # first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import human  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "src", "assets", "models")

# ---------------------------------------------------------------------------------------------
# Materials and small helpers. The colours are placeholders: the game recolours the jacket and every
# villager piece; the names are what it looks for.


def srgb(hexcolor):
    c = [((hexcolor >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(name, hexcolor, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb(hexcolor), 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def select(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)


def modify(obj, kind, **props):
    """Adds a modifier, sets `props` on it and applies it (ahead of the rig, when there is one)."""
    m = obj.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    select(obj)
    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    bpy.ops.object.modifier_apply(modifier=m.name)


def to_object(name, bm, mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return obj


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def plane(at, normal):
    """A cut: (point, normal). What lies behind the plane (against the normal) is cut away."""
    return Vector(at), Vector(normal).normalized()


def cut(bm, cuts):
    for co, no in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_inner=True)


def tint(obj, colour=(1.0, 1.0, 1.0)):
    """A per-vertex colour (the game multiplies it into the material's): white, or the nose's redder skin."""
    attr = obj.data.color_attributes.get("Col") or obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for v in obj.data.vertices:
        attr.data[v.index].color = (*colour, 1.0)
    return obj


def weight_to(obj, bone):
    """Weights the whole of `obj` to one bone."""
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


def decimate(obj, tris):
    """Collapses `obj` down to about `tris` triangles (weights and vertex colours carry over)."""
    have = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if not tris or have <= tris:
        return
    modify(obj, "DECIMATE", ratio=tris / have)


# ---------------------------------------------------------------------------------------------
# Plain shapes: eggs, tubes and rounded boxes. The faces, hands, hair and gear are all made of these.


class Egg:
    """An ellipsoid with radii `r` (x across, y front to back, z up) about `c`, wider toward its top by
    `taper`, turned by `rot` (a 3x3 matrix; or tipped back by `tilt` rad about x, top going back)."""

    def __init__(self, c, r, taper=0.0, tilt=0.0, rot=None):
        self.c, self.r, self.taper = Vector(c), Vector(r), taper
        self.rot = rot if rot is not None else Matrix.Rotation(-tilt, 3, "X")
        self._bvh = None

    def at(self, u):
        """The egg's point for a point `u` of the unit sphere."""
        s = 1 + self.taper * u.z
        return self.c + self.rot @ Vector((u.x * self.r.x * s, u.y * self.r.y * s, u.z * self.r.z))

    def bmesh(self, grow=0.0, segments=40, rings=24):
        """The surface, pushed out by `grow`: metres, or a function of the unit-sphere point."""
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
        units = [v.co.copy() for v in bm.verts]
        for v, u in zip(bm.verts, units):
            v.co = self.at(u)
        bm.normal_update()
        if grow:
            for v, u in zip(bm.verts, units):
                v.co += v.normal * (grow(u) if callable(grow) else grow)
            bm.normal_update()
        return bm

    def mesh(self, name, mat, grow=0.0, cuts=(), rim=0.0, segments=40, rings=24):
        bm = self.bmesh(grow, segments, rings)
        cut(bm, cuts)
        obj = to_object(name, bm, mat)
        if rim:
            modify(obj, "SOLIDIFY", thickness=rim, offset=-1)
        return obj

    def points(self, grow=0.0):
        bm = self.bmesh(grow, 72, 44)
        pts = [v.co.copy() for v in bm.verts]
        bm.free()
        return pts

    def cast(self, origin, direction, grow=0.0):
        """Where a ray meets the egg: the point (pushed out by `grow`) and the normal there."""
        if self._bvh is None:
            bm = self.bmesh(segments=72, rings=44)
            self._bvh = BVHTree.FromBMesh(bm)
            bm.free()
        loc, nrm, _, _ = self._bvh.ray_cast(Vector(origin), Vector(direction).normalized())
        return loc + nrm * grow, nrm

    def front(self, x, z, grow=0.0):
        return self.cast((x, self.c.y - 1.0, z), (0, 1, 0), grow)

    def inside(self, p, margin=0.0):
        q = self.rot.transposed() @ (Vector(p) - self.c)
        z = q.z / (self.r.z + margin)
        s = 1 + self.taper * max(-1.0, min(1.0, z))
        return (q.x / (self.r.x * s + margin)) ** 2 + (q.y / (self.r.y * s + margin)) ** 2 + z * z < 1


def frame(z, across=Vector((1, 0, 0))):
    """A right-handed rotation whose z axis is `z` and whose x axis lies along `across` as near as it can."""
    z = z.normalized()
    x = (across - z * across.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def tube(name, path, radius, mat, segments=10, closed=False):
    """A round tube through the points of `path`, with rounded ends; `radius` is one number or one per point."""
    n = len(path)
    radii = list(radius) if isinstance(radius, (list, tuple)) else [radius] * n
    bm = bmesh.new()
    rings = []
    ref = None
    for k, p in enumerate(path):
        if closed:
            d = path[(k + 1) % n] - path[(k - 1) % n]
        else:
            d = path[min(k + 1, n - 1)] - path[max(k - 1, 0)]
        d.normalize()
        if ref is None:
            ref = d.orthogonal()
        a = (ref - d * ref.dot(d)).normalized()  # carried along the path, so the tube doesn't twist
        ref = a
        b = d.cross(a)
        rings.append([bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * radii[k]) for t in (2 * math.pi * i / segments for i in range(segments))])
    for k in range(n if closed else n - 1):
        r0, r1 = rings[k], rings[(k + 1) % n]
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    if not closed:
        for k, other in ((0, 1), (n - 1, n - 2)):
            d = (path[k] - path[other]).normalized()
            tip = bm.verts.new(path[k] + d * radii[k] * 0.8)
            ring = rings[k]
            for i in range(segments):
                bm.faces.new((ring[i], ring[(i + 1) % segments], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return to_object(name, bm, mat)


def rounded_box(name, centre, size, mat, bevel=0.03, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if rot is not None:
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=rot)
    bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
    obj = to_object(name, bm, mat)
    modify(obj, "BEVEL", width=bevel, segments=4)
    return obj


def hull(name, pts, mat, cuts=(), subdiv=2, rim=0.0):
    """The convex hull of `pts`, cut by `cuts` and rounded off: hair that falls, goggles."""
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    loose = {g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(loose), context="VERTS")
    cut(bm, cuts)
    # The hull's long thin triangles would subdivide into ripples: even them out first.
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.beautify_fill(bm, faces=bm.faces[:], edges=bm.edges[:])
    obj = to_object(name, bm, mat)
    if subdiv:
        modify(obj, "SUBSURF", levels=subdiv)
    if rim:
        modify(obj, "SOLIDIFY", thickness=rim, offset=-1)
    return obj


# ---------------------------------------------------------------------------------------------
# Heads and hands, shared by the rider and the villagers.


def head_egg(J):
    """The head: an egg fitted to the body's skull (eyes halfway up it, the crown at its top)."""
    eye = J["eyeL"]
    rz = (J["crown"].z - eye.z) + 0.01
    ry = 0.097 * rz / 0.12
    return Egg((0, eye.y - 0.012 + ry, eye.z - 0.004), (0.071 * rz / 0.12, ry, rz), taper=0.1, tilt=0.12)


def face(head, J, skin, brows, neck_r=0.054):
    """Egg head, egg nose, two brows and a plain round neck. Returns (skin pieces, brows), weighted to the
    head bone (the neck to the neck bone)."""
    cz = head.c.z
    p, n = head.front(0, cz - 0.014)
    nose = Egg(p, (0.0155, 0.0155, 0.033), taper=-0.38, tilt=0.16).mesh("nose", skin, segments=20, rings=12)
    egg = head.mesh("head", skin, segments=36, rings=22)
    # The neck: a plain tube from inside the collar up into the head.
    base, top = J["neckbase"], J["necktop"]
    neck = tube("neck", [base + Vector((0, 0.01, -0.07)), base.lerp(top, 0.5), top + Vector((0, 0.005, 0.03))], neck_r, skin, segments=16)
    tint(egg)
    tint(neck)
    tint(nose, (1.0, 0.8, 0.72))
    pieces = []
    for sx in (1, -1):
        # A short thick bar right under the hairline, level, its outer end dipping a touch (a calm, kind look).
        ends = [head.front(sx * x, cz + 0.041 + dz) for x, dz in ((0.015, 0.0015), (0.03, 0.001), (0.044, -0.001))]
        pieces.append(tube("brow", [p + n * 0.003 for p, n in ends], 0.0078, brows, segments=10))
    brow = join(pieces, "brows")
    return [weight_to(egg, "head"), weight_to(nose, "head"), weight_to(neck, "neck")], weight_to(brow, "head")


def mittens(B, mat):
    """A mitten on each hand: an egg along the hand bone with an egg thumb at the front, weighted to the hand."""
    out = []
    for s in "LR":
        w, tip = B[f"hand.{s}"]
        d = (tip - w).normalized()
        length = (tip - w).length + 0.03
        across = (Vector((1, 0, 0)) - d * d.x).normalized()  # palm faces the thigh: thickness runs across
        fwd = d.cross(across)
        if fwd.y > 0:
            fwd = -fwd
        if across.cross(fwd).dot(d) < 0:
            across = -across
        rot = Matrix((across, fwd, d)).transposed()
        hand = Egg(w + d * (length / 2 - 0.035), (0.027, 0.04, length / 2), taper=0.14, rot=rot).mesh(f"mitten{s}", mat, segments=20, rings=14)
        t = (d * 0.7 + fwd * 0.7).normalized()
        thumb = Egg(w + d * 0.045 + fwd * 0.03 + t * 0.016, (0.0135, 0.0135, 0.03), rot=frame(t, across)).mesh(f"thumb{s}", mat, segments=14, rings=10)
        out.append(weight_to(join([hand, thumb], f"mitten{s}"), f"hand.{s}"))
    return out


# ---------------------------------------------------------------------------------------------
# The rider: a rigged body dressed for the mountain.

# Triangle budget per piece of the rider, after decimation.
RIDER_TRIS = {"jacket": 6000, "pants": 3500, "skin": 1600, "hair": 900, "helmet": 1400, "strap": 400, "goggleFrame": 500,
              "lens": 300, "bootL": 900, "bootR": 900, "mittenL": 500, "mittenR": 500}


def build_rider():
    """A young man in a puffy jacket, ski trousers, boots, mittens and a rounded helmet with his goggles
    pushed up onto it. Clothes are grown from the smoothed body, so they fit it and keep its bone weights."""
    body, J = human.build_body("rider", {"caucasian-male-young": 1.0, "universal-male-young-maxmuscle-averageweight": 0.1})
    rig = human.build_rig(J)
    human.bind([body], rig)
    human.simplify(body)  # in MakeHuman's A pose, before the arms come down: hands melted onto the hips would tear
    human.repose(rig, [body])
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    head = head_egg(J)
    hem = B["hips"][0].z - 0.06
    boot_top = 0.29
    neck = B["neck"][0].z
    M = {
        "jacket": material("jacket", 0xE2725B), "pants": material("pants", 0x46506A), "mittens": material("mittens", 0x4A4F5C),
        "boots": material("boots", 0x5A5560), "helmet": material("helmet", 0xEDE6D8, 0.5), "goggles": material("goggles", 0x3E4658),
        "lens": material("lens", 0xE39A45, 0.2), "skin": material("skin", 0xE0A889), "brows": material("brows", 0x4A3428),
        "hair": material("hair", 0x4A3428),
    }
    ARM = ("upperarm", "forearm")
    bones = human.dominant_bones(body)

    def wrist(co):
        return (co - B[f"hand.{'L' if co.x > 0 else 'R'}"][0]).length

    def level_hem(bm):
        # A straight hem round the hips, not one that follows the legs down between them.
        for v in bm.verts:
            if abs(v.co.x) < 0.2:
                v.co.z = max(v.co.z, hem - 0.02)

    armpit = lambda c: min((c - (B[f"upperarm.{s}"][0] + Vector((0, 0, -0.12)))).length for s in "LR") < 0.16
    jacket = human.shell(
        body, "jacket",
        lambda i, co, b: b.startswith(ARM) or ((b in ("chest", "spine", "hips") or b.startswith("thigh")) and co.z > hem) or (b == "neck" and co.z < neck + 0.045),
        lambda co, b: 0.028 if b.startswith(ARM) else 0.01 if co.z > neck else 0.034, M["jacket"], smooth=40, clear=0.6, relax=(armpit, 40), hem=(hem + 0.1, hem - 0.01),
        # Cloth stretched across the chest and back.
        drape=lambda bm: (level_hem(bm), human.drape_slices(hem - 0.05, neck - 0.02, skip=lambda i: bones[i].startswith(ARM))(bm)))
    pants = human.shell(
        body, "pants",
        lambda i, co, b: ((b == "hips" or b.startswith("thigh")) and co.z < hem + 0.04) or (b.startswith(("shin", "foot")) and co.z > boot_top - 0.1),
        lambda co, b: 0.03 + (0.012 if co.z < boot_top + 0.05 else 0.0), M["pants"], smooth=14, hem=(boot_top, boot_top - 0.085))
    # The jacket hangs from the pelvis: what the thighs held goes to the hips, so a crouch doesn't pull its hem
    # down between the legs.
    hips = jacket.vertex_groups["hips"]
    for s in "LR":
        g = jacket.vertex_groups[f"thigh.{s}"]
        for v in jacket.data.vertices:
            w = next((e.weight for e in v.groups if e.group == g.index), 0.0)
            if w:
                hips.add([v.index], w, "ADD")
                g.remove([v.index])
    parts = [jacket, pants]
    for side in "LR":
        parts.append(human.hull_shell(body, f"boot{side}", lambda i, co, b, side=side: b == f"foot.{side}" or (b == f"shin.{side}" and co.z < boot_top),
                                      0.014, M["boots"], keep=lambda n, c: n.z > -0.7, rim=0.006))
    human.bind(parts, rig)
    skin, brows = face(head, J, M["skin"], M["brows"])
    hair = weight_to(head.mesh("hair", M["hair"], grow=0.01, cuts=[hairline(head)], rim=0.006), "head")
    gear = [*mittens(B, M["mittens"]), *helmet(head, M), hair]
    bpy.data.objects.remove(body)  # dressed, none of it shows
    skin = join(skin, "skin")
    human.bind([skin, brows, *gear], rig)
    parts += [skin, brows, *gear]
    for o in parts:
        decimate(o, RIDER_TRIS.get(o.name))
    return rig, parts


def helmet(head, M):
    """A rounded shell over the head egg down to a line that drops toward the back, with the goggles pushed
    up onto its front: a strap round it, a frame and a lens."""
    g = 0.024
    cz, front = head.c.z, head.c.y - head.r.y
    shell = weight_to(head.mesh("helmet", M["helmet"], grow=g, cuts=[plane((0, front, cz + 0.066), (0, 0.42, 1))], rim=0.014), "head")
    low, high = cz + 0.086, cz + 0.11  # the strap's edges over the brow; it drops a little toward the back
    band = lambda p, lo, hi: lo - 0.25 * (p.y - front) < p.z < hi - 0.25 * (p.y - front)
    strap = head.mesh("strap", M["goggles"], grow=g + 0.005, rim=0.005,
                      cuts=[plane((0, front, low), (0, 0.25, 1)), plane((0, front, high), (0, -0.25, -1))])
    window = lambda p, w, lo, hi: abs(p.x) < w and p.y < head.c.y - 0.035 and band(p, lo, hi)
    outer, inner = head.points(g + 0.016), head.points(g)
    frame_ = hull("goggleFrame", [p for p in outer + inner if window(p, 0.074, low - 0.016, high + 0.014)], M["goggles"])
    lens = hull("lens", [p for p in head.points(g + 0.021) + head.points(g + 0.01) if window(p, 0.064, low - 0.01, high + 0.008)], M["lens"])
    return [shell, weight_to(strap, "head"), weight_to(frame_, "head"), weight_to(lens, "head")]


# ---------------------------------------------------------------------------------------------
# Villagers: posed bodies (no rig; they only sway and hop), plus the hair, hats and extras.


VILLAGER_BUILDS = {
    # name: MakeHuman targets. Both are scaled to one height so the hair and hats fit either head.
    "m": {"caucasian-male-young": 0.6, "asian-male-young": 0.4, "universal-male-young-averagemuscle-maxweight": 0.1},
    "f": {"caucasian-female-young": 0.6, "african-female-young": 0.4, "universal-female-young-averagemuscle-maxweight": 0.05},
}
POSES = ("stand", "sit", "cheer", "sitcheer")
HEIGHT = 1.74
SIT_DROP = 0.45  # seated bodies sit this much lower (crowd.ts drops their hair, hats and extras to match)
VILLAGER_TRIS = {"shirt": 1500, "pants": 1000, "shoes": 360, "skin": 900, "brows": 60, "hands": 320}


def villager_aims(pose):
    """Extra bone aims (armature space: z up, facing -y) for a pose, on top of standing with arms down."""
    aims = {}
    for s, sign in (("L", 1), ("R", -1)):
        if pose.startswith("sit"):
            aims[f"thigh.{s}"] = Vector((sign * 0.08, -1, -0.04))
            aims[f"shin.{s}"] = Vector((sign * 0.03, -0.12, -1))
            # Hands resting on the lap.
            aims[f"upperarm.{s}"] = Vector((sign * 0.12, -0.4, -1))
            aims[f"forearm.{s}"] = Vector((-sign * 0.15, -1, -0.3))
            aims[f"hand.{s}"] = Vector((-sign * 0.2, -1, -0.4))
        if pose.endswith("cheer"):
            aims[f"upperarm.{s}"] = Vector((sign * 0.6, -0.1, 1))
            aims[f"forearm.{s}"] = Vector((sign * 0.25, -0.15, 1))
            aims[f"hand.{s}"] = Vector((sign * 0.15, -0.1, 1))
    return aims


def villager_joints(build):
    """A build's joints at the shared height (measured to the crown)."""
    body, J = human.build_body(f"{build}_joints", VILLAGER_BUILDS[build])
    bpy.data.objects.remove(body)
    k = HEIGHT / J["crown"].z
    return {n: c * k for n, c in J.items()}


def villager_body(build, pose, head):
    """One villager body in one pose, dressed for winter: a jumper or jacket, trousers, boots, mittens, the
    egg head (`head`, shared by every body so the hair and hats fit) and the neck. Returns the parts and the
    bones' rest positions."""
    body, J = human.build_body(f"{build}_{pose}", VILLAGER_BUILDS[build])
    k = HEIGHT / J["crown"].z
    for v in body.data.vertices:
        v.co *= k
    J = {n: c * k for n, c in J.items()}
    rig = human.build_rig(J)
    human.bind([body], rig)
    human.simplify(body)  # in MakeHuman's A pose, before the arms come down: hands melted onto the hips would tear
    human.repose(rig, [body])
    M = {n: bpy.data.materials.get(n) for n in ("shirt", "pants", "skin", "shoes", "brows", "hands")}
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    # The hands and head are built standing, then posed with the body.
    skin, brows = face(head, J, M["skin"], M["brows"], 0.054 if build == "m" else 0.047)
    hands = mittens(B, M["hands"])
    human.bind([*skin, brows, *hands], rig)
    human.repose(rig, [body, *skin, brows, *hands], poses=villager_aims(pose))
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    bones = human.dominant_bones(body)
    ARM = ("upperarm", "forearm")
    waist = B["hips"][0].z + 0.07  # the belt line, a little above the hip joints
    neck = B["neck"][0].z
    sitting = pose.startswith("sit")

    def wrist(co):
        return min((co - B[f"hand.{s}"][0]).length for s in "LR")

    def level_hem(bm):
        if sitting:
            return
        for v in bm.verts:
            if abs(v.co.x) < 0.2:
                v.co.z = max(v.co.z, waist - 0.14)

    # The jumper reaches the top of the thighs all round, over the trousers' waist, with sleeves to the wrist.
    upper = lambda b, co: b in ("chest", "spine") or (b == "hips" and co.z > waist - 0.12) or (b.startswith("thigh") and co.z > waist - 0.12 and not sitting) or (b == "neck" and co.z < neck + 0.03) or b.startswith(ARM)
    shirt = human.shell(body, "shirt", lambda i, co, b: upper(b, co), lambda co, b: 0.022 if b.startswith(ARM) else 0.01 if co.z > neck else 0.028, M["shirt"], smooth=45, clear=0.6, hem=None if sitting else (waist - 0.02, waist - 0.135),
                        drape=None if pose != "stand" else (lambda bm: (level_hem(bm), human.drape_slices(waist - 0.12, neck - 0.03, skip=lambda i: bones[i].startswith(ARM))(bm))))
    # Trousers tucked into the boots: they stop inside the boot, whose top closes over them.
    boot_top = lambda s: B[f"foot.{s}"][0].z + 0.07
    pants = human.shell(body, "pants", lambda i, co, b: (b in ("hips", "spine") or b.startswith("thigh")) and co.z < waist + 0.02 or (b.startswith("shin") and co.z > boot_top(b[-1]) - 0.035),
                        lambda co, b: 0.016, M["pants"], smooth=14, clear=0.6)
    # Open at the top along a level rim, wider than the trousers going into them.
    shoes = [human.hull_shell(body, f"shoe{s}", lambda i, co, b, s=s: b == f"foot.{s}" or (b == f"shin.{s}" and co.z < boot_top(s) + 0.03), 0.024, M["shoes"],
                              keep=lambda n, c: n.z > -0.8, rim=0.005, cuts=[(Vector((0, 0, boot_top(s))), Vector((0, 0, -1)))]) for s in "LR"]
    shoe = join(shoes, "shoes")
    bpy.data.objects.remove(body)  # dressed, none of it shows
    skin = join(skin, "skin")
    hand = join(hands, "hands")
    parts = [shirt, pants, shoe, skin, brows, hand]
    for o in parts:
        if o is not skin:
            tint(o)  # one colour attribute on every piece, or joining fills the others' with black
    # Flatten onto the posed rest shape: no rig in the villager file, they only sway and hop.
    for o in parts:
        o.modifiers.clear()
        o.parent = None
        o.vertex_groups.clear()
        decimate(o, VILLAGER_TRIS.get(o.name))
        if sitting:
            for v in o.data.vertices:
                v.co.z -= SIT_DROP
    bpy.data.objects.remove(rig)
    return parts, B


def hairline(head):
    """Where hair starts: over the brow, dropping toward the back past where the ears would be to the nape."""
    return plane((0, head.c.y - head.r.y, head.c.z + 0.058), (0, 0.8, 1))


def villager_tops(head, mats):
    """Hair and hats round the shared head egg, each one object of one material so the game can draw each
    style instanced."""
    hair, hat = mats["hair"], mats["hat"]
    cz, cy, front = head.c.z, head.c.y, head.c.y - head.r.y
    top = head.at(Vector((0, 0, 1)))

    def line(front_z, slope):
        """A hairline or hat edge: at `front_z` over the brow, dropping by `slope` per metre toward the back."""
        return plane((0, front, front_z), (0, slope, 1))

    def cap(name, mat, grow, edge, rim=0.008):
        return head.mesh(name, mat, grow=grow, cuts=[edge], rim=rim)

    out = {}
    edge = hairline(head)
    out["short"] = cap("short", hair, 0.012, edge)
    knot = Egg(top + Vector((0, 0.07, -0.035)), (0.042, 0.04, 0.038)).mesh("bun_knot", hair, segments=20, rings=12)
    out["bun"] = join([cap("bun", hair, 0.01, edge), knot], "bun")
    # Long hair: the scalp, and the back of it carried down to the shoulders.
    back = [p for p in head.points(0.014) if p.y > cy - 0.02 and p.z < cz + 0.09 and (p - edge[0]).dot(edge[1]) > 0]
    fall = hull("fall", back + [p + Vector((0, 0.01, -0.17)) for p in back], hair, cuts=[plane((0, cy - 0.02, 0), (0, 1, 0))])
    out["long"] = join([cap("long", hair, 0.014, edge), fall], "long")
    # Curly: a big soft mass, fuller on top.
    out["curly"] = cap("curly", hair, lambda u: 0.026 + 0.014 * max(0.0, u.z), line(cz + 0.058, 1.25))
    # Ponytail: hair drawn back, tied high at the back of the crown, falling to the shoulders.
    tie = head.cast(head.c + Vector((0, 1, 0.55)) * 0.3, -Vector((0, 1, 0.55)), 0.01)[0]
    path = [tie + Vector(o) for o in ((0, -0.01, 0.0), (0, 0.035, 0.012), (0, 0.07, -0.02), (0, 0.085, -0.08), (0, 0.08, -0.15), (0, 0.065, -0.21))]
    tail = tube("tail", path, [0.02, 0.026, 0.03, 0.028, 0.022, 0.012], hair, segments=12)
    modify(tail, "SUBSURF", levels=1)
    band = tube("tie", [tie + Vector((0, 0.008, 0.004)), tie + Vector((0, 0.022, 0.009))], 0.022, hair, segments=12)
    out["ponytail"] = join([cap("ponytail", hair, 0.009, line(cz + 0.064, 1.0)), tail, band], "ponytail")
    # Beanie: knitted crown, a turned-up cuff and a pom-pom.
    brim = line(cz + 0.046, 0.45)
    crown = cap("beanie", hat, lambda u: 0.02 + 0.012 * max(0.0, u.z), brim)
    cuff = head.mesh("beanie_cuff", hat, grow=0.03, rim=0.012, cuts=[brim, plane((0, front, cz + 0.085), (0, -0.45, -1))])
    pom = Egg(top + Vector((0, 0.006, 0.05)), (0.034, 0.034, 0.032)).mesh("pom", hat, segments=16, rings=10)
    out["beanie"] = join([crown, cuff, pom], "beanie")
    # Cap: a snug crown and a peak.
    capline = line(cz + 0.055, 0.3)
    p, _ = head.front(0, cz + 0.06, 0.012)
    peak = Egg(p + Vector((0, -0.045, -0.004)), (0.075, 0.06, 0.006), tilt=-0.18).mesh("peak", hat, segments=24, rings=8)
    out["cap"] = join([cap("cap", hat, 0.013, capline), peak], "cap")
    for o in out.values():
        decimate(o, 900)
    return list(out.values())


def villager_extras(head, fits, mats):
    """Beards, glasses and things carried (a backpack, a shoulder bag), each its own instanced piece. The bags
    are fitted to each build's standing jumper (`fits`: build -> (jumper mesh, bones))."""
    cz, cy, front = head.c.z, head.c.y, head.c.y - head.r.y
    out = []
    # Beard: over the jaw and chin, up the cheeks to the sideburns and under the nose; fuller at the chin.
    full = lambda u: 0.01 + 0.014 * max(0.0, -u.z - 0.3) * max(0.0, -u.y)
    out.append(head.mesh("beard", mats["hair"], grow=full, rim=0.006,
                         cuts=[plane((0, front, cz - 0.052), (0, 0.55, -1)), plane((0, cy + 0.012, 0), (0, -1, 0))]))
    # Glasses: round rims in front of where the eyes would be, a bridge, and arms back into the hair.
    z = cz - 0.002
    rims, pieces = {}, []
    for sx in (1, -1):
        p, n = head.front(sx * 0.031, z)
        facing = (n + Vector((0, -1.5, 0))).normalized()
        c = p + facing * 0.012
        rot = frame(facing, Vector((1, 0, 0)))
        ring = [c + rot @ Vector((math.cos(t) * 0.018, math.sin(t) * 0.016, 0)) for t in (2 * math.pi * i / 20 for i in range(20))]
        pieces.append(tube("rim", ring, 0.0024, mats["glasses"], segments=6, closed=True))
        rims[sx] = (c, rot)
        outer = c + rot @ Vector((sx * 0.018, 0, 0))
        side, _ = head.cast((sx * 0.5, cy - 0.01, z + 0.006), (-sx, 0, 0), 0.004)
        pieces.append(tube("arm", [outer, outer.lerp(side, 0.5) + Vector((sx * 0.004, 0, 0)), side], 0.002, mats["glasses"], segments=6))
    a = rims[1][0] + rims[1][1] @ Vector((-0.018, 0, 0))
    b = rims[-1][0] + rims[-1][1] @ Vector((0.018, 0, 0))
    pieces.append(tube("bridge", [a, (a + b) / 2 + Vector((0, -0.003, 0.005)), b], 0.0022, mats["glasses"], segments=6))
    out.append(join(pieces, "glasses"))
    for build, (jumper, B) in fits.items():
        out += carried(build, jumper, B, mats)
    for o in out:
        decimate(o, 1200)
    return out


def carried(build, jumper, B, mats):
    """A backpack and a shoulder bag fitted to one build's standing jumper (a mesh)."""
    bm = bmesh.new()
    bm.from_mesh(jumper)
    tree = BVHTree.FromBMesh(bm)
    bm.free()

    def on(origin, direction, off=0.008):
        loc, nrm, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized())
        return loc + nrm * off if loc else None

    chest_top = B["chest"][1].z
    chest = B["chest"][0].z
    hips = B["hips"][0].z
    out = []

    # Backpack: a rounded pack on the upper back with a pocket, and two straps over the shoulders.
    back = on((0, 1, chest + 0.02), (0, -1, 0), 0)
    size = Vector((0.27, 0.13, 0.36))
    centre = Vector((0, back.y + size.y / 2 + 0.005, chest_top - 0.07 - size.z / 2))
    tip = Matrix.Rotation(-0.08, 3, "X")  # leans back a little at the top
    pack = rounded_box("pack", centre, size, mats["bag"], 0.045, tip)
    pocket = rounded_box("pocket", centre + tip @ Vector((0, size.y / 2 + 0.012, -0.08)), Vector((0.2, 0.05, 0.15)), mats["strap"], 0.02, tip)
    straps = []
    for sx in (1, -1):
        x = sx * 0.085
        top = on((x, B["chest"][1].y + 0.02, chest_top + 0.4), (0, 0, -1))
        path = [Vector((x, back.y + 0.012, centre.z + size.z / 2 - 0.04)),
                on((x, 1, chest_top - 0.03), (0, -1, 0)), top,
                on((x * 1.15, -1, chest_top - 0.06), (0, 1, 0)), on((x * 1.35, -1, chest - 0.02), (0, 1, 0)),
                on((x * 1.6, -1, chest - 0.1), (0, 1, 0)), on((x * 1.85, -1, chest - 0.16), (0, 1, 0)), Vector((sx * 0.14, back.y - 0.02, chest - 0.18)),
                Vector((sx * 0.1, back.y + 0.015, centre.z - size.z / 2 + 0.05))]
        straps.append(tube("strap", [p for p in path if p], 0.011, mats["strap"], segments=8))
    out.append(join([pack, pocket, *straps], f"backpack_{build}"))

    # Shoulder bag: a soft flat bag at the right hip on a strap from the left shoulder, across the chest and back.
    bag_c = on((-0.12, -1, hips + 0.02), (0, 1, 0), 0.04)
    bag_rot = Matrix.Rotation(-0.25, 3, "Z")
    bag = rounded_box("bag", bag_c, Vector((0.22, 0.06, 0.2)), mats["bag"], 0.03, bag_rot)
    flap = rounded_box("flap", bag_c + bag_rot @ Vector((0, -0.03, 0.04)), Vector((0.22, 0.012, 0.12)), mats["bag"], 0.006, bag_rot)
    shoulder = on((0.1, B["chest"][1].y + 0.01, chest_top + 0.4), (0, 0, -1))
    ends = [bag_c + bag_rot @ Vector((0.1, 0, 0.09)), bag_c + bag_rot @ Vector((0.1, 0.03, 0.09))]
    strap = []
    for sign, end in ((-1, ends[0]), (1, ends[1])):
        pts = [shoulder]
        for t in (0.15, 0.3, 0.45, 0.6, 0.75, 0.88):
            x = 0.1 + (end.x - 0.1) * t
            zz = chest_top - 0.02 + (end.z + 0.03 - chest_top) * t
            p = on((x, sign * 1.0, zz), (0, -sign, 0))
            if p:
                pts.append(p)
        pts.append(end)
        strap.append(tube("bag_strap", pts, 0.009, mats["strap"], segments=8))
    out.append(join([bag, flap, *strap], f"bag_{build}"))
    return out


def build_villagers():
    for name, hexcolor in (("shirt", 0xE2725B), ("pants", 0x3E5C8A), ("skin", 0xC98E6A), ("shoes", 0x3B3350), ("brows", 0x3A2A24),
                           ("hands", 0xC98E6A), ("hair", 0x3A2A24), ("hat", 0xF4D6A0), ("glasses", 0x2E2A2C), ("bag", 0x6E8B5A), ("strap", 0x5A3E2E)):
        material(name, hexcolor)
    head = head_egg(villager_joints("m"))
    objs, fits = [], {}
    for build in VILLAGER_BUILDS:
        for pose in POSES:
            parts, B = villager_body(build, pose, head)
            if pose == "stand":
                fits[build] = (parts[0].data.copy(), B)  # the jumper, for fitting bags to
            objs.append(join(parts, f"body_{build}_{pose}"))
    mats = {n: bpy.data.materials[n] for n in ("hair", "hat", "glasses", "bag", "strap")}
    objs += villager_tops(head, mats)
    objs += villager_extras(head, fits, mats)
    return objs


def export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
        export_texcoords=False,
        export_vertex_color="NAME",
        export_vertex_color_name="Col",
        export_yup=True,
    )


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    rig, parts = build_rider()
    export(os.path.join(OUT, "rider.glb"), [rig, *parts])
    if os.environ.get("SAVE_BLEND"):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ["SAVE_BLEND"], "rider.blend"))
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    villagers = build_villagers()
    export(os.path.join(OUT, "villager.glb"), villagers)
    if os.environ.get("SAVE_BLEND"):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ["SAVE_BLEND"], "villager.blend"))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
