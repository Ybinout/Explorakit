"""Rebuild the twelve shared room backgrounds from the committed atlas (requires Pillow).
Usage: python scripts/buildHousingRooms.py --output /tmp/housing-backgrounds
The map and layout geometry remains data/game/housing.json; no per-owner art.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import json, argparse
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True)
base=Path(parser.parse_args().output);base.mkdir(parents=True,exist_ok=True)
config=json.loads((root/'data/game/housing.json').read_text())
fixtures=json.loads((root/'vue-explorakit/src/data/housingArt.json').read_text())['fixtures']
tiles=Image.open(root/'vue-explorakit/src/assets/housing/architecture-v1.png').convert('RGBA')
def fixture(image,index,x,y,w,h):
 f=next(f for f in fixtures if f['index']==index);sx=index%6*64+(64-f['w'])//2;sy=index//6*64+64-f['h'];im=tiles.crop((sx,sy,sx+f['w'],sy+f['h'])).resize((w,h),Image.Resampling.NEAREST);image.alpha_composite(im,(x,y))
for m in config['models']:
 im=Image.new('RGBA',(448,320),(10,17,26,255));d=ImageDraw.Draw(im)
 def inside(x,y):
  c=m.get('cutout');return m['x']<=x<m['x']+m['w'] and m['y']<=y<m['y']+m['h'] and not(c and c['x']<=x<c['x']+c['w'] and c['y']<=y<c['y']+c['h'])
 for y in range(20):
  for x in range(28):
   if not inside(x,y):continue
   ft=tiles.crop((m['floor']*64,0,m['floor']*64+64,64)).resize((32,32),Image.Resampling.NEAREST);im.alpha_composite(ft.crop(((x%2)*16,(y%2)*16,(x%2+1)*16,(y%2+1)*16)),(x*16,y*16))
   if not inside(x,y-1):
    wt=tiles.crop((m['wall']*64,64,m['wall']*64+64,128)).resize((16,48),Image.Resampling.NEAREST);im.alpha_composite(wt,(x*16,(y-3)*16));d.line((x*16,(y-3)*16,x*16+16,(y-3)*16),fill='#654d3d',width=3);d.line((x*16,y*16,x*16+16,y*16),fill='#634832',width=2)
   if not inside(x-1,y):d.rectangle((x*16-3,y*16,x*16,y*16+16),fill='#725943')
   if not inside(x+1,y):d.rectangle((x*16+15,y*16,x*16+18,y*16+16),fill='#725943')
   if not inside(x,y+1):d.rectangle((x*16,y*16+16,x*16+16,y*16+20),fill='#725943')
 for wx in m['windows']:fixture(im,[12,13,14,18,19][m['windowStyle']],wx*16,(m['y']-3)*16+7,32,32)
 im.convert('RGB').save(base/f'housing_{m["key"]}_upper.png',optimize=True)
 doorx=m['x']+m['w']//2;by=m['y']+m['h'];fixture(im,15,doorx*16-16,by*16-10,32,32)
 im.convert('RGB').save(base/f'housing_{m["key"]}.png',optimize=True)
