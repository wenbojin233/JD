let rawDataRows=[];
let rawTableCodeIndex=0;
let rawTableHeader=[];
let rawTableFallbackCodeIndexes=[];
let rawTableRelationIndexes=[];
let rawTableNameIndex=-1;
let rawTableSameIdIndex=-1;
const NAME_HEADER_KEYWORDS_LOWER=['同品商品ID','名称','商品名称','物料名称','品名','标题','name','Name'];
const SAME_ID_HEADER_KEYWORDS_LOWER=['同品商品ID','同品ID','商品ID'];
let graphNameIndex=new Map();
if(typeof window!=='undefined'){ window.graphNameIndex = graphNameIndex; }
const FALLBACK_CODE_KEYWORDS_LOWER=['同品','候选','归属','主品','聚品','剔除','吞并','victim','candidate','中心','合并'];
const FALLBACK_CODE_ID_HINTS_LOWER=['编码','id'];
const CANDIDATE_CODE_OBJECT_KEYS=['candidate_code','candidateCode','code','id','ID','sku','SKU','商品编码','物料编码','同品组编码','归属主品编码','merge_code','group_code'];
const CODE_TOKEN_REGEX=/[0-9A-Za-z][0-9A-Za-z_-]{3,}/;
const RELATION_HEADER_KEYWORDS_LOWER=['同品','候选','关联','相似','邻','neighbor','peer','link','链接'];
const RELATION_HEADER_ID_HINTS_LOWER=['id','编码','code'];
const RAW_TABLE_SCROLL_STEP_MIN=160;
const RAW_TABLE_SCROLL_STEP_RATIO=0.7;
const TABLE_IDS={
  graph:{
    placeholderId:'rawTablePlaceholder',
    scrollId:'rawTableScroll',
    scrollInnerId:'rawTableScrollInner',
    metaId:'rawTableMeta',
    tableId:'rawDataTable',
    footId:'rawTableFoot',
    hScrollId:'rawTableHScroll',
    hScrollScrollerId:'rawTableHScrollScroller',
    hScrollSpacerId:'rawTableHScrollSpacer',
    scrollLeftBtnId:'rawTableScrollLeft',
    scrollRightBtnId:'rawTableScrollRight'
  },
  merge:{
    placeholderId:'mergeTablePlaceholder',
    scrollId:'mergeTableScroll',
    scrollInnerId:'mergeTableScrollInner',
    metaId:'mergeTableMeta',
    tableId:'mergeDataTable',
    footId:'mergeTableFoot',
    hScrollId:'mergeTableHScroll',
    hScrollScrollerId:'mergeTableHScrollScroller',
    hScrollSpacerId:'mergeTableHScrollSpacer',
    scrollLeftBtnId:'mergeTableScrollLeft',
    scrollRightBtnId:'mergeTableScrollRight'
  }
};
const tableGroupCollapseState={
  graph:new Map(),
  merge:new Map()
};
const tablePrimaryCollapseState={
  graph:new Map(),
  merge:new Map()
};
const GRAPH_GROUP_COLOR_CLASSES=['merge-group--a','merge-group--b','merge-group--c','merge-group--d','merge-group--e'];
const MERGE_TABLE_COLUMN_DEFS=[
  { key:'seq', label:'剔品组' },
  { key:'keepCode', label:'建议保留 · 商品编码' },
  { key:'keepName', label:'建议保留 · 商品名称' },
  { key:'dropCode', label:'建议剔除 · 商品编码' },
  { key:'dropName', label:'建议剔除 · 商品名称' }
];
let groupToggleListenerBound=false;
if(typeof document!=='undefined'){
  try{ document.body.setAttribute('data-skgene-build','v20250217'); }catch(err){}
}
function createTableContext(key, ids){
  return {
    key,
    ids,
    rows:[],
    dataByCode:new Map(),
    renderedRowMap:new Map(),
    primaryRowMap:new Map(),
    activeRow:null,
    scrollEl:null,
    hScrollEl:null,
    hScrollScroller:null,
    hScrollSpacer:null,
    footEl:null,
    scrollSyncBound:false,
    scrollSyncing:false,
    resizeObserver:null,
    tableObserved:false,
    windowResizeBound:false,
    scrollButtonsBound:false,
    scrollLeftBtn:null,
    scrollRightBtn:null,
    pendingScrollbarFrame:null
  };
}
const tableContexts={
  graph:createTableContext('graph', TABLE_IDS.graph),
  merge:createTableContext('merge', TABLE_IDS.merge)
};
function getTableContext(key){
  return tableContexts[key] || null;
}
function normalizeCode(code){
  return String(code ?? '').trim().replace(/^N:/,'');
}
function detectFallbackCodeIndexes(headerRow){
  if(!Array.isArray(headerRow)) return [];
  const indexes=[];
  headerRow.forEach((cell, idx)=>{
    if(idx===rawTableCodeIndex) return;
    const label=String(cell??'').trim().toLowerCase();
    if(!label) return;
    if(matchesFallbackCodeHeader(label)){
      indexes.push(idx);
    }
  });
  return indexes;
}
function matchesFallbackCodeHeader(labelLower){
  if(!labelLower) return false;
  const hasIdHint = FALLBACK_CODE_ID_HINTS_LOWER.some(h=> labelLower.includes(h));
  if(!hasIdHint) return false;
  return FALLBACK_CODE_KEYWORDS_LOWER.some(keyword=> labelLower.includes(keyword));
}
function detectRelationIndexes(headerRow){
  if(!Array.isArray(headerRow)) return [];
  const indexes=[];
  headerRow.forEach((cell, idx)=>{
    if(idx===rawTableCodeIndex) return;
    const label=String(cell??'').trim().toLowerCase();
    if(!label) return;
    if(matchesRelationHeader(label)){
      indexes.push(idx);
    }
  });
  return indexes;
}

function detectNameColumnIndex(headerRow){
  if(!Array.isArray(headerRow)) return -1;
  for(let i=0;i<headerRow.length;i++){
    const label = String(headerRow[i]??'').trim().toLowerCase();
    if(!label) continue;
    if(NAME_HEADER_KEYWORDS_LOWER.some(keyword=> label.includes(keyword.toLowerCase()))){
      return i;
    }
  }
  return -1;
}

function detectSameIdColumnIndex(headerRow){
  if(!Array.isArray(headerRow)) return -1;
  for(let i=0;i<headerRow.length;i++){
    const raw=String(headerRow[i]??'').trim();
    if(!raw) continue;
    const lower=raw.toLowerCase();
    if(SAME_ID_HEADER_KEYWORDS_LOWER.some(keyword=> lower.includes(keyword.toLowerCase()))){
      return i;
    }
  }
  return -1;
}
function matchesRelationHeader(labelLower){
  if(!labelLower) return false;
  const hasKeyword = RELATION_HEADER_KEYWORDS_LOWER.some(keyword=> labelLower.includes(keyword));
  if(!hasKeyword) return false;
  return RELATION_HEADER_ID_HINTS_LOWER.some(hint=> labelLower.includes(hint));
}
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
  try{
    if(typeof syncGraphStats === 'function'){ syncGraphStats(e); }
  }catch(err){ console.warn('syncGraphStats failed', err); }

  EDGES_PER_COMP = new Map((fullSummary.edgesByComp||[]).map(o=>[String(o.cid), o.count||0]));
  rawTableCodeIndex = Number.isInteger(e.codeIndex) ? e.codeIndex : 0;
  setRawDataRows(Array.isArray(e.rawRows)? e.rawRows : []);
  renderCollapsed(); updateLegends(); setStatus(`已加载：节点 ${e.totalNodes} · 边 ${e.totalEdges} · 组件 ${e.comps.length}`);
  setProgress(100,'解析完成，可展开并持续扩散。'); applyPhysics();
}
function updateLegends(){
  const gcapEl=document.getElementById('gcap');
  if(gcapEl) gcapEl.textContent = String(GROUP_CAP||0);
  const gmaxEl=document.getElementById('gmaxNote');
  if(gmaxEl) gmaxEl.textContent = 'MAX: '+(GROUP_MAX||0);
  const dcapEl=document.getElementById('dcap');
  if(dcapEl) dcapEl.textContent = String(DEGREE_CAP||0);
  const dmaxEl=document.getElementById('dmaxNote');
  if(dmaxEl) dmaxEl.textContent = 'MAX: '+(DEGREE_MAX||0);
}
function datasetSize(ds){ return (typeof ds.length==='number')? ds.length : ds.getIds().length; }
function updateStats(){
  const nodesEl=document.getElementById('nodesBadge');
  if(nodesEl) nodesEl.textContent='节点数: '+datasetSize(nodesDS);
  const edgesEl=document.getElementById('edgesBadge');
  if(edgesEl) edgesEl.textContent='边数: '+datasetSize(edgesDS);
  const totalComps=fullSummary? fullSummary.comps.length:0;
  const minGroup=Number(document.getElementById('minGroup')?.value||2);
  const shownComps=fullSummary? fullSummary.comps.filter(c=>c.size>=minGroup).length : 0;
  const hidden=Math.max(0, totalComps-shownComps);
  const compEl=document.getElementById('compBadge');
  if(compEl) compEl.textContent='组件数: '+shownComps+(hidden? '（隐藏 '+hidden+'）':'');
  const maxComp=GROUP_MAX||0;
  const maxEl=document.getElementById('maxCompBadge');
  if(maxEl) maxEl.textContent='最大组件大小: '+maxComp;
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
    groupListEl.innerHTML = '<div class="placeholder hint">请先加载数据以查看大组。</div>';
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
      return `<div class="${klass}" data-cid="${cidRaw}"><div class="meta"><span class="tag">#${padded}</span><span>${metaRight}</span></div><div class="title"${titleAttr}>${label}${idInfo}</div><div class="group-actions"><button type="button" data-action="focus">定位</button><button type="button" data-action="expand">展开</button><button type="button" data-action="prune" class="${pruneClass}"${pruneAttr}>${pruneLabel}</button><button type="button" data-action="prune-ultimate" class="secondary">究极剔品</button>${pruned ? '<button data-action="prune-detail" class="secondary">剔品详情</button>' : ''}
<button type="button" data-action="confirm" class="confirm">确认</button></div></div>`;
    }).join('');
    groupListEl.innerHTML = rows;
  }else{
    groupListEl.innerHTML = '<div class="placeholder hint">暂无符合当前筛选的大组。</div>';
  }
  renderConfirmedList(confirmed, selectedKey);
  setActiveGroup(selectedKey, { scroll:isGroupPanelOpen() || isConfirmedPanelOpen() });
}
function renderConfirmedList(list, selectedKey){
  if(!confirmedListEl) return;
  if(!list || !list.length){
    confirmedListEl.innerHTML = '<div class="placeholder hint">暂无已确认的大组。</div>';
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
    return `<div class="${klass}" data-cid="${cidRaw}"><div class="meta"><span class="tag">#${padded}</span><span>${metaRight}</span></div><div class="title"${titleAttr}>${label}${idInfo}</div><div class="group-actions"><button type="button" data-action="focus">定位</button><button type="button" data-action="expand">展开</button><button type="button" data-action="prune" class="${pruneClass}"${pruneAttr}>${pruneLabel}</button><button type="button" data-action="prune-ultimate" class="secondary">究极剔品</button><button type="button" data-action="undo" class="undo">撤销确认</button></div></div>`;
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

// 修改 handleGroupPruneAction 函数
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
      // 关闭剔品详情面板
      const panel = document.getElementById('pruneDetailPanel');
      if(panel) panel.classList.remove('open');
    }else{
      await recommendPruneForGroup(cidKey);
      // 自动显示剔品详情
      if(typeof showPruneDetails === 'function'){
        showPruneDetails(cidKey);
      }
    }
  }catch(err){
    console.error('group prune error', err);
    alert(err?.message || '剔品操作失败');
  }finally{
    renderGroupList(activeGroupCid ?? cidKey);
    if(button){
      if(button.isConnected){
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }
}

async function handleGroupUltimateAction(cid, button){
  const cidKey = String(cid ?? '');
  if(!cidKey) return;
  if(typeof ultimatePruneForGroup !== 'function'){
    alert('究极剔品功能尚未就绪');
    return;
  }
  setActiveGroup(cidKey);
  const originalText = button?.textContent || '';
  if(button){
    button.disabled = true;
    button.textContent = '处理中…';
  }
  try{
    if(typeof isGroupPruned === 'function' && isGroupPruned(cidKey)){
      try{ await undoPruneForGroup(cidKey); }catch(err){ console.warn('undo before ultimate failed', err); }
    }
    await ultimatePruneForGroup(cidKey);
    if(typeof showPruneDetails === 'function'){
      showPruneDetails(cidKey);
    }
  }catch(err){
    console.error('ultimate prune error', err);
    alert(err?.message || '究极剔品操作失败');
  }finally{
    renderGroupList(activeGroupCid ?? cidKey);
    if(button){
      if(button.isConnected){
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }
}

// 添加剔品详情面板的关闭按钮事件
const closePruneDetailBtn = document.getElementById('closePruneDetail');
if(closePruneDetailBtn){
  closePruneDetailBtn.addEventListener('click', ()=>{
    const panel = document.getElementById('pruneDetailPanel');
    if(panel){
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
  });
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
      else if(action === 'prune-ultimate'){ handleGroupUltimateAction(cid, actionBtn); }
      else if(action === 'prune-detail'){ showPruneDetail(cid); }
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
      else if(action === 'prune-ultimate'){ handleGroupUltimateAction(cid, actionBtn); }
      else if(action === 'prune-detail'){ showPruneDetail(cid); }
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
// 在 ESC 键处理中添加关闭剔品详情面板
document.addEventListener('keydown', (ev)=>{
  if(ev.key === 'Escape'){
    let handled=false;
    const prunePanel = document.getElementById('pruneDetailPanel');
    if(prunePanel && prunePanel.classList.contains('open')){
      prunePanel.classList.remove('open');
      prunePanel.setAttribute('aria-hidden', 'true');
      handled=true;
    }
    if(isGroupPanelOpen()){ closeGroupPanel(); handled=true; }
    if(isConfirmedPanelOpen()){ closeConfirmedPanel(); handled=true; }
    if(handled){ ev.preventDefault(); }
  }
});

function showPruneDetail(cid){
  try{
    const key = String(cid ?? '');
    if(!key){ alert('无效的组件ID'); return; }
    if(typeof groupPruneRecords === 'undefined'){
      alert('暂无剔品详情'); return;
    }
    const rec = groupPruneRecords.get(key);
    if(!rec || !rec.length){
      alert('该组件当前没有可用的剔品详情'); return;
    }

    // 1) 构建 “被吞并 -> 吞并者” 与 “吞并者 -> 子节点们” 映射
    const parent = new Map();      // victimId(N:xx) -> mergerId(N:xx)
    const children = new Map();    // mergerId(N:xx) -> Set(victimId)
    for(const e of rec){
      const v = e?.node?.id;     // 形如 'N:AEW000004'
      const m = e?.mergedBy;     // 形如 'N:AFW000002'
      if(!v || !m) continue;
      parent.set(v, m);
      if(!children.has(m)) children.set(m, new Set());
      children.get(m).add(v);
    }

    // 2) 根吞并者：没有被别人吞过的 merger
    const allMergers = new Set(Array.from(children.keys()));
    for(const v of parent.keys()){ allMergers.delete(v); } // 被别人吞过的不是根
    const roots = Array.from(allMergers).sort();

    // 3) 友好标签（ID + 可选名称）
    const pickName = (idN) => {
      const id = String(idN||'').replace(/^N:/,'');
      const nm = (expandedState.get(key)?.names?.[id]) || (MT_ctx?.nameOf?.get?.(id)) || '';
      return nm ? `${id}（${nm}）` : id;
    };

    // 4) 递归格式化为 “A 吞并 B（B 吞并 C …）”
    const fmtChain = (mergerId) => {
      const kids = Array.from(children.get(mergerId)||[]);
      if(kids.length===0) return pickName(mergerId);
      const parts = kids.sort().map(v=>{
        const subKids = children.get(v);
        if(subKids && subKids.size){
          return `${pickName(v)}（${pickName(v)} 吞并 ${Array.from(subKids).sort().map(x=>fmtChain(x)).join('、')}）`;
        }
        return pickName(v);
      });
      return `${pickName(mergerId)} 吞并 ${parts.join('、')}`;
    };

    // 5) 输出（若意外没有根，就退化为逐条）
    const lines = roots.length
      ? roots.map((r, idx)=> `${(idx+1).toString().padStart(2,'0')}. ${fmtChain(r)}`)
      : rec.map((e, idx)=>{
          const victim = (e?.node?.id || '').replace(/^N:/,'') || '(未知)';
          const merged = (e?.mergedBy || '').replace(/^N:/,'') || '（随机/无）';
          return `${(idx+1).toString().padStart(2,'0')}. ${merged} 吞并 ${victim}`;
        });

    alert(`组件 ${key} · 剔品详情（吞并关系链）\n\n` + lines.join('\n'));
  }catch(err){
    console.error('showPruneDetail error', err);
    alert('剔品详情展示失败');
  }
}








function renderCollapsed(){
  if((!nodesDS || !edgesDS) && typeof initNetwork==='function'){
    try{ initNetwork(); }catch(err){ console.warn('initNetwork失败', err); }
  }
  if(!nodesDS || !edgesDS){
    console.warn('网络尚未初始化，跳过渲染');
    return;
  }
  nodesDS?.clear?.(); edgesDS?.clear?.();
  expandedState.clear(); firstBatchDoneForCid.clear();
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
  const hintEl=document.getElementById('hint');
  if(hintEl) hintEl.textContent='双击组件可展开；双击节点看邻居；仅手动“暂停”才停止扩散。';
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
  const hintEl=document.getElementById('hint');
  if(hintEl) hintEl.textContent='加载组件数据：'+cid;
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
      const hintEl=document.getElementById('hint');
      if(hintEl) hintEl.textContent='组件已展开；布局将持续“扩散”，仅手动“暂停”才会停止。';
      currentGroup=null; updateETA();
    });
  });
}

function setRawDataRows(rows){
  rawDataRows = Array.isArray(rows) ? rows : [];
  const headerRow = Array.isArray(rawDataRows[0]) ? rawDataRows[0] : [];
  rawTableHeader = headerRow.slice();
  rawTableFallbackCodeIndexes = detectFallbackCodeIndexes(headerRow);
  rawTableRelationIndexes = detectRelationIndexes(headerRow);
  rawTableNameIndex = detectNameColumnIndex(headerRow);
  rawTableSameIdIndex = detectSameIdColumnIndex(headerRow);
  const bodyRows = rawDataRows.slice(1);
  initializeTableDataFromBody(bodyRows);
  renderTableContext('graph');
  renderTableContext('merge');
}

function initializeTableDataFromBody(bodyRows){
  const graphCtx=getTableContext('graph');
  const mergeCtx=getTableContext('merge');
  const normalized = Array.isArray(bodyRows) ? bodyRows : [];
  graphCtx.rows = normalized.map((row, idx)=> createRowData(row, idx));
  assignClosestPrimaryCodes(graphCtx.rows);
  graphCtx.dataByCode = new Map();
  graphCtx.rows.forEach(entry=>{ if(entry.code){ graphCtx.dataByCode.set(entry.code, entry); } });
  buildGraphNameIndex(graphCtx.rows);
  mergeCtx.rows = [];
  mergeCtx.dataByCode = new Map();
  tableGroupCollapseState.graph.clear();
  tableGroupCollapseState.merge.clear();
  tablePrimaryCollapseState.graph.clear();
  tablePrimaryCollapseState.merge.clear();
  hydrateMergeTableFromPruneRecords();
}

function createRowData(row, index, meta){
  const cells = Array.isArray(row) ? row.slice() : [];
  const rawCode = extractCodeFromCells(cells);
  const code = normalizeCode(rawCode);
  const entryMeta = meta ? { ...meta } : {};
  const primaryCellCode = readPrimaryColumnValue(cells);
  entryMeta.displayName = readNameColumnValue(cells);
  return { code, rawCode, cells, originalIndex:index, meta: entryMeta, primaryCellCode };
}

function extractCodeFromCells(cells){
  if(!Array.isArray(cells)) return '';
  const primary = extractCodeByIndex(cells, rawTableCodeIndex);
  if(primary) return primary;
  const fallback = extractCodeFromFallbackColumns(cells);
  return fallback || '';
}

function extractCodeByIndex(cells, idx){
  if(!Array.isArray(cells) || !Number.isInteger(idx)) return '';
  if(idx<0 || idx>=cells.length) return '';
  return normalizeCandidateCellValue(cells[idx]);
}

function readPrimaryColumnValue(cells){
  if(!Array.isArray(cells)) return '';
  const idx = Number.isInteger(rawTableCodeIndex) ? rawTableCodeIndex : 0;
  if(idx<0 || idx>=cells.length) return '';
  const value=cells[idx];
  return value===undefined || value===null ? '' : String(value).trim();
}

function readNameColumnValue(cells){
  if(!Array.isArray(cells)) return '';
  const idx = Number.isInteger(rawTableNameIndex) ? rawTableNameIndex : -1;
  if(idx<0 || idx>=cells.length) return '';
  const value=cells[idx];
  return value===undefined || value===null ? '' : String(value).trim();
}

function extractCodeFromFallbackColumns(cells){
  if(!Array.isArray(cells) || !rawTableFallbackCodeIndexes.length) return '';
  for(const idx of rawTableFallbackCodeIndexes){
    const code=extractCodeByIndex(cells, idx);
    if(code) return code;
  }
  return '';
}

function normalizeCandidateCellValue(value){
  if(value===undefined || value===null) return '';
  if(typeof value==='number'){
    return Number.isFinite(value)? normalizeCode(String(value)) : '';
  }
  if(typeof value==='string'){
    const trimmed=value.trim();
    if(!trimmed) return '';
    if((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))){
      try{
        const parsed=JSON.parse(trimmed);
        const nested=normalizeCandidateCellValue(parsed);
        if(nested) return nested;
      }catch(err){ /* ignore */ }
    }
    return extractCodeTokenFromText(trimmed);
  }
  if(Array.isArray(value)){
    for(const item of value){
      const inner=normalizeCandidateCellValue(item);
      if(inner) return inner;
    }
    return '';
  }
  if(typeof value==='object'){
    for(const key of CANDIDATE_CODE_OBJECT_KEYS){
      if(Object.prototype.hasOwnProperty.call(value, key)){
        const code=normalizeCandidateCellValue(value[key]);
        if(code) return code;
      }
    }
    try{
      const serialized=JSON.stringify(value);
      const code=extractCodeTokenFromText(serialized);
      if(code) return code;
    }catch(err){ /* ignore */ }
    return '';
  }
  return extractCodeTokenFromText(String(value));
}

function extractCodeTokenFromText(text){
  if(!text) return '';
  const match=text.match(CODE_TOKEN_REGEX);
  if(!match || !match[0]) return '';
  return normalizeCode(match[0]);
}

function assignClosestPrimaryCodes(entries){
  if(!Array.isArray(entries) || !entries.length) return;
  let lastPrimary='';
  entries.forEach(entry=>{
    if(!entry || typeof entry!=='object') return;
    if(!entry.meta) entry.meta={};
    const primaryRaw = entry.primaryCellCode ? String(entry.primaryCellCode).trim() : '';
    const normalizedPrimary = primaryRaw ? normalizeCode(primaryRaw) : '';
    if(normalizedPrimary){
      lastPrimary = normalizedPrimary;
      entry.meta.closestPrimaryCode = normalizedPrimary;
    }else{
      entry.meta.closestPrimaryCode = lastPrimary || '';
    }
  });
}

function buildGraphNameIndex(entries){
  graphNameIndex = new Map();
  if(Array.isArray(entries)){
    entries.forEach(entry=>{
      const code=entry?.code;
      const name=String(entry?.meta?.displayName||'').trim();
      if(!code || !name) return;
      const key=name.toLowerCase();
      if(!graphNameIndex.has(key)){
        graphNameIndex.set(key, code);
      }
    });
  }
  if(typeof window!=='undefined'){
    window.graphNameIndex = graphNameIndex;
  }
}

function handleRelationRemovalBetweenCodes(codeA, codeB){
  const normalizedA=normalizeCode(codeA);
  const normalizedB=normalizeCode(codeB);
  if(!normalizedA || !normalizedB) return;
  let needsRender=false;
  if(removeRelationFromEntry(normalizedA, normalizedB)) needsRender=true;
  if(removeRelationFromEntry(normalizedB, normalizedA)) needsRender=true;
  if(hideRelationRows(normalizedA, normalizedB)) needsRender=true;
  if(hideRelationRows(normalizedB, normalizedA)) needsRender=true;
  const mergeUpdated = updateMergeTableAfterRelationRemoval(normalizedA, normalizedB);
  if(needsRender || mergeUpdated){
    renderTableContext('graph');
    renderTableContext('merge');
  }
}

function removeRelationFromEntry(code, targetCode){
  const ctx=getTableContext('graph');
  if(!ctx || !Array.isArray(ctx.rows)) return false;
  if(!rawTableRelationIndexes.length) return false;
  const normalizedTarget=normalizeCode(targetCode);
  const normalizedCode=normalizeCode(code);
  if(!normalizedTarget) return false;
  if(!normalizedCode) return false;
  let changed=false;
  ctx.rows.forEach(entry=>{
    const entryCode=normalizeCode(entry?.code || entry?.rawCode || '');
    if(entryCode!==normalizedCode) return;
    rawTableRelationIndexes.forEach(idx=>{
      const res=stripCodeFromRelationCell(entry.cells[idx], normalizedTarget);
      if(res.changed){
        entry.cells[idx]=res.value;
        updateRawRowCell(entry, idx, res.value);
        changed=true;
      }
    });
  });
  return changed;
}

function stripCodeFromRelationCell(value, targetCode){
  if(value===undefined || value===null) return {changed:false};
  if(typeof value==='string'){
    const tokens=value.split(/[,，]/).map(t=>t.trim()).filter(Boolean);
    if(!tokens.length) return {changed:false};
    const filtered=tokens.filter(token=> normalizeCode(token)!==targetCode);
    if(filtered.length===tokens.length) return {changed:false};
    return {changed:true, value:filtered.join(',')};
  }
  if(Array.isArray(value)){
    const filtered=value.filter(token=> normalizeCode(typeof token==='string'? token : '')!==targetCode);
    if(filtered.length===value.length) return {changed:false};
    return {changed:true, value:filtered};
  }
  return {changed:false};
}

function updateRawRowCell(entry, colIdx, newValue){
  if(!entry || !Number.isInteger(entry.originalIndex)) return;
  const rawIndex = entry.originalIndex + 1;
  if(Array.isArray(rawDataRows[rawIndex])){
    rawDataRows[rawIndex][colIdx]=newValue;
  }
}

function updateMergeTableAfterRelationRemoval(codeA, codeB){
  const ctx=getTableContext('merge');
  if(!ctx || !ctx.dataByCode) return false;
  const ops=[
    { victim:codeA, partner:codeB },
    { victim:codeB, partner:codeA }
  ];
  let changed=false;
  ops.forEach(({victim, partner})=>{
    const entry=getMergeEntryByCode(ctx, victim);
    if(!entry) return;
    const currentMerger=normalizeCode(entry.meta?.mergerCode || '');
    if(!currentMerger || currentMerger!==normalizeCode(partner)) return;
    entry.meta = Object.assign({}, entry.meta || {});
    entry.meta.mergerCode = entry.code;
    entry.meta.cid = `split:${entry.code}`;
    entry.meta.closestPrimaryCode = entry.code;
    entry.primaryCellCode = entry.code;
    changed=true;
  });
  return changed;
}

function getMergeEntryByCode(ctx, code){
  if(!ctx || !ctx.dataByCode || !code) return null;
  const normalized=normalizeCode(code);
  return ctx.dataByCode.get(normalized) || ctx.dataByCode.get(code) || null;
}

function hideRelationRows(primaryCode, targetCode){
  const ctx=getTableContext('graph');
  if(!ctx || !Array.isArray(ctx.rows)) return false;
  if(!primaryCode || !targetCode) return false;
  const normalizedPrimary=normalizeCode(primaryCode);
  const normalizedTarget=normalizeCode(targetCode);
  if(!normalizedPrimary || !normalizedTarget) return false;
  let changed=false;
  ctx.rows.forEach(entry=>{
    if(!entry) return;
    const entryPrimary=normalizeCode(entry.meta?.closestPrimaryCode || '');
    const entryCode=normalizeCode(entry.code || entry.rawCode || '');
    if(entryPrimary!==normalizedPrimary) return;
    if(entryCode!==normalizedTarget) return;
    const primaryCell=normalizeCode(entry.primaryCellCode || '');
    if(primaryCell && primaryCell===entryCode) return; // skip主行
    if(!entry.meta) entry.meta={};
    if(!entry.meta.hiddenUnderPrimary){
      entry.meta.hiddenUnderPrimary=new Set();
    }
    if(!entry.meta.hiddenUnderPrimary.has(normalizedPrimary)){
      entry.meta.hiddenUnderPrimary.add(normalizedPrimary);
      changed=true;
    }
  });
  return changed;
}

function isGraphRowHidden(entry){
  if(!entry || !entry.meta) return false;
  const closest=normalizeCode(entry.meta.closestPrimaryCode || '');
  const hidden=entry.meta.hiddenUnderPrimary;
  if(hidden && typeof hidden.has==='function'){
    if(hidden.has(closest)) return true;
  }
  return false;
}

function renderRawDataTable(){ renderTableContext('graph'); }
function renderMergeDataTable(){ renderTableContext('merge'); }

function renderTableContext(key){
  const ctx=getTableContext(key);
  if(!ctx) return;
  const placeholder=document.getElementById(ctx.ids.placeholderId);
  const scrollWrapper=document.getElementById(ctx.ids.scrollId);
  const meta=document.getElementById(ctx.ids.metaId);
  const table=document.getElementById(ctx.ids.tableId);
  const foot=document.getElementById(ctx.ids.footId);
  if(foot){ ctx.footEl=foot; }
  if(!placeholder || !scrollWrapper || !meta || !table) return;
  if(key==='merge'){
    renderMergeTableView(ctx,{ placeholder, scrollWrapper, meta, table });
  }else{
    renderGraphTableView(ctx,{ placeholder, scrollWrapper, meta, table });
  }
}

function buildTableColumnOrder(rows, { includeScore=true }={}){
  const safeRows = Array.isArray(rows)? rows : [];
  const header=Array.isArray(rawTableHeader)? rawTableHeader : [];
  const reasonIndex=findReasonColumnIndex();
  const pillColumnIndexRaw = Number.isInteger(rawTableSameIdIndex) ? rawTableSameIdIndex : -1;
  const maxRowCellsLen = Math.max(...safeRows.map(row=> Array.isArray(row.cells)? row.cells.length : 0), header.length || 0, 1);
  const baseColumns=[];
  for(let i=0;i<maxRowCellsLen;i++){
    const label = header[i] !== undefined && header[i] !== '' ? header[i] : `列${i+1}`;
    baseColumns.push({
      label,
      sourceIndex:i,
      isReason:i===reasonIndex,
      isPill:i===pillColumnIndexRaw,
      kind:'data'
    });
  }
  const columnOrder=[];
  let reasonColumn=null;
  baseColumns.forEach(col=>{
    if(col.isReason){
      reasonColumn=col;
      return;
    }
    columnOrder.push(col);
  });
  if(includeScore && reasonColumn){
    columnOrder.push({
      label:'同品分数',
      kind:'score',
      reasonIndex
    });
  }
  if(reasonColumn){
    reasonColumn.kind='reason';
    columnOrder.push(reasonColumn);
  }
  if(!columnOrder.length){
    columnOrder.push({
      label:'列1',
      sourceIndex:0,
      kind:'data',
      isReason:false,
      isPill:false
    });
  }
  return {
    columnOrder,
    columnCount:columnOrder.length,
    scoreColumnIndex: columnOrder.findIndex(col=>col.kind==='score'),
    pillColumnIndex: columnOrder.findIndex(col=>col.isPill),
    reasonSourceIndex:reasonIndex
  };
}

function mapCellsToColumnOrder(cells, columnOrder, scoreOverride){
  const source = Array.isArray(cells)? cells : [];
  return columnOrder.map(col=>{
    if(col.kind==='score'){
      return scoreOverride ?? '';
    }
    if(Number.isInteger(col.sourceIndex)){
      return source[col.sourceIndex];
    }
    return '';
  });
}

function buildRowScoreMap(rows, { reasonIndex=-1 }={}){
  if(!Array.isArray(rows) || !rows.length || !Number.isInteger(reasonIndex) || reasonIndex<0){
    return null;
  }
  const map=new Map();
  const scoreCache=new Map();
  rows.forEach(entry=>{
    if(!entry || !Array.isArray(entry.cells)){
      map.set(entry, '');
      return;
    }
    const primary=normalizeCode(entry.meta?.closestPrimaryCode || '');
    const entryCode=normalizeCode(entry.code || '');
    const reasonCell=entry.cells[reasonIndex];
    if(primary && entryCode && primary===entryCode){
      const parsed=extractScoreMapFromReasonCell(reasonCell);
      if(parsed && parsed.size){
        scoreCache.set(primary, parsed);
      }
      map.set(entry, '');
      return;
    }
    let assigned='';
    if(primary && scoreCache.has(primary)){
      let normalizedCandidate = normalizeCode(entryCode || '');
      if(!normalizedCandidate && Number.isInteger(rawTableSameIdIndex) && rawTableSameIdIndex>=0){
        normalizedCandidate = normalizeCode(normalizeCandidateCellValue(entry.cells[rawTableSameIdIndex]) || '');
      }
      if(normalizedCandidate){
        const lookup=scoreCache.get(primary).get(normalizedCandidate);
        if(lookup!==undefined){
          assigned=lookup;
        }
      }
    }
    if(!assigned){
      assigned = extractScoreFromReasonCell(reasonCell);
    }
    map.set(entry, assigned);
  });
  return map;
}

function extractScoreMapFromReasonCell(cell){
  if(cell===undefined || cell===null) return null;
  const text=String(cell).trim();
  if(!text) return null;
  let parsed=null;
  if((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))){
    try{ parsed=JSON.parse(text); }catch(err){ parsed=null; }
  }
  if(!parsed) return null;
  const map=new Map();
  collectScoreEntries(parsed, map);
  return map.size? map : null;
}

function collectScoreEntries(value, map){
  if(!value || !map) return;
  if(Array.isArray(value)){
    value.forEach(item=> collectScoreEntries(item, map));
    return;
  }
  if(typeof value==='object'){
    let candidate='';
    for(const key of CANDIDATE_CODE_OBJECT_KEYS){
      if(Object.prototype.hasOwnProperty.call(value, key)){
        const parsed=normalizeCandidateCellValue(value[key]);
        if(parsed){
          candidate=parsed;
          break;
        }
      }
    }
    if(candidate){
      const score=formatScoreValue(value.score);
      if(score!==''){
        map.set(candidate, score);
      }
    }
    if(Array.isArray(value.reasons)){
      collectScoreEntries(value.reasons, map);
    }
  }
}

function renderGraphTableView(ctx,{ placeholder, scrollWrapper, meta, table }){
  ctx.tableEl=table;
  const rows=Array.isArray(ctx.rows)? ctx.rows : [];
  if(!rows.length){
    table.innerHTML='';
    scrollWrapper.hidden=true;
    placeholder.hidden=false;
    placeholder.setAttribute('aria-hidden','false');
    meta.textContent='尚未加载';
    if(ctx.footEl){
      ctx.footEl.hidden=true;
      ctx.footEl.setAttribute('aria-hidden','true');
    }
    ctx.renderedRowMap=new Map();
    ctx.primaryRowMap=new Map();
    ctx.activeRow=null;
    updateScrollButtonsState(ctx);
    return;
  }
  placeholder.hidden=true;
  placeholder.setAttribute('aria-hidden','true');
  scrollWrapper.hidden=false;
  const columnConfig=buildTableColumnOrder(rows, { includeScore:true });
  const { columnOrder, columnCount, scoreColumnIndex, pillColumnIndex, reasonSourceIndex } = columnConfig;
  const scoreMap = (scoreColumnIndex>=0) ? buildRowScoreMap(rows, { reasonIndex:reasonSourceIndex }) : null;
  const headCells=columnOrder.map((col, idx)=>{
    const thClasses=[];
    if(idx===scoreColumnIndex) thClasses.push('col-score');
    const thClassAttr = thClasses.length? ` class="${thClasses.join(' ')}"` : '';
    return `<th scope="col"${thClassAttr}>${escapeRawCell(col.label)}</th>`;
  });
  const groups=buildGraphComponentGroupList(rows);
  const colWidths = buildGraphColumnRules(columnCount, { scoreIndex:scoreColumnIndex, pillIndex:pillColumnIndex });
  const buildDisplayCells=(row)=> mapCellsToColumnOrder(row.cells, columnOrder, scoreMap?.get(row));
  let sections='';
  if(groups.length){
    sections=groups.map((group, idx)=>{
      const colorClass = GRAPH_GROUP_COLOR_CLASSES[idx % GRAPH_GROUP_COLOR_CLASSES.length];
      const collapsed = tableGroupCollapseState.graph.get(group.key);
      const headerRow=`<tr class="merge-group__header merge-group__header-row ${colorClass}"><td colspan="${columnCount}"><div class="group-header"><button type="button" class="group-toggle" data-table="graph" data-group="${escapeAttr(group.key)}" aria-expanded="${collapsed? 'false':'true'}" aria-label="切换大组"><span class="group-toggle__icon"></span></button><span>大组 ${idx+1} · ${group.rows.length} 个节点</span></div></td></tr>`;
      const rowsHtml=group.rows.map(row=>{
        if(isGraphRowHidden(row)) return '';
        const attrs = buildRowDataAttributes(row);
        const displayCells = buildDisplayCells(row);
        const rowScore = scoreMap?.get(row) ?? '';
        return `<tr class="raw-table-row ${colorClass}"${attrs}>${renderTableCells(displayCells, columnCount, { scoreIndex:scoreColumnIndex, pillIndex:pillColumnIndex, row, rowScore })}</tr>`;
      }).join('');
      return `<tbody class="merge-group ${colorClass}${collapsed? ' is-collapsed':''}" data-group="${escapeAttr(group.key)}" data-table="graph">${headerRow}${rowsHtml}</tbody>`;
    }).join('');
  }
  if(!sections){
    const bodyHtml = rows.map(row=>{
      const attrs = buildRowDataAttributes(row);
      const displayCells = buildDisplayCells(row);
      const rowScore = scoreMap?.get(row) ?? '';
      return `<tr class="raw-table-row"${attrs}>${renderTableCells(displayCells, columnCount, { scoreIndex:scoreColumnIndex, pillIndex:pillColumnIndex, row, rowScore })}</tr>`;
    }).join('');
    sections = `<tbody>${bodyHtml}</tbody>`;
  }
  const colgroup = colWidths ? `<colgroup>${colWidths}</colgroup>` : '';
  table.innerHTML = `${colgroup}<thead><tr>${headCells.join('')}</tr></thead>${sections}`;
  ctx.tableEl=table;
  ctx.renderedRowMap=new Map();
  ctx.primaryRowMap=new Map();
  const bodyRows=table.querySelectorAll('tbody tr.raw-table-row');
  bodyRows.forEach(rowEl=>{
    const code=rowEl.getAttribute('data-code');
    if(code){ ctx.renderedRowMap.set(normalizeCode(code), rowEl); }
    const primary=rowEl.getAttribute('data-primary-code');
    if(primary){ ctx.primaryRowMap.set(normalizeCode(primary), rowEl); }
    rowEl.addEventListener('click', ()=>{
      if(code){ highlightRawTableRow(code, { scroll:false, view:'graph' }); }
      else{
        if(ctx.activeRow && ctx.activeRow!==rowEl){ ctx.activeRow.classList.remove('is-highlighted'); }
        ctx.activeRow=rowEl;
        rowEl.classList.add('is-highlighted');
      }
      const focusTarget=rowEl.getAttribute('data-closest-primary') || code;
      const normalized=normalizeCode(focusTarget);
      if(normalized){
        try{ if(typeof focusGraphNode === 'function'){ focusGraphNode(normalized, { center:true, select:true }); } }
        catch(err){}
      }
    });
  });
  ctx.activeRow=null;
  const totalRows = rows.length + (rawTableHeader.length ? 1 : 0);
  meta.textContent = `${totalRows} 行（含表头） · ${columnCount} 列`;
  ensureTableScrollSync(ctx);
  scheduleTableScrollbarUpdate(ctx);
  updateScrollButtonsState(ctx);
  bindGroupCollapseControls();
  setupPrimaryRowToggles(ctx);
}

const MERGE_GROUP_COLOR_CLASSES=['merge-group--a','merge-group--b','merge-group--c','merge-group--d','merge-group--e'];

function renderMergeTableView(ctx,{ placeholder, scrollWrapper, meta, table }){
  ctx.tableEl=table;
  const rows=Array.isArray(ctx.rows)? ctx.rows : [];
  if(!rows.length){
    table.innerHTML='';
    scrollWrapper.hidden=true;
    placeholder.hidden=false;
    placeholder.setAttribute('aria-hidden','false');
    meta.textContent='暂无吞并数据';
    if(ctx.footEl){
      ctx.footEl.hidden=true;
      ctx.footEl.setAttribute('aria-hidden','true');
    }
    ctx.renderedRowMap=new Map();
    ctx.primaryRowMap=new Map();
    ctx.activeRow=null;
    updateScrollButtonsState(ctx);
    return;
  }
  placeholder.hidden=true;
  placeholder.setAttribute('aria-hidden','true');
  scrollWrapper.hidden=false;
  const columnConfig=buildTableColumnOrder(rows, { includeScore:false });
  const { columnOrder, columnCount, pillColumnIndex } = columnConfig;
  const headCells=columnOrder.map(col=> `<th scope="col">${escapeRawCell(col.label)}</th>`);
  const colgroupMarkup = buildGraphColumnRules(columnCount,{ scoreIndex:-1, pillIndex:pillColumnIndex });
  const buildDisplayCells=(row)=> mapCellsToColumnOrder(row.cells, columnOrder);
  const groups=buildMergeGroups(rows);
  if(!groups.length){
    const colgroup = colgroupMarkup ? `<colgroup>${colgroupMarkup}</colgroup>` : '';
    table.innerHTML = `${colgroup}<thead><tr>${headCells.join('')}</tr></thead><tbody><tr><td colspan="${columnCount}" class="raw-table-empty">暂无吞并数据</td></tr></tbody>`;
    meta.textContent='暂无吞并数据';
    ctx.renderedRowMap=new Map();
    ctx.primaryRowMap=new Map();
    ensureTableScrollSync(ctx);
    scheduleTableScrollbarUpdate(ctx);
    updateScrollButtonsState(ctx);
    return;
  }
  const sections=groups.map((group, idx)=>{
    const colorClass = MERGE_GROUP_COLOR_CLASSES[idx % MERGE_GROUP_COLOR_CLASSES.length];
    const groupLabel = group.centerLabel || group.centerCode || '未指定中心';
    const dataKey=`merge:${group.key}`;
    const collapsed=tableGroupCollapseState.merge.get(dataKey);
    const headerRow=`<tr class="merge-group__header merge-group__header-row ${colorClass}"><td colspan="${columnCount}"><div class="group-header"><button type="button" class="group-toggle" data-table="merge" data-group="${escapeAttr(dataKey)}" aria-expanded="${collapsed? 'false':'true'}" aria-label="切换同品组"><span class="group-toggle__icon"></span></button><span>剔品组 ${idx+1} · 中心节点：${escapeRawCell(groupLabel)}${group.cid ? ` · 组件 ${escapeRawCell(group.cid)}`:''}</span></div></td></tr>`;
    const centerRow = generateMergeRow({
      columnCount,
      entry:group.centerEntry,
      fallbackCode:group.centerCode,
      fallbackLabel:group.centerLabel,
      colorClass:`merge-group__center ${colorClass}`,
      emptyText:'暂无中心节点数据',
      pillIndex:pillColumnIndex,
      displayCells:group.centerEntry? buildDisplayCells(group.centerEntry) : null
    });
    const victimRows = group.victims.length
      ? group.victims.map(victim=> generateMergeRow({
          columnCount,
          entry:victim,
          fallbackCode:victim.code,
          colorClass:`merge-group__victim ${colorClass}`,
          pillIndex:pillColumnIndex,
          displayCells:buildDisplayCells(victim)
        })).join('')
      : `<tr class="merge-group__empty ${colorClass}"><td colspan="${columnCount}">暂无被吞节点</td></tr>`;
    return `<tbody class="merge-group ${colorClass}${collapsed? ' is-collapsed':''}" data-group="${escapeAttr(dataKey)}" data-table="merge">${headerRow}${centerRow}${victimRows}</tbody>`;
  }).join('');
  const colgroup = colgroupMarkup ? `<colgroup>${colgroupMarkup}</colgroup>` : '';
  table.innerHTML = `${colgroup}<thead><tr>${headCells.join('')}</tr></thead>${sections}`;
  ctx.tableEl=table;
  ctx.renderedRowMap=new Map();
  ctx.primaryRowMap=new Map();
  ctx.primaryRowMap=new Map();
  table.querySelectorAll('tbody tr.raw-table-row').forEach(row=>{
    const code=row.getAttribute('data-code');
    if(code){ ctx.renderedRowMap.set(normalizeCode(code), row); }
    const primary=row.getAttribute('data-primary-code');
    if(primary){ ctx.primaryRowMap.set(normalizeCode(primary), row); }
    if(code){
      row.addEventListener('click', ()=>{
        highlightRawTableRow(code, { scroll:false, view:'merge' });
        try{ if(typeof focusMergeNode === 'function'){ focusMergeNode(code, { center:true, select:true }); } }
        catch(err){}
      });
    }
  });
  ctx.activeRow=null;
  meta.textContent = `共 ${groups.length} 个吞并组 · ${rows.length} 个被吞节点`;
  ensureTableScrollSync(ctx);
  scheduleTableScrollbarUpdate(ctx);
  updateScrollButtonsState(ctx);
  bindGroupCollapseControls();
  setupPrimaryRowToggles(ctx);
}

function buildMergeGroups(rows){
  const groups=new Map();
  rows.forEach(row=>{
    const meta=row.meta || {};
    const centerCode=normalizeCode(meta.mergerCode) || row.code;
    const cid=meta.cid || '';
    const key=`${cid}::${centerCode||row.code}`;
    if(!groups.has(key)){
      groups.set(key,{
        key,
        cid,
        centerCode,
        centerEntry:null,
        centerLabel:centerCode,
        victims:[]
      });
    }
    groups.get(key).victims.push(row);
  });
  const graphCtx=tableContexts.graph;
  groups.forEach(group=>{
    if(group.centerCode && graphCtx?.dataByCode){
      const entry=graphCtx.dataByCode.get(group.centerCode);
      if(entry){
        group.centerEntry=entry;
        group.centerLabel=entry.cells?.[rawTableCodeIndex] || group.centerCode;
      }
    }
    if(!group.centerLabel){
      group.centerLabel=group.centerCode || '未指定';
    }
  });
  return Array.from(groups.values()).sort((a,b)=> (a.centerCode||'').localeCompare(b.centerCode||''));
}

function buildGraphComponentGroupList(rows){
  const compGroups=new Map();
  const leftovers=[];
  rows.forEach(row=>{
    const cid=lookupComponentIdForCode(row.code);
    if(cid){
      if(!compGroups.has(cid)){
        compGroups.set(cid,{ key:`comp:${cid}`, cid:String(cid), label:null, rows:[] });
      }
      compGroups.get(cid).rows.push(row);
    }else{
      leftovers.push(row);
    }
  });
  const ordered=[];
  if(Array.isArray(fullSummary?.comps)){
    fullSummary.comps.forEach(comp=>{
      const cid=String(comp.cid);
      const grp=compGroups.get(cid);
      if(grp && grp.rows.length){
        grp.label = grp.rows[0]?.code || cid;
        ordered.push(grp);
        compGroups.delete(cid);
      }
    });
  }
  compGroups.forEach(grp=>{
    grp.label = grp.label || grp.rows[0]?.code || grp.cid || grp.key;
    ordered.push(grp);
  });
  const autoGroups=buildGraphAutoGroups(leftovers);
  autoGroups.forEach(group=>{
    ordered.push({ key:`auto:${group.key}`, label:group.label, rows:group.rows });
  });
  return ordered;
}

function buildGraphAutoGroups(rows){
  const map=new Map();
  rows.forEach(row=>{
    const code=row.code || row.rawCode || '';
    const prefix=code? code.slice(0,3).toUpperCase() : '未分组';
    if(!map.has(prefix)){
      map.set(prefix,{ key:prefix, label:prefix, rows:[] });
    }
    map.get(prefix).rows.push(row);
  });
  return Array.from(map.values()).sort((a,b)=> a.label.localeCompare(b.label));
}

function lookupComponentIdForCode(code){
  if(code===undefined || code===null) return null;
  const plain=String(code).replace(/^N:/,'').trim();
  if(!plain) return null;
  if(typeof getComponentIdByCode==='function'){
    try{
      const cid=getComponentIdByCode(plain);
      if(cid!==undefined && cid!==null && cid!==''){ return String(cid); }
    }catch(err){ /* ignore */ }
  }
  try{
    if(MT_ctx?.compOf instanceof Map){
      if(MT_ctx.compOf.has(plain)){
        const cid=MT_ctx.compOf.get(plain);
        if(cid!==undefined && cid!==null) return String(cid);
      }
      const num=Number(plain);
      if(!Number.isNaN(num) && MT_ctx.compOf.has(num)){
        const cid=MT_ctx.compOf.get(num);
        if(cid!==undefined && cid!==null) return String(cid);
      }
    }
  }catch(err){ /* ignore */ }
  return null;
}

function generateMergeRow({ columnCount, entry, fallbackCode, fallbackLabel, colorClass, emptyText='暂无数据', pillIndex=-1, displayCells=null }){
  if(entry && Array.isArray(displayCells)){
    const attrs = buildRowDataAttributes(entry);
    return `<tr class="raw-table-row ${colorClass||''}"${attrs}>${renderTableCells(displayCells, columnCount, { scoreIndex:-1, pillIndex, row:entry })}</tr>`;
  }
  const text = fallbackLabel || fallbackCode || emptyText;
  const codeAttr = fallbackCode ? ` data-code="${escapeAttr(fallbackCode)}"` : '';
  return `<tr class="raw-table-row ${colorClass||''}"${codeAttr}><td colspan="${columnCount}">${escapeRawCell(text)}</td></tr>`;
}

function ensureTableScrollSync(ctx){
  if(!ctx || ctx.scrollSyncBound) return;
  ctx.scrollEl=document.getElementById(ctx.ids.scrollInnerId);
  ctx.hScrollEl=document.getElementById(ctx.ids.hScrollId);
  ctx.hScrollScroller=document.getElementById(ctx.ids.hScrollScrollerId);
  ctx.hScrollSpacer=document.getElementById(ctx.ids.hScrollSpacerId);
  if(!ctx.scrollEl || !ctx.hScrollScroller) return;
  ctx.scrollEl.addEventListener('scroll', ()=> onTableDataScroll(ctx), { passive:true });
  ctx.hScrollScroller.addEventListener('scroll', ()=> onTableProxyScroll(ctx), { passive:true });
  ctx.scrollSyncBound=true;
  bindTableScrollButtons(ctx);
  if(typeof ResizeObserver==='function' && !ctx.resizeObserver){
    ctx.resizeObserver=new ResizeObserver(()=> scheduleTableScrollbarUpdate(ctx));
    try{ ctx.resizeObserver.observe(ctx.scrollEl); }catch(err){}
  }else if(typeof window!=='undefined' && !ctx.windowResizeBound){
    window.addEventListener('resize', ()=> scheduleTableScrollbarUpdate(ctx));
    ctx.windowResizeBound=true;
  }
}

function bindTableScrollButtons(ctx){
  if(ctx.scrollButtonsBound) return;
  ctx.scrollLeftBtn=document.getElementById(ctx.ids.scrollLeftBtnId);
  ctx.scrollRightBtn=document.getElementById(ctx.ids.scrollRightBtnId);
  if(!ctx.scrollLeftBtn || !ctx.scrollRightBtn) return;
  ctx.scrollLeftBtn.addEventListener('click', ()=> scrollTableBy(ctx,-1));
  ctx.scrollRightBtn.addEventListener('click', ()=> scrollTableBy(ctx,1));
  ctx.scrollButtonsBound=true;
}

function scrollTableBy(ctx, direction){
  if(!ctx) return;
  ctx.scrollEl = ctx.scrollEl || document.getElementById(ctx.ids.scrollInnerId);
  if(!ctx.scrollEl) return;
  const base=ctx.scrollEl.clientWidth||0;
  const step=Math.max(RAW_TABLE_SCROLL_STEP_MIN, base * RAW_TABLE_SCROLL_STEP_RATIO);
  const delta=direction * step;
  if(typeof ctx.scrollEl.scrollBy==='function'){
    try{ ctx.scrollEl.scrollBy({ left:delta, behavior:'smooth' }); }
    catch(err){ ctx.scrollEl.scrollLeft += delta; }
  }else{
    ctx.scrollEl.scrollLeft += delta;
  }
  requestAnimationFrame(()=> updateScrollButtonsState(ctx));
}

function updateScrollButtonsState(ctx){
  if(!ctx) return;
  ctx.scrollLeftBtn = ctx.scrollLeftBtn || document.getElementById(ctx.ids.scrollLeftBtnId);
  ctx.scrollRightBtn = ctx.scrollRightBtn || document.getElementById(ctx.ids.scrollRightBtnId);
  ctx.scrollEl = ctx.scrollEl || document.getElementById(ctx.ids.scrollInnerId);
  if(!ctx.scrollLeftBtn || !ctx.scrollRightBtn || !ctx.scrollEl){
    if(ctx.scrollLeftBtn) ctx.scrollLeftBtn.disabled=true;
    if(ctx.scrollRightBtn) ctx.scrollRightBtn.disabled=true;
    return;
  }
  const scrollWidth=ctx.scrollEl.scrollWidth;
  const maxScroll=Math.max(0, scrollWidth - ctx.scrollEl.clientWidth);
  const hasHorizontal = maxScroll>1;
  const current=ctx.scrollEl.scrollLeft;
  ctx.scrollLeftBtn.disabled = !hasHorizontal || current <= 1;
  ctx.scrollRightBtn.disabled = !hasHorizontal || current >= (maxScroll - 1);
}

function scheduleTableScrollbarUpdate(ctx){
  if(!ctx) return;
  if(ctx.pendingScrollbarFrame){
    if(typeof cancelAnimationFrame==='function') cancelAnimationFrame(ctx.pendingScrollbarFrame);
    else clearTimeout(ctx.pendingScrollbarFrame);
  }
  const run=()=>{
    ctx.pendingScrollbarFrame=null;
    updateTableHorizontalScrollbar(ctx);
  };
  if(typeof requestAnimationFrame==='function') ctx.pendingScrollbarFrame=requestAnimationFrame(run);
  else ctx.pendingScrollbarFrame=setTimeout(run,0);
}

function updateTableHorizontalScrollbar(ctx){
  if(!ctx) return;
  ctx.scrollEl = ctx.scrollEl || document.getElementById(ctx.ids.scrollInnerId);
  ctx.hScrollEl = ctx.hScrollEl || document.getElementById(ctx.ids.hScrollId);
  ctx.hScrollScroller = ctx.hScrollScroller || document.getElementById(ctx.ids.hScrollScrollerId);
  ctx.hScrollSpacer = ctx.hScrollSpacer || document.getElementById(ctx.ids.hScrollSpacerId);
  ctx.footEl = ctx.footEl || document.getElementById(ctx.ids.footId);
  const table=document.getElementById(ctx.ids.tableId);
  if(ctx.resizeObserver && table && !ctx.tableObserved){
    try{ ctx.resizeObserver.observe(table); ctx.tableObserved=true; }catch(err){}
  }
  if(!ctx.scrollEl || !ctx.hScrollEl || !ctx.hScrollScroller || !ctx.hScrollSpacer){
    updateScrollButtonsState(ctx);
    return;
  }
  const scrollWidth = ctx.scrollEl.scrollWidth;
  const needsHorizontal = (scrollWidth - ctx.scrollEl.clientWidth) > 1;
  if(needsHorizontal){
    if(ctx.footEl){ ctx.footEl.hidden=false; ctx.footEl.setAttribute('aria-hidden','false'); }
    ctx.hScrollEl.hidden=false;
    ctx.hScrollEl.setAttribute('aria-hidden','false');
    ctx.hScrollSpacer.style.width = scrollWidth+'px';
    if(Math.abs(ctx.hScrollScroller.scrollLeft - ctx.scrollEl.scrollLeft) > 1){
      ctx.hScrollScroller.scrollLeft = ctx.scrollEl.scrollLeft;
    }
  }else{
    if(ctx.footEl){ ctx.footEl.hidden=true; ctx.footEl.setAttribute('aria-hidden','true'); }
    ctx.hScrollEl.hidden=true;
    ctx.hScrollEl.setAttribute('aria-hidden','true');
  }
  updateScrollButtonsState(ctx);
}

function onTableDataScroll(ctx){
  if(!ctx || ctx.scrollSyncing) return;
  ctx.scrollSyncing=true;
  if(ctx.hScrollScroller){ ctx.hScrollScroller.scrollLeft = ctx.scrollEl.scrollLeft; }
  ctx.scrollSyncing=false;
  updateScrollButtonsState(ctx);
}

function onTableProxyScroll(ctx){
  if(!ctx || ctx.scrollSyncing) return;
  ctx.scrollSyncing=true;
  if(ctx.scrollEl){ ctx.scrollEl.scrollLeft = ctx.hScrollScroller.scrollLeft; }
  ctx.scrollSyncing=false;
  updateScrollButtonsState(ctx);
}

function moveRowsBetweenContexts(items, fromKey, toKey, { restoreOrder=false }={}){
  const fromCtx=getTableContext(fromKey);
  const toCtx=getTableContext(toKey);
  if(!fromCtx || !toCtx || !Array.isArray(items) || !items.length) return;
  const normalized=items.map(item=>{
    if(typeof item==='string'){
      const code=String(item||'').trim();
      return code? { code } : null;
    }
    if(item && typeof item==='object' && item.code){
      const code=String(item.code||'').trim();
      return code? { code, meta:item.meta } : null;
    }
    return null;
  }).filter(Boolean);
  if(!normalized.length) return;
  const seen=new Set();
  const moved=[];
  for(const entryInfo of normalized){
    if(seen.has(entryInfo.code)) continue;
    seen.add(entryInfo.code);
    const entry=removeRowDataFromContext(fromCtx, entryInfo.code);
    if(entry){
      if(entryInfo.meta){
        entry.meta = Object.assign({}, entry.meta || {}, entryInfo.meta);
      }
      moved.push(entry);
    }
  }
  if(!moved.length) return;
  moved.forEach(entry=> insertRowDataIntoContext(toCtx, entry, { restoreOrder: restoreOrder && toKey==='graph' }));
  renderTableContext(fromKey);
  renderTableContext(toKey);
}

function removeRowDataFromContext(ctx, code){
  if(!ctx || !code || !ctx.dataByCode) return null;
  const entry=ctx.dataByCode.get(code);
  if(!entry) return null;
  const idx=ctx.rows.indexOf(entry);
  if(idx>-1) ctx.rows.splice(idx,1);
  ctx.dataByCode.delete(code);
  return entry;
}

function insertRowDataIntoContext(ctx, entry, { restoreOrder=false }={}){
  if(!ctx || !entry) return;
  if(restoreOrder && Number.isFinite(entry.originalIndex)){
    let inserted=false;
    for(let i=0;i<ctx.rows.length;i++){
      const current=ctx.rows[i];
      if(!Number.isFinite(current.originalIndex) || current.originalIndex > entry.originalIndex){
        ctx.rows.splice(i,0,entry);
        inserted=true;
        break;
      }
    }
    if(!inserted) ctx.rows.push(entry);
  }else{
    ctx.rows.push(entry);
  }
  if(entry.code){ ctx.dataByCode.set(entry.code, entry); }
}

function syncTableRowsAfterUltimate({ entries, cid }={}){
  if(!Array.isArray(entries) || !entries.length) return;
  const items=[];
  entries.forEach(entry=>{
    const code = getEntryCode(entry);
    if(!code) return;
    const mergerCode = normalizeCode(entry?.mergedBy) || code;
    items.push({ code, meta:{ mergerCode, cid } });
    entry.__movedToMerge=true;
  });
  if(items.length){ moveRowsBetweenContexts(items, 'graph','merge'); }
}

function restoreTableRowsAfterUltimate({ entries }={}){
  if(!Array.isArray(entries) || !entries.length) return;
  const items=[];
  entries.forEach(entry=>{
    if(entry?.__movedToMerge){
      const code=getEntryCode(entry);
      if(code) items.push(code);
      entry.__movedToMerge=false;
    }
  });
  if(items.length){ moveRowsBetweenContexts(items,'merge','graph',{ restoreOrder:true }); }
}

function getEntryCode(entry){
  const nodeId = entry?.node?.id || '';
  return nodeId ? normalizeCode(nodeId) : '';
}

function hydrateMergeTableFromPruneRecords(){
  const records = getGlobalPruneRecords();
  if(!records || typeof records.forEach!=='function') return;
  const items=[];
  records.forEach((entries, cidKey)=>{
    if(!Array.isArray(entries) || !entries.length) return;
    entries.forEach(entry=>{
      const code=getEntryCode(entry);
      if(!code) return;
      const mergerCode=normalizeCode(entry?.mergedBy) || '';
      const metaCid = entry?.cid ? String(entry.cid) : String(cidKey ?? '');
      items.push({
        code,
        meta:{
          mergerCode: mergerCode || code,
          cid: metaCid
        }
      });
      entry.__movedToMerge=true;
    });
  });
  if(items.length){
    moveRowsBetweenContexts(items,'graph','merge');
  }
}

function getGlobalPruneRecords(){
  try{
    if(typeof groupPruneRecords!=='undefined' && groupPruneRecords instanceof Map){
      return groupPruneRecords;
    }
  }catch(err){ /* ignore */ }
  if(typeof globalThis!=='undefined' && globalThis.groupPruneRecords instanceof Map){
    return globalThis.groupPruneRecords;
  }
  return null;
}


function escapeRawCell(value){
  if(value===null || value===undefined) return '';
  let text='';
  if(typeof value==='object'){
    try{ text=JSON.stringify(value); }
    catch(err){ text=String(value); }
  }else{
    text=String(value);
  }
  return text
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/\r?\n/g,'<br/>');
}

function escapeAttr(value){
  return String(value??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function highlightRawTableRow(code,{scroll=true, view='graph'}={}){
  if(!code) return false;
  const ctx=getTableContext(view);
  if(!ctx || !ctx.renderedRowMap) return false;
  const normalized=normalizeCode(code);
  const row = (ctx.primaryRowMap && normalized) ? (ctx.primaryRowMap.get(normalized) || ctx.renderedRowMap.get(normalized)) : ctx.renderedRowMap.get(normalized || String(code));
  if(!row) return false;
  if(ctx.activeRow && ctx.activeRow!==row){
    ctx.activeRow.classList.remove('is-highlighted');
  }
  ctx.activeRow=row;
  row.classList.add('is-highlighted');
  if(scroll){
    try{
      row.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }catch(err){
      row.scrollIntoView({ block:'nearest' });
    }
  }
  return true;
}

function bootstrapTables(){
  renderTableContext('graph');
  renderTableContext('merge');
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', bootstrapTables);
  }else{
    bootstrapTables();
  }
}

if(typeof window!=='undefined'){
  window.highlightRawTableRow = highlightRawTableRow;
  window.syncTableRowsAfterUltimate = syncTableRowsAfterUltimate;
  window.restoreTableRowsAfterUltimate = restoreTableRowsAfterUltimate;
  window.handleRelationRemovalBetweenCodes = handleRelationRemovalBetweenCodes;
}
function buildRowDataAttributes(entry){
  if(!entry || typeof entry!=='object') return '';
  const parts=[];
  if(entry.code){ parts.push(`data-code="${escapeAttr(entry.code)}"`); }
  if(Number.isFinite(entry.originalIndex)){ parts.push(`data-row-index="${entry.originalIndex}"`); }
  if(entry.primaryCellCode){
    parts.push(`data-primary-code="${escapeAttr(entry.primaryCellCode)}"`);
    parts.push('data-row-kind="primary"');
  }else{
    parts.push('data-row-kind="child"');
  }
  if(entry.meta?.closestPrimaryCode){
    parts.push(`data-closest-primary="${escapeAttr(entry.meta.closestPrimaryCode)}"`);
  }
  return parts.length? ' '+parts.join(' ') : '';
}
function renderTableCells(cells, columnCount, { scoreIndex=-1, pillIndex=-1, row=null, rowScore='' }={}){
  const out=[];
  for(let i=0;i<columnCount;i++){
    const value = Array.isArray(cells) ? cells[i] : '';
    const classNames=[];
    if(i===scoreIndex) classNames.push('col-score');
    if(i===pillIndex && pillIndex>=0) classNames.push('col-pill');
    const classAttr = classNames.length? ` class="${classNames.join(' ')}"` : '';
    let content = (pillIndex>=0 && i===pillIndex) ? renderPillCell(value, { row, rowScore }) : escapeRawCell(value);
    if(i===1){
      content = `<span class="cell-inner cell-inner--name">${content}</span>`;
    }
    out.push(`<td${classAttr}>${content}</td>`);
  }
  return out.join('');
}

function buildGraphColumnRules(columnCount, { scoreIndex=-1, pillIndex=-1 }={}){
  if(columnCount<=0) return '';
  const cols=[];
  for(let i=0;i<columnCount;i++){
    const styleParts=[];
    const classNames=[];
    if(i===pillIndex && pillIndex>=0){
      styleParts.push('width:680px');
      classNames.push('col-pill-col');
    }
    if(i===scoreIndex && scoreIndex>=0){
      styleParts.push('width:110px');
      classNames.push('col-score-col');
    }
    const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
    const classAttr = classNames.length ? ` class="${classNames.join(' ')}"` : '';
    cols.push(`<col${classAttr}${styleAttr}>`);
  }
  return cols.join('');
}

function renderPillCell(value, { row=null, rowScore='' }={}){
  const text=String(value??'').trim();
  if(!text){
    return '<span class="cell-pill is-empty">—</span>';
  }
  const tokens=text.split(/[,，;；\s\n]+/).map(t=>t.trim()).filter(Boolean);
  if(!tokens.length){
    return `<span class="cell-pill">${escapeInlineText(text)}</span>`;
  }
  const parts=[];
  tokens.forEach((token, idx)=>{
    parts.push(`<span class="cell-pill">${escapeInlineText(token)}</span>`);
    if((idx+1)%10===0 && idx<tokens.length-1){
      parts.push('<span class="cell-pill-break"></span>');
    }
  });
  return `<span class="cell-pill-group">${parts.join('')}</span>`;
}

function parseScoreNumber(value){
  if(typeof value==='number' && Number.isFinite(value)) return value;
  if(typeof value==='string'){
    const match=value.match(/[-+]?\d*\.?\d+/);
    if(match && match[0]) return Number(match[0]);
  }
  return NaN;
}

function escapeInlineText(value){
  return String(value??'').replace(/[&<>"']/g, ch=>{
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

function findReasonColumnIndex(){
  if(!Array.isArray(rawTableHeader)) return -1;
  const target='同品原因'.toLowerCase();
  return rawTableHeader.findIndex(label=>{
    const normalized=normalizeHeaderLabel(label);
    if(!normalized) return false;
    const compact=normalized.replace(/[\s:：()（）]/g,'').toLowerCase();
    return compact.includes(target);
  });
}

function normalizeHeaderLabel(label){
  return String(label ?? '').trim();
}

function extractScoreFromReasonCell(cell){
  if(cell===undefined || cell===null) return '';
  const text=String(cell).trim();
  if(!text) return '';
  let parsed=null;
  if((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))){
    try{ parsed=JSON.parse(text); }catch(err){ parsed=null; }
  }
  const extracted = extractScoreFromParsedReason(parsed);
  if(extracted!=='') return extracted;
  const match=text.match(/score\s*[:=]\s*([-+]?\d*\.?\d+)/i);
  if(match && match[1]) return match[1];
  return '';
}

function extractScoreFromParsedReason(value){
  if(!value) return '';
  if(Array.isArray(value)){
    for(const item of value){
      const result = extractScoreFromParsedReason(item);
      if(result!=='') return result;
    }
    return '';
  }
  if(typeof value==='object'){
    if(value.score!==undefined && value.score!==null){
      return formatScoreValue(value.score);
    }
    if(Array.isArray(value.reasons)){
      const nested = extractScoreFromParsedReason(value.reasons);
      if(nested!=='') return nested;
    }
  }
  return '';
}

function formatScoreValue(score){
  if(score===undefined || score===null || score==='') return '';
  const num=Number(score);
  if(Number.isFinite(num)){
    return String(Math.round(num*10)/10);
  }
  return String(score).trim();
}

function escapeSelectorValue(value){
  const text=String(value??'');
  if(typeof CSS!=='undefined' && typeof CSS.escape==='function'){
    try{ return CSS.escape(text); }
    catch(err){ return text.replace(/["\\]/g,'\\$&'); }
  }
  return text.replace(/["\\]/g,'\\$&');
}

function setGroupCollapseState(tableKey, groupKey, collapsed){
  const map=tableGroupCollapseState[tableKey];
  if(!map) return;
  if(collapsed){ map.set(groupKey, true); }
  else{ map.delete(groupKey); }
  const selectorValue=escapeSelectorValue(groupKey);
  const bodies=document.querySelectorAll(`tbody.merge-group[data-table="${tableKey}"][data-group="${selectorValue}"]`);
  bodies.forEach(body=> body.classList.toggle('is-collapsed', !!collapsed));
  const buttons=document.querySelectorAll(`.group-toggle[data-table="${tableKey}"][data-group="${selectorValue}"]`);
  buttons.forEach(btn=> btn.setAttribute('aria-expanded', collapsed? 'false':'true'));
}

function bindGroupCollapseControls(){
  if(groupToggleListenerBound || typeof document==='undefined') return;
  document.addEventListener('click', event=>{
    const btn=event.target?.closest?.('.group-toggle');
    if(!btn) return;
    const tableKey=btn.getAttribute('data-table')||'graph';
    const groupKey=btn.getAttribute('data-group');
    if(!groupKey || !tableGroupCollapseState[tableKey]) return;
    const map=tableGroupCollapseState[tableKey];
    const isCollapsed=!!map.get(groupKey);
    setGroupCollapseState(tableKey, groupKey, !isCollapsed);
  });
  groupToggleListenerBound=true;
}

function setupPrimaryRowToggles(ctx){
  if(!ctx || !ctx.tableEl) return;
  const table=ctx.tableEl;
  const map=tablePrimaryCollapseState[ctx.key];
  if(!map) return;
  const rows=table.querySelectorAll('tbody tr.raw-table-row[data-row-kind="primary"]');
  rows.forEach(row=>{
    const primaryRaw=row.getAttribute('data-primary-code') || row.getAttribute('data-closest-primary') || row.getAttribute('data-code');
    const normalized=normalizeCode(primaryRaw);
    if(!normalized) return;
    row.setAttribute('data-primary-normalized', normalized);
    const firstCell=row.querySelector('td');
    if(!firstCell) return;
    firstCell.classList.add('cell--has-primary-toggle');
    if(firstCell.querySelector('.primary-collapse-toggle')) return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='primary-collapse-toggle';
    btn.setAttribute('aria-label','切换同品子项');
    btn.setAttribute('aria-expanded', map.get(normalized)? 'false':'true');
    btn.dataset.primary=normalized;
    btn.addEventListener('click', event=>{
      event.preventDefault();
      event.stopPropagation();
      togglePrimaryCollapse(ctx, normalized);
    });
    firstCell.prepend(btn);
    let labelWrapper=firstCell.querySelector('.primary-cell-label');
    if(!labelWrapper){
      labelWrapper=document.createElement('span');
      labelWrapper.className='primary-cell-label';
      while(firstCell.childNodes.length>1){
        labelWrapper.appendChild(firstCell.childNodes[1]);
      }
      firstCell.appendChild(labelWrapper);
    }
  });
  applyPrimaryCollapseState(ctx);
}

function togglePrimaryCollapse(ctx, primaryCode){
  if(!ctx || !primaryCode) return;
  const map=tablePrimaryCollapseState[ctx.key];
  if(!map) return;
  if(map.get(primaryCode)) map.delete(primaryCode);
  else map.set(primaryCode, true);
  applyPrimaryCollapseState(ctx);
}

function applyPrimaryCollapseState(ctx){
  if(!ctx || !ctx.tableEl) return;
  const table=ctx.tableEl;
  const map=tablePrimaryCollapseState[ctx.key];
  if(!map) return;
  const rows=table.querySelectorAll('tbody tr.raw-table-row');
  rows.forEach(row=>{
    const primary=normalizeCode(row.getAttribute('data-primary-code')||'');
    const closest=normalizeCode(row.getAttribute('data-closest-primary')||'');
    if(primary){
      const collapsed=!!map.get(primary);
      row.classList.toggle('is-primary-collapsed', collapsed);
      row.classList.remove('is-hidden-by-primary');
      const btn=row.querySelector('.primary-collapse-toggle');
      if(btn){ btn.setAttribute('aria-expanded', collapsed? 'false':'true'); }
    }else if(closest){
      row.classList.toggle('is-hidden-by-primary', !!map.get(closest));
    }else{
      row.classList.remove('is-hidden-by-primary');
    }
  });
}
