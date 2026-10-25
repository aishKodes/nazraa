#!/usr/bin/env python3
"""Keep the newest verified nightly for one UTC day; never age-delete data.

Invoked only after backup-to-oci.sh verifies an immutable offsite upload.
All predeploy, cutover, recovery and other-day files are excluded. Failing an
OCI check preserves every local candidate. No bucket objects are removed.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import subprocess

BACKUPS = Path('/opt/nazraa/backups/production')
NAME = re.compile(r'^nazraa-nightly-(20\d{6})T\d{6}Z\.sql\.gz$')


def duplicate_candidates(files, verified_name):
    match = NAME.fullmatch(verified_name)
    if not match or match[1] < '20261001':
        raise ValueError('Only post-cutover nightly backups are eligible')
    same_day = sorted(p for p in files if NAME.fullmatch(p.name)
                      and NAME.fullmatch(p.name)[1] == match[1])
    if not same_day or same_day[-1].name != verified_name:
        raise ValueError('Verified backup must be the newest for its UTC day')
    return same_day[:-1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verified-backup', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Root required')
    candidates = duplicate_candidates(BACKUPS.iterdir(), args.verified_backup)
    if not candidates:
        print('Nightly retention: no same-day duplicates')
        return
    latest = BACKUPS / args.verified_backup
    if latest.is_symlink() or not latest.is_file():
        raise ValueError('Invalid verified backup')
    subprocess.run(['sha256sum', '--status', '-c', str(latest)+'.sha256'], check=True)
    oci = ['oci', '--config-file', os.environ['OCI_CLI_CONFIG_FILE'], '--region',
           'ap-mumbai-1', 'os', 'object', 'head', '--bucket-name',
           os.environ['NAZRAA_BACKUP_OCI_BUCKET']]
    manifest = []
    # Complete all checks before the first deletion. Ordinary nightly names
    # have no symlinks, directories, wildcards or caller-selected paths.
    for path in [latest, *candidates]:
        if path.is_symlink() or not path.is_file():
            raise ValueError('Invalid nightly file')
        data = json.loads(subprocess.check_output(
            [*oci, '--name', 'production/'+path.name], stderr=subprocess.DEVNULL))
        if int(data['content-length']) != path.stat().st_size:
            raise ValueError('Offsite size mismatch')
        subprocess.run([*oci, '--name', 'production/'+path.name+'.sha256'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if path != latest:
            manifest.append({'name': path.name, 'bytes': path.stat().st_size,
                             'checksumManifest': Path(str(path)+'.sha256').read_text()})
    if args.apply:
        log = Path('/opt/nazraa/logs/nightly-retention.jsonl')
        with log.open('a') as stream:
            stream.write(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                     'verified': latest.name, 'remove': manifest})+'\n')
        for path in candidates:
            path.unlink()
            Path(str(path)+'.sha256').unlink(missing_ok=True)
    print('Nightly retention:', 'removed' if args.apply else 'would remove',
          len(candidates), 'same-day duplicates;', sum(v['bytes'] for v in manifest), 'bytes')


if __name__ == '__main__':
    main()
