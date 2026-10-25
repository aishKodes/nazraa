"""Publish only the already-tested 2.5.06 APK metadata. No config/schema writes."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

assert os.geteuid()==0
root=Path('/opt/nazraa/app-next');os.chdir(root)
commit=sys.argv[1]
assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
source=root/'lib/release/latest-release.ts'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='e874fcb2ff88beacbd8e047bf208b1b4fcbe79250e970c1810c4e68ceb4a2b32','PUBLIC_METADATA_CONFLICT'
gates=json.loads(Path('/opt/nazraa/logs/stabilization-2.5.06-release-gates.json').read_text())
sha='210f876cb28313266aa314c190adff3eb566881f1f2cc9c3c55f4b5c2b9510bf'
assert gates['apkSha256']==sha and gates['build']==7418
assert all(gates[k] is True for k in ['face','party','agency','upgrade','signing'])
assert time.time()-gates['verifiedAt']<7200
url='https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.06/Nazraa-Live-2.5.06-7418-release.apk'
# Stream-verify the actual public asset without leaving another large file on VPS.
h=hashlib.sha256();size=0
with urllib.request.urlopen(url,timeout=40) as response:
 assert response.status==200
 while chunk:=response.read(1024*1024):h.update(chunk);size+=len(chunk)
assert h.hexdigest()==sha and size==259196682,'PUBLIC_APK_HASH_FAILED'
print('EXACT_PUBLIC_APK_AND_RUNTIME_GATES_PASS',flush=True)
if '--apply' not in sys.argv:sys.exit(0)
old=source.read_bytes()
backup=Path('/opt/nazraa/backups/release-2.5.06-7418')
assert not backup.exists();backup.mkdir(mode=0o700)
(backup/'latest-release.previous.ts').write_bytes(old)
(backup/'latest-release.previous.ts').chmod(0o600)
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:before-public-2.5.06'],check=True)
compose=['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
 source.write_bytes(subprocess.check_output(['git','show',f'{commit}:lib/release/latest-release.ts']))
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for _ in range(24):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()=='healthy':break
  time.sleep(5)
 else:raise RuntimeError('API unhealthy')
 with urllib.request.urlopen('https://nazralive.in/release/latest',timeout=20) as response:release=json.load(response)
 assert release['version']=='2.5.06' and release['build']==7418
 assert release['sha256']==sha and release['apkUrl']==url and release['apkSizeBytes']==size
 Path('/opt/nazraa/tools/stabilization-public-2.5.06-deployed.json').write_text(json.dumps({'commit':commit,'sourceBackup':str(backup),'rollbackImage':image,'apkSha256':sha,'minimumVersionUnchanged':True,'at':time.time()},indent=2))
 print('PUBLIC_2_5_06_WEBSITE_PASS; NO_MINIMUM_REWARD_MEDIA_SCHEMA_CHANGE',flush=True)
except BaseException:
 source.write_bytes(old)
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 print('PUBLIC_METADATA_ROLLED_BACK; STABILIZED_BACKEND_RETAINED',flush=True)
 raise
