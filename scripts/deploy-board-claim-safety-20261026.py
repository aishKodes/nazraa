"""API-only follow-up; preserve reward policy, schema and public release."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,tarfile,time
assert os.geteuid()==0
root=Path('/opt/nazraa/app-next');os.chdir(root)
commit=sys.argv[1]
assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
base='8f8b7b401b78b87c324eea0d5c0a5b5004e250e4'
names=['lib/db/repositories/mobile-completion.ts','lib/db/repositories/live-accounting-diagnostics.ts']
old={};new={}
for name in names:
 p=root/name;old[p]=p.read_bytes()
 expected=subprocess.check_output(['git','show',f'{base}:{name}'])
 assert hashlib.sha256(old[p]).digest()==hashlib.sha256(expected).digest(),f'SOURCE_CONFLICT {name}'
 new[p]=subprocess.check_output(['git','show',f'{commit}:{name}'])
state_script=b'''const m=require('mysql2/promise'),h=require('crypto');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [s]=await c.query('SELECT setting_key,setting_value FROM system_settings ORDER BY setting_key');const [v]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name');console.log(JSON.stringify({settings:h.createHash('sha256').update(JSON.stringify(s)).digest('hex'),schema:v}));await c.end()})().catch(()=>process.exit(1));'''
def snapshot():return json.loads(subprocess.check_output(['docker','exec','-i','nazraa-api-1','node'],input=state_script))
before=snapshot()
print('CLAIM_SAFETY_SOURCE_GUARDS_PASS',flush=True)
if '--apply' not in sys.argv:sys.exit(0)
backup=Path('/opt/nazraa/backups/board-claim-safety-20261026-source.tar.gz');assert not backup.exists()
with tarfile.open(backup,'w:gz') as archive:
 for p in old:archive.add(p,arcname=str(p).lstrip('/'))
backup.chmod(0o600)
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:before-board-claim-safety-20261026'],check=True)
compose=['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
 for p,data in new.items():p.write_bytes(data)
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for _ in range(24):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()=='healthy':break
  time.sleep(5)
 else:raise RuntimeError('API unhealthy')
 assert before==snapshot(),'CONFIG_OR_SCHEMA_CONFLICT'
 Path('/opt/nazraa/tools/board-claim-safety-deployed.json').write_text(json.dumps({'commit':commit,'sourceBackup':str(backup),'rollbackImage':image,'configAndSchemaUnchanged':True,'at':time.time()},indent=2))
 print('CLAIM_SAFETY_API_PASS; CONFIG_SCHEMA_MEDIA_PUBLIC_RELEASE_UNCHANGED',flush=True)
except BaseException:
 for p,data in old.items():p.write_bytes(data)
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 raise
