import json, struct, re
from pathlib import Path
from collections import deque
import xml.etree.ElementTree as ET
import sys

game=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[2]
docs=game/'docs/gen_routes'
active=json.loads((game/'data/game/nextMap.json').read_text(encoding='utf-8'))
cfg={'maps':[entry for entry in active['maps'] if entry['mapName'].startswith('gen_route')]}
pool={}
for n in range(1,9):
    name=f'gen_route{n}';path=game/'data/maps'/(name+'.json');m=json.loads(path.read_text(encoding='utf-8'));pool[name]=m
    assert (m['width'],m['height'],m['tilewidth'],m['tileheight'])==(28,20,16,16)
    layers={l['name']:l for l in m['layers']}
    assert {'coll','change','battle','foreground','int'}<=layers.keys()
    assert all(len(l['data'])==560 and l['width']==28 and l['height']==20 for l in m['layers'])
    assert all(isinstance(g,int) and (0<=g<=21000 or g in [21001,21033,21041]) for l in m['layers'] for g in l['data'])
    root=ET.parse(path.with_suffix('.tmx')).getroot()
    by_id={str(l['id']):l for l in m['layers']}
    for xml in root.findall('layer'):
        values=[int(v.strip()) for v in xml.find('data').text.split(',')]
        assert values==by_id[xml.get('id')]['data']
    for t in m['tilesets']:assert (path.parent/t['source']).resolve().is_file()
    for t in root.findall('tileset'):assert (path.parent/t.get('source')).resolve().is_file()
    for suffix in ['', '_f']:
        png=game/'vue-explorakit/src/assets'/(name+suffix+'.png');b=png.read_bytes()
        assert b[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',b[16:24])==(448,320)
    c=layers['coll']['data'];b=layers['battle']['data'];t=layers['change']['data']
    assert not any(x and (y or z) for x,y,z in zip(c,b,t))
    assert sum(bool(g) for g in t)==6 and sum(bool(g) for g in b)>0
    start=(1,16 if n==1 else 10);seen={start};q=deque(seen);assert not c[start[1]*28+start[0]]
    while q:
        x,y=q.popleft()
        for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
            if 0<=nx<28 and 0<=ny<20 and not c[ny*28+nx] and (nx,ny) not in seen:seen.add((nx,ny));q.append((nx,ny))
    assert all(g or (i%28,i//28) in seen for i,g in enumerate(c)) and (26,10) in seen
    assert {i%28 for i,g in enumerate(t) if g}=={0,27}
pool['route3']=json.loads((game/'data/maps/route3.json').read_text(encoding='utf-8'))
pool['route4']=json.loads((game/'data/maps/route4.json').read_text())
for e in cfg['maps']:
    assert len(e['mapchange'])==2 and e['wildpokemon'] and 1<=e['level']['min']<=e['level']['max']
    for r in e['mapchange']:
        dest=pool.get(r['goto']) or json.loads((game/'data/maps'/(r['goto']+'.json')).read_text(encoding='utf-8'));ls={l['name']:l['data'] for l in dest['layers']}
        x=(r['nexX']+16)//32;y=(r['nexY']-16)//32
        assert 0<=x<28 and 0<=y<20 and not ls['coll'][y*28+x] and not ls['change'][y*28+x]
print('OK : 8 cartes, 16 passages, TMX/JSON, images, tilesets, collisions et combats.')
