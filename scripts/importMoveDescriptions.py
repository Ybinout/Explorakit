"""Extend pinned French descriptions for the actual move catalogue (offline CSV cache)."""
import csv, hashlib, json, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
cache=pathlib.Path(sys.argv[1]); ref=json.loads((ROOT/'data/vendor/pokeapi/learnsets.gen7.json').read_text())
path=ROOT/'data/vendor/pokeapi/reference-texts.fr.json'; output=json.loads(path.read_text()); latest={}
for row in csv.DictReader((cache/'move_flavor_text.csv').open()):
    if row['language_id']!='5' or int(row['version_group_id'])>18: continue
    id=int(row['move_id']); version=int(row['version_group_id'])
    if id not in latest or version>=latest[id][0]:latest[id]=(version,' '.join(row['flavor_text'].split()))
def normalize(n):
    n=re.sub('[^a-z0-9]','',n.lower());return {'vicegrip':'visegrip','hijumpkick':'highjumpkick','smellingsalt':'smellingsalts'}.get(n,n)
ids={normalize(m['name']):int(i) for i,m in ref['moves'].items()}
for move in json.loads((ROOT/'data/game/moves.json').read_text()):
    if move['ename'] in output['moves']:continue
    id=ids[normalize(move['ename'])];version,text=latest[id]
    output['moves'][move['ename']]={'id':id,'versionGroup':version,'text':text}
output['sourceSha256']['move_flavor_text.csv']=hashlib.sha256((cache/'move_flavor_text.csv').read_bytes()).hexdigest()
text=json.dumps(output,ensure_ascii=False,indent=2)+'\n'
if '--check' in sys.argv:assert path.read_text()==text
else:path.write_text(text)
print(json.dumps({'moves':len(output['moves'])}))
