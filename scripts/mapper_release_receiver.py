"""Apply explicit Mapper source releases; never move runtime state."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json,os,subprocess,sys,time

ALLOWED = {'editor.html', 'editor.js', 'editor.css', 'packages/editor/course_mapper.mjs'}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def target(root,name):
    if name not in ALLOWED:
        raise ValueError('Not an approved Mapper source path: '+name)
    path=root/name
    if path.resolve()!=path.absolute():
        raise ValueError('Symlink source path refused')
    return path

def inspect(root,names):
    return {name:digest(target(root,name)) for name in names}

def restore(root,backup,manifest):
    for name,info in manifest['files'].items():
        path=target(root,name)
        if info['before'] is None:
            path.unlink(missing_ok=True)
        else:
            data=(backup/name).read_bytes()
            if hashlib.sha256(data).hexdigest()!=info['before']:
                raise ValueError('Rollback backup integrity failure: '+name)
            path.write_bytes(data);os.chmod(path,info['mode'])

def apply(root,package,reload_service):
    files=package['files']
    if not files:raise ValueError('Release has no source files')
    for name,info in files.items():
        path=target(root,name)
        if digest(path)!=info['expected']:
            raise ValueError('Target changed since preparation: '+name)
        if hashlib.sha256(info['content'].encode()).hexdigest()!=info['sha256']:
            raise ValueError('Release integrity failure: '+name)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=root/'data/backups'/('mapper-code-'+stamp+'-'+package['commit'][:12]);backup.mkdir(mode=0o700,parents=True)
    manifest={'commit':package['commit'],'files':{}}
    for name,info in files.items():
        path=target(root,name);mode=path.stat().st_mode & 0o777 if path.exists() else 0o644
        manifest['files'][name]={'before':digest(path),'after':info['sha256'],'mode':mode}
        if path.exists():
            saved=backup/name;saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(path.read_bytes())
    (backup/'manifest.json').write_text(json.dumps(manifest,indent=2))
    try:
        for name,info in files.items():
            path=target(root,name);path.parent.mkdir(parents=True,exist_ok=True)
            temporary=path.with_name(path.name+'.mapper-release-new');temporary.write_text(info['content']);os.chmod(temporary,manifest['files'][name]['mode']);os.replace(temporary,path)
        reload_service()
        if inspect(root,files)!={name:info['sha256'] for name,info in files.items()}:
            raise ValueError('Post-deployment source mismatch')
    except Exception:
        restore(root,backup,manifest);reload_service();raise
    return {'deployed_commit':package['commit'],'backup':str(backup),'files':list(files)}

def rollback(root,backup,reload_service):
    backup=Path(backup)
    if backup.parent.resolve()!=(root/'data/backups').resolve() or not backup.name.startswith('mapper-code-'):
        raise ValueError('Invalid rollback folder')
    manifest=json.loads((backup/'manifest.json').read_text())
    for name,info in manifest['files'].items():
        if digest(target(root,name))!=info['after']:
            raise ValueError('Source changed after deployment; rollback refused: '+name)
    # Verify every backup before restoring any file.
    for name,info in manifest['files'].items():
        if info['before'] is not None and digest(backup/name)!=info['before']:
            raise ValueError('Rollback backup integrity failure')
    restore(root,backup,manifest);reload_service()
    return {'rolled_back':True,'backup':str(backup)}

def main():
    os.umask(0o077);request=json.load(sys.stdin);root=Path(request['root'])
    if root.resolve()!=root:raise ValueError('Target root must be an absolute nonsymlink path')
    def reload_service():
        subprocess.run(['systemctl','--user','restart',request['service']],check=True,capture_output=True)
        from urllib.request import urlopen
        for attempt in range(30):
            try:
                with urlopen('http://127.0.0.1:8081/editor.html',timeout=3) as response:
                    if response.status==200:return
            except OSError:time.sleep(.2)
        raise ValueError('Mapper health check failed')
    if request['operation']=='inspect':result=inspect(root,request['paths'])
    elif request['operation']=='deploy':result=apply(root,request['package'],reload_service)
    elif request['operation']=='rollback':result=rollback(root,request['backup'],reload_service)
    else:raise ValueError('Unknown operation')
    print(json.dumps(result))

if __name__=='__main__':main()
