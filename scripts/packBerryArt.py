"""Pack reviewed generated pixel sprites; never repaint or recolor pixels."""
from PIL import Image
from pathlib import Path
import json, urllib.request, concurrent.futures, hashlib
root=Path(__file__).resolve().parents[1]; assets=root/'vue-explorakit/src/assets/berries';assets.mkdir(exist_ok=True)
folder=Path('/home/ubuntu/.codex/generated_images/01a12b53-6548-7a53-b36a-05641c599196')
source=Image.open(folder/'exec-2c230ad2-9854-4c82-a9bc-e95c91a7bcc8.png').convert('RGBA')
def cell(im,col,row,cols,rows,size):
 w,h=im.size;b=(round(col*w/cols),round(row*h/rows),round((col+1)*w/cols),round((row+1)*h/rows));q=im.crop(b)
 box=q.getchannel('A').point(lambda a:255 if a>170 else 0).getbbox()
 if not box:raise ValueError('Empty sprite cell')
 q=q.crop(box);ratio=min(size[0]/q.width,size[1]/q.height);return q.resize((max(1,round(q.width*ratio)),max(1,round(q.height*ratio))),Image.Resampling.NEAREST)
furniture=Image.new('RGBA',(256,192));metrics=json.load(open(root/'vue-explorakit/src/data/housingArt.json'));metrics['orientations']=metrics['orientations'][:22]
for row,sizes in enumerate([[(16,16)]*4,[(48,24),(20,48),(48,24),(20,48)],[(32,34),(30,34),(32,34),(30,34)]]):
 out=[]
 for col,size in enumerate(sizes):
  q=cell(source,col,row,4,4,size);furniture.alpha_composite(q,(col*64+(64-q.width)//2,(row+1)*64-q.height));out.append(dict(w=q.width,h=q.height))
 metrics['orientations'].append(out)
furniture.save(assets/'cultivation-furniture-v1.png',optimize=True)
growth=Image.new('RGBA',(128,32))
for col in range(4):
 q=cell(source,col,3,4,4,(22,26));growth.alpha_composite(q,(col*32+(32-q.width)//2,32-q.height))
growth.save(assets/'growth-v1.png',optimize=True)
(root/'vue-explorakit/src/data/housingArt.json').write_text(json.dumps(metrics,indent=2)+'\n')
catalog=json.load(open(root/'data/game/berryMutation.json'))
def fetch(item):
 key=item['key'];url='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/'+key.replace('_','-')+'.png'
 dest=assets/(key+'.png')
 if not dest.exists():dest.write_bytes(urllib.request.urlopen(url,timeout=30).read())
 im=Image.open(dest).convert('RGBA');assert im.getbbox()
 return dict(key=key,url=url,sha256=hashlib.sha256(dest.read_bytes()).hexdigest())
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as e:sources=list(e.map(fetch,catalog['classic']))
(assets/'classic-sources.json').write_text(json.dumps(sources,indent=2)+'\n')
for rarity,filename in [('common','exec-c9075a15-6fde-49b2-a57d-63eca4ecda9d.png'),('rare','exec-4d9c0e9a-4e5f-43cc-b1cf-356385420e7b.png'),('legendary','exec-5033f3a6-1edc-4e53-a42b-3f42370dd9f3.png')]:
 im=Image.open(folder/filename).convert('RGBA');atlas=Image.new('RGBA',(192,224))
 for index,f in enumerate(catalog['families']):
  q=cell(im,index%6,index//6,6,7,(26,26));atlas.alpha_composite(q,(index%6*32+(32-q.width)//2,index//6*32+32-q.height))
 atlas.save(assets/('mutations-'+rarity+'-v1.png'),optimize=True)
