"""Guarded API + approved same-day backup retention deployment. No migration."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import time

assert os.geteuid() == 0
root = Path('/opt/nazraa/app-next')
os.chdir(root)
commit = sys.argv[1]
assert len(commit) == 40 and all(c in '0123456789abcdef' for c in commit)
baseline = {
 'lib/db/repositories/mobile-completion.ts': '98ccd2769677d4b3c41a1b8bf494748b91533dd5e270af8700e9e82ae2663db0',
 'lib/db/repositories/mobile-social.ts': 'f55f4aefafb9d35ee817af055b847ab0688cd8a691a1a5b1b9d03256bf49f88f',
 'lib/db/repositories/administration.ts': '74f27f53b100233fcbce94f2466cd22a13ade025a3d1c3a5ef9b51d3842bd5c3',
 'lib/services/livekit-room-admin.ts': '364c248f6966e5f76146d2b8006bd452c51c86465fee692a6e1a462f598da2a0',
 'lib/services/agency-join-policy.ts': None,
 'deploy/vps/backup-to-oci.sh': '4421d791303fd3577701bc2e41cde98c2baae413d1c3e5639cc835bcfed9e0c5',
 'deploy/vps/retain-local-nightly.py': None,
 'deploy/vps/compose.yaml': '3865ac8ba97993f983a00c70fd919389b5dc44dc448306586e9d7ef479531b53',
}
originals = {}
replacements = {}
for filename, expected in baseline.items():
 p = root/filename
 old = p.read_bytes() if p.exists() else None
 assert (hashlib.sha256(old).hexdigest() if old is not None else None) == expected, f'SOURCE_CONFLICT {filename}'
 originals[p] = old
 replacements[p] = subprocess.check_output(['git','show',f'{commit}:{filename}'])
compose_path = Path('/opt/nazraa/compose.yaml')
compose_old = compose_path.read_bytes()
assert hashlib.sha256(compose_old).hexdigest() == '551a619a043b0bd823d1683b3720222d9012e98291f9c329244373697e178529', 'RUNTIME_COMPOSE_CONFLICT'
text = compose_old.decode()
assert 'x-nazraa-logging' not in text
text = text.replace('services:\n', 'x-nazraa-logging: &nazraa-logging\n  driver: json-file\n  options:\n    max-size: "20m"\n    max-file: "3"\n\nservices:\n',1)
for service in ['mysql','redis','api','worker','realtime','caddy']:
 marker=f'  {service}:\n'
 assert text.count(marker) == 1
 text=text.replace(marker, marker+'    logging: *nazraa-logging\n',1)
originals[compose_path] = compose_old
replacements[compose_path] = text.encode()
print('SOURCE_AND_COMPOSE_GUARDS_PASS',flush=True)
if '--apply' not in sys.argv:
 sys.exit(0)
assert 'CURRENT_BACKUP_READABLE' in Path('/opt/nazraa/logs/stabilization-backup-check-20261025.log').read_text()
assert time.time()-Path('/opt/nazraa/backups/production/nazraa-nightly-20261024T204214Z.sql.gz').stat().st_mtime < 36*3600
assert os.statvfs('/opt/nazraa').f_bavail*os.statvfs('/opt/nazraa').f_frsize > 60*1024**3
backup=Path(f'/opt/nazraa/backups/stabilization-20261025-source-{int(time.time())}.tar.gz')
with tarfile.open(backup,'w:gz') as archive:
 for p,old in originals.items():
  if old is not None: archive.add(p,arcname=str(p).lstrip('/'))
backup.chmod(0o600)
state_script=b'''const m=require('mysql2/promise'),h=require('crypto');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [s]=await c.query('SELECT setting_key,setting_value FROM system_settings ORDER BY setting_key');const [v]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name');console.log(JSON.stringify({settingsSha256:h.createHash('sha256').update(JSON.stringify(s)).digest('hex'),migrations:v}));await c.end()})().catch(()=>process.exit(1));'''
def snapshot():
 return json.loads(subprocess.check_output(['docker','exec','-i','nazraa-api-1','node'],input=state_script))
before=snapshot()
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:stabilization-20261025-rollback'],check=True)
compose=['docker','compose','-f',str(compose_path)]
try:
 for p,data in replacements.items():
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 subprocess.run([*compose,'config','--quiet'],check=True)
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for _ in range(24):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()=='healthy': break
  time.sleep(5)
 else: raise RuntimeError('API unhealthy')
 subprocess.run(['curl','--fail','--silent','--show-error','--max-time','20','--output','/dev/null','https://nazralive.in/api/v1/config'],check=True)
 after=snapshot()
 assert before==after,'Settings/schema changed unexpectedly'
 assert json.loads(subprocess.check_output(['docker','inspect','-f','{{json .HostConfig.LogConfig}}','nazraa-api-1'],text=True))['Config']=={'max-file':'3','max-size':'20m'}
 record={'commit':commit,'sourceBackup':str(backup),'rollbackImage':image,'settingsUnchanged':True,'migrations':len(after['migrations']),'apiOnlyRestart':True,'at':time.time()}
 Path('/opt/nazraa/tools/stabilization-20261025-deployed.json').write_text(json.dumps(record,indent=2))
 print('STABILIZATION_DEPLOY_PASS; MEDIA_DB_REDIS_WORKER_REALTIME_UNCHANGED',flush=True)
except BaseException:
 for p,old in originals.items():
  if old is None:p.unlink(missing_ok=True)
  else:p.write_bytes(old)
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 print('STABILIZATION_ROLLED_BACK',flush=True)
 raise
