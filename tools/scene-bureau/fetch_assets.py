"""Télécharge les ressources CC0 (Poly Haven) utilisées par le décor « bureau ».
Usage : python3 tools/scene-bureau/fetch_assets.py
"""
import json, os, sys, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
UA = {'User-Agent': 'libvr-asset-fetch/1.0'}

TEXTURES = {  # id -> résolution
    'oak_veneer_01': '2k',
    'white_plaster_02': '1k',
    'poly_wool_herringbone': '1k',
    'smooth_concrete_floor': '2k',
}
MODELS = ['potted_plant_01', 'potted_plant_02', 'pachira_aquatica_01', 'ceramic_vase_02']
HDRI = 'potsdamer_platz'


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return json.load(r)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print('  ↓', os.path.relpath(dest, ROOT))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r, open(dest + '.part', 'wb') as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    os.replace(dest + '.part', dest)


def main():
    print('Textures')
    for tid, res in TEXTURES.items():
        files = get_json(f'https://api.polyhaven.com/files/{tid}')
        for kind in ('Diffuse', 'Rough'):
            if kind in files:
                d = files[kind][res]['jpg']
                download(d['url'], os.path.join(ROOT, 'textures', os.path.basename(d['url'])))

    print('Modèles')
    for mid in MODELS:
        files = get_json(f'https://api.polyhaven.com/files/{mid}')
        if 'gltf' not in files:
            print('  (pas de glTF pour', mid, '— ignoré)')
            continue
        g = files['gltf']['1k']['gltf']
        base = os.path.join(ROOT, 'models', mid)
        download(g['url'], os.path.join(base, os.path.basename(g['url'])))
        for rel, inc in g.get('include', {}).items():
            download(inc['url'], os.path.join(base, rel))
        # masques de transparence des feuilles (absents du glTF en JPG)
        for k, v in files.items():
            if 'alpha' in k.lower():
                u = v['1k']['jpg']['url']
                download(u, os.path.join(base, 'textures', os.path.basename(u)))

    print('HDRI')
    h = get_json(f'https://api.polyhaven.com/files/{HDRI}')
    download(h['hdri']['2k']['hdr']['url'], os.path.join(ROOT, 'hdri', f'{HDRI}_2k.hdr'))
    download(h['tonemapped']['url'], os.path.join(ROOT, 'hdri', f'{HDRI}_tonemapped.jpg'))
    print('OK')


if __name__ == '__main__':
    sys.exit(main())
