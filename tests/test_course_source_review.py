import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from packages.course_import.library import CourseLibrary
from packages.course_import.review import changes,merge
from packages.course_import.golf_intelligence import CourseImportError
from tests.test_course_library import FakeOsm,CSV


class GeometryReviewTests(unittest.TestCase):
    def setUp(self):
        self.base=FakeOsm().project

    def test_source_change_and_manual_conflict_preserve_scorecard_and_identity(self):
        current=copy.deepcopy(self.base); incoming=copy.deepcopy(self.base)
        current['holes']['1']['par']=5; current['holes']['1']['yardages']['white']=412
        current['course_name']='Operator name'; current['course_id']='stable-game-id'
        current['holes']['1']['features'][0]['points'][0]['lat']+=.00001
        incoming['holes']['1']['features'][0]['points'][0]['lat']+=.00002
        incoming['holes']['1']['markers']['pin']['lat']+=.00003
        review=changes(self.base,current,incoming)
        self.assertEqual({r['kind'] for r in review['changes']},{'conflict','source change'})
        accepted=[r['id'] for r in review['changes'] if r['kind']=='source change']
        result=merge(current,review,accepted)
        self.assertEqual(result['holes']['1']['features'],current['holes']['1']['features'])
        self.assertEqual(result['holes']['1']['markers']['pin'],incoming['holes']['1']['markers']['pin'])
        self.assertEqual(result['holes']['1']['yardages']['white'],412)
        self.assertEqual(result['holes']['1']['par'],5)
        self.assertEqual(result['course_id'],'stable-game-id')
        self.assertEqual(result['course_name'],'Operator name')

    def test_source_missing_geometry_requires_explicit_removal(self):
        incoming=copy.deepcopy(self.base); incoming['holes']['1']['features'].pop(0)
        review=changes(self.base,self.base,incoming)
        self.assertEqual(review['changes'][0]['kind'],'removal')
        self.assertEqual(merge(self.base,review,[])['holes']['1']['features'],self.base['holes']['1']['features'])
        result=merge(self.base,review,[review['changes'][0]['id']])
        self.assertEqual(len(result['holes']['1']['features']),len(self.base['holes']['1']['features'])-1)

    def test_source_unchanged_ignores_import_times_and_provider_versions(self):
        incoming=copy.deepcopy(self.base); incoming['updated_at']='tomorrow'
        incoming['external_course_source']['provider_imported_at']='tomorrow'
        incoming['holes']['1']['features'][0]['provider_version']=99
        current=copy.deepcopy(self.base); current['holes']['1']['features'][0]['points'][0]['lat']+=.00001
        self.assertEqual(changes(self.base,current,incoming)['changes'],[])

    def test_reference_assigned_by_operator_updates_geometry_not_hole_or_type(self):
        current=copy.deepcopy(self.base); incoming=copy.deepcopy(self.base)
        ref=next(r for r in self.base['external_course_source']['reference_features'] if r['type']!='facility_boundary')
        assigned={**ref,'type':'tee_white'}
        current['holes']['1']['features'].append(assigned)
        updated=next(r for r in incoming['external_course_source']['reference_features'] if r['id']==ref['id'])
        updated['points'][0]['lat']+=.00002
        review=changes(self.base,current,incoming)
        mapped=next(c for c in review['changes'] if c['path']==['holes','1','features',ref['id']])
        result=merge(current,review,[mapped['id']])
        feature=next(f for f in result['holes']['1']['features'] if f['id']==ref['id'])
        self.assertEqual(feature['type'],'tee_white')
        self.assertEqual(feature['points'],updated['points'])

    def test_layout_change_blocked_and_unknown_changes_rejected(self):
        incoming=copy.deepcopy(self.base); incoming['course_structure']='three_nines'
        review=changes(self.base,self.base,incoming)
        self.assertTrue(review['blocked'])
        with self.assertRaises(ValueError): merge(self.base,review,[])
        with self.assertRaises(ValueError): merge(self.base,changes(self.base,self.base,self.base),['invented'])


class SourceUpdateServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        (self.root/'data').mkdir(); (self.root/'data/mapped_courses.json').write_text('[]')
        self.osm=FakeOsm(); self.now=1000
        self.library=CourseLibrary(self.root,self.osm,validator=lambda p:{'ready':False},clock=lambda:self.now)
        self.library.intake(CSV); self.identity=self.library.listing()['courses'][0]['id']
        self.library.queue([self.identity]); self.library.process_one(); self.library.pause()

    def tearDown(self): self.temp.cleanup()

    def changed_source(self):
        self.osm.project['holes']['1']['features'][0]['points'][0]['lat']+=.00002
        job=self.library.request_source_update(self.identity)
        self.library.process_source_update()
        return job

    def test_unchanged_source_preserves_revision_and_does_not_resume_paused_imports(self):
        job=self.library.request_source_update(self.identity)
        self.assertEqual(self.library.request_source_update(self.identity)['id'],job['id'])
        self.assertFalse(self.library.listing()['running'])
        self.assertTrue(self.library.process_source_update())
        row=self.library.listing()['courses'][0]
        self.assertEqual(row['source_update']['status'],'No changes')
        self.assertEqual(row['revision'],1)

    def test_candidate_does_not_overwrite_manual_edits_then_explicit_merge_is_idempotent(self):
        current=self.library.project(self.identity); current['holes']['1']['par']=5
        current['holes']['1']['features'][0]['points'][0]['lat']+=.00001
        self.library.save(self.identity,current,1)
        job=self.changed_source(); review=self.library.source_review(job['id'])
        self.assertEqual(self.library.project(self.identity)['holes']['1']['features'][0]['points'],current['holes']['1']['features'][0]['points'])
        self.assertEqual(review['changes'][0]['kind'],'conflict')
        result=self.library.apply_source_update(job['id'],2,[review['changes'][0]['id']])
        self.assertEqual(result['revision'],3)
        self.assertEqual(result['project']['holes']['1']['par'],5)
        self.assertEqual(self.library.apply_source_update(job['id'],2,[])['revision'],3)
        self.assertEqual(len(self.library.history(self.identity)['revisions']),3)

    def test_stale_review_rejected_and_discard_leaves_draft(self):
        job=self.changed_source(); review=self.library.source_review(job['id'])
        current=self.library.project(self.identity); current['course_name']='Manual edit'
        self.library.save(self.identity,current,1)
        with self.assertRaises(ValueError): self.library.apply_source_update(job['id'],review['revision'],[])
        self.library.discard_source_update(job['id'])
        self.assertEqual(self.library.project(self.identity)['course_name'],'Manual edit')

    def test_keep_all_retains_revision_and_new_baseline_prevents_repeated_conflicts(self):
        job=self.changed_source()
        self.library.apply_source_update(job['id'],1,[])
        self.assertEqual(self.library.project(self.identity)['library_context']['revision'],1)
        self.now+=1
        next_job=self.library.request_source_update(self.identity); self.library.process_source_update()
        self.assertEqual(self.library.source_review(next_job['id'])['changes'],[])
        self.assertEqual(self.library.listing()['courses'][0]['source_update']['id'],next_job['id'])

    def test_three_attempts_for_source_failure_do_not_mark_saved_draft_failed(self):
        job=self.library.request_source_update(self.identity)
        with patch.object(self.osm,'preview',side_effect=CourseImportError('Unavailable',status=502)):
            for _ in range(3):
                self.library.process_source_update(); self.now+=400
        row=self.library.listing()['courses'][0]
        self.assertEqual(row['source_update']['status'],'Failed')
        self.assertEqual(row['source_update']['attempts'],3)
        self.assertEqual(row['status'],'Incomplete')
        self.assertEqual(row['revision'],1)

    def test_restore_creates_new_draft_revision_not_game_rollback(self):
        current=self.library.project(self.identity); current['course_name']='Changed'
        self.library.save(self.identity,current,1)
        result=self.library.restore_revision(self.identity,1,2)
        self.assertEqual(result['revision'],3)
        self.assertEqual(result['project']['course_name'],'Evidence Golf Club')
        self.assertEqual(self.library.project(self.identity,2)['course_name'],'Changed')
        self.assertEqual(json.loads((self.root/'data/mapped_courses.json').read_text()),[])

    def test_pause_resume_and_restart_claim_recovery(self):
        job=self.library.request_source_update(self.identity)
        self.library.pause(); self.assertFalse(self.library.process_source_update())
        self.library.resume()
        with self.library.connect() as db:
            db.execute("UPDATE library_source_updates SET status='Importing',attempts=2 WHERE id=?",(job['id'],))
        self.library.stopping.set(); self.library.start_worker(); self.library.thread.join(2)
        row=self.library.listing()['courses'][0]['source_update']
        self.assertEqual(row['status'],'Retry pending')
        self.assertEqual(row['attempts'],2)

    def test_changed_input_blocks_pending_source_review(self):
        job=self.changed_source()
        self.library.intake(CSV.replace('40.6','40.7'))
        with self.assertRaises(ValueError): self.library.apply_source_update(job['id'],1,[])
        self.library.discard_source_update(job['id'])
        self.assertEqual(self.library.project(self.identity)['library_context']['revision'],1)

    def test_applied_revision_recovery_finalizes_without_duplicate_save(self):
        job=self.changed_source(); review=self.library.source_review(job['id'])
        self.library.apply_source_update(job['id'],1,[review['changes'][0]['id']])
        with self.library.connect() as db:
            db.execute("UPDATE library_source_updates SET status='Review ready',applied_revision=NULL WHERE id=?",(job['id'],))
        result=self.library.apply_source_update(job['id'],1,[])
        self.assertEqual(result['revision'],2)
        self.assertEqual(len(self.library.history(self.identity)['revisions']),2)


if __name__=='__main__': unittest.main()
