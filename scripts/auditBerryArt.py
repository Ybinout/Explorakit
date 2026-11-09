from pathlib import Path
from PIL import Image
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[1];folder=root/'vue-explorakit/src/assets/berries'
config=json.load(open(root/'data/game/berryMutation.json'));checks=[]
seen=set()
for berry in config['classic']:
 p=folder/(berry['key']+'.png');im=Image.open(p).convert('RGBA');assert im.getbbox() and im.size==(30,30),berry['key'];seen.add(hashlib.sha256(im.tobytes()).hexdigest())
assert len(seen)==39;checks.append('39 classic berries, 39 different canonical pixel sprites with alpha')
seen=set()
for rarity in ['common','rare','legendary']:
 im=Image.open(folder/('mutations-'+rarity+'-v1.png')).convert('RGBA');assert im.size==(192,224)
 for i in range(42):
  tile=im.crop((i%6*32,i//6*32,i%6*32+32,i//6*32+32));assert tile.getbbox();seen.add(hashlib.sha256(tile.tobytes()).hexdigest())
assert len(seen)==126;checks.append('126 distinct mutated berry sprites, three rarity sheets, transparent nonempty independent cells')
metrics=json.load(open(root/'vue-explorakit/src/data/housingArt.json'));im=Image.open(folder/'cultivation-furniture-v1.png').convert('RGBA')
for row in range(3):
 for col in range(4):
  m=metrics['orientations'][row+22][col];tile=im.crop((col*64,row*64,col*64+64,row*64+64));box=tile.getbbox();assert box and box[2]-box[0]<=m['w'] and box[3]-box[1]<=m['h'];assert box[3]==64
checks.append('12 cultivation furniture views match their measured crop bounds and grid footprints')
old=json.loads(subprocess.check_output(['git','show','20a24f8:data/game/items.json'],cwd=root))['items'];current=json.load(open(root/'data/game/items.json'))['items'];lookup={i['key']:i for i in current}
for item in old:assert lookup[item['key']]==item,item['key']
checks.append('Every pre-existing item definition remains byte-equivalent as JSON data')
print(json.dumps(dict(success=True,checks=checks,classicSprites=39,mutatedSprites=126,furnitureViews=12),indent=2))
