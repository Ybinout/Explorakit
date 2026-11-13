"""Read authored tile pixels into a tiny canvas patch; never rewrite map assets."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/home/ubuntu/dev/ile_2/sources_tiled/teset2.png')
atlas = Image.open(source).convert('RGBA')
rows = []
for tile in [2558, 2280]:
    def at(gid, x, y):
        return atlas.getpixel((((gid-1)%140)*16+x, ((gid-1)//140)*16+y))
    for y in range(16):
        pixels = []
        for x in range(16):
            base = at(2802,x,y)
            top = at(tile,x,y)
            a = top[3]/255
            pixels.append('#'+''.join(f'{round(top[i]*a+base[i]*(1-a)):02x}' for i in range(3)))
        runs = []
        for x,color in enumerate(pixels):
            if runs and runs[-1][2] == color:
                runs[-1][1] += 1
            else:
                runs.append([x,1,color])
        rows.append(runs)
data = {'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'patches':[{'map':'ville_safe1','x':25,'y':8,'w':1,'h':2,'walkable':[[25,8],[25,9]],'floorGids':[2802,2558,2280],'rows':rows}]}
text = json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n'
for p in ['data/game/worldDecorEdits.json','vue-explorakit/src/data/worldDecorEdits.json']:
    (root/p).write_text(text)
print('Exported two floor cells. Authored PNG/JSON/TMX files unchanged.')
