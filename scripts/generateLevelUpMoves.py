"""Build level-up tables and UI data from the compact pinned offline reference."""
import json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
ref = json.loads((ROOT / 'data/vendor/pokeapi/learnsets.gen7.json').read_text())
catalog = json.loads((ROOT / 'data/game/moves.json').read_text())

def normalize(name):
    value = re.sub('[^a-z0-9]', '', name.lower())
    return {'vicegrip': 'visegrip', 'hijumpkick': 'highjumpkick', 'smellingsalt': 'smellingsalts'}.get(value, value)

by_name = {normalize(m['ename']): m['ename'] for m in catalog}
move_names = {key: by_name.get(normalize(m['name'])) for key, m in ref['moves'].items()}
species = {}
for p in json.loads((ROOT / 'data/game/pokedex.json').read_text()):
    entries = [(level, move_names[str(move)]) for level, move in ref['species'][str(p['id'])]['level'] if move_names.get(str(move))]
    species[str(p['id'])] = sorted(set(entries))
metadata = {'source': ref['source'], 'versions': 'ultra-sun-ultra-moon; lets-go for 808/809', 'format': '[level, move name]; level 0 = evolution; only moves in the game catalogue'}
text = json.dumps(metadata, ensure_ascii=False, indent=2)[:-2] + ',\n  "species": {\n'
text += ',\n'.join(f'    "{p}": {json.dumps(entries, ensure_ascii=False)}' for p, entries in species.items()) + '\n  }\n}\n'
ui = {m['ename']: {'type': m['type'], 'power': m.get('power') or 0, 'accuracy': m.get('accuracy'), 'pp': m['pp'], 'category': m['combat']['damage_class']} for m in catalog}
outputs = {'data/game/level_up_moves.json': text, 'vue-explorakit/src/data/moveLearning.json': json.dumps(ui, ensure_ascii=False, separators=(',', ':')) + '\n'}
for name, value in outputs.items():
    if '--check' in sys.argv:
        assert (ROOT / name).read_text() == value, f'Stale {name}'
    else:
        (ROOT / name).write_text(value)
print(json.dumps({'species': len(species), 'levelEntries': sum(map(len, species.values())), 'checked': '--check' in sys.argv}))
