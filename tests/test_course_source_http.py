import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from scripts import serve
from scripts.mapper_access import MapperAccess
from tests import test_course_source_review as fixtures


class SourceUpdateHttpTests(unittest.TestCase):

    def setUp(self):
        fixtures.SourceUpdateServiceTests.setUp(self)
        self.patches=[patch.object(serve,'SERVER_ROLE','app'),
                      patch.object(serve,'COURSE_LIBRARY',self.library),
                      patch.object(serve,'MAPPER_ACCESS',MapperAccess(service_token='fixture-service-token')),
                      patch.object(serve.AppHandler,'_current_player',return_value=None)]
        for item in self.patches: item.start()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),serve.AppHandler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True); self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        for item in reversed(self.patches): item.stop()
        fixtures.SourceUpdateServiceTests.tearDown(self)

    def request(self,method,action,payload=None,authorized=True):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        headers={'Content-Type':'application/json'}
        if authorized: headers['X-Jetta-Mapper-Service']='fixture-service-token'
        connection.request(method,'/api/v1/course-library/'+action,
                           body=json.dumps(payload) if payload is not None else None,headers=headers)
        response=connection.getresponse(); result=response.status,json.loads(response.read()); connection.close()
        return result

    def test_protected_review_apply_history_and_restore_endpoints(self):
        self.assertEqual(self.request('GET','history?id='+self.identity,authorized=False)[0],401)
        self.assertEqual(self.request('POST','check-source',{'id':self.identity},authorized=False)[0],401)
        self.osm.project['holes']['1']['features'][0]['points'][0]['lat']+=.00002
        status,job=self.request('POST','check-source',{'id':self.identity}); self.assertEqual(status,200)
        self.library.process_source_update()
        status,review=self.request('GET','source-review?id='+job['id']); self.assertEqual(status,200)
        self.assertEqual(review['status'],'Review ready')
        accepted=[item['id'] for item in review['changes']]
        status,result=self.request('POST','apply-source',{'id':job['id'],'revision':1,'accepted':accepted})
        self.assertEqual(status,200); self.assertEqual(result['revision'],2)
        status,history=self.request('GET','history?id='+self.identity)
        self.assertEqual([r['revision'] for r in history['revisions']],[2,1])
        status,historical=self.request('GET',f'project?id={self.identity}&revision=1')
        self.assertEqual(historical['project']['library_context']['revision'],1)
        self.assertEqual(self.request('POST','restore-revision',{'id':self.identity,'source_revision':1,'revision':1})[0],400)
        self.assertEqual(self.request('POST','restore-revision',{'id':self.identity,'source_revision':1,'revision':2})[1]['revision'],3)
