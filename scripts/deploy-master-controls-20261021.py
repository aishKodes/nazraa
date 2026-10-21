"""API-only guarded deployment. No migration, economy/config or media change.

Run --check first. Capsule is generated from reviewed local source; each
existing production file must match its approved pre-change SHA-256.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import time

assert os.geteuid() == 0
root = Path('/opt/nazraa/app-next')
os.chdir(root)
capsule_path = Path('/opt/nazraa/tools/master-controls-20261021.json')
capsule = json.loads(capsule_path.read_text())
assert capsule['baseline'] == '5088fdd'
originals = {}
for item in capsule['files']:
    name = item['path']
    assert name.startswith(('app/', 'components/', 'lib/')) and '..' not in Path(name).parts
    path = root / name
    original = path.read_bytes() if path.exists() else None
    actual = hashlib.sha256(original).hexdigest() if original is not None else None
    assert actual == item['before'], f'Source changed; refusing overwrite: {name}'
    payload = base64.b64decode(item['contents'], validate=True)
    assert hashlib.sha256(payload).hexdigest() == item['after']
    originals[name] = original
print(f'SOURCE_GUARDS_PASS {len(originals)} scoped files', flush=True)
if '--apply' not in sys.argv:
    sys.exit(0)
assert 'PREDEPLOY_BACKUP_VERIFIED' in Path('/opt/nazraa/logs/master-finance-20261021-predeploy.log').read_text()
backup = Path(f'/opt/nazraa/backups/master-controls-20261021-source-{int(time.time())}.tar.gz')
with tarfile.open(backup, 'w:gz') as archive:
    for name, original in originals.items():
        if original is not None:
            archive.add(root / name, arcname=name)
backup.chmod(0o600)
image = subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'], text=True).strip()
subprocess.run(['docker','tag',image,'nazraa-api:master-controls-rollback-20261021'], check=True)
compose = ['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
    for item in capsule['files']:
        path = root / item['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(item['contents']))
    subprocess.run([*compose,'build','api'], check=True)
    subprocess.run([*compose,'up','-d','--no-deps','api'], check=True)
    healthy = False
    for _ in range(18):
        if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip() == 'healthy':
            healthy = True
            break
        time.sleep(5)
    assert healthy, 'API health check did not pass'
    subprocess.run(['curl','--fail','--silent','--show-error','--output','/dev/null','https://nazralive.in/api/v1/config'],check=True)
    print('MASTER_CONTROLS_DEPLOY_PASS; DB_SCHEMA_CONFIG_MEDIA_WORKER_REDIS_REALTIME_UNCHANGED',flush=True)
    print(f'ROLLBACK_SOURCE={backup}', flush=True)
except BaseException:
    for name, original in originals.items():
        path = root / name
        if original is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(original)
    subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
    subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
    print('ROLLED_BACK_API_IMAGE_AND_SCOPED_SOURCE',flush=True)
    raise
