"""Guarded existing-VPS API-only deployment; no policy/rate activation.

Requires the existing encrypted pre-deployment backup and applies only scoped
source hunks to the dirty production checkout. Run without --apply first.
"""
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
base = 'dddb0f85b85a367177a04921facc75fe244c82b8'
record = Path('/opt/nazraa/tools/country-economy-deployed-20261030.json')
if '--from-deployed' in sys.argv:
 previous_deployment = json.loads(record.read_text())
 assert previous_deployment['settingsUnchanged'] is True
 base = previous_deployment['commit']
 assert len(base) == 40 and all(c in '0123456789abcdef' for c in base)
paths = [
 'app/api/countries/route.ts', 'app/api/games/economy/route.ts',
 'app/dashboard/countries/page.tsx', 'app/dashboard/game-management/page.tsx',
 'app/dashboard/game-management/economy/actions.ts',
 'app/dashboard/game-management/economy/editor.tsx',
 'app/dashboard/game-management/economy/page.tsx',
 'app/dashboard/settings/page.tsx', 'components/shell.tsx', 'lib/countries.ts',
 'lib/db/repositories/accounts.ts', 'lib/db/repositories/administration.ts',
 'lib/db/repositories/catalog.ts', 'lib/db/repositories/country-management.ts',
 'lib/db/repositories/game-economy.ts', 'lib/db/repositories/mobile-product.ts',
 'lib/games/game-config.ts', 'lib/games/game-names.ts',
 'lib/games/economy-policy.ts', 'types/platform.ts',
 'db/migrations/0111_game_economy_versions.sql',
]
patch = subprocess.check_output(['git', 'diff', '--binary', base, commit, '--', *paths])
assert patch and len(patch) < 250_000
subprocess.run(['git', 'apply', '--check', '-'], input=patch, check=True)
assert os.statvfs(root).f_bavail * os.statvfs(root).f_frsize > 30 * 1024**3
print('COUNTRY_ECONOMY_SCOPED_PATCH_CHECK_PASS', flush=True)
if '--apply' not in sys.argv:
 sys.exit(0)
log = Path('/opt/nazraa/logs/country-economy-20261030-predeploy.log')
assert 'PREDEPLOY_BACKUP_VERIFIED' in log.read_text(), 'VERIFIED_PREDEPLOY_BACKUP_REQUIRED'
originals = {name: (root/name).read_bytes() if (root/name).exists() else None for name in paths}
backup = Path(f'/opt/nazraa/backups/country-economy-20261030-source-{int(time.time())}.tar.gz')
with tarfile.open(backup, 'w:gz') as archive:
 for name, data in originals.items():
  if data is not None:
   archive.add(root/name, arcname=name)
backup.chmod(0o600)
image = subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'], text=True).strip()
rollback_tag = 'nazraa-api:before-country-economy-20261030' if '--from-deployed' not in sys.argv else f'nazraa-api:before-country-economy-{base[:12]}'
subprocess.run(['docker','tag',image,rollback_tag],check=True)
compose = ['docker','compose','-f','/opt/nazraa/compose.yaml']
snapshot_script = b'''const m=require('mysql2/promise'),h=require('crypto');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [s]=await c.query('SELECT setting_key,setting_value FROM system_settings ORDER BY setting_key');console.log(h.createHash('sha256').update(JSON.stringify(s)).digest('hex'));await c.end()})().catch(()=>process.exit(1));'''
def settings_hash():
 return subprocess.check_output(['docker','exec','-i','nazraa-api-1','node'],input=snapshot_script).decode().strip()
before = settings_hash()
schema_script = b'''const fs=require('fs'),m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true});try{await c.query('SET SESSION lock_wait_timeout=5');const [applied]=await c.query('SELECT name FROM control_schema_migrations WHERE name=?',['0111_game_economy_versions.sql']);if(!applied.length){await c.query(fs.readFileSync('/tmp/country-game-economy-schema.sql','utf8'));await c.execute('INSERT INTO control_schema_migrations(name) VALUES(?)',['0111_game_economy_versions.sql']);}const [v]=await c.query('SELECT COUNT(*) n FROM game_config_versions');if(Number(v[0].n)!==0)throw Error('ECONOMY_ALREADY_ACTIVATED');console.log('ADDITIVE_SCHEMA_PASS; ZERO_ECONOMY_CHANGES');}finally{await c.end()}})().catch(e=>{console.error('SCHEMA_FAILED',e.code||e.message);process.exitCode=1});'''
try:
 subprocess.run(['git','apply','-'],input=patch,check=True)
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run(['docker','cp',str(root/'db/migrations/0111_game_economy_versions.sql'),'nazraa-api-1:/tmp/country-game-economy-schema.sql'],check=True)
 subprocess.run(['docker','exec','-i','nazraa-api-1','node'],input=schema_script,check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for _ in range(24):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip() == 'healthy':
   break
  time.sleep(5)
 else:
  raise RuntimeError('API_HEALTH_FAILED')
 assert before == settings_hash(), 'SETTINGS_CHANGED_DURING_DEPLOY'
 subprocess.run(['curl','--fail','--silent','--show-error','--max-time','20','--output','/dev/null','https://nazralive.in/api/v1/config'],check=True)
 if record.exists():
  previous=json.loads(record.read_text())
  record.with_name(f'country-economy-deployed-20261030-{previous["commit"][:12]}.json').write_text(record.read_text())
 record.write_text(json.dumps({'commit':commit,'sourceBackup':str(backup),'rollbackImage':image,'settingsUnchanged':True,'scopedFiles':paths,'sourceHashes':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths},'at':time.time()},indent=2))
 print('COUNTRY_ECONOMY_API_DEPLOY_PASS; CONFIG_ECONOMY_MEDIA_REWARDS_UNCHANGED; API_ONLY_RESTART',flush=True)
except BaseException:
 for name, data in originals.items():
  p=root/name
  if data is None:
   p.unlink(missing_ok=True)
  else:
   p.write_bytes(data)
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 print('ROLLED_BACK_SCOPED_SOURCE_AND_API_IMAGE; ADDITIVE_METADATA_RETAINED',flush=True)
 raise
