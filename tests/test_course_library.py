import copy
import json
import tempfile
import unittest
from pathlib import Path

from packages.course_import.library import CourseLibrary
from packages.course_import.golf_intelligence import CourseImportError
from packages.course_import.openstreetmap import normalize_openstreetmap_course
from tests.test_openstreetmap_import import osm_detail


HEADER = 'Course Name,State,City,Latitude,Longitude\n'
CSV = HEADER + 'Evidence Golf Club,NJ,Town,40.6,-74.5\n'


class FakeOsm:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.results = [{'name':'Evidence Golf Club','external_id':'way/100'}]
        self.project = normalize_openstreetmap_course(osm_detail(), 'way/100')

    def search(self, payload):
        self.calls += 1
        if self.fail:
            raise CourseImportError('Upstream unavailable', status=502)
        return {'results':self.results}

    def preview(self, payload, operator):
        return {'job_id':'preview'}

    def commit(self, payload, operator):
        return {'project':copy.deepcopy(self.project)}


class CourseLibraryTests(unittest.TestCase):
    def test_course_rejection_flag_persists_and_can_be_cleared(self):
        library = CourseLibrary(self.root, FakeOsm())
        identity = 'openstreetmap:way/100'
        self.assertEqual(library.flag_course(identity, True)['flags'], [identity])
        reopened = CourseLibrary(self.root, FakeOsm())
        self.assertEqual(reopened.course_flags()['flags'], [identity])
        reopened.flag_course('openstreetmap:way/101', True)
        self.assertEqual(reopened.flag_course(identity, False)['flags'], ['openstreetmap:way/101'])
        with self.assertRaises(ValueError):
            reopened.flag_course('', True)
        with self.assertRaises(ValueError):
            reopened.flag_course(identity, 'false')

    def test_paged_batch_skips_flagged_courses(self):
        library = CourseLibrary(self.root, FakeOsm())
        rows = HEADER + ''.join(f'Course {i:02d},NJ,Town,{40+i*.001},-74.5\n' for i in range(29))
        library.intake(rows)
        first = library.listing(limit=25)
        second = library.listing(offset=25, limit=25)
        self.assertEqual(len(first['courses']), 25)
        self.assertEqual(len(second['courses']), 5)
        identity = first['courses'][0]['id']
        library.flag_course('library:' + identity, True)
        self.assertTrue(library.listing(limit=25)['courses'][0]['no_good'])
        self.assertEqual(library.queue([c['id'] for c in first['courses']])['queued'], 24)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root/'data').mkdir()
        (self.root/'data/mapped_courses.json').write_text('[]')
        self.osm = FakeOsm()
        self.now = 1000
        self.library = CourseLibrary(self.root,self.osm,validator=lambda p:{'ready':False},clock=lambda:self.now)
        self.library.intake(CSV)
        self.identity = self.library.listing()['courses'][0]['id']

    def tearDown(self):
        self.library.stopping.set()
        self.temp.cleanup()

    def test_daily_intake_unchanged_reorder_and_changes(self):
        self.assertEqual(self.library.intake(CSV)['unchanged'],1)
        self.assertEqual(self.library.intake(CSV.replace('40.6','40.7'))['review'],1)
        self.assertEqual(self.library.listing()['courses'][0]['latitude'],40.6)
        self.assertEqual(self.library.queue([self.identity])['queued'],0)
        self.assertEqual(self.library.intake(HEADER)['rows'],0)
        self.assertEqual(self.library.listing()['total'],1)

    def test_rename_same_coordinate_does_not_duplicate(self):
        result = self.library.intake(CSV.replace('Evidence Golf Club','New Name'))
        self.assertEqual(result['review'],1)
        self.assertEqual(self.library.listing()['total'],2)
        renamed=[r for r in self.library.listing()['courses'] if r['name']=='New Name'][0]
        self.assertEqual(renamed['duplicate_of'],self.identity)
        with self.assertRaises(ValueError):
            self.library.queue([renamed['id']],retry=True)

    def test_bad_csv_and_duplicate_rows(self):
        with self.assertRaises(ValueError):
            self.library.intake('Name,Lat\nabc,1')
        result = self.library.intake(CSV + 'Evidence Golf Club,NJ,Town,nan,-74.5\n')
        self.assertEqual(len(result['errors']),1)
        with self.assertRaises(ValueError):
            self.library.intake(HEADER+'"unterminated')
        result = self.library.intake(CSV + CSV.splitlines()[1] + '\n')
        self.assertEqual(len(result['errors']),1)
        result = self.library.intake('Course ID,' + CSV.replace('Evidence Golf Club','../bad,Evidence Golf Club'))
        self.assertEqual(len(result['errors']),1)

    def test_local_contention_is_not_upstream_failure(self):
        from unittest.mock import patch
        self.library.queue([self.identity])
        with patch.object(self.osm,'search',side_effect=CourseImportError('Local request running',status=409)):
            self.library.process_one()
        row=self.library.listing()['courses'][0]
        self.assertEqual(row['attempts'],0)
        self.assertEqual(row['status'],'Retry pending')

    def test_partial_import_saved_once_not_retried_daily(self):
        self.assertEqual(self.library.queue([self.identity])['queued'],1)
        self.assertEqual(self.library.queue([self.identity])['queued'],0)
        self.assertTrue(self.library.process_one())
        row = self.library.listing()['courses'][0]
        self.assertEqual(row['status'],'Incomplete')
        self.assertEqual(row['revision'],1)
        self.assertTrue((self.root/'Courses/drafts'/self.identity/'revision-1.golfmap').exists())
        self.assertEqual(self.library.intake(CSV)['unchanged'],1)
        self.assertFalse(self.library.process_one())
        with self.assertRaises(ValueError):
            self.library.queue([self.identity],retry=True)

    def test_osm_import_uses_verified_source_id_as_game_id(self):
        self.library.queue([self.identity])
        self.library.process_one()
        project = self.library.project(self.identity)
        self.assertEqual(project['course_id'], 'osm-way-100')
        self.assertEqual(project['course_name'], 'Evidence Golf Club')
        self.assertEqual(self.library.listing()['courses'][0]['name'], 'Evidence Golf Club')

    def test_retry_maximum_three_total_attempts_and_pause(self):
        self.osm.fail=True
        self.library.queue([self.identity])
        for attempt in range(1,4):
            self.assertTrue(self.library.process_one())
            self.assertEqual(self.library.listing()['courses'][0]['attempts'],attempt)
            self.assertFalse(self.library.process_one())
            self.now += 400
        self.assertEqual(self.library.listing()['courses'][0]['status'],'Failed')
        self.assertEqual(self.osm.calls,3)
        self.library.queue([self.identity],retry=True)
        self.library.pause()
        self.assertFalse(self.library.process_one())

    def test_ambiguous_match_no_fetch_or_guess(self):
        self.osm.results *= 2
        self.library.queue([self.identity])
        self.library.process_one()
        self.assertEqual(self.library.listing()['courses'][0]['status'],'Needs review')
        self.assertEqual(self.library.listing()['courses'][0]['revision'],0)

    def test_revisions_conflict_and_stable_game_id(self):
        first = self.library.save(self.identity,self.osm.project,0,imported=True)
        edited = first['project']; original_id = edited['course_id']
        edited['course_name']='Updated'; edited['course_id']='renamed'
        self.library.save(self.identity,edited,1)
        self.assertEqual(self.library.project(self.identity)['course_id'],original_id)
        self.assertEqual(self.library.project(self.identity,1)['course_name'],'Evidence Golf Club')
        with self.assertRaises(ValueError):
            self.library.save(self.identity,edited,1)

    def test_real_node_readiness_and_unsupported_geometry_preservation(self):
        root = Path(__file__).resolve().parents[1]
        real = CourseLibrary(root,self.osm,database=self.root/'real.sqlite3')
        self.assertFalse(real.validator(self.osm.project)['ready'])
        raw = osm_detail()
        raw['elements'][0]['tags']['golf:holes']='36'
        project=normalize_openstreetmap_course(raw,'way/100')
        self.assertTrue(project['external_course_source']['layout_assessment']['unsupported'])
        self.assertTrue(project['external_course_source']['unresolved_route_elements'])
        self.assertTrue(real.validator(project)['invalid'])

    def test_report_and_unknown_catalog(self):
        self.assertIn('Course ID,Course Name',self.library.report())
        (self.root/'data/mapped_courses.json').unlink()
        self.assertEqual(self.library.listing()['courses'][0]['installation'],'Unknown')

    def test_timestamp_only_save_does_not_create_false_update(self):
        saved=self.library.save(self.identity,self.osm.project,0,imported=True)
        project=copy.deepcopy(saved['project']); project['updated_at']='tomorrow'
        result=self.library.save(self.identity,project,1)
        self.assertTrue(result['unchanged'])
        self.assertEqual(result['revision'],1)

    def test_explicit_existing_game_link_preserves_installed_identity(self):
        (self.root/'data/mapped_courses.json').write_text(json.dumps([{'id':'existing-course','name':'Evidence Golf Club'}]))
        self.assertEqual(self.library.listing()['courses'][0]['installation'],'Possible game match — link required')
        self.library.resolve(self.identity,installed_id='existing-course')
        saved=self.library.save(self.identity,self.osm.project,0,imported=True)
        self.assertEqual(saved['project']['course_id'],'existing-course')
        self.assertEqual(self.library.listing()['courses'][0]['installation'],'Installed — revision unverified')

    def test_revision_install_requires_actual_package_record_and_catalog(self):
        saved=self.library.save(self.identity,self.osm.project,0,imported=True)
        result={'course_id':saved['project']['course_id'],'map_updated_at':'version-one'}
        (self.root/'data/mapped_courses.json').write_text(json.dumps([{'id':result['course_id'],'dataVersion':'version-one'}]))
        with self.assertRaises(ValueError):
            self.library.record_install(self.identity,1,[result])
        self.library.installed_package(self.identity,1,result)
        self.assertTrue(self.library.record_install(self.identity,1,[result])['verified'])
        self.assertEqual(self.library.listing()['courses'][0]['installation'],'Installed / current')
        project=saved['project']; project['course_name']='Edited'
        self.library.save(self.identity,project,1)
        self.assertEqual(self.library.listing()['courses'][0]['installation'],'Update or verification needed')

    def test_provider_duplicate_no_second_project(self):
        self.library.queue([self.identity]); self.library.process_one()
        self.library.intake(HEADER+'Evidence Golf Club,NY,Elsewhere,41.0,-74.5\n')
        second=[r for r in self.library.listing()['courses'] if r['id']!=self.identity][0]
        self.library.queue([second['id']]); self.library.process_one()
        second=[r for r in self.library.listing()['courses'] if r['id']!=self.identity][0]
        self.assertEqual(second['duplicate_of'],self.identity)
        self.assertEqual(second['revision'],0)

    def test_restart_recovers_claim_without_resetting_attempts(self):
        self.library.queue([self.identity])
        with self.library.connect() as db:
            db.execute("UPDATE library_courses SET status='Importing',attempts=2 WHERE id=?",(self.identity,))
        self.library.stopping.set(); self.library.start_worker()
        self.library.thread.join(2)
        row=self.library.listing()['courses'][0]
        self.assertEqual(row['status'],'Retry pending')
        self.assertEqual(row['attempts'],2)


if __name__ == '__main__':
    unittest.main()
