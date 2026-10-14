"""Run the existing private OCI backup with its existing root-only settings.
No environment value is printed; the predeploy tag excludes lifecycle expiry.
"""
import os
import shlex
import subprocess

assert os.geteuid() == 0
status = subprocess.run(['systemctl','is-active','nazraa-backup.service'],capture_output=True,text=True)
assert status.stdout.strip() != 'active', 'Existing backup still active; do not run two dumps'
raw = subprocess.check_output(['systemctl','show','nazraa-backup.service','-p','Environment','--value'],text=True)
env = dict(os.environ)
for entry in shlex.split(raw):
    name, value = entry.split('=',1)
    env[name] = value
assert env.get('NAZRAA_BACKUP_PRODUCTION_CONFIRMED') == '1'
env['NAZRAA_BACKUP_TAG'] = 'predeploy'
subprocess.run(['/bin/bash','/opt/nazraa/app-next/deploy/vps/backup-to-oci.sh'],env=env,check=True)
print('PREDEPLOY_BACKUP_VERIFIED')
