"""Stage verified public metadata only; preserve the existing production overlay."""
from pathlib import Path
import hashlib
import urllib.request

root=Path('/opt/nazraa/app-next')
backup=Path('/opt/nazraa/backups/release-2.4.81')
assert root.is_dir() and backup.is_dir()
assert (root/'db/migrations/0102_audio_party_pk.sql').exists()
assert 'd6bc44d902ce3fc39e3779520649851286554f8dd9672bc916d31f37dd6cc89e' in (backup/'public-apk-verification.log').read_text()
target=root/'lib/release/latest-release.ts'
old=target.read_bytes()
if b'const releaseVersion = "2.4.81";' in old:
    assert hashlib.sha256(old).hexdigest()=='3ad9ed82cfa0206c587d18ffaa7848e91c38c1be5b4e37d8401d1e4d2085d274'
    print('RELEASE_2_4_81_METADATA_ALREADY_STAGED')
else:
    assert b'const releaseVersion = "2.4.80";' in old
    source=urllib.request.urlopen('https://raw.githubusercontent.com/aishKodes/nazraa/f2c3328/lib/release/latest-release.ts',timeout=30).read()
    assert hashlib.sha256(source).hexdigest()=='3ad9ed82cfa0206c587d18ffaa7848e91c38c1be5b4e37d8401d1e4d2085d274'
    previous=backup/'latest-release.previous.ts'
    assert not previous.exists()
    previous.write_bytes(old)
    previous.chmod(0o600)
    target.write_bytes(source)
    print('RELEASE_2_4_81_METADATA_STAGED; verified public APK; no media/economy change')
