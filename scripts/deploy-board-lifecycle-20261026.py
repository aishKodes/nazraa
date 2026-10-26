"""Guarded additive schema + API-only deploy. Activation is a later transaction."""
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
base = '3b2260ef3b26b57ea7b1daa834e8ac6bfe1b98df'
files = [
 'app/api/v1/mobile/[resource]/route.ts', 'app/dashboard/settings/page.tsx',
 'lib/auth/mobile-session.ts', 'lib/db/repositories/completion-administration.ts',
 'lib/db/repositories/host-operations.ts', 'lib/db/repositories/live-accounting-diagnostics.ts',
 'lib/db/repositories/mobile-completion.ts', 'lib/db/repositories/mobile-live-history.ts',
 'lib/db/repositories/mobile-product.ts', 'lib/services/live-auto-resume.ts',
 'lib/services/live-business-policy.ts', 'lib/services/livekit-room-authority.ts',
 'lib/services/livekit-token-service.ts', 'lib/services/media-cost-telemetry.ts',
]
migration = 'db/migrations/0110_live_reward_blocks.sql'
old, new = {}, {}
for name in files:
 p = root/name
 expected = subprocess.check_output(['git','show',f'{base}:{name}'])
 actual = p.read_bytes()
 assert hashlib.sha256(actual).digest() == hashlib.sha256(expected).digest(), f'SOURCE_CONFLICT {name}'
 old[p] = actual
 new[p] = subprocess.check_output(['git','show',f'{commit}:{name}'])
assert not (root/migration).exists(), 'MIGRATION_ALREADY_STAGED'
new[root/migration] = subprocess.check_output(['git','show',f'{commit}:{migration}'])
assert os.statvfs(root).f_bavail*os.statvfs(root).f_frsize > 60*1024**3
assert 'PREDEPLOY_BACKUP_VERIFIED' in Path('/opt/nazraa/logs/board-lifecycle-predeploy-20261026.log').read_text()
print('BOARD_SOURCE_AND_BACKUP_GUARDS_PASS',flush=True)
if '--apply' not in sys.argv: sys.exit(0)
backup = Path('/opt/nazraa/backups/board-lifecycle-20261026-source.tar.gz')
assert not backup.exists()
with tarfile.open(backup,'w:gz') as archive:
 for p in old: archive.add(p,arcname=str(p).lstrip('/'))
backup.chmod(0o600)
image = subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:before-board-lifecycle-20261026'],check=True)
schema_script = r'''
const fs=require('fs'),m=require('mysql2/promise');(async()=>{
 const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true});
 try{const [rows]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');
 if(rows[0]?.name!=='0109_host_auto_resume.sql') {
  const [existing]=await c.query('SELECT name FROM control_schema_migrations WHERE name=?',['0110_live_reward_blocks.sql']);
  if(existing.length){console.log('BOARD_SCHEMA_ALREADY_APPLIED');return;}
  throw Error('UNEXPECTED_SCHEMA');
 }
 await c.query('SET SESSION lock_wait_timeout=5');
 await c.query(fs.readFileSync('/tmp/nazraa-board-schema.sql','utf8'));
 await c.execute('INSERT INTO control_schema_migrations(name) VALUES (?)',['0110_live_reward_blocks.sql']);
 console.log('BOARD_ADDITIVE_SCHEMA_PASS');
 }finally{await c.end()}
})().catch(e=>{console.error('BOARD_SCHEMA_FAILED',e.code||e.message);process.exitCode=1});
'''
compose=['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
 for p,data in new.items(): p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run(['docker','cp',str(root/migration),'nazraa-api-1:/tmp/nazraa-board-schema.sql'],check=True)
 subprocess.run(['docker','exec','-i','nazraa-api-1','node'],input=schema_script.encode(),check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for _ in range(24):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()=='healthy': break
  time.sleep(5)
 else: raise RuntimeError('API unhealthy')
 subprocess.run(['curl','--fail','--silent','--show-error','--max-time','20','--output','/dev/null','https://nazralive.in/api/v1/config'],check=True)
 Path('/opt/nazraa/tools/board-lifecycle-deployed.json').write_text(json.dumps({'commit':commit,'sourceBackup':str(backup),'rollbackImage':image,'activationPending':True,'apiOnlyRestart':True,'at':time.time()},indent=2))
 print('BOARD_API_DEPLOY_PASS; REWARD_ACTIVATION_PENDING; MEDIA_DB_REDIS_WORKER_REALTIME_NOT_RESTARTED',flush=True)
except BaseException:
 for p,data in old.items(): p.write_bytes(data)
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 print('BOARD_API_ROLLED_BACK; ADDITIVE_SCHEMA_RETAINED; POLICY_NOT_ACTIVATED',flush=True)
 raise
