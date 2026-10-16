"""Generate offline stone evolutions for the game's base forms (Gen 7 species)."""
import csv, io, json, pathlib, sys, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
REVISION = '81d20919845b6a445969b9265aab5cec6b04cece'
URL = f'https://raw.githubusercontent.com/PokeAPI/pokeapi/{REVISION}/data/v2/csv/'
def rows(name):
    raw = (pathlib.Path(sys.argv[1])/name).read_text() if len(sys.argv)>1 else urllib.request.urlopen(URL+name,timeout=30).read().decode()
    return list(csv.DictReader(io.StringIO(raw)))
species = {int(r['id']):r for r in rows('pokemon_species.csv') if int(r['id'])<=809}
items = {r['id']:r['identifier'].replace('-','_') for r in rows('items.csv')}
rules=[]
for row in rows('pokemon_evolution.csv'):
    target=int(row['evolved_species_id']); item=items.get(row['trigger_item_id'],'')
    if target not in species or not item.endswith('_stone') or row['evolution_trigger_id']!='3': continue
    origin=species[target]['evolves_from_species_id']
    if row['required_pokemon_form_id'] not in ['',origin] or row['evolved_pokemon_form_id'] not in ['',str(target)] or row['region_id'] or row['location_id']: continue
    rule={'from':int(species[target]['evolves_from_species_id']), 'to':target,'item':item}
    if row['gender_id']: rule['gender']='female' if row['gender_id']=='1' else 'male'
    if rule not in rules: rules.append(rule)
data={'source':URL,'scope':'Base forms, species 1–809; stone branches only; gender conditions retained.',
      'rules':sorted(rules,key=lambda r:(r['from'],r['to'])),
      'genderRates':{str(k):int(v['gender_rate']) for k,v in species.items()},
      'evolvable':sorted({int(r['evolves_from_species_id']) for r in species.values() if r['evolves_from_species_id']})}
(ROOT/'data/game/stone_evolutions.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print(f'{len(rules)} stone branches')
