"""Three-way geometry review. Scorecard, identity and operator fields stay local."""
from __future__ import annotations

import copy
import hashlib
import json


def semantic(value):
    if isinstance(value, dict):
        return {key:semantic(item) for key,item in value.items() if key not in {'provider_version'}}
    if isinstance(value, list):
        return [semantic(item) for item in value]
    return value


def units(project):
    result = {}
    def features(items, prefix):
        seen = set()
        for feature in items:
            identity = feature.get('id')
            if not isinstance(identity,str) or not identity or identity in seen:
                raise ValueError('Feature identities must be present and unique before reviewing updates')
            seen.add(identity)
            result[(*prefix,identity)] = feature
    for number,hole in project.get('holes',{}).items():
        features(hole.get('features',[]),('holes',number,'features'))
        for role in ('blue_tee','white_tee','forward_tee','pin'):
            result[('holes',number,'markers',role)] = hole.get('markers',{}).get(role)
        result[('holes',number,'route_points')] = hole.get('route_points',[])
    features(project.get('external_course_source',{}).get('reference_features',[]),('references',))
    return result


def changes(baseline,current,incoming):
    # New layout grouping needs the full layout workflow, not a silent upgrade/truncation.
    if any(project.get('course_structure') != current.get('course_structure') or
           set(project.get('holes',{})) != set(current.get('holes',{})) for project in (baseline,incoming)):
        return {'blocked':'Layout/hole grouping changed; review the source draft separately before merging','changes':[]}
    layout=incoming.get('external_course_source',{}).get('layout_assessment',{})
    if layout.get('unsupported') or layout.get('ambiguous'):
        return {'blocked':layout.get('reason') or 'Unresolved source layout','changes':[]}
    old,local,new = units(baseline),units(current),units(incoming)
    # Operator-assigned reference shapes keep their chosen hole/tee role. Compare
    # their geometry against the original reference, not an invented hole assignment.
    for path,value in list(local.items()):
        if path[0]!='holes' or path[2]!='features' or path in old:
            continue
        reference=('references',path[3])
        if reference not in old:
            continue
        source=new.get(reference)
        if source is None:
            candidates=[feature for key,feature in new.items() if len(key)==4 and key[2]=='features' and key[3]==path[3]]
            if len(candidates)==1: source=candidates[0]
        old[path]={**value,'points':old[reference]['points']}
        new[path]={**value,'points':source['points']} if source else None
    result=[]
    for path in sorted(set(old)|set(new)):
        before,ours,theirs=old.get(path),local.get(path),new.get(path)
        if semantic(theirs) == semantic(before) or semantic(theirs) == semantic(ours):
            continue
        removed=bool(before) and not theirs
        reassigned=(len(path)==4 and path[2]=='features' and before is None and ours is None and
                    any(key[0]=='holes' and len(key)==4 and key[2]=='features' and key[3]==path[3] for key in local))
        conflict=semantic(ours) != semantic(before) or reassigned
        kind='removal' if removed else 'conflict' if conflict else 'source change'
        identity=hashlib.sha256(json.dumps(path).encode()).hexdigest()[:24]
        label=('Hole '+path[1]+' · '+' / '.join(path[2:])) if path[0]=='holes' else 'Reference shape · '+path[-1]
        result.append({'id':identity,'path':list(path),'label':label,'kind':kind,
                       'baseline':before,'current':ours,'incoming':theirs})
    return {'blocked':None,'changes':result}


def merge(current,review,accepted):
    if review.get('blocked'):
        raise ValueError(review['blocked'])
    if not isinstance(accepted,list) or not all(isinstance(identity,str) for identity in accepted):
        raise ValueError('Accepted changes must be a list of change IDs')
    by_id={change['id']:change for change in review['changes']}
    if set(accepted)-set(by_id):
        raise ValueError('Unknown change ID; reload the source review')
    project=copy.deepcopy(current)
    for identity in set(accepted):
        change=by_id[identity]; path=change['path']; value=copy.deepcopy(change['incoming'])
        if path[0]=='references':
            source=project.setdefault('external_course_source',{})
            collection=source.setdefault('reference_features',[])
            collection[:]=[feature for feature in collection if feature['id'] != path[1]]
            if value is not None: collection.append(value)
        else:
            hole=project['holes'][path[1]]
            if path[2]=='features':
                collection=hole['features']
                collection[:]=[feature for feature in collection if feature['id'] != path[3]]
                if value is not None: collection.append(value)
            elif path[2]=='markers':
                hole['markers'][path[3]]=value
            else:
                hole['route_points']=value
    return project
