"""A realistic human body for the rider and villagers, from the MakeHuman base mesh (CC0).

The base mesh, its macro targets and its skin weights live in tools/blender/makehuman
(see CREDITS.md there). This module reads them without MakeHuman itself: it applies the targets as vertex
offsets, keeps the body, turns it into Blender's axes and metres, fits the game's simple skeleton to the
mesh's own joint markers, and folds MakeHuman's detailed weights onto that skeleton's bones.
"""
import json
import math
import os
from collections import defaultdict

import bpy
from mathutils import Matrix, Vector

MH = os.environ.get("MAKEHUMAN_ASSETS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "makehuman"))

# The game's skeleton: name, head joint, tail joint, parent. Joints are named below from the base mesh's markers.
BONES = [
    ("hips", "pelvis", "waist", None),
    ("spine", "waist", "chest", "hips"),
    ("chest", "chest", "neckbase", "spine"),
    ("neck", "neckbase", "necktop", "chest"),
    ("head", "necktop", "crown", "neck"),
]
for _s in "LR":
    BONES += [
        (f"thigh.{_s}", f"hip{_s}", f"knee{_s}", "hips"),
        (f"shin.{_s}", f"knee{_s}", f"ankle{_s}", f"thigh.{_s}"),
        (f"foot.{_s}", f"ankle{_s}", f"toe{_s}", f"shin.{_s}"),
        (f"upperarm.{_s}", f"shoulder{_s}", f"elbow{_s}", "chest"),
        (f"forearm.{_s}", f"elbow{_s}", f"wrist{_s}", f"upperarm.{_s}"),
        (f"hand.{_s}", f"wrist{_s}", f"hand{_s}", f"forearm.{_s}"),
    ]

# Our joints from the base mesh's joint marker groups (centroids).
JOINTS = {
    "pelvis": "joint-pelvis",
    "waist": "joint-spine-2",
    "chest": "joint-spine-1",
    "neckbase": "joint-neck",
    "necktop": "joint-head",
    "crown": "joint-head-2",
    "eyeL": "joint-l-eye",  # not bones: landmarks for fitting gear
    "eyeR": "joint-r-eye",
    "mouth": "joint-mouth",
}
for _s, _m in (("L", "l"), ("R", "r")):
    JOINTS.update({
        f"hip{_s}": f"joint-{_m}-upper-leg",
        f"knee{_s}": f"joint-{_m}-knee",
        f"ankle{_s}": f"joint-{_m}-ankle",
        f"toe{_s}": f"joint-{_m}-foot-2",
        f"shoulder{_s}": f"joint-{_m}-shoulder",
        f"elbow{_s}": f"joint-{_m}-elbow",
        f"wrist{_s}": f"joint-{_m}-hand",
        f"hand{_s}": f"joint-{_m}-finger-3-3",
    })


def _our_bone(mh):
    """Which of our bones a MakeHuman weight group belongs to."""
    side = mh[-1] if mh.endswith((".L", ".R")) else None
    base = mh[:-2] if side else mh
    if base in ("root", "pelvis", "spine05"):
        return "hips"
    if base in ("spine04", "spine03"):
        return "spine"
    if base in ("spine02", "spine01", "clavicle", "breast"):
        return "chest"
    if base.startswith("neck"):
        return "neck"
    if base.startswith("upperleg"):
        return f"thigh.{side}"
    if base.startswith("lowerleg"):
        return f"shin.{side}"
    if base == "foot" or base.startswith("toe"):
        return f"foot.{side}"
    if base.startswith(("shoulder", "upperarm")):
        return f"upperarm.{side}"
    if base.startswith("lowerarm"):
        return f"forearm.{side}"
    if base in ("wrist",) or base.startswith(("metacarpal", "finger")):
        return f"hand.{side}"
    return "head"  # head, jaw, eyes, the face's small muscles, tongue


def read_base():
    """Vertices, UVs and the body's faces (vertex and UV indices) plus each group's vertex set."""
    verts, uvs, groups = [], [], defaultdict(set)
    faces = defaultdict(list)
    cur = None
    with open(os.path.join(MH, "base.obj")) as f:
        for line in f:
            if line.startswith("v "):
                verts.append([float(t) for t in line.split()[1:4]])
            elif line.startswith("vt "):
                uvs.append([float(t) for t in line.split()[1:3]])
            elif line.startswith("g "):
                cur = line.split()[1]
            elif line.startswith("f "):
                vs, ts = [], []
                for tok in line.split()[1:]:
                    parts = tok.split("/")
                    vs.append(int(parts[0]) - 1)
                    ts.append(int(parts[1]) - 1 if len(parts) > 1 and parts[1] else 0)
                groups[cur].update(vs)
                faces[cur].append((vs, ts))
    return verts, uvs, faces, groups


def apply_targets(verts, targets):
    """targets: {name: weight}; each is a file of 'index dx dy dz' lines in assets-cc0/makehuman/targets."""
    for name, w in targets.items():
        if not w:
            continue
        with open(os.path.join(MH, "targets", f"{name}.target")) as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                i, dx, dy, dz = line.split()
                v = verts[int(i)]
                v[0] += float(dx) * w
                v[1] += float(dy) * w
                v[2] += float(dz) * w


def to_blender(v, ground):
    """MakeHuman is y-up, facing +z, in decimetres; Blender here is z-up, facing -y, in metres, feet at z = 0."""
    return Vector((v[0] * 0.1, -v[2] * 0.1, (v[1] - ground) * 0.1))


def build_body(name, targets, extra=()):
    """A body mesh with UVs and our bone weights, plus the joint positions. Arms are still in MakeHuman's A pose.
    `extra` adds helper groups (say the eyeballs, helper-l-eye): their faces get material slot 1."""
    verts, uvs, by_group, groups = read_base()
    apply_targets(verts, targets)
    ground = min(verts[i][1] for i in groups["body"])  # the soles, not the marker, so feet sit on z = 0
    joints = {}
    for ours, marker in JOINTS.items():
        ids = groups[marker]
        c = [sum(verts[i][k] for i in ids) / len(ids) for k in range(3)]
        joints[ours] = to_blender(c, ground)

    faces = by_group["body"] + [f for g in extra for f in by_group[g]]
    slot = [0] * len(by_group["body"]) + [1] * (len(faces) - len(by_group["body"]))
    used = sorted({i for vs, _ in faces for i in vs})
    remap = {old: new for new, old in enumerate(used)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(verts[i], ground) for i in used], [], [[remap[i] for i in vs] for vs, _ in faces])
    uv = mesh.uv_layers.new(name="UVMap")
    loop = 0
    for vs, ts in faces:
        for t in ts:
            uv.data[loop].uv = uvs[t]
            loop += 1
    for p, k in zip(mesh.polygons, slot):
        p.use_smooth = True
        p.material_index = k
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    # Fold MakeHuman's weights onto our bones.
    weights = json.load(open(os.path.join(MH, "default_weights.mhw")))["weights"]
    acc = defaultdict(lambda: defaultdict(float))
    for mh, pairs in weights.items():
        ours = _our_bone(mh)
        for i, w in pairs:
            if i in remap:
                acc[ours][remap[i]] += w
    vg = {n: obj.vertex_groups.new(name=n) for n, *_ in BONES}
    for ours, vw in acc.items():
        for i, w in vw.items():
            vg[ours].add([i], w, "REPLACE")
    return obj, joints


def build_rig(joints, name="rig"):
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    for o in bpy.context.view_layer.objects:
        o.select_set(o == rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, h, t, parent in BONES:
        b = arm.edit_bones.new(bname)
        b.head = joints[h]
        b.tail = joints[t]
        if (b.tail - b.head).length < 0.02:
            b.tail = b.head + Vector((0, 0, 0.1))
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def bind(objs, rig):
    for o in objs:
        o.parent = rig
        m = o.modifiers.new("rig", "ARMATURE")
        m.object = rig


def _aim(pb, rig, direction):
    """Rotates a pose bone so it points along `direction` (armature space), keeping its roll as near as it can."""
    bpy.context.view_layer.update()
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(direction.normalized())
    m = pb.matrix.copy()
    loc = m.to_translation()
    rot = (q.to_matrix().to_4x4() @ Matrix.Translation(-loc))
    pb.matrix = Matrix.Translation(loc) @ rot @ m


def repose(rig, objs, arm_out=0.15, poses=None):
    """Brings the arms down to hang `arm_out` rad from vertical and the legs straight down, then makes that the
    rest pose for the rig and every bound mesh. `poses` can add more aims: {bone: direction}."""
    import math

    aims = {}
    for s, sign in (("L", 1), ("R", -1)):
        aims[f"upperarm.{s}"] = Vector((sign * math.sin(arm_out), 0.0, -math.cos(arm_out)))
        aims[f"forearm.{s}"] = Vector((sign * math.sin(arm_out), -0.02, -math.cos(arm_out)))
        aims[f"hand.{s}"] = Vector((sign * math.sin(arm_out) * 0.5, -0.05, -1.0))
        aims[f"thigh.{s}"] = Vector((sign * 0.01, 0.0, -1.0))
        aims[f"shin.{s}"] = Vector((sign * 0.005, 0.01, -1.0))
    aims.update(poses or {})
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    order = [b for b, *_ in BONES]  # parents before children
    for bname in order:
        if bname in aims:
            _aim(rig.pose.bones[bname], rig, aims[bname])
    bpy.ops.object.mode_set(mode="OBJECT")
    bake_pose(rig, objs)


def bake_pose(rig, objs):
    """Applies the current pose to the meshes and makes it the rig's rest pose."""
    _IRONED.clear()  # the body has moved
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for x in bpy.context.view_layer.objects:
            x.select_set(x == o)
        mod = next(m for m in o.modifiers if m.type == "ARMATURE")
        name = mod.name
        bpy.ops.object.modifier_apply(modifier=name)
        m = o.modifiers.new(name, "ARMATURE")
        m.object = rig
    bpy.context.view_layer.objects.active = rig
    for x in bpy.context.view_layer.objects:
        x.select_set(x == rig)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def simplify(body, voxel=0.01, iterations=40):
    """Keeps the body's proportions but not its anatomy: rebuilt as an even voxel mesh (fingers, toes and
    the face's small forms melt away), smoothed without shrinking, its bone weights carried over from the
    nearest original vertices. Clothes grown from it come out as smooth, simple volumes."""
    import bmesh
    from mathutils.kdtree import KDTree

    src = [(v.co.copy(), [(g.group, g.weight) for g in v.groups]) for v in body.data.vertices]
    names = {g.index: g.name for g in body.vertex_groups}
    m = body.modifiers.new("voxel", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    bpy.context.view_layer.objects.active = body
    for o in bpy.context.view_layer.objects:
        o.select_set(o == body)
    bpy.ops.object.modifier_move_to_index(modifier="voxel", index=0)  # before the rig, which stays
    bpy.ops.object.modifier_apply(modifier="voxel")
    bm = bmesh.new()
    bm.from_mesh(body.data)
    _taubin(bm, iterations, lam=0.6, mu=-0.63)
    bm.to_mesh(body.data)
    bm.free()
    kd = KDTree(len(src))
    for i, (c, _) in enumerate(src):
        kd.insert(c, i)
    kd.balance()
    for g in list(body.vertex_groups):
        body.vertex_groups.remove(g)
    groups = {n: body.vertex_groups.new(name=n) for n in names.values()}
    for v in body.data.vertices:
        acc, total = defaultdict(float), 0.0
        for _, i, d in kd.find_n(v.co, 4):
            w = 1 / (d + 1e-3)
            total += w
            for gi, gw in src[i][1]:
                acc[gi] += gw * w
        for gi, w in acc.items():
            if w / total > 0.01:
                groups[names[gi]].add([v.index], w / total, "REPLACE")
    for p in body.data.polygons:
        p.use_smooth = True
    _IRONED.clear()


# ---------------------------------------------------------------------------------------------
# Clothes and gear grown from the body itself, so they fit it: a region of the skin is copied, pushed out
# by the cloth's thickness, smoothed so muscles don't show through, kept clear of the body, and given a rim.


def dominant_bones(obj):
    """Each vertex's strongest bone."""
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names[best.group] if best else "hips")
    return out


_IRONED = {}


def _taubin(bm, iterations, movable=None, lam=0.5, mu=-0.53, edges=None):
    """Smooths a bmesh without shrinking it (Taubin's lambda/mu steps). Plain Laplacian smoothing shrinks
    sparse areas faster than dense ones, which turns small dense forms (the nipples) into bumps."""
    import numpy as np

    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts])
    e = np.array([(ed.verts[0].index, ed.verts[1].index) for ed in (edges if edges is not None else bm.edges)])
    deg = np.bincount(e.ravel(), minlength=len(co)).astype(float)
    deg[deg == 0] = 1
    mask = np.ones(len(co), bool) if movable is None else np.array([movable(v) for v in bm.verts])
    for k in range(iterations * 2):
        acc = np.zeros_like(co)
        np.add.at(acc, e[:, 0], co[e[:, 1]])
        np.add.at(acc, e[:, 1], co[e[:, 0]])
        f = lam if k % 2 == 0 else mu
        co[mask] += f * (acc[mask] / deg[mask, None] - co[mask])
    for v, c in zip(bm.verts, co):
        v.co = c


def _ironed(body, iterations=80):
    """The skin's positions, normals from a heavily smoothed copy (so small forms don't steer offsets), and a BVH."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    key = (body.name, len(body.data.vertices))
    if key not in _IRONED:
        bm = bmesh.new()
        bm.from_mesh(body.data)
        # Positions stay the skin's own (smoothing would shrink sparse areas faster than dense ones and
        # raise bumps); only the normals come from a heavily smoothed copy, so offsets never fold.
        raw = [v.co.copy() for v in bm.verts]
        for _ in range(iterations):
            bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.normal_update()
        bm.verts.ensure_lookup_table()
        nors = [v.normal.copy() for v in bm.verts]
        for v, c in zip(bm.verts, raw):
            v.co = c
        _IRONED[key] = (raw, nors, BVHTree.FromBMesh(bm))
        bm.free()
    return _IRONED[key]


def _softened(body, iterations):
    """The body's positions and normals after `iterations` of shrink-free smoothing, and a BVH of that soft
    body: clothes grown from it skim over the muscles, the chest and the knees instead of following them."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    key = (body.name, len(body.data.vertices), iterations)
    if key not in _IRONED:
        bm = bmesh.new()
        bm.from_mesh(body.data)
        _taubin(bm, iterations, lam=0.6, mu=-0.63)
        bm.normal_update()
        bm.verts.ensure_lookup_table()
        _IRONED[key] = ([v.co.copy() for v in bm.verts], [v.normal.copy() for v in bm.verts], BVHTree.FromBMesh(bm))
        bm.free()
    return _IRONED[key]


def shell(body, name, pick, thickness, mat, smooth=6, rim=0.008, folds=None, keep_groups=True, clear=0.75, iron=True, drape=None, relax=None, hem=None, soften=0):
    """A garment from the body: `pick(i, co, bone)` chooses vertices, `thickness(co, bone)` how far it stands off.
    `folds(co, bone)` can add a little more along the normal, for creases. `hem=(below, z)` lays every edge
    vertex lower than `below` at height `z`, for a straight hem (a third item, `where(co)`, limits which).
    `soften` grows it from a smoothed copy of the body instead of the skin. Returns the new object."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    bones = dominant_bones(body)
    me = body.data
    keep = [pick(v.index, v.co, bones[v.index]) for v in me.vertices]
    obj = body.copy()
    obj.data = me.copy()
    obj.name = name
    obj.data.name = name
    obj.modifiers.clear()
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context="VERTS")
    bm.verts.ensure_lookup_table()
    # Original indices survive in a layer so thickness can read the body's bone per vertex.
    src = bm.verts.layers.int.new("src")
    # bmesh keeps vertex order after a delete, so the survivors line up with the kept indices.
    kd_ids = [i for i, k in enumerate(keep) if k]
    for v, i in zip(bm.verts, kd_ids):
        v[src] = i
    # Offset from an ironed copy of the body, not the skin itself: a small sharp form (a knuckle, a nipple)
    # pushed out by a few centimetres along its own normals would fold over itself.
    cos, nors, bvh = _softened(body, soften) if soften else _ironed(body)
    if not iron:
        cos, nors = [v.co for v in me.vertices], [v.normal for v in me.vertices]
    for v in bm.verts:
        i = v[src]
        v.co = cos[i] + nors[i] * thickness(me.vertices[i].co, bones[i])
    # The base mesh has small openings (nipples, navel, ...): close them so the cloth runs smooth across.
    # Each patch gets a centre vertex (poke), so smoothing can pull it level instead of leaving a flat
    # n-gon that shades like a bump.
    filled = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=24)["faces"]
    poked = bmesh.ops.poke(bm, faces=filled)
    for f in poked["faces"]:
        for v in f.verts:
            if v[src] == 0 and v.link_edges:
                v[src] = next(e.other_vert(v)[src] for e in v.link_edges)
    if drape:
        drape(bm)
    _taubin(bm, smooth, movable=lambda v: not v.is_boundary)
    # Where two parts of the garment press together (the armpit) the offsets cross and fold: relax there
    # with plain smoothing, which irons a fold flat.
    if relax:
        zone, n = relax
        verts = [v for v in bm.verts if not v.is_boundary and zone(v.co)]
        for _ in range(n):
            bmesh.ops.smooth_vert(bm, verts=verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # Straighten the openings (hem, cuffs, collar): they follow the body's triangles and come out jagged.
    rims = [e for e in bm.edges if e.is_boundary]
    if rims:
        _taubin(bm, 30, movable=lambda v: v.is_boundary, edges=rims)
    if hem:
        below, z, where = (*hem, None)[:3]
        for v in bm.verts:
            if v.is_boundary and v.co.z < below and (where is None or where(v.co)):
                v.co.z = z
    # Smoothing shrinks the shell: keep it clear of the ironed body.
    for v in bm.verts:
        i = v[src]
        t = thickness(me.vertices[i].co, bones[i])
        hit = bvh.find_nearest(v.co)
        if hit[0] is None:
            continue
        p, nrm = hit[0], hit[1]
        d = (v.co - p).dot(nrm)
        if d < t * clear:
            v.co += nrm * (t * clear - d)  # a nudge, not a snap: snapping bunches vertices onto one point
        if folds:
            v.co += me.vertices[i].normal * folds(me.vertices[i].co, bones[i])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if rim:
        s = obj.modifiers.new("rim", "SOLIDIFY")
        s.thickness = rim
        s.offset = -1
        s.use_rim = True
        bpy.context.view_layer.objects.active = obj
        for x in bpy.context.view_layer.objects:
            x.select_set(x == obj)
        bpy.ops.object.modifier_apply(modifier="rim")
    if not keep_groups:
        obj.vertex_groups.clear()
    return obj


def refine(obj, body, iterations, clearance, soften, rim=0.0, relax=None, over=()):
    """Smooths a garment again once it has been posed (bringing the arms down leaves a ridge over the
    shoulder), keeps it `clearance` (a distance, or a function of position) off the softened posed body and
    outside the garments in `over` (still without their rims), then gives it its rim. Its openings stay put.
    `relax=(zone(co), n)` irons a zone flat with `n` passes of plain smoothing, which takes the corner off a
    shoulder."""
    import bmesh
    from mathutils.bvhtree import BVHTree

    _, _, bvh = _softened(body, soften)
    gap = clearance if callable(clearance) else (lambda co: clearance)
    under = []
    for o in over:
        ob = bmesh.new()
        ob.from_mesh(o.data)
        ob.faces.ensure_lookup_table()
        rimmed = {f.index for f in ob.faces if any(v.is_boundary for v in f.verts)}  # its waistband
        under.append((BVHTree.FromBMesh(ob), rimmed))
        ob.free()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    _taubin(bm, iterations, movable=lambda v: not v.is_boundary)
    if relax:
        zone, n = relax
        verts = [v for v in bm.verts if not v.is_boundary and zone(v.co)]
        for _ in range(n):
            bmesh.ops.smooth_vert(bm, verts=verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for v in bm.verts:
        hit = bvh.find_nearest(v.co)
        if hit[0] is not None:
            d, want = (v.co - hit[0]).dot(hit[1]), gap(v.co)
            if d < want:
                v.co += hit[1] * (want - d)
        for t, rimmed in under:
            # The garment underneath gets its thickness inward, so a few millimetres clear of it is enough;
            # but not beside its opening (a waistband), where the nearest point lies off to one side.
            hit = t.find_nearest(v.co, 0.05)
            if hit[0] is not None and hit[2] not in rimmed:
                d = (v.co - hit[0]).dot(hit[1])
                if d < 0.005:
                    v.co += hit[1] * (0.005 - d)
    bm.to_mesh(obj.data)
    bm.free()
    if rim:
        add_rim(obj, rim)


def add_rim(obj, thickness):
    """Gives a garment's single surface its thickness, inward, with a closed edge at every opening."""
    s = obj.modifiers.new("rim", "SOLIDIFY")
    s.thickness = thickness
    s.offset = -1
    s.use_rim = True
    bpy.context.view_layer.objects.active = obj
    for x in bpy.context.view_layer.objects:
        x.select_set(x == obj)
    bpy.ops.object.modifier_move_to_index(modifier="rim", index=0)  # before the rig
    bpy.ops.object.modifier_apply(modifier="rim")


def trim_body(body, keep):
    """Deletes the body's vertices that clothes hide; `keep(i, co, bone)` says which stay."""
    import bmesh

    bones = dominant_bones(body)
    flags = [keep(v.index, v.co, bones[v.index]) for v in body.data.vertices]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not flags[v.index]], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()


def hull_shell(body, name, pick, offset, mat, keep=None, subdiv=2, rim=0.01, bone=None, scale=None, cuts=()):
    """Hard gear (helmet, goggles, boots): the convex hull of the picked skin, pushed out by `offset`,
    rounded with subdivision. `keep(face_normal, face_center)` drops hull faces (say, the helmet's underside).
    `bone` weights it all to one bone; otherwise each vertex copies the nearest body vertex's weights."""
    import bmesh
    from mathutils.kdtree import KDTree

    bones = dominant_bones(body)
    me = body.data
    pts = [v.co.copy() for v in me.vertices if pick(v.index, v.co, bones[v.index])]
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    loose = {g for g in res["geom_interior"] + res["geom_unused"] if isinstance(g, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(loose), context="VERTS")
    c = sum(pts, Vector()) / len(pts)
    if scale:
        for v in bm.verts:
            v.co = c + Vector(((v.co - c).x * scale[0], (v.co - c).y * scale[1], (v.co - c).z * scale[2]))
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    # `cuts` are (point, normal) planes: what lies behind each is cut away along a clean edge.
    for co, no in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, clear_inner=True)
    if cuts:
        # The hull's long thin triangles would subdivide into ripples: even them out first.
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bmesh.ops.beautify_fill(bm, faces=bm.faces[:], edges=bm.edges[:])
    if keep:
        bm.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f.normal, f.calc_center_median())], context="FACES_ONLY")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    me2 = bpy.data.meshes.new(name)
    bm.to_mesh(me2)
    bm.free()
    obj = bpy.data.objects.new(name, me2)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    for x in bpy.context.view_layer.objects:
        x.select_set(x == obj)
    if subdiv:
        s = obj.modifiers.new("round", "SUBSURF")
        s.levels = subdiv
        bpy.ops.object.modifier_apply(modifier="round")
    if rim:
        s = obj.modifiers.new("rim", "SOLIDIFY")
        s.thickness = rim
        s.offset = -1
        bpy.ops.object.modifier_apply(modifier="rim")
    for p in obj.data.polygons:
        p.use_smooth = True
    # Weights.
    groups = {g.name: obj.vertex_groups.new(name=g.name) for g in body.vertex_groups}
    if bone:
        groups[bone].add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    else:
        kd = KDTree(len(me.vertices))
        for v in me.vertices:
            kd.insert(v.co, v.index)
        kd.balance()
        names = {g.index: g.name for g in body.vertex_groups}
        for v in obj.data.vertices:
            _, i, _ = kd.find(v.co)
            for g in me.vertices[i].groups:
                groups[names[g.group]].add([v.index], g.weight, "REPLACE")
    return obj


def drape_front(top, bottom, slack=0.02, cell=0.02, window=0.06):
    """For a jacket: cloth hangs from the chest instead of following the belly and the hollows under the
    chest. Between heights `bottom` and `top`, each front vertex comes forward to the most forward point at
    or above it in the same vertical strip (less `slack` per 10 cm of drop)."""

    def run(bm):
        front = [v for v in bm.verts if bottom < v.co.z < top and v.co.y < 0]
        strips = defaultdict(list)
        for v in front:
            strips[round(v.co.x / cell)].append(v)
        for vs in strips.values():
            vs.sort(key=lambda v: -v.co.z)
            # First iron the strip's profile (a running average over `window`), which takes out small
            # bumps like the chest's; then let the cloth hang forward over the hollows below.
            ys = [v.co.y for v in vs]
            zs = [v.co.z for v in vs]
            for k, v in enumerate(vs):
                near = [ys[j] for j in range(len(vs)) if abs(zs[j] - zs[k]) < window]
                v.co.y = sum(near) / len(near)
            best = None
            best_z = None
            for v in vs:
                if best is not None:
                    allow = best + slack * (best_z - v.co.z) / 0.1
                    if v.co.y > allow:
                        v.co.y = allow
                if best is None or v.co.y < best:
                    best, best_z = v.co.y, v.co.z

    return run


def paint(obj, shade, name="Col"):
    """A per-vertex shade (1 = the material's own colour) for two-tone garments; soft-edged where it changes."""
    attr = obj.data.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    for v in obj.data.vertices:
        k = shade(v.co)
        attr.data[v.index].color = (k, k, k, 1.0)


def _hull2d(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def _ray_hull(c, d, hull):
    """Distance from `c` along unit `d` to the polygon `hull` (c inside it)."""
    best = None
    n = len(hull)
    for k in range(n):
        a, b = hull[k], hull[(k + 1) % n]
        ex, ey = b[0] - a[0], b[1] - a[1]
        den = d[0] * ey - d[1] * ex
        if abs(den) < 1e-12:
            continue
        t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den
        s = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den
        if t > 0 and -1e-6 <= s <= 1 + 1e-6 and (best is None or t < best):
            best = t
    return best


def drape_slices(bottom, top, cell=0.015, skip=None, reach=0.025):
    """For a jacket torso: cloth stretches across hollows rather than following them. Between `bottom` and
    `top`, each horizontal slice of the shell is pushed out to that slice's convex hull, so the chest,
    the small of the back and the ribs leave no shape in the cloth."""

    def run(bm):
        rows = defaultdict(list)
        src = bm.verts.layers.int.get("src")
        for v in bm.verts:
            if bottom < v.co.z < top and not (skip and skip(v[src])):
                rows[round(v.co.z / cell)].append(v)
        for vs in rows.values():
            if len(vs) < 6:
                continue
            hull = _hull2d([(v.co.x, v.co.y) for v in vs])
            if len(hull) < 3:
                continue
            c = (sum(p[0] for p in hull) / len(hull), sum(p[1] for p in hull) / len(hull))
            for v in vs:
                dx, dy = v.co.x - c[0], v.co.y - c[1]
                r = math.hypot(dx, dy)
                if r < 1e-6:
                    continue
                t = _ray_hull(c, (dx / r, dy / r), hull)
                if t and t > r:
                    t = min(t, r + reach)  # a deep hollow (the armpit) stays a hollow
                    v.co.x, v.co.y = c[0] + dx / r * t, c[1] + dy / r * t

    return run
