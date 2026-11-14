"""Build small, normalized battle samples from the supplied ZIPs; no runtime tools.

Usage: python3 scripts/importCombatAudio.py --resources /home/ubuntu/dev --ffmpeg PATH
Missing cries use https://github.com/PokeAPI/cries (source recorded per sample).
Only one INDEX cry per species; all variants/parts remain in the input archives.
"""
import argparse, array, concurrent.futures, gzip, hashlib, io, json, math, re
import subprocess, tarfile, time, unicodedata, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def fold(s):
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())
def sha(b):
    return hashlib.sha256(b).hexdigest()
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--resources', type=Path, required=True)
    ap.add_argument('--ffmpeg', required=True); args = ap.parse_args()
    output = ROOT / 'vue-explorakit/assets/combat-audio'; output.mkdir(parents=True, exist_ok=True)
    cache = Path('/tmp/riftmon-cry-sources'); cache.mkdir(exist_ok=True)
    moves = json.loads((ROOT/'data/game/moves.json').read_text())
    dex = json.loads((ROOT/'data/game/pokedex.json').read_text())
    french = json.loads((ROOT/'vue-explorakit/src/data/gameNames.fr.json').read_text())['moves']
    attack_zip = next(args.resources.glob('*Attack Move*.zip')); archives = sorted(args.resources.glob('*Cries*.zip'))
    supplied = {}; inputs = []
    for archive in archives:
        inputs.append({'file':archive.name, 'bytes':archive.stat().st_size, 'sha256':sha(archive.read_bytes())})
        with zipfile.ZipFile(archive) as z:
            for name in sorted(z.namelist()):
                m = re.fullmatch(r'PLAY_PV_(\d{4}) \[PV=INDEX\]\.wav',name)
                if m and int(m[1]) not in supplied: supplied[int(m[1])] = (z.read(name),archive.name+'/'+name)
    inputs.append({'file':attack_zip.name,'bytes':attack_zip.stat().st_size,'sha256':sha(attack_zip.read_bytes())})
    aliases = {'visegrip':'vicegrip','judgment':'judgement','celebration':'celebrate'}
    jobs = [] ; missing = [] ; entries = {}
    with zipfile.ZipFile(attack_zip) as z:
        sounds = {fold(Path(n).stem):n for n in z.namelist() if n.endswith('.mp3')}
        for m in moves:
            key=aliases.get(fold(m['ename']),fold(m['ename']))
            name=sounds.get(key) or sounds.get(key+'1hit')
            if name:
                jobs.append(('moves/%s.mp3'%m['id'],z.read(name),attack_zip.name+'/'+name))
                entries[str(m['id'])]={'file':'moves/%s.mp3'%m['id'],'name':m['ename'],'label':french.get(m['ename'],m['ename'])}
            else:
                missing.append({'id':m['id'],'name':m['ename'],'label':french.get(m['ename'],m['ename'])})
                entries[str(m['id'])]={'file':None,'name':m['ename'],'label':french.get(m['ename'],m['ename'])}
    def cry_job(p):
        id=p['id']; source=supplied.get(id)
        if not source:
            url='https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/%s.ogg'%id
            file=cache/('%s.ogg'%id)
            if not file.exists():
                for attempt in range(4):
                    try:
                        with urllib.request.urlopen(url,timeout=25) as r: data=r.read()
                        file.write_bytes(data); break
                    except Exception:
                        if attempt==3: raise
                        time.sleep(attempt+1)
            source=(file.read_bytes(),url)
        return ('cries/%s.mp3'%id,*source)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        jobs.extend(pool.map(cry_job,dex))
    def encode(job):
        name,data,source=job
        cmd=[args.ffmpeg,'-v','error','-threads','1','-i','pipe:0','-ac','1','-ar','32000','-t','9','-f','s16le','pipe:1']
        decoded=subprocess.run(cmd,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if decoded.returncode:
            if name.startswith('moves/'):return name,None,{'source':source,'invalid':True,'reason':decoded.stderr.decode(errors='replace').splitlines()[0]}
            raise ValueError(name+' '+source+' '+decoded.stderr.decode(errors='replace'))
        pcm=array.array('h',decoded.stdout)
        # Trim only silence at the boundaries, retaining a short natural tail.
        audible=[i for i,x in enumerate(pcm) if abs(x)>58]
        if not audible: raise ValueError('Silent input '+name)
        begin=max(0,audible[0]-160);end=min(len(pcm),audible[-1]+960)
        pcm=pcm[begin:end];rms=math.sqrt(sum(x*x for x in pcm)/len(pcm))/32768
        peak=max(abs(x) for x in pcm)/32768;gain=min(10,.112/max(rms,1e-8),.72/max(peak,1e-8))
        pcm=array.array('h',(round(x*gain) for x in pcm))
        cmd=[args.ffmpeg,'-v','error','-threads','1','-f','s16le','-ar','32000','-ac','1','-i','pipe:0','-map_metadata','-1','-c:a','libmp3lame','-b:a','64k','-write_xing','0','-id3v2_version','0','-f','mp3','pipe:1']
        encoded=subprocess.run(cmd,input=pcm.tobytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
        return name,encoded,{'source':source,'duration':round(len(pcm)/32000,5),'rms':round(rms*gain,6),'peak':round(peak*gain,6),'size':len(encoded),'sha256':sha(encoded)}
    rendered={};meta={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for n,(name,data,details) in enumerate(pool.map(encode,jobs)):
            if data is None:
                id=name.split('/')[1].split('.')[0];entry=entries[id];entry['file']=None;missing.append({'id':int(id),'name':entry['name'],'label':entry['label'],'reason':'Provided audio cannot be decoded'})
                print('Invalid supplied sample, using generic:',details['source'],flush=True)
                continue
            rendered[name]=data;meta[name]=details
            if n%100==0: print('Normalized',n,'/',len(jobs),flush=True)
    packs=[];group=[];size=0
    def save_pack():
        nonlocal group,size
        if not group:return
        tar=io.BytesIO()
        with tarfile.open(fileobj=tar,mode='w',format=tarfile.USTAR_FORMAT) as t:
            for name in group:
                info=tarfile.TarInfo(name);info.size=len(rendered[name]);info.mode=0o644;info.mtime=0
                t.addfile(info,io.BytesIO(rendered[name]))
        blob=gzip.compress(tar.getvalue(),compresslevel=6,mtime=0);name='audio-%02d.tar.gz'%len(packs)
        (output/name).write_bytes(blob);packs.append({'file':name,'sha256':sha(blob),'bytes':len(blob),'files':{k:{'size':meta[k]['size'],'sha256':meta[k]['sha256']} for k in group}});group=[];size=0
    for name in sorted(rendered):
        if size+len(rendered[name])>900000:save_pack()
        group.append(name);size+=len(rendered[name])
    save_pack()
    manifest={'version':'v1','inputs':inputs,'normalization':{'sampleRate':32000,'channels':1,'bitrate':64000,'rmsTarget':.112,'peakLimit':.72},'packs':packs,'samples':meta}
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
    catalogue={'version':'v1','moves':entries,'cries':{str(p['id']):'cries/%s.mp3'%p['id'] for p in dex}}
    (ROOT/'vue-explorakit/src/data/combatAudio.json').write_text(json.dumps(catalogue,ensure_ascii=False,separators=(',',':'))+'\n')
    report={'moves':len(moves),'specificMoves':len(moves)-len(missing),'genericMoves':missing,'species':len(dex),'suppliedCries':len(supplied),'supplementaryCries':len(dex)-len(supplied),'packs':len(packs),'compressedBytes':sum(p['bytes'] for p in packs),'sampleBytes':sum(len(b) for b in rendered.values()),'supplementarySource':'https://github.com/PokeAPI/cries'}
    (ROOT/'docs/validation/combat-audio-resources-2026-11-14.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    lines=['Attaques utilisant le son générique commun','Catalogue complet du moteur : %s attaques, %s sons spécifiques, %s génériques.'%(len(moves),len(moves)-len(missing),len(missing)),'']
    lines += ['%s — %s (n° %s)'%(m['label'],m['name'],m['id']) for m in sorted(missing,key=lambda m:m['id'])]
    (ROOT/'docs/ATTACK_AUDIO_GENERIC.txt').write_text('\n'.join(lines)+'\n')
    print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
