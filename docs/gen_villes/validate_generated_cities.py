import json,struct,sys
from pathlib import Path
from collections import deque
import xml.etree.ElementTree as ET
game=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parents[2]
docs=game/'docs/gen_villes';pool={}
def flood(c,start):
    assert not c[start[1]*28+start[0]];seen={start};q=deque(seen)
    while q:
        x,y=q.popleft()
        for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
            if 0<=nx<28 and 0<=ny<20 and not c[ny*28+nx] and (nx,ny) not in seen:seen.add((nx,ny));q.append((nx,ny))
    return seen
for n in range(1,6):
    for inside in [False,True]:
        name=f'gen_arene{n}' if inside else f'gen_ville{n}';path=game/'data/maps'/(name+'.json');m=json.loads(path.read_text(encoding='utf-8'));pool[name]=m
        assert (m['width'],m['height'],m['tilewidth'],m['tileheight'])==(28,20,16,16)
        ls={l['name']:l['data'] for l in m['layers']};assert {'coll','change','battle','int','foreground'}<=ls.keys()
        assert all(len(l['data'])==560 and l['width']==28 and l['height']==20 for l in m['layers'])
        xml=ET.parse(path.with_suffix('.tmx')).getroot();byid={str(l['id']):l for l in m['layers']}
        for l in xml.findall('layer'):assert [int(v.strip()) for v in l.find('data').text.split(',')]==byid[l.get('id')]['data']
        ranges=[]
        for t in m['tilesets']:
            tsx=(path.parent/t['source']).resolve();assert tsx.is_file();troot=ET.parse(tsx).getroot();ranges.append((t['firstgid'],t['firstgid']+int(troot.get('tilecount'))))
            assert (tsx.parent/troot.find('image').get('source')).resolve().is_file()
        assert all(g==0 or any(lo<=g<hi for lo,hi in ranges) for l in m['layers'] for g in l['data'])
        for t in xml.findall('tileset'):assert (path.parent/t.get('source')).resolve().is_file()
        for suffix in ['', '_f']:
            p=game/'vue-explorakit/src/assets'/(name+suffix+'.png');b=p.read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',b[16:24])==(448,320)
        c=ls['coll'];t=ls['change'];assert not any(x and y for x,y in zip(c,t)) and not any(ls['battle']) and not any(ls['int'])
        expected_changes = 2 if inside else (7 if n == 4 else 8)
        assert sum(bool(v) for v in t)==expected_changes
        seen=flood(c,(13,16) if inside else (1,11));assert all(v or (i%28,i//28) in seen for i,v in enumerate(c))
        if inside:
            props={p['name']:p['value'] for p in m['properties']}
            champion=tuple(map(int,props['champion_position'].split(',')))
            assert champion in seen and (13,17) in seen and (14,17) in seen
        if not inside:
            props={p['name']:p['value'] for p in m['properties']}
            assert (26,11) in seen and props['arene']==f'gen_arene{n}'
            dx,dy=map(int,props['arena_door'].split(','));ax,ay=map(int,props['arena_approach'].split(','))
            assert dx==ax and dy<ay and t[dy*28+dx]
            for yy in range(dy,ay+1):
                assert (dx,yy) in seen and not c[yy*28+dx]
                if yy>dy:assert not t[yy*28+dx]
facades=[next(p['value'] for p in pool[f'gen_ville{n}']['properties'] if p['name']=='arena_facade') for n in range(1,6)]
assert len(set(facades))==5
active=json.loads((game/'data/game/nextMap.json').read_text(encoding='utf-8'))
generated_names={f'gen_route{n}' for n in range(1,9)}|{f'gen_ville{n}' for n in range(1,6)}|{f'gen_arene{n}' for n in range(1,6)}|{'gen_maison1','gen_maison2','gen_maison3','gen_shop1'}
cfg={'maps':[entry for entry in active['maps'] if entry['mapName'] in generated_names]};assert len(cfg['maps'])==22
pool|={f'gen_route{n}':json.loads((game/'data/maps'/f'gen_route{n}.json').read_text(encoding='utf-8')) for n in range(1,9)}
pool['route3']=json.loads((game/'data/maps/route3.json').read_text(encoding='utf-8'));pool['route4']=json.loads((game/'data/maps/route4.json').read_text())
for name in ['gen_maison1','gen_maison2','gen_maison3','gen_shop1']:
    pool[name]=json.loads((game/'data/maps'/(name+'.json')).read_text(encoding='utf-8'))
count=0
for e in cfg['maps']:
    change=next(l['data'] for l in pool[e['mapName']]['layers'] if l['name']=='change')
    for i,g in enumerate(change):
        if not g:continue
        x=i%28;y=i//28
        matches=[r for r in e['mapchange'] if (r.get('valX') is None or r.get('valX')==x) and (r.get('valY') is None or r.get('valY')==y) and (r.get('valX') is not None or r.get('valY') is not None)]
        assert len(matches)==1
        r=matches[0];dest=pool[r['goto']];d={l['name']:l['data'] for l in dest['layers']};nx=(r['nexX']+16)//32;ny=(r['nexY']-16)//32
        assert 0<=nx<28 and 0<=ny<20 and not d['coll'][ny*28+nx] and not d['change'][ny*28+nx];count+=1
print(f'OK : 5 villes, 5 arenes, TMX/JSON/images/tilesets et {count} cases de passage avec destination libre.')
