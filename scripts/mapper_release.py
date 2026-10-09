#!/usr/bin/env python3
"""Prepare, explicitly deploy, or roll back source-only Mapper releases."""
from pathlib import Path
import argparse,hashlib,json,shlex,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
DEFAULT_CONFIG=Path.home()/'.config/jetta/mapper-target.json'

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=Path,default=DEFAULT_CONFIG)
    subs=parser.add_subparsers(dest='action',required=True)
    prep=subs.add_parser('prepare');prep.add_argument('--commit',default='HEAD');prep.add_argument('--output',type=Path,required=True)
    for name in ['check','deploy']:
        sub=subs.add_parser(name);sub.add_argument('release',type=Path)
    sub=subs.add_parser('rollback');sub.add_argument('backup')
    args=parser.parse_args();config=json.loads(args.config.read_text())
    receiver=(ROOT/'scripts/mapper_release_receiver.py').read_text()
    def remote(request):
        request.update(root=config['root'],service=config['service'])
        command=['ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ConnectTimeout=10','-i',config['identity'],'-p',str(config.get('port',22)),config['host'],'python3 -c '+shlex.quote(receiver)]
        result=subprocess.run(command,input=json.dumps(request),capture_output=True,text=True)
        if result.returncode:raise SystemExit('Remote operation failed:\n'+result.stderr)
        return json.loads(result.stdout)
    if args.action=='prepare':
        commit=subprocess.check_output(['git','rev-parse',args.commit+'^{commit}'],cwd=ROOT,text=True).strip()
        from mapper_release_receiver import ALLOWED
        paths=sorted(ALLOWED);baseline=remote({'operation':'inspect','paths':paths});files={}
        for name in paths:
            content=subprocess.check_output(['git','show',commit+':'+name],cwd=ROOT).decode();sha=hashlib.sha256(content.encode()).hexdigest()
            if sha!=baseline[name]:files[name]={'content':content,'sha256':sha,'expected':baseline[name]}
        package={'commit':commit,'files':files,'target':{'host':config['host'],'root':config['root']}}
        args.output.parent.mkdir(mode=0o700,parents=True,exist_ok=True);args.output.write_text(json.dumps(package,indent=2));args.output.chmod(0o600)
        print(json.dumps({'prepared':str(args.output),'commit':commit,'changed_files':list(files),'target':config['host']}))
    elif args.action in ['check','deploy']:
        package=json.loads(args.release.read_text())
        if package['target']!={'host':config['host'],'root':config['root']}:raise SystemExit('Release target differs from configuration')
        if args.action=='check':
            current=remote({'operation':'inspect','paths':list(package['files'])})
            for name,info in package['files'].items():
                if current[name]!=info['expected']:raise SystemExit('Target changed: '+name)
                if hashlib.sha256(info['content'].encode()).hexdigest()!=info['sha256']:raise SystemExit('Release integrity failed: '+name)
            print('Ready: target source unchanged; source-only release integrity passed')
        else:print(json.dumps(remote({'operation':'deploy','package':package})))
    else:print(json.dumps(remote({'operation':'rollback','backup':args.backup})))

if __name__=='__main__':main()
