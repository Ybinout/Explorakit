"""Pack converted sprites deterministically for version control; no pixel changes."""
import argparse, gzip, hashlib, io, json, pathlib, tarfile
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--preserve-layout",action="store_true",help="Keep existing archive memberships while updating images")
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]/'vue-explorakit'
source=root/'public/img/pokemon'
target=root/'assets/pokemon'
target.mkdir(parents=True,exist_ok=True)
files=sorted(p for p in source.rglob('*') if p.is_file() and p.suffix in ['.png','.webp'])
packs=[]
groups=[]
group=[]
size=0
for file in files:
    if size+file.stat().st_size>3*1024*1024 and group:
        groups.append(group);group=[];size=0
    group.append(file);size+=file.stat().st_size
if group:groups.append(group)
if args.preserve_layout:
    previous=json.loads((target/'manifest.json').read_text())
    groups=[[source/name for name in pack['files']] for pack in previous['packs']]
    assert {p for group in groups for p in group} == set(files), 'Sprite set changed; rebuild the full layout instead'
    assert all(sum(p.stat().st_size for p in group)<16*1024*1024 for group in groups), 'Archive exceeds safe extraction size'
for i,group in enumerate(groups):
    buffer=io.BytesIO();entries={}
    with tarfile.open(fileobj=buffer,mode='w',format=tarfile.USTAR_FORMAT) as tar:
        for file in group:
            data=file.read_bytes();name=str(file.relative_to(source));info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;tar.addfile(info,io.BytesIO(data))
            entries[name]={'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    data=gzip.compress(buffer.getvalue(),compresslevel=6,mtime=0);name=f'sprites-{i:03}.tar.gz';(target/name).write_bytes(data)
    packs.append({'file':name,'sha256':hashlib.sha256(data).hexdigest(),'files':entries})
(target/'manifest.json').write_text(json.dumps({'version':1,'format':'lossless WebP animations and PNG thumbnails','packs':packs},separators=(',',':'))+'\n')
print(json.dumps({'packs':len(packs),'files':len(files),'bytes':sum((target/p['file']).stat().st_size for p in packs)}))
