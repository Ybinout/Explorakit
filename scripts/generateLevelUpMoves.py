"""Generate the offline Gen 7 level-up table. Optional arg: cached PokeAPI CSV directory."""
import csv
import io
import json
import pathlib
import re
import sys
import urllib.request

REVISION = '81d20919845b6a445969b9265aab5cec6b04cece'
ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = f'https://raw.githubusercontent.com/PokeAPI/pokeapi/{REVISION}/data/v2/csv/'

def rows(name):
    text = (pathlib.Path(sys.argv[1]) / name).read_text() if len(sys.argv) > 1 else urllib.request.urlopen(URL + name, timeout=60).read().decode()
    return list(csv.DictReader(io.StringIO(text)))

def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')

catalogue = json.loads((ROOT / 'data/game/moves.json').read_text())
by_slug = {slug(move['ename']): move['ename'] for move in catalogue}
for source, target in [('vice-grip', 'vise-grip'), ('hi-jump-kick', 'high-jump-kick'), ('smelling-salts', 'smelling-salt')]:
    if source in by_slug:
        by_slug[target] = by_slug[source]
move_names = {int(row['id']): by_slug.get(row['identifier']) for row in rows('moves.csv')}
learnsets = {str(p['id']): [] for p in json.loads((ROOT / 'data/game/pokedex.json').read_text())}
for row in rows('pokemon_moves.csv'):
    species, version, method, level = (int(row[key]) for key in ['pokemon_id', 'version_group_id', 'pokemon_move_method_id', 'level'])
    name = move_names.get(int(row['move_id']))
    # USUM for 1–807; Meltan/Melmetal first appeared in Let's Go.
    if str(species) in learnsets and version == (19 if species >= 808 else 18) and method == 1 and name:
        learnsets[str(species)].append([level, name])
for species, entries in learnsets.items():
    learnsets[species] = sorted(set(map(tuple, entries)))
metadata = {'source': f'https://github.com/PokeAPI/pokeapi/tree/{REVISION}/data/v2/csv', 'versions': 'ultra-sun-ultra-moon; lets-go for 808/809', 'format': '[level, move name]; level 0 = evolution; only moves in the game catalogue'}
text = json.dumps(metadata, ensure_ascii=False, indent=2)[:-2] + ',\n  "species": {\n'
text += ',\n'.join(f'    "{species}": {json.dumps(entries, ensure_ascii=False)}' for species, entries in learnsets.items())
text += '\n  }\n}\n'
(ROOT / 'data/game/level_up_moves.json').write_text(text)
print(f'{len(learnsets)} species; {sum(map(len,learnsets.values()))} level-up entries')
ui = {m['ename']: {'type': m['type'], 'power': m.get('power') or 0, 'accuracy': m.get('accuracy'), 'pp': m['pp'], 'category': m['combat']['damage_class']} for m in catalogue}
(ROOT / 'vue-explorakit/src/data/moveLearning.json').write_text(json.dumps(ui, ensure_ascii=False, separators=(',', ':')) + '\n')
