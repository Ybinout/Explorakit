"""Import the supplied 5x3 Safari world without altering authored tile layers.

Usage: python3 scripts/importSafariMaps.py /path/to/tout/ile_habitee
Only new safari map/assets and their derived transition configuration are written.
"""
import hashlib
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1])
plan = json.loads((SOURCE / 'plan_des_maps.json').read_text())
assert len(plan) == 15
source_maps = {f'ile{i}': json.loads((SOURCE / f'ile{i}' / f'ile{i}.json').read_text()) for i in range(1, 16)}
names = {row['map']: row['nom'] for row in plan}
records = []
edges = set()
maps = []
for number in range(1, 16):
    original = f'ile{number}'
    name = f'safari{number}'
    data = source_maps[original]
    assert (data['width'], data['height'], data['tilewidth'], data['tileheight']) == (28, 20, 16, 16)
    layers = {layer['name']: layer for layer in data['layers']}
    assert all(len(layers[n]['data']) == 560 for n in ['coll', 'battle', 'change'])
    links = []
    for obj in layers['liaisons']['objects']:
        props = {p['name']: p['value'] for p in obj.get('properties', [])}
        destination = props.get('destination')
        if destination not in source_maps:
            continue
        x, y = obj['x'] // 16, obj['y'] // 16
        if layers['coll']['data'][y * 28 + x] or not layers['change']['data'][y * 28 + x]:
            continue
        target = int(destination[3:])
        dx, dy = (target - 1) % 5 - (number - 1) % 5, (target - 1) // 5 - (number - 1) // 5
        direction = {(1, 0): 'right', (-1, 0): 'left', (0, 1): 'down', (0, -1): 'up'}[(dx, dy)]
        tx, ty = props['destination_x'], props['destination_y']
        target_coll = next(l['data'] for l in source_maps[destination]['layers'] if l['name'] == 'coll')
        assert target_coll[ty * 28 + tx] == 0, (name, destination, tx, ty)
        links.append({'valX': x, 'valY': y, 'goto': f'safari{target}', 'nexX': tx * 32, 'nexY': ty * 32 + 32, 'edgeDirection': direction})
        edges.add(tuple(sorted([number, target])))
    assert links, name
    source = SOURCE / original
    for extension, target in [(f'{original}.json', ROOT / 'data/maps' / f'{name}.json'),
                              (f'{original}.png', ROOT / 'vue-explorakit/src/assets' / f'{name}.png'),
                              (f'{original}_f.png', ROOT / 'vue-explorakit/src/assets' / f'{name}_f.png')]:
        shutil.copyfile(source / extension, target)
        records.append({'source': f'{original}/{extension}', 'target': str(target.relative_to(ROOT)), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    column = (number - 1) % 5
    # A broad west-to-east rise; all fifteen zones retain useful encounters.
    minimum = 60 + column * 5
    maximum = minimum + 10
    maps.append({'mapName': name, 'safariName': names[original], 'mapchange': links, 'wildpokemon': sorted({p['id'] for p in json.loads((ROOT / 'data/game/safari_encounters.json').read_text())['maps'][name]['grass']}) if (ROOT / 'data/game/safari_encounters.json').exists() else [], 'level': {'min': minimum, 'max': maximum}})
assert len(edges) == 22
# Painted doors are logical links; the original tile/collision arrays stay exact.
for x, y, destination, nx, ny in [(6, 7, 'centre', 416, 480), (20, 12, 'safari_shop', 416, 512)]:
    assert next(l['data'] for l in source_maps['ile8']['layers'] if l['name'] == 'coll')[y * 28 + x] == 0, ('door', x, y)
    maps[7]['mapchange'].append({'valX': x, 'valY': y, 'goto': destination, 'nexX': nx, 'nexY': ny, 'logicalDoor': True})
# The laboratory occupies the separate house immediately east of the town.
assert next(l['data'] for l in source_maps['ile9']['layers'] if l['name'] == 'coll')[5 * 28 + 13] == 0
maps[8]['mapchange'].append({'valX': 13, 'valY': 5, 'goto': 'safari_lab', 'nexX': 416, 'nexY': 576, 'logicalDoor': True})
config_path = ROOT / 'data/game/nextMap.json'
config = json.loads(config_path.read_text())
config['maps'] = [m for m in config['maps'] if not m['mapName'].startswith('safari')] + maps + [
    {'mapName': 'safari_shop', 'mapchange': [{'valX': x, 'valY': 16, 'goto': 'safari8', 'nexX': 20 * 32, 'nexY': 14 * 32} for x in (13, 14)], 'wildpokemon': []},
    {'mapName': 'safari_lab', 'mapchange': [{'valX': x, 'valY': 19, 'goto': 'safari9', 'nexX': 13 * 32, 'nexY': 7 * 32} for x in (13, 14)], 'wildpokemon': []}
]
lobby = next(m for m in config['maps'] if m['mapName'] == 'super_tournament_lobby')
lobby['actionLinks'] = list(dict.fromkeys(lobby.get('actionLinks', []) + ['safari1']))
maps[0]['actionLinks'] = ['super_tournament_lobby']
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
aliases_path = ROOT / 'data/game/mapAliases.json'
aliases = json.loads(aliases_path.read_text())
aliases['aliases']['safari_shop'] = 'gen_shop1'
aliases_path.write_text(json.dumps(aliases, ensure_ascii=False, indent=2) + '\n')
receipt = {'source': str(SOURCE), 'maps': 15, 'grid': [5, 3], 'authoredConnections': len(edges), 'walkableDirectionalLinks': sum(len(m['mapchange']) for m in maps), 'files': records}
(ROOT / 'docs/SAFARI_MAP_IMPORT_2026-11-05.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in receipt.items() if k != 'files'}))
