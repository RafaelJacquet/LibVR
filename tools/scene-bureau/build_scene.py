"""
Décor « Bureau loft » — construit entièrement par script dans Blender, éclairage précalculé
(lightmap Cycles) puis export .glb optimisé pour le Quest.

Lancement (depuis WSL) : voir tools/scene-bureau/build.sh
    blender -b --factory-startup -P build_scene.py -- <assets> <sortie> <quick|final>

Conventions d'export lues par l'appli (src/world/Environment.js) :
  - matériaux « LM_* »    : couleur de base (texture ou unie) + lightmap dans le canal émissif (UV 2)
  - matériaux « VC_* »    : couleur de base + éclairage précalculé par sommet (COLOR_0), pour les plantes
  - suffixe « _MASK »     : transparence découpée (feuillages)
  - matériaux « GLASS_* » : vitrage transparent
  - matériaux « UNLIT_* » : non éclairés (ciel, voilages, anneau lumineux)
  - objet vide « Spawn »  : point d'apparition du joueur
  - extras de scène       : lightmapIntensity
"""
import bpy, bmesh, math, os, sys, time, random
from mathutils import Vector, Matrix, Euler
import numpy as np

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ASSETS = ARGS[0] if len(ARGS) > 0 else os.path.join(os.path.dirname(__file__), 'assets')
OUT = ARGS[1] if len(ARGS) > 1 else os.path.join(os.path.dirname(__file__), 'out')
MODE = ARGS[2] if len(ARGS) > 2 else 'quick'
# Variante « nofurn » : bâtiment identique, plans de bureau nus + le buffet
# (ni chaises, ni écrans, ni claviers/souris, ni canapé, ni plantes).
VARIANT = ARGS[3] if len(ARGS) > 3 else ''
# Objets placés dans l'éditeur de maps Moda (export « <map>-map.glb ») : ils sont importés
# et précalculés avec le décor (ombres portées dans la lightmap, éclairage par sommet sur eux).
PROPS_GLB = ARGS[4] if len(ARGS) > 4 else ''
MAP_NODE = None
if PROPS_GLB:
    import json, struct
    with open(PROPS_GLB, 'rb') as f:
        head = f.read(20)
        js = json.loads(f.read(struct.unpack('<I', head[12:16])[0]))
    MAP_NODE = next(n['name'] for n in js['nodes'] if n.get('name', '').startswith('map_'))
    VARIANT = 'nofurn' if MAP_NODE.endswith('_nofurn') else ''  # la map d'origine dicte la variante
NOFURN = VARIANT == 'nofurn'
NAME = 'bureau_nofurn' if NOFURN else 'bureau'
if PROPS_GLB:
    NAME = os.path.splitext(os.path.basename(PROPS_GLB))[0] + '_rendu'
QUICK = MODE == 'quick'
LM_SIZE = 1024 if QUICK else 4096
SAMPLES = 64 if QUICK else 256   # le débruiteur OIDN fait le reste
os.makedirs(os.path.join(OUT, 'textures'), exist_ok=True)
random.seed(7)


def log(*a):
    print(f'[{time.time() - T0:7.1f}s]', *a, flush=True)


# ============================================================================ scène vierge
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'

# ============================================================================ dimensions
X0, X1 = -6.5, 9.5      # murs ouest / est (verrières à l'est)
Y0, Y1 = -5.0, 13.0     # murs sud / nord (verrières au nord-est)
H = 4.2                  # hauteur sous plafond
SILL, HEAD = 0.45, 3.75  # allège et linteau des verrières
BEAMS_Y = [-1.4, 2.2, 5.8, 9.4]
SPAWN = (0.6, -1.6)
EYE = 1.65

# ============================================================================ textures
def tex_path(name):
    return os.path.join(ASSETS, 'textures', name)


def save_image(img, path, quality=90):
    img.filepath_raw = path
    img.file_format = 'JPEG'
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()


def tinted_texture(src, dst_name, mul=(1, 1, 1), add=(0, 0, 0), contrast=1.0, size=None):
    """Copie ajustée d'une texture (valeurs sRGB) sauvegardée en JPG pour l'export."""
    img = bpy.data.images.load(src)
    if size and (img.size[0] != size):
        img.scale(size, size)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    mean = rgb.mean(axis=0, keepdims=True)
    rgb = (rgb - mean) * contrast + mean
    rgb = rgb * np.array(mul, dtype=np.float32) + np.array(add, dtype=np.float32)
    px[:, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(OUT, 'textures', dst_name)
    save_image(img, path, 90)
    bpy.data.images.remove(img)
    out = bpy.data.images.load(path)
    out.colorspace_settings.name = 'sRGB'
    return out


# ============================================================================ matériaux
MATS = {}


def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m


def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def mat_color(name, rgb, rough=0.6, metal=0.0):
    m = new_mat(name)
    b = principled(m)
    b.inputs['Base Color'].default_value = (*srgb_to_lin(rgb), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    MATS[name] = m
    return m


def mat_image(name, image, rough=0.6):
    m = new_mat(name)
    nt = m.node_tree
    b = principled(m)
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = image
    t.location = (-400, 200)
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    uv.location = (-600, 200)
    nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = rough
    MATS[name] = m
    return m


def srgb_to_lin(c):
    def f(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    if isinstance(c, str):
        c = tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return tuple(f(v) for v in c)


log('Textures')
def tile_floor(src, dst_name, tiles=3, tile_m=0.8, color=(0.70, 0.685, 0.66), size=2048):
    """Grandes dalles grises (0,8 m) façon pierre reconstituée : marbrure du béton,
    légère variation de teinte par dalle et joints fins."""
    img = bpy.data.images.load(src)
    if img.size[0] != size:
        img.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    lum = px[..., :3].mean(-1)
    lum = (lum - lum.mean()) / (lum.std() + 1e-6)
    rgb = np.array(color, np.float32)[None, None, :] * (1 + 0.07 * lum[..., None])
    rng = np.random.default_rng(3)
    step = size // tiles
    for i in range(tiles):
        for j in range(tiles):
            rgb[i * step:(i + 1) * step, j * step:(j + 1) * step] *= 1 + rng.uniform(-0.035, 0.035)
    g = max(3, size // 640)  # joint ~3 mm
    for k in range(tiles):
        a = k * step
        sl = slice(a, a + g)
        rgb[sl, :] *= 0.6
        rgb[:, sl] *= 0.6
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(OUT, 'textures', dst_name)
    save_image(img, path, 90)
    bpy.data.images.remove(img)
    out = bpy.data.images.load(path)
    return out


IMG_FLOOR = tile_floor(tex_path('smooth_concrete_floor_diff_2k.jpg'), 'floor.jpg')
IMG_OAK = tinted_texture(tex_path('oak_veneer_01_diff_2k.jpg'), 'oak.jpg', mul=(1.0, 0.97, 0.93), contrast=1.05)
IMG_PLASTER = tinted_texture(tex_path('white_plaster_02_diff_1k.jpg'), 'plaster.jpg', mul=(0.25, 0.25, 0.25), add=(0.68, 0.67, 0.65), contrast=0.5)
IMG_FABRIC = tinted_texture(tex_path('poly_wool_herringbone_diff_1k.jpg'), 'fabric.jpg', mul=(0.55, 0.56, 0.58), add=(0.17, 0.17, 0.175), contrast=0.7, size=512)

mat_image('LM_Floor', IMG_FLOOR, 0.55)
mat_image('LM_Oak', IMG_OAK, 0.45)
mat_image('LM_Plaster', IMG_PLASTER, 0.9)
mat_image('LM_Fabric', IMG_FABRIC, 0.95)
IMG_LINEN = tinted_texture(tex_path('poly_wool_herringbone_diff_1k.jpg'), 'linen.jpg', mul=(0.35, 0.34, 0.33), add=(0.55, 0.52, 0.48), contrast=0.22, size=512)
mat_image('LM_Linen', IMG_LINEN, 0.95)
mat_color('LM_Frame', '#F0EEEA', 0.5)          # menuiseries des verrières
mat_color('LM_Black', '#1C1C1E', 0.4, 0.3)     # rails, spots, câbles
mat_color('LM_Alu', '#C7C9CC', 0.35, 0.6)      # écrans (dos), pieds
mat_color('LM_Chrome', '#9A9DA1', 0.3, 0.8)    # piétements de chaises
mat_color('LM_Screen', '#0E0F11', 0.15)        # dalles d'écran
mat_color('LM_Ceramic', '#EEECE7', 0.4)        # pots blancs
mat_color('LM_Rug', '#CFC7B8', 0.95)           # tapis
mat_color('LM_Keys', '#E9E9EA', 0.5)           # claviers

# Vitrages (transparents en rendu ET pour le précalcul)
for nm, alpha in (('GLASS_Window', 0.05), ('GLASS_Room', 0.07)):
    m = new_mat(nm)
    nt = m.node_tree
    nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (0.9, 0.93, 0.95, 1)
    b.inputs['Alpha'].default_value = alpha
    b.inputs['Roughness'].default_value = 0.05
    nt.links.new(b.outputs[0], o.inputs[0])
    MATS[nm] = m

# Voilages : diffusent la lumière (translucide) et en laissent passer une partie
m = new_mat('UNLIT_Curtain')
nt = m.node_tree
nt.nodes.clear()
o = nt.nodes.new('ShaderNodeOutputMaterial')
b = nt.nodes.new('ShaderNodeBsdfPrincipled')
b.inputs['Base Color'].default_value = (0.97, 0.96, 0.94, 1)
b.inputs['Alpha'].default_value = 0.42
try:
    b.inputs['Subsurface Weight'].default_value = 0.0
    b.inputs['Transmission Weight'].default_value = 0.0
except KeyError:
    pass
nt.links.new(b.outputs[0], o.inputs[0])
MATS['UNLIT_Curtain'] = m

# Anneau lumineux (suspension de la salle de réunion)
m = new_mat('UNLIT_RingLight')
nt = m.node_tree
nt.nodes.clear()
o = nt.nodes.new('ShaderNodeOutputMaterial')
e = nt.nodes.new('ShaderNodeEmission')
e.inputs['Color'].default_value = (1.0, 0.93, 0.84, 1)
e.inputs['Strength'].default_value = 12.0
nt.links.new(e.outputs[0], o.inputs[0])
MATS['UNLIT_RingLight'] = m

# ============================================================================ géométrie
PARTS = {}  # matériau -> liste d'objets (fusionnés à la fin)
COLL = bpy.data.collections.new('Bureau')
scene.collection.children.link(COLL)


def obj_from_bm(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    me.materials.append(MATS[mat])
    PARTS.setdefault(mat, []).append(ob)
    return ob


def box(name, mat, size, loc, rot_z=0.0, bevel=0.0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES', profile=0.5)
    m = Matrix.Translation(Vector(loc)) @ (Euler(rot).to_matrix().to_4x4() if rot else Matrix.Rotation(rot_z, 4, 'Z'))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return obj_from_bm(bm, name, mat)


def cyl(name, mat, r, depth, loc, axis='Z', seg=24, r2=None, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    R = Matrix.Identity(4)
    if axis == 'X':
        R = Matrix.Rotation(math.pi / 2, 4, 'Y')
    elif axis == 'Y':
        R = Matrix.Rotation(math.pi / 2, 4, 'X')
    if rot:
        R = Euler(rot).to_matrix().to_4x4() @ R
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(loc)) @ R, verts=bm.verts)
    return obj_from_bm(bm, name, mat)


def segment(name, mat, a, b, r, seg=8, r2=None):
    """Cylindre (ou cône si r2) entre deux points : câbles, tiges, branches de piétement."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return obj_from_bm(bm, name, mat)


def soften(ob, levels=2):
    """Subdivision lissée appliquée : arêtes arrondies façon rembourrage."""
    md = ob.modifiers.new('Lissage', 'SUBSURF')
    md.levels = md.render_levels = levels
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=md.name)
    return ob


def curved(name, mat, w, h, t, bend, loc, tilt=0.0):
    """Panneau galbé (dossier) : bords latéraux ramenés vers l'avant (+Y)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((w, t, h)), verts=bm.verts)
    xedges = [e for e in bm.edges if abs(e.verts[0].co.x - e.verts[1].co.x) > 1e-6]
    bmesh.ops.subdivide_edges(bm, edges=xedges, cuts=4, use_grid_fill=True)
    for v in bm.verts:
        v.co.y += (v.co.x ** 2) / (2 * bend)
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(tilt, 4, 'X')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return obj_from_bm(bm, name, mat)


def plane(name, mat, corners):
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    bm.faces.new(vs)
    return obj_from_bm(bm, name, mat)


# ---------------------------------------------------------------- coque du bâtiment
log('Bâtiment')
T = 0.3  # épaisseur des murs
plane('Sol', 'LM_Floor', [(X0, Y0, 0), (X1, Y0, 0), (X1, Y1, 0), (X0, Y1, 0)])
plane('Plafond', 'LM_Plaster', [(X0, Y0, H), (X0, Y1, H), (X1, Y1, H), (X1, Y0, H)])
box('MurSud', 'LM_Plaster', (X1 - X0, T, H), ((X0 + X1) / 2, Y0 - T / 2, H / 2))

# Verrières : mur est (x = X1) en travées entre piliers, et partie est du mur nord.
GLASS_BAYS = []  # (centre, largeur, normale intérieure, axe)


def window_wall(axis, fixed, piers, pier_w=0.4):
    """axis = 'Y' : mur le long de Y à x = fixed ; 'X' : mur le long de X à y = fixed."""
    inward = -1 if (axis == 'Y' and fixed == X1) or (axis == 'X' and fixed == Y1) else 1
    lo, hi = piers[0], piers[-1]

    def put(name, mat, length_along, a0, z0, z1, depth=T, off=0.0):
        c = (a0 + length_along / 2)
        sz = (depth, length_along, z1 - z0) if axis == 'Y' else (length_along, depth, z1 - z0)
        pos = (fixed - inward * (depth / 2 + off), c, (z0 + z1) / 2) if axis == 'Y' else (c, fixed - inward * (depth / 2 + off), (z0 + z1) / 2)
        return box(name, mat, sz, pos)

    put('Allege', 'LM_Plaster', hi - lo, lo, 0, SILL)
    put('Linteau', 'LM_Plaster', hi - lo, lo, HEAD, H)
    for i, p in enumerate(piers):
        a0 = p - pier_w / 2
        put(f'Pilier{i}', 'LM_Plaster', pier_w, max(a0, lo - T if i == 0 else a0), 0, H, depth=T + 0.12)
    # menuiseries
    fw, fd = 0.07, 0.11
    for i in range(len(piers) - 1):
        a0, a1 = piers[i] + pier_w / 2, piers[i + 1] - pier_w / 2
        L = a1 - a0
        put('CadreBas', 'LM_Frame', L, a0, SILL, SILL + fw, depth=fd, off=0.08)
        put('CadreHaut', 'LM_Frame', L, a0, HEAD - fw, HEAD, depth=fd, off=0.08)
        put('CadreG', 'LM_Frame', fw, a0, SILL, HEAD, depth=fd, off=0.08)
        put('CadreD', 'LM_Frame', fw, a1 - fw, SILL, HEAD, depth=fd, off=0.08)
        n = 3
        for k in range(1, n):
            put('Meneau', 'LM_Frame', 0.05, a0 + L * k / n - 0.025, SILL, HEAD, depth=0.08, off=0.095)
        for z in (1.45, 2.65):
            put('Traverse', 'LM_Frame', L, a0, z - 0.025, z + 0.025, depth=0.08, off=0.095)
        # vitre
        put('Vitre', 'GLASS_Window', L, a0, SILL, HEAD, depth=0.012, off=0.13)
        GLASS_BAYS.append((axis, fixed, inward, a0, a1))


window_wall('Y', X1, [-5.0, -1.4, 2.2, 5.8, 9.4, 13.0])
window_wall('Y', X0, [-5.0, -1.4, 2.2, 5.8, 9.4, 13.0])
window_wall('X', Y1, [1.5, 5.5, 9.5])
box('MurNord', 'LM_Plaster', (1.5 - X0 + T, T, H), ((X0 - T + 1.5) / 2, Y1 + T / 2, H / 2))

# Plafond : poutres, radeaux acoustiques, gaines rondes
for y in BEAMS_Y:
    box('Poutre', 'LM_Plaster', (X1 - X0, 0.4, 0.45), ((X0 + X1) / 2, y, H - 0.225))
for (xa, xb, ya, yb) in [(1.4, 8.4, -1.0, 1.8), (1.4, 8.4, 2.6, 5.4), (1.4, 8.4, 6.2, 9.0), (-5.8, -1.2, -4.4, -1.8)]:
    box('Radeau', 'LM_Plaster', (xb - xa, yb - ya, 0.05), ((xa + xb) / 2, (ya + yb) / 2, H - 0.16))
for x in (-3.4, 5.0):
    cyl('Gaine', 'LM_Plaster', 0.24, Y1 - Y0, (x, (Y0 + Y1) / 2, 3.47), axis='Y', seg=32)
    for y in (-3.2, 0.4, 4.0, 7.6, 11.2):  # colliers
        cyl('Collier', 'LM_Plaster', 0.252, 0.05, (x, y, 3.47), axis='Y', seg=32)
cyl('GaineTransversale', 'LM_Plaster', 0.18, 8.4, (0.8, 11.2, 3.47), axis='X', seg=24)

# ---------------------------------------------------------------- salle de réunion vitrée
log('Salle vitrée')
RX0, RX1, RY0, RY1 = X0, -0.6, 5.0, Y1
RAIL_Z = [(0.0, 0.08), (1.02, 1.08), (2.47, 2.53), (3.36, 3.44)]
POST = 0.075


def glass_side(axis, fixed, a0, a1, bays, door_bay=None):
    step = (a1 - a0) / bays
    for i in range(bays + 1):
        a = a0 + i * step
        if axis == 'X':
            box('Montant', 'LM_Oak', (POST, POST, 3.44), (a, fixed, 1.72))
        else:
            box('Montant', 'LM_Oak', (POST, POST, 3.44), (fixed, a, 1.72))
    for i in range(bays):
        b0, b1 = a0 + i * step + POST / 2, a0 + (i + 1) * step - POST / 2
        L, c = b1 - b0, (b0 + b1) / 2
        is_door = i == door_bay
        for (z0, z1) in RAIL_Z:
            if is_door and z1 < 2.4:
                continue
            sz = (L, POST * 0.9, z1 - z0) if axis == 'X' else (POST * 0.9, L, z1 - z0)
            pos = (c, fixed, (z0 + z1) / 2) if axis == 'X' else (fixed, c, (z0 + z1) / 2)
            box('Traverse', 'LM_Oak', sz, pos)
        if not is_door:
            sz = (L, 0.01, 3.36 - 0.08) if axis == 'X' else (0.01, L, 3.36 - 0.08)
            pos = (c, fixed, 1.72) if axis == 'X' else (fixed, c, 1.72)
            box('VitreSalle', 'GLASS_Room', sz, pos)
    # retombée blanche au-dessus du vitrage
    sz = (a1 - a0 + 0.12, 0.12, H - 3.44) if axis == 'X' else (0.12, a1 - a0, H - 3.44)
    pos = ((a0 + a1) / 2, fixed, (3.44 + H) / 2) if axis == 'X' else (fixed, (a0 + a1) / 2, (3.44 + H) / 2)
    box('Retombee', 'LM_Plaster', sz, pos)


glass_side('X', RY0, RX0, RX1, 4)
glass_side('Y', RX1, RY0, RY1, 5, door_bay=0)

# ---------------------------------------------------------------- mobilier
log('Mobilier')


def chair(x, y, facing, name='Chaise'):
    """Chaise de bureau ergonomique : assise et dossier rembourrés (dossier galbé),
    coque plastique, mécanisme, vérin avec cache, piétement alu effilé à roulettes doubles,
    accoudoirs en T. La chaise « regarde » vers +Y avant rotation."""
    R = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(facing, 4, 'Z')

    def put(ob):
        ob.data.transform(R)
        return ob

    # assise rembourrée, légèrement inclinée vers l'arrière
    put(soften(box(name + 'Assise', 'LM_Fabric', (0.5, 0.48, 0.075), (0, 0.01, 0.478), bevel=0.024, rot=(math.radians(-3), 0, 0)), 1))
    put(box(name + 'CoqueAssise', 'LM_Black', (0.46, 0.43, 0.018), (0, 0.01, 0.432), bevel=0.007))
    put(box(name + 'Mecanisme', 'LM_Black', (0.2, 0.22, 0.05), (0, -0.01, 0.398), bevel=0.01))
    # vérin chromé + cache conique
    put(cyl(name + 'Verin', 'LM_Chrome', 0.021, 0.14, (0, 0, 0.32), seg=16))
    put(cyl(name + 'CacheVerin', 'LM_Black', 0.034, 0.15, (0, 0, 0.18), seg=20, r2=0.029))
    # piétement 5 branches en aluminium poli, effilées et légèrement plongeantes
    put(cyl(name + 'Moyeu', 'LM_Chrome', 0.052, 0.05, (0, 0, 0.105), seg=24, r2=0.042))
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3
        c, sn = math.cos(a), math.sin(a)
        put(segment(name + 'Branche', 'LM_Chrome', (c * 0.04, sn * 0.04, 0.105), (c * 0.31, sn * 0.31, 0.072), 0.02, seg=10, r2=0.012))
        tx, ty = c * 0.31, sn * 0.31
        put(box(name + 'Fourche', 'LM_Black', (0.03, 0.036, 0.03), (tx, ty, 0.054), rot_z=a, bevel=0.006))
        for side in (-1, 1):  # roulette double
            off = 0.011 * side
            put(cyl(name + 'Roue', 'LM_Black', 0.024, 0.011, (tx - sn * off, ty + c * off, 0.025), axis='X', seg=10, rot=(0, 0, a + math.pi / 2)))
    # dossier galbé rembourré + coque arrière, incliné vers l'arrière
    put(soften(curved(name + 'Dossier', 'LM_Fabric', 0.47, 0.52, 0.065, 0.55, (0, -0.255, 0.865), tilt=math.radians(10)), 1))
    put(soften(curved(name + 'DosCoque', 'LM_Black', 0.44, 0.48, 0.016, 0.55, (0, -0.296, 0.86), tilt=math.radians(10)), 1))
    # lame de liaison assise -> dossier
    put(segment(name + 'Lame', 'LM_Black', (0, -0.07, 0.4), (0, -0.27, 0.43), 0.02, seg=10))
    put(segment(name + 'Lame2', 'LM_Black', (0, -0.27, 0.43), (0, -0.315, 0.66), 0.02, seg=10))
    # accoudoirs en T
    for sd in (-1, 1):
        put(box(name + 'BrasSupport', 'LM_Black', (0.15, 0.035, 0.018), (sd * 0.185, -0.02, 0.41)))
        put(box(name + 'BrasMontant', 'LM_Black', (0.032, 0.04, 0.25), (sd * 0.278, -0.02, 0.535), bevel=0.008))
        put(soften(box(name + 'BrasAppui', 'LM_Black', (0.075, 0.25, 0.03), (sd * 0.278, 0.0, 0.672), bevel=0.012), 1))


def monitor(x, y, facing):
    """Écran tout-en-un type « iMac » : dalle noire, menton alu, pied incliné."""
    R = Matrix.Translation((x, y, 0.75)) @ Matrix.Rotation(facing, 4, 'Z')

    def put(ob):
        ob.data.transform(R)
        return ob

    put(box('EcranCoque', 'LM_Alu', (0.6, 0.014, 0.46), (0, -0.007, 0.39), bevel=0.006))
    put(box('EcranDalle', 'LM_Screen', (0.57, 0.004, 0.34), (0, 0.002, 0.44)))
    put(box('EcranPied', 'LM_Alu', (0.17, 0.012, 0.3), (0, -0.07, 0.15), rot=(math.radians(18), 0, 0)))
    put(box('EcranSocle', 'LM_Alu', (0.17, 0.16, 0.008), (0, -0.07, 0.004)))
    put(box('Clavier', 'LM_Keys', (0.29, 0.11, 0.008), (0.02, 0.24, 0.004), bevel=0.003))
    put(box('Souris', 'LM_Keys', (0.06, 0.1, 0.018), (0.25, 0.24, 0.009), bevel=0.008))


def bench(cx, cy, length=6.0, depth=1.6):
    th = 0.06
    box('PlateauBureau', 'LM_Oak', (length, depth, th), (cx, cy, 0.75 - th / 2), bevel=0.004)
    for s in (-1, 1):
        box('PiedBureau', 'LM_Oak', (th, depth, 0.75 - th), (cx + s * (length / 2 - th / 2), cy, (0.75 - th) / 2), bevel=0.004)
    box('VoileFond', 'LM_Oak', (length - 2 * th, 0.03, 0.42), (cx, cy, 0.48))
    for i, dx in enumerate((-2.0, 0.0, 2.0)):
        if NOFURN:
            break
        for side in (-1, 1):
            facing = 0 if side > 0 else math.pi  # l'écran regarde vers l'utilisateur
            monitor(cx + dx, cy + side * 0.3, facing)
            # chaises : légèrement désalignées pour un rendu naturel
            j = random.uniform(-0.12, 0.12)
            pull = random.uniform(0.0, 0.25)
            chair(cx + dx + j, cy + side * (depth / 2 + 0.38 + pull), facing + math.pi + random.uniform(-0.25, 0.25))


bench(4.9, 2.6)
bench(4.9, 7.6)

# Table de réunion + chaises + écran mural + suspension annulaire
TX, TY = -3.55, 9.0
if not NOFURN:
    box('TableReunion', 'LM_Oak', (1.15, 3.0, 0.06), (TX, TY, 0.72), bevel=0.004)
    for s in (-1, 1):
        box('PiedTable', 'LM_Oak', (0.7, 0.06, 0.69), (TX, TY + s * 1.0, 0.345))
    for s in (-1, 1):
        for k in (-1, 0, 1):
            chair(TX + s * 0.95, TY + k * 0.95, (-math.pi / 2 if s < 0 else math.pi / 2) + random.uniform(-0.15, 0.15))
    box('EcranMural', 'LM_Black', (1.68, 0.04, 0.98), (TX, Y1 - 0.04, 1.5))
    box('EcranMuralDalle', 'LM_Screen', (1.62, 0.006, 0.92), (TX, Y1 - 0.063, 1.5))
bpy.ops.mesh.primitive_torus_add(major_radius=0.55, minor_radius=0.03, major_segments=64, minor_segments=10, location=(TX, TY, 2.55))
ring = bpy.context.active_object
ring.name = 'Suspension'
for c in ring.users_collection:
    c.objects.unlink(ring)
COLL.objects.link(ring)
ring.data.materials.append(MATS['LM_Black'])
PARTS.setdefault('LM_Black', []).append(ring)
bpy.ops.mesh.primitive_torus_add(major_radius=0.55, minor_radius=0.014, major_segments=64, minor_segments=8, location=(TX, TY, 2.522))
glow = bpy.context.active_object
glow.name = 'SuspensionLumiere'
for c in glow.users_collection:
    c.objects.unlink(glow)
COLL.objects.link(glow)
glow.data.materials.append(MATS['UNLIT_RingLight'])
PARTS.setdefault('UNLIT_RingLight', []).append(glow)
for k in range(3):
    a = k * 2 * math.pi / 3
    segment('CableSuspension', 'LM_Black', (TX + math.cos(a) * 0.55, TY + math.sin(a) * 0.55, 2.57), (TX + math.cos(a) * 0.2, TY + math.sin(a) * 0.2, H), 0.003)

# Coin salon derrière le joueur : canapé, table basse, tapis
SX, SY = 3.6, -4.2
AW, IW, SD = 0.17, 1.86, 0.92   # largeur d'accoudoir, largeur intérieure, profondeur
if not NOFURN:
    for dx in (-1, 1):
        for dy in (-1, 1):
            cyl('CanapePied', 'LM_Black', 0.022, 0.07, (SX + dx * (IW / 2 + AW - 0.07), SY + dy * (SD / 2 - 0.07), 0.035), seg=12)
    box('CanapeSocle', 'LM_Linen', (IW, SD, 0.16), (SX, SY, 0.15), bevel=0.02)                      # z 0,07 → 0,23
    for sd in (-1, 1):
        soften(box('CanapeBras', 'LM_Linen', (AW, SD, 0.56), (SX + sd * (IW / 2 + AW / 2 + 0.002), SY, 0.35), bevel=0.05), 1)
    box('CanapeDosStructure', 'LM_Linen', (IW, 0.16, 0.5), (SX, SY - SD / 2 + 0.08, 0.48), bevel=0.02)  # z 0,23 → 0,73
    for k in (-1, 1):
        soften(box('CanapeAssise', 'LM_Linen', (IW / 2 - 0.012, SD - 0.18, 0.17), (SX + k * IW / 4, SY + 0.085, 0.317), bevel=0.05))
        soften(box('CanapeDosCoussin', 'LM_Linen', (IW / 2 - 0.012, 0.17, 0.42), (SX + k * IW / 4, SY - SD / 2 + 0.255, 0.615), bevel=0.06, rot=(math.radians(8), 0, 0)))
    cyl('TableBasse', 'LM_Oak', 0.48, 0.05, (SX, SY + 1.15, 0.4), seg=48)
    cyl('TableBassePied', 'LM_Black', 0.05, 0.38, (SX, SY + 1.15, 0.19), seg=16)
    cyl('TableBasseSocle', 'LM_Black', 0.22, 0.02, (SX, SY + 1.15, 0.01), seg=32)
    box('Tapis', 'LM_Rug', (3.0, 2.2, 0.008), (SX, SY + 0.7, 0.004), bevel=0.003)

# Buffet en chêne contre le mur ouest
BUF_X = -3.0
box('Buffet', 'LM_Oak', (2.6, 0.48, 0.7), (BUF_X, Y0 + 0.26, 0.39), bevel=0.004)
box('BuffetSocle', 'LM_Black', (2.5, 0.4, 0.04), (BUF_X, Y0 + 0.26, 0.02))

# Rail de spots noir suspendu au-dessus des bureaux
log('Éclairage')
RZ = 3.22
rx0, rx1, ry0, ry1 = 1.5, 8.3, 1.2, 9.0
for (a, b) in [((rx0, ry0, RZ), (rx1, ry0, RZ)), ((rx1, ry0, RZ), (rx1, ry1, RZ)), ((rx1, ry1, RZ), (rx0, ry1, RZ)), ((rx0, ry1, RZ), (rx0, ry0, RZ))]:
    A, B = Vector(a), Vector(b)
    c = (A + B) / 2
    L = (B - A).length + 0.04
    box('Rail', 'LM_Black', (L, 0.04, 0.04) if A.y == B.y else (0.04, L, 0.04), c)
for (x, y) in [(rx0, ry0), (rx1, ry0), (rx1, ry1), (rx0, ry1), ((rx0 + rx1) / 2, ry0), ((rx0 + rx1) / 2, ry1)]:
    segment('CableRail', 'LM_Black', (x, y, RZ), (x, y, H - 0.45 if any(abs(y - b) < 0.3 for b in BEAMS_Y) else H), 0.0025)

SPOTS = []
for y_rail, aim_y in ((ry0, 2.6), (ry1, 7.6)):
    for x in np.linspace(rx0 + 0.6, rx1 - 0.6, 5):
        SPOTS.append(((x, y_rail, RZ), (x + random.uniform(-0.3, 0.3), aim_y, 0.75)))
for x_rail in (rx0, rx1):
    for y in (3.6, 5.1, 6.6):
        SPOTS.append(((x_rail, y, RZ), (4.9 + (x_rail - 4.9) * 0.4, y, 0.6)))

for i, (p, aim) in enumerate(SPOTS):
    p, aim = Vector(p), Vector(aim)
    d = (aim - p).normalized()
    body = p + Vector((0, 0, -0.09)) + d * 0.06
    segment('SpotTige', 'LM_Black', p, p + Vector((0, 0, -0.08)), 0.008)
    segment('SpotCorps', 'LM_Black', body - d * 0.07, body + d * 0.07, 0.036, seg=16)
    # lumière réelle (sert uniquement au précalcul)
    ld = bpy.data.lights.new(f'Spot{i}', 'SPOT')
    ld.energy = 45
    ld.color = (1.0, 0.9, 0.8)
    ld.spot_size = math.radians(52)
    ld.spot_blend = 0.7
    ld.shadow_soft_size = 0.03
    lo = bpy.data.objects.new(f'Spot{i}', ld)
    lo.location = body + d * 0.08
    lo.rotation_euler = Vector((0, 0, -1)).rotation_difference(d).to_euler()
    scene.collection.objects.link(lo)

# Lumière douce sous l'anneau de la salle (aide le précalcul à converger)
ld = bpy.data.lights.new('AnneauFill', 'AREA')
ld.shape = 'DISK'
ld.size = 1.0
ld.energy = 90
ld.color = (1.0, 0.92, 0.82)
lo = bpy.data.objects.new('AnneauFill', ld)
lo.location = (TX, TY, 2.5)
scene.collection.objects.link(lo)

# ---------------------------------------------------------------- voilages
log('Voilages')


def curtain(axis, fixed, inward, a_center, width, waves=7):
    bm = bmesh.new()
    nu, nv = 48, 2
    verts = []
    for j in range(nv + 1):
        row = []
        z = 0.02 + (HEAD - 0.06) * j / nv
        for i in range(nu + 1):
            t = i / nu
            a = a_center - width / 2 + width * t
            off = 0.2 + 0.045 * math.sin(t * waves * 2 * math.pi)
            co = (fixed + inward * off, a, z) if axis == 'Y' else (a, fixed + inward * off, z)
            row.append(bm.verts.new(co))
        verts.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    return obj_from_bm(bm, 'Voilage', 'UNLIT_Curtain')


for i, (axis, fixed, inward, a0, a1) in enumerate(GLASS_BAYS):
    if axis == 'X' or i % 2 == 0:
        # voilages rassemblés de part et d'autre de la travée
        curtain(axis, fixed, inward, a0 + 0.35, 0.8)
        curtain(axis, fixed, inward, a1 - 0.35, 0.8)
    elif fixed == X1 and 2 < a0 < 3:
        curtain(axis, fixed, inward, (a0 + a1) / 2, 2.6, waves=16)  # une travée entièrement voilée

# ---------------------------------------------------------------- plantes (Poly Haven, CC0)
log('Plantes')


def import_model(mid, target_h, loc, rot_z=0.0, decimate=None, white_pot=False):
    path = os.path.join(ASSETS, 'models', mid, f'{mid}_1k.gltf')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    # boîte englobante
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    zmin = min(p.z for p in pts)
    zmax = max(p.z for p in pts)
    k = target_h / (zmax - zmin)
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)
    M = Matrix.Translation(loc) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Scale(k, 4) @ Matrix.Translation((-cx, -cy, -zmin))
    out = []
    for o in meshes:
        o.data.transform(M @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.parent = None
        for c in o.users_collection:
            c.objects.unlink(o)
        COLL.objects.link(o)
        is_pot = o.name.split('.')[0].endswith('_pot')
        if decimate:
            md = o.modifiers.new('Dec', 'DECIMATE')
            if is_pot:  # formes lisses : on retire des subdivisions plutôt que de « froisser »
                md.decimate_type = 'UNSUBDIV'
                md.iterations = 2
            else:
                nm = o.name.split('.')[0]
                # terre et cailloux : presque invisibles dans le pot → très simplifiés
                md.ratio = 0.04 if nm.endswith(('_dirt', '_pebbles')) else decimate
            bpy.context.view_layer.objects.active = o
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=md.name)
        for i, m in enumerate(o.data.materials):
            if m is None:
                continue
            base = m.get('orig_base') or m.name.split('.')[0].replace(mid, '').strip('_') or 'main'
            m['orig_base'] = base
            if white_pot and base == 'pot' and o.name.split('.')[0].endswith('_pot'):
                o.data.materials[i] = vc_ceramic()
                continue
            key = (mid, base)
            if key in IMPORTED:
                o.data.materials[i] = IMPORTED[key]
            else:
                prepare_imported_material(m, mid, base)
                IMPORTED[key] = m
        log(f'      {o.name:34s} {sum(len(p.vertices) - 2 for p in o.data.polygons):>7,} tri')
        PLANTS.append(o)
        out.append(o)
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    return out


IMPORTED = {}
PLANTS = []


def vc_ceramic():
    if 'VC_Ceramic' not in MATS:
        m = MATS['LM_Ceramic'].copy()
        m.name = 'VC_Ceramic'
        MATS['VC_Ceramic'] = m
    return MATS['VC_Ceramic']


def prepare_imported_material(m, mid, base):
    """Renomme LM_*, branche le masque alpha des feuilles si fourni séparément."""
    tex_dir = os.path.join(ASSETS, 'models', mid, 'textures')
    alphas = [f for f in os.listdir(tex_dir) if '_alpha_' in f]
    alpha_file = next((f for f in alphas if f'_{base}_alpha' in f), None)
    if alpha_file is None and len(alphas) == 1 and base not in ('pot', 'bark'):
        alpha_file = alphas[0]
    nt = m.node_tree
    b = principled(m)
    masked = False
    if alpha_file:
        img = bpy.data.images.load(os.path.join(tex_dir, alpha_file))
        img.colorspace_settings.name = 'Non-Color'
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        base_tex = next((l.from_node for l in nt.links if l.to_socket == b.inputs['Base Color']), None)
        if base_tex is not None and base_tex.inputs.get('Vector') and base_tex.inputs['Vector'].links:
            nt.links.new(base_tex.inputs['Vector'].links[0].from_socket, t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], b.inputs['Alpha'])
        masked = True
    m.name = f'VC_{mid}_{base}' + ('_MASK' if masked else '')


if not NOFURN:
    import_model('potted_plant_02', 1.45, Vector((-0.2, 4.45, 0)), 0.6, decimate=0.7, white_pot=True)
    import_model('potted_plant_02', 1.25, Vector((X0 + 0.45, 3.6, 0)), 2.1, decimate=0.7, white_pot=True)
    import_model('pachira_aquatica_01', 1.95, Vector((X1 - 0.75, Y0 + 0.75, 0.38)), 0.4, decimate=0.3)
    cyl('PotPachira', 'LM_Ceramic', 0.3, 0.42, (X1 - 0.75, Y0 + 0.75, 0.21), seg=40, r2=0.34)
    # plantes en pot complètes (le modèle « calathea » est un couvre-sol sans pot : retiré)
    import_model('potted_plant_01', 1.1, Vector((X1 - 0.7, Y1 - 0.7, 0)), 1.1, decimate=0.12, white_pot=True)
    import_model('potted_plant_01', 0.95, Vector((X0 + 0.55, Y0 + 0.6, 0)), 2.5, decimate=0.12, white_pot=True)
    import_model('ceramic_vase_02', 0.42, Vector((BUF_X - 0.8, Y0 + 0.28, 0.74)), 0.0, decimate=0.25)
    import_model('potted_plant_02', 0.5, Vector((BUF_X + 0.75, Y0 + 0.28, 0.74)), 0.4, decimate=0.5, white_pot=True)

# ---------------------------------------------------------------- objets placés (Moda)
PROPS_OBJ = None
PROPS_GLASS = None
PROPS_BASE = {}  # index de matériau -> couleur de base (linéaire)
PROPS_FLAT = {}  # index de matériau -> couleur affichée telle quelle (écrans, LED)


def is_glass(m):
    if m is None or not m.use_nodes:
        return False
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        return False
    tw = b.inputs.get('Transmission Weight') or b.inputs.get('Transmission')
    return b.inputs['Alpha'].default_value < 0.95 or (tw is not None and tw.default_value > 0.3)


# Certains assets Moda arrivent blancs (matière procédurale non exportée) :
# teinte de secours d'après le nom du matériau, seulement pour un blanc pur sans texture.
NAME_TINTS = [
    (('feuill', 'leaf', 'foliage'), '#3F6B30'),
    (('noyer', 'walnut'), '#5E3B22'),
    (('acajou', 'mahogany'), '#6E2F1E'),
    (('chene', 'chêne', 'oak', 'bois', 'wood', 'plateau', 'chant'), '#B48C5C'),
    (('tapis', 'rug', 'bordure'), '#CDBFA4'),
    (('carton', 'rabat', 'cardboard'), '#B8936A'),
    (('pages', 'papier', 'paper'), '#EEE6D3'),
]


SCREEN_RE = ('ecran', 'écran', 'screen', 'dalle', 'display')


def flat_color(m):
    """Écrans, LED, ampoules : couleur fixe, sans éclairage précalculé (sinon taches et triangles)."""
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
    if b is None:
        return None
    ec = b.inputs.get('Emission Color')
    es = b.inputs.get('Emission Strength')
    if ec is not None and es is not None and not ec.links and es.default_value > 0 and max(ec.default_value[:3]) > 0.02:
        return tuple(min(1.0, v * es.default_value) for v in ec.default_value[:3])
    if any(k in m.name.lower() for k in SCREEN_RE) and not b.inputs['Base Color'].links:
        return tuple(b.inputs['Base Color'].default_value[:3])
    return None


def base_color(m):
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
    if b is None or b.inputs['Base Color'].links:
        return (0.6, 0.6, 0.6)
    c = tuple(b.inputs['Base Color'].default_value[:3])
    if min(c) > 0.99:
        nm = m.name.lower()
        for keys, hexa in NAME_TINTS:
            if any(k in nm for k in keys):
                return srgb_to_lin(hexa)[:3]
        return (0.8, 0.8, 0.8)  # blanc pur : légèrement atténué pour ne pas « brûler »
    return c


if PROPS_GLB:
    log('Objets placés :', os.path.basename(PROPS_GLB))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=PROPS_GLB)
    new = [o for o in bpy.data.objects if o not in before]
    mp = next(o for o in new if o.name.split('.')[0] == MAP_NODE)
    inv = mp.matrix_world.inverted()   # repère Moda -> repère du décor
    drop = {mp, *mp.children_recursive}
    root = mp.parent

    def asset_of(o):
        while o.parent is not None and o.parent is not root:
            o = o.parent
        return o

    log('   import terminé')
    meshes = [o for o in new if o.type == 'MESH' and o not in drop]
    groups = {}
    for o in meshes:
        groups.setdefault(asset_of(o), []).append(o)
    total_before = total_after = 0
    for asset, objs in groups.items():
        for o in objs:
            if o.data.users > 1:
                o.data = o.data.copy()
            mw = inv @ o.matrix_world
            o.parent = None
            o.matrix_world = Matrix.Identity(4)
            o.data.transform(mw)
            for c in o.users_collection:
                c.objects.unlink(o)
            COLL.objects.link(o)
        # budget de triangles selon la taille de l'objet (le Quest n'avale pas 1,4 M de triangles)
        pts = [Vector(c) for o in objs for c in o.bound_box]
        diag = (Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))) -
                Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))).length
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
        cap = max(600, min(5000, 3000 * diag))
        ratio = min(1.0, cap / max(tris, 1)) if tris > 4000 else 1.0  # petits objets : intacts
        total_before += tris
        if ratio < 0.98:
            for o in objs:
                o.modifiers.new('Dec', 'DECIMATE').ratio = max(0.02, ratio)
    # application de toutes les simplifications en une seule fois (bien plus rapide qu'objet par objet)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.convert(target='MESH')
    total_after = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    for o in new:
        if o in drop or o.type != 'MESH':
            bpy.data.objects.remove(o)
    log(f'   {len(groups)} objets, {total_before:,} -> {total_after:,} triangles')

    # un seul objet ; les faces vitrées partent dans un objet transparent à part
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    PROPS_OBJ = bpy.context.view_layer.objects.active
    PROPS_OBJ.name = 'Objets'
    me = PROPS_OBJ.data
    glass_idx = {i for i, m in enumerate(me.materials) if is_glass(m)}
    # vitre fumée quasi noire (face avant des écrans) : invisible en pratique, on la retire
    dark_idx = {i for i in glass_idx if max(base_color(me.materials[i])) < 0.1}
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    # dalles d'écran collées au cadre noir (défaut des modèles : < 1 mm d'écart -> le cadre « perce »
    # la dalle) : on gonfle légèrement la dalle pour qu'elle passe devant
    screen_idx = {i for i, m in enumerate(me.materials)
                  if m and any(k in m.name.lower() for k in SCREEN_RE)
                  and not any(k in m.name.lower() for k in ('bord', 'cadre', 'frame', 'bezel'))}
    if screen_idx:
        bm.normal_update()
        moved = 0
        for v in bm.verts:
            if v.link_faces and all(f.material_index in screen_idx for f in v.link_faces):
                v.co += v.normal * 0.003
                moved += 1
        log(f'   dalles d\'écran avancées : {moved} sommets')
    # arêtes longues recoupées : l'éclairage par sommet a besoin de sommets sur les grandes faces
    for _ in range(4):
        long_e = [e for e in bm.edges if e.calc_length() > 0.25]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(me)
    bm.free()
    if glass_idx:
        PROPS_GLASS = PROPS_OBJ.copy()
        PROPS_GLASS.data = me.copy()
        COLL.objects.link(PROPS_GLASS)
        PROPS_GLASS.name = 'ObjetsVerre'
        for ob, keep_glass in ((PROPS_OBJ, False), (PROPS_GLASS, True)):
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.material_index in glass_idx) != keep_glass
                                       or f.material_index in dark_idx], context='FACES')
            bm.to_mesh(ob.data)
            bm.free()
    PROPS_BASE = {i: base_color(m) for i, m in enumerate(me.materials)}
    PROPS_FLAT = {i: c for i, m in enumerate(me.materials) if (c := flat_color(m)) is not None}
    log('   couleur fixe :', ', '.join(sorted({me.materials[i].name.split('.')[0] for i in PROPS_FLAT})))
    log(f'   opaque : {len(me.polygons):,} triangles | verre : {len(PROPS_GLASS.data.polygons) if PROPS_GLASS else 0:,}')

# ---------------------------------------------------------------- monde (HDRI)
log('Monde')
HDRI_ROT = math.radians(200)  # oriente les tours vers les verrières principales
world = bpy.data.worlds.new('Monde')
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
wn = world.node_tree
wn.nodes.clear()
wo = wn.nodes.new('ShaderNodeOutputWorld')
bg = wn.nodes.new('ShaderNodeBackground')
env = wn.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(ASSETS, 'hdri', 'potsdamer_platz_2k.hdr'))
tc = wn.nodes.new('ShaderNodeTexCoord')
mp = wn.nodes.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, 0, HDRI_ROT)
wn.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
wn.links.new(mp.outputs['Vector'], env.inputs['Vector'])
hs = wn.nodes.new('ShaderNodeHueSaturation')
hs.inputs['Saturation'].default_value = 0.25
wn.links.new(env.outputs['Color'], hs.inputs['Color'])
wn.links.new(hs.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 2.4
wn.links.new(bg.outputs[0], wo.inputs[0])

# portails sur chaque baie : guident les rayons vers les ouvertures (moins de bruit)
for (axis, fixed, inward, a0, a1) in GLASS_BAYS:
    ld = bpy.data.lights.new('Portail', 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = a1 - a0, HEAD - SILL
    try:
        ld.cycles.is_portal = True
    except Exception:
        ld.is_portal = True
    lo = bpy.data.objects.new('Portail', ld)
    c = (a0 + a1) / 2
    zc = (SILL + HEAD) / 2
    n = Vector((inward, 0, 0)) if axis == 'Y' else Vector((0, inward, 0))
    Z = -n
    Y = Vector((0, 0, 1))
    X = Y.cross(Z)
    lo.matrix_world = Matrix.Translation((fixed + inward * 0.05, c, zc) if axis == 'Y' else (c, fixed + inward * 0.05, zc)) @ Matrix((X, Y, Z)).transposed().to_4x4()
    scene.collection.objects.link(lo)

# Ciel visible par les fenêtres : sphère non éclairée avec le panorama « tonemappé »
log('Ciel')
sky_img = bpy.data.images.load(os.path.join(ASSETS, 'hdri', 'potsdamer_platz_tonemapped.jpg'))
sky_img.scale(4096, 2048)
sky_path = os.path.join(OUT, 'textures', 'sky.jpg')
save_image(sky_img, sky_path, 88)
sky_img = bpy.data.images.load(sky_path)
msky = new_mat('UNLIT_Sky')
nt = msky.node_tree
b = principled(msky)
t = nt.nodes.new('ShaderNodeTexImage')
t.image = sky_img
nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
MATS['UNLIT_Sky'] = msky

bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=60)
uvl = bm.loops.layers.uv.new('UVMap')
Rinv = Matrix.Rotation(HDRI_ROT, 3, 'Z')  # même orientation que le monde Cycles
for f in bm.faces:
    us = []
    for l in f.loops:
        d = (Rinv @ l.vert.co).normalized()
        u = 0.5 - math.atan2(d.y, d.x) / (2 * math.pi)
        v = 0.5 + math.asin(max(-1, min(1, d.z))) / math.pi
        us.append([u, v])
    umax = max(u for u, _ in us)
    for uv in us:
        if umax - uv[0] > 0.5:
            uv[0] += 1.0
    for l, uv in zip(f.loops, us):
        l[uvl].uv = uv
bmesh.ops.reverse_faces(bm, faces=bm.faces)  # vue de l'intérieur
bmesh.ops.translate(bm, vec=Vector((SPAWN[0], SPAWN[1], EYE)), verts=bm.verts)
sky = obj_from_bm(bm, 'Ciel', 'UNLIT_Sky')
for attr in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
    setattr(sky, attr, False)

# point d'apparition
sp = bpy.data.objects.new('Spawn', None)
sp.location = (SPAWN[0], SPAWN[1], 0)
COLL.objects.link(sp)

# ============================================================================ fusion par matériau
log('Fusion par matériau')
MERGED = {}
for mname, objs in PARTS.items():
    objs = [o for o in objs if o.name in bpy.data.objects]
    if not objs:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = mname.replace('LM_', '').replace('UNLIT_', '').replace('GLASS_', '')
    MERGED[mname] = ob
bpy.ops.object.select_all(action='DESELECT')
PLANT_OBJ = None
if PLANTS:
    for o in PLANTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PLANTS[0]
    bpy.ops.object.join()
    PLANT_OBJ = bpy.context.view_layer.objects.active
    PLANT_OBJ.name = 'Plantes'
    MERGED['VC_Plants'] = PLANT_OBJ
for mn, ob in sorted(MERGED.items(), key=lambda kv: -len(kv[1].data.polygons))[:6]:
    log(f'   {mn:28s} {sum(len(p.vertices) - 2 for p in ob.data.polygons):>8,} triangles')
if PROPS_OBJ is not None:
    MERGED['VC_Props'] = PROPS_OBJ
if PROPS_GLASS is not None:
    MERGED['GLASS_Props'] = PROPS_GLASS
log('Objets :', len(MERGED), '| triangles :', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in MERGED.values()))

# ============================================================================ UV de texture (projection « boîte » en coordonnées monde)
TILE = {'LM_Floor': 2.4, 'LM_Oak': 1.1, 'LM_Plaster': 2.5, 'LM_Fabric': 0.45, 'LM_Linen': 0.45}  # sol : 3 dalles de 0,8 m par répétition


def box_uv(ob, tile, grain_x=False):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            if ax == 2:
                u, v = (co.y, co.x) if grain_x else (co.x, co.y)
            elif ax == 0:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            l[uvl].uv = (u / tile, v / tile)
    bm.to_mesh(me)
    bm.free()


for mname, tile in TILE.items():
    if mname in MERGED:
        # garder un seul calque UV de texture, nommé UVMap
        me = MERGED[mname].data
        while len(me.uv_layers) > 0:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name='UVMap')
        box_uv(MERGED[mname], tile, grain_x=(mname == 'LM_Oak'))

# ============================================================================ UV de lightmap
log('UV de lightmap')
LM_OBJS = [o for m, o in MERGED.items() if m.startswith('LM_')]
for o in LM_OBJS:
    me = o.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name='UVMap')
    lm = me.uv_layers.get('Lightmap') or me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = lm
bpy.ops.object.select_all(action='DESELECT')
for o in LM_OBJS:
    o.select_set(True)
bpy.context.view_layer.objects.active = LM_OBJS[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
try:
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, margin_method='FRACTION', margin=0.0015, shape_method='CONCAVE')
except TypeError:
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
uv_area = 0.0
for o in LM_OBJS:
    me = o.data
    uv = np.zeros(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers['Lightmap'].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    for p in me.polygons:
        q = uv[p.loop_start:p.loop_start + p.loop_total]
        uv_area += 0.5 * abs(float(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(np.roll(q[:, 0], -1), q[:, 1])))
log(f'Occupation de la lightmap : {uv_area * 100:.0f} %')
if uv_area < 0.2:
    raise SystemExit('UV de lightmap invalides (rangement raté)')

# ============================================================================ précalcul Cycles
log(f'Précalcul : {LM_SIZE}px, {SAMPLES} échantillons')
prefs = bpy.context.preferences.addons['cycles'].preferences
for dev_type in ('OPTIX', 'CUDA'):
    try:
        prefs.compute_device_type = dev_type
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == dev_type]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == dev_type
            scene.cycles.device = 'GPU'
            log('Calcul sur', dev_type, gpus[0].name)
            break
    except Exception as e:
        log('Pas de', dev_type, e)
cy = scene.cycles
cy.samples = SAMPLES
cy.use_adaptive_sampling = False
cy.max_bounces = 6
cy.diffuse_bounces = 4
cy.glossy_bounces = 1
cy.transmission_bounces = 4
cy.transparent_max_bounces = 12
cy.sample_clamp_indirect = 8.0
try:
    cy.use_light_tree = True
except Exception:
    pass

LM_IMG = bpy.data.images.new('Lightmap', LM_SIZE, LM_SIZE, alpha=True, float_buffer=True)
LM_IMG.generated_color = (0, 0, 0, 0)

for o in LM_OBJS:
    for m in o.data.materials:
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.name = 'LM_BAKE'
        n.image = LM_IMG
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'Lightmap'
        nt.links.new(uv.outputs['UV'], n.inputs['Vector'])
        nt.nodes.active = n
        n.select = True

scene.render.bake.margin = 6
scene.render.bake.margin_type = 'EXTEND'
scene.render.bake.use_clear = True
bpy.ops.object.select_all(action='DESELECT')
for o in LM_OBJS:
    o.select_set(True)
bpy.context.view_layer.objects.active = LM_OBJS[0]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '_avant_bake.blend'))
tb = time.time()
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True, target='IMAGE_TEXTURES')
log(f'Précalcul terminé en {time.time() - tb:.0f}s')

# Plantes : éclairage par sommet
if PLANT_OBJ is not None:
    log('Précalcul des plantes (par sommet)')
    me = PLANT_OBJ.data
    ca = me.color_attributes.new('Eclairage', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = ca
    try:
        me.attributes.active_color = ca
    except Exception:
        pass
    bpy.ops.object.select_all(action='DESELECT')
    PLANT_OBJ.select_set(True)
    bpy.context.view_layer.objects.active = PLANT_OBJ
    cy.samples = max(32, SAMPLES // 2)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='VERTEX_COLORS')
    cy.samples = SAMPLES

if PROPS_OBJ is not None:
    log('Précalcul des objets placés (par sommet)')
    pm = PROPS_OBJ.data
    pca = pm.color_attributes.new('Eclairage', 'FLOAT_COLOR', 'CORNER')
    pm.color_attributes.active_color = pca
    try:
        pm.attributes.active_color = pca
    except Exception:
        pass
    bpy.ops.object.select_all(action='DESELECT')
    PROPS_OBJ.select_set(True)
    bpy.context.view_layer.objects.active = PROPS_OBJ
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='VERTEX_COLORS')
    log('   fait')

# ============================================================================ post-traitement de la lightmap
w = h = LM_SIZE
px = np.empty(w * h * 4, dtype=np.float32)
LM_IMG.pixels.foreach_get(px)
px = px.reshape(h, w, 4)
rgb = px[..., :3].copy()
mask = (px[..., 3] > 0.5).astype(np.float32)
np.save(os.path.join(OUT, 'lightmap_raw.npy'), px.astype(np.float16))


def denoise(img):
    """Débruitage Intel OIDN via le compositeur de Blender (scène dédiée)."""
    w, h = img.size
    sc = bpy.data.scenes.new('Debruitage')
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    cam = bpy.data.objects.new('CamDN', bpy.data.cameras.new('CamDN'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.use_compositing = True
    sc.view_settings.view_transform = 'Standard'
    if hasattr(sc, 'compositing_node_group'):
        tree = bpy.data.node_groups.new('DN', 'CompositorNodeTree')
        sc.compositing_node_group = tree
        tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        out_sock = tree.nodes.new('NodeGroupOutput').inputs[0]
    else:
        sc.use_nodes = True
        tree = sc.node_tree
        tree.nodes.clear()
        out_sock = tree.nodes.new('CompositorNodeComposite').inputs['Image']
    ni = tree.nodes.new('CompositorNodeImage')
    ni.image = img
    dn = tree.nodes.new('CompositorNodeDenoise')
    if 'HDR' in dn.inputs:
        dn.inputs['HDR'].default_value = True
    tree.links.new(ni.outputs['Image'], dn.inputs['Image'])
    tree.links.new(dn.outputs['Image'], out_sock)
    path = os.path.join(OUT, 'lightmap_denoised.exr')
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    td = time.time()
    bpy.ops.render.render(write_still=True, scene=sc.name)
    res = bpy.data.images.load(path)
    o = np.empty(w * h * 4, np.float32)
    res.pixels.foreach_get(o)
    log(f'Débruitage OIDN : {time.time() - td:.0f}s')
    return o.reshape(h, w, 4)


def blur_masked(img, m, radius):
    """Flou gaussien séparable pondéré par le masque (ne déborde pas hors des îlots)."""
    if radius <= 0:
        return img
    xs = np.arange(-radius * 2, radius * 2 + 1)
    k = np.exp(-(xs ** 2) / (2 * radius ** 2)).astype(np.float32)
    k /= k.sum()

    def conv(a, axis):
        out = np.zeros_like(a)
        for i, kv in zip(xs, k):
            out += kv * np.roll(a, i, axis=axis)
        return out
    num = img * m[..., None]
    num = conv(conv(num, 0), 1)
    den = conv(conv(m, 0), 1)[..., None]
    return np.where(den > 1e-4, num / np.maximum(den, 1e-4), img)


rgb = denoise(LM_IMG)[..., :3]
rgb = blur_masked(rgb, mask, 0.7)
lum = (rgb * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(-1)
valid = lum[mask > 0.5]
p60 = float(np.percentile(valid, 60)) if valid.size else 1.0
EXPOSURE = 1.08 / max(p60, 1e-4)  # pièce lumineuse et aérée, comme sur la photo
HEADROOM = 2.0                     # valeurs > 1 conservées (zones proches des fenêtres)
# compression douce des hautes lumières (évite les aplats blancs)
x = rgb * EXPOSURE
x = np.where(x > 1.2, 1.2 + (x - 1.2) / (1 + (x - 1.2) / (HEADROOM - 1.2)), x)
rgb = x / EXPOSURE
v = np.clip(rgb * EXPOSURE / HEADROOM, 0, 1)
v = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)  # encodage sRGB
out = np.concatenate([v, np.ones((h, w, 1), np.float32)], -1)
OUT_IMG = bpy.data.images.new('LightmapOut', w, h, alpha=False)
OUT_IMG.colorspace_settings.name = 'sRGB'
OUT_IMG.pixels.foreach_set(out.ravel())
lm_path = os.path.join(OUT, 'textures', 'lightmap.jpg')
save_image(OUT_IMG, lm_path, 92)
LM_JPG = bpy.data.images.load(lm_path)
LM_INTENSITY = HEADROOM  # l'appli multiplie par PI (convention MeshBasicMaterial)
log(f'Exposition {EXPOSURE:.3f}, p60={p60:.4f}')
scene['lightmapIntensity'] = LM_INTENSITY
if PLANT_OBJ is not None:
    vc = np.empty(len(me.loops) * 4, dtype=np.float32)
    ca = PLANT_OBJ.data.color_attributes['Eclairage']
    ca.data.foreach_get('color', vc)
    vc = vc.reshape(-1, 4)
    # lissage : moyenne par sommet puis 3 passes de moyenne avec les voisins (retire le bruit du précalcul)
    pme = PLANT_OBJ.data
    corner_vert = np.empty(len(pme.loops), dtype=np.int64)
    pme.loops.foreach_get('vertex_index', corner_vert)
    nv = len(pme.vertices)
    acc = np.zeros((nv, 3), np.float64)
    cnt = np.zeros(nv, np.float64)
    np.add.at(acc, corner_vert, vc[:, :3])
    np.add.at(cnt, corner_vert, 1)
    vcol = acc / np.maximum(cnt, 1)[:, None]
    ev = np.empty(len(pme.edges) * 2, dtype=np.int64)
    pme.edges.foreach_get('vertices', ev)
    ev = ev.reshape(-1, 2)
    for _ in range(3):
        nacc = vcol.copy()
        ncnt = np.ones(nv)
        np.add.at(nacc, ev[:, 0], vcol[ev[:, 1]])
        np.add.at(nacc, ev[:, 1], vcol[ev[:, 0]])
        np.add.at(ncnt, ev[:, 0], 1)
        np.add.at(ncnt, ev[:, 1], 1)
        vcol = nacc / ncnt[:, None]
    vc[:, :3] = vcol[corner_vert].astype(np.float32)
    vc[:, :3] = np.clip(vc[:, :3] * EXPOSURE / HEADROOM, 0, 1)
    vc[:, 3] = 1
    ca.data.foreach_set('color', vc.ravel())
    log(f'Plantes : éclairage moyen {vc[:, :3].mean():.3f}')

if PROPS_OBJ is not None:
    # éclairage moyenné entre les coins d'un même sommet orientés pareil (anti-bruit sans
    # flouter les arêtes vives), puis multiplié par la couleur de base de chaque face
    pm = PROPS_OBJ.data
    nl = len(pm.loops)
    lit = np.empty(nl * 4, dtype=np.float32)
    pm.color_attributes['Eclairage'].data.foreach_get('color', lit)
    lit = lit.reshape(-1, 4)[:, :3].astype(np.float64)
    cv = np.empty(nl, dtype=np.int64)
    pm.loops.foreach_get('vertex_index', cv)
    npoly = len(pm.polygons)
    ls = np.empty(npoly, dtype=np.int64); pm.polygons.foreach_get('loop_start', ls)
    lt = np.empty(npoly, dtype=np.int64); pm.polygons.foreach_get('loop_total', lt)
    pn = np.empty(npoly * 3, dtype=np.float32); pm.polygons.foreach_get('normal', pn)
    mi = np.empty(npoly, dtype=np.int64); pm.polygons.foreach_get('material_index', mi)
    face_of = np.repeat(np.arange(npoly), lt)
    q = np.round(pn.reshape(-1, 3) * 2).astype(np.int64)[face_of] + 2   # ~30° par case
    key = cv * 125 + q[:, 0] * 25 + q[:, 1] * 5 + q[:, 2]
    _, grp = np.unique(key, return_inverse=True)
    acc = np.zeros((grp.max() + 1, 3)); np.add.at(acc, grp, lit)
    cnt = np.bincount(grp)
    lit = acc[grp] / cnt[grp][:, None]
    base = np.array([PROPS_BASE.get(i, (0.6, 0.6, 0.6)) for i in range(max(len(pm.materials), 1))])
    col = lit * base[mi[face_of]]
    out_vc = np.ones((nl, 4), dtype=np.float32)
    out_vc[:, :3] = np.clip(col * EXPOSURE / HEADROOM, 0, 1)
    for i, c in PROPS_FLAT.items():   # l'appli multiplie par HEADROOM : on compense
        out_vc[mi[face_of] == i, :3] = np.clip(np.array(c) / HEADROOM, 0, 1)
    pm.color_attributes['Eclairage'].data.foreach_set('color', out_vc.ravel())
    pm.materials.clear()
    vcm = new_mat('VC_Props')
    principled(vcm).inputs['Base Color'].default_value = (1, 1, 1, 1)
    pm.materials.append(vcm)
    log(f'Objets placés : éclairage moyen {out_vc[:, :3].mean():.3f}')
if PROPS_GLASS is not None:
    PROPS_GLASS.data.materials.clear()
    gm = new_mat('GLASS_Props')
    gb = principled(gm)
    gb.inputs['Base Color'].default_value = (0.92, 0.94, 0.95, 1)
    gb.inputs['Alpha'].default_value = 0.18
    PROPS_GLASS.data.materials.append(gm)

# ============================================================================ matériaux d'export (couleur + lightmap émissive)
log('Préparation de l\'export')


def rebuild_for_export(m, lightmap):
    nt = m.node_tree
    b = principled(m)
    base_link = next((l for l in nt.links if l.to_socket == b.inputs['Base Color']), None)
    alpha_link = next((l for l in nt.links if l.to_socket == b.inputs['Alpha']), None)
    base_tex = base_link.from_node if base_link else None
    alpha_tex = alpha_link.from_node if alpha_link else None
    color = tuple(b.inputs['Base Color'].default_value)
    alpha_val = b.inputs['Alpha'].default_value
    keep = {base_tex, alpha_tex}
    # nettoyage
    for n in list(nt.nodes):
        if n not in keep and n.type not in ('OUTPUT_MATERIAL',):
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    nb = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(nb.outputs[0], out.inputs[0])
    nb.inputs['Roughness'].default_value = 1.0
    if base_tex:
        nt.links.new(base_tex.outputs['Color'], nb.inputs['Base Color'])
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        nt.links.new(uv.outputs['UV'], base_tex.inputs['Vector'])
        if alpha_tex and alpha_tex is not base_tex:
            nt.links.new(uv.outputs['UV'], alpha_tex.inputs['Vector'])
    else:
        nb.inputs['Base Color'].default_value = color
    if alpha_tex:
        nt.links.new(alpha_tex.outputs['Color'] if alpha_tex is not base_tex else alpha_tex.outputs['Alpha'], nb.inputs['Alpha'])
    elif alpha_val < 1:
        nb.inputs['Alpha'].default_value = alpha_val
    if lightmap is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = lightmap
        uv2 = nt.nodes.new('ShaderNodeUVMap')
        uv2.uv_map = 'Lightmap'
        nt.links.new(uv2.outputs['UV'], t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], nb.inputs['Emission Color'])
        nb.inputs['Emission Strength'].default_value = 1.0


done = set()
for mname, o in MERGED.items():
    for m in o.data.materials:
        if m.name in done:
            continue
        done.add(m.name)
        if m.name.startswith('LM_'):
            rebuild_for_export(m, LM_JPG)
        elif m.name.startswith('VC_'):
            rebuild_for_export(m, None)
        elif m.name.startswith(('GLASS_', 'UNLIT_Curtain', 'UNLIT_Sky')):
            rebuild_for_export(m, None)
        # UNLIT_RingLight : émission pure, exportée telle quelle

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '.blend'))

# ============================================================================ export glTF
log('Export glTF')
bpy.ops.object.select_all(action='DESELECT')
for o in list(MERGED.values()) + [sp]:
    o.select_set(True)
glb = os.path.join(OUT, NAME + '.glb')
kw = dict(filepath=glb, export_format='GLB', use_selection=True, export_extras=True, export_apply=True,
          export_lights=False, export_cameras=False, export_normals=False, export_tangents=False,
          export_texcoords=True, export_image_format='AUTO', export_yup=True, export_vertex_color='ACTIVE',
          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
try:
    bpy.ops.export_scene.gltf(**kw)
except TypeError as e:
    log('Option non reconnue, export simplifié :', e)
    for k in ('export_normals', 'export_tangents', 'export_vertex_color', 'export_draco_mesh_compression_enable', 'export_draco_mesh_compression_level'):
        kw.pop(k, None)
    bpy.ops.export_scene.gltf(**kw)
log(f'GLB : {os.path.getsize(glb) / 1e6:.1f} Mo')
log('FIN')
