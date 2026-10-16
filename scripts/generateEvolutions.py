"""Offline base-form evolutions (species 1–809), with explicit solo adaptations."""
import csv
import io
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
REVISION = '81d20919845b6a445969b9265aab5cec6b04cece'
URL = f'https://raw.githubusercontent.com/PokeAPI/pokeapi/{REVISION}/data/v2/csv/'


def rows(name):
    raw = (pathlib.Path(sys.argv[1]) / name).read_text() if len(sys.argv) > 1 else urllib.request.urlopen(URL + name, timeout=30).read().decode()
    return list(csv.DictReader(io.StringIO(raw)))


species = {int(row['id']): row for row in rows('pokemon_species.csv') if int(row['id']) <= 809}
moves = {move['id']: move for move in json.loads((ROOT / 'data/game/moves.json').read_text())}
move_names = {int(row['move_id']): row['name'] for row in csv.DictReader((ROOT / 'data/vendor/pokeapi/move_names.csv').open()) if row['local_language_id'] == '5'}
stones = json.loads((ROOT / 'data/game/stone_evolutions.json').read_text())['rules']
stone_pairs = {(rule['from'], rule['to']) for rule in stones}
rules = {}
for row in rows('pokemon_evolution.csv'):
    target = int(row['evolved_species_id'])
    if target not in species:
        continue
    origin = species[target]['evolves_from_species_id']
    if not origin or row['evolution_trigger_id'] == '3':
        continue
    if row['required_pokemon_form_id'] not in ['', origin] or row['evolved_pokemon_form_id'] not in ['', str(target)] or row['region_id']:
        continue
    pair = (int(origin), target)
    # Preserve the stone branches already available in RiftMon, including modern alternatives.
    if pair in stone_pairs:
        continue
    trigger = int(row['evolution_trigger_id'])
    level = int(row['minimum_level'] or 1)
    notes = []
    if trigger == 2:
        level = max(level, 40 if row['held_item_id'] or row['trade_species_id'] else 36)
        notes.append('Échange remplacé par un niveau, sans objet à fournir.')
    if row['minimum_happiness'] or row['minimum_affection']:
        level = max(level, {169: 32, 183: 12, 242: 30, 542: 30, 773: 40}.get(target, 20))
        notes.append('Bonheur ou affection remplacés par un seuil de niveau.')
    if row['minimum_beauty']:
        level = max(level, 30)
        notes.append('Beauté remplacée par le niveau 30.')
    if trigger == 1 and row['held_item_id']:
        level = max(level, 20 if target == 113 else 40)
        notes.append('Objet spécial remplacé par un niveau, sans consommation.')
    if row['party_species_id'] or row['party_type_id']:
        level = max(level, 32)
        notes.append('Condition d’équipe remplacée par le niveau 32.')
    if row['time_of_day']:
        notes.append('Accessible à toute heure.')
    if row['needs_overworld_rain'] == '1':
        notes.append('La pluie n’est pas nécessaire dans RiftMon.')
    if row['turn_upside_down'] == '1':
        notes.append('Aucun geste avec le téléphone n’est nécessaire.')
    if trigger == 4:
        level = 20
        notes.append('Choix alternatif à Ninjask ; ne crée pas un second Pokémon.')
    elif trigger == 17:
        level = 40
        notes.append('Bonbons spéciaux remplacés par le niveau 40.')
    elif trigger not in [1, 2]:
        raise ValueError(f'Unhandled trigger: {row}')
    if row['location_id']:
        raise ValueError(f'Unhandled location outside stone rules: {row}')
    rule = {'from': pair[0], 'to': target, 'level': level}
    if row['gender_id']:
        rule['gender'] = 'female' if row['gender_id'] == '1' else 'male'
    if row['relative_physical_stats']:
        rule['relativeStats'] = int(row['relative_physical_stats'])
    if row['known_move_id']:
        move = moves[int(row['known_move_id'])]
        rule['move'] = move['ename']
        rule['moveName'] = move_names.get(move['id'], move['ename'])
    if row['known_move_type_id']:
        assert row['known_move_type_id'] == '18'
        rule['moveType'] = 'Fairy'
    if row['condition_expression']:
        assert pair[0] == 265
        # The branch is stable per UUID, including after reloading older saves.
        rule['personalityBranch'] = 0 if target == 266 else 1
    if target == 678:
        rule.pop('gender', None)
        notes.append('Les deux sexes évoluent en Mistigrix, dans la forme visuelle disponible.')
    if notes:
        rule['adaptation'] = ' '.join(notes)
    old = rules.get(pair)
    if not old or level < old['level']:
        rules[pair] = rule

# Leave room to use an intermediate species before its adapted final evolution.
for rule in rules.values():
    if 'adaptation' in rule and 'Échange' in rule['adaptation']:
        incoming = [r['level'] for r in rules.values() if r['to'] == rule['from']]
        if incoming:
            rule['level'] = max(rule['level'], min(incoming) + 10)

data = {'version': 1, 'source': URL, 'scope': 'Base forms, species 1–809. Species levels and supported move/gender/stat conditions; explicit solo adaptations. Stone branches remain separate.',
        'rules': sorted(rules.values(), key=lambda rule: (rule['from'], rule['to']))}
(ROOT / 'data/game/evolutions.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(f'{len(rules)} non-stone evolution branches')
