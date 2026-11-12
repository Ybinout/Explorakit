from pathlib import Path
import urllib.request,json,hashlib
from PIL import Image
root=Path(__file__).resolve().parents[2]
target=root/'vue-explorakit/public/img/pokemon'
manifest_path=root/'vue-explorakit/src/data/pokemonSpriteManifest.json'
manifest=json.loads(manifest_path.read_text());provenance=[]
for folder,urlpath in [('front',''),('back','back/'),('shiny/front','shiny/'),('shiny/back','back/shiny/')]:
 for ident in range(10008,10013):
  url=f'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/{urlpath}{ident}.gif'
  raw=urllib.request.urlopen(url,timeout=30).read();cache=Path('/tmp/riftmon-rotom-assets')/folder/f'{ident}.gif';cache.parent.mkdir(parents=True,exist_ok=True);cache.write_bytes(raw)
  source=Image.open(cache);frames=[];durations=[];bounds=None
  for i in range(source.n_frames):
   source.seek(i);f=source.convert('RGBA');frames.append(f);durations.append(max(1,round(source.info.get('duration',100))))
   b=f.getchannel('A').getbbox()
   if b:bounds=b if bounds is None else tuple(min(bounds[k],b[k])if k<2 else max(bounds[k],b[k])for k in range(4))
  animated=target/'animated'/folder/f'{ident}.webp';poster=target/folder/f'{ident}.png';animated.parent.mkdir(parents=True,exist_ok=True);poster.parent.mkdir(parents=True,exist_ok=True)
  frames[0].save(poster,format='PNG',optimize=True);frames[0].save(animated,format='WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=0,lossless=True,method=4,exact=True)
  decoded=Image.open(animated);assert decoded.size==source.size
  total=0
  for i in range(decoded.n_frames):decoded.seek(i);decoded.load();total+=decoded.info.get('duration',0)
  assert total==sum(durations)
  manifest[folder+'/'+str(ident)]={'size':list(source.size),'bounds':list(bounds),'frames':len(frames),'durationMs':total}
  provenance.append({'id':ident,'folder':folder,'url':url,'sourceSha256':hashlib.sha256(raw).hexdigest(),'frames':len(frames),'size':list(source.size)})
manifest_path.write_text(json.dumps(manifest,separators=(',',':'))+'\n')
p=root/'data/vendor/pokeapi/rotom-sprite-sources.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps({'source':'PokeAPI/sprites BW animated forms','files':provenance},indent=2)+'\n')
print(json.dumps({'imported':len(provenance),'animated':sum(p['frames']>1 for p in provenance)}))
