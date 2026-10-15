"""Builds Bluebird's characters in Blender and exports them as glTF.

Run headless with Blender's Python module (pip install bpy) from the repo root:
    python tools/blender/characters.py

Writes src/assets/models/rider.glb (a rigged rider the game poses bone by bone) and
src/assets/models/villager.glb (posed villager bodies plus hair and hats, drawn instanced).

Everyone is grown from MakeHuman's CC0 base body (tools/blender/human.py, assets in
tools/blender/makehuman): real proportions and faces, MakeHuman's own skin weights folded onto the
game's bones. Clothes and gear are built from the body itself (shells offset from its skin, convex
hulls for hard gear), so they fit, then decimated to a triangle budget. The rider follows the
BMX Mountain reference for detail: a shell jacket with a darker yoke, ski trousers, boots, gloves,
a helmet with goggles and a neck gaiter.

Coordinates are Blender's: Z up, the character faces -Y, their left hand is at +X. The glTF
exporter turns that into three.js's Y up with the character facing +Z.
"""

import os
import sys

import bpy  # first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "src", "assets", "models")

# ---------------------------------------------------------------------------------------------
# Materials. Colours here are placeholders the game recolours (jacket, trousers, skin, hair);
# the names are what the game looks for.


def srgb(hexcolor):
    c = [((hexcolor >> s) & 255) / 255 for s in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(name, hexcolor):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*srgb(hexcolor), 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    return m


# ---------------------------------------------------------------------------------------------
# Small shapes for the bits a hull can't make: a bun, a pom-pom, a hat brim, a cap's peak.


def sphere(name, loc, radius, scale=(1, 1, 1), segments=20, rings=14, cut=None):
    """A smooth UV sphere; `cut` keeps only the part above that height (local, before scale)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    if cut is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut], context="VERTS")
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def cylinder(name, loc, radius, depth, segments=24, scale=(1, 1, 1), rot=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=rot)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def with_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
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


# ---------------------------------------------------------------------------------------------
# The rider: a rigged body dressed for the mountain.

def gear(name, hexcolor, rough=0.8, metal=0.0):
    """A Principled material with its own roughness (and metalness, for the goggle lens)."""
    m = material(name, hexcolor)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


# Triangle budget per piece of the rider, after decimation.
RIDER_TRIS = {"jacket": 9000, "pants": 5000, "skin": 2500, "helmet": 1600, "gaiter": 900, "goggleFrame": 600,
              "lens": 300, "strap": 400, "bootL": 1200, "bootR": 1200, "gloveL": 900, "gloveR": 900}


def build_rider():
    """A realistic rider from the CC0 MakeHuman body (see human.py): an athletic young man in a shell jacket
    with a darker yoke and side panels, ski trousers, boots, gloves, a helmet with goggles and a neck gaiter.
    Every garment is grown from the body, so it fits, and keeps the body's bone weights."""
    import human

    body, J = human.build_body("rider", {"caucasian-male-young": 1.0, "universal-male-young-maxmuscle-averageweight": 0.15})
    rig = human.build_rig(J)
    human.bind([body], rig)
    human.repose(rig, [body])
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    eyeZ, faceY = J["eyeL"].z, J["eyeL"].y
    hem = B["hips"][0].z - 0.1
    boot_top = 0.30
    neck = B["neck"][0].z
    M = {
        "jacket": gear("jacket", 0xE2725B, 0.75), "pants": gear("pants", 0x3B4352, 0.85), "gloves": gear("gloves", 0x2A2B31, 0.6),
        "boots": gear("boots", 0x3A3C42, 0.7), "helmet": gear("helmet", 0xD9D6CF, 0.35), "goggles": gear("goggles", 0x16171A, 0.5),
        "lens": gear("lens", 0xC8873A, 0.05, 0.6), "skin": gear("skin", 0xE0A889, 0.55), "gaiter": gear("gaiter", 0x3A3F4A, 0.9),
    }
    ARM = ("upperarm", "forearm")
    bones = human.dominant_bones(body)

    # The helmet's edge: a plane at the brow that drops steeply toward the back, over the ears.
    edge_at, edge_n = Vector((0, faceY + 0.05, eyeZ + 0.028)), Vector((0, 0.9, 1)).normalized()
    above_edge = lambda co: (co - edge_at).dot(edge_n)

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
        lambda i, co, b: (b.startswith(ARM) and wrist(co) > 0.02) or ((b in ("chest", "spine", "hips") or b.startswith("thigh")) and co.z > hem) or (b == "neck" and co.z < neck + 0.03),
        lambda co, b: 0.028 if b.startswith(ARM) else 0.04, M["jacket"], smooth=40, clear=0.6, relax=(armpit, 40),
        # Cloth stretched across the chest and back, hanging from the chest over the belly.
        drape=lambda bm: (level_hem(bm), human.drape_slices(hem - 0.05, neck - 0.02, skip=lambda i: bones[i].startswith(ARM))(bm),
                          human.drape_front(B["chest"][1].z - 0.02, hem - 0.05, slack=0.015)(bm)))
    pants = human.shell(
        body, "pants",
        lambda i, co, b: ((b == "hips" or b.startswith("thigh")) and co.z < hem + 0.03) or (b.startswith(("shin", "foot")) and co.z > boot_top - 0.12),
        lambda co, b: 0.026 + (0.02 if co.z < boot_top + 0.05 else 0.0), M["pants"], smooth=8)
    parts = [jacket, pants]
    for side in "LR":
        parts.append(human.hull_shell(body, f"boot{side}", lambda i, co, b, side=side: b == f"foot.{side}" or (b == f"shin.{side}" and co.z < boot_top),
                                      0.012, M["boots"], keep=lambda n, c: n.z > -0.7, rim=0.006))
        # Gloves with a gauntlet cuff that comes over the sleeve.
        parts.append(human.shell(body, f"glove{side}", lambda i, co, b, side=side: b == f"hand.{side}" or (b == f"forearm.{side}" and (co - B[f"hand.{side}"][0]).length < 0.09),
                                 lambda co, b: 0.012 if b.startswith("hand") else 0.04, M["gloves"], smooth=4, clear=0.0, iron=False))
    parts.append(human.hull_shell(body, "helmet", lambda i, co, b: b == "head" and above_edge(co) > -0.03, 0.02, M["helmet"], bone="head", rim=0.012,
                                  cuts=[(edge_at, edge_n)]))
    band = lambda i, co, b: b == "head" and abs(co.z - eyeZ) < 0.034 and co.y < faceY + 0.04
    gz = eyeZ + 0.01
    up, down = Vector((0, 0, 1)), Vector((0, 0, -1))
    parts.append(human.hull_shell(body, "goggleFrame", band, 0.02, M["goggles"], bone="head", rim=0.012,
                                  cuts=[(Vector((0, faceY + 0.035, 0)), Vector((0, -1, 0))), (Vector((0, 0, gz + 0.03)), down), (Vector((0, 0, gz - 0.03)), up)]))
    parts.append(human.hull_shell(body, "lens", band, 0.026, M["lens"], bone="head", rim=0.004, scale=(0.95, 1, 1),
                                  cuts=[(Vector((0, faceY + 0.005, 0)), Vector((0, -1, 0))), (Vector((0, 0, gz + 0.024)), down), (Vector((0, 0, gz - 0.024)), up)]))
    parts.append(human.hull_shell(body, "strap", lambda i, co, b: b == "head" and abs(co.z - gz) < 0.04, 0.024, M["goggles"], bone="head", rim=0.005,
                                  cuts=[(Vector((0, faceY + 0.03, 0)), Vector((0, 1, 0))), (Vector((0, 0, gz + 0.016)), down), (Vector((0, 0, gz - 0.016)), up)]))
    parts.append(human.hull_shell(body, "gaiter", lambda i, co, b: (b == "neck" and co.z > neck - 0.02) or (b == "head" and co.z < eyeZ - 0.02), 0.012, M["gaiter"], rim=0.008,
                                  cuts=[(Vector((0, 0, eyeZ - 0.03)), Vector((0, 0.3, -1)).normalized()), (Vector((0, 0, neck - 0.01)), up)]))

    # Two-tone jacket: a dark shoulder yoke, cuffs and hem band and a zip down the front, like a technical shell.
    def ss(a, b, x):
        t = max(0.0, min(1.0, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)

    chest_top, chest_base = B["chest"][1].z, B["chest"][0].z

    def shade(c):
        yoke = ss(chest_top - 0.09, chest_top - 0.05, c.z) * ss(0.05, 0.08, abs(c.x))
        cuff = 1 - ss(0.07, 0.085, min((c - B[f"hand.{s}"][0]).length for s in "LR"))
        band = (1 - ss(hem + 0.035, hem + 0.05, c.z)) * (1 - ss(0.19, 0.21, abs(c.x)))
        zip_ = (1 - ss(0.004, 0.008, abs(c.x))) * (1 if c.y < 0 else 0)
        return 1.0 - 0.94 * max(yoke, cuff, band, zip_)

    human.paint(jacket, shade)
    # Only the face shows: the rest of the body is under the clothes.
    human.trim_body(body, lambda i, co, b: b == "head" and not (above_edge(co) > -0.012))
    body.data.materials.clear()
    body.data.materials.append(M["skin"])
    body.name = body.data.name = "skin"
    parts.append(body)
    human.bind([p for p in parts if p is not body], rig)
    for o in parts:
        decimate(o, RIDER_TRIS.get(o.name))
    return rig, parts


def decimate(obj, tris):
    """Collapses `obj` down to about `tris` triangles (weights and vertex colours carry over)."""
    have = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if not tris or have <= tris:
        return
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    m = obj.modifiers.new("lod", "DECIMATE")
    m.ratio = tris / have
    bpy.ops.object.modifier_move_to_index(modifier="lod", index=0)
    bpy.ops.object.modifier_apply(modifier="lod")


# ---------------------------------------------------------------------------------------------
# Villagers: posed bodies (no rig; they only sway and hop), plus the hair and hat pieces.


VILLAGER_BUILDS = {
    # name: MakeHuman targets. Both are scaled to one height so the hair and hats fit either head.
    "m": {"caucasian-male-young": 0.6, "asian-male-young": 0.4, "universal-male-young-averagemuscle-maxweight": 0.25},
    "f": {"caucasian-female-young": 0.6, "african-female-young": 0.4, "universal-female-young-averagemuscle-maxweight": 0.15},
}
SIT_DROP = 0.45  # seated bodies sit this much lower (crowd.ts drops their hair and hats to match)
VILLAGER_TRIS = {"shirt": 1800, "forearm": 400, "pants": 1300, "shoes": 400, "skin": 1600, "eyes": 120}


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


def villager_body(build, pose, height):
    """One villager body in one pose, dressed: a jumper (its forearms their own piece, for short sleeves),
    trousers, shoes, and the skin that shows. Returns the parts, the joints and the eyes' height."""
    import human

    body, J = human.build_body(f"{build}_{pose}", VILLAGER_BUILDS[build])
    # One height for everyone, measured to the crown, so the tops fit.
    k = height / J["crown"].z
    for v in body.data.vertices:
        v.co *= k
    J = {n: c * k for n, c in J.items()}
    rig = human.build_rig(J)
    human.bind([body], rig)
    human.repose(rig, [body], poses=villager_aims(pose))
    B = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones}
    bones = human.dominant_bones(body)
    ARM = ("upperarm", "forearm")
    waist = B["hips"][0].z + 0.07  # the belt line, a little above the hip joints
    neck = B["neck"][0].z
    M = {n: bpy.data.materials.get(n) for n in ("shirt", "forearm", "pants", "skin", "shoes", "eyes")}

    def wrist(co):
        return min((co - B[f"hand.{s}"][0]).length for s in "LR")

    def elbow(co):
        return min((co - B[f"forearm.{s}"][0]).length for s in "LR")

    # The jumper reaches the top of the thighs all round, over the trousers' waist; sleeves to just past the elbow.
    upper = lambda b, co: b in ("chest", "spine") or (b == "hips" and co.z > waist - 0.06) or (b.startswith("thigh") and co.z > waist - 0.06 and not pose.startswith("sit")) or (b == "neck" and co.z < neck + 0.02) or b.startswith("upperarm") or (b.startswith("forearm") and elbow(co) < 0.06)
    shirt = human.shell(body, "shirt", lambda i, co, b: upper(b, co), lambda co, b: 0.016 + 0.012 * (1 - min(1, max(0, (co.z - waist) / 0.08))), M["shirt"], smooth=20, clear=0.6,
                        drape=human.drape_slices(waist - 0.1, neck - 0.03, skip=lambda i: bones[i].startswith(ARM)) if pose == "stand" or pose == "cheer" else None)
    forearm = human.shell(body, "forearm", lambda i, co, b: b.startswith("forearm") and wrist(co) > 0.015 and elbow(co) > 0.03, lambda co, b: 0.008, M["forearm"], smooth=6, clear=0.5)
    pants = human.shell(body, "pants", lambda i, co, b: (b in ("hips", "spine") or b.startswith("thigh")) and co.z < waist + 0.02 or b.startswith("shin"),
                        lambda co, b: 0.014, M["pants"], smooth=12, clear=0.6)
    shoes = [human.hull_shell(body, f"shoe{s}", lambda i, co, b, s=s: b == f"foot.{s}" or (b == f"shin.{s}" and co.z < B[f"foot.{s}"][0].z + 0.03), 0.01, M["shoes"],
                              keep=lambda n, c: n.z > -0.8, rim=0.005) for s in "LR"]
    shoe = join(shoes, "shoes")
    eye_dots = []
    for s in "LR":
        from mathutils.bvhtree import BVHTree

        tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
        c = J[f"eye{s}"]
        hit = tree.ray_cast(c + Vector((0, -0.2, 0)), Vector((0, 1, 0)))[0]  # the lid's surface in front of the eyeball
        if hit:
            eye_dots.append(with_material(sphere(f"eye{s}", hit + Vector((0, 0.001, 0)), 0.011, scale=(1.0, 0.35, 0.55), segments=10, rings=6), M["eyes"]))
    human.trim_body(body, lambda i, co, b: b in ("head", "neck") and not (b == "neck" and co.z < neck + 0.01) or b.startswith("hand"))
    body.data.materials.clear()
    body.data.materials.append(M["skin"])
    body.data.materials.append(M["eyes"])
    body.name = body.data.name = "skin"
    body = join([body, *eye_dots], "skin")
    parts = [shirt, forearm, pants, shoe, body]
    # Flatten onto the posed rest shape: no rig in the villager file, they only sway and hop.
    for o in parts:
        o.modifiers.clear()
        o.parent = None
        o.vertex_groups.clear()
        decimate(o, VILLAGER_TRIS.get(o.name) if o is not body else VILLAGER_TRIS["skin"] + VILLAGER_TRIS["eyes"])
        if pose.startswith("sit"):
            for v in o.data.vertices:
                v.co.z -= SIT_DROP
    bpy.data.objects.remove(rig)
    return parts, J


def villager_tops(J, faceY, mats):
    """Hair and hats, fitted round the standing villager head (`J` its joints): convex hulls of the scalp
    above a hairline, each one object of one material so the game can draw each style instanced."""
    import human

    eyeZ = J["eyeL"].z
    body, _ = human.build_body("tops_head", VILLAGER_BUILDS["m"])
    k = J["crown"].z / _["crown"].z
    for v in body.data.vertices:
        v.co *= k
    head = [v.co.copy() for v in body.data.vertices if v.co.z > J["necktop"].z - 0.02]
    bpy.data.objects.remove(body)
    hair, hat = mats["hair"], mats["hat"]

    def hull(name, pts, offset, mat, cuts, subdiv=2):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        for p in pts:
            bm.verts.new(p)
        res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
        loose = {g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)}
        bmesh.ops.delete(bm, geom=list(loose), context="VERTS")
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * offset
        for co, no in cuts:
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_inner=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.beautify_fill(bm, faces=bm.faces[:], edges=bm.edges[:])
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        with_material(o, mat)
        bpy.context.view_layer.objects.active = o
        for x in bpy.context.view_layer.objects:
            x.select_set(x == o)
        if subdiv:
            m = o.modifiers.new("round", "SUBSURF")
            m.levels = subdiv
            bpy.ops.object.modifier_apply(modifier="round")
        m = o.modifiers.new("rim", "SOLIDIFY")
        m.thickness = 0.008
        m.offset = -1
        bpy.ops.object.modifier_apply(modifier="rim")
        for p in o.data.polygons:
            p.use_smooth = True
        return o

    def line(front_z, slope):
        """A hairline or hat edge: at `front_z` over the brow, dropping by `slope` per metre toward the back."""
        return (Vector((0, faceY, front_z)), Vector((0, slope, 1)).normalized())

    def above(pts, cut):
        co, no = cut
        return [p for p in pts if (p - co).dot(no) > -0.03]

    crown = J["crown"]
    out = {}
    hairline = line(eyeZ + 0.06, 1.1)
    out["short"] = hull("short", above(head, hairline), 0.012, hair, [hairline])
    bun = hull("bun_hair", above(head, hairline), 0.01, hair, [hairline])
    knot = with_material(sphere("bun_knot", Vector((0, crown.y + 0.09, crown.z - 0.05)), 0.045), hair)
    out["bun"] = join([bun, knot], "bun")
    # Long hair: the scalp plus the back of the head carried down to the shoulders.
    falls = line(eyeZ + 0.06, 2.2)
    back = [p for p in head if p.y > faceY + 0.1]
    long_pts = above(head, falls) + [p + Vector((0, 0.015, -0.17)) for p in back if p.z > eyeZ - 0.03]
    out["long"] = hull("long", long_pts, 0.014, hair, [falls, (Vector((0, faceY + 0.07, eyeZ)), Vector((0, 1, 0.6)).normalized())])
    out["curly"] = hull("curly", above(head, line(eyeZ + 0.05, 1.3)), 0.035, hair, [line(eyeZ + 0.05, 1.3)])
    brow = line(eyeZ + 0.055, 0.45)
    beanie = hull("beanie_crown", above(head, brow), 0.02, hat, [brow])
    pom = with_material(sphere("beanie_pom", Vector((0, crown.y + 0.01, crown.z + 0.05)), 0.035), hat)
    out["beanie"] = join([beanie, pom], "beanie")
    band = line(eyeZ + 0.07, 0.25)
    crown_piece = hull("sunhat_crown", above(head, band), 0.016, hat, [band])
    brim = with_material(cylinder("sunhat_brim", Vector((0, crown.y + 0.01, eyeZ + 0.075)), 0.2, 0.01, segments=32), hat)
    out["sunhat"] = join([crown_piece, brim], "sunhat")
    capline = line(eyeZ + 0.06, 0.3)
    cap = hull("cap_crown", above(head, capline), 0.013, hat, [capline])
    peak = with_material(cylinder("cap_peak", Vector((0, faceY - 0.06, eyeZ + 0.065)), 0.08, 0.008, segments=20, scale=(1, 0.75, 1)), hat)
    out["cap"] = join([cap, peak], "cap")
    for o in out.values():
        decimate(o, 700)
    return list(out.values())


def build_villagers():
    for name, hexcolor in (("shirt", 0xE2725B), ("forearm", 0xE2725B), ("pants", 0x3E5C8A), ("skin", 0xC98E6A), ("shoes", 0x3B3350),
                           ("eyes", 0x2A2420), ("hair", 0x3A2A24), ("hat", 0xF4D6A0)):
        material(name, hexcolor)
    height = 1.74
    objs = []
    stand_joints = None
    for build in VILLAGER_BUILDS:
        for pose in ("stand", "sit", "cheer", "sitcheer"):
            parts, J = villager_body(build, pose, height)
            if build == "m" and pose == "stand":
                stand_joints = J
            objs.append(join(parts, f"body_{build}_{pose}"))
    mats = {n: bpy.data.materials[n] for n in ("hair", "hat")}
    objs += villager_tops(stand_joints, stand_joints["eyeL"].y, mats)
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
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    export(os.path.join(OUT, "villager.glb"), build_villagers())
    print("wrote", OUT)


if __name__ == "__main__":
    main()
