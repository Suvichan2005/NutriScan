import tempfile
import unittest
from pathlib import Path
import local_staging_smoke as smoke

class StagingPreservation(unittest.TestCase):
    def test_snapshot_preserves_bytes_and_never_restores_over_later_edits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);out=root/'.data/study-staging'
            (root/'next-env.d.ts').write_bytes(b'owner original\r\n')
            (root/'tsconfig.json').write_bytes(b'{"compilerOptions":{}}')
            saved,backup=smoke.snapshot_configs(root,out)
            (root/'tsconfig.json').write_bytes(b'concurrent edit')
            for rel,value in saved.items():self.assertEqual((backup/rel).read_bytes(),value)
            self.assertEqual((root/'tsconfig.json').read_bytes(),b'concurrent edit')
            _,second=smoke.snapshot_configs(root,out)
            self.assertNotEqual(backup,second)
            self.assertEqual((backup/'tsconfig.json').read_bytes(),saved['tsconfig.json'])

if __name__=='__main__':unittest.main()
