"""Build CS from legal TM/tutor compatibility through Gen 7 plus the new singles moves."""
import json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
ref = json.loads((ROOT / 'data/vendor/pokeapi/learnsets.gen7.json').read_text())
catalog = json.loads((ROOT / 'data/game/moves.json').read_text())

def normalize(name):
    n = re.sub('[^a-z0-9]', '', name.lower())
    return {'vicegrip': 'visegrip', 'hijumpkick': 'highjumpkick', 'smellingsalt': 'smellingsalts'}.get(n, n)

by_name = {normalize(m['ename']): m for m in catalog}
source_ids = {normalize(m['name']): int(i) for i, m in ref['moves'].items()}
import csv
french = {int(r['move_id']): r['name'] for r in csv.DictReader((ROOT / 'data/vendor/pokeapi/move_names.csv').open()) if r['local_language_id'] == '5'}
compatible = {int(i): set(species_ids) for i, species_ids in ref['technical'].items() if any(p <= 493 for p in species_ids)}
# New attacks are also available through CS using their actual USUM methods.
# This RiftMon extension does not infer compatibility merely from a Pokémon's type.
for m in catalog:
    if m.get('catalogueRevision') != 2:
        continue
    i = source_ids[normalize(m['ename'])]
    for p, learn in ref['species'].items():
        if i in learn['egg'] + learn['tutor'] + learn['machine'] or any(move == i for level, move in learn['level']):
            compatible.setdefault(i, set()).add(int(p))
machines = {}
# Deliberate RiftMon exception. Other CS keep their documented compatibility.
purify_id = source_ids['purify']
compatible[purify_id] = {p['id'] for p in json.loads((ROOT / 'data/game/pokedex.json').read_text()) if 'Poison' in p['type']}
for i, pokemon in sorted(compatible.items()):
    source = ref['moves'][str(i)]
    m = by_name.get(normalize(source['name']))
    if not m or not pokemon:
        continue
    power = m.get('power') or 0
    key = 'cs_' + source['slug'].replace('-', '_')
    machines[key] = {'move': m['ename'], 'moveId': i, 'name': 'CS ' + french[i], 'type': m['type'],
                     'price': 5000 if power >= 100 else 4000 if power >= 80 else 3000, 'species': sorted(pokemon)}
metadata = {'source': ref['source'], 'scope': 'Legal TM/tutor compatibility through generation 7; new singles additions also accept documented USUM level/egg methods. Purify is a RiftMon exception available to every Poison species. Base forms only; no field traversal effects.', 'machines': machines}
outputs = {'data/game/machines.json': json.dumps(metadata, ensure_ascii=False, indent=2) + '\n',
           'vue-explorakit/src/data/machines.json': json.dumps(machines, ensure_ascii=False, separators=(',', ':')) + '\n'}
items = json.loads((ROOT / 'data/game/items.json').read_text())
items['items'] = [i for i in items['items'] if i.get('category') != 'machine']
for key, m in machines.items():
    items['items'].append({'key': key, 'name': m['name'], 'category': 'machine', 'buy_price': 0, 'sell_price': 0,
                          'description': f"Apprend {french[m['moveId']]} à un Pokémon compatible. Une utilisation ; consommée uniquement après l’apprentissage.", 'machineMove': m['move']})
outputs['data/game/items.json'] = json.dumps(items, ensure_ascii=False, indent=2) + '\n'
store = json.loads((ROOT / 'data/game/department_store.json').read_text()); floor = store['floors']['tour_etage1']
floor['description'] = 'Vitamines, relances d’IV, remise à zéro des EV et CS pour apprendre des attaques.'
floor['offers'] = {key: value for key, value in floor['offers'].items() if not key.startswith('cs_')}
floor['offers'].update({key: {'price': m['price'], 'requiredTier': 2} for key, m in machines.items()})
outputs['data/game/department_store.json'] = json.dumps(store, ensure_ascii=False, indent=2) + '\n'
for name, value in outputs.items():
    if '--check' in sys.argv:
        assert (ROOT / name).read_text() == value, f'Stale {name}'
    else:
        (ROOT / name).write_text(value)
print(json.dumps({'machines': len(machines), 'compatibilities': sum(len(m['species']) for m in machines.values()), 'checked': '--check' in sys.argv}))
