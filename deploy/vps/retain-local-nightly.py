#!/usr/bin/env python3
"""Keep verified redundant local nightly copies bounded.

Invoked only after backup-to-oci.sh verifies an immutable offsite upload.
Default: same-day dedupe only. The separately approved rolling opt-in keeps
seven daily + four weekly representatives. All predeploy, September cutover
and recovery files are excluded. Failed OCI checks preserve local candidates.
No bucket objects or database records are removed.
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


def duplicate_candidates(files, verified_name, rolling=False):
    files = list(files)
    match = NAME.fullmatch(verified_name)
    if not match or match[1] < '20261001':
        raise ValueError('Only post-cutover nightly backups are eligible')
    same_day = sorted(p for p in files if NAME.fullmatch(p.name)
                      and NAME.fullmatch(p.name)[1] == match[1])
    if not same_day or same_day[-1].name != verified_name:
        raise ValueError('Verified backup must be the newest for its UTC day')
    if not rolling:
        return same_day[:-1]
    # Retain seven recent UTC daily backups plus one newest per ISO week for
    # four weeks. September cutover files and every non-nightly name are exempt.
    eligible = sorted(p for p in files if NAME.fullmatch(p.name)
                      and '20261001' <= NAME.fullmatch(p.name)[1] <= match[1])
    latest_day = datetime.datetime.strptime(match[1], '%Y%m%d').date()
    keep = set()
    daily = {}
    weekly = {}
    for path in eligible:
        day = datetime.datetime.strptime(NAME.fullmatch(path.name)[1], '%Y%m%d').date()
        daily[day] = path
        weekly[day.isocalendar()[:2]] = path
    for day, path in daily.items():
        if (latest_day-day).days < 7:
            keep.add(path)
    keep.update(list(weekly.values())[-4:])
    return [path for path in eligible if path not in keep]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verified-backup', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rolling-retention', action='store_true',
                        help='Owner approval required: seven daily + four weekly; protected files excluded')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Root required')
    candidates = duplicate_candidates(BACKUPS.iterdir(), args.verified_backup, args.rolling_retention)
    if not candidates:
        print('Nightly retention: no redundant nightlies')
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
          len(candidates), 'verified redundant nightlies;', sum(v['bytes'] for v in manifest), 'bytes')


if __name__ == '__main__':
    main()
