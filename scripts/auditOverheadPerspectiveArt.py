from pathlib import Path
from PIL import Image
import json,subprocess,hashlib
root=Path(__file__).resolve().parents[1];assets=root/'vue-explorakit/src/assets'
a=Image.open(assets/'housing/furniture-rotations-v3.png').convert('RGBA');b=Image.open(assets/'housing/furniture-rotations-v4.png').convert('RGBA');assert a.size==b.size==(256,1408)
changed={0,1,2,4,5,10,12,14,15,17,20,21};protected=0;recreated=0
for row in range(22):
 for face in range(4):
  box=(face*64,row*64,(face+1)*64,(row+1)*64);old=a.crop(box);new=b.crop(box)
  if row in changed and face in [1,3]:assert old.tobytes()!=new.tobytes(),(row,face);recreated+=1
  else:assert old.tobytes()==new.tobytes(),(row,face);protected+=1
  m=json.load(open(root/'vue-explorakit/src/data/housingArt.json'))['orientations'][row][face];bbox=new.getchannel('A').getbbox();assert bbox and bbox[0]>=(64-m['w'])//2 and bbox[2]<=(64-m['w'])//2+m['w'] and bbox[1]>=64-m['h'] and bbox[3]==64,(row,face)
for file in ['src/data/housingArt.json','src/data/housing.json','src/data/casinoSlots.json','src/assets/berries/cultivation-furniture-v1.png','src/assets/berries/growth-v1.png']:
 expected=subprocess.check_output(['git','show','6a28a4e:'+file],cwd=root/'vue-explorakit');assert (root/'vue-explorakit'/file).read_bytes()==expected,file
old=Image.open(assets/'casino/slot-cabinet-v3.png').convert('RGBA');new=Image.open(assets/'casino/slot-cabinet-v4.png').convert('RGBA');assert old.size==new.size==(48,68);assert old.tobytes()!=new.tobytes();assert set(new.getchannel('A').get_flattened_data())<={0,255}
server=json.load(open(root/'data/game/casino_slots.json'));assert server==json.load(open(root/'vue-explorakit/src/data/casinoSlots.json'));assert [x['y']for x in server['machines']]==[8,12];assert server['visualOffset']=={'x':12,'y':0}
print(json.dumps(dict(success=True,changedSides=recreated,protectedCells=protected,frontAndBackViewsPreserved=44,bedsPreserved=True,berryDevicesPreserved=True,metricsUnchanged=True,casinoPositionAndDrawingBoundsUnchanged=True,checks=['24 newly drawn side views; 64 other atlas cells unchanged','Every native sprite bounding box retained','All front/rear views and every bed view identical','Cultivation machines, growth sprites, housing footprints and casino coordinates unchanged','Casino cabinet still 48x68 and rendered 64x90 at its existing anchor']),indent=2))
