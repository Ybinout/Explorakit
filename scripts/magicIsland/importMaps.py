from pathlib import Path
import json,hashlib,shutil
root=Path(__file__).resolve().parents[2]
source=Path('/home/ubuntu/dev/ile_2')
config=json.loads((root/'data/game/nextMap.json').read_text())
names={f'ile2_{i:02}' for i in range(1,5)}
config['maps']=[m for m in config['maps'] if m['mapName'] not in names]
manifest=[]
plan={p['map']:p for p in json.loads((source/'plan.json').read_text())}
for name in sorted(names):
 p=source/(name+'.json');j=json.loads(p.read_text());coll=next(l['data']for l in j['layers']if l['name']=='coll');changes=next(l['data']for l in j['layers']if l['name']=='change')
 links=[]
 for layer in j['layers']:
  for o in layer.get('objects',[]):
   props={q['name']:q['value']for q in o.get('properties',[])}
   if o.get('type')!='transition' or props.get('destination') not in names:continue
   x,y=int(o['x']/16),int(o['y']/16)
   if coll[y*28+x] or not changes[y*28+x]:continue
   a,b=plan[name],plan[props['destination']]
   direction='left' if b['colonne']<a['colonne'] else 'right' if b['colonne']>a['colonne'] else 'up' if b['ligne']<a['ligne'] else 'down'
   assert direction
   links.append(dict(valX=x,valY=y,goto=props['destination'],nexX=props['destination_x']*32,nexY=(props['destination_y']+1)*32,edgeDirection=direction))
 entry=dict(mapName=name,mapchange=links,wildpokemon=[],level=dict(min=1,max=1),canCapture=False,magicIslandName='Île Magique')
 if name=='ile2_04':entry['actionLinks']=['jungle3']
 config['maps'].append(entry)
 
 if not any(l['name']=='int' for l in j['layers']):j['layers'].append(dict(id=99,name='int',type='tilelayer',width=28,height=20,x=0,y=0,opacity=1,visible=False,data=[0]*560))
 (root/'data/maps'/(name+'.json')).write_text(json.dumps(j,separators=(',',':'))+'\n')
 for suffix in ['', '_f']:
  f=source/(name+suffix+'.png');shutil.copyfile(f,root/'vue-explorakit/src/assets'/f.name)
 manifest.append(dict(map=name,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),transitions=len(links)))
for m in config['maps']:
 if m['mapName']=='jungle3':m['actionLinks']=list(dict.fromkeys([*m.get('actionLinks',[]),'ile2_04']))
(root/'data/game/nextMap.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
(root/'île_2/plan.json').write_text((source/'plan.json').read_text())
(root/'île_2/import_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(root/'île_2/README.txt').write_text('Île Magique : quatre cartes auteur importées ; dessins, collisions et raccords conservés. Ajout technique : couche int vide pour les interactions PNJ.\nCartes de jeu : data/maps/ile2_01.json à ile2_04.json.\nFonds et foregrounds : vue-explorakit/src/assets/ile2_*.png.\nSource de livraison : /home/ubuntu/dev/ile_2 ; import reproductible : scripts/magicIsland/importMaps.py.\n')
print(json.dumps(manifest))
