"""Stage only the reviewed Party hotfix; preserve existing production overlays."""
from pathlib import Path
import hashlib
import subprocess
import urllib.request
root=Path('/opt/nazraa/app-next')
assert Path.cwd().resolve()==root
assert subprocess.check_output(['git','rev-parse','--short','HEAD']).decode().strip()=='875d341'
assert 'const releaseVersion = "2.4.82";' in (root/'lib/release/latest-release.ts').read_text()
assert subprocess.check_output(['systemctl','show','nazraa-backup.service','-p','Result','--value']).decode().strip()=='success'
log=subprocess.check_output(['journalctl','-u','nazraa-backup.service','-n','1','--no-pager','--grep','Offsite backup verified'],text=True)
assert 'nazraa-nightly-20261015T080437Z' in log,'EXPECTED_FRESH_VERIFIED_BACKUP'
patch=urllib.request.urlopen('https://github.com/aishKodes/nazraa/commit/a9b6237.patch',timeout=30).read()
assert hashlib.sha256(patch).hexdigest()=='20883fcf7d73d00f7ecff397868bcdaf0cff16c2bd1e0efff66eb98b3d07d745'
subprocess.run(['git','apply','--check','-'],input=patch,cwd=root,check=True)
backup=Path('/opt/nazraa/backups/release-2.4.83')
assert not backup.exists(),'Do not overwrite an existing rollback'
backup.mkdir(mode=0o700)
def save(name,data):
    p=backup/name;p.write_bytes(data);p.chmod(0o600)
save('source-head.txt',subprocess.check_output(['git','rev-parse','HEAD']))
save('existing-dirty-source.patch',subprocess.check_output(['git','diff','--binary']))
save('previous-source.tar.gz',subprocess.check_output(['git','archive','--format=tar.gz','HEAD']))
save('approved-update.patch',patch)
image=subprocess.check_output(['docker','inspect','nazraa-api-1','--format','{{.Image}}']).decode().strip()
save('previous-api-image.txt',image.encode())
subprocess.run(['docker','tag',image,'nazraa-api:rollback-before-2.4.83'],check=True)
subprocess.run(['git','apply','-'],input=patch,cwd=root,check=True)
print('PARTY_MIC_SOURCE_STAGED; rollback source/image protected; no service restarted; no migration required.')
