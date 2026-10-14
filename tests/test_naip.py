import copy,json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from packages.course_import.naip import evidence_bounds,load_naip,geometry_assist,mercator,geographic

COURSE={'id':'course_test','name':'Test','country':'US','latitude':35.29,'longitude':-78.97,'revision':1}
PROJECT={'holes':{'1':{'features':[{'type':'green','points':[{'lat':35.291,'lng':-78.971},{'lat':35.292,'lng':-78.971},{'lat':35.291,'lng':-78.972}]}]}},'external_course_source':{'provider_name':'openstreetmap'}}
class NaipTests(unittest.TestCase):
 def test_non_us_does_not_request_imagery(self):
  with tempfile.TemporaryDirectory() as temp,patch('packages.course_import.naip._json') as request:
   result=load_naip({**COURSE,'country':'TW'},PROJECT,temp)
   self.assertEqual(result['status'],'unavailable');request.assert_not_called()
 def test_empty_coverage_and_outage_remain_unknown_or_unavailable(self):
  with tempfile.TemporaryDirectory() as temp,patch('packages.course_import.naip._json',return_value={'features':[]}):
   self.assertEqual(load_naip(COURSE,PROJECT,temp)['status'],'unavailable')
  with tempfile.TemporaryDirectory() as temp,patch('packages.course_import.naip._json',side_effect=OSError('offline')):
   self.assertEqual(load_naip(COURSE,PROJECT,temp)['status'],'unknown')
 def test_bounded_query_locks_rasters_and_reuses_cache_without_mutation(self):
  before=copy.deepcopy(PROJECT)
  catalog={'features':[{'attributes':{'OBJECTID':5,'Year':2022,'acquisition_date':None,'resolution_value':None}}]}
  lo=mercator(-78.98,35.28);hi=mercator(-78.96,35.30)
  exported={'href':'https://imagery.nationalmap.gov/arcgis/rest/directories/arcgisoutput/test.png','extent':{'xmin':lo[0],'ymin':lo[1],'xmax':hi[0],'ymax':hi[1],'spatialReference':{'wkid':3857}}}
  with tempfile.TemporaryDirectory() as temp,patch('packages.course_import.naip._json',side_effect=[catalog,exported]) as request,patch('packages.course_import.naip._read',return_value=b'\x89PNG\r\n\x1a\nfixture'):
   result=load_naip(COURSE,PROJECT,temp)
   self.assertEqual(result['status'],'available');self.assertEqual(result['acquisition_dates'],[])
   self.assertEqual(json.loads(request.call_args_list[0].args[1]['geometry'])['spatialReference']['wkid'],4326)
   self.assertEqual(json.loads(request.call_args_list[1].args[1]['mosaicRule'])['lockRasterIds'],[5])
   self.assertEqual(request.call_args_list[1].args[1]['imageSR'],3857)
   cached=load_naip(COURSE,PROJECT,temp);self.assertTrue(cached['cached']);self.assertEqual(request.call_count,2)
   self.assertAlmostEqual(result['image_bounds'][0][0],35.28)
  self.assertEqual(PROJECT,before)
 def test_unexpected_image_host_is_not_followed(self):
  with tempfile.TemporaryDirectory() as temp,patch('packages.course_import.naip._json',side_effect=[{'features':[{'attributes':{'OBJECTID':1,'Year':2022}}]},{'href':'https://untrusted.invalid/image.png'}]),patch('packages.course_import.naip._read') as read:
   self.assertEqual(load_naip(COURSE,PROJECT,temp)['status'],'unknown');read.assert_not_called()
 def test_read_only_course_access_does_not_change_saved_revision(self):
  with tempfile.TemporaryDirectory() as temp:
   path=Path(temp)/'library.db';db=sqlite3.connect(path)
   db.execute('create table library_courses(id,name,country,latitude,longitude,revision)');db.execute('insert into library_courses values(?,?,?,?,?,?)',tuple(COURSE[k] for k in ['id','name','country','latitude','longitude','revision']));db.commit();db.close()
   class Library:
    root=Path(temp)
    def connect(self):
     connection=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row;return connection
    def project(self,*args):return copy.deepcopy(PROJECT)
    def save(self,*args):raise AssertionError('Must not save')
   before=path.read_bytes()
   with patch('packages.course_import.naip.load_naip',return_value={'status':'unknown'}):geometry_assist(Library(),'course_test')
   self.assertEqual(path.read_bytes(),before)
 def test_outlier_features_cannot_expand_request(self):
  project={'holes':{'1':{'features':[{'points':[{'lat':1,'lng':1}]}]}}}
  bounds=evidence_bounds(COURSE,project)
  self.assertLess(bounds[2]-bounds[0],.05)
if __name__=='__main__':unittest.main()
