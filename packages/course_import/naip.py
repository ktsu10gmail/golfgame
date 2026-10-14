"""Read-only, bounded NAIP imagery evidence for existing Mapper courses."""
import base64
import hashlib
import json
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

SERVICE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer'
ATTRIBUTION = 'USGS / USDA · NAIP; OSM © OpenStreetMap contributors'


def evidence_bounds(course, project):
    lat, lng = float(course['latitude']), float(course['longitude'])
    if not math.isfinite(lat) or not math.isfinite(lng) or not -85 < lat < 85 or not -180 <= lng <= 180:
        raise ValueError('Course coordinate is invalid')
    points = []
    def add(point):
        if not isinstance(point, dict):
            return
        a, b = point.get('lat'), point.get('lng')
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(a) and math.isfinite(b):
            north = (a-lat)*111320
            east = (b-lng)*111320*math.cos(math.radians(lat))
            if math.hypot(north, east) <= 4000:
                points.append((a,b))
    for feature in project.get('external_course_source', {}).get('reference_features', []):
        if feature.get('type') == 'facility_boundary':
            for point in feature.get('points', []): add(point)
    if not points:
        for hole in project.get('holes', {}).values():
            for feature in hole.get('features', []):
                for point in feature.get('points', []): add(point)
            for point in hole.get('markers', {}).values(): add(point)
            for point in hole.get('route_points', []): add(point)
    margin = 150 if points else 1200
    points.append((lat,lng))
    dy, dx = margin/111320, margin/(111320*math.cos(math.radians(lat)))
    return [min(p[1] for p in points)-dx, min(p[0] for p in points)-dy,
            max(p[1] for p in points)+dx, max(p[0] for p in points)+dy]


def mercator(lng, lat):
    return [6378137*math.radians(lng), 6378137*math.log(math.tan(math.pi/4+math.radians(lat)/2))]


def geographic(x, y):
    return [math.degrees(2*math.atan(math.exp(y/6378137))-math.pi/2), math.degrees(x/6378137)]


def _read(url, limit):
    request = Request(url, headers={'User-Agent':'JettaMapper-GeometryAssist/1.0'})
    with urlopen(request, timeout=20) as response:
        if urlsplit(response.geturl()).hostname != urlsplit(SERVICE).hostname:
            raise ValueError('Unexpected imagery response host')
        data = response.read(limit+1)
    if len(data)>limit: raise ValueError('Imagery response exceeded the size limit')
    return data


def _json(path, params):
    data = json.loads(_read(SERVICE+path+'?'+urlencode(params), 2*1024*1024))
    if 'error' in data: raise ValueError('NAIP service could not provide this imagery')
    return data


def load_naip(course, project, cache_dir):
    anchor = {'lat':float(course['latitude']), 'lng':float(course['longitude'])}
    result = {'status':'unavailable','service':SERVICE,'anchor':anchor,'attribution':ATTRIBUTION}
    # NAIP pilot is continental US only. Do not request another dataset silently.
    if course.get('country') != 'US' or not (24 <= anchor['lat'] <= 50 and -125 <= anchor['lng'] <= -66):
        return {**result,'message':'NAIP is unavailable here. This pilot supports the continental US.'}
    bounds = evidence_bounds(course,project)
    result['search_bounds'] = [[bounds[1],bounds[0]],[bounds[3],bounds[2]]]
    key = hashlib.sha256(json.dumps([SERVICE,bounds],sort_keys=True).encode()).hexdigest()
    cache = Path(cache_dir)/f'{key}.json'
    if cache.exists() and time.time()-cache.stat().st_mtime < 86400:
        try: return {**json.loads(cache.read_text()), 'anchor':anchor, 'cached':True}
        except (OSError, ValueError, TypeError): pass
    try:
        catalog = _json('/query', {'f':'json','where':'Category=1',
            'geometry':json.dumps({'xmin':bounds[0],'ymin':bounds[1],'xmax':bounds[2],'ymax':bounds[3],'spatialReference':{'wkid':4326}}),
            'geometryType':'esriGeometryEnvelope','spatialRel':'esriSpatialRelIntersects','inSR':4326,'outFields':'OBJECTID,Name,Year,acquisition_date,resolution_value,resolution_units',
            'returnGeometry':'true','outSR':4326,'orderByFields':'Year DESC','resultRecordCount':50})
        features = catalog.get('features', [])
        if not features:
            return {**result,'message':'No NAIP coverage was found for this course area.'}
        if catalog.get('exceededTransferLimit'):
            return {**result,'status':'unknown','message':'Coverage exceeds the bounded pilot request. Reduce the inspection area.'}
        year = max(f['attributes'].get('Year') or 0 for f in features)
        selected = [f['attributes'] for f in features if (f['attributes'].get('Year') or 0)==year]
        ids = [f['OBJECTID'] for f in selected]
        lo, hi = mercator(bounds[0],bounds[1]), mercator(bounds[2],bounds[3])
        width, height = hi[0]-lo[0], hi[1]-lo[1]
        size = [2048, max(256,round(2048*height/width))] if width>=height else [max(256,round(2048*width/height)),2048]
        exported = _json('/exportImage', {'f':'json','bbox':','.join(map(str,lo+hi)), 'bboxSR':3857,'imageSR':3857,
            'size':','.join(map(str,size)),'format':'png32','interpolation':'RSP_BilinearInterpolation',
            'mosaicRule':json.dumps({'mosaicMethod':'esriMosaicLockRaster','lockRasterIds':ids,'mosaicOperation':'MT_FIRST'})})
        href = exported.get('href','')
        if urlsplit(href).scheme != 'https' or urlsplit(href).hostname != urlsplit(SERVICE).hostname:
            raise ValueError('Unexpected imagery download address')
        image = _read(href, 10*1024*1024)
        if not image.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('NAIP returned an invalid image')
        extent=exported['extent']
        if (extent.get('spatialReference',{}).get('latestWkid') or extent.get('spatialReference',{}).get('wkid')) not in [3857,102100]:
            raise ValueError('Unexpected imagery coordinate system')
        dates = sorted({datetime.fromtimestamp(f['acquisition_date']/1000,timezone.utc).date().isoformat() for f in selected if f.get('acquisition_date')})
        resolutions = sorted({f"{f['resolution_value']} {f.get('resolution_units') or 'units'}" for f in selected if f.get('resolution_value')})
        result.update(status='available', message='Read-only imagery evidence. Coverage may be partial at tile edges; blank areas are unknown.',
            year=year, acquisition_dates=dates, resolutions=resolutions, raster_ids=ids,
            image_bounds=[geographic(extent['xmin'],extent['ymin']),geographic(extent['xmax'],extent['ymax'])],
            image_data='data:image/png;base64,'+base64.b64encode(image).decode(),
            fetched_at=datetime.now(timezone.utc).isoformat(), cached=False)
        cache.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w',dir=cache.parent,delete=False) as handle:
            json.dump(result,handle); temporary=handle.name
        os.replace(temporary,cache)
        return result
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {**result,'status':'unknown','message':'NAIP imagery could not load. Existing geometry remains available; try again later.'}


def geometry_assist(library, identity):
    # Read existing evidence only; never invoke save, intake, validation or import.
    with library.connect() as db:
        row=db.execute('SELECT id,name,country,latitude,longitude,revision FROM library_courses WHERE id=?',(identity,)).fetchone()
    if not row or not row['revision']: raise ValueError('Open a saved course draft for Geometry Assist')
    course=dict(row)
    project=library.project(identity,course['revision'])
    baseline=library.project(identity,1)
    return {'course':course,'project':project,'osm_project':baseline,
            'naip':load_naip(course,baseline,library.root/'data'/'geometry_assist_cache')}
