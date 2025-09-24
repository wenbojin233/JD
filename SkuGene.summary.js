/* --------- 解析完成 → 初始渲染 --------- */
function onSummary(e){
  fullSummary = { comps:e.comps, totalNodes:e.totalNodes, totalEdges:e.totalEdges, degreeMax:e.degreeMax||0, degreeP95:e.degreeP95||0, edgesByComp:e.edgesByComp||[], indexByCid:new Map((e.comps||[]).map((c,idx)=>[String(c.cid), idx+1])) };
  if(fullSummary.indexByCid && fullSummary.indexByCid instanceof Map===false){ fullSummary.indexByCid = new Map((e.comps||[]).map((c,idx)=>[String(c.cid), idx+1])); }
  DEGREE_MAX = fullSummary.degreeMax||0;
  DEGREE_CAP = Math.max(1, Math.round(fullSummary.degreeP95||DEGREE_MAX));
  GROUP_MAX = fullSummary.comps.length? Math.max(...fullSummary.comps.map(c=>c.size)) : 0;
  const sizesAll=(fullSummary.comps||[]).map(c=>c.size);
  GROUP_CAP_ALL = percentile(sizesAll, 0.95);
  GROUP_CAP_NOSINGLES = percentile(sizesAll.filter(s=>s>1), 0.95);
  GROUP_CAP = GROUP_CAP_ALL;

  EDGES_PER_COMP = new Map((fullSummary.edgesByComp||[]).map(o=>[String(o.cid), o.count||0]));
  renderCollapsed(); updateLegends(); setStatus(`已加载：节点 ${e.totalNodes} · 边 ${e.totalEdges} · 组件 ${e.comps.length}`);
  setProgress(100,'解析完成，可展开并持续扩散。'); applyPhysics();
}
function updateLegends(){
  document.getElementById('gcap').textContent = String(GROUP_CAP||0);
  document.getElementById('gmaxNote').textContent = 'MAX: '+(GROUP_MAX||0);
  document.getElementById('dcap').textContent = String(DEGREE_CAP||0);
  document.getElementById('dmaxNote').textContent = 'MAX: '+(DEGREE_MAX||0);
}
function datasetSize(ds){ return (typeof ds.length==='number')? ds.length : ds.getIds().length; }
function updateStats(){
  document.getElementById('nodesBadge').textContent='节点数: '+datasetSize(nodesDS);
  document.getElementById('edgesBadge').textContent='边数: '+datasetSize(edgesDS);
  const totalComps=fullSummary? fullSummary.comps.length:0;
  const minGroup=Number(document.getElementById('minGroup')?.value||2);
  const shownComps=fullSummary? fullSummary.comps.filter(c=>c.size>=minGroup).length : 0;
  const hidden=Math.max(0, totalComps-shownComps);
  document.getElementById('compBadge').textContent='组件数: '+shownComps+(hidden? '（隐藏 '+hidden+'）':'');
  const maxComp=GROUP_MAX||0;
  document.getElementById('maxCompBadge').textContent='最大组件大小: '+maxComp;
}
function gridPositions(n, spacing=26){ const cols=Math.ceil(Math.sqrt(n)), rows=Math.ceil(n/cols), out=[];
  const x0=-(cols-1)*spacing/2, y0=-(rows-1)*spacing/2; let k=0;
  for(let r=0;r<rows;r++){ for(let c=0;c<cols;c++){ if(k++>=n) break; out.push({x:x0+c*spacing, y:y0+r*spacing}); } }
  return out;
}
function ringPositions(n,R=120,jitter=8){ const out=[], step=(2*Math.PI)/Math.max(1,n);
  for(let i=0;i<n;i++){ const ang=i*step; out.push({ x:Math.cos(ang)*R+(Math.random()*2-1)*jitter, y:Math.sin(ang)*R+(Math.random()*2-1)*jitter }); }
  return out;
}

function isGroupPanelOpen(){
  return !!(groupPanelEl && groupPanelEl.classList.contains('open'));
}
function openGroupPanel(){
  if(!groupPanelEl) return;
  groupPanelEl.classList.add('open');
  groupPanelEl.setAttribute('aria-hidden','false');
  document.body.classList.add('group-panel-open');
  if(groupPanelToggle){
    groupPanelToggle.setAttribute('aria-expanded','true');
    groupPanelToggle.textContent = GROUP_PANEL_TOGGLE_CLOSE_LABEL;
  }
  renderGroupList(activeGroupCid);
}
function closeGroupPanel(){
  if(!groupPanelEl) return;
  groupPanelEl.classList.remove('open');
  groupPanelEl.setAttribute('aria-hidden','true');
  document.body.classList.remove('group-panel-open');
  if(groupPanelToggle){
    groupPanelToggle.setAttribute('aria-expanded','false');
    groupPanelToggle.textContent = groupPanelToggleDefault;
  }
}
function toggleGroupPanel(){
  if(isGroupPanelOpen()){ closeGroupPanel(); }
  else{ openGroupPanel(); }
}
function isConfirmedPanelOpen(){
  return !!(confirmedPanelEl && confirmedPanelEl.classList.contains('open'));
}
function openConfirmedPanel(){
  if(!confirmedPanelEl) return;
  confirmedPanelEl.classList.add('open');
  confirmedPanelEl.setAttribute('aria-hidden','false');
  document.body.classList.add('confirmed-panel-open');
  if(confirmedPanelToggle){
    confirmedPanelToggle.setAttribute('aria-expanded','true');
    confirmedPanelToggle.textContent = CONFIRMED_PANEL_TOGGLE_CLOSE_LABEL;
  }
}
function closeConfirmedPanel(){
  if(!confirmedPanelEl) return;
  confirmedPanelEl.classList.remove('open');
  confirmedPanelEl.setAttribute('aria-hidden','true');
  document.body.classList.remove('confirmed-panel-open');
  if(confirmedPanelToggle){
    confirmedPanelToggle.setAttribute('aria-expanded','false');
    confirmedPanelToggle.textContent = confirmedPanelToggleDefault;
  }
}
function toggleConfirmedPanel(){
  if(isConfirmedPanelOpen()){ closeConfirmedPanel(); }
  else{ openConfirmedPanel(); }
}
function getGroupDisplayIndex(cid){
  const key = String(cid ?? '');
  if(!key) return null;
  if(fullSummary?.indexByCid instanceof Map){
    const idx = fullSummary.indexByCid.get(key);
    if(Number.isFinite(idx)) return idx;
  }
  if(Array.isArray(fullSummary?.comps)){
    const found = fullSummary.comps.findIndex(c=>String(c.cid)===key);
    if(found>=0){
      const idx = found+1;
      if(fullSummary.indexByCid instanceof Map){ fullSummary.indexByCid.set(key, idx); }
      return idx;
    }
  }
  return null;
}
function setActiveGroup(cid, options){
  const opts = options || {};
  const target = cid === undefined || cid === null ? null : String(cid);
  activeGroupCid = target;
  const lists = [groupListEl, confirmedListEl].filter(Boolean);
  let activeEl=null;
  for(const list of lists){
    list.querySelectorAll('.group-item').forEach(el=>{
      const match = target!==null && el.dataset.cid===target;
      el.classList.toggle('active', match);
      if(match) activeEl=el;
    });
  }
  const preferScroll = opts.scroll !== undefined ? opts.scroll : (isGroupPanelOpen() || isConfirmedPanelOpen());
  if(activeEl && preferScroll){
    try{ activeEl.scrollIntoView({ block:'nearest', behavior: opts.behavior || 'smooth' }); }
    catch(err){
      try{ activeEl.scrollIntoView({ block:'nearest' }); }catch{}
    }
  }
}
function renderGroupList(preselect){
  if(!groupListEl){
    renderConfirmedList(null, preselect === undefined ? null : String(preselect));
    return;
  }
  if(!fullSummary){
    if(groupListCountEl) groupListCountEl.textContent = '等待加载';
    groupListEl.innerHTML = '<div class="placeholder hint">请先加载数据以查看同品组。</div>';
    renderConfirmedList(null, null);
    if(confirmedListCountEl) confirmedListCountEl.textContent = '0 组';
    activeGroupCid = null;
    return;
  }
  const minGroup = Number(document.getElementById('minGroup')?.value || 2);
  const comps = fullSummary.comps || [];
  const compIdSet = new Set(comps.map(c=>String(c.cid)));
  for(const cid of Array.from(confirmedGroups)){
    if(!compIdSet.has(cid)) confirmedGroups.delete(cid);
  }
  const pendingRaw = comps.filter(c=>c.size>=minGroup && !confirmedGroups.has(String(c.cid)));
  const confirmedRaw = comps.filter(c=>confirmedGroups.has(String(c.cid)));
  const pending = [];
  const seenPending=new Set();
  for(const c of pendingRaw){ const key=String(c.cid); if(!seenPending.has(key)){ seenPending.add(key); pending.push(c); } }
  const confirmed = [];
  const seenConfirmed=new Set();
  for(const c of confirmedRaw){ const key=String(c.cid); if(!seenConfirmed.has(key)){ seenConfirmed.add(key); confirmed.push(c); } }
  if(groupListCountEl){
    groupListCountEl.textContent = pending.length ? `待确认 ${pending.length} 组 · 节点 ≥ ${minGroup}` : '待确认 0 组';
  }
  if(confirmedListCountEl){
    confirmedListCountEl.textContent = confirmed.length ? `已确认 ${confirmed.length} 组` : '已确认 0 组';
  }
  const preselectKey = preselect === undefined || preselect === null ? null : String(preselect);
  const currentKey = preselectKey !== null ? preselectKey : activeGroupCid;
  const pendingHas = currentKey !== null && pending.some(c=>String(c.cid)===currentKey);
  const confirmedHas = currentKey !== null && confirmed.some(c=>String(c.cid)===currentKey);
  const selectedKey = (pendingHas || confirmedHas) ? currentKey : null;
  if(pending.length){
    const rows = pending.map((c, idx)=>{
      const cidRaw = String(c.cid ?? '');
      const displayIndex = getGroupDisplayIndex(cidRaw) ?? (idx + 1);
      const label = `第 ${displayIndex} 组`;
      const edgesCount = (EDGES_PER_COMP instanceof Map) ? EDGES_PER_COMP.get(String(c.cid)) : undefined;
      const metaRight = Number.isFinite(edgesCount) ? `节点 ${c.size} · 边 ${edgesCount}` : `节点 ${c.size}`;
      const klass = selectedKey !== null && String(c.cid) === selectedKey ? 'group-item active' : 'group-item';
      const padded = displayIndex.toString().padStart(2,'0');
      const titleAttr = cidRaw ? ` title="组ID：${escapeHtml(cidRaw)}"` : '';
      const idInfo = cidRaw ? ` · ${escapeHtml(cidRaw)}` : '';
      const pruned = typeof isGroupPruned === 'function' ? isGroupPruned(cidRaw) : false;
      const pruneLabel = pruned ? '撤销剔品' : '剔品推荐';
      const pruneClass = pruned ? 'prune prune--active' : 'prune';
      const pruneAttr = ` data-pruned="${pruned ? 'true' : 'false'}"`;
      return `<div class="${klass}" data-cid="${cidRaw}"><div class="meta"><span class="tag">#${padded}</span><span>${metaRight}</span></div><div class="title"${titleAttr}>${label}${idInfo}</div><div class="group-actions"><button type="button" data-action="focus">定位</button><button type="button" data-action="expand">展开</button><button type="button" data-action="prune" class="${pruneClass}"${pruneAttr}>${pruneLabel}</button><button type="button" data-action="confirm" class="confirm">确认</button></div></div>`;
    }).join('');
    groupListEl.innerHTML = rows;
  }else{
    groupListEl.innerHTML = '<div class="placeholder hint">暂无符合当前筛选的同品组。</div>';
  }
  renderConfirmedList(confirmed, selectedKey);
  setActiveGroup(selectedKey, { scroll:isGroupPanelOpen() || isConfirmedPanelOpen() });
}
function renderConfirmedList(list, selectedKey){
  if(!confirmedListEl) return;
  if(!list || !list.length){
    confirmedListEl.innerHTML = '<div class="placeholder hint">暂无已确认的同品组。</div>';
    return;
  }
  const rows = list.map((c, idx)=>{
    const cidRaw = String(c.cid ?? '');
    const displayIndex = getGroupDisplayIndex(cidRaw) ?? (idx + 1);
    const label = `第 ${displayIndex} 组`;
    const edgesCount = (EDGES_PER_COMP instanceof Map) ? EDGES_PER_COMP.get(String(c.cid)) : undefined;
    const metaRight = Number.isFinite(edgesCount) ? `节点 ${c.size} · 边 ${edgesCount}` : `节点 ${c.size}`;
    const klass = selectedKey !== null && String(c.cid) === selectedKey ? 'group-item active' : 'group-item';
    const padded = displayIndex.toString().padStart(2,'0');
    const titleAttr = cidRaw ? ` title="组ID：${escapeHtml(cidRaw)}"` : '';
    const idInfo = cidRaw ? ` · ${escapeHtml(cidRaw)}` : '';
    const pruned = typeof isGroupPruned === 'function' ? isGroupPruned(cidRaw) : false;
    const pruneLabel = pruned ? '撤销剔品' : '剔品推荐';
    const pruneClass = pruned ? 'prune prune--active' : 'prune';
    const pruneAttr = ` data-pruned="${pruned ? 'true' : 'false'}"`;
    return `<div class="${klass}" data-cid="${cidRaw}"><div class="meta"><span class="tag">#${padded}</span><span>${metaRight}</span></div><div class="title"${titleAttr}>${label}${idInfo}</div><div class="group-actions"><button type="button" data-action="focus">定位</button><button type="button" data-action="expand">展开</button><button type="button" data-action="prune" class="${pruneClass}"${pruneAttr}>${pruneLabel}</button><button type="button" data-action="undo" class="undo">撤销确认</button></div></div>`;
  }).join('');
  confirmedListEl.innerHTML = rows;
}
function confirmGroup(cid){
  cid = String(cid);
  if(!confirmedGroups.has(cid)){
    confirmedGroups.add(cid);
    if(confirmedPanelToggle && !isConfirmedPanelOpen()){
      openConfirmedPanel();
    }
  }
  renderGroupList(cid);
}
function undoConfirmGroup(cid){
  cid = String(cid);
  confirmedGroups.delete(cid);
  renderGroupList(cid);
}

function focusComponent(cid){
  if(!cid || !network) return;
  const targetId = 'C:'+cid;
  let node=null;
  if(nodesDS && typeof nodesDS.get === 'function'){
    try{ node = nodesDS.get(targetId); }catch(err){ node=null; }
  }
  if(node){
    try{
      const pos = network.getPositions([targetId])[targetId];
      network.selectNodes([targetId], true);
      if(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)){
        network.moveTo({ position:pos, scale:1.2, animation:true });
      }
    }catch(err){ console.warn('定位组件失败', err); }
    return;
  }
  const st = expandedState.get(cid);
  if(st && st.anchor){
    try{
      network.moveTo({ position:st.anchor, scale:1.2, animation:true });
    }catch(err){ console.warn('定位展开组件失败', err); }
  }
}

async function handleGroupPruneAction(cid, button){
  const cidKey = String(cid ?? '');
  if(!cidKey) return;
  if(typeof recommendPruneForGroup !== 'function' || typeof undoPruneForGroup !== 'function'){
    alert('剔品推荐功能尚未就绪');
    return;
  }
  setActiveGroup(cidKey);
  const originalText = button?.textContent || '';
  const pruned = typeof isGroupPruned === 'function' ? isGroupPruned(cidKey) : false;
  if(button){
    button.disabled = true;
    button.textContent = pruned ? '撤销中…' : '处理中…';
  }
  try{
    if(pruned){
      await undoPruneForGroup(cidKey);
    }else{
      await recommendPruneForGroup(cidKey);
    }
  }catch(err){
    console.error('group prune error', err);
    alert(err?.message || '剔品操作失败');
  }finally{
    renderGroupList(activeGroupCid ?? cidKey);
    if(button){
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

if(groupListEl){
  groupListEl.addEventListener('click', (ev)=>{
    const origin = ev.target instanceof Element ? ev.target : ev.target?.parentElement || null;
    if(!origin) return;
    const item = origin.closest('.group-item');
    if(!item) return;
    const cid = item.dataset.cid;
    if(!cid) return;
    const actionBtn = origin.closest('[data-action]');
    if(actionBtn){
      const action = actionBtn.dataset.action;
      if(action === 'expand'){ expandComponent(cid); setActiveGroup(cid); }
      else if(action === 'focus'){ focusComponent(cid); setActiveGroup(cid); }
      else if(action === 'prune'){ handleGroupPruneAction(cid, actionBtn); }
      else if(action === 'confirm'){ confirmGroup(cid); }
      ev.preventDefault();
      return;
    }
    focusComponent(cid);
    setActiveGroup(cid);
  });
}
if(confirmedListEl){
  confirmedListEl.addEventListener('click', (ev)=>{
    const origin = ev.target instanceof Element ? ev.target : ev.target?.parentElement || null;
    if(!origin) return;
    const item = origin.closest('.group-item');
    if(!item) return;
    const cid = item.dataset.cid;
    if(!cid) return;
    const actionBtn = origin.closest('[data-action]');
    if(actionBtn){
      const action = actionBtn.dataset.action;
      if(action === 'expand'){ expandComponent(cid); setActiveGroup(cid); }
      else if(action === 'focus'){ focusComponent(cid); setActiveGroup(cid); }
      else if(action === 'prune'){ handleGroupPruneAction(cid, actionBtn); }
      else if(action === 'undo'){ undoConfirmGroup(cid); }
      ev.preventDefault();
      return;
    }
    focusComponent(cid);
    setActiveGroup(cid);
  });
}
renderGroupList();
if(groupPanelToggle){
  groupPanelToggle.addEventListener('click', ()=>{ toggleGroupPanel(); });
}
if(groupPanelClose){
  groupPanelClose.addEventListener('click', ()=>{ closeGroupPanel(); });
}
if(confirmedPanelToggle){
  confirmedPanelToggle.addEventListener('click', ()=>{ toggleConfirmedPanel(); });
}
if(confirmedPanelClose){
  confirmedPanelClose.addEventListener('click', ()=>{ closeConfirmedPanel(); });
}
document.addEventListener('keydown', (ev)=>{
  if(ev.key === 'Escape'){
    let handled=false;
    if(isGroupPanelOpen()){ closeGroupPanel(); handled=true; }
    if(isConfirmedPanelOpen()){ closeConfirmedPanel(); handled=true; }
    if(handled){ ev.preventDefault(); }
  }
});

function renderCollapsed(){
  nodesDS.clear(); edgesDS.clear(); expandedState.clear(); firstBatchDoneForCid.clear();
  renderGroupList();
  if(!fullSummary) return;
  const minGroup=Number(document.getElementById('minGroup')?.value||2);
  const compsAll=fullSummary.comps;
  const comps=compsAll.filter(c=>c.size>=minGroup);
  const showSingles=(minGroup<=1);
  const capRaw=showSingles? GROUP_CAP_ALL : GROUP_CAP_NOSINGLES;
  GROUP_CAP=Math.max(8, capRaw||0);
  const showLabels=comps.length<=GROUP_LABEL_LIMIT;

  const nodes=comps.map(c=>({
    id:'C:'+c.cid, label: showLabels? ('n='+c.size):undefined, title:'n='+c.size, group:'COMP', value:c.size,
    color:{ background: colorGroupBySize(c.size), border:'#0b1020', highlight:{ background: colorGroupBySize(c.size) } },
    shape:'dot', size: Math.min(8 + Math.log2(1+c.size)*3.5, 36)
  }));
  const spacing = nodes.length<=150 ? 32 : nodes.length<=500 ? 28 : 26;
  const pos=gridPositions(nodes.length, spacing);
  for(let i=0;i<nodes.length;i++){ nodes[i].x=pos[i].x; nodes[i].y=pos[i].y; }
  nodesDS.add(nodes);
  renderGroupList();
  ensurePhysicsOn(); updateStats(); updateLegends(); network.fit({animation:true});
  document.getElementById('hint').textContent='双击组件可展开；双击节点看邻居；仅手动“暂停”才停止扩散。';
}
function ensurePhysicsOn(){ applyPhysics(); }

/* --------- 安全批量添加：requestAnimationFrame + try/catch --------- */
function getBatchConfig(){
  // 展开速度：影响每次注入的元素数量
  const v=Number(renderSpeed.value);
  // 节点/边 chunk；爆发=一次性大批量
  if(v===1) return { nodeChunk:300,  edgeChunk:800  };
  if(v===2) return { nodeChunk:1500, edgeChunk:3000 };
  if(v===3) return { nodeChunk:6000, edgeChunk:12000 };
  return { nodeChunk:1e9, edgeChunk:1e9 }; // 爆发
}
function addInFrames(items, chunkSize, onEach, onDone){
  let i=0;
  function step(){
    let count=0;
    try{
      while(i<items.length && count<chunkSize){
        const upto=Math.min(i+chunkSize, items.length);
        const chunk=items.slice(i, upto); i=upto; count+=chunk.length;
        try{ onEach(chunk); }catch(err){ console.error('批量添加异常', err); }
      }
    }catch(err){ console.error('切片循环异常', err); }
    if(i<items.length){ requestAnimationFrame(step); } else { onDone && onDone(); }
  }
  requestAnimationFrame(step);
}

/* --------- 展开/收起 --------- */
function expandComponent(cid, forceMode=null){
  cid = String(cid);
  const compInfo=fullSummary.comps.find(x=>String(x.cid)===cid); if(!compInfo) return;
  setActiveGroup(cid);
  const mode = forceMode || (compInfo.size<=FULL_NODE_LIMIT ? 'full':'prefix');

  if(!expandedState.has(cid)){
    expandedState.set(cid, { mode:null, nodes:new Set(), edges:new Set(), prefixClusters:new Set(), nodeToCid:new Map(), anchor:null, names:{} });
  }
  const nid='C:'+cid;
  let anchor={x:0,y:0};
  if(nodesDS.get(nid)){ const p=network.getPositions([nid])[nid]; if(p && Number.isFinite(p.x)){ anchor=p; } /* 不立刻删，等第一批完成再删 */ }
  const st=expandedState.get(cid); st.anchor=anchor;

  if(mode==='full'){
    requestComponent(cid, {needEdges:true, needPrefix:false}, ()=> renderFullComponent(cid, /*deferRemove=*/true));
  }else{
    requestComponent(cid, {needEdges:true, needPrefix:true}, ()=> renderPrefixClusters(cid, /*deferRemove=*/true));
  }
}
function collapseComponent(cid){
  cid = String(cid);
  const st=expandedState.get(cid);
  if(st){ nodesDS.remove(Array.from(st.nodes)); edgesDS.remove(Array.from(st.edges)); nodesDS.remove(Array.from(st.prefixClusters)); expandedState.delete(cid); }
  const comp=fullSummary.comps.find(c=>String(c.cid)===cid);
  const minGroup=Number(document.getElementById('minGroup')?.value||2);
  if(comp && comp.size>=minGroup){
    const n={ id:'C:'+cid, label:'n='+comp.size, title:'n='+comp.size, value:comp.size, group:'COMP',
      color:{ background: colorGroupBySize(comp.size), border:'#0b1020', highlight:{ background: colorGroupBySize(comp.size) } },
      shape:'dot', size: Math.min(8 + Math.log2(1+comp.size)*3.5, 36),
      x:(st?.anchor?.x||0)+(Math.random()*2-1)*5, y:(st?.anchor?.y||0)+(Math.random()*2-1)*5 };
    nodesDS.add(n);
  }
  updateStats(); ensurePhysicsOn();
}

function requestComponent(cid, opts, cb){
  cid = String(cid);
  document.getElementById('hint').textContent='加载组件数据：'+cid;
  if(useWorker && workerReady){
    const onData=(e)=>{
      if(e.data?.type==='componentData' && String(e.data.cid)===cid){
        worker.removeEventListener('message', onData);
        cacheComponentData(e.data); try{ cb(); }catch(err){ console.error(err); }
      }
    };
    worker.addEventListener('message', onData);
    worker.postMessage({type:'getComponent', cid, ...opts});
  }else{
    // 主线程构造
    let set=MT_ctx.comps.get(cid);
    if(!set){
      const numCid=Number(cid);
      if(!Number.isNaN(numCid)) set=MT_ctx.comps.get(numCid);
    }
    if(!set) set=new Set();
    const nodes=Array.from(set);
    const names={}, degrees={}; for(const id of nodes){ names[id]=MT_ctx.nameOf.get(id)||''; degrees[id]=(MT_ctx.adj.get(id)||new Set()).size; }
    let edges=null, prefixMap=null, prefixEdges=null;
    if(opts.needEdges){
      edges=[]; for(const key of MT_ctx.edgesGlobal){ const [a,b]=key.split('::'); if(set.has(a)&&set.has(b)) edges.push([a,b]); }
    }
    if(opts.needPrefix){
      const pmap=new Map(); for(const id of nodes){ const p=String(id).slice(0,3); if(!pmap.has(p)) pmap.set(p,[]); pmap.get(p).push(id); }
      prefixMap=Array.from(pmap.entries()).map(([prefix,arr])=>({prefix,nodes:arr}));
      if(edges){
        const cntMap=new Map(), insideCnt=new Map();
        for(const [a,b] of edges){ const pa=String(a).slice(0,3), pb=String(b).slice(0,3);
          if(pa===pb){ insideCnt.set(pa,(insideCnt.get(pa)||0)+1); }
          else{ const k=pa<pb?pa+'::'+pb:pb+'::'+pa; cntMap.set(k,(cntMap.get(k)||0)+1); }
        }
        prefixEdges={ cross:Array.from(cntMap.entries()).map(([k,c])=>({pair:k,count:c})), inside:Array.from(insideCnt.entries()).map(([p,c])=>({prefix:p,count:c})) };
      }
    }
    cacheComponentData({ type:'componentData', cid, nodes, names, degrees, edges, prefixMap, prefixEdges });
    try{ cb(); }catch(err){ console.error(err); }
  }
}
function cacheComponentData(data){
  const cid = String(data.cid);
  const st=expandedState.get(cid) || { nodes:new Set(), edges:new Set(), prefixClusters:new Set(), nodeToCid:new Map(), anchor:null, names:{} };
  const normalized = { ...data, cid };
  st._payload=normalized; st.names=normalized.names||st.names; expandedState.set(cid, st);
}

/* --------- 渲染：完整节点/边 --------- */
function renderFullComponent(cid, deferRemove){
  cid = String(cid);
  const st=expandedState.get(cid); if(!st || !st._payload) return;
  const payload=st._payload; st._payload=null; st.mode='full';

  const rawIds=payload.nodes||[]; const rawEdges=payload.edges||[]; const degrees=payload.degrees||{};
  const nodeIds=rawIds.filter(id=>!deletedNodes.has('N:'+id));
  const ring=ringPositions(nodeIds.length, Math.min(200 + nodeIds.length*0.02, 600), 10);
  const visNodes=nodeIds.map((id,i)=>({ id:'N:'+id, label:(nodeIds.length<=1500)? id:undefined,
    color:{ background: colorNodeByDegree(degrees[id]||0), border:'#0b1020' },
    x:st.anchor.x + ring[i].x, y:st.anchor.y + ring[i].y }));
  const edgeList=rawEdges.filter(([a,b])=>!deletedNodes.has('N:'+a) && !deletedNodes.has('N:'+b) && !deletedEdges.has(canonicalEdgeKey('N:'+a,'N:'+b)));

  const cfg=getBatchConfig();
  currentGroup={ cid, mode:'full', totalNodes:nodeIds.length, totalEdges:edgeList.length, addedNodes:0, addedEdges:0 };

  if(visNodes.length===0 && deferRemove){
    if(nodesDS.get('C:'+cid)){ try{ nodesDS.remove('C:'+cid); }catch{} }
    firstBatchDoneForCid.add(cid);
  }

  // 先注入节点，第一批完成后再移除组件气泡，避免“空屏”
  let firstBatchRemoved=false;
  addInFrames(visNodes, cfg.nodeChunk, (chunk)=>{
    nodesDS.add(chunk); chunk.forEach(n=>{ st.nodes.add(n.id); st.nodeToCid.set(n.id, cid); });
    currentGroup.addedNodes+=chunk.length;
    if(!firstBatchRemoved && deferRemove){
      // 第一批完成（至少一个 onEach）
      firstBatchRemoved=true;
      if(nodesDS.get('C:'+cid)){ try{ nodesDS.remove('C:'+cid); }catch{} }
      firstBatchDoneForCid.add(cid);
    }
  }, ()=>{
    // 再注入边
    const visEdges=edgeList.map(([a,b],i)=>({ id:`E:${cid}:${i}`, from:'N:'+a, to:'N:'+b }));
    addInFrames(visEdges, cfg.edgeChunk, (chunk)=>{
      edgesDS.add(chunk); chunk.forEach(e=> st.edges.add(e.id)); currentGroup.addedEdges+=chunk.length;
    }, ()=>{
      ensurePhysicsOn(); updateStats();
      document.getElementById('hint').textContent='组件已展开；布局将持续“扩散”，仅手动“暂停”才会停止。';
      currentGroup=null; updateETA();
    });
  });
}

