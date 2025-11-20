
/* --------- 渲染：按前三位前缀聚类（大组件） --------- */

// 在全局变量部分添加
const groupPruneDetails = new Map(); // 存储剔品详情
if(typeof globalThis!=='undefined'){ globalThis.groupPruneDetails = groupPruneDetails; }

function triggerMergeGraphRefresh(options){
  try{
    const fn = (typeof globalThis!=='undefined') ? globalThis.refreshMergeGraph : undefined;
    if(typeof fn === 'function'){ fn(options || {}); }
  }catch(err){ console.warn('refreshMergeGraph 调用失败', err); }
}


// —— 新增：把“被吞并 ← 吞并者”明细压缩成“链式关系”文本 —— //
function _formatMergeChainsForCid(cid){
  try{
    const key = String(cid??'');
    const rec = groupPruneRecords?.get?.(key) || [];
    if(!rec.length) return '';
    const victimParentRaw=new Map();
    const victims=new Set();
    for(const e of rec){
      const victim=String(e?.node?.id||'').replace(/^N:/,'');
      const merger=String(e?.mergedBy||'').replace(/^N:/,'');
      if(!victim) continue;
      victims.add(victim);
      if(merger) victimParentRaw.set(victim, merger);
    }
    const resolveFinalMerger=(id)=>{
      if(!id) return null;
      let current=id;
      const seen=new Set();
      while(victimParentRaw.has(current)){
        if(seen.has(current)) return null;
        seen.add(current);
        const next=victimParentRaw.get(current);
        if(!next || next===current) return null;
        current=next;
      }
      return current;
    };
    const mergedMap=new Map();
    for(const victim of victims){
      const finalMerger=resolveFinalMerger(victimParentRaw.get(victim));
      if(!finalMerger || finalMerger===victim) continue;
      if(!mergedMap.has(finalMerger)) mergedMap.set(finalMerger,new Set());
      mergedMap.get(finalMerger).add(victim);
    }
    if(!mergedMap.size){
      return Array.from(victims).sort().map((v,i)=> `${(i+1).toString().padStart(2,'0')}. ${v}`).join('\n');
    }
    const pickName = (idN)=>{
      const id=String(idN||'').replace(/^N:/,'');
      const nm=(expandedState.get(key)?.names?.[id]) || (MT_ctx?.nameOf?.get?.(id)) || '';
      return nm? `${id}（${nm}）` : id;
    };
    const lines = Array.from(mergedMap.entries())
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([merger,set],idx)=> `${(idx+1).toString().padStart(2,'0')}. ${pickName(merger)} 吞并 ${Array.from(set).sort().map(pickName).join('、')}`);
    return lines.join('\n');
  }catch(err){
    console.warn('format chains failed', err);
    return '';
  }
}



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
  updateStats(); ensurePhysicsOn();
  const hintEl=document.getElementById('hint');
  if(hintEl) hintEl.textContent='已按前三位前缀聚类展示；双击前缀可展开该簇节点。';
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
  const pauseBtn=document.getElementById('pause');
  if(pauseBtn){ pauseBtn.disabled=false; }
  ensurePhysicsOn(); updateETA(); scheduleNextExplode();
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

function getComponentIdByCode(code){
  if(code===undefined || code===null) return null;
  const plain = String(code).replace(/^N:/,'').trim();
  if(!plain) return null;
  try{
    if(MT_ctx?.compOf instanceof Map){
      let cid = MT_ctx.compOf.get(plain);
      if(cid===undefined){
        const num=Number(plain);
        if(!Number.isNaN(num)) cid = MT_ctx.compOf.get(num);
      }
      if(cid!==undefined && cid!==null) return String(cid);
    }
  }catch(err){ console.warn('compOf lookup failed', err); }
  const fallback = typeof componentIdOfNode==='function' ? componentIdOfNode('N:'+plain) : null;
  return fallback? String(fallback):null;
}
if(typeof window!=='undefined'){ window.getComponentIdByCode = getComponentIdByCode; }

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
  const etaEl=document.getElementById('eta');
  if(!etaEl) return;
  if(!fullSummary || !explodeQueue){ etaEl.textContent='ETA: --'; return; }
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
  etaEl.textContent='ETA: ~ '+(totalSteps<=1? '几秒' : (totalSteps*0.4|0)+'s'); // 粗略
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
  const codeA=typeof stripNodePrefix==='function' ? stripNodePrefix(nidA) : String(nidA||'').replace(/^N:/,'').trim();
  const codeB=typeof stripNodePrefix==='function' ? stripNodePrefix(nidB) : String(nidB||'').replace(/^N:/,'').trim();
  if(codeA && codeB && typeof handleRelationRemovalBetweenCodes==='function'){
    try{ handleRelationRemovalBetweenCodes(codeA, codeB); }catch(err){}
  }
  return true;
}
function removeEdgeById(edgeId, {recordUndo=true}={}){
  if(!edgeId || !edgesDS) return false;
  const edge=edgesDS.get(edgeId); if(!edge) return false;
  return removeEdgesBetweenNodes(edge.from, edge.to, {recordUndo});
}
function undoLast(){
  const entry=undoStack.pop(); if(!entry) return;
  let mergeTouched=false;
  for(const [cidKey, entries] of groupPruneRecords.entries()){
    const idx = entries.indexOf(entry);
    if(idx !== -1){
      entries.splice(idx,1);
      if(entries.length===0){ groupPruneRecords.delete(cidKey); }
      mergeTouched=true;
      break;
    }
  }
  if(mergeTouched) triggerMergeGraphRefresh({ keepPositions:true });
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
  const value=(document.getElementById('search').value||'').trim();
  if(!value) return;
  const target=resolveGraphSearchTarget(value);
  if(!target){
    alert('未找到该节点，请输入准确的 ID 或商品名称。');
    return;
  }
  if(target.visId){
    network.selectNodes([target.visId], true);
    const pos=network.getPositions([target.visId])[target.visId];
    if(pos){
      network.moveTo({ position:pos, scale:1.2, animation:true });
    }
  }else if(target.code){
    const ok = typeof focusGraphNode==='function' ? focusGraphNode(target.code,{ center:true, select:true }) : false;
    if(!ok){
      alert('节点未在当前画布中显示，请展开对应组件后再试。');
    }
  }
  if(target.code){
    try{ highlightRawTableRow(target.code,{ scroll:true, view:'graph' }); }catch(err){ /* ignore */ }
  }
}
function locateNodeFromMerge(id){
  if(!id) return false;
  const searchInput=document.getElementById('search');
  if(searchInput){ searchInput.value=id; }
  const ok = typeof focusGraphNode==='function' ? focusGraphNode(id,{ center:true, select:true }) : false;
  if(ok){
    try{ highlightRawTableRow(id,{ scroll:true, view:'graph' }); }catch(err){ /* ignore */ }
    return true;
  }
  return false;
}
function locateMergeNode({ fallbackToGraph=false, input }={}){
  const field = input || document.getElementById('mergeSearch');
  const query=(field?.value||'').trim();
  if(!query){
    alert('请输入节点 ID 或商品名称');
    return false;
  }
  const code=resolveCodeFromInput(query);
  if(!code){
    alert('未找到该节点，请输入准确的 ID 或商品名称。');
    return false;
  }
  const okMerge = typeof focusMergeNode==='function' ? focusMergeNode(code,{ center:true, select:true }) : false;
  if(okMerge){
    try{ highlightRawTableRow(code,{ scroll:true, view:'merge' }); }catch(err){ /* ignore */ }
    return true;
  }
  if(typeof requestPendingMergeLocate==='function'){
    requestPendingMergeLocate(code,{ fallbackToGraph });
    return true;
  }
  if(fallbackToGraph){
    const okGraph = typeof focusGraphNode==='function' ? focusGraphNode(code,{ center:true, select:true }) : false;
    if(okGraph){
      try{ highlightRawTableRow(code,{ scroll:true, view:'graph' }); }catch(err){ /* ignore */ }
      return true;
    }
  }
  alert('吞并视图中未找到该节点，请确认已有吞并记录。');
  return false;
}

function resolveGraphSearchTarget(value){
  const trimmed=String(value||'').trim();
  if(!trimmed) return null;
  const nodeVis = nodesDS?.get?.('N:'+trimmed) ? 'N:'+trimmed : null;
  if(nodeVis) return { code:trimmed, visId:nodeVis };
  const compVis = nodesDS?.get?.('C:'+trimmed) ? 'C:'+trimmed : null;
  if(compVis) return { componentId:trimmed, visId:compVis };
  const code = resolveCodeFromInput(trimmed);
  if(code){
    const fallbackVis = nodesDS?.get?.('N:'+code) ? 'N:'+code : null;
    return { code, visId:fallbackVis };
  }
  return null;
}

function resolveCodeFromInput(value){
  const trimmed=String(value||'').trim();
  if(!trimmed) return null;
  const direct=resolveCodeIncludingMerge(trimmed);
  if(direct) return direct;
  const nameMatched=findCodeByName(trimmed) || findCodeInMergeTableByName(trimmed);
  if(nameMatched && resolveCodeIncludingMerge(nameMatched)) return nameMatched;
  return nameMatched || null;
}

function resolveCodeIncludingMerge(code){
  if(!code) return null;
  if(codeExistsInData(code)) return code;
  const mergeCode=findCodeInMergeTableByCode(code);
  return mergeCode || null;
}

function codeExistsInData(code){
  if(!code) return false;
  try{
    if(nodesDS?.get?.('N:'+code)) return true;
    if(typeof tableContexts!=='undefined'){
      const ctx=tableContexts?.graph;
      if(ctx?.dataByCode?.has(code)) return true;
    }
    if(findCodeInMergeTableByCode(code)) return true;
    if(MT_ctx?.nameOf instanceof Map && MT_ctx.nameOf.has(code)) return true;
  }catch(err){ /* ignore */ }
  return false;
}

function findCodeInMergeTableByCode(code){
  try{
    if(typeof tableContexts==='undefined') return null;
    const ctx=tableContexts?.merge;
    if(!ctx || !ctx.dataByCode) return null;
    const normalized=typeof normalizeCode==='function' ? normalizeCode(code) : String(code||'').trim();
    if(normalized && ctx.dataByCode.has(normalized)) return normalized;
    if(ctx.dataByCode.has(String(code))) return String(code);
  }catch(err){ /* ignore */ }
  return null;
}

function findCodeByName(name){
  const text=String(name||'').trim();
  if(!text) return null;
  const lower=text.toLowerCase();
  let result=null;
  try{
    const nameMap = (typeof graphNameIndex!=='undefined' && graphNameIndex instanceof Map) ? graphNameIndex : null;
    if(nameMap){
      const exact = nameMap.get(lower);
      if(exact) return exact;
      for(const [key,code] of nameMap.entries()){
        if(key.includes(lower)){ result=code; break; }
      }
      if(result) return result;
    }
    if(MT_ctx?.nameOf instanceof Map){
      for(const [code,label] of MT_ctx.nameOf.entries()){
        if(!label) continue;
        if(String(label).trim().toLowerCase()===lower){
          result=String(code).trim();
          break;
        }
      }
      if(!result){
        for(const [code,label] of MT_ctx.nameOf.entries()){
          if(!label) continue;
          const normalized=String(label).trim().toLowerCase();
          if(normalized && normalized.includes(lower)){
            result=String(code).trim();
            break;
          }
        }
      }
    }
  }catch(err){ /* ignore */ }
  return result;
}

function findCodeInMergeTableByName(name){
  if(!name || typeof tableContexts==='undefined') return null;
  const ctx=tableContexts?.merge;
  if(!ctx || !Array.isArray(ctx.rows)) return null;
  const lower=String(name).trim().toLowerCase();
  if(!lower) return null;
  let result=null;
  for(const row of ctx.rows){
    if(!row) continue;
    const display=readMergeRowDisplayName(row);
    if(display && display.toLowerCase()===lower){
      result=row.code;
      break;
    }
  }
  if(result) return result;
  for(const row of ctx.rows){
    if(!row) continue;
    const display=readMergeRowDisplayName(row);
    if(display && display.toLowerCase().includes(lower)){
      result=row.code;
      break;
    }
  }
  return result;
}

function readMergeRowDisplayName(row){
  const metaName=String(row?.meta?.displayName||'').trim();
  if(metaName) return metaName;
  const idx=(typeof rawTableNameIndex==='number' && rawTableNameIndex>=0) ? rawTableNameIndex : -1;
  if(idx>=0 && Array.isArray(row?.cells)){
    const cell=row.cells[idx];
    if(cell!==undefined && cell!==null){
      const text=String(cell).trim();
      if(text) return text;
    }
  }
  return '';
}

function flushNetworkDatasets({ fit=true }={}){
  try{ nodesDS?.flush?.(); }catch(err){}
  try{ edgesDS?.flush?.(); }catch(err){}
  if(fit){
    requestAnimationFrame(()=>{
      try{ network?.fit?.({ animation:false }); }catch(err){}
    });
  }else{
    try{ requestAnimationFrame(()=> network?.redraw?.()); }catch(err){}
  }
}

function exportPNG(){
  if(!network?.canvas?.frame) return; const canvas=network.canvas.frame.canvas; const url=canvas.toDataURL('image/png');
  const a=document.createElement('a'); a.href=url; a.download='同品关系图.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function exportMergePNG(){
  if(!mergeNetwork?.canvas?.frame) return;
  const canvas=mergeNetwork.canvas.frame.canvas;
  const url=canvas.toDataURL('image/png');
  const link=document.createElement('a');
  link.href=url;
  link.download='吞并视图.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

let _autoPruneRunning = false;

async function autoPruneUnstableNodes(){
  if(_autoPruneRunning) return;
  if(!nodesDS || !edgesDS){
    alert('网络尚未初始化，无法执行自动剔品');
    return;
  }
  if(!fullSummary || !Array.isArray(fullSummary.comps) || !fullSummary.comps.length){
    alert('请先构建图谱后再执行自动剔品');
    return;
  }
  _autoPruneRunning = true;
  let totalRemoved = 0;
  groupPruneInProgress.clear();
  const prevRecords = new Map(groupPruneRecords);
  const prevDetails = new Map(groupPruneDetails);
  groupPruneRecords.clear();
  groupPruneDetails.clear();
  try{
    setStatus('自动剔品处理中...');
    const comps = fullSummary.comps.slice().sort((a,b)=> (b.size||0)-(a.size||0));
    for(const comp of comps){
      const cidKey = String(comp?.cid ?? '');
      if(!cidKey) continue;
      try{
        const removed = await recommendPruneForGroup(cidKey, { skipAutoGuard:true, suppressMergeRefresh:true });
        if(Number.isFinite(removed)) totalRemoved += removed;
      }catch(err){
        console.warn('自动剔品处理组件失败', cidKey, err);
      }
    }
    if(typeof renderGroupList === 'function'){
      try{ renderGroupList(activeGroupCid); }catch(err){ console.warn('renderGroupList 更新失败', err); }
    }
    setStatus(totalRemoved>0 ? `自动剔品完成，删除 ${totalRemoved} 个节点` : '自动剔品完成，无需删除');
  }catch(err){
    console.error('自动剔品异常', err);
    alert('自动剔品过程中出现错误：'+(err?.message || err));
    setStatus('自动剔品失败');
  }finally{
    groupPruneInProgress.clear();
    _autoPruneRunning = false;
    if(totalRemoved===0){
      groupPruneRecords.clear();
      prevRecords.forEach((val,key)=>{ groupPruneRecords.set(key, Array.isArray(val)? val.slice():val); });
      groupPruneDetails.clear();
      prevDetails.forEach((val,key)=>{
        if(!Array.isArray(val)){ groupPruneDetails.set(key, val); return; }
        groupPruneDetails.set(key, val.map(item=>({
          ...item,
          neighbors: Array.isArray(item.neighbors)? item.neighbors.map(n=>({...n})):[]
        })));
      });
    }
    if(typeof renderGroupList === 'function'){
      try{ renderGroupList(activeGroupCid); }catch(err){ console.warn('renderGroupList 更新失败', err); }
    }
    triggerMergeGraphRefresh({ keepPositions:false, fit:true, defer:true });
  }
}

async function autoUltimatePruneNodes(){
  if(_autoPruneRunning) return;
  if(!nodesDS || !edgesDS){
    alert('网络尚未初始化，无法执行究极剔品');
    return;
  }
  if(!fullSummary || !Array.isArray(fullSummary.comps) || !fullSummary.comps.length){
    alert('请先构建图谱后再执行究极剔品');
    return;
  }
  _autoPruneRunning = true;
  let totalRemoved = 0;
  groupPruneInProgress.clear();
  const prevRecords = new Map(groupPruneRecords);
  const prevDetails = new Map(groupPruneDetails);
  groupPruneRecords.clear();
  groupPruneDetails.clear();
  try{
    setStatus('究极剔品处理中...');
    const comps = fullSummary.comps.slice().sort((a,b)=> (b.size||0)-(a.size||0));
    for(const comp of comps){
      const cidKey = String(comp?.cid ?? '');
      if(!cidKey) continue;
      try{
        const removed = await recommendPruneForGroup(cidKey, { skipAutoGuard:true, suppressMergeRefresh:true, ultimate:true });
        if(Number.isFinite(removed)) totalRemoved += removed;
      }catch(err){
        console.warn('究极剔品处理组件失败', cidKey, err);
      }
    }
    if(typeof renderGroupList === 'function'){
      try{ renderGroupList(activeGroupCid); }catch(err){ console.warn('renderGroupList 更新失败', err); }
    }
    setStatus(totalRemoved>0 ? `究极剔品完成，删除 ${totalRemoved} 个节点` : '究极剔品完成，无需删除');
  }catch(err){
    console.error('究极剔品异常', err);
    alert('究极剔品过程中出现错误：'+(err?.message || err));
    setStatus('究极剔品失败');
  }finally{
    groupPruneInProgress.clear();
    _autoPruneRunning = false;
    if(totalRemoved===0){
      groupPruneRecords.clear();
      prevRecords.forEach((val,key)=>{ groupPruneRecords.set(key, Array.isArray(val)? val.slice():val); });
      groupPruneDetails.clear();
      prevDetails.forEach((val,key)=>{
        if(!Array.isArray(val)){ groupPruneDetails.set(key, val); return; }
        groupPruneDetails.set(key, val.map(item=>({
          ...item,
          neighbors: Array.isArray(item.neighbors)? item.neighbors.map(n=>({...n})):[]
        })));
      });
    }
    if(typeof renderGroupList === 'function'){
      try{ renderGroupList(activeGroupCid); }catch(err){ console.warn('renderGroupList 更新失败', err); }
    }
    triggerMergeGraphRefresh({ keepPositions:false, fit:true, defer:true });
  }
}

const groupPruneRecords = new Map();
if(typeof globalThis!=='undefined'){ globalThis.groupPruneRecords = groupPruneRecords; }
const groupPruneInProgress = new Set();

function isGroupPruned(cid){
  const key = String(cid ?? '');
  if(!key) return false;
  const record = groupPruneRecords.get(key);
  return Array.isArray(record) && record.length>0;
}

function ensureComponentNodesReady(cid, onReady, onFail){
  const key = String(cid);
  let attempts = 0;
  const maxAttempts = 40;
  let requested = false;
  const tick = ()=>{
    const st = expandedState.get(key);
    const nodeCount = st?.nodes ? st.nodes.size : 0;
    if(nodeCount>0){
      onReady && onReady();
      return;
    }
    if(!requested){
      requested = true;
      if(typeof expandComponent === 'function'){
        expandComponent(key, 'full');
      }
    }
    if(attempts++ >= maxAttempts){
      const err = new Error('组件节点加载超时');
      if(onFail) onFail(err); else console.warn(err.message);
      return;
    }
    setTimeout(tick, 150);
  };
  tick();
}



function captureUndoEntryForNode(nid, mergedBy=null){
  const ok = removeNode(nid, {recordUndo:true});
   if(!ok) return null;

  const entry = undoStack.pop(); // 取出刚刚 push 的删除记录
  if(entry && mergedBy){
    // 记录“被谁吞并”
    entry.mergedBy = mergedBy;
  }
   return entry;
}









function pruneComponentNodes(cid, { preferred, ultimate=false } = {}){
  const key = String(cid);
  const preferredMergers = preferred || new Set();
  const removedEntries = [];
  const pruneDetails = []; // 记录剔品详情
  let safety = 0;
  while(true){
    const { adjacency, order } = buildAdjacencySnapshot(id => componentIdOfNode(id) === key);
    if(order.length === 0) break;
    let removedInPass = false;
    for(const nid of order){
      if(preferredMergers.has(nid)) continue;
      const neighbors = Array.from(adjacency.get(nid) || []);
      const stableClique = isStableNeighborClique(neighbors, adjacency);
      if(!stableClique || (ultimate && neighbors.length>0)){
        // 记录被删除节点的邻居信息
        const nodeId = nid.startsWith('N:') ? nid.slice(2) : nid;
        const neighborInfo = neighbors.map(n => {
          const id = n.startsWith('N:') ? n.slice(2) : n;
          const st = expandedState.get(key);
          const name = st?.names?.[id] || MT_ctx.nameOf?.get(id) || '';
          return { id, name };
        });
        pruneDetails.push({
          nodeId,
          nodeName: expandedState.get(key)?.names?.[nodeId] || MT_ctx.nameOf?.get(nodeId) || '',
          neighbors: neighborInfo
        });
        
                // 先挑一个“吞并者”（若没有“最有可能”，从 neighbors 随机一个；若空邻居则为 null）
        const mergedBy = pickMergerForNode(nid, neighbors, adjacency, preferredMergers);
        if(mergedBy){ preferredMergers.add(mergedBy); }
        const entry = captureUndoEntryForNode(nid, mergedBy);

        if(entry){
          removedEntries.push(entry);
          removedInPass = true;
        }
        break;
      }
    }
    if(!removedInPass) break;
    if(++safety > 5000){
      console.warn('pruneComponentNodes safety break', key);
      break;
    }
  }
  return { entries: removedEntries, details: pruneDetails, preferred: preferredMergers };
}

function recommendPruneForGroup(cid, opts){
  const key = String(cid);
  const { skipAutoGuard=false, suppressMergeRefresh=false, ultimate=false } = opts || {};
  const modeLabel = ultimate ? '究极剔品' : '剔品';
  return new Promise((resolve, reject)=>{
    if(_autoPruneRunning && !skipAutoGuard){
      reject(new Error('自动剔品正在执行，请稍后再试'));
      return;
    }
    if(groupPruneInProgress.has(key)){
      resolve(0);
      return;
    }
    groupPruneInProgress.add(key);
    setStatus(`组件 ${key} ${modeLabel}处理中...`);
    ensureComponentNodesReady(key, ()=>{
      const preferredCtx = new Set();
      const aggregateEntries=[];
      const aggregateDetails=[];
      try{
        while(true){
          const { entries, details } = pruneComponentNodes(key, { preferred: preferredCtx, ultimate });
          if(!entries.length) break;
          aggregateEntries.push(...entries);
          if(details.length) aggregateDetails.push(...details);
          if(!ultimate) break;
        }
        if(aggregateEntries.length>0){
          groupPruneRecords.set(key, aggregateEntries);
          if(aggregateDetails.length) groupPruneDetails.set(key, aggregateDetails);
          else groupPruneDetails.delete(key);
          setStatus(`组件 ${key} ${modeLabel}完成，删除 ${aggregateEntries.length} 个节点`);
          if(ultimate && typeof syncTableRowsAfterUltimate==='function'){
            try{ syncTableRowsAfterUltimate({ cid:key, entries:aggregateEntries }); }catch(err){ console.warn('syncTableRowsAfterUltimate failed', err); }
          }
        }else{
          groupPruneRecords.delete(key);
          groupPruneDetails.delete(key);
          setStatus(`组件 ${key} 暂无需${modeLabel}`);
        }
        if(!suppressMergeRefresh){
          triggerMergeGraphRefresh({ keepPositions:true, fit:aggregateEntries.length>0 });
        }
        flushNetworkDatasets({ fit: aggregateEntries.length>0 });
        groupPruneInProgress.delete(key);
        resolve(aggregateEntries.length);
      }catch(err){
        groupPruneInProgress.delete(key);
        setStatus(`组件 ${key} ${modeLabel}失败`);
        reject(err);
      }
    }, (err)=>{
      groupPruneInProgress.delete(key);
      setStatus(`组件 ${key} ${modeLabel}失败`);
      reject(err || new Error('组件节点尚未加载完成'));
    });
  });
}

function ultimatePruneForGroup(cid){
  return recommendPruneForGroup(cid, { ultimate:true });
}

function undoPruneForGroup(cid){
  const key = String(cid);
  return new Promise((resolve, reject)=>{
    const record = groupPruneRecords.get(key);
    if(!record || !record.length){
      setStatus(`组件 ${key} 暂无可撤销的剔品记录`);
      resolve(0);
      return;
    }
    try{
      for(let i=record.length-1;i>=0;i--){
        undoStack.push(record[i]);
        undoLast();
      }
      groupPruneRecords.delete(key);
      groupPruneDetails.delete(key); // 清除详情记录
      if(typeof restoreTableRowsAfterUltimate==='function'){
        try{ restoreTableRowsAfterUltimate({ cid:key, entries:record }); }catch(err){ console.warn('restoreTableRowsAfterUltimate failed', err); }
      }
      setStatus(`组件 ${key} 撤销剔品，恢复 ${record.length} 个节点`);
      triggerMergeGraphRefresh({ keepPositions:false, fit:false });
      flushNetworkDatasets({ fit:false });
      resolve(record.length);
    }catch(err){
      setStatus(`组件 ${key} 撤销剔品失败`);
      reject(err);
    }
  });
}

// 添加显示剔品详情的函数
function showPruneDetails(cid){

   // —— 新增：链式关系摘要 —— //
  const chainText = _formatMergeChainsForCid(cid);
  const chainBlock = chainText
    ? `<div class="neighbors-title" style="margin-top:2px;">吞并关系链（压缩视图）</div>
       <pre class="neighbor-list" style="white-space:pre-wrap;line-height:1.8;margin-bottom:8px;">${escapeHtml(chainText)}</pre>`
    : '';


  const details = groupPruneDetails.get(String(cid));
  if(!details || !details.length){
    alert('暂无剔品详情记录');
    return;
  }
  
  // 打开剔品详情面板
  const panel = document.getElementById('pruneDetailPanel');
  const list = document.getElementById('pruneDetailList');
  const count = document.getElementById('pruneDetailCount');
  
  if(!panel || !list) return;
  
  // 渲染剔品详情
  const html = details.map(item => {
    const neighbors = item.neighbors.map(n => 
      `<span class="neighbor-tag">${escapeHtml(n.id)}${n.name ? `<span class="name">(${escapeHtml(n.name)})</span>` : ''}</span>`
    ).join('');
    return `
      <div class="prune-item">
        <div class="title">
          <span class="node-id">被剔除: ${escapeHtml(item.nodeId)}</span>
          ${item.nodeName ? `<span class="hint">${escapeHtml(item.nodeName)}</span>` : ''}
        </div>
        <div class="neighbors-title">原关联节点 (${item.neighbors.length}个):</div>
        <div class="neighbor-list">${neighbors}</div>
      </div>
    `;
  }).join('');

  // 先放链式摘要，再放明细
  list.innerHTML = chainBlock + html;

  count.textContent = `${details.length} 个节点`;
  
  // 打开面板
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
}

function buildAdjacencySnapshot(filterFn){
  const adjacency = new Map();
  const predicate = typeof filterFn === 'function' ? filterFn : null;
  const nodes = nodesDS?.get({ filter: item => item.id?.startsWith('N:') }) || [];
  for(const node of nodes){
    if(predicate && !predicate(node.id)) continue;
    adjacency.set(node.id, new Set());
  }
  const edges = edgesDS?.get({ filter: item => item.from?.startsWith('N:') && item.to?.startsWith('N:') }) || [];
  for(const edge of edges){
    const { from, to } = edge;
    if(predicate){
      if(!adjacency.has(from) || !adjacency.has(to)) continue;
    }else{
      if(!adjacency.has(from)) adjacency.set(from, new Set());
      if(!adjacency.has(to)) adjacency.set(to, new Set());
    }
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  }
  const order = Array.from(adjacency.keys()).sort((a,b)=>{
    const diff = (adjacency.get(b)?.size||0) - (adjacency.get(a)?.size||0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
  return { adjacency, order };
}

function isStableNeighborClique(neighbors, adjacency){
  if(neighbors.length < 2) return true;
  for(let i=0;i<neighbors.length;i++){
    for(let j=i+1;j<neighbors.length;j++){
      const other = neighbors[j];
      const set = adjacency.get(neighbors[i]);
      if(!set || !set.has(other)) return false;
    }
  }
  return true;
}


// 选一个最可能 "吞并" nid 的邻居（优先：已记为吞并者 > 度数越小越好 > 共同邻居越多 > ID 更小）
function pickMergerForNode(nid, neighbors, adjacency, preferredSet){
  if(!neighbors || neighbors.length === 0) return null;
  let best = null;
  let bestPreferred = -1;
  let bestDeg = Infinity;
  let bestMutual = -1;
  const neighSet = new Set(neighbors);
  for(const m of neighbors){
    const set = adjacency.get(m) || new Set();
    // mutual：m 与 nid 的共同邻居数（只在 nid 的邻居集合内计数）
    let mutual = 0;
    for(const x of set){ if(neighSet.has(x)) mutual++; }
    const deg = set.size || 0;
    const preferred = preferredSet && preferredSet.has(m) ? 1 : 0;
    if(
      preferred > bestPreferred ||
      (preferred === bestPreferred && deg < bestDeg) ||
      (preferred === bestPreferred && deg === bestDeg && mutual > bestMutual) ||
      (preferred === bestPreferred && deg === bestDeg && mutual === bestMutual && String(m) < String(best))
    ){
      best = m;
      bestPreferred = preferred;
      bestDeg = deg;
      bestMutual = mutual;
    }
  }
  // 没有“更优”也至少随一个
  return best || neighbors[Math.floor(Math.random()*neighbors.length)];
}










function resetAll(){
  nodesDS?.clear?.(); edgesDS?.clear?.(); expandedState.clear(); firstBatchDoneForCid.clear(); fullSummary=null;
  DEGREE_CAP=0; DEGREE_MAX=0; GROUP_CAP=0; GROUP_MAX=0; GROUP_CAP_ALL=0; GROUP_CAP_NOSINGLES=0; EDGES_PER_COMP=new Map();
  currentGroup=null; explodeQueue=[]; exploding=false; paused=false; setProgress(0,'');
  const pauseBtn=document.getElementById('pause');
  if(pauseBtn){
    pauseBtn.disabled=true;
    pauseBtn.textContent='暂停';
  }
  deletedNodes.clear(); deletedEdges.clear(); undoStack.length=0;
  const etaEl=document.getElementById('eta');
  if(etaEl) etaEl.textContent='ETA: --';
  hideTip();
  closeGroupPanel();
  closeConfirmedPanel();
  confirmedGroups.clear();
  groupPruneRecords.clear();
  groupPruneInProgress.clear();
  groupPruneDetails.clear(); // 清除剔品详情
  renderGroupList();
  updateStats();
  updateLegends();
  if(typeof setRawDataRows === 'function'){
    try{ setRawDataRows([]); }catch(err){ console.warn('reset table failed', err); }
  }
  if(typeof syncMergePanelStats === 'function'){
    try{ syncMergePanelStats(null); }catch(err){ console.warn('reset merge stats failed', err); }
  }
  if(typeof syncGraphStats === 'function'){
    try{ syncGraphStats(null); }catch(err){ console.warn('reset graph stats failed', err); }
  }
  if(typeof resetMergeControlSettings === 'function'){
    try{ resetMergeControlSettings(); }catch(err){ console.warn('reset merge controls failed', err); }
  }
  triggerMergeGraphRefresh({ keepPositions:false, fit:false });
}
