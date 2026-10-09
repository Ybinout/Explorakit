import json,sys,struct
from pathlib import Path
from collections import deque
import xml.etree.ElementTree as ET
game=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]
for name in ['gen_maison1','gen_maison2','gen_maison3','gen_shop1']:
 path=game/'data/maps'/(name+'.json');m=json.loads(path.read_text(encoding='utf-8'));ls={l['name']:l['data'] for l in m['layers']}
 assert (m['width'],m['height'],m['tilewidth'],m['tileheight'])==(28,20,16,16)
 root=ET.parse(path.with_suffix('.tmx')).getroot()
 for l in root.findall('layer'):assert list(map(int,l.find('data').text.split(',')))==ls[l.get('name')]
 for t in m['tilesets']:
  tsx=(path.parent/t['source']).resolve();tr=ET.parse(tsx).getroot();assert (tsx.parent/tr.find('image').get('source')).is_file()
 c=ls['coll'];change=ls['change'];seen={(13,16)};q=deque(seen);assert not c[16*28+13]
 while q:
  x,y=q.popleft()
  for a,b in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if 0<=a<28 and 0<=b<20 and not c[b*28+a] and (a,b) not in seen:seen.add((a,b));q.append((a,b))
 assert all(v or (i%28,i//28) in seen for i,v in enumerate(c))
 assert sum(bool(v) for v in change)==2 and not any(a and b for a,b in zip(c,change)) and not any(ls['battle'])
 for suffix in ['', '_f']:
  b=(game/'vue-explorakit/src/assets'/(name+suffix+'.png')).read_bytes();assert struct.unpack('>II',b[16:24])==(448,320)
cfg=json.loads((game/'data/game/gen_interieurs_nextMap.entries.json').read_text(encoding='utf-8'))
for e in cfg['maps']:
 r=e['mapchange'][0];dest=json.loads((game/'data/maps'/(r['goto']+'.json')).read_text(encoding='utf-8'));ls={l['name']:l['data'] for l in dest['layers']}
 i=((r['nexY']-16)//32)*28+(r['nexX']+16)//32;assert not ls['coll'][i] and not ls['change'][i]
print('OK : 3 maisons et 1 shop, mobilier, sorties, images, portes exterieures et destinations verifies.')
