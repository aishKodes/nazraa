"""Scoped API-only deployment. No migration, media restart or public APK update."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import time

assert os.geteuid() == 0
root = Path('/opt/nazraa/app-next')
os.chdir(root)
expected = {
 'app/dashboard/settings/page.tsx': 'e05077bec909e5f79723ac743d70efa70d2c71a64b1b0336cd82323735812c96',
 'app/princess-pricing-actions.ts': '0508280c8b08d8bae02001d3d63e27b33027993f39ee5a7ee8413687fb32a5ba',
 'lib/db/repositories/audio-party-pk.ts': '963fdbab5d0011fb76aea4b66b4709608187e6ca2628a53827d60a118326029b',
 'lib/db/repositories/catalog.ts': 'd19ce2795fc8779b002a315b822458ae5f31c08bf40370f9e0f251a52c606c02',
 'lib/db/repositories/face-live-social.ts': '7d653b1e216e6280b2153d53eef6db3158162dabf7c0279c5581ecfd9b624a49',
 'lib/db/repositories/mobile-product.ts': 'ff5a2c6e184de915b2e1ddaa3998cdcb6e3b20665dba2be14bcde89349b90e34',
 'lib/games/game-config.ts': '305c7dbaaf58b69c9490ac6858cbed49fc4bbd3d5cc45bbadcf5de127d48bee7',
 'lib/games/princess-preview-pricing.ts': '720f7b5f05e4b91912cccee2e686ae4be953441bd420252da621fd594dd47160',
 'lib/games/teen-patti.ts': 'ab6a742abcfaaab6abdaf90a2076abaff43567a36cbff91c012dfd05924fb779',
}
patch = '/opt/nazraa/tools/owner-final-20261021.patch'
for name, digest in expected.items():
 assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest, f'Source changed; refusing overwrite: {name}'
subprocess.run(['git', 'apply', '--check', patch], check=True)
print('SOURCE_GUARDS_AND_PATCH_CHECK_PASS', flush=True)
if '--apply' not in sys.argv:
 sys.exit(0)
assert 'PREDEPLOY_BACKUP_VERIFIED' in Path('/opt/nazraa/logs/owner-final-predeploy-20261021.log').read_text(), 'Private offsite backup is not verified yet'
backup=Path(f'/opt/nazraa/backups/owner-final-20261021-source-{int(time.time())}.tar.gz')
assert not backup.exists(), 'Rollback source already exists; inspect before retry'
with tarfile.open(backup, 'w:gz') as tar:
 for name in expected:
  tar.add(name, arcname=name)
backup.chmod(0o600)
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'], text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:owner-final-rollback-20261021'],check=True)
subprocess.run(['git','apply',patch],check=True)
compose=['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
 subprocess.run([*compose,'build','api'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 healthy=False
 for _ in range(12):
  state=subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip()
  if state == 'healthy':
   healthy=True
   break
  time.sleep(5)
 assert healthy, 'New API health check did not pass'
 # Caddy deliberately blocks /api/internal/* externally. Container health
 # probes that private endpoint; verify the public edge with public config.
 subprocess.run(['curl','--fail','--silent','--show-error','--output','/dev/null','https://api.nazraa.pixtra.site/api/v1/config'],check=True)
 print('\nOWNER_FINAL_API_DEPLOY_PASS; MEDIA/WORKER/DB/REDIS/REALTIME_UNCHANGED; NO_SCHEMA_OR_REWARD_CONFIG_CHANGE',flush=True)
except BaseException:
 subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
 subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
 subprocess.run(['git','apply','--reverse',patch],check=True)
 print('ROLLED_BACK_API_IMAGE_AND_SCOPED_SOURCE',flush=True)
 raise
