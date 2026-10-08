"""Private CSV intake, durable bounded OSM work, and canonical project revisions."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import secrets
import sqlite3
import subprocess
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from packages.accounts.course_preferences import _directory_id, _normalize
from .golf_intelligence import CourseImportError
from .opengolfapi import enrich_project_scorecard
from .openstreetmap import OSM_PROVIDER, osm_game_course_id
from .review import changes as source_changes, merge as merge_source_changes


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def course_name_key(name):
    # Remove generic facility words, never directional/layout identifiers.
    generic = {'the','golf','course','club','country'}
    return ' '.join(word for word in _normalize(name).split() if word not in generic)


class CourseLibrary:
    def __init__(self, root, osm, *, scorecards=None, database=None, validator=None, clock=time.time):
        self.root = Path(root)
        self.base = self.root / "Courses"
        self.osm = osm
        self.scorecards = scorecards
        self.clock = clock
        self.validator = validator or self._validate
        self.database = Path(database or self.root / "data" / "course_library.sqlite3")
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.stopping = threading.Event()
        self.thread = None
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS library_courses (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL,
                    state TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
                    fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'New',
                    provider_id TEXT, revision INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0, next_retry REAL NOT NULL DEFAULT 0,
                    notes TEXT NOT NULL DEFAULT '', updated REAL NOT NULL,
                    proposed TEXT, duplicate_of TEXT, original_course_id TEXT
                );
                CREATE INDEX IF NOT EXISTS library_status ON library_courses(status,next_retry);
                CREATE INDEX IF NOT EXISTS library_name ON library_courses(name COLLATE NOCASE,state);
                CREATE UNIQUE INDEX IF NOT EXISTS library_provider
                    ON library_courses(provider_id) WHERE provider_id IS NOT NULL;
                CREATE TABLE IF NOT EXISTS library_revisions (
                    course_id TEXT NOT NULL, revision INTEGER NOT NULL, project TEXT NOT NULL,
                    path TEXT NOT NULL, assessment TEXT NOT NULL, created REAL NOT NULL,
                    PRIMARY KEY(course_id,revision)
                );
                CREATE TABLE IF NOT EXISTS library_events (
                    id INTEGER PRIMARY KEY, course_id TEXT, action TEXT NOT NULL,
                    details TEXT NOT NULL, created REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS library_course_flags (
                    identity TEXT PRIMARY KEY, updated REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS library_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
                INSERT OR IGNORE INTO library_settings VALUES ('running','0');
                INSERT OR IGNORE INTO library_settings VALUES ('source_running','0');
                CREATE TABLE IF NOT EXISTS library_installs (
                    course_id TEXT NOT NULL, game_id TEXT NOT NULL,
                    revision INTEGER NOT NULL, version TEXT NOT NULL,
                    PRIMARY KEY(course_id,game_id)
                );
                CREATE TABLE IF NOT EXISTS library_source_baselines (
                    course_id TEXT PRIMARY KEY, project TEXT NOT NULL, updated REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS library_source_updates (
                    id TEXT PRIMARY KEY, course_id TEXT NOT NULL, status TEXT NOT NULL,
                    baseline TEXT NOT NULL, incoming TEXT, base_revision INTEGER NOT NULL,
                    applied_revision INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
                    next_retry REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
                    created REAL NOT NULL, updated REAL NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS library_one_source_review
                    ON library_source_updates(course_id)
                    WHERE status IN ('Queued','Importing','Retry pending','Review ready');
            """)
        os.chmod(self.database, 0o600)

    def connect(self):
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def event(self, db, identity, action, details):
        db.execute("INSERT INTO library_events(course_id,action,details,created) VALUES (?,?,?,?)",
                   (identity, action, encoded(details), self.clock()))

    def _validate(self, project):
        result = subprocess.run(["node", str(self.root / "scripts/check_mapper_project.mjs")],
                                input=encoded(project), text=True, capture_output=True, timeout=30)
        try:
            return json.loads(result.stdout)
        except ValueError as error:
            raise ValueError("Mapper validation unavailable; check Node installation") from error

    def course_flags(self):
        with self.connect() as db:
            return {'flags': [row['identity'] for row in db.execute('SELECT identity FROM library_course_flags ORDER BY identity')]}

    def flag_course(self, identity, flagged):
        if not isinstance(identity, str) or not identity.strip() or len(identity) > 500:
            raise ValueError('A valid course identity is required')
        if not isinstance(flagged, bool):
            raise ValueError('Flagged must be true or false')
        with self.lock, self.connect() as db:
            if flagged:
                db.execute('INSERT OR REPLACE INTO library_course_flags VALUES (?,?)', (identity, self.clock()))
            else:
                db.execute('DELETE FROM library_course_flags WHERE identity=?', (identity,))
        return self.course_flags()

    def intake(self, text):
        if not isinstance(text, str) or len(text.encode()) > 10 * 1024 * 1024:
            raise ValueError("CSV must be no larger than 10 MB")
        reader = csv.DictReader(io.StringIO(text.lstrip('\ufeff')),strict=True)
        required = {"Course Name", "State", "City", "Latitude", "Longitude"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("CSV requires Course Name, State, City, Latitude, Longitude")
        result = {"new": 0, "unchanged": 0, "review": 0, "errors": [], "rows": 0}
        rows, seen = [], set()
        def checked_rows():
            try:
                yield from reader
            except csv.Error as error:
                raise ValueError('Malformed CSV or oversized field') from error

        for line, row in enumerate(checked_rows(), 2):
            result["rows"] += 1
            if result["rows"] > 20000:
                raise ValueError("CSV exceeds 20,000 rows")
            try:
                name, state, city = (str(row.get(key) or '').strip() for key in ("Course Name", "State", "City"))
                if not name or not state or not city or any(len(v) > 200 for v in (name, state, city)):
                    raise ValueError("Course Name, State and City are required (maximum 200 characters)")
                lat, lon = float(row["Latitude"]), float(row["Longitude"])
                if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    raise ValueError("Invalid coordinates")
                identity = str(row.get("Course ID") or '').strip() or _directory_id(name, state, city)
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identity):
                    raise ValueError("Course ID must use letters, digits, underscores or hyphens")
                values = {"name": name, "state": state, "city": city, "latitude": lat, "longitude": lon}
                fingerprint = hashlib.sha256(encoded(values).encode()).hexdigest()
                if identity in seen:
                    raise ValueError("Duplicate Course ID in upload")
                seen.add(identity)
                rows.append((identity, values, fingerprint))
            except (ValueError, TypeError, KeyError) as error:
                result["errors"].append({"row": line, "error": str(error)})
        with self.lock, self.connect() as db:
            for identity, values, fingerprint in rows:
                old = db.execute("SELECT * FROM library_courses WHERE id=?", (identity,)).fetchone()
                if not old:
                    # A rename without a permanent CSV ID must not silently create another build.
                    nearby = db.execute("SELECT id FROM library_courses WHERE latitude=? AND longitude=? AND state=?",
                                        (values['latitude'], values['longitude'], values['state'])).fetchall()
                    if len(nearby) == 1:
                        # Co-located nines/courses can legitimately share coordinates. Retain
                        # each input identity but require review before duplicate work.
                        values['possible_duplicate'] = nearby[0]['id']
                if old and old['fingerprint'] == fingerprint:
                    if old['proposed']:
                        # The latest sheet explicitly retains the original identity/location.
                        db.execute("UPDATE library_courses SET proposed=NULL,notes='',status=CASE WHEN revision=0 AND duplicate_of IS NULL AND provider_id IS NULL THEN 'New' ELSE status END WHERE id=?", (identity,))
                        self.event(db, identity, 'INPUT_RECONFIRMED', {})
                    result['unchanged'] += 1
                    continue
                if old:
                    db.execute("UPDATE library_courses SET proposed=?, notes=?, updated=? WHERE id=?",
                               (encoded(values), 'Spreadsheet change needs review; existing project retained', self.clock(), identity))
                    if old['status'] not in {'Importing', 'Queued', 'Retry pending'}:
                        db.execute("UPDATE library_courses SET status='Needs review' WHERE id=?", (identity,))
                    self.event(db, identity, 'INPUT_CHANGE', values)
                    result['review'] += 1
                    continue
                db.execute("""INSERT INTO library_courses
                    (id,name,state,city,latitude,longitude,fingerprint,updated)
                    VALUES (?,?,?,?,?,?,?,?)""", (identity, values['name'], values['state'], values['city'],
                         values['latitude'], values['longitude'], fingerprint, self.clock()))
                if values.get('possible_duplicate'):
                    db.execute("UPDATE library_courses SET status='Needs review',duplicate_of=?,notes='Shared coordinates: review whether separate course/layout or renamed row' WHERE id=?",
                               (values['possible_duplicate'],identity))
                    result['review'] += 1
                result['new'] += 1
            summary={key:value for key,value in result.items() if key != 'errors'}
            summary['invalid_rows']=len(result['errors'])
            summary['input_sha256']=hashlib.sha256(text.encode()).hexdigest()
            self.event(db, None, 'INTAKE', summary)
        report_path = self.base / 'reports/intake-validation.json'
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(encoded(result) + '\n')
        os.chmod(report_path,0o600)
        return result

    def listing(self, query='', state='', status='', offset=0, limit=50):
        limit, offset = max(1, min(int(limit), 100)), max(0, int(offset))
        # Treat wildcard characters literally in search.
        query = str(query)[:200].replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        filters, args = [], []
        if query:
            filters.append("(name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')")
            args.extend([f'%{query}%'] * 2)
        for key, value in [('state', state), ('status', status)]:
            if value:
                filters.append(f'{key}=?')
                args.append(value)
        where = ' WHERE ' + ' AND '.join(filters) if filters else ''
        with self.connect() as db:
            total = db.execute('SELECT count(*) FROM library_courses' + where, args).fetchone()[0]
            items = [dict(r) for r in db.execute('SELECT * FROM library_courses' + where +
                     ' ORDER BY name COLLATE NOCASE,id LIMIT ? OFFSET ?', (*args, limit, offset))]
            counts = dict(db.execute('SELECT status,count(*) FROM library_courses GROUP BY status').fetchall())
            running = db.execute("SELECT value FROM library_settings WHERE key='running'").fetchone()[0] == '1'
            source_running=db.execute("SELECT value FROM library_settings WHERE key='source_running'").fetchone()[0]=='1'
            installed = [dict(r) for r in db.execute('SELECT * FROM library_installs')]
            updates=[dict(r) for r in db.execute('''SELECT id,course_id,status,attempts,next_retry,notes,updated
                FROM library_source_updates WHERE rowid IN
                    (SELECT max(rowid) FROM library_source_updates GROUP BY course_id)''')]
        try:
            catalog = json.loads((self.root / 'data/mapped_courses.json').read_text())
            catalog = {r['id']: r for r in catalog}
        except (OSError, ValueError, KeyError, TypeError):
            catalog = None
        flags = set(self.course_flags()['flags'])
        for item in items:
            item['flag_identity'] = 'openstreetmap:' + item['provider_id'] if item['provider_id'] else 'library:' + item['id']
            item['no_good'] = item['flag_identity'] in flags
            item['source_update']=next((r for r in reversed(updates) if r['course_id']==item['id']),None)
            records = [r for r in installed if r['course_id'] == item['id']]
            # Match existing installs by directory or original project ID even before revision tracking.
            existing = [r for r in (catalog or {}).values() if
                        r.get('directoryCourseId') == item['id'] or
                        (item['original_course_id'] and r.get('id') == item['original_course_id'])]
            item['installation'] = 'Unknown' if catalog is None else 'Not installed'
            if not existing and catalog and any(course_name_key(r.get('name','')) == course_name_key(item['name'])
                                                 for r in catalog.values()):
                item['installation'] = 'Possible game match — link required'
            if existing:
                item['installation'] = 'Installed — revision unverified'
            if records and catalog is not None:
                expected = 6 if self.project(item['id'])['course_structure'] == 'three_nines' else 1
                current = len(records) == expected and all(
                    r['revision'] == item['revision'] and
                    catalog.get(r['game_id'], {}).get('dataVersion') == r['version'] for r in records)
                item['installation'] = 'Installed / current' if current else 'Update or verification needed'
            item['mapping'] = 'Ready to install' if item['status'] == 'Done' and not item['proposed'] else (
                'Needs review' if item['status'] == 'Needs review' or item['proposed'] else 'Incomplete draft' if item['revision'] else 'Not mapped')
            item.pop('fingerprint', None)
        return {'courses': items, 'total': total, 'offset': offset, 'counts': counts, 'running': running,
                'source_running':source_running,
                'game_courses': [{'id':r['id'],'name':r.get('name',r['id'])} for r in (catalog or {}).values()]}

    def project(self, identity, revision=None):
        with self.connect() as db:
            row = db.execute('SELECT project FROM library_revisions WHERE course_id=? ' +
                             ('AND revision=?' if revision else 'ORDER BY revision DESC LIMIT 1'),
                             (identity, revision) if revision else (identity,)).fetchone()
        if not row:
            raise ValueError('No saved project for this course')
        return json.loads(row['project'])

    def save(self, identity, project, expected_revision, *, imported=False):
        assessment = self.validator(project)
        if assessment.get('invalid') and not imported:
            raise ValueError(assessment.get('error', 'Invalid project'))
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM library_courses WHERE id=?', (identity,)).fetchone()
            if not row or row['revision'] != int(expected_revision):
                raise ValueError('Project revision changed; reopen before saving')
            project = json.loads(encoded(project))
            if row['revision']:
                previous = self.project(identity)
                project['course_id'] = previous['course_id']
                def content(value):
                    return {key:item for key,item in value.items() if key not in {'updated_at','library_context'}}
                if encoded(content(project)) == encoded(content(previous)):
                    return {'project':previous,'status':row['status'],'revision':row['revision'],
                            'assessment':assessment,'unchanged':True}
            original_id = project['course_id']
            source = project.get('external_course_source', {})
            if not row['original_course_id'] and source.get('provider_name') == OSM_PROVIDER:
                # The verified OSM element is globally unique. Preserve it as
                # the game identity instead of appending a private directory
                # hash, while keeping the human-facing course name separate.
                original_id = osm_game_course_id(source.get('provider_public_id'))
            elif not row['original_course_id']:
                # Name-only slugs collide across cities/states. Stable intake suffix avoids that.
                original_id = original_id[:48].rstrip('-') + '-' + hashlib.sha256(identity.encode()).hexdigest()[:10]
            project['course_id'] = row['original_course_id'] or original_id
            revision = row['revision'] + 1
            project['library_context'] = {'id': identity, 'revision': revision}
            layout = project.get('external_course_source', {}).get('layout_assessment', {})
            blocked = layout.get('unsupported') or layout.get('ambiguous')
            status = 'Needs review' if blocked else 'Done' if assessment.get('ready') else 'Incomplete'
            relative = Path('projects' if status == 'Done' else 'drafts') / identity / f'revision-{revision}.golfmap'
            path = self.base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            # The ledger also stores the immutable payload; interrupted file writes are recoverable.
            temp = path.with_suffix('.tmp')
            temp.write_text(encoded(project) + '\n')
            os.chmod(temp, 0o600)
            os.replace(temp, path)
            db.execute('INSERT INTO library_revisions VALUES (?,?,?,?,?,?)',
                       (identity, revision, encoded(project), str(relative), encoded(assessment), self.clock()))
            osm_name = project.get('course_name', '').strip() if source.get('provider_name') == OSM_PROVIDER else None
            db.execute('UPDATE library_courses SET name=COALESCE(?,name),revision=?,status=?,updated=?,notes=?,original_course_id=? WHERE id=?',
                       (osm_name, revision, status, self.clock(), assessment.get('error') or
                        ('Review missing hole geometry and trusted scorecard values' if status != 'Done' else ''),
                        project['course_id'], identity))
            self.event(db, identity, 'IMPORT_SAVED' if imported else 'EDIT_SAVED', {'revision': revision, 'status': status})
            if imported and row['revision']==0:
                db.execute('INSERT OR IGNORE INTO library_source_baselines VALUES (?,?,?)',
                           (identity,encoded(project),self.clock()))
        return {'project': project, 'status': status, 'revision': revision, 'assessment': assessment}

    def queue(self, identities, *, retry=False):
        if not isinstance(identities, list) or not 1 <= len(identities) <= 25:
            raise ValueError('Choose between 1 and 25 courses per batch')
        queued = 0
        with self.lock, self.connect() as db:
            for identity in set(identities):
                row = db.execute('SELECT * FROM library_courses WHERE id=?', (identity,)).fetchone()
                flag_identity = ('openstreetmap:' + row['provider_id'] if row and row['provider_id'] else 'library:' + identity)
                if db.execute('SELECT 1 FROM library_course_flags WHERE identity=?', (flag_identity,)).fetchone():
                    continue
                if not row or row['proposed'] or row['status'] in {'Importing','Queued','Retry pending'}:
                    continue
                if row['status'] != 'New' and not retry:
                    continue
                # Existing projects are not replaced by an unattended reimport.
                if row['revision'] or row['duplicate_of']:
                    raise ValueError('Reimporting an edited/saved project requires reviewed merge; existing revisions are protected')
                db.execute("UPDATE library_courses SET status='Queued',attempts=0,next_retry=0,notes='',updated=? WHERE id=?",
                           (self.clock(), identity))
                self.event(db, identity, 'QUEUED', {})
                queued += 1
            db.execute("UPDATE library_settings SET value='1' WHERE key='running'")
        self.wake.set()
        return {'queued': queued}

    def pause(self):
        with self.connect() as db:
            db.execute("UPDATE library_settings SET value='0' WHERE key='running'")
            db.execute("UPDATE library_settings SET value='0' WHERE key='source_running'")
            self.event(db, None, 'PAUSED', {})
        return {'paused': True, 'note': 'Current request finishes; remaining queue is retained'}

    def resume(self):
        with self.connect() as db:
            db.execute("UPDATE library_settings SET value='1' WHERE key IN ('running','source_running')")
            self.event(db,None,'QUEUES_RESUMED',{})
        self.wake.set()
        return {'resumed':True}

    def history(self, identity):
        with self.connect() as db:
            rows=db.execute('SELECT revision,path,assessment,created FROM library_revisions WHERE course_id=? ORDER BY revision DESC LIMIT 100',
                            (identity,)).fetchall()
        return {'revisions':[{'revision':row['revision'],'path':row['path'],'created':row['created'],
                              'ready':json.loads(row['assessment']).get('ready',False)} for row in rows]}

    def request_source_update(self, identity):
        with self.lock,self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM library_courses WHERE id=?',(identity,)).fetchone()
            if not row or not row['revision'] or not row['provider_id'] or row['proposed']:
                raise ValueError('Open and verify a saved OSM course before checking source updates')
            existing=db.execute("SELECT id,status FROM library_source_updates WHERE course_id=? AND status IN ('Queued','Importing','Retry pending','Review ready')",(identity,)).fetchone()
            if existing:
                return dict(existing)
            if db.execute("SELECT count(*) FROM library_source_updates WHERE status IN ('Queued','Importing','Retry pending')").fetchone()[0]>=25:
                raise ValueError('At most 25 source checks may be queued at once')
            baseline=db.execute('SELECT project FROM library_source_baselines WHERE course_id=?',(identity,)).fetchone()
            baseline=json.loads(baseline['project']) if baseline else self.project(identity,1)
            if baseline.get('external_course_source',{}).get('provider_public_id') != row['provider_id']:
                raise ValueError('OSM facility identity changed; source reconciliation requires manual review')
            job_id='source-'+secrets.token_hex(12)
            db.execute('INSERT INTO library_source_updates(id,course_id,status,baseline,base_revision,created,updated) VALUES (?,?,?,?,?,?,?)',
                       (job_id,identity,'Queued',encoded(baseline),row['revision'],self.clock(),self.clock()))
            db.execute("UPDATE library_settings SET value='1' WHERE key='source_running'")
            self.event(db,identity,'SOURCE_CHECK_QUEUED',{'id':job_id,'revision':row['revision']})
        self.wake.set()
        return {'id':job_id,'status':'Queued'}

    def _source_review_data(self, job_id):
        with self.connect() as db:
            row=db.execute('SELECT * FROM library_source_updates WHERE id=?',(job_id,)).fetchone()
            course=db.execute('SELECT provider_id,proposed FROM library_courses WHERE id=?',(row['course_id'],)).fetchone() if row else None
        if not row or not row['incoming']:
            raise ValueError('Source update draft is not available yet')
        if course['proposed']:
            raise ValueError('Review changed spreadsheet input before applying source updates')
        current=self.project(row['course_id'])
        incoming=json.loads(row['incoming'])
        if incoming.get('external_course_source',{}).get('provider_public_id')!=course['provider_id']:
            raise ValueError('OSM identity changed; discard this proposal and check the verified facility again')
        review=source_changes(json.loads(row['baseline']),current,incoming)
        return dict(row),current,incoming,review

    def source_review(self, job_id):
        row,current,_,review=self._source_review_data(job_id)
        def summary(value):
            if isinstance(value,dict) and isinstance(value.get('points'),list):
                return {'type':value.get('type'),'label':value.get('label'),
                        'points':len(value['points']),'first_point':value['points'][0] if value['points'] else None,
                        'geometry_hash':hashlib.sha256(encoded(value['points']).encode()).hexdigest()[:16]}
            if isinstance(value,list):
                return {'points':len(value),'first_point':value[0] if value else None,
                        'geometry_hash':hashlib.sha256(encoded(value).encode()).hexdigest()[:16]}
            return value
        return {'id':job_id,'course_id':row['course_id'],'status':row['status'],
                'revision':current['library_context']['revision'],'blocked':review['blocked'],
                'changes':[{**change,**{key:summary(change[key]) for key in ('baseline','current','incoming')}}
                           for change in review['changes']]}

    def source_project(self, job_id):
        row,_,incoming,_=self._source_review_data(job_id)
        incoming.pop('library_context',None)
        return {'project':incoming,'status':row['status']}

    def restore_revision(self, identity, source_revision, expected_revision):
        with self.lock:
            historical=self.project(identity,int(source_revision))
            historical.pop('source_update_review',None)
            historical['restored_from_revision']=int(source_revision)
            result=self.save(identity,historical,expected_revision,imported=True)
            with self.connect() as db:
                self.event(db,identity,'REVISION_RESTORED',{'from':int(source_revision),'revision':result['revision']})
        return result

    def apply_source_update(self, job_id, expected_revision, accepted):
        with self.lock:
            row,current,incoming,review=self._source_review_data(job_id)
            # Recover the narrow crash gap between immutable revision save and job completion.
            recovered=current.get('source_update_review',{}).get('id')==job_id
            if row['status']=='Applied':
                return {'applied':True,'revision':row['applied_revision'],'already_applied':True}
            if row['status']!='Review ready':
                raise ValueError('This source review is no longer pending')
            if not recovered and current['library_context']['revision']!=int(expected_revision):
                raise ValueError('Draft changed since review; reload before applying source changes')
            if not recovered:
                merged=merge_source_changes(current,review,accepted)
                if accepted:
                    merged['source_update_review']={'id':job_id,'accepted':sorted(set(accepted))}
                    result=self.save(row['course_id'],merged,expected_revision,imported=True)
                    current=result['project']
            with self.connect() as db:
                db.execute('INSERT OR REPLACE INTO library_source_baselines VALUES (?,?,?)',
                           (row['course_id'],encoded(incoming),self.clock()))
                db.execute("UPDATE library_source_updates SET status='Applied',applied_revision=?,updated=? WHERE id=?",
                           (current['library_context']['revision'],self.clock(),job_id))
                self.event(db,row['course_id'],'SOURCE_REVIEW_APPLIED',{'id':job_id,'revision':current['library_context']['revision']})
            return {'applied':True,'revision':current['library_context']['revision'],'project':current}

    def discard_source_update(self, job_id):
        with self.lock,self.connect() as db:
            row=db.execute('SELECT course_id,status FROM library_source_updates WHERE id=?',(job_id,)).fetchone()
            if not row or row['status']=='Importing':
                raise ValueError('Source update missing or still importing')
            if self.project(row['course_id']).get('source_update_review',{}).get('id')==job_id:
                raise ValueError('Changes were already saved; reload and finalize the review')
            if row['status'] not in {'Queued','Retry pending','Review ready','Failed'}:
                raise ValueError('This source update is already finished')
            db.execute("UPDATE library_source_updates SET status='Discarded',updated=? WHERE id=?",(self.clock(),job_id))
            self.event(db,row['course_id'],'SOURCE_REVIEW_DISCARDED',{'id':job_id})
        return {'discarded':True}

    def process_source_update(self):
        with self.lock,self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT value FROM library_settings WHERE key='source_running'").fetchone()[0]!='1':
                return False
            row=db.execute("SELECT * FROM library_source_updates WHERE status IN ('Queued','Retry pending') AND next_retry<=? ORDER BY created,id LIMIT 1",(self.clock(),)).fetchone()
            if not row: return False
            row=dict(row)
            if row['attempts']>=3:
                db.execute("UPDATE library_source_updates SET status='Failed',notes='Maximum three total attempts reached' WHERE id=?",(row['id'],))
                return True
            course=db.execute('SELECT * FROM library_courses WHERE id=?',(row['course_id'],)).fetchone()
            if course['proposed']:
                db.execute("UPDATE library_source_updates SET status='Failed',notes='Review changed spreadsheet input first' WHERE id=?",(row['id'],))
                return True
            db.execute("UPDATE library_source_updates SET status='Importing',attempts=attempts+1,updated=? WHERE id=?",(self.clock(),row['id']))
        try:
            if course['provider_id']!=json.loads(row['baseline']).get('external_course_source',{}).get('provider_public_id'):
                raise ValueError('OSM facility identity changed during this source check; review the match first')
            preview=self.osm.preview({'external_id':course['provider_id'],'course_name':course['name'],
                                     'city':course['city'],'state_code':course['state'],'refresh':True},None)
            incoming=self.osm.commit({'job_id':preview['job_id']},None)['project']
            incoming['course_id']=course['original_course_id']
            current=self.project(row['course_id'])
            review=source_changes(json.loads(row['baseline']),current,incoming)
            status='Review ready' if review['blocked'] or review['changes'] else 'No changes'
            path=self.base/'drafts'/row['course_id']/(row['id']+'.golfmap')
            path.parent.mkdir(parents=True,exist_ok=True)
            temp=path.with_suffix('.tmp'); temp.write_text(encoded(incoming)+'\n'); os.chmod(temp,0o600); os.replace(temp,path)
            with self.connect() as db:
                db.execute('UPDATE library_source_updates SET status=?,incoming=?,notes=?,updated=? WHERE id=?',
                           (status,encoded(incoming),review['blocked'] or f"{len(review['changes'])} source changes; saved draft untouched",self.clock(),row['id']))
                if status=='No changes':
                    db.execute('INSERT OR REPLACE INTO library_source_baselines VALUES (?,?,?)',(row['course_id'],encoded(incoming),self.clock()))
                self.event(db,row['course_id'],'SOURCE_CHECK_FINISHED',{'id':row['id'],'status':status})
        except Exception as error:
            status_code=getattr(error,'status',None); attempt=row['attempts']+1
            local=status_code==409
            retry=(status_code in {429,500,502,503,504} and attempt<3) or local
            with self.connect() as db:
                db.execute('UPDATE library_source_updates SET status=?,notes=?,next_retry=?,attempts=attempts-?,updated=? WHERE id=?',
                           ('Retry pending' if retry else 'Failed',str(error)[:1000],self.clock()+(10 if local else 60 if attempt==1 else 300),
                            int(local),self.clock(),row['id']))
                self.event(db,row['course_id'],'SOURCE_CHECK_ERROR',{'id':row['id'],'error':str(error)[:1000]})
        return True

    def resolve(self, identity, *, accept_input=False, external_id=None, separate=False, installed_id=None):
        """Explicit operator resolution only; preserves all project revisions."""
        with self.lock, self.connect() as db:
            row = db.execute('SELECT * FROM library_courses WHERE id=?',(identity,)).fetchone()
            if not row or row['status'] in {'Importing','Queued','Retry pending'}:
                raise ValueError('Course missing or currently importing')
            if installed_id:
                if row['revision']:
                    raise ValueError('Link the existing game identity before the first draft import; saved project IDs are immutable')
                catalog = json.loads((self.root/'data/mapped_courses.json').read_text())
                if not any(r.get('id') == installed_id for r in catalog):
                    raise ValueError('Installed course ID was not found in the game catalog')
                if db.execute('SELECT id FROM library_courses WHERE original_course_id=? AND id<>?',(installed_id,identity)).fetchone():
                    raise ValueError('Another library course already links this game identity')
                db.execute('UPDATE library_courses SET original_course_id=? WHERE id=?',(installed_id,identity))
            if accept_input and row['proposed']:
                values = json.loads(row['proposed'])
                db.execute('UPDATE library_courses SET name=?,city=?,state=?,latitude=?,longitude=?,fingerprint=?,proposed=NULL WHERE id=?',
                           (values['name'],values['city'],values['state'],values['latitude'],values['longitude'],
                            hashlib.sha256(encoded(values).encode()).hexdigest(),identity))
            if external_id:
                if not re.fullmatch(r'(node|way|relation)/[1-9][0-9]{0,18}',external_id):
                    raise ValueError('Use a valid OSM facility ID (way/123, node/123 or relation/123)')
                duplicate = db.execute('SELECT id FROM library_courses WHERE provider_id=? AND id<>?',(external_id,identity)).fetchone()
                if duplicate:
                    raise ValueError('This OSM facility is already tracked; review that project instead')
                db.execute('UPDATE library_courses SET provider_id=?,duplicate_of=NULL WHERE id=?',(external_id,identity))
            elif separate:
                db.execute('UPDATE library_courses SET duplicate_of=NULL WHERE id=?',(identity,))
            db.execute("UPDATE library_courses SET status=CASE WHEN revision=0 THEN 'New' ELSE 'Needs review' END,updated=?,notes='Operator reviewed input/match' WHERE id=?",(self.clock(),identity))
            self.event(db,identity,'MATCH_REVIEWED',{'external_id':external_id,'accept_input':accept_input,'separate':separate,'installed_id':installed_id})
        return {'reviewed':True}

    def start_worker(self):
        if self.thread and self.thread.is_alive():
            return
        with self.connect() as db:
            db.execute("UPDATE library_courses SET status='Retry pending',next_retry=?,notes='Recovering interrupted import' WHERE status='Importing'",
                       (self.clock() + 60,))
            db.execute("UPDATE library_source_updates SET status='Retry pending',next_retry=?,notes='Recovering interrupted source check' WHERE status='Importing'",(self.clock()+60,))
        self.thread = threading.Thread(target=self._loop, name='course-library-worker', daemon=True)
        self.thread.start()

    def _loop(self):
        while not self.stopping.is_set():
            self.wake.clear()
            try:
                worked = self.process_one() or self.process_source_update()
            except Exception as error:
                # Keep the worker alive, while surfacing unexpected infrastructure failure.
                with self.connect() as db:
                    self.event(db, None, 'WORKER_ERROR', {'error': str(error)[:500]})
                worked = False
            if worked:
                self.stopping.wait(30)
            else:
                self.wake.wait(5)

    def process_one(self):
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT value FROM library_settings WHERE key='running'").fetchone()[0] != '1':
                return False
            row = db.execute("SELECT * FROM library_courses WHERE status IN ('Queued','Retry pending') AND next_retry<=? AND proposed IS NULL ORDER BY updated,id LIMIT 1",
                             (self.clock(),)).fetchone()
            if not row:
                return False
            row = dict(row)
            if row['attempts'] >= 3:
                db.execute("UPDATE library_courses SET status='Failed',notes='Maximum three total import attempts reached',updated=? WHERE id=?", (self.clock(),row['id']))
                return True
            db.execute("UPDATE library_courses SET status='Importing',attempts=attempts+1,updated=? WHERE id=?", (self.clock(), row['id']))
        try:
            provider_id = row['provider_id']
            if not provider_id:
                result = self.osm.search({'latitude': row['latitude'], 'longitude': row['longitude'], 'radius_meters': 3000})
                # Exact normalized identity only. Do not guess a vaguely similar facility.
                matches = [r for r in result['results'] if _normalize(r['name']) == _normalize(row['name'])]
                if not matches and course_name_key(row['name']):
                    matches = [r for r in result['results'] if course_name_key(r['name']) == course_name_key(row['name'])]
                if len(matches) != 1:
                    self._outcome(row['id'], 'Needs review', f'{len(matches)} exact facility matches; select a facility manually')
                    return True
                provider_id = matches[0]['external_id']
            with self.lock, self.connect() as db:
                duplicate = db.execute('SELECT id FROM library_courses WHERE provider_id=? AND id<>?', (provider_id,row['id'])).fetchone()
                if duplicate:
                    db.execute("UPDATE library_courses SET status='Needs review',duplicate_of=?,notes='Provider facility already tracked; review layouts' WHERE id=?", (duplicate['id'],row['id']))
                    return True
                db.execute('UPDATE library_courses SET provider_id=? WHERE id=?', (provider_id,row['id']))
            preview = self.osm.preview({'external_id': provider_id, 'course_name': row['name'],
                                        'city': row['city'], 'state_code': row['state']}, None)
            project = self.osm.commit({'job_id': preview['job_id']}, None)['project']
            project = self._enrich_scorecard(project, row, strict=False)
            self.save(row['id'], project, row['revision'], imported=True)
        except CourseImportError as error:
            if error.status == 409:
                # Local contention is queue waiting, not a failed upstream attempt.
                with self.connect() as db:
                    db.execute("UPDATE library_courses SET attempts=max(0,attempts-1) WHERE id=?",(row['id'],))
                self._outcome(row['id'], 'Retry pending', str(error), self.clock()+10)
                return True
            attempt = row['attempts'] + 1
            transient = error.status in {429,500,502,503,504}
            status = 'Retry pending' if transient and attempt < 3 else 'Failed'
            self._outcome(row['id'], status, str(error), self.clock() + (60 if attempt == 1 else 300))
        except Exception as error:
            self._outcome(row['id'], 'Failed', str(error))
        return True

    def _enrich_scorecard(self, project, row, *, strict):
        if not self.scorecards or not self.scorecards.config.ready:
            if strict:
                raise ValueError('OpenGolfAPI is not configured; save OPENGOLFAPI_* settings and restart the server')
            project.setdefault('import_preview',{})['scorecard']={'provider':'OpenGolfAPI','status':'not configured'}
            return project
        try:
            match = self.scorecards.match(name=row['name'],city=row['city'],state=row['state'],
                                          latitude=float(row['latitude']),longitude=float(row['longitude']))
            detail = self.scorecards.detail(match['id'])
            return enrich_project_scorecard(project,detail)
        except Exception as error:
            if strict:
                raise ValueError(str(error)) from error
            project.setdefault('import_preview',{})['scorecard']={
                'provider':'OpenGolfAPI','status':'needs review','reason':str(error)[:300]}
            return project

    def enrich_scorecard(self, identity):
        with self.connect() as db:
            row=db.execute('SELECT * FROM library_courses WHERE id=?',(identity,)).fetchone()
        if not row or not row['revision']:
            raise ValueError('Import and save an OSM draft before adding its scorecard')
        project=self.project(identity)
        result=self._enrich_scorecard(project,dict(row),strict=True)
        saved=self.save(identity,result,row['revision'])
        with self.connect() as db:
            self.event(db,identity,'OPENGOLFAPI_SCORECARD',{
                'revision':saved['revision'],
                'course_id':result.get('external_course_source',{}).get('opengolfapi',{}).get('course_id')})
        return saved

    def _outcome(self, identity, status, notes, retry_at=0):
        with self.connect() as db:
            db.execute('UPDATE library_courses SET status=?,notes=?,next_retry=?,updated=? WHERE id=?',
                       (status, str(notes)[:1000], retry_at, self.clock(), identity))
            self.event(db, identity, status, {'reason': str(notes)[:1000]})

    def expected_game_ids(self, project):
        if project['course_structure'] != 'three_nines':
            return [project['course_id']]
        return [f"{project['course_id'][:63-len('-'+first+'-'+second)].rstrip('-')}-{first}-{second}"
                for first in ('central','north','south') for second in ('central','north','south') if first != second]

    def installed_package(self, identity, revision, result):
        project = self.project(identity, int(revision))
        if result['course_id'] not in self.expected_game_ids(project):
            raise ValueError('Package does not belong to this library project')
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO library_installs VALUES (?,?,?,?)',
                       (identity,result['course_id'],int(revision),result['map_updated_at']))
            self.event(db, identity, 'PACKAGE_INSTALLED', result)

    def record_install(self, identity, revision, results):
        project = self.project(identity, int(revision))
        expected_ids = self.expected_game_ids(project)
        catalog = {r['id']: r for r in json.loads((self.root / 'data/mapped_courses.json').read_text())}
        if sorted(r['course_id'] for r in results) != sorted(expected_ids):
            raise ValueError('Installation must include every expected package')
        if not all(catalog.get(r['course_id'],{}).get('dataVersion') == r['map_updated_at'] for r in results):
            raise ValueError('Installed versions could not be verified')
        with self.connect() as db:
            for result in results:
                tracked = db.execute('SELECT revision,version FROM library_installs WHERE course_id=? AND game_id=?',
                                     (identity,result['course_id'])).fetchone()
                if not tracked or tracked['revision'] != int(revision) or tracked['version'] != result['map_updated_at']:
                    raise ValueError('Package installation was not recorded for this revision')
            self.event(db, identity, 'INSTALL_VERIFIED', {'revision': revision, 'packages': expected_ids})
        return {'verified': True}

    def report(self):
        with self.connect() as db:
            rows = db.execute("SELECT c.id,c.name,c.state,c.city,c.status,c.updated,r.path,c.notes FROM library_courses c LEFT JOIN library_revisions r ON c.id=r.course_id AND c.revision=r.revision ORDER BY c.id").fetchall()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Course ID','Course Name','State','City','Status','Updated At (UTC)','Project Path','Notes'])
        for row in rows:
            values=list(row)
            values[5]=datetime.fromtimestamp(values[5],UTC).isoformat()
            # Neutralize spreadsheet formulas in untrusted names/notes.
            writer.writerow(["'" + v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in values])
        try:
            validation = json.loads((self.base/'reports/intake-validation.json').read_text())
            for error in validation.get('errors',[]):
                writer.writerow(['',f"CSV row {error['row']}",'','','Invalid input','','',error['error']])
        except (OSError,ValueError,KeyError):
            pass
        text = output.getvalue()
        destination = self.base / 'reports/results.csv'
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text)
        os.chmod(destination, 0o600)
        return text
