"""Lossless APNG -> WebP animation and static thumbnails, with reproducible provenance.

Usage: PYTHONPATH=/path/to/Pillow python3 scripts/importAnimatedPokemonSprites.py /path/to/tout
Only supported base species 1..649 and the battle forms used by the engine are imported.
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import tempfile
import urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=pathlib.Path)
parser.add_argument('--supplement-dir', type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()) / 'riftmon-safari-supplement')
args = parser.parse_args()
SOURCE = args.source.resolve()
SUPPLEMENT = args.supplement_dir
PROVENANCE = json.loads((ROOT / 'data/vendor/pokeapi/safari-sprite-sources.json').read_text())
for source in PROVENANCE['files']:
    cached = SUPPLEMENT / source['side'] / f"{source['id']}.gif"
    if not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        data = urllib.request.urlopen(source['url'], timeout=30).read()
        assert hashlib.sha256(data).hexdigest() == source['sha256'], source['url']
        cached.write_bytes(data)
    assert hashlib.sha256(cached.read_bytes()).hexdigest() == source['sha256'], cached
TARGET = ROOT / 'vue-explorakit/public/img/pokemon'
FOLDERS = {'front': 'Sprites_Black_2_White_2', 'back': 'Sprites_Back_Black_2_White_2',
           'shiny/front': 'Sprites_Shiny_Black_White', 'shiny/back': 'Sprites_Shiny_Back_Black_2_White_2'}
FORMS = {10013: (351, 'S'), 10014: (351, 'R'), 10015: (351, 'H'), 10017: (555, 'Z'), 10018: (648, 'P')}
pattern = re.compile(r'^Spr (?:b )?5b2? (\d{3})([A-Za-z]*)(?: ([mf]))?(?: s)?\.png$')
tasks = []
missing = []
for folder, supplied in FOLDERS.items():
    entries = []
    for p in (SOURCE / supplied).glob('*.png'):
        m = pattern.match(p.name)
        if m and int(m[1]) <= 649:
            entries.append((p, int(m[1]), m[2], m[3]))
    for id in list(range(1, 650)) + list(FORMS):
        species, form = FORMS.get(id, (id, ''))
        eligible = [e for e in entries if e[1] == species and (e[2] == form or not form)]
        if not eligible:
            fallback = SUPPLEMENT / folder / f'{id}.gif'
            if fallback.exists():
                tasks.append((folder, id, fallback))
            else:
                missing.append({'folder': folder, 'id': id})
            continue
        # Prefer the ordinary form and B2W2 correction, then a male base image.
        eligible.sort(key=lambda e: (e[2] != form, '5b2 ' not in e[0].name, e[3] not in (None, 'm'), e[0].name))
        chosen = eligible[0]
        tasks.append((folder, id, chosen[0]))
        # Preserve gender variants when both are supplied, not by recoloring.
        if id <= 649:
            for gender in ['f', 'm']:
                options = [e for e in eligible if e[2] == chosen[2] and e[3] == gender]
                if options:
                    tasks.append((folder, str(id) + '-' + gender, options[0][0]))
assert not missing, missing

def export(task):
    folder, id, path = task
    animation = TARGET / 'animated' / folder / f'{id}.webp'
    poster = TARGET / folder / f'{id}.png'
    animation.parent.mkdir(parents=True, exist_ok=True)
    poster.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(path)
    frames, durations, bounds = [], [], None
    elapsed = 0
    for index in range(image.n_frames):
        image.seek(index)
        frame = image.convert('RGBA')
        frames.append(frame)
        elapsed += float(image.info.get('duration', 100))
        durations.append(max(1, round(elapsed) - sum(durations)))
        bbox = frame.getchannel('A').getbbox()
        if bbox:
            bounds = bbox if bounds is None else (min(bounds[0], bbox[0]), min(bounds[1], bbox[1]), max(bounds[2], bbox[2]), max(bounds[3], bbox[3]))
    assert frames and bounds
    frames[0].save(poster, format='PNG', optimize=True)
    frames[0].save(animation, format='WEBP', save_all=True, append_images=frames[1:], duration=durations, loop=0, lossless=True, method=4, exact=True)
    # Validate the first/last rendered image and total timing after actual decoding.
    decoded = Image.open(animation)
    assert decoded.size == image.size
    times = []
    for index in range(decoded.n_frames):
        decoded.seek(index)
        decoded.load()
        times.append(decoded.info.get('duration', 0))
    assert abs(sum(times) - sum(durations)) <= 1, (path, times, durations)
    for original, index in [(frames[0], 0), (frames[-1], decoded.n_frames - 1)]:
        decoded.seek(index)
        actual = decoded.convert('RGBA')
        # RGB below full transparency is not visible and may be canonicalized.
        background = Image.new('RGBA', original.size, (0, 0, 0, 255))
        assert Image.alpha_composite(background, original).tobytes() == Image.alpha_composite(background, actual).tobytes(), path
        assert original.getchannel('A').tobytes() == actual.getchannel('A').tobytes(), path
    return {'key': f'{folder}/{id}', 'id': id, 'size': list(image.size), 'bounds': list(bounds), 'frames': len(frames), 'durationMs': sum(durations),
            'source': str(path.relative_to(SOURCE)) if path.is_relative_to(SOURCE) else str(path), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sourceBytes': path.stat().st_size,
            'animationBytes': animation.stat().st_size, 'posterBytes': poster.stat().st_size,
            'animationSha256': hashlib.sha256(animation.read_bytes()).hexdigest()}

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    records = list(executor.map(export, tasks))
manifest = {r['key']: {k: r[k] for k in ['size', 'bounds', 'frames', 'durationMs']} for r in records}
(ROOT / 'vue-explorakit/src/data/pokemonSpriteManifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
report = {'source': str(SOURCE), 'format': 'Lossless animated WebP; static PNG thumbnails; original supplied APNG unchanged', 'species': 649, 'variants': len(records),
          'sourceBytes': sum(r['sourceBytes'] for r in records), 'animationBytes': sum(r['animationBytes'] for r in records), 'posterBytes': sum(r['posterBytes'] for r in records),
          'pixelValidation': 'Every animation decoded: total timing, first/last visible RGBA; all frame alpha bounds measured', 'supplementalSources': PROVENANCE, 'files': records}
(ROOT / 'docs/ANIMATED_POKEMON_IMPORT_2026-11-05.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}))
