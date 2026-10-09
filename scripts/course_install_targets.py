"""Install validated course packages locally or via a configured SSH target."""
from pathlib import Path
import fcntl, hashlib, json, os, shlex, shutil, subprocess, sys, tempfile, uuid


def fingerprint(payload):
    return hashlib.sha256(json.dumps({k:v for k,v in payload.items() if k not in
        {'exported_at','library_context','production_context','install_target'}},sort_keys=True).encode()).hexdigest()


def receive(root, payload):
    """Run on destination: validate, serialize writes, back up, verify, roll back."""
    root=Path(root).resolve()
    sys.path.insert(0,str(root))
    from scripts import import_mapped_course as importer
    importer.validate_package(payload)
    importer.validate_course_holes(payload)
    images=importer.decoded_hole_images(payload)
    data=root/'data'
    if importer.DATA_DIR.resolve()!=data.resolve():
        raise ValueError('Installer root mismatch')
    data.mkdir(exist_ok=True)
    with (data/'.mapper-install.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        destination=data/payload['course_id'];catalog=data/'mapped_courses.json'
        if destination.is_symlink() or catalog.is_symlink():raise ValueError('Symlink destination rejected')
        backup=data/'backups'/('mapper-install-'+uuid.uuid4().hex)
        backup.mkdir(parents=True,mode=0o700)
        existed=destination.exists();catalog_existed=catalog.exists()
        if existed:shutil.copytree(destination,backup/'course-before')
        if catalog_existed:shutil.copy2(catalog,backup/'catalog-before.json')
        (backup/'manifest.json').write_text(json.dumps({'course_id':payload['course_id'],'fingerprint':fingerprint(payload),'version':payload.get('exported_at')}))
        try:
            importer.install_package(payload,force=True)
            for n in range(1,19):
                if json.loads((destination/f'hole{n}.json').read_text())!=payload['holes'][str(n)]:raise ValueError('Installed geometry verification failed')
            if (destination/'scorecard.csv').read_text()!=payload['scorecard_csv']:raise ValueError('Installed scorecard verification failed')
            for n,(extension,content) in images.items():
                if (destination/'illustrations'/f'hole{n}.{extension}').read_bytes()!=content:raise ValueError('Installed artwork verification failed')
            if not any(r['id']==payload['course_id'] and r['dataVersion']==payload.get('exported_at','mapped-v1') for r in json.loads(catalog.read_text())):raise ValueError('Installed catalog verification failed')
        except Exception:
            if destination.exists():shutil.rmtree(destination)
            if existed:shutil.copytree(backup/'course-before',destination)
            if catalog_existed:shutil.copy2(backup/'catalog-before.json',catalog)
            elif catalog.exists():catalog.unlink()
            raise
        return {'installed':True,'verified':True,'course_id':payload['course_id'],'course_name':payload['course_name'],
            'map_updated_at':payload.get('exported_at'),'holes':18,'backup':str(backup),'fingerprint':fingerprint(payload)}


def _install_target(root,payload,target):
    if target not in {'dev','prod'}:raise ValueError('Unknown installation target')
    root=Path(root);receipts=root/'data/install-receipts';receipts.mkdir(exist_ok=True,mode=0o700)
    receipt=receipts/(payload['course_id']+'.json')
    clean={k:v for k,v in payload.items() if k not in {'library_context','production_context','install_target'}}
    if target=='prod':
        previous=json.loads(receipt.read_text()) if receipt.exists() else {}
        catalog=json.loads((root/'data/mapped_courses.json').read_text()) if (root/'data/mapped_courses.json').exists() else []
        current=any(row['id']==payload['course_id'] and row.get('dataVersion')==previous.get('map_updated_at') for row in catalog)
        if not current or previous.get('fingerprint')!=fingerprint(clean):raise ValueError('Install this exact course content in Dev first, test it, then install in Prod.')
        config=Path(os.getenv('MAPPER_PROD_TARGET_CONFIG',str(Path.home()/'.config/jetta/mapper-target.json')))
        settings=json.loads(config.read_text())
        # Connection and root come only from private host configuration, never browser input.
        code=Path(__file__).read_text()+ '\nprint(json.dumps(receive('+repr(settings['root'])+',json.load(sys.stdin))))\n'
        command=['ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=10',
            '-i',settings['identity'],'-p',str(settings.get('port',22)),settings['host'],'python3 -c '+shlex.quote(code)]
        process=subprocess.run(command,input=json.dumps(clean),capture_output=True,text=True,timeout=180)
        if process.returncode:raise ValueError('Prod installation failed; inspect destination backups before retrying. '+process.stderr[-1200:])
        result=json.loads(process.stdout)
        if result.get('fingerprint')!=fingerprint(clean) or not result.get('verified'):raise ValueError('Prod verification receipt mismatch')
    else:
        result=receive(root,clean)
        fd,name=tempfile.mkstemp(prefix='.receipt-',dir=receipts)
        with os.fdopen(fd,'w') as output:json.dump(result,output)
        os.replace(name,receipt)
    result['install_target']=target
    return result


def install_target(root,payload,target):
    if target not in {'dev','prod'}:raise ValueError('Unknown installation target')
    from scripts.import_mapped_course import validate_package
    validate_package(payload)
    root=Path(root)
    with (root/'data/.mapper-targets.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        return _install_target(root,payload,target)
