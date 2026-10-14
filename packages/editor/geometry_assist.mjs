// Isolated evidence and trace proposals; only explicit save creates a library revision.
export function traceProject(evidence, trace, id, timestamp) {
  const hole=evidence.project.holes?.[trace.hole];
  if (!hole || !['bunker','green','fairway','water','trees','tee_blue','tee_white','tee_forward'].includes(trace.type)) throw new Error('Select a saved hole and feature type.');
  if (evidence.naip.status!=='available') throw new Error('NAIP imagery is unavailable.');
  const points=trace.points;
  const bounds=evidence.naip.image_bounds;
  if (!Array.isArray(points) || points.length<3 || points.length>500 || points.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.lat<bounds[0][0]||p.lat>bounds[1][0]||p.lng<bounds[0][1]||p.lng>bounds[1][1])) throw new Error('Trace at least three points within the NAIP image.');
  const cross=(a,b,c)=>(b.lng-a.lng)*(c.lat-a.lat)-(b.lat-a.lat)*(c.lng-a.lng);
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(a.lat===b.lat && a.lng===b.lng) throw new Error('Remove repeated boundary points.');
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1 || (i===0 && j===points.length-1)) continue;
      const c=points[j],d=points[(j+1)%points.length];
      const on=(p,q,r)=>Math.abs(cross(p,q,r))<1e-14 && r.lat>=Math.min(p.lat,q.lat) && r.lat<=Math.max(p.lat,q.lat) && r.lng>=Math.min(p.lng,q.lng) && r.lng<=Math.max(p.lng,q.lng);
      if((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b)) throw new Error('Boundary crosses itself. Undo points and trace a simple outline.');
    }
  }
  const origin=points[0];
  const area=Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+(a.lng-origin.lng)*(b.lat-origin.lat)-(b.lng-origin.lng)*(a.lat-origin.lat);},0));
  if(area<1e-12) throw new Error('Trace a visible area, rather than a line.');
  const project=structuredClone(evidence.project);
  project.holes[trace.hole].features.push({id,type:trace.type,label:`NAIP traced ${trace.type}`,source:'naip_manual_trace',points:structuredClone(points),
    provenance:{classification:'INFERENCE_PROPOSAL',method:'human_boundary_trace',provider:'USGS / USDA NAIP',service:evidence.naip.service,catalog_year:evidence.naip.year,acquisition_dates:evidence.naip.acquisition_dates,resolutions:evidence.naip.resolutions,raster_ids:evidence.naip.raster_ids,image_bounds:bounds,base_revision:evidence.course.revision,created_at:timestamp,review:'operator_preview_accepted'}});
  return project;
}
const colors = {green:'#9acd32',fairway:'#63ab66',bunker:'#e7c47a',water:'#479fcd',rough:'#718c5b',trees:'#315a3b',woods:'#315a3b',tee:'#f6f3e8'};
const editableTypes=['bunker','green','fairway','water','trees','tee_blue','tee_white','tee_forward','rough','penalty_area_unknown','hole_outline','cart_path','out_of_bounds'];
export function editAssistProject(project, selection, action, target, timestamp) {
  const feature=project.holes?.[selection?.hole]?.features?.[selection?.index];
  if (!feature || !Number.isInteger(selection.index) || selection.index<0) throw new Error('Select a saved draft shape.');
  if (!['delete','reassign'].includes(action)) throw new Error('Unsupported shape edit.');
  if(action==='reassign' && (!project.holes?.[target?.hole] || !editableTypes.includes(target?.type))) throw new Error('Select a valid destination hole and feature type.');
  const result=structuredClone(project);
  const [edited]=result.holes[selection.hole].features.splice(selection.index,1);
  if(action==='reassign') {
    edited.assist_edit_history=[...(edited.assist_edit_history || []),{method:'operator_reassignment',from_hole:selection.hole,from_type:edited.type,to_hole:target.hole,to_type:target.type,created_at:timestamp}];
    edited.type=target.type;edited.manual_override=true;
    if(edited.source==='naip_manual_trace') edited.label=`NAIP traced ${target.type.replaceAll('_',' ')}`;
    result.holes[target.hole].features.push(edited);
  }
  return result;
}
export function assistFeatures(project) {
  const entries=[];
  const point=p=>p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
  for (const [number,hole] of Object.entries(project.holes || {})) {
    for (const [index,feature] of (hole.features || []).entries()) {
      if (feature.points?.length>=3 && feature.points.every(point)) entries.push({type:feature.type,number,index,points:feature.points,kind:'polygon'});
    }
    for (const [role,p] of Object.entries(hole.markers || {})) {
      if (role.includes('tee') && point(p)) entries.push({type:'tee',number,points:[p],kind:'marker'});
    }
    const markers=hole.markers || {};
    const tee=markers[`${hole.tee_alignment_anchor || 'blue'}_tee`] || markers.white_tee || markers.blue_tee;
    if (point(tee) && point(markers.pin)) entries.push({type:'route',number,kind:'route',points:[tee,...(hole.route_points || []).filter(point),markers.pin]});
  }
  for (const feature of project.external_course_source?.reference_features || []) {
    if (feature.points?.length>=3 && feature.points.every(point)) entries.push({type:feature.type,number:null,kind:'polygon',points:feature.points});
  }
  return entries;
}

export function assistHolePoints(projects, number) {
  return projects.flatMap(project => assistFeatures(project)
    .filter(feature => feature.number === String(number))
    .flatMap(feature => feature.points.map(point => [point.lat, point.lng])));
}

export function createGeometryAssist({L, container, controls, status, metadata, save, onSaved}) {
  let map, evidence, imagery;
  let trace=null, traceLayer=null, saving=false;
  let selection=null, editProposal=null;
  const objectPicker=controls.querySelector('#assist-object');
  const destination=controls.querySelector('#assist-object-hole');
  const objectType=controls.querySelector('#assist-object-type');
  const objectDelete=controls.querySelector('#assist-object-delete');
  const objectReassign=controls.querySelector('#assist-object-reassign');
  function objectOptions() {
    const number=controls.querySelector('#assist-hole').value;
    const options=[new Option('Select a saved shape','')];
    for(const [hole,data] of Object.entries(evidence?.project.holes || {}).sort((a,b)=>Number(a[0])-Number(b[0]))) {
      if(number && hole!==number)continue;
      for(const [index,feature] of (data.features || []).entries()) options.push(new Option(`Hole ${hole} · ${feature.label || feature.type.replaceAll('_',' ')} · shape ${index+1}`,`${hole}:${index}`));
    }
    objectPicker.replaceChildren(...options);
    if(selection) objectPicker.value=`${selection.hole}:${selection.index}`;
  }
  function chooseShape(hole,index) {
    if(trace || editProposal || saving)return;
    selection={hole,index};
    controls.querySelector('#assist-hole').value=hole;objectOptions();
    const feature=evidence.project.holes[hole].features[index];
    destination.value=hole;objectType.value=feature.type;
    objectPicker.value=`${hole}:${index}`;
    controls.querySelector('[data-assist-layer="jetta"]').checked=true;
    status.textContent=`Selected hole ${hole} · ${feature.type.replaceAll('_',' ')}. Delete or choose its destination hole and type, then preview reassignment.`;
    draw();traceControls();
  }
  objectPicker.addEventListener('change',()=>{
    if(!objectPicker.value){selection=null;draw();traceControls();return;}
    const [hole,index]=objectPicker.value.split(':');chooseShape(hole,Number(index));
    const points=evidence.project.holes[hole].features[index].points;
    map.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lng])).pad(.3),{maxZoom:19});
  });
  function previewEdit(action) {
    if(!selection || trace || editProposal || saving)return;
    try {
      editProposal=editAssistProject(evidence.project,selection,action,{hole:destination.value,type:objectType.value},new Date().toISOString());
      status.textContent=action==='delete'?'Deletion preview: selected shape removed. Save new revision to confirm, or Discard changes.':`Reassignment preview: shape moved to hole ${destination.value} as ${objectType.value.replaceAll('_',' ')}. Save new revision to confirm.`;
      selection=null;draw();traceControls();
      if(action==='reassign') {controls.querySelector('#assist-hole').value=destination.value;fitSelection();}
    } catch(error){status.textContent=error.message;}
  }
  objectDelete.addEventListener('click',()=>previewEdit('delete'));
  objectReassign.addEventListener('click',()=>previewEdit('reassign'));
  const button=name=>controls.querySelector(`#assist-trace-${name}`);
  function traceControls() {
    button('start').disabled=!evidence || evidence.naip.status!=='available' || !controls.querySelector('#assist-hole').value || !!trace || !!editProposal || saving;
    button('undo').disabled=!trace?.points.length || saving;
    button('preview').disabled=!trace || trace.points.length<3 || trace.preview || saving;
    button('discard').disabled=(!trace && !editProposal) || saving;
    button('save').disabled=(!trace?.preview && !editProposal) || saving;
    objectPicker.disabled=!evidence || !!trace || !!editProposal || saving;
    for(const input of [destination,objectType,objectDelete,objectReassign]) input.disabled=!selection || !!trace || !!editProposal || saving;
    controls.querySelector('#assist-hole').disabled=!!trace || saving;
    controls.querySelector('#assist-trace-type').disabled=!!trace || saving;
    controls.querySelector('#assist-fit').disabled=!!trace || saving;
    if(map) map.getContainer().style.cursor=trace && !trace.preview?'crosshair':'';
  }
  function drawTrace() {
    traceLayer?.remove();traceLayer=null;
    if(trace?.points.length && map) {
      traceLayer=L.layerGroup().addTo(map);
      const points=trace.points.map(p=>[p.lat,p.lng]);
      (trace.preview?L.polygon(points,{color:'#ffb300',fillOpacity:.3,interactive:false}):L.polyline(points,{color:'#ffb300',interactive:false})).addTo(traceLayer);
      for(const point of points) L.circleMarker(point,{radius:4,color:'#ffb300',interactive:false}).addTo(traceLayer);
    }
    traceControls();
  }
  button('start').addEventListener('click',()=>{
    selection=null;objectPicker.value='';
    trace={hole:controls.querySelector('#assist-hole').value,type:controls.querySelector('#assist-trace-type').value,points:[],preview:false};
    status.textContent=`Trace ${trace.type} for hole ${trace.hole}: tap boundary points, then Preview shape.`;draw();drawTrace();
  });
  button('undo').addEventListener('click',()=>{trace.points.pop();trace.preview=false;status.textContent=`${trace.points.length} points · continue tracing, then preview.`;drawTrace();});
  button('discard').addEventListener('click',()=>{trace=null;editProposal=null;selection=null;objectOptions();draw();drawTrace();status.textContent='Changes discarded. Saved geometry unchanged.';});
  button('preview').addEventListener('click',()=>{
    try {traceProject(evidence,trace,'preview',new Date().toISOString());trace.preview=true;status.textContent=`Preview: hole ${trace.hole} · ${trace.type} · ${trace.points.length} points. Save new revision to add this shape.`;drawTrace();}
    catch(error){status.textContent=error.message;}
  });
  button('save').addEventListener('click',async()=>{
    if((!trace?.preview && !editProposal) || saving)return;
    saving=true;traceControls();
    try {
      const project=editProposal || traceProject(evidence,trace,`naip-${crypto.randomUUID?.() || Date.now()+'-'+Math.random().toString(36).slice(2)}`,new Date().toISOString());
      const result=await save({id:evidence.course.id,revision:evidence.course.revision,project});
      evidence.project=result.project;evidence.course.revision=result.revision;
      trace=null;editProposal=null;selection=null;objectOptions();drawTrace();draw();
      metadata.textContent=metadata.textContent.replace(/Saved revision \d+/,`Saved revision ${result.revision}`);
      status.textContent=`Saved revision ${result.revision}. Open Draft to continue editing. Game installation is unchanged.`;
      try {await onSaved?.(result);}
      catch {status.textContent+= ' Refresh Course Library to see the latest revision.';}
    } catch(error){status.textContent=`Could not save: ${error.message}`;}
    finally {saving=false;draw();traceControls();}
  });
  const groups=[];
  let requestNumber=0;
  function draw() {
    if (!map || !evidence) return;
    for (const group of groups) group.remove();
    groups.length=0;
    const types=new Set([...controls.querySelectorAll('[data-assist-feature]:checked')].map(input=>input.dataset.assistFeature));
    for (const [layer,project] of [['osm',evidence.osm_project],['jetta',editProposal || evidence.project]]) {
      if (!controls.querySelector(`[data-assist-layer="${layer}"]`).checked) continue;
      if (layer==='osm' && project.external_course_source?.provider_name !== 'openstreetmap') continue;
      const opacity=Number(controls.querySelector('#assist-osm-opacity').value)/100;
      const group=L.layerGroup().addTo(map);groups.push(group);
      for (const f of assistFeatures(project)) {
        const type=f.type.startsWith('tee') ? 'tee' : ['rough','trees','woods'].includes(f.type) ? 'trees' : f.type;
        const chosen=layer==='jetta' && selection?.hole===f.number && selection?.index===f.index && f.kind==='polygon';
        if (!chosen && (type==='route' ? !controls.querySelector('[data-assist-layer="routes"]').checked : type!=='facility_boundary' && !types.has(type))) continue;
        const points=f.points.map(p=>[p.lat,p.lng]);
        const selected=controls.querySelector('#assist-hole').value;
        const emphasis=!selected || f.number===selected ? 1 : .15;
        const selectable=layer==='jetta' && f.number && f.kind==='polygon' && !trace && !editProposal && !saving;
        const style={color:chosen?'#ffb300':layer==='osm' ? (colors[type] || '#64bdd9') : '#ef59b1',weight:chosen?4:layer==='osm'?2:2.5,
          interactive:!!selectable,opacity:chosen?1:(layer==='osm'?opacity:1)*emphasis,fillOpacity:chosen ? .3 : layer==='osm' ? opacity*.16*emphasis : selectable ? .05 : 0,dashArray:layer==='osm'?'5 3':null};
        const shape=f.kind==='marker' ? L.circleMarker(points[0],{...style,radius:4}) : f.kind==='route' ? L.polyline(points,style) : L.polygon(points,style);
        shape.bindTooltip(`${layer==='osm'?'OSM import · revision 1':'Jetta draft · revision '+evidence.course.revision} · ${f.number?'Hole '+f.number+' · ':''}${f.kind==='marker'?'tee marker · role requires review':f.type}`).addTo(group);
        if(selectable)shape.on('click',event=>{L.DomEvent.stopPropagation(event);chooseShape(f.number,f.index);});
      }
    }
    if (imagery) {
      imagery.setOpacity(Number(controls.querySelector('#assist-naip-opacity').value)/100);
      const visible=controls.querySelector('[data-assist-layer="naip"]').checked;
      if (visible && !map.hasLayer(imagery)) imagery.addTo(map);
      if (!visible) imagery.remove();
    }
  }
  controls.addEventListener('input',draw);
  function fitSelection() {
    if (!evidence || !map) return;
    const number=controls.querySelector('#assist-hole').value;
    if(!editProposal) {selection=null;objectOptions();status.textContent=evidence.naip.message;}
    if (number) {
      const points=assistHolePoints([editProposal || evidence.project,evidence.osm_project],number);
      if (points.length) map.fitBounds(L.latLngBounds(points).pad(.2),{maxZoom:19});
      else status.textContent=`Hole ${number} has no geographic geometry to zoom to. ${evidence.naip.message}`;
    } else map.fitBounds(evidence.naip.search_bounds || [[evidence.course.latitude-.01,evidence.course.longitude-.01],[evidence.course.latitude+.01,evidence.course.longitude+.01]]);
    draw();
    traceControls();
  }
  controls.querySelector('#assist-hole').addEventListener('change',fitSelection);
  controls.querySelector('#assist-fit').addEventListener('click',()=>{controls.querySelector('#assist-hole').value='';fitSelection();});
  async function open(course,load) {
    const sequence=++requestNumber;
    evidence=null;trace=null;traceLayer=null;selection=null;editProposal=null;objectOptions();traceControls();status.textContent='Loading saved evidence and NAIP imagery…';metadata.textContent='';
    if (map) {map.remove();map=null;imagery=null;groups.length=0;}
    const result=await load(`geometry-assist?id=${encodeURIComponent(course.id)}`);
    if(sequence!==requestNumber)return;
    evidence=result;
    evidence.naip.message=evidence.naip.message.replace('Read-only imagery evidence.','NAIP imagery evidence.');
    const selector=controls.querySelector('#assist-hole');
    selector.replaceChildren(new Option('All holes',''), ...Object.keys(result.project.holes || {})
      .sort((a,b)=>Number(a)-Number(b)).map(number=>new Option(`Hole ${number}`,number)));
    destination.replaceChildren(...Object.keys(result.project.holes || {}).sort((a,b)=>Number(a)-Number(b)).map(number=>new Option(`Hole ${number}`,number)));
    objectType.replaceChildren(...editableTypes.map(type=>new Option(type.replaceAll('_',' '),type)));
    objectOptions();
    const hasOsm=result.osm_project.external_course_source?.provider_name==='openstreetmap';
    controls.querySelector('[data-assist-layer="osm"]').disabled=!hasOsm;
    map=L.map(container,{maxZoom:21,minZoom:12,zoomControl:true,preferCanvas:true});
    map.doubleClickZoom.disable();
    map.on('click',event=>{
      if(!trace || trace.preview || saving)return;
      const p={lat:event.latlng.lat,lng:event.latlng.lng},bounds=evidence.naip.image_bounds;
      if(p.lat<bounds[0][0] || p.lat>bounds[1][0] || p.lng<bounds[0][1] || p.lng>bounds[1][1]) {status.textContent='Choose points within the NAIP image.';return;}
      if(trace.points.length>=500){status.textContent='Maximum 500 points. Preview or undo points.';return;}
      trace.points.push(p);status.textContent=`Hole ${trace.hole} · ${trace.type} · ${trace.points.length} points`;drawTrace();
    });
    // Web Mercator imagery extent and vector geography use the same Leaflet camera.
    map.setView([course.latitude,course.longitude],16);
    if(result.naip.status==='available') {
      imagery=L.imageOverlay(result.naip.image_data,result.naip.image_bounds,{opacity:.85,attribution:'USGS / USDA · NAIP',interactive:false}).addTo(map);
      imagery.on('error',()=>{status.textContent='NAIP image could not display. Geometry remains available.';});
    }
    const n=result.naip;
    status.textContent=n.message;
    metadata.textContent=`Anchor ${result.course.latitude.toFixed(6)}, ${result.course.longitude.toFixed(6)} · Saved revision ${result.course.revision} · ${hasOsm?'OSM import revision 1':'OSM import unavailable'}${n.status==='available'?` · NAIP catalog ${n.year || 'year unknown'} · Acquired ${n.acquisition_dates.join(', ') || 'date unknown'} · ${n.resolutions.join(', ') || 'resolution unknown'}${n.cached?' · cached':''}`:''}`;
    map.attributionControl.addAttribution('© OpenStreetMap contributors · ODbL');
    fitSelection();setTimeout(()=>map?.invalidateSize(),0);
  }
  function canClose() {return !saving && ((!trace && !editProposal) || confirm('Discard these unsaved geometry changes?'));}
  function close() {requestNumber++;if(map){map.remove();map=null;}imagery=null;evidence=null;trace=null;traceLayer=null;selection=null;editProposal=null;groups.length=0;objectOptions();traceControls();}
  return {open,close,canClose};
}
