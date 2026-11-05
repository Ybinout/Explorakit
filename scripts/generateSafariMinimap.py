"""Derive a small pixel atlas from the authored Safari terrain, without editing art."""
import json, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
colors={'ocean':None,'rivage':'#e8d89d','prairie':'#b7cf7d','chemins':'#cfac72','place':'#c1bda2','lacs':'#62b9c3'}
grid=[[None]*140 for _ in range(60)]
for n in range(1,16):
    world=json.loads((root/f'data/maps/safari{n}.json').read_text());ox=(n-1)%5*28;oy=(n-1)//5*20
    for layer in world['layers']:
        if layer['name'] not in colors:continue
        for i,gid in enumerate(layer['data']):
            if gid:grid[oy+i//28][ox+i%28]=colors[layer['name']]
paths={color:[] for color in colors.values() if color}
for y,row in enumerate(grid):
    x=0
    while x<140:
        color=row[x];end=x+1
        while end<140 and row[end]==color:end+=1
        if color:paths[color].append(f'M{x*2.1:g} {y*2.1:g}h{(end-x)*2.1:g}v2.1h{-(end-x)*2.1:g}Z')
        x=end
data={'layers':[{'color':color,'path':''.join(parts)} for color,parts in paths.items()]}
(root/'vue-explorakit/src/data/safariMinimap.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
