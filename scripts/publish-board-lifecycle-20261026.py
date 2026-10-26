"""Publish verified 2.5.07 metadata only after exact-APK runtime gates."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,time,urllib.request
assert os.geteuid()==0
root=Path('/opt/nazraa/app-next');os.chdir(root)
commit=sys.argv[1]
assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
source=root/'lib/release/latest-release.ts'
old=source.read_bytes()
assert old==subprocess.check_output(['git','show','8f8b7b401b78b87c324eea0d5c0a5b5004e250e4:lib/release/latest-release.ts']),'PUBLIC_METADATA_CONFLICT'
originals={source:old}
for name in ['lib/services/live-auto-resume.ts','lib/db/repositories/mobile-completion.ts']:
 p=root/name;previous=p.read_bytes()
 assert previous==subprocess.check_output(['git','show',f'4b57c1e559434cef5b4f061589c81765936ac8bf:{name}']),f'FINAL_EDGE_SOURCE_CONFLICT {name}'
 originals[p]=previous
g=json.loads(Path('/opt/nazraa/logs/board-2.5.07-release-gates.json').read_text())
sha='d6ccaed54c20d04e30aab9cd7231aff511d7414f288c1ac9e72e6e23541d5cfb'
assert g['apkSha256']==sha and g['build']==7419
assert g['faceStarts']==20 and g['partyStarts']==20
assert g['serverFacePublished']>=20 and g['serverPartyPublished']>=20
assert g['soakSeconds']>=3600 and g['soakSameSession'] is True
assert all(g[k] is True for k in ['network10','network30','network60','rewardThresholds','signing'])
assert g['duplicateRewards']==0 and time.time()-g['verifiedAt']<7200
url='https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.07/Nazraa-Live-2.5.07-7419-release.apk'
h=hashlib.sha256();size=0
with urllib.request.urlopen(url,timeout=40) as response:
 assert response.status==200
 while chunk:=response.read(1024*1024):h.update(chunk);size+=len(chunk)
assert h.hexdigest()==sha and size==259196678,'PUBLIC_APK_HASH_FAILED'
print('EXACT_PUBLIC_APK_AND_BOARD_GATES_PASS',flush=True)
if '--apply' not in sys.argv:sys.exit(0)
backup=Path('/opt/nazraa/backups/release-2.5.07-7419');assert not backup.exists();backup.mkdir(mode=0o700)
for p,data in originals.items():
 target=backup/p.relative_to(root);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:before-public-2.5.07'],check=True)
compose=['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
 for p in originals:p.write_bytes(subprocess.check_output(['git','show',f'{commit}:{p.relative_to(root)}']))
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for _ in range(24):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()=='healthy':break
  time.sleep(5)
 else:raise RuntimeError('API unhealthy')
 with urllib.request.urlopen('https://nazralive.in/release/latest',timeout=20) as response:r=json.load(response)
 assert r['version']=='2.5.07' and r['build']==7419 and r['sha256']==sha and r['apkUrl']==url and r['apkSizeBytes']==size
 Path('/opt/nazraa/tools/board-public-2.5.07-deployed.json').write_text(json.dumps({'commit':commit,'sourceBackup':str(backup),'rollbackImage':image,'apkSha256':sha,'at':time.time()},indent=2))
 print('PUBLIC_2_5_07_WEBSITE_PASS; MEDIA_AND_ECONOMY_POLICY_PRESERVED',flush=True)
except BaseException:
 for p,data in originals.items():p.write_bytes(data)
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 raise
