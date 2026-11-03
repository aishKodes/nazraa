"""Existing VPS, scoped source patch, API-only deploy; never activates rates."""
from pathlib import Path
import subprocess,os,sys,json,hashlib,tarfile,time,urllib.request
assert os.geteuid()==0
root=Path('/opt/nazraa/app-next');os.chdir(root)
head=sys.argv[1];assert len(head)==40 and all(c in '0123456789abcdef' for c in head)
base='3b5105598379210ff0f1c3e0a487ae1992a3fc2a'
paths=['app','components','lib','types']
patch=subprocess.check_output(['git','diff','--binary',base,head,'--',*paths]);assert 0<len(patch)<250000
changed=subprocess.check_output(['git','diff','--name-only',base,head,'--',*paths],text=True).splitlines()
subprocess.run(['git','apply','--check','-'],input=patch,check=True)
print('PREMIUM_V6_PATCH_CHECK_PASS',len(changed),hashlib.sha256(patch).hexdigest(),flush=True)
if '--apply' not in sys.argv:sys.exit(0)
assert os.statvfs(root).f_bavail*os.statvfs(root).f_frsize>20*1024**3
backup_log=subprocess.check_output(['journalctl','-u','nazraa-backup.service','--since','2026-11-03 00:00:00','--no-pager','-o','cat'],text=True)
assert 'Offsite backup verified:' in backup_log,'FRESH_VERIFIED_OFFSITE_BACKUP_REQUIRED'
assert subprocess.check_output(['systemctl','show','nazraa-backup.service','-p','Result','--value'],text=True).strip()=='success'
record=Path('/opt/nazraa/tools/premium-v6-20261103');record.mkdir(mode=0o700,exist_ok=True)
originals={f:(root/f).read_bytes() if (root/f).exists() else None for f in changed}
backup=record/'source-before.tar.gz'
assert not backup.exists(),'Previous deployment record exists: inspect before retry'
with tarfile.open(backup,'w:gz') as a:
 for f,b in originals.items():
  if b is not None:a.add(root/f,arcname=f)
backup.chmod(0o600)
node="const {createHash}=require('crypto');require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}).then(async c=>{const [r]=await c.query(\"SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN ('mobile.games','mobile.features','mobile.live_rules','media.livekit','media.routing','withdrawal.economy') ORDER BY setting_key\");console.log(createHash('sha256').update(JSON.stringify(r)).digest('hex'));await c.end();});"
def digest():return subprocess.check_output(['docker','exec','nazraa-api-1','node','-e',node],text=True).strip()
before=digest();rollback='nazraa-api:before-premium-v6-20261103'
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip();subprocess.run(['docker','tag',image,rollback],check=True)
compose=['docker','compose','--project-directory','/opt/nazraa','-f','/opt/nazraa/compose.yaml']
try:
 subprocess.run(['git','apply','-'],input=patch,check=True)
 with (record/'build.log').open('w') as log:subprocess.run(compose+['build','api'],stdout=log,stderr=subprocess.STDOUT,check=True)
 assert digest()==before,'Settings changed during build'
 subprocess.run(compose+['up','-d','--no-deps','api'],check=True)
 for i in range(90):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/internal/health',timeout=3) as r:
    if r.status==200:break
  except Exception:time.sleep(2)
 else:raise RuntimeError('API health check failed')
 assert digest()==before,'Protected settings changed'
 result={'head':head,'base':base,'paths':changed,'sourceBackup':str(backup),'rollbackImage':rollback,'settingsUnchanged':True,'servicesRestarted':['api'],'completedAt':time.time()}
 (record/'deployed.json').write_text(json.dumps(result,indent=2));print('PREMIUM_V6_DEPLOYED_API_HEALTHY_SETTINGS_UNCHANGED',head,flush=True)
except Exception:
 for f,b in originals.items():
  p=root/f
  if b is None:p.unlink(missing_ok=True)
  else:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 subprocess.run(['docker','tag',rollback,'nazraa-api:production-candidate'],check=True);subprocess.run(compose+['up','-d','--no-deps','api'],check=True)
 raise
