"""Guarded owner-scoped VPS source staging after verified private predeploy backup."""
from pathlib import Path
import hashlib
import subprocess
import urllib.request

root = Path('/opt/nazraa/app-next')
assert Path.cwd().resolve() == root
assert subprocess.check_output(['git','rev-parse','--short','HEAD']).decode().strip() == '875d341'
assert 'PREDEPLOY_BACKUP_VERIFIED' in Path('/opt/nazraa/backups/three-workstreams-qa/predeploy.log').read_text()
assert 'const releaseVersion = "2.4.79";' in (root/'lib/release/latest-release.ts').read_text()
backup = Path('/opt/nazraa/backups/release-2.4.80')
assert not backup.exists(), 'Never overwrite an existing rollback'
patch = urllib.request.urlopen('https://github.com/aishKodes/nazraa/commit/e447a85.patch',timeout=30).read()
assert hashlib.sha256(patch).hexdigest() == '4bddf5f6b12d62cf1226cf9a7d0acc60c5fdcbddd617bed32088d553e3b8e96f'
subprocess.run(['git','apply','--check','-'],input=patch,check=True)
backup.mkdir(mode=0o700)
def save(name, content):
    file = backup/name
    file.write_bytes(content)
    file.chmod(0o600)
save('source-head.txt',subprocess.check_output(['git','rev-parse','HEAD']))
save('existing-dirty-source.patch',subprocess.check_output(['git','diff','--binary']))
files = subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'])
save('previous-source.tar.gz',subprocess.check_output(['tar','--null','-T','-','-czf','-'],input=files))
save('approved-update.patch',patch)
image = subprocess.check_output(['docker','inspect','nazraa-api-1','--format','{{.Image}}']).decode().strip()
save('previous-api-image.txt',image.encode())
subprocess.run(['docker','tag',image,'nazraa-api:rollback-before-2.4.80'],check=True)
subprocess.run(['git','apply','-'],input=patch,check=True)
print('SOURCE_STAGE_PASS; 2.4.79 image, all existing source and owner edits preserved; media untouched.')
