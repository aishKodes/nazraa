"""Guarded API-only allocation update. No SQL migration or config changes."""
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
label_fix = '--button-label-fix' in sys.argv
name = 'master-allocation-20261021' + ('-label' if label_fix else '')
capsule = json.loads(Path(f'/opt/nazraa/tools/{name}.json').read_text())
assert capsule['baseline'] == ('c4d8ab9f58795f419ed3f168cf0c67a7e35e61d4' if label_fix else 'cd08af8f2dfb048e352c39239a498aac5e11bd62')
if label_fix:
    assert [item['path'] for item in capsule['files']] == ['components/master-allocation-search.tsx']
originals = {}
for item in capsule['files']:
    path = root / item['path']
    assert item['path'].startswith(('app/', 'components/', 'lib/')) and '..' not in Path(item['path']).parts
    original = path.read_bytes() if path.exists() else None
    assert (hashlib.sha256(original).hexdigest() if original is not None else None) == item['before'], f'SOURCE_CONFLICT: {item["path"]}'
    assert hashlib.sha256(base64.b64decode(item['contents'], validate=True)).hexdigest() == item['after']
    originals[item['path']] = original
print(f'SOURCE_GUARDS_PASS {len(originals)} files', flush=True)
if '--apply' not in sys.argv:
    sys.exit(0)
assert 'PREDEPLOY_BACKUP_VERIFIED' in Path('/opt/nazraa/logs/allocation-20261021-backup.log').read_text()
backup = Path(f'/opt/nazraa/backups/{name}-source-{int(time.time())}.tar.gz')
with tarfile.open(backup, 'w:gz') as archive:
    for filename, original in originals.items():
        if original is not None:
            archive.add(root / filename, arcname=filename)
backup.chmod(0o600)
state_script = base64.b64decode(capsule['stateScript'])
def snapshot(label):
    result = subprocess.check_output(['docker','exec','-i','nazraa-api-1','node'], input=state_script)
    parsed = json.loads(result)
    Path(f'/opt/nazraa/logs/{name}-{label}.json').write_text(json.dumps(parsed))
    return parsed
before = snapshot('before')
image = subprocess.check_output(['docker','inspect','-f','{{.Image}}','nazraa-api-1'],text=True).strip()
subprocess.run(['docker','tag',image,f'nazraa-api:{name}-rollback'],check=True)
compose = ['docker','compose','-f','/opt/nazraa/compose.yaml']
try:
    for item in capsule['files']:
        path = root / item['path']
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(item['contents']))
    subprocess.run([*compose,'build','api'],check=True)
    subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
    for _ in range(18):
        if subprocess.check_output(['docker','inspect','-f','{{.State.Health.Status}}','nazraa-api-1'],text=True).strip() == 'healthy':
            break
        time.sleep(5)
    else:
        raise RuntimeError('API unhealthy')
    subprocess.run(['curl','--fail','--silent','--show-error','--output','/dev/null','https://nazralive.in/api/v1/config'],check=True)
    after = snapshot('after')
    assert before['settingsSha256'] == after['settingsSha256'], 'Config changed'
    assert before['migrations'] == after['migrations'], 'Schema changed'
    assert before['accountForeignKeys'] == after['accountForeignKeys'], 'FKs changed'
    record = {'baseline':capsule['baseline'],'commit':capsule['commit'], 'files':{i['path']:i['after'] for i in capsule['files']},'sourceBackup':str(backup),'settingsUnchanged':True,'schema':after['migrations'],'verifiedAt':time.time()}
    Path(f'/opt/nazraa/tools/{name}-deployed.json').write_text(json.dumps(record))
    print('ALLOCATION_DEPLOY_PASS; CONFIG_SCHEMA_MEDIA_WORKER_REDIS_REALTIME_UNCHANGED',flush=True)
    print(f'ROLLBACK_SOURCE={backup}',flush=True)
except BaseException:
    for filename, original in originals.items():
        path = root / filename
        if original is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(original)
    subprocess.run(['docker','tag',image,'nazraa-api:production-candidate'],check=True)
    subprocess.run([*compose,'up','-d','--no-deps','api'],check=True)
    print('ROLLED_BACK_API_AND_SOURCE',flush=True)
    raise
