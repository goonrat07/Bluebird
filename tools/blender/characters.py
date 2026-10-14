"""Builds Bluebird's characters in Blender and exports them as glTF.

Run headless with Blender's Python module (pip install bpy) from the repo root:
    python tools/blender/characters.py

Writes src/assets/models/rider.glb (a rigged rider the game poses bone by bone) and
src/assets/models/villager.glb (posed villager bodies plus hair and hats, drawn instanced).

The look follows the Tiny Bookshop reference shots: natural proportions (about seven and a half
heads tall), smooth tapered limbs with knees, elbows, hands and feet, clothes that read by shape
and colour, a plain face with a nose and ears, softly lit. Bodies are grown from a stick-figure
skeleton with Blender's Skin modifier and smoothed with one level of subdivision.

Coordinates are Blender's: Z up, the character faces -Y, their left hand is at +X. The glTF
exporter turns that into three.js's Y up with the character facing +Z.
"""

import math
import os
import sys

import bpy  # first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Matrix, Vector

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
# Skeletons: named points with a skin radius (across, front-to-back), and the edges joining them.


def skeleton(pose="stand", build="rider"):
    """Points and edges for a body. `pose` is stand, sit, cheer or sitcheer."""
    puffy = 1.08 if build == "rider" else 1.0  # a ski jacket and ski trousers are fuller
    sit = pose in ("sit", "sitcheer")
    cheer = pose in ("cheer", "sitcheer")
    pelvis_z = 0.5 if sit else 0.95
    dz = pelvis_z - 0.95
    p = {}
    r = {}

    def at(name, x, y, z, rx, ry=None):
        p[name] = Vector((x, y, z + dz))
        r[name] = (rx, ry if ry is not None else rx)

    # Torso: hips a little wider than the waist, chest broadest, a short neck.
    at("pelvis", 0, 0.005, 0.95, 0.165 * puffy, 0.12 * puffy)
    at("waist", 0, 0.0, 1.08, 0.15 * puffy, 0.112 * puffy)
    at("chest", 0, -0.008, 1.28, 0.19 * puffy, 0.125 * puffy)
    at("neckbase", 0, 0.0, 1.45, 0.06, 0.058)
    at("necktop", 0, 0.0, 1.53, 0.047)
    for s, side in ((1, "L"), (-1, "R")):
        # Legs: thigh, knee, calf, ankle, a foot pointing forward.
        if sit:
            at(f"hip{side}", s * 0.098, 0.0, 0.92, 0.1 * puffy)
            at(f"knee{side}", s * 0.11, -0.42, 0.93, 0.072 * puffy)
            at(f"calf{side}", s * 0.11, -0.44, 0.72, 0.066 * puffy)
            at(f"ankle{side}", s * 0.11, -0.44, 0.09 - dz, 0.05)
            at(f"toe{side}", s * 0.11, -0.58, 0.04 - dz, 0.05, 0.04)
        else:
            at(f"hip{side}", s * 0.098, 0.0, 0.92, 0.1 * puffy)
            at(f"knee{side}", s * 0.1, -0.012, 0.5, 0.072 * puffy)
            at(f"calf{side}", s * 0.1, 0.012, 0.36, 0.068 * puffy)
            at(f"ankle{side}", s * 0.1, 0.01, 0.09, 0.05)
            at(f"toe{side}", s * 0.1, -0.14, 0.04, 0.05, 0.04)
        # Arms: shoulder, elbow, wrist, a flat hand. Cheering throws them up and out.
        at(f"shoulder{side}", s * 0.215, 0.0, 1.41, 0.066 * puffy)
        if cheer:
            at(f"elbow{side}", s * 0.35, -0.03, 1.62, 0.054 * puffy)
            at(f"wrist{side}", s * 0.42, -0.05, 1.86, 0.042)
            at(f"hand{side}", s * 0.44, -0.05, 1.95, 0.052, 0.032)
        else:
            at(f"elbow{side}", s * 0.27, 0.012, 1.14, 0.054 * puffy)
            at(f"wrist{side}", s * 0.29, -0.012, 0.9, 0.042)
            at(f"hand{side}", s * 0.295, -0.02, 0.81, 0.052, 0.032)
    edges = [("pelvis", "waist"), ("waist", "chest"), ("chest", "neckbase"), ("neckbase", "necktop")]
    for side in "LR":
        edges += [
            ("pelvis", f"hip{side}"),
            (f"hip{side}", f"knee{side}"),
            (f"knee{side}", f"calf{side}"),
            (f"calf{side}", f"ankle{side}"),
            (f"ankle{side}", f"toe{side}"),
            ("neckbase", f"shoulder{side}"),
            (f"shoulder{side}", f"elbow{side}"),
            (f"elbow{side}", f"wrist{side}"),
            (f"wrist{side}", f"hand{side}"),
        ]
    return p, r, edges


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def skin_body(name, points, radii, edges):
    names = list(points)
    idx = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([points[n] for n in names], [(idx[a], idx[b]) for a, b in edges], [])
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    skin = obj.modifiers.new("skin", "SKIN")
    skin.branch_smoothing = 0.6
    skin.use_smooth_shade = True
    for n, v in zip(names, me.skin_vertices[0].data):
        v.radius = radii[n]
    me.skin_vertices[0].data[idx["pelvis"]].use_root = True
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    apply_modifiers(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def assign_regions(obj, mats, pick, cuts=()):
    """Gives each face a material slot by where its centre is: pick(centre) -> material name.
    The mesh is first sliced level at each height in `cuts`, so hems and cuffs are clean lines."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for z in cuts:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    for m in mats:
        obj.data.materials.append(m)
    index = {m.name: i for i, m in enumerate(mats)}
    for poly in obj.data.polygons:
        poly.material_index = index[pick(obj.matrix_world @ poly.center)]


# ---------------------------------------------------------------------------------------------
# Small shapes: heads, hair, hats, gear. Each is built at the standing head and moved for sitters.


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


def torus(name, loc, major, minor, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    seg, ring = 24, 10
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(ring):
            b = 2 * math.pi * j / ring
            x = (major + minor * math.cos(b)) * math.cos(a)
            y = (major + minor * math.cos(b)) * math.sin(a)
            z = minor * math.sin(b)
            verts.append(bm.verts.new((x * scale[0] + loc[0], y * scale[1] + loc[1], z * scale[2] + loc[2])))
    for i in range(seg):
        for j in range(ring):
            a = verts[i * ring + j]
            b = verts[((i + 1) % seg) * ring + j]
            c = verts[((i + 1) % seg) * ring + (j + 1) % ring]
            d = verts[i * ring + (j + 1) % ring]
            bm.faces.new((a, b, c, d))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    for poly in obj.data.polygons:
        poly.use_smooth = True
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


HEAD = Vector((0, 0, 1.645))


def head(skin_mat, dz=0.0):
    """A plain, slightly long head with a nose and ears, like the reference: no drawn features."""
    c = HEAD + Vector((0, 0, dz))
    skull = sphere("head", c, 0.114, scale=(0.88, 0.97, 1.08))
    # Narrow the lower half into cheeks and a chin, and bring the chin a little forward: one smooth
    # surface, so there's no seam where a separate jaw would meet the skull.
    for v in skull.data.vertices:
        below = max(0.0, (c.z - v.co.z) / 0.12)
        v.co.x = c.x + (v.co.x - c.x) * (1 - 0.28 * below)
        v.co.y = c.y + (v.co.y - c.y) * (1 - 0.12 * below) - 0.012 * below
    parts = [
        skull,
        sphere("nose", c + Vector((0, -0.108, -0.014)), 0.021, scale=(0.75, 1.0, 1.35), segments=10, rings=8),
        sphere("earL", c + Vector((0.1, 0.005, -0.005)), 0.025, scale=(0.45, 0.8, 1.1), segments=10, rings=8),
        sphere("earR", c + Vector((-0.1, 0.005, -0.005)), 0.025, scale=(0.45, 0.8, 1.1), segments=10, rings=8),
    ]
    for o in parts:
        with_material(o, skin_mat)
    return parts


def hair_cap(name, mat, dz=0.0, back=0.0, cover=-0.02, scale=(0.97, 1.03, 1.0)):
    """Hair over the crown and down the back of the head."""
    o = sphere(name, HEAD + Vector((0, 0.008 + back, 0.014 + dz)), 0.118, scale=scale, cut=cover)
    return with_material(o, mat)


def tops(hair_mat, hat_mat, dz=0.0):
    """Villagers' hair and hats, each its own object so the game can pick one per person."""
    out = {}
    out["short"] = hair_cap("short", hair_mat, dz)
    bun = hair_cap("bun_hair", hair_mat, dz)
    knot = with_material(sphere("bun_knot", HEAD + Vector((0, 0.08, 0.1 + dz)), 0.05), hair_mat)
    out["bun"] = join([bun, knot], "bun")
    long_cap = hair_cap("long_hair", hair_mat, dz)
    fall = with_material(sphere("long_fall", HEAD + Vector((0, 0.07, -0.07 + dz)), 0.1, scale=(1.0, 0.55, 1.35)), hair_mat)
    out["long"] = join([long_cap, fall], "long")
    out["curly"] = with_material(sphere("curly", HEAD + Vector((0, 0.02, 0.04 + dz)), 0.15, scale=(1.0, 0.95, 0.88)), hair_mat)
    # A beanie with a folded cuff and a pom-pom.
    beanie = with_material(sphere("beanie_crown", HEAD + Vector((0, 0.005, 0.035 + dz)), 0.124, scale=(0.95, 1.02, 1.05), cut=-0.01), hat_mat)
    cuff = with_material(torus("beanie_cuff", HEAD + Vector((0, 0.005, 0.035 + dz)), 0.114, 0.02, scale=(0.95, 1.02, 1)), hat_mat)
    pom = with_material(sphere("beanie_pom", HEAD + Vector((0, 0.005, 0.17 + dz)), 0.034), hat_mat)
    out["beanie"] = join([beanie, cuff, pom], "beanie")
    # A wide-brimmed hat with a band, as worn by the man by the truck.
    crown = with_material(sphere("sunhat_crown", HEAD + Vector((0, 0.005, 0.068 + dz)), 0.112, scale=(1, 1, 0.9), cut=-0.005), hat_mat)
    brim = with_material(cylinder("sunhat_brim", HEAD + Vector((0, 0.005, 0.066 + dz)), 0.21, 0.012, segments=28), hat_mat)
    out["sunhat"] = join([crown, brim], "sunhat")
    # A cap with a peak.
    cap_crown = with_material(sphere("cap_crown", HEAD + Vector((0, 0.008, 0.035 + dz)), 0.12, scale=(0.97, 1.03, 0.95), cut=-0.005), hat_mat)
    peak = with_material(cylinder("cap_peak", HEAD + Vector((0, -0.115, 0.04 + dz)), 0.08, 0.01, segments=20, scale=(1, 0.75, 1)), hat_mat)
    out["cap"] = join([cap_crown, peak], "cap")
    return out


# ---------------------------------------------------------------------------------------------
# The rider: body, head, helmet with goggles, scarf, mittens and boots, on an armature.

BONES = [
    # name, head point, tail point, parent
    ("hips", "pelvis", "waist", None),
    ("spine", "waist", "chest", "hips"),
    ("chest", "chest", "neckbase", "spine"),
    ("neck", "neckbase", "necktop", "chest"),
    ("head", "necktop", None, "neck"),
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


def segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def build_rider():
    mats = {
        "jacket": material("jacket", 0xE2725B),
        "pants": material("pants", 0x3E5C8A),
        "skin": material("skin", 0xE0A889),
        "gloves": material("gloves", 0x3B3350),
        "boots": material("boots", 0x4A4048),
        "helmet": material("helmet", 0x4F8F7A),
        "goggles": material("goggles", 0x2E2A36),
        "lens": material("lens", 0x9FD0D6),
        "hair": material("hair", 0x6E4430),
        "scarf": material("scarf", 0xF2B544),
    }
    points, radii, edges = skeleton("stand", "rider")
    body = skin_body("rider", points, radii, edges)

    def region(c):
        if c.z > 1.47:
            return "skin"
        if abs(c.x) > 0.2 and c.z < 0.865:
            return "gloves"
        if c.z > 0.9:
            return "jacket"
        if c.z > 0.15:
            return "pants"
        return "boots"

    assign_regions(body, list(mats.values()), region, cuts=(1.47, 0.9, 0.865, 0.15))

    # Head and gear, all riding on the head bone.
    extras = head(mats["skin"])
    extras.append(hair_cap("hair", mats["hair"], back=0.02, cover=-0.06, scale=(1.0, 1.05, 1.0)))
    extras.append(with_material(sphere("helmet", HEAD + Vector((0, 0.004, 0.024)), 0.132, scale=(0.95, 1.04, 1.0), cut=-0.01), mats["helmet"]))
    # Goggles pushed up on the helmet's brow: a strap round it and a lens at the front.
    extras.append(with_material(torus("strap", HEAD + Vector((0, 0.004, 0.058)), 0.129, 0.013, scale=(0.95, 1.04, 1.0)), mats["goggles"]))
    frame = with_material(sphere("goggle_frame", HEAD + Vector((0, -0.114, 0.07)), 0.055, scale=(1.55, 0.55, 0.75), segments=16, rings=10), mats["goggles"])
    lens = with_material(sphere("goggle_lens", HEAD + Vector((0, -0.133, 0.07)), 0.047, scale=(1.55, 0.35, 0.62), segments=16, rings=10), mats["lens"])
    extras += [frame, lens]
    scarf = with_material(torus("scarf", Vector((0, 0, 1.46)), 0.07, 0.03, scale=(1.05, 1.0, 1.0)), mats["scarf"])

    arm_data = bpy.data.armatures.new("rig")
    rig = bpy.data.objects.new("rig", arm_data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    for o in bpy.context.view_layer.objects:
        o.select_set(o == rig)
    bpy.ops.object.mode_set(mode="EDIT")
    segs = {}
    for name, h, t, parent in BONES:
        b = arm_data.edit_bones.new(name)
        b.head = points[h]
        b.tail = points[t] if t else points[h] + Vector((0, 0, 0.2))
        if name.startswith("hand."):
            b.tail = points[t] + (points[t] - points[h]).normalized() * 0.05
        if parent:
            b.parent = arm_data.edit_bones[parent]
        segs[name] = (b.head.copy(), b.tail.copy())
    bpy.ops.object.mode_set(mode="OBJECT")

    # Weights: each vertex follows its two nearest bones, blended by distance, so joints bend softly.
    def weigh(obj, only=None):
        groups = {name: obj.vertex_groups.new(name=name) for name, *_ in BONES}
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            if only:
                groups[only].add([v.index], 1.0, "REPLACE")
                continue
            d = sorted((segment_distance(p, *segs[n]), n) for n in segs)
            (d0, n0), (d1, n1) = d[0], d[1]
            w0, w1 = 1 / (d0 + 1e-3) ** 4, 1 / (d1 + 1e-3) ** 4
            groups[n0].add([v.index], w0 / (w0 + w1), "REPLACE")
            groups[n1].add([v.index], w1 / (w0 + w1), "REPLACE")

    weigh(body)
    for o in extras:
        weigh(o, "head")
    weigh(scarf, "neck")
    rider = join([body, *extras, scarf], "rider")
    rider.parent = rig
    mod = rider.modifiers.new("rig", "ARMATURE")
    mod.object = rig
    return rig, rider


# ---------------------------------------------------------------------------------------------
# Villagers: posed bodies (no rig; they only sway and hop), plus the hair and hat pieces.


def build_villagers():
    mats = {
        "shirt": material("shirt", 0xE2725B),
        "pants": material("pants", 0x3E5C8A),
        "skin": material("skin", 0xC98E6A),
        "shoes": material("shoes", 0x3B3350),
        "forearm": material("forearm", 0xE2725B),
    }
    objs = []
    for pose in ("stand", "sit", "cheer", "sitcheer"):
        points, radii, edges = skeleton(pose, "villager")
        body = skin_body(f"body_{pose}", points, radii, edges)
        sit = pose.startswith("sit")

        def region(c, sit=sit, pose=pose):
            lift = -0.45 if sit else 0.0
            cheer = pose in ("cheer", "sitcheer")
            if c.z > 1.47 + lift:
                return "skin"
            if abs(c.x) > 0.21:
                # Arms: hands are skin; the forearm is its own colour, so a villager can wear short
                # sleeves (skin) or long ones (shirt).
                if cheer:
                    if c.z > 1.86 + lift:
                        return "skin"
                    if c.z > 1.62 + lift:
                        return "forearm"
                else:
                    if c.z < 0.86 + lift:
                        return "skin"
                    if c.z < 1.14 + lift:
                        return "forearm"
                return "shirt"
            # The shirt ends in a level hem at the hips; a seated lap is trousers.
            if c.z > 0.94 + lift and not (sit and c.y < -0.1):
                return "shirt"
            if c.z > 0.13:
                return "pants"
            return "shoes"

        lift = -0.45 if sit else 0.0
        arm_cuts = (1.86, 1.62) if pose in ("cheer", "sitcheer") else (1.14, 0.86)
        assign_regions(body, list(mats.values()), region, cuts=[z + lift for z in (1.47, 0.94, *arm_cuts)] + [0.13])
        parts = head(mats["skin"], dz=-0.45 if sit else 0.0)
        objs.append(join([body, *parts], f"body_{pose}"))
    hair = material("hair", 0x3A2A24)
    hat = material("hat", 0xF4D6A0)
    objs += list(tops(hair, hat).values())
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
        export_yup=True,
    )


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    rig, rider = build_rider()
    export(os.path.join(OUT, "rider.glb"), [rig, rider])
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    export(os.path.join(OUT, "villager.glb"), build_villagers())
    print("wrote", OUT)


if __name__ == "__main__":
    main()
