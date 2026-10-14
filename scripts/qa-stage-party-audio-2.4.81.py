"""Stage the tested owner-approved Party/Audio update, preserving dirty production."""
from pathlib import Path
import hashlib
import subprocess
import urllib.request

root=Path('/opt/nazraa/app-next')
assert Path.cwd().resolve()==root
assert subprocess.check_output(['git','rev-parse','--short','HEAD']).decode().strip()=='875d341'
assert 'PREDEPLOY_BACKUP_VERIFIED' in Path('/opt/nazraa/backups/party-audio-20261015/predeploy.log').read_text()
assert 'const releaseVersion = "2.4.80";' in (root/'lib/release/latest-release.ts').read_text()
backup=Path('/opt/nazraa/backups/release-2.4.81')
assert not backup.exists(),'Never overwrite rollback'
patch=urllib.request.urlopen('https://github.com/aishKodes/nazraa/commit/7c7d8f3.patch',timeout=30).read()
assert hashlib.sha256(patch).hexdigest()=='3d09951716f403ec2b51d4c774251c0ae8108838653f4959c601223aab576910'
subprocess.run(['git','apply','--check','-'],input=patch,check=True)
backup.mkdir(mode=0o700)
def save(name,data):
    file=backup/name;file.write_bytes(data);file.chmod(0o600)
save('source-head.txt',subprocess.check_output(['git','rev-parse','HEAD']))
save('existing-dirty-source.patch',subprocess.check_output(['git','diff','--binary']))
files=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'])
save('previous-source.tar.gz',subprocess.check_output(['tar','--null','-T','-','-czf','-'],input=files))
save('approved-update.patch',patch)
image=subprocess.check_output(['docker','inspect','nazraa-api-1','--format','{{.Image}}']).decode().strip()
save('previous-api-image.txt',image.encode())
subprocess.run(['docker','tag',image,'nazraa-api:rollback-before-2.4.81'],check=True)
subprocess.run(['git','apply','-'],input=patch,check=True)
print('PARTY_AUDIO_SOURCE_STAGE_PASS; previous API/source and owner edits preserved; no media restart.')
