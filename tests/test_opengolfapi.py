import json
import unittest

from packages.course_import.opengolfapi import (
    OpenGolfApiClient,
    OpenGolfApiConfig,
    enrich_project_scorecard,
)
from packages.course_import.openstreetmap import _empty_hole


class OpenGolfApiTests(unittest.TestCase):
    def test_exact_nearby_match_uses_server_side_bearer_key(self):
        calls=[]
        def transport(url,headers,timeout,max_bytes):
            calls.append((url,dict(headers)))
            return 200,json.dumps({'courses':[
                {'id':'correct','course_name':'Airways Golf Course','city':'Fresno','state':'CA',
                 'latitude':36.778,'longitude':-119.7076},
                {'id':'far','course_name':'Airways Golf Course','city':'Elsewhere','state':'CA',
                 'latitude':34.0,'longitude':-118.0},
            ]}).encode()
        client=OpenGolfApiClient(OpenGolfApiConfig(enabled=True,api_key='ogapi_private'),transport)
        match=client.match(name='Airways Golf Course',city='Fresno',state='CA',
                           latitude=36.778,longitude=-119.7076)
        self.assertEqual(match['id'],'correct')
        self.assertEqual(calls[0][1]['Authorization'],'Bearer ogapi_private')
        self.assertNotIn('ogapi_private',calls[0][0])

    def test_scorecard_merge_preserves_missing_tees_and_records_provenance(self):
        project={'holes':{str(n):_empty_hole(n) for n in range(1,19)},
                 'external_course_source':{},'import_preview':{'needs_work':['Enter trusted scorecard yardages.']}}
        detail={'id':'course-1','course_name':'Airways Golf Course',
                'tees':[{'tee_name':'White','course_rating':65,'slope':112}],
                'holes_data':[{'number':n,'par':3 if n==5 else 4,'handicap_index':n,
                               'yardages':{'white':300+n,'red':280+n}} for n in range(1,19)]}
        enrich_project_scorecard(project,detail)
        first=project['holes']['1']
        self.assertEqual(first['par'],4)
        self.assertEqual(first['handicap'],1)
        self.assertEqual(first['yardages'],{'blue':0,'white':301,'forward':281})
        self.assertEqual(first['field_provenance']['yardages']['white'],'opengolfapi')
        self.assertEqual(project['import_preview']['scorecard']['yardages'],
                         {'blue':0,'white':18,'forward':18})
        self.assertIn('Review tee sets missing from the OpenGolfAPI scorecard.',
                      project['import_preview']['needs_work'])

    def test_ambiguous_exact_matches_are_not_guessed(self):
        def transport(url,headers,timeout,max_bytes):
            return 200,json.dumps({'courses':[
                {'id':str(n),'course_name':'Twin Golf Course','state':'NJ',
                 'latitude':40+n/1000,'longitude':-74} for n in (1,2)
            ]}).encode()
        client=OpenGolfApiClient(OpenGolfApiConfig(enabled=True),transport)
        with self.assertRaisesRegex(ValueError,'2 exact'):
            client.match(name='Twin Golf Course',city='Test',state='NJ',latitude=40,longitude=-74)


if __name__ == '__main__':
    unittest.main()
