"""Owner authorized website publication after the scoped fix/test pass."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.request

assert os.geteuid()==0
os.chdir('/opt/nazraa/app-next')
source=Path('lib/release/latest-release.ts')
assert hashlib.sha256(source.read_bytes()).hexdigest()=='508db431548adf888904f3f050d2c960807ce993b873e7f3ea57937ca143b854', 'Public metadata changed; inspect before publishing'
patch='/opt/nazraa/tools/owner-final-public-release-20261021.patch'
subprocess.run(['git','apply','--check',patch],check=True)
backup=Path('/opt/nazraa/backups/release-2.5.02-7414')
assert not backup.exists(), 'Do not overwrite existing rollback metadata'
backup.mkdir(mode=0o700)
shutil.copyfile(source,backup/'latest-release.previous.ts')
(backup/'latest-release.previous.ts').chmod(0o600)
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:before-public-2.5.02'],check=True)
subprocess.run(['git','apply',patch],check=True)
compose=['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 for attempt in range(12):
  if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()=='healthy':
   break
  time.sleep(5)
 else:
  raise RuntimeError('API health did not recover')
 with urllib.request.urlopen('https://nazralive.in/release/latest',timeout=15) as response:
  release=json.load(response)
 assert release['version']=='2.5.02' and release['build']==7414
 assert release['sha256']=='28d3fdebf4d616f318d236e6693885cc3bae1c55bd8357eb30e71187fccad07a'
 assert release['apkUrl']=='https://github.com/aishKodes/Nazraa-Releases/releases/download/v2.5.02/Nazraa-Live-2.5.02-7414-release.apk'
 print('PUBLIC_2_5_02_METADATA_HEALTH_AND_HASH_PASS; NO_MINIMUM_REWARD_MEDIA_OR_SCHEMA_CHANGE',flush=True)
except BaseException:
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 subprocess.run(['git','apply','--reverse',patch],check=True)
 print('PUBLIC_METADATA_ROLLED_BACK; WORKING_OWNER_FINAL_BACKEND_PRESERVED',flush=True)
 raise
