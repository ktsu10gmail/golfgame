"""Exercise release drift refusal and rollback using disposable source trees."""
import hashlib,tempfile,unittest
from pathlib import Path
from scripts.mapper_release_receiver import apply,rollback,target

class MapperReleaseTests(unittest.TestCase):
    def package(self,old,new):
        return {'commit':'a'*40,'files':{'editor.js':{'content':new,'sha256':hashlib.sha256(new.encode()).hexdigest(),'expected':hashlib.sha256(old.encode()).hexdigest()}}}
    def test_apply_and_rollback_preserve_runtime_and_restore_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'editor.js').write_text('old');(root/'data').mkdir();(root/'data/course_library.sqlite3').write_bytes(b'private-runtime')
            result=apply(root,self.package('old','new'),lambda:None)
            self.assertEqual((root/'editor.js').read_text(),'new')
            self.assertEqual((root/'data/course_library.sqlite3').read_bytes(),b'private-runtime')
            rollback(root,result['backup'],lambda:None)
            self.assertEqual((root/'editor.js').read_text(),'old')
    def test_drift_refuses_before_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'editor.js').write_text('concurrent-owner-work')
            with self.assertRaisesRegex(ValueError,'Target changed'):apply(root,self.package('old','new'),lambda:None)
            self.assertEqual((root/'editor.js').read_text(),'concurrent-owner-work')
            self.assertFalse((root/'data').exists())
    def test_failed_health_restores_previous_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'editor.js').write_text('old');calls=[]
            def health():
                calls.append(1)
                if len(calls)==1:raise ValueError('unhealthy')
            with self.assertRaisesRegex(ValueError,'unhealthy'):apply(root,self.package('old','new'),health)
            self.assertEqual((root/'editor.js').read_text(),'old')
            self.assertEqual(len(calls),2)
    def test_later_edits_block_rollback(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'editor.js').write_text('old')
            result=apply(root,self.package('old','new'),lambda:None)
            (root/'editor.js').write_text('later-owner-work')
            with self.assertRaisesRegex(ValueError,'Source changed'):rollback(root,result['backup'],lambda:None)
            self.assertEqual((root/'editor.js').read_text(),'later-owner-work')
    def test_sensitive_paths_and_symlinks_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name in ['.env','data/course_library.sqlite3','../editor.js']:
                with self.assertRaises(ValueError):target(root,name)
            (root/'editor.js').symlink_to(root/'elsewhere')
            with self.assertRaises(ValueError):target(root,'editor.js')

if __name__=='__main__':unittest.main()
