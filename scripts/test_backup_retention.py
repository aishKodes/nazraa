import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).resolve().parents[1] / 'deploy/vps/retain-local-nightly.py'
spec = importlib.util.spec_from_file_location('retention', source)
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTests(unittest.TestCase):
    def test_same_day_only_by_default(self):
        early = Path('nazraa-nightly-20261024T010000Z.sql.gz')
        late = Path('nazraa-nightly-20261024T203000Z.sql.gz')
        other = Path('nazraa-nightly-20261023T203000Z.sql.gz')
        self.assertEqual(retention.duplicate_candidates([early, late, other], late.name), [early])

    def test_explicit_rolling_policy_and_protected_files(self):
        files = [Path(f'nazraa-nightly-202610{day:02d}T203000Z.sql.gz') for day in range(1, 25)]
        protected = [Path('nazraa-predeploy-20261001T203000Z.sql.gz'),
                     Path('nazraa-nightly-20260929T203000Z.sql.gz'), Path('recovery.sql.gz')]
        selected = retention.duplicate_candidates(files+protected, files[-1].name, True)
        self.assertEqual(len(selected), 15)
        kept_days = {retention.NAME.fullmatch(p.name)[1] for p in set(files)-set(selected)}
        self.assertEqual(kept_days, {'20261004', '20261011', *[f'202610{day:02d}' for day in range(18, 25)]})
        self.assertFalse(set(protected) & set(selected))
        self.assertEqual(retention.duplicate_candidates(files+protected, files[-1].name), [])

    def test_refuse_old_non_nightly_or_non_latest_verified_name(self):
        early = Path('nazraa-nightly-20261024T010000Z.sql.gz')
        late = Path('nazraa-nightly-20261024T203000Z.sql.gz')
        for name in ['../backup.sql.gz', 'nazraa-predeploy-20261024T203000Z.sql.gz',
                     'nazraa-nightly-20260929T010000Z.sql.gz', early.name]:
            with self.assertRaises(ValueError):
                retention.duplicate_candidates([early, late], name)


if __name__ == '__main__':
    unittest.main()
