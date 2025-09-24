/* --------- 渲染：按前三位前缀聚类（大组件） --------- */
function renderPrefixClusters(cid, deferRemove){
  cid = String(cid);
  const st=expandedState.get(cid); if(!st || !st._payload) return;
  const { prefixMap, prefixEdges } = st._payload; st._payload=null; st.mode='prefix';

  const arr=(prefixMap||[]); const sizes=arr.map(o=>o.nodes.length); const p95=Math.max(1, percentile(sizes,0.95));
  const ring=ringPositions(arr.length, 180, 6);
  const prefNodes=arr.map((o,i)=>({ id:`P:${cid}:${o.prefix}`, label:`${o.prefix}\n(n=${o.nodes.length})`,
    shape:'dot', size:Math.min(10+Math.log2(1+o.nodes.length)*4,38),
    color:{ background: heatClassic(normP95(o.nodes.length, p95)), border:'#0b1020' },
    x:st.anchor.x + ring[i].x, y:st.anchor.y + ring[i].y }));

  nodesDS.add(prefNodes); prefNodes.forEach(n=> st.prefixClusters.add(n.id));
  if(deferRemove && nodesDS.get('C:'+cid)){ try{ nodesDS.remove('C:'+cid); }catch{} firstBatchDoneForCid.add(cid); }

  if(prefixEdges?.cross?.length){
    const pes = prefixEdges.cross.map((e,i)=>({ id:`EP:${cid}:${i}`, from:`P:${cid}:${e.pair.split('::')[0]}`, to:`P:${cid}:${e.pair.split('::')[1]}`,
      width: Math.min(1 + Math.log2(1+e.count), 6) }));
    edgesDS.add(pes); pes.forEach(e=> st.edges.add(e.id));
  }
  updateStats(); ensurePhysicsOn(); document.getElementById('hint').textContent='已按前三位前缀聚类展示；双击前缀可展开该簇节点。';
}

/* --------- 展开前缀簇 --------- */
let _pendingDegreesCB=null;
function requestDegrees(ids, cb){
  if(useWorker && workerReady){ _pendingDegreesCB=cb; worker.postMessage({type:'getDegrees', ids}); }
  else{ const out={}; for(const id of ids){ out[id]=(MT_ctx.adj.get(id)||new Set()).size; } cb(out); }
}
function expandPrefix(cid, prefix){
  cid = String(cid);
  const st=expandedState.get(cid); if(!st) return;
  const pid=`P:${cid}:${prefix}`; let anchor=st.anchor;
  if(nodesDS.get(pid)){ const p=network.getPositions([pid])[pid]; if(p && Number.isFinite(p.x)) anchor=p; try{ nodesDS.remove(pid); }catch{} st.prefixClusters.delete(pid); }
  const buildAndShow=(items, degMap)=>{
    const ring=ringPositions(items.length,140,8);
    const visNodes=items.map((id,i)=>({ id:'N:'+id, label:undefined, color:{ background: colorNodeByDegree(degMap[id]||0), border:'#0b1020' }, x:anchor.x + ring[i].x, y:anchor.y + ring[i].y }));
    nodesDS.add(visNodes); visNodes.forEach(n=>{ st.nodes.add(n.id); st.nodeToCid.set(n.id, cid); });
    if(items.length>=2){ const rep='N:'+items[0]; const es=[]; for(let i=1;i<items.length;i++) es.push({ id:`E:${cid}:${prefix}:${i}`, from:rep, to:'N:'+items[i], dashes:true });
      edgesDS.add(es); es.forEach(e=> st.edges.add(e.id)); }
    updateStats(); ensurePhysicsOn();
  };
  const ensureCache=(cb)=>{
    if(st._prefixCache){ cb(st._prefixCache); }
    else{
      if(useWorker && workerReady){
        const onData=(e)=>{
          if(e.data?.type==='componentData' && String(e.data.cid)===cid){
            worker.removeEventListener('message', onData);
            const m=new Map((e.data.prefixMap||[]).map(o=>[o.prefix, o.nodes])); st._prefixCache=m; cb(m);
          }
        }; worker.addEventListener('message', onData);
        worker.postMessage({type:'getComponent', cid, needEdges:false, needPrefix:true});
      }else{
        let set=MT_ctx.comps.get(cid);
        if(!set){
          const numCid=Number(cid);
          if(!Number.isNaN(numCid)) set=MT_ctx.comps.get(numCid);
        }
        if(!set) set=new Set();
        const nodes=Array.from(set);
        const pmap=new Map(); for(const id of nodes){ const p=String(id).slice(0,3); if(!pmap.has(p)) pmap.set(p,[]); pmap.get(p).push(id); }
        st._prefixCache=pmap; cb(pmap);
      }
    }
  };
  ensureCache((map)=>{ const items=map.get(prefix)||[]; requestDegrees(items,(degMap)=> buildAndShow(items,degMap)); });
}

/* --------- 批量展开全部 --------- */
function startExplodeAll(){
  if(!fullSummary) return;
  const minGroup = Number(document.getElementById('minGroup')?.value||1);
  explodeQueue = fullSummary.comps
    .filter(c=>c.size>=1 && c.size>=minGroup)
    .map(c=>String(c.cid))
    .sort((a,b)=>{
    const sa=fullSummary.comps.find(x=>String(x.cid)===a)?.size??0;
    const sb=fullSummary.comps.find(x=>String(x.cid)===b)?.size??0;
    return sa-sb;
  });
  renderCollapsed(); exploding=true; paused=false;
  document.getElementById('pause').disabled=false; ensurePhysicsOn(); updateETA(); scheduleNextExplode();
}
function scheduleNextExplode(){
  if(!exploding || paused) return;
  if(explodeQueue.length===0){ ensurePhysicsOn(); hideTip(); updateETA(); return; }
  const cid=explodeQueue.shift(); updateETA(); expandComponent(cid);
  setTimeout(scheduleNextExplode, 200); // 更快的节奏
}

/* --------- 其它 --------- */
function componentIdOfNode(nid){
  for(const [cid,st] of expandedState.entries()){
    if(st.nodes.has(nid)) return cid;
    if(st.prefixClusters?.has(nid)) return cid;
  }
  return null;
}

function canonicalEdgeKey(a,b){
  const pair=[a,b].filter(Boolean).sort();
  return pair[0]+'::'+pair[1];
}
function applyNeighborFilters(baseNid, neighbors){
  return (neighbors||[]).filter(n=>{
    const targetId='N:'+(n.id||'');
    if(deletedNodes.has(targetId)) return false;
    if(deletedEdges.has(canonicalEdgeKey(baseNid, targetId))) return false;
    return true;
  });
}
function updateETA(){
  if(!fullSummary || !explodeQueue){ document.getElementById('eta').textContent='ETA: --'; return; }
  const cfg=getBatchConfig();
  const sizesMap=new Map(fullSummary.comps.map(c=>[String(c.cid),c.size]));
  let totalSteps=0;
  if(currentGroup){
    const nodesLeft=Math.max(0,(currentGroup.totalNodes||0)-(currentGroup.addedNodes||0));
    const edgesLeft=Math.max(0,(currentGroup.totalEdges||0)-(currentGroup.addedEdges||0));
    totalSteps += Math.ceil(nodesLeft/cfg.nodeChunk) + Math.ceil(edgesLeft/cfg.edgeChunk);
  }
  for(const cid of explodeQueue){
    const size=sizesMap.get(cid)||0;
    const estEdges=EDGES_PER_COMP.get(cid) ?? Math.round(size*((fullSummary?.totalEdges||0)/(fullSummary?.totalNodes||1)));
    totalSteps += Math.ceil(size/cfg.nodeChunk) + Math.ceil(estEdges/cfg.edgeChunk);
  }
  document.getElementById('eta').textContent='ETA: ~ '+(totalSteps<=1? '几秒' : (totalSteps*0.4|0)+'s'); // 粗略
}
function pushUndo(entry){ if(!entry) return; undoStack.push(entry); if(undoStack.length>100) undoStack.shift(); }
function removeNode(nodeId, {recordUndo=true}={}){
  if(!nodeId || !nodesDS) return false;
  if(!nodeId.startsWith('N:')) return false;
  const node=nodesDS.get(nodeId); if(!node) return false;
  const edges=edgesDS?.get?.({ filter:e=>(e.from===nodeId || e.to===nodeId) }) || [];
  const cid=componentIdOfNode(nodeId);
  const cidsByEdge={};
  edges.forEach(e=>{
    for(const [cidKey, st] of expandedState.entries()){
      if(st.edges?.has(e.id)){
        (cidsByEdge[e.id] ||= []).push(cidKey);
        st.edges.delete(e.id);
      }
    }
    edgesDS.remove(e.id);
    if(e.from.startsWith('N:') && e.to.startsWith('N:')){ deletedEdges.add(canonicalEdgeKey(e.from,e.to)); }
  });
  nodesDS.remove(nodeId);
  if(cid){
    const st=expandedState.get(cid);
    if(st){ st.nodes?.delete(nodeId); st.prefixClusters?.delete(nodeId); st.nodeToCid?.delete(nodeId); }
  }
  deletedNodes.add(nodeId);
  if(tipData && ('N:'+tipData.id)===nodeId){ hideTip(); } else { pruneTipNeighborsByNode(nodeId); }
  if(recordUndo){ pushUndo({ type:'node', node, edges, cid, cidsByEdge }); }
  updateStats(); updateETA(); ensurePhysicsOn();
  return true;
}
function removeEdgesBetweenNodes(nidA, nidB, {recordUndo=true}={}){
  if(!nidA || !nidB || !edgesDS) return false;
  if(!nidA.startsWith('N:') || !nidB.startsWith('N:')) return false;
  const edges=edgesDS.get({ filter:e=> (e.from===nidA && e.to===nidB) || (e.from===nidB && e.to===nidA) }) || [];
  if(!edges.length) return false;
  const cidsByEdge={};
  edges.forEach(e=>{
    for(const [cidKey, st] of expandedState.entries()){
      if(st.edges?.has(e.id)){
        (cidsByEdge[e.id] ||= []).push(cidKey);
        st.edges.delete(e.id);
      }
    }
    edgesDS.remove(e.id);
  });
  if(nidA.startsWith('N:') && nidB.startsWith('N:')){ deletedEdges.add(canonicalEdgeKey(nidA,nidB)); }
  updateTipAfterEdgeRemoval(nidA, nidB);
  if(recordUndo){ pushUndo({ type:'edges', edges, nodes:[nidA,nidB], cidsByEdge }); }
  updateStats(); updateETA(); ensurePhysicsOn();
  return true;
}
function removeEdgeById(edgeId, {recordUndo=true}={}){
  if(!edgeId || !edgesDS) return false;
  const edge=edgesDS.get(edgeId); if(!edge) return false;
  return removeEdgesBetweenNodes(edge.from, edge.to, {recordUndo});
}
function undoLast(){
  const entry=undoStack.pop(); if(!entry) return;
  hideTip();
  if(entry.type==='node'){
    const {node, edges=[], cid, cidsByEdge={}} = entry;
    if(node){
      deletedNodes.delete(node.id);
      nodesDS.add(node);
      if(cid){
        const st=expandedState.get(cid);
        if(st){ st.nodeToCid?.set(node.id, cid); if(node.id.startsWith('N:')) st.nodes?.add(node.id); if(node.id.startsWith('P:')) st.prefixClusters?.add(node.id); }
      }
    }
    for(const e of edges){
      edgesDS.add(e);
      if(e.from.startsWith('N:') && e.to.startsWith('N:')){ deletedEdges.delete(canonicalEdgeKey(e.from,e.to)); }
      const list=cidsByEdge[e.id];
      if(list){ for(const cidKey of list){ const st=expandedState.get(cidKey); if(st){ st.edges?.add(e.id); } } }
    }
    updateStats(); updateETA(); ensurePhysicsOn();
    return;
  }
  if(entry.type==='edges'){
    const {edges=[], nodes=[], cidsByEdge={}} = entry;
    for(const e of edges){
      edgesDS.add(e);
      if(e.from.startsWith('N:') && e.to.startsWith('N:')){ deletedEdges.delete(canonicalEdgeKey(e.from,e.to)); }
      const list=cidsByEdge[e.id];
      if(list){ for(const cidKey of list){ const st=expandedState.get(cidKey); if(st){ st.edges?.add(e.id); } } }
    }
    if(nodes.length===2){ deletedEdges.delete(canonicalEdgeKey(nodes[0], nodes[1])); }
    updateStats(); updateETA(); ensurePhysicsOn();
  }
}

function locateNode(){
  const id=(document.getElementById('search').value||'').trim(); if(!id) return;
  const nid = nodesDS.get('N:'+id)? 'N:'+id : nodesDS.get('C:'+id)? 'C:'+id : null;
  if(!nid){ alert('未找到该节点/组件，请确认是否已展开或 ID 是否正确。'); return; }
  network.selectNodes([nid], true); const pos=network.getPositions([nid])[nid]; network.moveTo({ position:pos, scale:1.2, animation:true });
}
function exportPNG(){
  if(!network?.canvas?.frame) return; const canvas=network.canvas.frame.canvas; const url=canvas.toDataURL('image/png');
  const a=document.createElement('a'); a.href=url; a.download='同品关系图.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function resetAll(){
  nodesDS?.clear?.(); edgesDS?.clear?.(); expandedState.clear(); firstBatchDoneForCid.clear(); fullSummary=null;
  DEGREE_CAP=0; DEGREE_MAX=0; GROUP_CAP=0; GROUP_MAX=0; GROUP_CAP_ALL=0; GROUP_CAP_NOSINGLES=0; EDGES_PER_COMP=new Map();
  currentGroup=null; explodeQueue=[]; exploding=false; paused=false; setProgress(0,''); document.getElementById('pause').disabled=true;
    deletedNodes.clear(); deletedEdges.clear(); undoStack.length=0;
  document.getElementById('pause').textContent='暂停'; document.getElementById('eta').textContent='ETA: --';
  hideTip();
  closeGroupPanel();
  closeConfirmedPanel();
  confirmedGroups.clear();
  renderGroupList();
  updateStats();
  updateLegends();
}

