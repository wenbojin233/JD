/* --------- 运行态变量 --------- */
let network, nodesDS, edgesDS;
let mergeNetwork, mergeNodesDS, mergeEdgesDS;
const MERGE_NODE_LIMIT = 520;
const MERGE_EDGE_LIMIT = 720;
const MERGE_DRAG_LIMIT = 360;
let mergeNodeLimitSetting = MERGE_NODE_LIMIT;
let mergeEdgeLimitSetting = MERGE_EDGE_LIMIT;
let mergeDragLimitSetting = MERGE_DRAG_LIMIT;
const DEFAULT_SHEET_NAME = '同品关系';
let mergeInitialFitDone = false;
let mergeDragState=null;
let mergeDragUpdateScheduled=false;
let mergeDragLatestEvent=null;
let fullSummary=null;
const expandedState = new Map();
let DEGREE_CAP=0, DEGREE_MAX=0, GROUP_CAP=0, GROUP_MAX=0, GROUP_CAP_ALL=0, GROUP_CAP_NOSINGLES=0;
let EDGES_PER_COMP=new Map();
const GROUP_LABEL_LIMIT=300;
const FULL_NODE_LIMIT=1200;
let edgeDeleteBtn=null;
let hoveredEdgeId=null;
let edgeDeleteHideTimer=null;
let edgeDeleteTrack=null;
let edgeDeleteRaf=null;
let networkContainer=null;
const mergeDeletedEdges=new Set();
let mergeEdgeDeleteBtn=null;
let mergeHoveredEdgeId=null;
let mergeEdgeDeleteHideTimer=null;
let mergeEdgeDeleteTrack=null;
let mergeEdgeDeleteRaf=null;
let mergeNetworkContainer=null;

let explodeQueue=[]; let exploding=false; let paused=false;
let currentGroup=null; // 用于 ETA/进度
let firstBatchDoneForCid=new Set(); // 防“空屏”
let deletedNodes=new Set(); let deletedEdges=new Set(); const undoStack=[];
let MT_ctx={ parsed:false, comps:null, compOf:null, edgesGlobal:null, nameOf:null, adj:null, edgesByComp:null, reasons:null };
if(typeof globalThis!=='undefined'){ globalThis.MT_ctx = MT_ctx; }

const VIEW_GRAPH='graph';
const VIEW_MERGE='merge';
let activeView=VIEW_GRAPH;
let mergeGraphCache={ groups:[], stats:{ components:0, victims:0, edges:0, nodes:0 } };

function readCssVar(name, fallback){
  try{
    const styles = getComputedStyle(document.body || document.documentElement);
    const val = styles.getPropertyValue(name);
    return (val && val.trim()) || fallback;
  }catch(err){
    return fallback;
  }
}

function preferredSheetName(){
  const fileInput = document.getElementById('file');
  if(fileInput){
    const datasetSheet = fileInput.dataset?.sheetPreferred || fileInput.dataset?.sheet;
    if(datasetSheet && datasetSheet.trim()) return datasetSheet.trim();
    const attr = fileInput.getAttribute('data-preferred-sheet');
    if(attr && attr.trim()) return attr.trim();
  }
  return DEFAULT_SHEET_NAME;
}



const viewTabButtons = Array.from(document.querySelectorAll('.view-tab'));
const graphViewPane = document.getElementById('graphViewPane');
const mergeViewPane = document.getElementById('mergeViewPane');
const graphTablePane = document.getElementById('graphTablePane');
const mergeTablePane = document.getElementById('mergeTablePane');
const mergeHintEl = document.getElementById('mergeHint');
const graphStatsBar = document.getElementById('graphStatsBar');
const graphStatsElements = {
  nodes: document.getElementById('graphStatNodes'),
  edges: document.getElementById('graphStatEdges'),
  components: document.getElementById('graphStatComponents'),
  maxGroup: document.getElementById('graphStatMaxGroup')
};
const graphControlPanelEl = document.getElementById('graphControlPanel');
const mergeControlPanelEl = document.getElementById('mergeControlPanel');
const mergePanelHintEl = document.getElementById('mergePanelHint');
const mergeStatsBar = document.getElementById('mergeStatsBar');
const mergePanelStats = {
  components: document.getElementById('mergeStatComponents'),
  victims: document.getElementById('mergeStatVictims'),
  edges: document.getElementById('mergeStatEdges'),
  nodes: document.getElementById('mergeStatNodes')
};
const historyToggle = document.getElementById('historyToggle');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const historyConfirm = document.getElementById('historyConfirm');
const historyConfirmDesc = document.getElementById('historyConfirmDesc');
const historyConfirmAccept = document.getElementById('historyConfirmAccept');
const historyConfirmCancel = document.getElementById('historyConfirmCancel');
const mergeSearchInput = document.getElementById('mergeSearch');
const mergeLocateBtn = document.getElementById('mergeLocate');
const mergeRefreshStatsBtn = document.getElementById('mergeRefreshStats');
const mergeResetBtn = document.getElementById('mergeResetBtn');
const mergeExportPngBtn = document.getElementById('mergeExportPng');
const mergeNodeLimitInput = document.getElementById('mergeNodeLimit');
const mergeNodeLimitLabel = document.getElementById('mergeNodeLimitLabel');
const mergeEdgeLimitInput = document.getElementById('mergeEdgeLimit');
const mergeEdgeLimitLabel = document.getElementById('mergeEdgeLimitLabel');
const mergeDragLimitInput = document.getElementById('mergeDragLimit');
const mergeDragLimitLabel = document.getElementById('mergeDragLimitLabel');
const keeperButtons = Array.from(document.querySelectorAll('.keeper-btn'));
const scoreDropdownToggle=document.getElementById('scoreDropdownToggle');
const scoreDropdownMenu=document.getElementById('scoreDropdownMenu');
const scoreDropdownCustom=document.getElementById('scoreDropdownCustom');
const scoreDropdownApply=document.getElementById('scoreDropdownApply');
let pendingMergeLocate=null;
let pendingHistoryRecord=null;
let currentScoreValue='100';
function requestPendingMergeLocate(code,{ fallbackToGraph=false }={}){
  if(!code){
    pendingMergeLocate=null;
    return;
  }
  pendingMergeLocate={
    code:String(code).trim(),
    attempts:0,
    fallback:fallbackToGraph
  };
  processPendingMergeLocate();
}
function processPendingMergeLocate(){
  if(!pendingMergeLocate) return;
  if(activeView!==VIEW_MERGE){
    setTimeout(processPendingMergeLocate, 200);
    return;
  }
  const target=pendingMergeLocate.code;
  if(!target){
    pendingMergeLocate=null;
    return;
  }
  const success = typeof focusMergeNode==='function' ? focusMergeNode(target,{ center:true, select:true }) : false;
  if(success){
    try{ if(typeof highlightRawTableRow==='function'){ highlightRawTableRow(target,{ scroll:true, view:'merge' }); } }
    catch(err){}
    pendingMergeLocate=null;
    return;
  }
  if(pendingMergeLocate.attempts>=5){
    const fallback=pendingMergeLocate.fallback;
    pendingMergeLocate=null;
    if(fallback && typeof focusGraphNode==='function'){
      const ok=focusGraphNode(target,{ center:true, select:true });
      if(ok){
        try{ if(typeof highlightRawTableRow==='function'){ highlightRawTableRow(target,{ scroll:true, view:'graph' }); } }
        catch(err){}
        return;
      }
    }
    alert(`吞并视图中未找到节点 ${target}，请确认已有吞并记录。`);
    return;
  }
  pendingMergeLocate.attempts++;
  setTimeout(processPendingMergeLocate, 220);
}
if(typeof window!=='undefined'){ window.requestPendingMergeLocate = requestPendingMergeLocate; }

function syncGraphStats(summary){
  const totals={
    nodes:Number(summary?.totalNodes)||0,
    edges:Number(summary?.totalEdges)||0,
    components:Array.isArray(summary?.comps)? summary.comps.length : Number(summary?.totalComponents)||0,
    maxGroup:Array.isArray(summary?.comps) && summary.comps.length ? Math.max(...summary.comps.map(c=>c.size||0)) : 0
  };
  Object.entries(graphStatsElements).forEach(([key,el])=>{
    if(!el) return;
    el.textContent = totals[key] ?? 0;
  });
}
syncGraphStats(null);
if(typeof window!=='undefined'){ window.syncGraphStats = syncGraphStats; }

function syncMergePanelStats(stats, renderedCount){
  const safe=(val)=> Number.isFinite(val)? val : 0;
  const resolved={
    components:safe(stats?.components),
    victims:safe(stats?.victims),
    edges:safe(stats?.edges),
    nodes:safe(renderedCount ?? stats?.nodes)
  };
  Object.entries(mergePanelStats).forEach(([key,el])=>{
    if(!el) return;
    el.textContent = resolved[key] ?? 0;
  });
  if(mergePanelHintEl){
    if(resolved.edges>0 || resolved.victims>0){
      mergePanelHintEl.textContent = `共 ${resolved.components} 个组件 · 吞并 ${resolved.victims} 个节点 · ${resolved.edges} 条关系，当前展示 ${resolved.nodes} 个节点`;
    }else{
      mergePanelHintEl.textContent = '暂无吞并记录，执行“究极剔品”或“AI 聚品”后查看。';
    }
  }
}
syncMergePanelStats(null);
if(typeof window!=='undefined'){ window.syncMergePanelStats = syncMergePanelStats; }

viewTabButtons.forEach(btn=>{
  const target = btn?.getAttribute?.('data-view-target');
  if(target===VIEW_GRAPH){ btn.setAttribute('aria-controls','graphViewPane'); }
  if(target===VIEW_MERGE){ btn.setAttribute('aria-controls','mergeViewPane'); }
  btn.addEventListener('click', ()=>{
    if(target){ setActiveView(target); }
  });
});

/* --------- 吞并视图：工具与渲染 --------- */
function stripNodePrefix(id){
  if(id===null || id===undefined) return '';
  const text = String(id);
  return text.startsWith('N:') ? text.slice(2) : text;
}

function getMergePalette(){
  const root = document.body || document.documentElement;
  let styles=null;
  try{ styles = root ? getComputedStyle(root) : null; }catch(err){ styles=null; }
  const read=(prop, fallback)=>{
    if(!styles) return fallback;
    const val = styles.getPropertyValue(prop);
    return (val && val.trim()) || fallback;
  };
  return {
    survivor:{ background:read('--merge-survivor','#34d399'), border:read('--merge-survivor-border','#065f46') },
    middle:{ background:read('--merge-middle','#f59e0b'), border:read('--merge-middle-border','#92400e') },
    victim:{ background:read('--merge-victim','#ef4444'), border:read('--merge-victim-border','#7f1d1d') },
    edge:read('--merge-edge','#94a3b8'),
    font:read('--merge-font','#f8fafc')
  };
}

function computeMergeCenters(count){
  if(count<=0) return [];
  const cols=Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows=Math.ceil(count/cols);
  const spacing=360;
  const centers=[];
  for(let idx=0; idx<count; idx++){
    const row=Math.floor(idx/cols);
    const col=idx%cols;
    const offsetX=(col - (cols-1)/2)*spacing;
    const offsetY=(row - (rows-1)/2)*spacing;
    centers.push({ x:offsetX, y:offsetY });
  }
  return centers;
}

function resolveNodeName(nodeId, cid){
  const plain = stripNodePrefix(nodeId);
  if(!plain) return '';
  const cidKey = String(cid ?? '');
  if(cidKey){
    const st = expandedState.get(cidKey);
    if(st?.names && st.names[plain]) return String(st.names[plain]).trim();
  }
  try{
    const detailsMap = (typeof globalThis!=='undefined') ? globalThis.groupPruneDetails : undefined;
    if(detailsMap instanceof Map){
      const list = detailsMap.get(String(cid ?? ''));
      if(Array.isArray(list)){
        for(const item of list){
          if(item?.nodeId === plain && item?.nodeName){ return String(item.nodeName).trim(); }
          const neighbor = (item?.neighbors||[]).find(n=>String(n?.id)===plain);
          if(neighbor?.name) return String(neighbor.name).trim();
        }
      }
    }
  }catch(err){ /* ignore */ }
  try{
    if(MT_ctx?.nameOf?.get){
      const nm = MT_ctx.nameOf.get(plain);
      if(nm) return String(nm).trim();
    }
  }catch(err){ /* ignore */ }
  return '';
}

function formatNodeLabel(id, name, extra){
  const textId = String(id ?? '');
  const lines=[textId];
  if(name){
    const trimmed = name.length>18 ? name.slice(0,17)+'…' : name;
    lines.push(trimmed);
  }
  if(extra){
    lines.push(extra);
  }
  return lines.join('\n');
}

function buildMergeGraphData(){
  const records = (typeof globalThis!=='undefined' && globalThis.groupPruneRecords instanceof Map)
    ? globalThis.groupPruneRecords : null;
  const groups=[];
  let totalNodes=0, totalVictims=0, totalEdges=0;
  if(records){
    for(const [cidKey, entries] of records.entries()){
      if(!Array.isArray(entries) || !entries.length) continue;
      const victims=new Set();
      const victimParentRaw=new Map();
      for(const entry of entries){
        const victim = stripNodePrefix(entry?.node?.id);
        if(!victim) continue;
        victims.add(victim);
        const merger = stripNodePrefix(entry?.mergedBy);
        if(merger){ victimParentRaw.set(victim, merger); }
      }
      if(victims.size===0 && victimParentRaw.size===0) continue;

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

      const edgesLocal=[];
      const survivorsSet=new Set();
      victims.forEach(victim=>{
        const finalMerger=resolveFinalMerger(victimParentRaw.get(victim));
        if(finalMerger && finalMerger!==victim){
          edgesLocal.push({ from:finalMerger, to:victim });
          survivorsSet.add(finalMerger);
        }
      });
      const survivors=Array.from(survivorsSet).filter(id=>!victims.has(id));
      const victimsOnly=Array.from(victims);
      const nodeSet=new Set([...survivors,...victimsOnly]);
      totalNodes += nodeSet.size;
      totalVictims += victims.size;
      totalEdges += edgesLocal.length;

      const childrenMap=new Map();
      edgesLocal.forEach(edge=>{
        if(!childrenMap.has(edge.from)) childrenMap.set(edge.from, new Set());
        childrenMap.get(edge.from).add(edge.to);
      });
      nodeSet.forEach(id=>{
        if(!childrenMap.has(id)) childrenMap.set(id, new Set());
      });

      const childrenObj={};
      childrenMap.forEach((set,id)=>{ childrenObj[id]=Array.from(set).sort(); });

      groups.push({
        cid:String(cidKey),
        nodes:Array.from(nodeSet),
        survivors,
        victims:victimsOnly,
        edges:edgesLocal,
        chain:{ children:childrenObj }
      });
    }
  }
  return { groups, stats:{ components:groups.length, victims:totalVictims, edges:totalEdges, nodes:totalNodes } };
}

function sampleArray(arr, limit){
  if(!Array.isArray(arr) || arr.length<=limit) return arr.slice();
  const step=arr.length/limit;
  const out=[];
  for(let i=0;i<limit;i++){
    out.push(arr[Math.floor(i*step)]);
  }
  return out;
}

function selectMergeNodeIds(group, limit){
  const nodes=Array.isArray(group?.nodes)?group.nodes.slice():[];
  if(!limit || limit<=0) return [];
  if(nodes.length<=limit) return nodes;
  const nodeSet=new Set(nodes);
  const survivors=Array.isArray(group?.survivors)?group.survivors.filter(id=>nodeSet.has(id)):[];
  const survivorSet=new Set(survivors);
  const children=group?.chain?.children || {};
  const connectors=nodes.filter(id=>!survivorSet.has(id) && Array.isArray(children[id]) && children[id].length>0);
  const connectorSet=new Set(connectors);
  const remainder=nodes.filter(id=>!survivorSet.has(id) && !connectorSet.has(id));
  const result=[];
  const seen=new Set();
  const takeFrom=(list,count)=>{
    if(count<=0 || !Array.isArray(list) || !list.length) return 0;
    const filtered=list.filter(id=>id && !seen.has(id));
    if(!filtered.length) return 0;
    if(filtered.length<=count){
      filtered.forEach(id=>{ seen.add(id); result.push(id); });
      return filtered.length;
    }
    const sampled=sampleArray(filtered,count);
    sampled.forEach(id=>{ seen.add(id); result.push(id); });
    return sampled.length;
  };
  let remaining=limit;
  remaining-=takeFrom(survivors, remaining);
  remaining-=takeFrom(connectors, remaining);
  if(remaining>0){
    remaining-=takeFrom(remainder, remaining);
  }
  if(remaining>0){
    const leftovers=nodes.filter(id=>id && !seen.has(id));
    takeFrom(leftovers, remaining);
  }
  return result.slice(0, limit);
}

function selectMergeEdges(edges, allowedSet, limit){
  if(!limit || limit<=0) return [];
  const valid=Array.isArray(edges)?edges.filter(edge=>edge && allowedSet && allowedSet.has(edge.from) && allowedSet.has(edge.to)):[];
  if(valid.length<=limit) return valid;
  const primary=[];
  const secondary=[];
  const seenSources=new Set();
  valid.forEach(edge=>{
    if(!edge) return;
    if(!seenSources.has(edge.from)){
      seenSources.add(edge.from);
      primary.push(edge);
    }else{
      secondary.push(edge);
    }
  });
  if(primary.length>=limit){
    return primary.slice(0, limit);
  }
  const remaining=limit-primary.length;
  const sampled=sampleArray(secondary, remaining);
  return primary.concat(sampled).slice(0, limit);
}

function applyMergeGraphData(data,{ keepPositions=true, fit=false }={}){
  if(!mergeNodesDS || !mergeEdgesDS){ return; }
  mergeDragState=null;
  const palette = getMergePalette();
  const fontColor = palette.font || '#f8fafc';
  const fontFace="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif";
  const stats = data?.stats || {};
  const totalNodes = Number(stats.nodes)||0;
  const totalEdges = Number(stats.edges)||0;
  const nodeLimitValue = Number.isFinite(mergeNodeLimitSetting) && mergeNodeLimitSetting>0 ? mergeNodeLimitSetting : MERGE_NODE_LIMIT;
  const edgeLimitValue = Number.isFinite(mergeEdgeLimitSetting) && mergeEdgeLimitSetting>0 ? mergeEdgeLimitSetting : MERGE_EDGE_LIMIT;
  const nodeLimit = Number.isFinite(nodeLimitValue) && nodeLimitValue>0 ? nodeLimitValue : Infinity;
  const edgeLimit = Number.isFinite(edgeLimitValue) && edgeLimitValue>0 ? edgeLimitValue : Infinity;
  const throttleNodes = Number.isFinite(nodeLimit) && totalNodes>nodeLimit;
  const throttleEdges = Number.isFinite(edgeLimit) && totalEdges>edgeLimit;
  const previousPositions = (keepPositions && mergeNetwork && typeof mergeNetwork.getPositions==='function')
    ? mergeNetwork.getPositions(mergeNodesDS.getIds()) : {};
  mergeNodesDS.clear();
  mergeEdgesDS.clear();

  const groups = Array.isArray(data?.groups) ? data.groups : [];
  let nodeBudget = nodeLimit;
  let edgeBudget = edgeLimit;
  const renderPlan=[];
  let nodesTruncated=false;
  let edgesTruncated=false;
  for(let idx=0; idx<groups.length; idx++){
    const group=groups[idx];
    if(!group) continue;
    if(Number.isFinite(nodeLimit) && nodeBudget<=0) break;
    if(Number.isFinite(edgeLimit) && edgeBudget<=0) break;
    const groupNodes=Array.isArray(group.nodes)?group.nodes:[];
    if(!groupNodes.length) continue;

    const groupsRemaining = groups.length - idx;
    const nodeShare = throttleNodes ? Math.max(12, Math.floor(nodeBudget / groupsRemaining) || nodeBudget) : nodeBudget;
    const nodeCap = Math.min(groupNodes.length, nodeShare, nodeBudget);
    if(nodeCap<=0) continue;
    const selectedNodeIds = selectMergeNodeIds(group, nodeCap);
    if(!selectedNodeIds.length) continue;
    if(selectedNodeIds.length < groupNodes.length){
      nodesTruncated = true;
    }
    nodeBudget -= selectedNodeIds.length;
    const nodeSet = new Set(selectedNodeIds);

    const groupEdges = Array.isArray(group.edges) ? group.edges : [];
    const filteredEdges = groupEdges.filter(edge=>edge && nodeSet.has(edge.from) && nodeSet.has(edge.to));
    let edgeCap = filteredEdges.length;
    if(filteredEdges.length){
      if(throttleEdges){
        const groupsRemainingForEdges = groups.length - idx;
        const fairShare = Math.max(18, Math.floor(edgeBudget / groupsRemainingForEdges) || edgeBudget);
        edgeCap = Math.min(edgeCap, fairShare, edgeBudget);
      }else{
        edgeCap = Math.min(edgeCap, edgeBudget);
      }
    }else{
      edgeCap = 0;
    }
    const selectedEdges = selectMergeEdges(filteredEdges, nodeSet, edgeCap);
    if(selectedEdges.length < filteredEdges.length){
      edgesTruncated = true;
    }
    edgeBudget -= selectedEdges.length;

    renderPlan.push({ group, nodeIds:selectedNodeIds, edges:selectedEdges });
  }

  const centers = computeMergeCenters(renderPlan.length);
  const nodesPayload=[];
  const edgesPayload=[];
  renderPlan.forEach((item, idx)=>{
    const center = centers[idx] || { x:0, y:0 };
    const survivorSet=new Set(item.group?.survivors || []);
    const victimSet=new Set(item.group?.victims || []);
    const chain=item.group?.chain || {};
    const childrenMap = chain.children || {};
    const nodesInGroup = item.nodeIds.length || 1;
    const ringSize = Math.max(6, Math.ceil(Math.sqrt(nodesInGroup)));
    item.nodeIds.forEach((nodeId, nodeIdx)=>{
      const visId=`M:${item.group.cid}:${nodeId}`;
      const prev=previousPositions?.[visId];
      const directCount = Array.isArray(childrenMap[nodeId]) ? childrenMap[nodeId].length : 0;
      const infoLine = directCount>0 ? `吞并 ${directCount} 个` : null;
      const name=resolveNodeName(nodeId, item.group.cid);
      let role='victim';
      if(survivorSet.has(nodeId)) role='survivor';
      else if(victimSet.has(nodeId)) role='victim';
      const titleParts=[`组件 ${item.group.cid}`, nodeId];
      if(name) titleParts.push(name);
      const nodeData={
        id:visId,
        label:formatNodeLabel(nodeId, name, infoLine),
        title: titleParts.join(' · '),
        shape:'dot',
        size: role==='survivor'?12: role==='middle'?10:9,
        color:{ background:palette[role]?.background||'#64748b', border:palette[role]?.border||'#1f2937' },
        font:{ color:fontColor, size:12, face:fontFace, multi:true },
        cid:item.group.cid,
        rawId:nodeId,
        role,
        direct:directCount
      };
      if(prev && keepPositions){
        if(Number.isFinite(prev.x)) nodeData.x=prev.x;
        if(Number.isFinite(prev.y)) nodeData.y=prev.y;
      }else if(!keepPositions){
        const ringIndex = Math.floor(nodeIdx / ringSize);
        const angle = (nodeIdx % ringSize) / ringSize * Math.PI * 2;
        const layerRadius = 46 + ringIndex*32 + Math.min(40, nodesInGroup*1.2);
        nodeData.x = center.x + Math.cos(angle)*layerRadius;
        nodeData.y = center.y + Math.sin(angle)*layerRadius;
      }
      nodesPayload.push(nodeData);
    });
    let localEdgeIdx=0;
    item.edges.forEach(edgeLocal=>{
      if(isMergeEdgeDeleted(item.group.cid, edgeLocal.from, edgeLocal.to)) return;
      const fromId=`M:${item.group.cid}:${edgeLocal.from}`;
      const toId=`M:${item.group.cid}:${edgeLocal.to}`;
      const fromName=resolveNodeName(edgeLocal.from, item.group.cid);
      const toName=resolveNodeName(edgeLocal.to, item.group.cid);
      const fromText=[stripNodePrefix(edgeLocal.from), fromName].filter(Boolean).join(' · ');
      const toText=[stripNodePrefix(edgeLocal.to), toName].filter(Boolean).join(' · ');
      edgesPayload.push({
        id:`ME:${item.group.cid}:${localEdgeIdx++}`,
        from:fromId,
        to:toId,
        arrows:{ to:{ enabled:true, scaleFactor:0.65 } },
        color:{ color:palette.edge||'#94a3b8', highlight:palette.edge||'#94a3b8' },
        width:1,
        smooth:false,
        title: `组件 ${item.group.cid} · ${fromText} → ${toText}`
      });
    });
  });

  if(nodesPayload.length){
    mergeNodesDS.add(nodesPayload);
  }
  if(edgesPayload.length){
    mergeEdgesDS.add(edgesPayload);
  }
  syncMergePanelStats(data?.stats || null, nodesPayload.length);

  if(mergeHintEl){
    if(totalNodes===0){
      mergeHintEl.textContent='暂无吞并记录，执行“剔品推荐”后查看。';
    }else{
      let hint=`共 ${stats.components||0} 个组件 · ${stats.victims||0} 个被吞节点 · ${stats.edges||0} 条吞并关系`;
      const perfParts=[];
      if(nodesTruncated || (Number.isFinite(nodeLimit) && totalNodes>nodeLimit)){
        perfParts.push(`节点 ${nodesPayload.length}/${totalNodes}`);
      }
      if(edgesTruncated || (Number.isFinite(edgeLimit) && totalEdges>edgeLimit)){
        perfParts.push(`关系 ${edgesPayload.length}/${totalEdges}`);
      }
      if(perfParts.length){
        hint += ` · 当前显示 ${perfParts.join('，')}（为保证性能仅展示部分数据）`;
      }else{
        hint += ' · 点击节点查看吞并链';
      }
      mergeHintEl.textContent=hint;
    }
  }

  if(mergeNetwork){
    mergeNetwork.redraw();
    const shouldFit = fit || (!keepPositions && nodesPayload.length>0);
    if(shouldFit){
      requestAnimationFrame(()=>{
        try{ mergeNetwork.fit({ animation:{ duration:380, easingFunction:'easeInOutQuad' } }); }catch(err){ /* ignore */ }
      });
    }
    kickMergeSimulation();
  }
  processPendingMergeLocate();
}

function kickMergeSimulation(){
  if(!mergeNetwork) return;
  try{
    if(typeof mergeNetwork.stopSimulation === 'function'){ mergeNetwork.stopSimulation(); }
    if(typeof mergeNetwork.startSimulation === 'function'){ mergeNetwork.startSimulation(); }
  }catch(err){ /* ignore */ }
}

function mergePhysicsProfile(){
  const base = typeof physicsProfile === 'function' ? physicsProfile() : null;
  if(base && base.solver==='forceAtlas2Based'){
    return {
      solver:'forceAtlas2Based',
      forceAtlas2Based:Object.assign({
        damping:0.4,
        avoidOverlap:0.8
      }, base.fa2 || {}),
      minVelocity:Math.max(0.08, (base.minVelocity||0.2)*0.75)
    };
  }
  if(base && base.solver==='barnesHut'){
    return {
      solver:'barnesHut',
      barnesHut:Object.assign({
        avoidOverlap:0.95,
        damping:0.3
      }, base.bh || {}),
      minVelocity:Math.max(0.06, (base.minVelocity||0.15)*0.7)
    };
  }
  return {
    solver:'forceAtlas2Based',
    forceAtlas2Based:{
      gravitationalConstant:-38,
      centralGravity:0.02,
      springLength:130,
      springConstant:0.05,
      damping:0.42,
      avoidOverlap:0.85
    },
    minVelocity:0.12
  };
}

function applyMergePhysics(){
  if(!mergeNetwork) return;
  const profile = mergePhysicsProfile();
  if(profile.solver==='forceAtlas2Based'){
    mergeNetwork.setOptions({
      physics:{
        enabled:true,
        solver:'forceAtlas2Based',
        forceAtlas2Based:profile.forceAtlas2Based,
        stabilization:{ enabled:false },
        minVelocity:profile.minVelocity
      }
    });
  }else{
    mergeNetwork.setOptions({
      physics:{
        enabled:true,
        solver:'barnesHut',
        barnesHut:profile.barnesHut,
        stabilization:{ enabled:false },
        minVelocity:profile.minVelocity
      }
    });
  }
  mergeNetwork.setOptions({ interaction:{ dragView:true, dragNodes:true, zoomView:true, tooltipDelay:0, hover:true } });
  kickMergeSimulation();
}

function collectMergeDragFollowers(anchorId){
  if(!mergeNetwork || !anchorId) return [];
  const queue=[anchorId];
  const visited=new Set([anchorId]);
  const followers=[];
  const limit = Number.isFinite(mergeDragLimitSetting) && mergeDragLimitSetting>0 ? mergeDragLimitSetting : MERGE_DRAG_LIMIT;
  while(queue.length && followers.length<limit){
    const current=queue.shift();
    const neighbors = mergeNetwork.getConnectedNodes(current) || [];
    for(const nb of neighbors){
      if(visited.has(nb)) continue;
      visited.add(nb);
      followers.push(nb);
      if(followers.length>=limit) break;
      queue.push(nb);
    }
  }
  return followers;
}

function handleMergeDragStart(params){
  if(!mergeNodesDS || !params?.nodes?.length) return;
  const anchor=params.nodes[0];
  mergeDragState=null;
  const followers = collectMergeDragFollowers(anchor);
  if(!followers.length) return;
  const ids=[anchor, ...followers];
  const positions = mergeNetwork?.getPositions?.(ids);
  const anchorPos = positions?.[anchor];
  if(!anchorPos) return;
  const offsets=new Map();
  followers.forEach(id=>{
    const pos=positions?.[id];
    if(!pos) return;
    offsets.set(id,{ dx:pos.x-anchorPos.x, dy:pos.y-anchorPos.y });
  });
  if(!offsets.size) return;
  mergeDragState={ anchor, followers:Array.from(offsets.keys()), offsets };
  mergeNodesDS.update(mergeDragState.followers.map(id=>({ id, fixed:{ x:true, y:true } })));
}

function handleMergeDragging(params){
  if(!mergeDragState || !mergeNodesDS) return;
  mergeDragLatestEvent = params;
  if(mergeDragUpdateScheduled) return;
  mergeDragUpdateScheduled=true;
  requestAnimationFrame(processMergeDragUpdate);
}

function handleMergeDragEnd(){
  if(!mergeDragState || !mergeNodesDS) return;
  if(Array.isArray(mergeDragState.followers) && mergeDragState.followers.length){
    mergeNodesDS.update(mergeDragState.followers.map(id=>({ id, fixed:{ x:false, y:false } })));
  }
  mergeDragState=null;
  mergeDragLatestEvent=null;
  mergeDragUpdateScheduled=false;
  kickMergeSimulation();
}

function processMergeDragUpdate(){
  mergeDragUpdateScheduled=false;
  const params=mergeDragLatestEvent;
  if(!mergeDragState || !mergeNodesDS || !params) return;
  const activeNodes = Array.isArray(params?.nodes) ? params.nodes : [];
  if(!activeNodes.includes(mergeDragState.anchor)) return;
  const anchorPos = mergeNetwork?.getPosition?.(mergeDragState.anchor);
  if(!anchorPos) return;
  const updates=[];
  mergeDragState.followers.forEach(id=>{
    const offset=mergeDragState.offsets.get(id);
    if(!offset) return;
    updates.push({ id, x:anchorPos.x + offset.dx, y:anchorPos.y + offset.dy });
  });
  if(updates.length){
    mergeNodesDS.update(updates);
  }
}

function parseMergeVisId(visId){
  if(!visId || typeof visId!=='string') return null;
  if(!visId.startsWith('M:')) return null;
  const parts=visId.split(':');
  if(parts.length<3) return null;
  return { cid:parts[1], nodeId:parts.slice(2).join(':') };
}

function formatMergeDisplay(id, cid){
  const plain = String(id ?? '');
  const name = resolveNodeName(id, cid);
  return name ? `${plain}（${name}）` : plain;
}

function escapeHtmlLite(value){
  return String(value ?? '').replace(/[&<>"']/g, ch=>{
    switch(ch){
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#39;';
      default: return ch;
    }
  });
}

function showMergeChainDialog(cid, nodeId, position){
  if(!mergeGraphCache) return;
  const group = mergeGraphCache.byCid?.get(String(cid))
    || (Array.isArray(mergeGraphCache.groups) ? mergeGraphCache.groups.find(g=>String(g.cid)===String(cid)) : null);
  if(!group) return;
  const chain = group.chain || {};
  const directChildren = Array.isArray(chain.children?.[nodeId]) ? chain.children[nodeId] : [];
  const metaParts=[];
  if(directChildren.length){
    metaParts.push(`直接吞并 ${directChildren.length} 个`);
  }else{
    metaParts.push('暂无直接吞并节点');
  }

  const directHtml = directChildren.length
    ? `<div class="merge-direct"><div class="merge-direct__title">直接吞并：</div><ul class="merge-direct__list">${directChildren.map(id=>`<li>${escapeHtmlLite(formatMergeDisplay(id, cid))}</li>`).join('')}</ul></div>`
    : '<div class="placeholder hint">没有下游吞并节点。</div>';
  const title = `吞并链 · ${formatMergeDisplay(nodeId, cid)}`;
  const meta = metaParts.join(' · ');
  const html = directHtml;
  if(typeof showMergeTooltip === 'function'){
    showMergeTooltip({ title, meta, html, position });
  }else{
    const fallback = `${title}\n${meta}`;
    alert(fallback);
  }
}

function handleMergeNodeClick(visId, position){
  const parsed = parseMergeVisId(visId);
  if(!parsed) return;
  showMergeChainDialog(parsed.cid, parsed.nodeId, position);
}

function exportMergeCSV(){
  try{
    const data = buildMergeGraphData();
    if(!data || !Array.isArray(data.groups) || !data.groups.length || data.stats.edges===0){
      alert('暂无吞并关系可导出');
      return;
    }
    const rows = [];
    const seenByCid = new Map();
    data.groups.forEach(group=>{
      const cid = String(group.cid);
      const seen = seenByCid.get(cid) || new Set();
      (group.edges||[]).forEach(edge=>{
        const mergerId = edge.from;
        const victimId = edge.to;
        const mergerName = resolveNodeName(mergerId, cid) || '';
        const victimName = resolveNodeName(victimId, cid) || '';
        rows.push([cid, mergerId, mergerName, victimId, victimName]);
        seen.add(mergerId);
      });
      seenByCid.set(cid, seen);
    });
    const currentNodes = nodesDS?.get?.({ filter:item=> item.id?.startsWith('N:') }) || [];
    currentNodes.forEach(node=>{
      const cid = componentIdOfNode?.(node.id) || null;
      if(!cid) return;
      const cidStr = String(cid);
      const rawId = node.id.slice(2);
      const seen = seenByCid.get(cidStr) || new Set();
      if(seen.has(rawId)) return;
      const name = resolveNodeName(rawId, cidStr) || '';
      rows.push([cidStr, rawId, name, '', '']);
      seen.add(rawId);
      seenByCid.set(cidStr, seen);
    });
    if(rows.length===0){
      alert('暂无吞并关系可导出');
      return;
    }
    rows.sort((a,b)=> a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]) || a[0].localeCompare(b[0]));
    const header = ['序号','吞并者ID','吞并者名称','被吞者ID','被吞者名称'];
    let seq = 0;
    let prevMerger = null;
    const csvRows = [header, ...rows.map(cols=>{
      const mergerId = cols[1];
      if(mergerId !== prevMerger){
        seq += 1;
        prevMerger = mergerId;
      }
      return [seq, cols[1], cols[2], cols[3], cols[4]];
    })];
    const csv = csvRows.map(cols=> cols.map(val=>`"${String(val??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '吞并关系导出.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }catch(err){
    console.error('导出吞并 CSV 失败', err);
    alert('导出吞并关系 CSV 时发生错误');
  }
}

if(typeof window!=='undefined'){
  window.exportMergeCSV = exportMergeCSV;
}

function ensureMergeNetwork(){
  if(mergeNetwork || typeof vis==='undefined' || !vis?.Network) return;
  mergeNetworkContainer=document.getElementById('mergeNetwork');
  const container=mergeNetworkContainer;
  if(!container) return;
  mergeNodesDS=new vis.DataSet([]);
  mergeEdgesDS=new vis.DataSet([]);
  if(mergeNodesDS?.setOptions){ mergeNodesDS.setOptions({ queue:{ delay:20, max:2000 } }); }
  if(mergeEdgesDS?.setOptions){ mergeEdgesDS.setOptions({ queue:{ delay:20, max:2000 } }); }
  const palette=getMergePalette();
  const fontFace="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif";
  mergeNetwork=new vis.Network(container,{ nodes:mergeNodesDS, edges:mergeEdgesDS },{
    layout:{ improvedLayout:false },
    physics:{
      enabled:true,
      solver:'forceAtlas2Based',
      forceAtlas2Based:{ gravitationalConstant:-32, centralGravity:0.02, springLength:120, springConstant:0.045, damping:0.38, avoidOverlap:0.8 },
      stabilization:{ enabled:false },
      minVelocity:0.16
    },
    nodes:{ shape:'dot', size:9, font:{ color:palette.font||'#0f172a', size:12, face:fontFace }, borderWidth:1 },
    edges:{ color:{ color:palette.edge||'#94a3b8', highlight:palette.edge||'#94a3b8' }, smooth:false, width:1 },
    interaction:{ hover:true, tooltipDelay:0, zoomView:true, dragNodes:true, dragView:true }
  });
  applyMergePhysics();
  applyMergeGraphData(mergeGraphCache,{ keepPositions:false, fit:false });
  mergeNetwork.on('click',(params)=>{
    if(params?.nodes?.length){
      const parsed=parseMergeVisId(params.nodes[0]);
      if(parsed?.nodeId && typeof highlightRawTableRow==='function'){
        const code=stripNodePrefix(parsed.nodeId);
        highlightRawTableRow(code, { scroll:true, view:'merge' });
      }
      const rect = container.getBoundingClientRect();
      const domPos = params.pointer?.DOM || {};
      const pos={ x: rect.left + (domPos.x ?? 0), y: rect.top + (domPos.y ?? 0) };
      handleMergeNodeClick(params.nodes[0], pos);
    }else if(typeof hideTip === 'function'){
      hideTip();
    }
  });
  mergeNetwork.on('dragStart', handleMergeDragStart);
  mergeNetwork.on('dragging', handleMergeDragging);
  mergeNetwork.on('dragEnd', handleMergeDragEnd);
  mergeNetwork.on('hoverEdge',(params)=> showMergeEdgeDeleteButton(params.edge));
  mergeNetwork.on('blurEdge',()=> hideMergeEdgeDeleteButton());
  mergeNetwork.on('zoom',()=> hideMergeEdgeDeleteButton(true));
  mergeNetwork.on('dragStart',()=> hideMergeEdgeDeleteButton(true));
  mergeNetwork.on('dragEnd',()=> hideMergeEdgeDeleteButton(true));
}

function refreshVisTheme(){
  const graphFont = readCssVar('--graph-node-font','#e5e7eb');
  if(network){
    network.setOptions({ nodes:{ font:{ color:graphFont } } });
  }
  if(mergeNetwork){
    const mergeFont = readCssVar('--merge-font','#f8fafc');
    mergeNetwork.setOptions({ nodes:{ font:{ color:mergeFont } } });
    if(mergeNodesDS){
      const nodes = mergeNodesDS.get();
      if(Array.isArray(nodes) && nodes.length){
        mergeNodesDS.update(nodes.map(node=>({
          id:node.id,
          font:Object.assign({}, node.font, { color:mergeFont })
        })));
      }
    }
  }
}
if(typeof globalThis!=='undefined'){ globalThis.refreshVisTheme = refreshVisTheme; }

function toggleControlPanelCard(el, active){
  if(!el) return;
  if(active){
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden','false');
  }else{
    el.setAttribute('hidden','');
    el.setAttribute('aria-hidden','true');
  }
}

function toggleGraphStatsBar(active){
  if(!graphStatsBar) return;
  graphStatsBar.setAttribute('aria-hidden', active? 'false':'true');
}

function toggleMergeStatsBar(active){
  if(!mergeStatsBar) return;
  mergeStatsBar.setAttribute('aria-hidden', active? 'false':'true');
}

function setActiveView(view, options){
  const opts=options||{};
  const skipMergeFit=!!opts.skipMergeFit;
  const target = view===VIEW_MERGE ? VIEW_MERGE : VIEW_GRAPH;
  const changed = activeView!==target;
  activeView=target;
  viewTabButtons.forEach(btn=>{
    const isActive = btn?.getAttribute?.('data-view-target')===target;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', isActive? 'true':'false');
    btn.setAttribute('aria-selected', isActive? 'true':'false');
    btn.setAttribute('tabindex', isActive? '0':'-1');
  });
  if(graphViewPane){
    if(target===VIEW_GRAPH){
      graphViewPane.classList.add('is-active');
      graphViewPane.removeAttribute('hidden');
      graphViewPane.setAttribute('aria-hidden','false');
    }else{
      graphViewPane.classList.remove('is-active');
      graphViewPane.setAttribute('hidden','');
      graphViewPane.setAttribute('aria-hidden','true');
    }
  }
  if(mergeViewPane){
    if(target===VIEW_MERGE){
      mergeViewPane.classList.add('is-active');
      mergeViewPane.removeAttribute('hidden');
      mergeViewPane.setAttribute('aria-hidden','false');
      ensureMergeNetwork();
      applyMergePhysics();
      if(changed){
        refreshMergeGraph({ keepPositions:true, fit:!skipMergeFit });
      }else{
        refreshMergeGraph({ keepPositions:true, fit:false });
      }
    }else{
      mergeViewPane.classList.remove('is-active');
      mergeViewPane.setAttribute('hidden','');
      mergeViewPane.setAttribute('aria-hidden','true');
    }
  }
  if(graphTablePane){
    if(target===VIEW_GRAPH){
      graphTablePane.classList.add('is-active');
      graphTablePane.removeAttribute('hidden');
      graphTablePane.setAttribute('aria-hidden','false');
    }else{
      graphTablePane.classList.remove('is-active');
      graphTablePane.setAttribute('hidden','');
      graphTablePane.setAttribute('aria-hidden','true');
    }
  }
  if(mergeTablePane){
    if(target===VIEW_MERGE){
      mergeTablePane.classList.add('is-active');
      mergeTablePane.removeAttribute('hidden');
      mergeTablePane.setAttribute('aria-hidden','false');
    }else{
      mergeTablePane.classList.remove('is-active');
      mergeTablePane.setAttribute('hidden','');
      mergeTablePane.setAttribute('aria-hidden','true');
    }
  }
  toggleControlPanelCard(graphControlPanelEl, target===VIEW_GRAPH);
  toggleControlPanelCard(mergeControlPanelEl, target===VIEW_MERGE);
  toggleGraphStatsBar(target===VIEW_GRAPH);
  toggleMergeStatsBar(target===VIEW_MERGE);
}

let mergeRefreshScheduled=false;

function refreshMergeGraph({ keepPositions=true, fit=false, defer=false }={}){
  const exec = ()=>{
    mergeRefreshScheduled=false;
    mergeGraphCache = buildMergeGraphData();
    syncMergePanelStats(mergeGraphCache?.stats || null);
    if(mergeGraphCache && Array.isArray(mergeGraphCache.groups)){
      try{
        mergeGraphCache.byCid = new Map(mergeGraphCache.groups.map(g=>[String(g.cid), g]));
      }catch(err){ mergeGraphCache.byCid = null; }
    }
    if(!mergeNodesDS || !mergeEdgesDS){
      return;
    }
    applyMergeGraphData(mergeGraphCache,{ keepPositions, fit });
  };
  if(defer){
    if(mergeRefreshScheduled) return;
    mergeRefreshScheduled=true;
    setTimeout(exec, 50);
  }else{
    exec();
  }
}

setActiveView(activeView);

/* --------- UI：扩散强度 & 展开速度 --------- */
const speedInput = document.getElementById('speed');
const speedLabel = document.getElementById('speedLabel');
const collapseBtn = document.getElementById('collapseAll');
const pauseBtn = document.getElementById('pause');
const explodeBtn = document.getElementById('explode');
const resetBtn = document.getElementById('reset');
const exportBtn = document.getElementById('export');
const ultimateBtn = document.getElementById('ultimatePrune');
const exportMergeBtn = document.getElementById('exportMergeCsv');
const speedText = ['柔和','较弱','标准','较强','更强'];
speedLabel.textContent = speedText[Number(speedInput.value)-1];
speedInput.addEventListener('input', ()=>{
  speedLabel.textContent = speedText[Number(speedInput.value)-1];
  applyPhysics();
  applyMergePhysics();
  if(exploding) updateETA();
});

const renderSpeed = document.getElementById('renderSpeed');
const renderSpeedLabel = document.getElementById('renderSpeedLabel');
const renderText = ['慢速','标准','快速','爆发'];
renderSpeedLabel.textContent = renderText[Number(renderSpeed.value)-1];
renderSpeed.addEventListener('input', ()=>{ renderSpeedLabel.textContent = renderText[Number(renderSpeed.value)-1]; if(exploding) updateETA(); });

function physicsProfile(){
  const s = Number(speedInput.value);
  const profiles = {
    1: { solver:'forceAtlas2Based', fa2:{ gravitationalConstant:-20, centralGravity:0.01, springLength:120, springConstant:0.04, damping:0.5 }, minVelocity:0.5 },
    2: { solver:'forceAtlas2Based', fa2:{ gravitationalConstant:-30, centralGravity:0.03, springLength:120, springConstant:0.05, damping:0.45 }, minVelocity:0.3 },
    3: { solver:'barnesHut',       bh:{ gravitationalConstant:-2600, centralGravity:0.22, springLength:115, springConstant:0.038, damping:0.34, avoidOverlap:0.55 }, minVelocity:0.25 },
    4: { solver:'barnesHut',       bh:{ gravitationalConstant:-4800, centralGravity:0.26, springLength:110, springConstant:0.045, damping:0.28, avoidOverlap:0.8 }, minVelocity:0.15 },
    5: { solver:'barnesHut',       bh:{ gravitationalConstant:-6800, centralGravity:0.27, springLength:100, springConstant:0.05,  damping:0.24, avoidOverlap:0.9 }, minVelocity:0.1 },
  };
  return profiles[s] || profiles[3];
}
function applyPhysics(){
  if(!network) return;
  const prof = physicsProfile();
  if(prof.solver==='forceAtlas2Based'){
    network.setOptions({ physics:{ enabled:true, solver:'forceAtlas2Based', forceAtlas2Based:prof.fa2, stabilization:{enabled:false}, minVelocity:prof.minVelocity },
                         interaction:{ dragView:true, dragNodes:true, zoomView:true, hover:true }});
  }else{
    network.setOptions({ physics:{ enabled:true, solver:'barnesHut', barnesHut:prof.bh, stabilization:{enabled:false}, minVelocity:prof.minVelocity },
                         interaction:{ dragView:true, dragNodes:true, zoomView:true, hover:true }});
  }
  if(pauseBtn){ pauseBtn.disabled=false; }
}
const setProgress=(p,txt)=>{
  const bar=document.getElementById('progBar');
  if(bar) bar.style.width=(p||0)+'%';
  if(txt){
    const hintEl=document.getElementById('hint');
    if(hintEl) hintEl.textContent=txt;
  }
};

/* --------- 小工具 --------- */
const lerp=(a,b,t)=>a+(b-a)*t;
const hex=(r,g,b)=>'#'+[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');
function heatClassic(t){
  t=Math.max(0,Math.min(1,t||0));
  if(t<0.6){ const u=t/0.6, c0=[0xc8,0xf5,0xff], c1=[0xff,0xd0,0x8a]; return hex(lerp(c0[0],c1[0],u),lerp(c0[1],c1[1],u),lerp(c0[2],c1[2],u)); }
  const u=(t-0.6)/0.4, c0=[0xff,0xd0,0x8a], c1=[0xb3,0x12,0x12]; return hex(lerp(c0[0],c1[0],u),lerp(c0[1],c1[1],u),lerp(c0[2],c1[2],u));
}
const normP95=(v,cap)=> cap<=0?0:Math.max(0,Math.min(1,v/cap));
const colorGroupBySize=(size)=> heatClassic(normP95(size, GROUP_CAP));
const colorNodeByDegree=(deg)=> heatClassic(normP95(deg, DEGREE_CAP));
const percentile=(values,q)=>{ if(!values.length) return 0; const a=values.slice().sort((x,y)=>x-y);
  const pos=(a.length-1)*q, b=Math.floor(pos), r=pos-b; return Math.round(a[b+1]!==undefined? a[b]+r*(a[b+1]-a[b]):a[b]); };

/* --------- 初始化网络 --------- */
function initNetwork(){
  nodesDS = new vis.DataSet([]); edgesDS = new vis.DataSet([]);
  if(nodesDS?.setOptions){ nodesDS.setOptions({ queue:{ delay:16, max:2000 } }); }
  if(edgesDS?.setOptions){ edgesDS.setOptions({ queue:{ delay:16, max:2000 } }); }
  networkContainer=document.getElementById('network');
  const container=networkContainer;
  const nodeFontColor = readCssVar('--graph-node-font','#e5e7eb');
  network = new vis.Network(container, { nodes:nodesDS, edges:edgesDS }, {
    layout:{ improvedLayout:false }, physics:{ enabled:false },
    nodes:{ shape:'dot', size:9, font:{ color:nodeFontColor, size:12, face:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif" }, borderWidth:1 },
    edges:{ smooth:false, color:{ color:'#2b354a', highlight:'#6b7280' }, width:1 },
    interaction:{ hover:false, tooltipDelay:0, zoomView:true, dragNodes:true, dragView:true }
  });

  network.on('doubleClick',(params)=>{
    if(params.nodes?.length){
      const nid=params.nodes[0];
      if(nid.startsWith('C:')){ expandComponent(nid.slice(2)); ensurePhysicsOn(); }
      else if(nid.startsWith('P:')){ const [_,cid,prefix]=nid.split(':'); expandPrefix(cid,prefix); ensurePhysicsOn(); }
      else if(nid.startsWith('N:')){ return; }
      else{ const cid=componentIdOfNode(nid); if(cid && expandedState.has(cid)) collapseComponent(cid); }
    }
  });

  network.on('click',(params)=>{
    if(params.nodes?.length){
      const nid=params.nodes[0]; if(nid.startsWith('N:')){
        const code=nid.slice(2); const rect=container.getBoundingClientRect(); pendingTipPos={ x: rect.left + params.pointer.DOM.x, y: rect.top + params.pointer.DOM.y };
        try{
          if(typeof highlightRawTableRow === 'function'){
            highlightRawTableRow(code, { scroll:true });
          }
        }catch(err){ /* ignore */ }
        try{ focusGraphNode(code, { center:false, select:false }); }catch(err){ /* ignore */ }
        if(useWorker && workerReady){ worker.postMessage({type:'neighbors', id:code}); }
        else{ showTip(neighborsMainThread(code)); }
      } else hideTip();
    } else hideTip();
  });

  network.on('hoverEdge',(params)=> showEdgeDeleteButton(params.edge));
  network.on('blurEdge',()=> hideEdgeDeleteButton());
  network.on('dragStart',()=> hideEdgeDeleteButton(true));
  network.on('dragEnd',()=> hideEdgeDeleteButton(true));
  network.on('zoom',()=> hideEdgeDeleteButton(true));
}

/* --------- UI 事件 --------- */
if(collapseBtn){
  collapseBtn.addEventListener('click',()=>{
    exploding=false;
    paused=false;
    hideTip();
    renderCollapsed();
    const etaEl=document.getElementById('eta');
    if(etaEl) etaEl.textContent='ETA: --';
    ensurePhysicsOn();
  });
}
if(explodeBtn){
  explodeBtn.addEventListener('click',()=> startExplodeAll());
}
if(pauseBtn){
  pauseBtn.addEventListener('click',()=>{
    paused=!paused; pauseBtn.textContent = paused?'继续':'暂停';
    if(paused){ network?.setOptions({ physics:{enabled:false} }); } else { ensurePhysicsOn(); if(explodeQueue.length>0){ scheduleNextExplode(); } }
  });
}
if(resetBtn){
  resetBtn.addEventListener('click',()=> network?.fit({animation:true}));
}
if(exportBtn){
  exportBtn.addEventListener('click', () => { if (typeof exportPNG === 'function') { exportPNG(); } });
}
const autoPruneBtn=document.getElementById('autoPrune');
if(autoPruneBtn){
  autoPruneBtn.addEventListener('click', () => { if (typeof autoPruneUnstableNodes === 'function') { autoPruneUnstableNodes(); } });
}
if(ultimateBtn){
  ultimateBtn.addEventListener('click', () => {
    setActiveView(VIEW_GRAPH);
    if (typeof autoUltimatePruneNodes === 'function') { autoUltimatePruneNodes(); }
  });
}
document.getElementById('go').addEventListener('click', () => { if (typeof locateNode === 'function') { locateNode(); } });
if(exportMergeBtn){
  exportMergeBtn.addEventListener('click', () => { if (typeof exportMergeCSV === 'function') { exportMergeCSV(); } });
}
keeperButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const active = btn.classList.toggle('is-active');
    btn.setAttribute('aria-pressed', active? 'true':'false');
  });
});
function updateScoreDropdownValue(value){
  currentScoreValue=value;
  const label=scoreDropdownToggle?.querySelector('.score-dropdown__label');
  if(label){ label.textContent=`分数：${value}`; }
  if(typeof setStatus==='function'){ setStatus(`分数阈值已设置为 ${value} 分`); }
}
function openScoreDropdown(){
  if(scoreDropdownMenu){
    scoreDropdownMenu.hidden=false;scoreDropdownMenu.classList.add('is-open');
  }
  if(scoreDropdownToggle){
    scoreDropdownToggle.setAttribute('aria-expanded','true');
  }
}
function closeScoreDropdown(){
  if(scoreDropdownMenu){
    scoreDropdownMenu.hidden=true;scoreDropdownMenu.classList.remove('is-open');
  }
  if(scoreDropdownToggle){
    scoreDropdownToggle.setAttribute('aria-expanded','false');
  }
}
if(scoreDropdownToggle){
  scoreDropdownToggle.addEventListener('click', ()=>{
    const expanded=scoreDropdownToggle.getAttribute('aria-expanded')==='true';
    if(expanded){ closeScoreDropdown(); }
    else{ openScoreDropdown(); }
  });
}
if(scoreDropdownMenu){
  scoreDropdownMenu.addEventListener('click', (event)=>{
    const btn=event.target.closest('button[data-score]');
    if(!btn) return;
    updateScoreDropdownValue(btn.dataset.score||'100');
    closeScoreDropdown();
  });
}
if(scoreDropdownApply){
  scoreDropdownApply.addEventListener('click', ()=>{
    const val=Number(scoreDropdownCustom?.value);
    if(Number.isFinite(val)){
      updateScoreDropdownValue(String(val));
      closeScoreDropdown();
    }else{
      alert('请输入有效的分数');
    }
  });
}
updateScoreDropdownValue(currentScoreValue);
document.addEventListener('click', (event)=>{
  if(!scoreDropdownMenu || scoreDropdownMenu.hidden) return;
  if(scoreDropdownToggle?.contains(event.target) || scoreDropdownMenu.contains(event.target)) return;
  closeScoreDropdown();
});
if(mergeRefreshStatsBtn){
  mergeRefreshStatsBtn.addEventListener('click', ()=>{
    setActiveView(VIEW_MERGE);
    refreshMergeGraph({ keepPositions:false, fit:true });
    setStatus('吞并视图刷新中…');
  });
}
if(mergeLocateBtn){
  const triggerMergeLocate=()=>{
    const performLocate=()=>{
      if(typeof locateMergeNode === 'function'){ locateMergeNode({ input:mergeSearchInput, fallbackToGraph:true }); }
    };
    if(activeView!==VIEW_MERGE){
      setActiveView(VIEW_MERGE,{ skipMergeFit:true });
      performLocate();
    }else{
      performLocate();
    }
  };
  mergeLocateBtn.addEventListener('click', triggerMergeLocate);
  if(mergeSearchInput){
    mergeSearchInput.addEventListener('keydown', (event)=>{
      if(event.key==='Enter'){
        event.preventDefault();
        triggerMergeLocate();
      }
    });
  }
}
if(mergeResetBtn){
  mergeResetBtn.addEventListener('click', ()=>{
    setActiveView(VIEW_MERGE);
    try{ mergeNetwork?.fit?.({ animation:true }); }catch(err){ console.warn('merge fit failed', err); }
  });
}
if(mergeExportPngBtn){
  mergeExportPngBtn.addEventListener('click', ()=>{ if(typeof exportMergePNG==='function'){ exportMergePNG(); } });
}
const aiMergeBtn=document.getElementById('mergeAiButton');
if(aiMergeBtn){
  const aiBtnLabel=aiMergeBtn.querySelector('.ai-button__text');
  const defaultText=aiBtnLabel? aiBtnLabel.textContent.trim() : aiMergeBtn.textContent.trim();
  const setAiButtonText=(text)=>{
    if(aiBtnLabel){ aiBtnLabel.textContent=text; }
    else{ aiMergeBtn.textContent=text; }
  };
  aiMergeBtn.addEventListener('click', ()=>{
    aiMergeBtn.disabled=true;
    setAiButtonText('聚品中…');
    try{
      refreshMergeGraph({ keepPositions:false, fit:true, defer:false });
      if(typeof setStatus==='function'){ setStatus('AI 一键聚品完成'); }
    }catch(err){
      console.error(err);
    }finally{
      setTimeout(()=>{
        aiMergeBtn.disabled=false;
        setAiButtonText(defaultText);
      }, 400);
    }
  });
}

const versionHistoryRecords=[];
function renderHistoryPanel(){
  if(!historyList) return;
  if(!versionHistoryRecords.length){
    historyList.innerHTML='<div class="history-panel__empty">暂无版本记录</div>';
    return;
  }
  const entries=versionHistoryRecords.map((record,index)=>{
    const stats=record?.stats||{};
    const lines=[
      `当前商品总数：${stats.total ?? '—'}`,
      `已剔除数据数：${stats.removed ?? '—'}`,
      `当前同品组数：${stats.groups ?? '—'}`
    ].map(text=>`<li>${escapeHtmlLite(text)}</li>`).join('');
    return `<article class="history-version"><div class="history-version__head"><span class="history-version__badge">${escapeHtmlLite(record.label||'正式发布')}</span><span class="history-version__time">${escapeHtmlLite(record.time||'')}</span></div><ul class="history-version__stats">${lines}</ul><div class="history-version__actions"><button type="button" class="history-version__restore" data-history-index="${index}">回溯到该版本</button></div></article>`;
  }).join('');
  historyList.innerHTML=`<div class="history-versions">${entries}</div>`;
}
function addVersionHistoryRecord(record){
  versionHistoryRecords.unshift(record);
  if(versionHistoryRecords.length>10){ versionHistoryRecords.pop(); }
  renderHistoryPanel();
}
if(typeof globalThis!=='undefined'){ globalThis.addVersionHistoryRecord = addVersionHistoryRecord; }
function seedVersionHistoryRecords(){
  if(!historyList) return;
  const seed=[
    { label:'正式发布', time:'2025-10-16 09:26', stats:{ total:'18,420', removed:'2,135', groups:'3,276' } },
    { label:'正式发布', time:'2025-10-10 10:12', stats:{ total:'17,860', removed:'1,940', groups:'3,198' } },
    { label:'正式发布', time:'2025-10-02 08:40', stats:{ total:'17,050', removed:'1,502', groups:'3,012' } }
  ];
  seed.forEach(item=> versionHistoryRecords.push(item));
  renderHistoryPanel();
}
seedVersionHistoryRecords();
if(historyToggle && historyPanel){
  historyToggle.addEventListener('click', ()=>{
    const expanded=historyToggle.getAttribute('aria-expanded')==='true';
    historyToggle.setAttribute('aria-expanded', expanded? 'false':'true');
    historyPanel.hidden=expanded;
  });
}
if(historyPanel){
  historyPanel.addEventListener('click', (event)=>{
    const btn=event.target.closest('.history-version__restore');
    if(!btn) return;
    const index=Number(btn.dataset.historyIndex);
    if(Number.isInteger(index) && index>=0 && index<versionHistoryRecords.length){
      const record=versionHistoryRecords[index];
      handleHistoryRestore(record);
    }
  });
}
document.addEventListener('click', (event)=>{
  if(!historyPanel || historyPanel.hidden) return;
  if(historyPanel.contains(event.target) || historyToggle?.contains(event.target)) return;
  historyPanel.hidden=true;
  if(historyToggle){ historyToggle.setAttribute('aria-expanded','false'); }
});

function handleHistoryRestore(record){
  if(!record){
    alert('无法回溯：缺少版本信息');
    return;
  }
  if(openHistoryConfirm(record)) return;
  const message=`即将回溯到版本：${record.label || '历史版本'}（${record.time || '未知时间'}）。\\n当前配置将被覆盖，确认继续？`;
  if(confirm(message)){
    applyHistoryRestore(record);
  }
}
function openHistoryConfirm(record){
  if(!historyConfirm || !historyConfirmDesc || !historyConfirmAccept) return false;
  pendingHistoryRecord=record;
  historyConfirmDesc.textContent = `确定回溯到 ${record.label || '历史版本'}（${record.time || '未知时间'}）吗？当前配置将被覆盖。`;
  historyConfirm.hidden=false;
  return true;
}
function closeHistoryConfirm(){
  if(historyConfirm){ historyConfirm.hidden=true; }
  pendingHistoryRecord=null;
}
function applyHistoryRestore(record){
  closeHistoryConfirm();
  setStatus(`正在回溯至 ${record.label||'历史版本'} ...`);
  setTimeout(()=> setStatus(`已回溯到 ${record.label||'历史版本'}`), 700);
}
if(historyConfirmCancel){
  historyConfirmCancel.addEventListener('click', closeHistoryConfirm);
}
if(historyConfirmAccept){
  historyConfirmAccept.addEventListener('click', ()=>{
    if(pendingHistoryRecord){
      const record=pendingHistoryRecord;
      pendingHistoryRecord=null;
      applyHistoryRestore(record);
    }else{
      closeHistoryConfirm();
    }
  });
}
if(historyConfirm){
  historyConfirm.addEventListener('click', (event)=>{
    if(event.target===historyConfirm){
      closeHistoryConfirm();
    }
  });
}
if(mergeNodeLimitInput && mergeNodeLimitLabel){
  mergeNodeLimitLabel.textContent = mergeNodeLimitInput.value;
  mergeNodeLimitSetting = Number(mergeNodeLimitInput.value)||MERGE_NODE_LIMIT;
  mergeNodeLimitInput.addEventListener('input', ()=>{
    mergeNodeLimitLabel.textContent = mergeNodeLimitInput.value;
    mergeNodeLimitSetting = Number(mergeNodeLimitInput.value)||MERGE_NODE_LIMIT;
    refreshMergeGraph({ keepPositions:false, fit:false, defer:true });
  });
}
if(mergeEdgeLimitInput && mergeEdgeLimitLabel){
  mergeEdgeLimitLabel.textContent = mergeEdgeLimitInput.value;
  mergeEdgeLimitSetting = Number(mergeEdgeLimitInput.value)||MERGE_EDGE_LIMIT;
  mergeEdgeLimitInput.addEventListener('input', ()=>{
    mergeEdgeLimitLabel.textContent = mergeEdgeLimitInput.value;
    mergeEdgeLimitSetting = Number(mergeEdgeLimitInput.value)||MERGE_EDGE_LIMIT;
    refreshMergeGraph({ keepPositions:false, fit:false, defer:true });
  });
}
if(mergeDragLimitInput && mergeDragLimitLabel){
  mergeDragLimitLabel.textContent = mergeDragLimitInput.value;
  mergeDragLimitSetting = Number(mergeDragLimitInput.value)||MERGE_DRAG_LIMIT;
  mergeDragLimitInput.addEventListener('input', ()=>{
    mergeDragLimitLabel.textContent = mergeDragLimitInput.value;
    mergeDragLimitSetting = Number(mergeDragLimitInput.value)||MERGE_DRAG_LIMIT;
  });
}

function resetMergeControlSettings(){
  if(mergeNodeLimitInput && mergeNodeLimitLabel){
    mergeNodeLimitInput.value=String(MERGE_NODE_LIMIT);
    mergeNodeLimitLabel.textContent=String(MERGE_NODE_LIMIT);
    mergeNodeLimitSetting=MERGE_NODE_LIMIT;
  }
  if(mergeEdgeLimitInput && mergeEdgeLimitLabel){
    mergeEdgeLimitInput.value=String(MERGE_EDGE_LIMIT);
    mergeEdgeLimitLabel.textContent=String(MERGE_EDGE_LIMIT);
    mergeEdgeLimitSetting=MERGE_EDGE_LIMIT;
  }
  if(mergeDragLimitInput && mergeDragLimitLabel){
    mergeDragLimitInput.value=String(MERGE_DRAG_LIMIT);
    mergeDragLimitLabel.textContent=String(MERGE_DRAG_LIMIT);
    mergeDragLimitSetting=MERGE_DRAG_LIMIT;
  }
  if(mergeSearchInput){ mergeSearchInput.value=''; }
  toggleGraphStatsBar(activeView===VIEW_GRAPH);
  toggleMergeStatsBar(activeView===VIEW_MERGE);
}
if(typeof window!=='undefined'){ window.resetMergeControlSettings = resetMergeControlSettings; }

addEventListener('keydown',(ev)=>{
  const targetTag = ev.target?.tagName?.toLowerCase();
  if(targetTag==='input' || targetTag==='textarea' || ev.target?.isContentEditable) return;
  if(ev.key==='Delete' && !ev.ctrlKey && !ev.metaKey && !ev.altKey){
    const selectedNodes = network?.getSelectedNodes?.() || [];
    if(selectedNodes.length){
      if(removeNode(selectedNodes[0])) ev.preventDefault();
      return;
    }
    const selectedEdges = network?.getSelectedEdges?.() || [];
    if(selectedEdges.length){
      if(removeEdgeById(selectedEdges[0])) ev.preventDefault();
    }
  }
  if((ev.key==='z' || ev.key==='Z') && (ev.ctrlKey || ev.metaKey)){
    ev.preventDefault();
    undoLast();
  }
});

function clearEdgeDeleteHideTimer(){
  if(edgeDeleteHideTimer){
    clearTimeout(edgeDeleteHideTimer);
    edgeDeleteHideTimer=null;
  }
}

function ensureEdgeDeleteButton(){
  if(edgeDeleteBtn) return edgeDeleteBtn;
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='edge-delete-btn';
  btn.setAttribute('aria-label','删除连线');
  btn.addEventListener('click', ev=>{
    ev.preventDefault();
    ev.stopPropagation();
    if(!hoveredEdgeId) return;
    if(typeof removeEdgeById==='function'){
      removeEdgeById(hoveredEdgeId);
    }
    hideEdgeDeleteButton(true);
  });
  btn.addEventListener('mouseenter', ()=> clearEdgeDeleteHideTimer());
  btn.addEventListener('mouseleave', ()=> hideEdgeDeleteButton());
  document.body.appendChild(btn);
  edgeDeleteBtn=btn;
  return btn;
}

function showEdgeDeleteButton(edgeId){
  if(!network || !edgesDS) return;
  const edge=edgesDS.get(edgeId);
  if(!edge || !edge.from || !edge.to){
    hideEdgeDeleteButton(true);
    return;
  }
  const btn=ensureEdgeDeleteButton();
  btn.classList.add('is-visible');
  clearEdgeDeleteHideTimer();
  hoveredEdgeId=edgeId;
  startEdgeDeleteTracking(edge);
}

function hideEdgeDeleteButton(force=false){
  if(!edgeDeleteBtn){
    hoveredEdgeId=null;
    return;
  }
  if(!force){
    clearEdgeDeleteHideTimer();
    edgeDeleteHideTimer=setTimeout(()=> hideEdgeDeleteButton(true), 160);
    return;
  }
  clearEdgeDeleteHideTimer();
  edgeDeleteBtn.classList.remove('is-visible');
  hoveredEdgeId=null;
  stopEdgeDeleteTracking();
}

function ensureMergeEdgeDeleteButton(){
  if(mergeEdgeDeleteBtn) return mergeEdgeDeleteBtn;
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='edge-delete-btn';
  btn.setAttribute('aria-label','删除连线');
  btn.addEventListener('click', ev=>{
    ev.preventDefault();
    ev.stopPropagation();
    if(!mergeHoveredEdgeId) return;
    if(typeof removeMergeEdgeById==='function'){
      removeMergeEdgeById(mergeHoveredEdgeId);
    }
    hideMergeEdgeDeleteButton(true);
  });
  btn.addEventListener('mouseenter', ()=> clearMergeEdgeDeleteHideTimer());
  btn.addEventListener('mouseleave', ()=> hideMergeEdgeDeleteButton());
  document.body.appendChild(btn);
  mergeEdgeDeleteBtn=btn;
  return btn;
}

function clearMergeEdgeDeleteHideTimer(){
  if(mergeEdgeDeleteHideTimer){
    clearTimeout(mergeEdgeDeleteHideTimer);
    mergeEdgeDeleteHideTimer=null;
  }
}

function showMergeEdgeDeleteButton(edgeId){
  if(!mergeNetwork || !mergeEdgesDS) return;
  const edge=mergeEdgesDS.get(edgeId);
  if(!edge || !edge.from || !edge.to){
    hideMergeEdgeDeleteButton(true);
    return;
  }
  const btn=ensureMergeEdgeDeleteButton();
  btn.classList.add('is-visible');
  clearMergeEdgeDeleteHideTimer();
  mergeHoveredEdgeId=edgeId;
  startMergeEdgeDeleteTracking(edge);
}

function hideMergeEdgeDeleteButton(force=false){
  if(!mergeEdgeDeleteBtn){
    mergeHoveredEdgeId=null;
    return;
  }
  if(!force){
    clearMergeEdgeDeleteHideTimer();
    mergeEdgeDeleteHideTimer=setTimeout(()=> hideMergeEdgeDeleteButton(true), 160);
    return;
  }
  clearMergeEdgeDeleteHideTimer();
  mergeEdgeDeleteBtn.classList.remove('is-visible');
  mergeHoveredEdgeId=null;
  stopMergeEdgeDeleteTracking();
}

function startMergeEdgeDeleteTracking(edge){
  mergeEdgeDeleteTrack=edge ? { from:edge.from, to:edge.to } : null;
  updateMergeEdgeDeleteButtonPosition();
  if(mergeEdgeDeleteRaf){
    cancelAnimationFrame(mergeEdgeDeleteRaf);
    mergeEdgeDeleteRaf=null;
  }
  if(mergeEdgeDeleteTrack){
    const loop=()=>{
      if(!mergeEdgeDeleteTrack){
        mergeEdgeDeleteRaf=null;
        return;
      }
      updateMergeEdgeDeleteButtonPosition();
      mergeEdgeDeleteRaf=requestAnimationFrame(loop);
    };
    mergeEdgeDeleteRaf=requestAnimationFrame(loop);
  }
}

function stopMergeEdgeDeleteTracking(){
  mergeEdgeDeleteTrack=null;
  if(mergeEdgeDeleteRaf){
    cancelAnimationFrame(mergeEdgeDeleteRaf);
    mergeEdgeDeleteRaf=null;
  }
}

function updateMergeEdgeDeleteButtonPosition(){
  if(!mergeEdgeDeleteTrack || !mergeEdgeDeleteBtn || !mergeNetwork) return;
  const { from, to }=mergeEdgeDeleteTrack;
  const positions=mergeNetwork.getPositions([from, to]);
  const fromPos=positions[from];
  const toPos=positions[to];
  if(!fromPos || !toPos){
    mergeEdgeDeleteBtn.classList.remove('is-visible');
    return;
  }
  const midpoint={ x:(fromPos.x+toPos.x)/2, y:(fromPos.y+toPos.y)/2 };
  const domPoint=mergeNetwork.canvasToDOM(midpoint);
  let left=domPoint.x;
  let top=domPoint.y;
  if(mergeNetworkContainer){
    const rect=mergeNetworkContainer.getBoundingClientRect();
    left += rect.left;
    top += rect.top;
  }
  mergeEdgeDeleteBtn.style.left=left+'px';
  mergeEdgeDeleteBtn.style.top=top+'px';
}

function makeMergeEdgeKey(cid, fromId, toId){
  return `${cid||''}::${fromId||''}::${toId||''}`;
}

function markMergeEdgeDeleted(cid, fromId, toId){
  const key=makeMergeEdgeKey(cid, fromId, toId);
  mergeDeletedEdges.add(key);
}

function isMergeEdgeDeleted(cid, fromId, toId){
  const key=makeMergeEdgeKey(cid, fromId, toId);
  return mergeDeletedEdges.has(key);
}

function removeMergeEdgeById(edgeId){
  if(!edgeId || !mergeEdgesDS) return false;
  const edge=mergeEdgesDS.get(edgeId);
  if(!edge) return false;
  const fromInfo=parseMergeVisId(edge.from);
  const toInfo=parseMergeVisId(edge.to);
  if(!fromInfo || !toInfo) return false;
  const cid = fromInfo.cid || toInfo.cid;
  const mergerCode = fromInfo.nodeId;
  const victimCode = toInfo.nodeId;
  if(!cid || !mergerCode || !victimCode) return false;
  mergeEdgesDS.remove(edgeId);
  markMergeEdgeDeleted(cid, mergerCode, victimCode);
  hideMergeEdgeDeleteButton(true);
  let relationHandled=false;
  if(typeof removeEdgesBetweenNodes==='function'){
    relationHandled = removeEdgesBetweenNodes('N:'+mergerCode, 'N:'+victimCode, {recordUndo:false});
  }
  if(!relationHandled && typeof handleRelationRemovalBetweenCodes==='function'){
    try{ handleRelationRemovalBetweenCodes(mergerCode, victimCode); }catch(err){}
  }
  return true;
}

function startEdgeDeleteTracking(edge){
  edgeDeleteTrack=edge ? { from:edge.from, to:edge.to } : null;
  updateEdgeDeleteButtonPosition();
  if(edgeDeleteRaf){
    cancelAnimationFrame(edgeDeleteRaf);
    edgeDeleteRaf=null;
  }
  if(edgeDeleteTrack){
    const loop=()=>{
      if(!edgeDeleteTrack){
        edgeDeleteRaf=null;
        return;
      }
      updateEdgeDeleteButtonPosition();
      edgeDeleteRaf=requestAnimationFrame(loop);
    };
    edgeDeleteRaf=requestAnimationFrame(loop);
  }
}

function stopEdgeDeleteTracking(){
  edgeDeleteTrack=null;
  if(edgeDeleteRaf){
    cancelAnimationFrame(edgeDeleteRaf);
    edgeDeleteRaf=null;
  }
}

function updateEdgeDeleteButtonPosition(){
  if(!edgeDeleteTrack || !edgeDeleteBtn || !network) return;
  const { from, to }=edgeDeleteTrack;
  const positions=network.getPositions([from, to]);
  const fromPos=positions[from];
  const toPos=positions[to];
  if(!fromPos || !toPos){
    edgeDeleteBtn.classList.remove('is-visible');
    return;
  }
  const midpoint={ x:(fromPos.x+toPos.x)/2, y:(fromPos.y+toPos.y)/2 };
  const domPoint=network.canvasToDOM(midpoint);
  let left=domPoint.x;
  let top=domPoint.y;
  if(networkContainer){
    const rect=networkContainer.getBoundingClientRect();
    left += rect.left;
    top += rect.top;
  }
  edgeDeleteBtn.style.left=left+'px';
  edgeDeleteBtn.style.top=top+'px';
}

function focusGraphNode(code,{ center=true, select=true }={}){
  if(!code || !network || !nodesDS) return false;
  const nodeId='N:'+String(code);
  if(!nodesDS.get(nodeId)) return false;
  if(select){
    try{ network.selectNodes([nodeId], false); }catch(err){ /* ignore */ }
  }
  if(center){
    try{
      network.focus(nodeId,{
        scale:1.15,
        animation:{ duration:480, easingFunction:'easeInOutQuad' }
      });
    }catch(err){ /* ignore */ }
  }
  return true;
}

function findMergeVisIdByCode(code){
  if(!mergeNodesDS || !code) return null;
  const normalized=String(code).trim().replace(/^N:/,'');
  if(!normalized) return null;
  let target=null;
  try{
    const matches=mergeNodesDS.get({
      filter:(node)=>{
        const raw=String(node?.rawId ?? '').trim().replace(/^N:/,'');
        return raw===normalized;
      }
    }) || [];
    if(Array.isArray(matches) && matches.length){
      target=matches[0]?.id || null;
    }
  }catch(err){ target=null; }
  return target;
}

function focusMergeNode(code,{ center=true, select=true }={}){
  if(!code || !mergeNetwork || !mergeNodesDS) return false;
  const visId=findMergeVisIdByCode(code);
  if(!visId) return false;
  if(select){
    try{ mergeNetwork.selectNodes([visId], false); }catch(err){ /* ignore */ }
  }
  if(center){
    try{
      mergeNetwork.focus(visId,{
        scale:1.15,
        animation:{ duration:420, easingFunction:'easeInOutQuad' }
      });
    }catch(err){ /* ignore */ }
  }
  return true;
}

if(typeof window!=='undefined'){
  window.focusGraphNode = focusGraphNode;
  window.focusMergeNode = focusMergeNode;
}

const minGroupInput=document.getElementById('minGroup');
minGroupInput.addEventListener('input',()=>{ document.getElementById('minGroupLabel').textContent='≥ '+(minGroupInput.value||'2'); renderCollapsed(); if(exploding) updateETA(); });

document.getElementById('build').addEventListener('click', async ()=>{
  const f=document.getElementById('file').files[0]; if(!f){ alert('请选择 Excel/CSV 文件'); return; }
  resetAll(); setProgress(0,'解析文件…');
  setStatus(useWorker? '正在后台解析（Worker）…':'正在主线程解析…');
  const buf=await f.arrayBuffer(); const preferred=preferredSheetName();

  if(useWorker && workerReady){
    const onMsg=(e)=>{
      const {type}=e.data||{};
      if(type==='progress'){ setProgress(e.data.p); }
      if(type==='summary'){ worker.removeEventListener('message', onMsg); onSummary(e.data); }
      if(type==='error'){
        worker.removeEventListener('message', onMsg);
        setStatus('Worker 解析失败，改走主线程：'+e.data.message);
        try{ const sum=parseOnMainThread(buf, preferred); onSummary(sum); }catch(err){ alert('解析失败：'+err.message); setStatus('解析失败'); }
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({type:'parse', buffer:buf, sheetNamePreferred:preferred});
  }else{
    try{ const sum=parseOnMainThread(buf, preferred); onSummary(sum); }catch(err){ alert('解析失败：'+err.message); setStatus('解析失败'); }
  }
});

const controlPanelEl=document.getElementById('controlPanel');
const controlToggleBtn=document.getElementById('controlToggle');
let controlTogglePosRaf=null;
let controlToggleResizeObserver=null;
function updateControlTogglePosition(){
  if(!controlPanelEl || !controlToggleBtn) return;
  const rect=controlPanelEl.getBoundingClientRect();
  if(rect.width===0 && rect.height===0) return;
  const viewportPad=32;
  const maxTop=(window.innerHeight||0) - viewportPad;
  let nextTop=rect.top + (rect.height/2);
  if(window.innerHeight){
    nextTop=Math.max(viewportPad, Math.min(maxTop, nextTop));
  }
  controlToggleBtn.style.top=Math.round(nextTop)+'px';
  controlToggleBtn.style.removeProperty('left');
}
function scheduleControlTogglePosition(){
  if(controlTogglePosRaf!==null) return;
  controlTogglePosRaf=requestAnimationFrame(()=>{
    controlTogglePosRaf=null;
    updateControlTogglePosition();
  });
}
function syncControlPanelState(){
  const collapsed=document.body.classList.contains('control-collapsed');
  if(controlToggleBtn){
    controlToggleBtn.setAttribute('aria-expanded', collapsed? 'false':'true');
    controlToggleBtn.setAttribute('aria-label', collapsed? '展开操作栏':'收起操作栏');
  }
  if(controlPanelEl){
    controlPanelEl.setAttribute('aria-hidden', collapsed? 'true':'false');
  }
  scheduleControlTogglePosition();
}
if(controlToggleBtn){
  controlToggleBtn.addEventListener('click', ()=>{
    document.body.classList.toggle('control-collapsed');
    syncControlPanelState();
  });
  syncControlPanelState();
  window.addEventListener('scroll', scheduleControlTogglePosition, {passive:true});
  window.addEventListener('resize', scheduleControlTogglePosition, {passive:true});
  if(controlPanelEl){
    controlPanelEl.addEventListener('transitionend',(ev)=>{
      if(ev?.propertyName==='transform'){
        scheduleControlTogglePosition();
      }
    });
  }
  if(window.ResizeObserver && controlPanelEl){
    controlToggleResizeObserver=new ResizeObserver(()=> scheduleControlTogglePosition());
    controlToggleResizeObserver.observe(controlPanelEl);
    window.addEventListener('beforeunload', ()=>{
      if(controlToggleResizeObserver){
        controlToggleResizeObserver.disconnect();
        controlToggleResizeObserver=null;
      }
    }, {once:true});
  }
  scheduleControlTogglePosition();
}

/* --------- 画布/表格分割拖动 --------- */
const canvasSplit=document.getElementById('canvasSplit');
const canvasSplitHandle=document.getElementById('canvasSplitHandle');
const canvasSplitTopPane=document.getElementById('canvasSplitTop');
const canvasSplitBottomPane=document.getElementById('canvasSplitBottom');
const SPLIT_MIN_TOP=360;
const SPLIT_MIN_BOTTOM=260;
let canvasSplitTotal=null;
let canvasSplitMeasureRaf=null;
function measureCanvasSplit(){
  if(!canvasSplit || !canvasSplitTopPane) return;
  const rect=canvasSplit.getBoundingClientRect();
  const total=Math.max(rect.height, SPLIT_MIN_TOP + SPLIT_MIN_BOTTOM);
  const topHeight=canvasSplitTopPane.getBoundingClientRect().height;
  canvasSplitTotal=total;
  applyCanvasSplitPx(topHeight, total);
}
function applyCanvasSplitPx(topPx,totalOverride){
  if(!canvasSplit) return;
  let total;
  if(typeof totalOverride==='number'){
    total=Math.max(totalOverride, SPLIT_MIN_TOP + SPLIT_MIN_BOTTOM);
    canvasSplitTotal=total;
  }else if(canvasSplitTotal!==null){
    total=canvasSplitTotal;
  }else{
    const rectHeight=canvasSplit.getBoundingClientRect().height;
    total=Math.max(rectHeight, SPLIT_MIN_TOP + SPLIT_MIN_BOTTOM);
    canvasSplitTotal=total;
  }
  const maxTop=total - SPLIT_MIN_BOTTOM;
  const clamped=Math.min(maxTop, Math.max(SPLIT_MIN_TOP, topPx));
  const bottomPx=Math.max(SPLIT_MIN_BOTTOM, total - clamped);
  canvasSplit.style.setProperty('--split-top', clamped+'px');
  canvasSplit.style.setProperty('--split-bottom', bottomPx+'px');
  if(canvasSplitHandle){
    const percent=Math.round((clamped / total)*100);
    canvasSplitHandle.setAttribute('aria-valuenow', percent);
  }
}
function scheduleCanvasSplitMeasure(){
  if(canvasSplitMeasureRaf || !canvasSplit) return;
  canvasSplitMeasureRaf=requestAnimationFrame(()=>{
    canvasSplitMeasureRaf=null;
    measureCanvasSplit();
  });
}
if(canvasSplit && canvasSplitHandle){
  canvasSplitHandle.setAttribute('role','separator');
  canvasSplitHandle.setAttribute('aria-orientation','vertical');
  canvasSplitHandle.setAttribute('aria-valuemin', String(SPLIT_MIN_TOP));
  canvasSplitHandle.setAttribute('aria-valuemax', '');
  requestAnimationFrame(()=>{ measureCanvasSplit(); });
  let dragging=false;
  const handlePointerMove=(ev)=>{
    if(!dragging || !canvasSplit) return;
    ev.preventDefault();
    const rect=canvasSplit.getBoundingClientRect();
    applyCanvasSplitPx(ev.clientY - rect.top);
  };
  const stopDrag=(ev)=>{
    if(!dragging) return;
    dragging=false;
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', stopDrag);
    if(ev && ev.pointerId && canvasSplitHandle.hasPointerCapture(ev.pointerId)){
      canvasSplitHandle.releasePointerCapture(ev.pointerId);
    }
  };
  canvasSplitHandle.addEventListener('pointerdown',(ev)=>{
    if(canvasSplitTotal===null){ measureCanvasSplit(); }
    dragging=true;
    try{ canvasSplitHandle.setPointerCapture(ev.pointerId); }catch{}
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', stopDrag);
  });
  window.addEventListener('resize', scheduleCanvasSplitMeasure, { passive:true });
}

/* --------- 画布/表格分割拖动 --------- */

/* --------- Worker 常驻消息（邻居/度数/组件数据） --------- */
function onWorkerMsg(e){
  const {type}=e.data||{};
  if(type==='neighbors'){ showTip(e.data); }
  if(type==='componentData'){ cacheComponentData(e.data); /* 具体渲染在 requestComponent 附加的回调里触发 */ }
  if(type==='degrees'){ if(_pendingDegreesCB){ const cb=_pendingDegreesCB; _pendingDegreesCB=null; cb(e.data.degrees); } }
}
function ensureWorker(){
  if(!worker){
    try{
      worker=new Worker(URL.createObjectURL(new Blob([workerSrc],{type:'application/javascript'})));
      worker.addEventListener('message', (e)=>{
        if(e.data?.type==='ready'){ workerReady=true; useWorker = !!e.data.xlsx; setStatus(useWorker?'依赖就绪：Worker + XLSX':'依赖就绪：Worker 无法加载 XLSX，改主线程解析'); }
      });
      worker.addEventListener('message', onWorkerMsg);
    }catch(e){ setStatus('不支持 Worker，使用主线程解析'); useWorker=false; }
  }
}

/* --------- 主线程解析（含中文修复） --------- */
function DSU(){ this.p=new Map(); this.r=new Map(); }
DSU.prototype.make=function(x){ if(!this.p.has(x)){ this.p.set(x,x); this.r.set(x,0);} };
DSU.prototype.find=function(x){ let p=this.p.get(x); if(p!==x){ p=this.find(p); this.p.set(x,p);} return p; };
DSU.prototype.union=function(a,b){ this.make(a); this.make(b); a=this.find(a); b=this.find(b); if(a===b) return;
  const ra=this.r.get(a), rb=this.r.get(b); if(ra<rb) this.p.set(a,b); else if(ra>rb) this.p.set(b,a); else { this.p.set(b,a); this.r.set(a,ra+1);} };

function inferHeaderIndexes(rows){
  let codeIdx=-1, nameIdx=-1, relIdx=-1, reasonIdx=-1;
  const headerCandidates = rows.slice(0,5);
  const codeHeads=["ID","Id","id","编码","编号","商品编码","物料编码","sku","SKU","商品ID","商品编号"];
  const nameHeads=["名称","商品名称","物料名称","品名","标题","name","Name"];
  const relHeads =["同品","同品ID","同品关系","关联","关联ID","相似","相似ID","peers","neighbors","links"];
  const reasonHeads=["同品原因","原因","理由","reason"];
  for(const row of headerCandidates){
    row.forEach((cell,i)=>{
      const v=String(cell).trim(); if(!v) return;
      if(codeHeads.includes(v)) codeIdx=i;
      if(nameHeads.includes(v) && nameIdx===-1) nameIdx=i;
      if(relHeads.includes(v)) relIdx=i;
      if(reasonHeads.includes(v) && reasonIdx===-1) reasonIdx=i;
    });
    if(codeIdx!==-1 && relIdx!==-1) break;
  }
  if(codeIdx===-1 && rows.length) codeIdx=0;
  if(nameIdx===-1 && rows.length && rows[0].length>=2) nameIdx=1;
  if(relIdx===-1 && rows.length && rows[0].length>=3) relIdx=2;
  return { codeIdx, nameIdx, relIdx, reasonIdx };
}
function quantile(arr,q){ if(!arr.length) return 0; const a=arr.slice().sort((x,y)=>x-y); const pos=(a.length-1)*q, b=Math.floor(pos), r=pos-b; return a[b+1]!==undefined? a[b]+r*(a[b+1]-a[b]):a[b]; }

function parseOnMainThread(buffer, sheetNamePreferred){
  if(!window.XLSX) throw new Error('未加载 XLSX 库');
  try{ if(window.cptable && XLSX.set_cptable){ XLSX.set_cptable(window.cptable); } }catch{}
  const wb=XLSX.read(new Uint8Array(buffer), {type:'array'});
  const sheetName = wb.SheetNames.includes(sheetNamePreferred)? sheetNamePreferred : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' });

  const { codeIdx, nameIdx, relIdx, reasonIdx }=inferHeaderIndexes(rows);
  if(codeIdx===-1 || relIdx===-1) throw new Error('no_required_headers');

  const dsu=new DSU(); const edgesSet=new Set(); const nameOf=new Map(); const adj=new Map(); const reasonMap=new Map();

  const ensureReason=(id)=>{ if(!reasonMap.has(id)) reasonMap.set(id,new Map()); return reasonMap.get(id); };
  const total=rows.length-1; let processed=0;

  for(let r=1;r<rows.length;r++){
    const row=rows[r]; if(!row) continue;
    const code=String(row[codeIdx]||'').trim(); if(!code) continue;
    const name=String(row[nameIdx]||'').trim(); if(name && !nameOf.has(code)) nameOf.set(code,name);
    const rel =String(row[relIdx]||'').trim(); if(!rel) continue;
    const reasonLookup=new Map();
    if(reasonIdx!==-1){
      const cell=row[reasonIdx];
      const raw=cell===undefined||cell===null? '' : String(cell).trim();
      if(raw){
        try{
          const parsed=JSON.parse(raw);
          if(Array.isArray(parsed)){
            for(const item of parsed){
              const peerCode=String(item?.candidate_code||'').trim();
              if(!peerCode) continue;
              const info={};
              if(item?.reason!==undefined && item.reason!==null){ info.reason=String(item.reason).trim(); }
              if(item?.score!==undefined && item.score!==null && String(item.score).trim()!==''){
                const num=Number(item.score);
                info.score=Number.isFinite(num)? num : String(item.score).trim();
              }
              if(Object.keys(info).length>0){ reasonLookup.set(peerCode, info); }
            }
          }
        }catch{}
      }
    }
    const peers=rel.split(',').map(s=>s.trim()).filter(Boolean);
    for(const peer of peers){
      dsu.union(code,peer);
      if(code!==peer){
        const key=[code,peer].sort().join('::');
        if(!edgesSet.has(key)){
          edgesSet.add(key);
          if(!adj.has(code)) adj.set(code,new Set());
          if(!adj.has(peer)) adj.set(peer,new Set());
          adj.get(code).add(peer); adj.get(peer).add(code);
        }
        const info=reasonLookup.get(peer);
        if(info){
          const entryA=ensureReason(code); entryA.set(peer, info);
          const entryB=ensureReason(peer); entryB.set(code, info);
        }
      }
    }

    processed++; if(processed%2000===0){ setProgress(Math.round(processed/total*50)); }
  }

  const ids=new Set(), compOf=new Map(), comps=new Map();
  for(let r=1;r<rows.length;r++){
    const row=rows[r]; if(!row) continue;
    const code=String(row[codeIdx]||'').trim(); if(code) ids.add(code);
    const rel =String(row[relIdx]||'').trim();
    if(rel){ rel.split(',').forEach(x=>{ x=x.trim(); if(x) ids.add(x); }); }
    const name=String(row[nameIdx]||'').trim(); if(code && name && !nameOf.has(code)) nameOf.set(code,name);
  }
  for(const id of ids){ dsu.make(id); compOf.set(id, dsu.find(id)); }
  for(const id of ids){ const c=compOf.get(id); if(!comps.has(c)) comps.set(c,new Set()); comps.get(c).add(id); }

  const degs=[]; for(const [_,set] of adj.entries()){ degs.push(set.size); }
  const degMax=degs.length?Math.max(...degs):0; const degP95=quantile(degs,0.95);
  const edgesByComp=new Map(); for(const key of edgesSet){ const [a,b]=key.split('::'); const c=compOf.get(a); edgesByComp.set(c,(edgesByComp.get(c)||0)+1); }
  const compList=Array.from(comps.entries()).map(([cid,set])=>({cid,size:set.size})).sort((a,b)=>b.size-a.size);

  MT_ctx={ parsed:true, comps, compOf, edgesGlobal:edgesSet, nameOf, adj, edgesByComp, reasons:reasonMap };
  if(typeof globalThis!=='undefined'){ globalThis.MT_ctx = MT_ctx; }
  return { comps:compList, totalNodes:ids.size, totalEdges:edgesSet.size, degreeMax:degMax, degreeP95:degP95,
           edgesByComp:Array.from(edgesByComp.entries()).map(([cid,count])=>({cid,count})), rawRows: rows, codeIndex: codeIdx };
}
function neighborsMainThread(id){ const set=(MT_ctx.adj?.get(id)||new Set()); const neighbors=Array.from(set).map(n=>{
  const info = MT_ctx.reasons?.get(id)?.get(n) || MT_ctx.reasons?.get(n)?.get(id) || null;
  const reason = info?.reason ?? '';
  const score = info?.score ?? null;
  return {id:n, name:MT_ctx.nameOf?.get(n)||'', reason, score};
});
  return { type:'neighbors', id, name:MT_ctx.nameOf?.get(id)||'', degree:set.size, neighbors }; }
