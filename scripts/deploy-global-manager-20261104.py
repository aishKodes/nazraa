"""Scoped Control/API deployment; additive schema only; preserves active games/media."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,tarfile,time,urllib.request
assert os.geteuid()==0
root=Path('/opt/nazraa/app-next');os.chdir(root)
base='7e3a0e34507ec80732449a734b1402636de95e97'
head=sys.argv[1];assert len(head)==40 and all(c in '0123456789abcdef' for c in head)
paths=[p for p in subprocess.check_output(['git','diff','--name-only',base,head],text=True).splitlines() if p.startswith(('app/','components/','lib/','types/')) or p=='db/migrations/0117_global_manager_country_groups.sql']
assert len(paths)==51,('Unexpected runtime patch',len(paths))
patch=subprocess.check_output(['git','diff','--binary',base,head,'--',*paths]);assert 0<len(patch)<300000
for p in paths:
 old=subprocess.run(['git','show',base+':'+p],capture_output=True)
 if old.returncode==0:assert (root/p).read_bytes()==old.stdout,'BASE_SOURCE_MISMATCH: '+p
 else:assert not (root/p).exists(),'NEW_FILE_ALREADY_EXISTS: '+p
subprocess.run(['git','apply','--check','-'],input=patch,check=True)
print('GLOBAL_MANAGER_PREFLIGHT_SOURCE_MATCH',len(paths),hashlib.sha256(patch).hexdigest(),flush=True)
if '--apply' not in sys.argv:sys.exit(0)
assert os.statvfs(root).f_bavail*os.statvfs(root).f_frsize>20*1024**3
logs=subprocess.check_output(['journalctl','-u','nazraa-backup.service','--since','36 hours ago','--no-pager','-o','cat'],text=True)
assert 'Offsite backup verified:' in logs,'RECENT_VERIFIED_OFFSITE_BACKUP_REQUIRED'
assert subprocess.check_output(['systemctl','show','nazraa-backup.service','-p','Result','--value'],text=True).strip()=='success'
record=Path('/opt/nazraa/tools/global-manager-20261104');record.mkdir(mode=0o700,exist_ok=True)
backup=record/'source-before.tar.gz';assert not backup.exists(),'Existing attempt: inspect record before resuming'
originals={p:(root/p).read_bytes() if (root/p).exists() else None for p in paths}
with tarfile.open(backup,'w:gz') as t:
 for p,b in originals.items():
  if b is not None:t.add(root/p,arcname=p)
backup.chmod(0o600)
node="""const {createHash}=require('crypto');require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}).then(async c=>{try{const [s]=await c.query(\"SELECT setting_key,setting_value FROM system_settings WHERE setting_key IN ('mobile.games','mobile.features','mobile.live_rules','media.livekit','media.routing','withdrawal.economy') ORDER BY setting_key\");const [a]=await c.query('SELECT id,role,parent_account_id,country_code,application_user_id,status,removed_at FROM platform_accounts ORDER BY id');const [m]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name DESC LIMIT 1');const hash=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');console.log(JSON.stringify({settings:hash(s),accounts:hash(a),accountCount:a.length,globalManagers:a.filter(r=>r.role==='GLOBAL_MANAGER').length,lastMigration:m[0]?.name}));}finally{await c.end();}}).catch(e=>{console.error(e.code||'SNAPSHOT_FAILED');process.exit(1)});"""
def snapshot():return json.loads(subprocess.check_output(['docker','exec','nazraa-api-1','node','-e',node],text=True))
before=snapshot()
containers={}
for name in subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines():
 if name!='nazraa-api-1':containers[name]=subprocess.check_output(['docker','inspect','-f','{{.Id}} {{.State.StartedAt}}',name],text=True).strip()
rollback='nazraa-api:before-global-manager-20261104';image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,rollback],check=True)
(record/'before.json').write_text(json.dumps({'head':head,'base':base,'before':before,'containers':containers,'image':image,'rollbackImage':rollback,'paths':paths},indent=2));(record/'before.json').chmod(0o600)
compose=['docker','compose','--project-directory','/opt/nazraa','-f','/opt/nazraa/compose.yaml']
try:
 subprocess.run(['git','apply','-'],input=patch,check=True)
 print('BUILDING_API_ONLY',flush=True)
 with (record/'build.log').open('w') as f:subprocess.run(compose+['build','api'],stdout=f,stderr=subprocess.STDOUT,check=True)
 assert snapshot()==before,'Production config/role changes during build; investigate before activation'
 migration=(root/'db/migrations/0117_global_manager_country_groups.sql').read_bytes()
 migration_node="""const fs=require('fs');require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,multipleStatements:true}).then(async c=>{try{const [r]=await c.query(\"SELECT name FROM control_schema_migrations WHERE name='0117_global_manager_country_groups.sql'\");if(r.length)throw Error('MIGRATION_ALREADY_RECORDED');await c.query(fs.readFileSync(0,'utf8'));await c.execute(\"INSERT INTO control_schema_migrations(name) VALUES('0117_global_manager_country_groups.sql')\");const [[g]]=await c.query(\"SELECT COUNT(*) n,GROUP_CONCAT(country_code ORDER BY country_code) codes FROM country_group_countries WHERE group_id='1eadd1e0-0000-4000-8000-000000000017'\");if(Number(g.n)!==17||g.codes!=='AE,BH,CY,EG,IL,IQ,IR,JO,KW,LB,OM,PS,QA,SA,SY,TR,YE')throw Error('MIDDLE_EAST_SEED_MISMATCH');console.log('ADDITIVE_MIGRATION_0117_MIDDLE_EAST_17_PASS');}finally{await c.end();}}).catch(e=>{console.error(e.code||e.message||'MIGRATION_FAILED');process.exit(1)});"""
 subprocess.run(['docker','exec','-i','nazraa-api-1','node','-e',migration_node],input=migration,check=True)
 subprocess.run(compose+['up','-d','--no-deps','api'],check=True)
 for _ in range(90):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/internal/health',timeout=3) as r:
    if r.status==200:break
  except Exception:time.sleep(2)
 else:raise RuntimeError('API_HEALTH_FAILED')
 after=snapshot()
 for key in ['settings','accounts','accountCount','globalManagers']:assert after[key]==before[key],'PROTECTED_STATE_CHANGED: '+key
 for name,identity in containers.items():assert subprocess.check_output(['docker','inspect','-f','{{.Id}} {{.State.StartedAt}}',name],text=True).strip()==identity,'UNRELATED_SERVICE_CHANGED: '+name
 out={'head':head,'base':base,'paths':paths,'patchSha256':hashlib.sha256(patch).hexdigest(),'sourceBackup':str(backup),'rollbackImage':rollback,'migration':'0117_global_manager_country_groups.sql','before':before,'after':after,'settingsUnchanged':True,'accountLinksAndRolesUnchanged':True,'nonApiContainersPreserved':len(containers),'servicesRestarted':['api'],'completedAt':time.time()}
 (record/'deployed.json').write_text(json.dumps(out,indent=2));(record/'deployed.json').chmod(0o600)
 print('GLOBAL_MANAGER_DEPLOYED_API_HEALTHY_SETTINGS_ROLES_UNCHANGED',head,'NON_API_CONTAINERS',len(containers),flush=True)
except Exception:
 for p,b in originals.items():
  dest=root/p
  if b is None:dest.unlink(missing_ok=True)
  else:dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
 subprocess.run(['docker','tag',rollback,'nazraa-api:production-candidate'],check=True)
 subprocess.run(compose+['up','-d','--no-deps','api'],check=True)
 print('API_ROLLBACK_APPLIED_ADDITIVE_SCHEMA_RETAINED',flush=True)
 raise
