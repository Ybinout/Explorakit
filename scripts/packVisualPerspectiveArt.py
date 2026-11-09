"""Crop and pack the generated RGBA sprites; originals and prompts are in the manifest."""
from pathlib import Path
from PIL import Image
import json
repo=Path(__file__).resolve().parents[1]/'vue-explorakit'
base=Path(json.loads((repo/'src/assets/visual-perspectives-art-2026-11-09.json').read_text())['jobs'][0]['source']).parent
sources={
 'A':('exec-9a91378c-d1d0-444d-924b-d447237e9ea2.png',6),
 'B':('exec-05758b11-1c5b-4cbc-bc1d-e9592d9d8b41.png',7),
 'C':('exec-e1151ac1-ab0a-4976-9bdd-f44e311c431a.png',6)}
# Only sides are replaced. Front, back and ALL bed pixels stay byte-identical.
replacements={0:('A',0,32,28),1:('A',1,16,26),2:('A',2,28,52),4:('C',1,24,38),5:('C',2,24,34),10:('C',0,24,32),12:('C',3,26,38),14:('C',4,24,28),15:('B',3,28,52),17:('B',4,16,22),20:('B',5,16,26),21:('C',5,24,36)}
atlas=Image.open(repo/'src/assets/housing/furniture-rotations-v2.png').convert('RGBA')
metrics=json.loads((repo/'src/data/housingArt.json').read_text())
for index,(key,row,w,h) in replacements.items():
 f,rows=sources[key];im=Image.open(base/f).convert('RGBA')
 for col,face in enumerate([1,3]):
  bounds={'A':[0,263,489,790,1047,1300,1536],'B':[0,253,519,723,1030,1216,1408,1659],'C':[0,264,519,770,1042,1264,1536]}[key]
  cell=im.crop((round(col*im.width/2),bounds[row],round((col+1)*im.width/2),bounds[row+1]))
  a=cell.getchannel('A').point(lambda p:255 if p>=190 else 0);cell.putalpha(a)
  bbox=a.getbbox();assert bbox
  sprite=cell.crop(bbox).resize((w,h),Image.Resampling.NEAREST)
  atlas.paste((0,0,0,0),(face*64,index*64,(face+1)*64,(index+1)*64))
  atlas.paste(sprite,(face*64+(64-w)//2,index*64+64-h))
  metrics['orientations'][index][face]={'w':w,'h':h}
atlas.save(repo/'src/assets/housing/furniture-rotations-v3.png',optimize=True)
(repo/'src/data/housingArt.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2)+'\n')
# Keep all original artwork/colors, use only the generated new isolated cabinet.
im=Image.open(base/'exec-87efe0d7-4284-45ca-a786-875c08e9ee64.png').convert('RGBA');a=im.getchannel('A').point(lambda p:255 if p>=190 else 0);im.putalpha(a);im=im.crop(a.getbbox()).resize((48,68),Image.Resampling.NEAREST)
im.save(repo/'src/assets/casino/slot-cabinet-v3.png',optimize=True)
