"""Import a compact, pinned PokeAPI reference; raw CSV cache stays outside the repo."""
import csv, hashlib, json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
REVISION = '81d20919845b6a445969b9265aab5cec6b04cece'
CACHE = pathlib.Path(sys.argv[1])
assert (CACHE / 'revision').read_text().strip() == REVISION

def rows(name):
    with (CACHE / name).open() as stream:
        yield from csv.DictReader(stream)

names = {int(r['move_id']): r['name'] for r in csv.DictReader((ROOT / 'data/vendor/pokeapi/move_names.csv').open()) if r['local_language_id'] == '9'}
move_data = {int(r['id']): {'name': names[int(r['id'])], 'slug': r['identifier'], 'generation': int(r['generation_id'])} for r in rows('moves.csv') if int(r['generation_id']) <= 7}
species = {p: {'level': set(), 'egg': set(), 'machine': set(), 'tutor': set()} for p in range(1, 810)}
technical = {}
classic = sorted({int(r['move_id']) for r in rows('machines.csv') if int(r['version_group_id']) in [8, 9, 10]})
for r in rows('pokemon_moves.csv'):
    p, version, move, method, level = (int(r[k]) for k in ['pokemon_id', 'version_group_id', 'move_id', 'pokemon_move_method_id', 'level'])
    if p not in species or move not in move_data:
        continue
    if version <= (19 if p >= 808 else 18) and method in [3, 4]:
        technical.setdefault(move, set()).add(p)
    if version != (19 if p >= 808 else 18):
        continue
    if method == 1:
        species[p]['level'].add((level, move))
    elif method in [2, 3, 4]:
        species[p][{2: 'egg', 3: 'tutor', 4: 'machine'}[method]].add(move)

source = {'revision': REVISION, 'source': f'https://github.com/PokeAPI/pokeapi/tree/{REVISION}/data/v2/csv',
          'scope': 'Base forms 1–809; USUM level/egg/TM/tutor, Lets Go for 808/809; legal technical transfers through generation 7.',
          'license': 'BSD-3-Clause', 'sha256': {name: hashlib.sha256((CACHE / name).read_bytes()).hexdigest() for name in ['moves.csv', 'pokemon_moves.csv', 'machines.csv']},
          'moves': move_data, 'classicMachines': classic, 'technical': {k: sorted(v) for k, v in sorted(technical.items())},
          'species': {p: {k: sorted(v) for k, v in row.items()} for p, row in species.items()}}
p = ROOT / 'data/vendor/pokeapi/learnsets.gen7.json'
# One species per line keeps this offline reference compact and reviewable.
header = {k: v for k, v in source.items() if k != 'species'}
text = json.dumps(header, ensure_ascii=False, separators=(',', ':'))[:-1] + ',"species":{\n'
text += ',\n'.join(f'"{p}":{json.dumps(row, ensure_ascii=False, separators=(",", ":"))}' for p, row in source['species'].items()) + '\n}}\n'
if '--check' in sys.argv:
    assert p.read_text() == text, 'Stale learnset reference'
else:
    p.write_text(text)
print(json.dumps({'species': len(species), 'sourceMoves': len(move_data), 'bytes': len(text.encode())}))
