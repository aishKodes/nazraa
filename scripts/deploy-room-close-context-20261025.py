"""Apply bounded close diagnostics only; preserve production configuration and metadata."""
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
baseline = {
    'app/api/v1/mobile/[resource]/route.ts': 'b3c3b66e4ffaa227514829421b25583ca2d19d59b75e7f7ce0946c42416753ad',
    'lib/db/repositories/mobile-completion.ts': '868e2bda8073dfd5b097435de21f024b6845765580a11cfb178a586a13561911',
    'lib/services/room-termination-diagnostics.ts': None,
}
originals = {}
replacements = {}
for filename, expected in baseline.items():
    p = root / filename
    old = p.read_bytes() if p.exists() else None
    assert (hashlib.sha256(old).hexdigest() if old is not None else None) == expected, f'SOURCE_CONFLICT {filename}'
    originals[p] = old
    replacements[p] = subprocess.check_output(['git', 'show', f'{commit}:{filename}'])
assert os.statvfs(root).f_bavail * os.statvfs(root).f_frsize > 60 * 1024**3
print('CLOSE_CONTEXT_SOURCE_GUARDS_PASS', flush=True)
if '--apply' not in sys.argv:
    sys.exit(0)
state_script = b'''const m=require('mysql2/promise'),h=require('crypto');(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const [s]=await c.query('SELECT setting_key,setting_value FROM system_settings ORDER BY setting_key');const [v]=await c.query('SELECT name FROM control_schema_migrations ORDER BY name');console.log(JSON.stringify({settingsSha256:h.createHash('sha256').update(JSON.stringify(s)).digest('hex'),migrations:v}));await c.end()})().catch(()=>process.exit(1));'''
def snapshot():
    return json.loads(subprocess.check_output(['docker', 'exec', '-i', 'nazraa-api-1', 'node'], input=state_script))
before = snapshot()
backup = Path('/opt/nazraa/backups/stabilization-close-context-20261025.tar.gz')
assert not backup.exists()
with tarfile.open(backup, 'w:gz') as archive:
    for p, old in originals.items():
        if old is not None:
            archive.add(p, arcname=str(p).lstrip('/'))
backup.chmod(0o600)
image = subprocess.check_output(['docker', 'inspect', '-f', '{{.Image}}', 'nazraa-api-1'], text=True).strip()
subprocess.run(['docker', 'tag', image, 'nazraa-api:before-close-context-20261025'], check=True)
compose = ['docker', 'compose', '-f', '/opt/nazraa/compose.yaml']
try:
    for p, data in replacements.items():
        p.write_bytes(data)
    subprocess.run([*compose, 'build', 'api'], check=True)
    subprocess.run([*compose, 'up', '-d', '--no-deps', 'api'], check=True)
    for _ in range(24):
        if subprocess.check_output(['docker', 'inspect', '-f', '{{.State.Health.Status}}', 'nazraa-api-1'], text=True).strip() == 'healthy':
            break
        time.sleep(5)
    else:
        raise RuntimeError('API unhealthy')
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '20', '--output', '/dev/null', 'https://nazralive.in/api/v1/config'], check=True)
    assert before == snapshot(), 'Settings/schema changed unexpectedly'
    Path('/opt/nazraa/tools/stabilization-close-context-deployed.json').write_text(json.dumps({
        'commit': commit, 'sourceBackup': str(backup), 'rollbackImage': image,
        'settingsUnchanged': True, 'migrationsUnchanged': True, 'apiOnlyRestart': True, 'at': time.time(),
    }, indent=2))
    print('CLOSE_CONTEXT_DEPLOY_PASS; NO_MEDIA_SCHEMA_ECONOMY_OR_PUBLIC_RELEASE_CHANGE', flush=True)
except BaseException:
    for p, old in originals.items():
        if old is None:
            p.unlink(missing_ok=True)
        else:
            p.write_bytes(old)
    subprocess.run(['docker', 'tag', image, 'nazraa-api:production-candidate'], check=True)
    subprocess.run([*compose, 'up', '-d', '--no-deps', 'api'], check=True)
    print('CLOSE_CONTEXT_ROLLED_BACK', flush=True)
    raise
