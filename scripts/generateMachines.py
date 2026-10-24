"""Pinned Gen IV TM/HM catalogue, renamed CS, with machine-only compatibility."""
import csv, json, pathlib, sys, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
REV='81d20919845b6a445969b9265aab5cec6b04cece'
BASE=f'https://raw.githubusercontent.com/PokeAPI/pokeapi/{REV}/data/v2/csv/'
CACHE=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data/vendor/pokeapi/machine-cache'
CACHE.mkdir(parents=True,exist_ok=True)
def rows(name):
 p=CACHE/name
 if not p.exists():p.write_bytes(urllib.request.urlopen(BASE+name,timeout=90).read())
 return csv.DictReader(p.open())
classic={int(r['move_id']) for r in rows('machines.csv') if int(r['version_group_id']) in [8,9,10]}
catalog={m['id']:m for m in json.loads((ROOT/'data/game/moves.json').read_text())}
assert classic<=catalog.keys(),classic-catalog.keys()
slugs={int(r['id']):r['identifier'] for r in rows('moves.csv')}
french={int(r['move_id']):r['name'] for r in csv.DictReader((ROOT/'data/vendor/pokeapi/move_names.csv').open()) if r['local_language_id']=='5'}
compatible={m:set() for m in classic}
for r in rows('pokemon_moves.csv'):
 p,v,m,method=map(lambda k:int(r[k]),['pokemon_id','version_group_id','move_id','pokemon_move_method_id'])
 if p<=809 and m in classic and method==4 and (v in [8,9,10] if p<=493 else v==(19 if p>=808 else 18)):compatible[m].add(p)
machines={}
for id in sorted(classic):
 m=catalog[id];power=m.get('power') or 0
 key='cs_'+slugs[id].replace('-','_')
 machines[key]={'move':m['ename'],'moveId':id,'name':'CS '+french[id],'type':m['type'],'price':5000 if power>=100 else 4000 if power>=80 else 3000,'species':sorted(compatible[id])}
meta={'source':BASE,'scope':'CT/CS Diamond/Pearl, Platinum and HGSS, no field traversal effects. Compatibility: machine method only, Gen IV for species 1–493; USUM / Let’s Go for later existing species.','machines':machines}
(ROOT/'data/game/machines.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
(ROOT/'vue-explorakit/src/data/machines.json').write_text(json.dumps(machines,ensure_ascii=False,separators=(',',':'))+'\n')
p=ROOT/'data/game/items.json';items=json.loads(p.read_text());items['items']=[i for i in items['items'] if i.get('category')!='machine']
for key,m in machines.items():items['items'].append({'key':key,'name':m['name'],'category':'machine','buy_price':0,'sell_price':0,'description':f"Apprend {french[m['moveId']]} à un Pokémon compatible. Une utilisation ; consommée uniquement après l’apprentissage.",'machineMove':m['move']})
p.write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
p=ROOT/'data/game/department_store.json';store=json.loads(p.read_text());floor=store['floors']['tour_etage1'];floor['description']='Vitamines, relances d’IV, remise à zéro des EV et CS pour apprendre des attaques.'
floor['offers']={k:v for k,v in floor['offers'].items() if not k.startswith('cs_')};floor['offers'].update({k:{'price':m['price'],'requiredTier':2} for k,m in machines.items()});p.write_text(json.dumps(store,ensure_ascii=False,indent=2)+'\n')
print(f'{len(machines)} CS; {sum(len(m["species"]) for m in machines.values())} compatibilities')
