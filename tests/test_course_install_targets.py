import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from scripts import course_install_targets as targets, import_mapped_course as importer
from test_mapped_course_import import package

class DestinationTests(unittest.TestCase):
    def test_fingerprint_changes_for_geometry_but_not_install_metadata(self):
        p=package();f=targets.fingerprint(p);p['exported_at']='new';p['install_target']='prod'
        self.assertEqual(f,targets.fingerprint(p));p['holes']['1']['hole_metadata']['par']=5
        self.assertNotEqual(f,targets.fingerprint(p))
    def test_backup_verified_install_and_restore_on_partial_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=root/'data';data.mkdir()
            with patch.object(importer,'DATA_DIR',data),patch.object(importer,'CATALOG_PATH',data/'mapped_courses.json'):
                p=package();result=targets.receive(root,p);self.assertTrue(result['verified'])
                original=(data/'mapped-links/hole1.json').read_bytes();catalog=(data/'mapped_courses.json').read_bytes()
                def fail(*args,**kwargs):
                    (data/'mapped-links/hole1.json').write_text('broken');(data/'mapped_courses.json').write_text('[]');raise OSError('disk failure')
                with patch.object(importer,'install_package',side_effect=fail),self.assertRaises(OSError):targets.receive(root,p)
                self.assertEqual(original,(data/'mapped-links/hole1.json').read_bytes());self.assertEqual(catalog,(data/'mapped_courses.json').read_bytes())
    def test_prod_refuses_missing_or_changed_dev_content_before_ssh(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'data').mkdir()
            with patch.object(targets.subprocess,'run') as remote:
                with self.assertRaisesRegex(ValueError,'Dev first'):targets.install_target(root,package(),'prod')
                remote.assert_not_called()
    def test_incomplete_packages_write_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            p=package();del p['holes']['18']
            with self.assertRaises(ValueError):targets.receive(Path(folder),p)
            self.assertEqual(list(Path(folder).iterdir()),[])
    def test_nine_hole_dev_install_verifies_and_writes_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=root/'data';data.mkdir()
            p=package()
            p['hole_count']=9
            p['holes']={key:value for key,value in p['holes'].items() if int(key)<=9}
            p['scorecard_csv']='Hole,Par\n'+''.join(f'{number},4\n' for number in range(1,10))
            with patch.object(importer,'DATA_DIR',data),patch.object(importer,'CATALOG_PATH',data/'mapped_courses.json'):
                result=targets.install_target(root,p,'dev')
            self.assertTrue(result['verified'])
            self.assertEqual(result['holes'],9)
            self.assertFalse((data/'mapped-links/hole10.json').exists())
            receipt=json.loads((data/'install-receipts/mapped-links.json').read_text())
            self.assertEqual(receipt['holes'],9)
            self.assertEqual(json.loads((data/'mapped_courses.json').read_text())[0]['holeCount'],9)

    def test_unknown_destination_rejected(self):
        with self.assertRaisesRegex(ValueError,'Unknown'):targets.install_target(Path('/tmp'),package(),'evil')

class DestinationHttpTests(unittest.TestCase):
    def test_prod_receipt_and_refusal_are_returned_by_authenticated_install_route(self):
        import http.client,threading,os
        from http.server import ThreadingHTTPServer
        from scripts import serve
        with patch.dict(os.environ,{'GOLFGAME_ENVIRONMENT':'development'}),patch.object(serve.AppHandler,'_require_developer',return_value={'id':'test-developer'}):
            server=ThreadingHTTPServer(('127.0.0.1',0),serve.AppHandler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                payload={**package(),'install_target':'prod'}
                for outcome,expected in [(ValueError('Install in Dev first'),400),({'verified':True,'install_target':'prod','backup':'test-backup'},200)]:
                    with patch.object(targets,'install_target',side_effect=outcome if isinstance(outcome,Exception) else None,return_value=outcome):
                        connection=http.client.HTTPConnection('127.0.0.1',server.server_port)
                        connection.request('POST','/api/course-mapper/install',json.dumps(payload),{'Content-Type':'application/json'})
                        response=connection.getresponse();result=json.load(response);self.assertEqual(response.status,expected)
                        if expected==200:self.assertTrue(result['verified']);self.assertEqual(result['install_target'],'prod')
                        else:self.assertIn('Dev first',result['error'])
                        connection.close()
            finally:server.shutdown();server.server_close();thread.join()
