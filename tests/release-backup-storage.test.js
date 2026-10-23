const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');

test('backup dedup preserves bytes, paths, metadata, symlinks and distinct content; repeated runs are idempotent', () => {
 const code = `
import tempfile, pathlib, os, importlib.util
spec=importlib.util.spec_from_file_location('dedup','scripts/deduplicateReleaseBackups.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory)
 for release in ['first','second']:
  p=root/release/'dist-before';p.mkdir(parents=True)
  for name,data in [('same',b'unchanged'),('different',release.encode()),('mode',b'permissions'),('mtime',b'date')]:
   f=p/name;f.write_bytes(data);os.utime(f,ns=(1000000000,1000000000))
 os.chmod(root/'second/dist-before/mode',0o600)
 os.utime(root/'second/dist-before/mtime',ns=(2000000000,2000000000))
 (root/'second/dist-before/link').symlink_to(root/'first/dist-before/same')
 live=root/'live';live.mkdir();(live/'same').write_bytes(b'unchanged')
 paths=[p for p in root.rglob('*') if p.is_file() and not p.is_symlink()]
 before={p:(p.read_bytes(),p.stat().st_mode,p.stat().st_mtime_ns) for p in paths}
 dry=m.deduplicate(root);assert dry['duplicates']==1
 assert (root/'first/dist-before/same').stat().st_ino != (root/'second/dist-before/same').stat().st_ino
 result=m.deduplicate(root,True);assert result['duplicates']==1
 assert (root/'first/dist-before/same').stat().st_ino == (root/'second/dist-before/same').stat().st_ino
 assert before=={p:(p.read_bytes(),p.stat().st_mode,p.stat().st_mtime_ns) for p in paths}
 assert m.deduplicate(root,True)['duplicates']==0
 assert (root/'second/dist-before/link').is_symlink()
 `;
 const r=spawnSync('python3',['-c',code],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(r.status,0,r.stderr);
});
