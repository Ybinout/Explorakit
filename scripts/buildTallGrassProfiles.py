"""Read-only extraction of authored DC2 grass and the exact terrain beneath it.
No source map or PNG is rewritten. Runtime data is committed; normal builds do
not need the author's source folder or Pillow.
"""
from pathlib import Path
import argparse, base64, hashlib, json
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'vue-explorakit/src/data/worldTallGrass.json'
EXCLUDED={'coll','battle','change','int','foreground','forground','for','for2','leaf','Calque de Tuiles 11'}
def build(source):
    images={};grounds=[];ground_ids={};maps={};checked=0
    def image(name):
        if name not in images:images[name]=Image.open(source/name).convert('RGBA')
        return images[name]
    def tile(gid,sets):
        assert not gid&0xf0000000,'Unexpected flipped tile'
        ts=next(t for t in reversed(sets) if t['firstgid']<=gid)
        index=gid-ts['firstgid'];x=index%ts['columns']*16;y=index//ts['columns']*16
        return image(Path(ts['image']).name).crop((x,y,x+16,y+16))
    reference=json.loads((ROOT/'data/maps/DC2_01.json').read_text());sets=reference['tilesets']
    shape=Image.new('RGBA',(16,32));shape.paste(tile(2818,sets),(0,0));shape.paste(tile(2958,sets),(0,16))
    for file in sorted((ROOT/'data/maps').glob('DC2_*.json')):
        m=json.loads(file.read_text());sets=m['tilesets'];coll=next(l['data'] for l in m['layers'] if l['name']=='coll');decor=next(l['data'] for l in m['layers'] if l['name']=='decor');fore=next(l['data'] for l in m['layers'] if l['name']=='foreground')
        visual=[l for l in m['layers'] if l['type']=='tilelayer' and l['name'] not in EXCLUDED]
        bg=Image.open(ROOT/'vue-explorakit/src/assets'/f'{file.stem.lower()}.png').convert('RGBA');fg=Image.open(ROOT/'vue-explorakit/src/assets'/f'{file.stem.lower()}_f.png').convert('RGBA');entries=[]
        for cell,gid in enumerate(decor):
            if gid!=2958 or coll[cell]:continue
            ground=Image.new('RGBA',(16,16))
            for layer in visual:
                v=layer['data'][cell]
                if v and not(layer['name']=='decor' and v==2958):ground.alpha_composite(tile(v,sets))
            raw=ground.tobytes();index=ground_ids.get(raw)
            if index is None:index=len(grounds);ground_ids[raw]=index;grounds.append(base64.b64encode(raw).decode())
            x=cell%28*16;y=cell//28*16
            expected=ground.copy();expected.alpha_composite(tile(2958,sets))
            assert expected.tobytes()==bg.crop((x,y,x+16,y+16)).tobytes(),(file.name,cell,'background mismatch')
            top=cell>=28 and fore[cell-28]==2818
            if top:
                pixels=tile(2818,sets);actual=fg.crop((x,y-16,x+16,y));
                for n,(a,b) in enumerate(zip(pixels.get_flattened_data(),actual.get_flattened_data())):
                    if a[3]:assert a==b,(file.name,cell,n,'foreground mismatch')
            entries.append([cell,index,int(top)]);checked+=1
        if entries:maps[file.stem]=entries
    return {'version':1,'width':448,'height':320,'tile':16,'shapeWidth':16,'shapeHeight':32,'baseGid':2958,'topGid':2818,'sourceSha256':{name:hashlib.sha256((source/name).read_bytes()).hexdigest()for name in images},'shape':base64.b64encode(shape.tobytes()).decode(),'grounds':grounds,'maps':maps,'verifiedCells':checked}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=Path('/home/ubuntu/dev/DC_2/sources_tiled'));parser.add_argument('--check',action='store_true');args=parser.parse_args()
    data=build(args.source);text=json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n'
    if args.check:assert OUT.read_text()==text,'Tall grass metadata is stale'
    else:OUT.write_text(text)
    print(json.dumps({'maps':len(data['maps']),'verifiedCells':data['verifiedCells'],'groundVariants':len(data['grounds']),'sourceArtUnchanged':True}))
