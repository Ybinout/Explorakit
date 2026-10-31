"""Import permanent learning methods for existing species, without changing level-up tables.

Usage: python3 scripts/importMachineLearnability.py POKEAPI_CACHE SHOWDOWN_CACHE [--check]
Both caches are pinned below. No network request is made by this importer.
"""
import csv
import hashlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
POKEAPI_REVISION = '81d20919845b6a445969b9265aab5cec6b04cece'
SHOWDOWN_BLOB = '75488936bdf90a2b42d05b56697809cb5332fa34'
poke_cache, showdown_cache = map(pathlib.Path, sys.argv[1:3])
old_ref = json.loads((ROOT / 'data/vendor/pokeapi/learnsets.gen7.json').read_text())
assert (poke_cache / 'revision').read_text().strip() == POKEAPI_REVISION
for name, expected in old_ref['sha256'].items():
    assert hashlib.sha256((poke_cache / name).read_bytes()).hexdigest() == expected, f'Wrong pinned {name}'
source = (showdown_cache / 'showdown-learnsets.ts').read_bytes()
assert hashlib.sha1(b'blob ' + str(len(source)).encode() + b'\0' + source).hexdigest() == SHOWDOWN_BLOB
for name, expected in {
    'pokemon_species.csv': 'e66e2eeb25fd3836b0ebab6bf87bbf01960aa3c0555e2bac495fa8393c5e0c45',
    'pokemon_move_methods.csv': '78b75acfcf6dca4c82da9d4851357cbbd65e61b08154eddfc2ace0efd00e408e',
}.items():
    assert hashlib.sha256((showdown_cache / name).read_bytes()).hexdigest() == expected, f'Wrong pinned {name}'

# The pinned reference is a typed constant containing data only. Evaluate that
# literal in a separate, time-limited VM; no source code enters the game server.
parser = """
const fs=require('node:fs'),vm=require('node:vm');
const text=fs.readFileSync(process.argv[1],'utf8').replace(/^export const Learnsets[^=]*=/,'').trim().replace(/;$/,'');
process.stdout.write(JSON.stringify(vm.runInNewContext('('+text+')',Object.create(null),{timeout:5000})));
"""
showdown = json.loads(subprocess.check_output(['node', '-e', parser, str(showdown_cache / 'showdown-learnsets.ts')], text=True))

def rows(path):
    with path.open() as stream:
        yield from csv.DictReader(stream)

def normalize(name):
    value = re.sub('[^a-z0-9]', '', name.lower())
    return {'vicegrip': 'visegrip', 'hijumpkick': 'highjumpkick', 'smellingsalt': 'smellingsalts',
            'celebration': 'celebrate'}.get(value, value)

species_source = {int(r['id']): r for r in rows(showdown_cache / 'pokemon_species.csv') if int(r['id']) <= 809}
assert set(species_source) == set(range(1, 810))
methods = {int(r['id']): r['identifier'].replace('-', '_') for r in rows(showdown_cache / 'pokemon_move_methods.csv')}
species = {p: {} for p in species_source}
def add(p, method, move):
    species[p].setdefault(method, set()).add(move)

for record in rows(poke_cache / 'pokemon_moves.csv'):
    p, move, method = (int(record[k]) for k in ['pokemon_id', 'move_id', 'pokemon_move_method_id'])
    if p in species and str(move) in old_ref['moves']:
        assert method in methods
        add(p, methods[method], move)

move_ids = {normalize(m['name']): int(key) for key, m in old_ref['moves'].items()}
showdown_methods = {'L': 'level_up', 'M': 'machine', 'T': 'tutor', 'E': 'egg', 'S': 'event',
                    'D': 'dream_world', 'V': 'transfer', 'R': 'special'}
for p, definition in species_source.items():
    name = normalize(definition['identifier'])
    assert name in showdown, f'Missing base species {p}: {name}'
    for move, sources in showdown[name].get('learnset', {}).items():
        move_id = move_ids.get(normalize(move))
        if move_id is None:
            continue  # Later moves are not part of the current engine's reference.
        for method in sources:
            assert re.match(r'^\d+[LMTESDVR]', method), (name, move, method)
            code = re.match(r'^\d+([A-Z])', method).group(1)
            add(p, showdown_methods[code], move_id)

evolutions = sorted([int(r['evolves_from_species_id']), p] for p, r in species_source.items()
                    if r['evolves_from_species_id'] and int(r['evolves_from_species_id']) in species)
reference = {
    'scope': 'Permanent learning by any recorded method/version for existing base species 1–809; moves through generation 7. Current playable roster remains species 1–493. Regional/battle forms are not merged into base forms.',
    'sources': {
        'pokeapi': {'source': old_ref['source'], 'revision': POKEAPI_REVISION, 'license': 'BSD-3-Clause',
                    'sha256': {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in {
                        'pokemon_moves.csv': poke_cache / 'pokemon_moves.csv',
                        'pokemon_species.csv': showdown_cache / 'pokemon_species.csv',
                        'pokemon_move_methods.csv': showdown_cache / 'pokemon_move_methods.csv'}.items()}},
        'showdown': {'source': 'https://github.com/smogon/pokemon-showdown/blob/master/data/learnsets.ts',
                     'gitBlobSha': SHOWDOWN_BLOB, 'sha256': hashlib.sha256(source).hexdigest(), 'license': 'MIT'},
    },
    'methods': sorted({method for data in species.values() for method in data}),
    'evolutions': evolutions,
    'sketch': {'species': [235], 'excludedMoves': ['Struggle'],
               'scope': 'Permanent Sketch learning, including historical availability (e.g. Dark Void before generation 7). Sketch itself is a native move. Temporary Mimic/Transform/Metronome do not confer compatibility.'},
}
header = json.dumps(reference, ensure_ascii=False, separators=(',', ':'))[:-1] + ',"species":{\n'
output = header + ',\n'.join(f'"{p}":' + json.dumps({key: sorted(values) for key, values in sorted(data.items())},
                           ensure_ascii=False, separators=(',', ':')) for p, data in sorted(species.items())) + '\n}}\n'
target = ROOT / 'data/vendor/machine_learnability.json'
if '--check' in sys.argv:
    assert target.read_text() == output, f'Stale {target}'
else:
    target.write_text(output)
print(json.dumps({'species': len(species), 'methods': reference['methods'],
                  'directMethodPairs': sum(len(v) for data in species.values() for v in data.values()),
                  'bytes': len(output.encode()), 'checked': '--check' in sys.argv}))
