"""Pack newly drawn overhead sprites; only crop/alpha cleanup/nearest-neighbour scaling.
Existing furniture bounds, all front/back cells and all bed views stay unchanged.
"""
from pathlib import Path
from PIL import Image
import json,argparse
root=Path(__file__).resolve().parents[1];assets=root/'vue-explorakit/src/assets'
p=argparse.ArgumentParser();p.add_argument('--sources',default='/home/ubuntu/.codex/generated_images/01a12b53-6548-7a53-b36a-05641c599196');args=p.parse_args();base=Path(args.sources)
A='exec-44747653-2a7b-4e39-8dd8-61e4c2dc327a.png';B='exec-7fbcc46e-ce91-4099-a1ab-09a8084f9db8.png';BLUE='exec-cd2c23b2-a12f-4a78-ad49-5b1c4820e42b.png'
# Boundaries lie in inspected transparent row gaps, so tall cushions never get cropped.
bounds={A:[0,267,478,777,1017,1281,1536],B:[0,270,538,867,1052,1248,1536],BLUE:[0,1198]}
replacements={0:(A,0),1:(A,1),2:(BLUE,0),4:(A,3),5:(A,4),10:(A,5),12:(B,0),14:(B,1),15:(B,2),17:(B,3),20:(B,4),21:(B,5)}
metrics=json.loads((root/'vue-explorakit/src/data/housingArt.json').read_text())
atlas=Image.open(assets/'housing/furniture-rotations-v3.png').convert('RGBA')
for row,(filename,sourceRow) in replacements.items():
 im=Image.open(base/filename).convert('RGBA');ys=bounds[filename]
 # The dedicated blue pair is a single complete row irrespective of generated height.
 if filename==BLUE:ys=[0,im.height]
 for column,face in enumerate([1,3]):
  cell=im.crop((round(column*im.width/2),ys[sourceRow],round((column+1)*im.width/2),ys[sourceRow+1]))
  alpha=cell.getchannel('A').point(lambda v:255 if v>=190 else 0);cell.putalpha(alpha);box=alpha.getbbox();assert box,(row,face)
  m=metrics['orientations'][row][face];w,h=m['w'],m['h'];sprite=cell.crop(box).resize((w,h),Image.Resampling.NEAREST)
  atlas.paste((0,0,0,0),(face*64,row*64,(face+1)*64,(row+1)*64));atlas.paste(sprite,(face*64+(64-w)//2,row*64+64-h))
atlas.save(assets/'housing/furniture-rotations-v4.png',optimize=True)
im=Image.open(base/'exec-064a10af-36de-4a8f-a58c-230a6c77159b.png').convert('RGBA');alpha=im.getchannel('A').point(lambda v:255 if v>=190 else 0);im.putalpha(alpha);im=im.crop(alpha.getbbox()).resize((48,68),Image.Resampling.NEAREST);im.save(assets/'casino/slot-cabinet-v4.png',optimize=True)
