"""Apply pinned PokéAPI reference metadata to newly playable base species 494..649.

Usage: python3 scripts/importGenerationFiveMetadata.py /path/to/pokeapi-csv-cache
Preserves all existing species, game balance and the game's established XP formula.
"""
import csv
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path(sys.argv[1])
REVISION = '81d20919845b6a445969b9265aab5cec6b04cece'
def rows(name):
    with (CACHE / name).open() as stream:
        return list(csv.DictReader(stream))
species = {int(p['id']): p for p in rows('pokemon_species.csv')}
names = {(int(p['pokemon_species_id']), int(p['local_language_id'])): p['name'] for p in rows('pokemon_species_names.csv')}
stats = {}
for row in rows('pokemon_stats.csv'):
    stats.setdefault(int(row['pokemon_id']), {})[int(row['stat_id'])] = int(row['base_stat'])
experience = {int(row['growth_rate_id']): int(row['experience']) for row in rows('experience.csv') if int(row['level']) == 100}
dex_path = ROOT / 'data/game/pokedex.json'
dex = json.loads(dex_path.read_text())
before = json.loads(dex_path.read_text())
stat_names = {1: 'HP', 2: 'Attack', 3: 'Defense', 4: 'Sp. Attack', 5: 'Sp. Defense', 6: 'Speed'}
for pokemon in dex:
    id = pokemon['id']
    if not 494 <= id <= 649:
        continue
    assert id in species and set(stats[id]) == set(stat_names)
    pokemon['name']['french'] = names[(id, 5)]
    pokemon['name']['english'] = names[(id, 9)]
    pokemon['base'] = {name: stats[id][key] for key, name in stat_names.items()}
    pokemon['exp'] = experience[int(species[id]['growth_rate_id'])]
assert [p for p in before if not 494 <= p['id'] <= 649] == [p for p in dex if not 494 <= p['id'] <= 649]
dex_path.write_text(json.dumps(dex, ensure_ascii=False, indent=2) + '\n')
report = {'source': 'https://github.com/PokeAPI/pokeapi/tree/' + REVISION + '/data/v2/csv', 'revision': REVISION,
          'sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in CACHE.glob('*.csv')},
          'newlyPlayable': 156, 'scope': [494, 649], 'legacySpeciesUnchanged': True,
          'experience': 'Real growth category mapped onto the existing RiftMon curve; saved experience_rate remains authoritative',
          'species': [{'id': p['id'], 'fr': p['name']['french'], 'en': p['name']['english'], 'exp': p['exp']} for p in dex if 494 <= p['id'] <= 649]}
(ROOT / 'docs/GENERATION_FIVE_METADATA_2026-11-05.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ['sha256', 'species']}))
