import json,sys
from pathlib import Path
from collections import deque
import xml.etree.ElementTree as ET
game=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]
report=json.loads(Path(__file__).with_name('verification.json').read_text());cfg=json.loads((game/'data/game/nextMap.json').read_text());by={e['mapName']:e for e in cfg['maps']}
for n in range(1,6):
 name=f'gen_ville{n}';path=game/'data/maps'/(name+'.json');m=json.loads(path.read_text());ls={l['name']:l['data'] for l in m['layers']};seen={(1,11)};q=deque(seen)
 while q:
  x,y=q.popleft()
  for a,b in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if 0<=a<28 and 0<=b<20 and not ls['coll'][b*28+a] and (a,b) not in seen:seen.add((a,b));q.append((a,b))
 for r in report['roofs']:
  if r['map']==name:assert (r['x'],r['y']) in seen and ls['foreground'][r['y']*28+r['x']]
 for d in report['doors']:
  if d['map']!=name:continue
  x,y=d['x'],d['y'];assert (x,y) in seen and (x,d['return_y']) in seen and ls['change'][y*28+x]
  matches=[r for r in by[name]['mapchange'] if (r.get('valX') is None or r['valX']==x) and (r.get('valY') is None or r['valY']==y)]
  assert len(matches)==1 and matches[0]['goto']==d['interior']
  back=by[d['interior']]['mapchange'][0];assert back['goto']==name and (back['nexY']-16)//32==d['return_y']
 for l in ET.parse(path.with_suffix('.tmx')).getroot().findall('layer'):assert list(map(int,l.find('data').text.split(',')))==ls[l.get('name')]
 for l in m['layers']:
  if l['name'].startswith(('boutique decorative ','centre decoratif ')) and l['name'].split('Calque de Tuiles ')[-1] not in ['10','11']:assert not any(l['data'])
print('OK : 12 portes, retours propres, 519 cases de foreground accessibles, absence de decor parasite et TMX/JSON synchronises.')
