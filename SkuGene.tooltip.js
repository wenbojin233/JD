/* --------- 浮窗 --------- */
let pendingTipPos=null, _dragging=false, _dragOffset={x:0,y:0};
let tipMode='default';
const tip=document.getElementById('tooltip'), tipHdr=document.getElementById('tipDrag');
const tipTitleEl=document.getElementById('tipTitle');
const tipMetaEl=document.getElementById('tipMeta');
const tipListEl=document.getElementById('tipList');
const tipActionsEl=document.getElementById('tipActions');
const toggleReasonBtn=document.getElementById('toggleReason');
const tipAutoPruneBtn=document.getElementById('autoPruneNode');
const tipDeleteBtn=document.getElementById('deleteNode');
if(tipDeleteBtn){ tipDeleteBtn.disabled=true; }
if(tipAutoPruneBtn){ tipAutoPruneBtn.disabled=true; }
let tipShowReason=false;
let tipData=null;

const htmlEscapeMap={ '&':'&amp;', '<':'&lt;', '>':'&gt;' };
htmlEscapeMap['"']='&quot;';
htmlEscapeMap["'"]='&#39;';
function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, ch=>htmlEscapeMap[ch]||ch);
}
function formatScore(score){
  if(score===null || score===undefined || score==='') return '';
  if(typeof score==='number'){
    const rounded=Math.round(score*10)/10;
    return Number.isInteger(rounded)? String(Math.trunc(rounded)) : String(rounded);
  }
  const num=Number(score);
  if(Number.isFinite(num)){
    const rounded=Math.round(num*10)/10;
    return Number.isInteger(rounded)? String(Math.trunc(rounded)) : String(rounded);
  }
  return String(score);
}
function neighborsHaveDetails(neighbors){
  return neighbors.some(n=>{
    const reason=typeof n.reason==='string'? n.reason.trim():'';
    const score=n.score;
    return (reason && reason.length>0) || (score!==null && score!==undefined && String(score).trim()!=='');
  });
}
function updateTipMeta(){
  if(!tipMetaEl){ return; }
  if(!tipData){ tipMetaEl.textContent=''; return; }
  const total=tipData.neighbors?.length ?? 0;
  tipMetaEl.textContent = '度数：'+total+' · 前 '+Math.min(200, total)+' 个邻居如下';
}
function updateReasonToggle(){
  if(!tipActionsEl) return;
  if(tipMode==='merge'){
    tipActionsEl.style.display='none';
    if(toggleReasonBtn){ toggleReasonBtn.style.display='none'; toggleReasonBtn.classList.remove('active'); }
    if(tipAutoPruneBtn){ tipAutoPruneBtn.style.display='none'; tipAutoPruneBtn.disabled=true; tipAutoPruneBtn.removeAttribute('data-cid'); }
    if(tipDeleteBtn){ tipDeleteBtn.disabled=true; tipDeleteBtn.removeAttribute('data-target'); }
    return;
  }
  const neighbors=Array.isArray(tipData?.neighbors)? tipData.neighbors : [];
  const hasReason = neighbors.length>0 && neighborsHaveDetails(neighbors);
  if(toggleReasonBtn){
    if(hasReason){
      toggleReasonBtn.style.display='';
      toggleReasonBtn.textContent = tipShowReason ? '隐藏同品原因' : '显示同品原因';
      toggleReasonBtn.classList.toggle('active', tipShowReason);
    }else{
      toggleReasonBtn.style.display='none';
      toggleReasonBtn.classList.remove('active');
      tipShowReason=false;
    }
  }
  if(tipDeleteBtn){
    tipDeleteBtn.disabled = !tipData;
  }
  if(tipAutoPruneBtn){
    let cid=null;
    if(tipData && typeof getComponentIdByCode==='function'){
      cid = getComponentIdByCode(tipData.id);
    }
    const canUltimate = !!cid && typeof handleGroupUltimateAction==='function';
    if(canUltimate){
      tipAutoPruneBtn.style.display='';
      tipAutoPruneBtn.disabled=false;
      tipAutoPruneBtn.dataset.cid=cid;
      tipAutoPruneBtn.textContent='究极剔品';
    }else{
      tipAutoPruneBtn.style.display='none';
      tipAutoPruneBtn.disabled=true;
      tipAutoPruneBtn.removeAttribute('data-cid');
      tipAutoPruneBtn.textContent='究极剔品';
    }
  }
  const actionsVisible = (toggleReasonBtn && toggleReasonBtn.style.display!=='none') ||
    (tipAutoPruneBtn && tipAutoPruneBtn.style.display!=='none') ||
    (tipDeleteBtn && !tipDeleteBtn.disabled);
  tipActionsEl.style.display = actionsVisible? 'flex':'none';
}
function renderTipList(){
  if(!tipListEl) return;
  if(!tipData){
    tipListEl.innerHTML='';
    updateTipMeta();
    updateReasonToggle();
    return;
  }
  const neighbors=Array.isArray(tipData.neighbors)? tipData.neighbors : [];
  const maxShow=200;
  const rows=neighbors.slice(0,maxShow).map(n=>{
    let row='<div class="neighbor"><div class="neighbor-line"><code>'+escapeHtml(n.id||'')+'</code>';
    if(n.name){
      row+='<span class="name">'+escapeHtml(n.name)+'</span>';
    }
    row+='<span class="spacer"></span>';
    if(tipShowReason){
      const scoreText=formatScore(n.score);
      if(scoreText){
        row+='<span class="score">得分: '+escapeHtml(scoreText)+'</span>';
      }
    }
    row+='<button class="edge-delete" data-peer="'+escapeHtml(n.id||'')+'">删除关系</button>';
    row+='</div>';
    if(tipShowReason){
      const reasonRaw=(n.reason||'').trim();
      if(reasonRaw){
        const reasonHtml=escapeHtml(reasonRaw).replace(/\r?\n+/g,'<br/>');
        row+='<div class="reason">'+reasonHtml+'</div>';
      }
    }
    row+='</div>';
    return row;
  }).join('');
  const remainder=neighbors.length>maxShow ? '<div class="hint">其余共 '+neighbors.length+' 个邻居，已截断。</div>' : '';
  tipListEl.innerHTML = rows + remainder;
  tipData.degree = neighbors.length;
  updateTipMeta();
  updateReasonToggle();
}
function resolveTipAnchor(data){
  if(pendingTipPos){
    const pos=pendingTipPos;
    pendingTipPos=null;
    return pos;
  }
  try{
    if(data?.id && typeof network!=='undefined' && network?.canvasToDOM){
      const nid='N:'+data.id;
      const coords=network.getPositions([nid])?.[nid];
      if(coords){
        const dom = network.canvasToDOM(coords);
        const rect = network.body?.container?.getBoundingClientRect?.();
        if(dom && rect){
          return { x: rect.left + dom.x, y: rect.top + dom.y };
        }
      }
    }
  }catch(err){
    console.warn('resolveTipAnchor failed', err);
  }
  return { x:40, y:40 };
}

function showTip(data){
  tipMode='default';
  if(!data) return;
  const baseId=data.id;
  const baseNid='N:'+baseId;
  const neighborsRaw=Array.isArray(data.neighbors)? data.neighbors.slice():[];
  const filtered=applyNeighborFilters(baseNid, neighborsRaw);
  tipData={ ...data, neighbors:filtered, degree:filtered.length, baseNid };
  tipShowReason=false;
    if(tipTitleEl) tipTitleEl.textContent=`${data.id} ${data.name||''}`.trim();
  if(tipDeleteBtn){
    tipDeleteBtn.disabled=false;
    tipDeleteBtn.dataset.target=baseNid;
  }
  renderTipList();
  const anchor = resolveTipAnchor(data);
  const vw=innerWidth, vh=innerHeight; tip.style.display='block'; tip.style.left='0px'; tip.style.top='0px';
  const rect=tip.getBoundingClientRect(), pad=12; let x=anchor.x+12, y=anchor.y+12;
  if(x+rect.width+pad>vw) x=vw-rect.width-pad; if(y+rect.height+pad>vh) y=vh-rect.height-pad; x=Math.max(pad,x); y=Math.max(pad,y); tip.style.left=x+'px'; tip.style.top=y+'px';
}
function hideTip(){
  tip.style.display='none';
  tipData=null;
  tipShowReason=false;
  tipMode='default';
  if(tipListEl) tipListEl.innerHTML='';
  if(tipMetaEl) tipMetaEl.textContent='';
  if(tipDeleteBtn){
    tipDeleteBtn.disabled=true;
    tipDeleteBtn.removeAttribute('data-target');
  }
  updateReasonToggle();
}
if(toggleReasonBtn){
  toggleReasonBtn.addEventListener('click', ()=>{
    if(!tipData) return;
    const neighbors=Array.isArray(tipData.neighbors)? tipData.neighbors : [];
    if(!neighborsHaveDetails(neighbors)) return;
    tipShowReason=!tipShowReason;
    renderTipList();
  });
}
if(tipDeleteBtn){
  tipDeleteBtn.addEventListener('click', ()=>{
    if(!tipData) return;
    const target=tipDeleteBtn.dataset.target || ('N:'+tipData.id);
    removeNode(target);
  });
}
if(tipAutoPruneBtn){
  tipAutoPruneBtn.addEventListener('click', async ()=>{
    const cid = tipAutoPruneBtn.dataset.cid;
    if(!cid || typeof handleGroupUltimateAction!=='function') return;
    await handleGroupUltimateAction(cid, tipAutoPruneBtn);
  });
}
if(tipListEl){
  tipListEl.addEventListener('click', (ev)=>{
    const btn = ev.target.closest ? ev.target.closest('.edge-delete') : (ev.target.classList.contains('edge-delete')? ev.target:null);
    if(!btn) return;
    if(!tipData) return;
    const peer=btn.dataset.peer;
    if(!peer) return;
    removeEdgesBetweenNodes('N:'+tipData.id, 'N:'+peer);
  });
}
updateReasonToggle();
tipHdr.addEventListener('mousedown', (ev)=>{ if(tip.style.display!=='block') return; _dragging=true; const r=tip.getBoundingClientRect(); _dragOffset.x=ev.clientX-r.left; _dragOffset.y=ev.clientY-r.top; ev.preventDefault(); });
addEventListener('mousemove',(ev)=>{ if(!_dragging) return; const vw=innerWidth,vh=innerHeight,pad=6; let x=ev.clientX-_dragOffset.x,y=ev.clientY-_dragOffset.y; const rect=tip.getBoundingClientRect();
  if(x<pad) x=pad; if(y<pad) y=pad; if(x+rect.width+pad>vw) x=vw-rect.width-pad; if(y+rect.height+pad>vh) y=vh-rect.height-pad; tip.style.left=x+'px'; tip.style.top=y+'px'; });
addEventListener('mouseup',()=>{ _dragging=false; });
function pruneTipNeighborsByNode(nodeId){
  if(!tipData || !Array.isArray(tipData.neighbors)) return;
  const target = nodeId.startsWith('N:')? nodeId.slice(2) : nodeId;
  const before = tipData.neighbors.length;
  tipData.neighbors = tipData.neighbors.filter(n=>n.id!==target);
  if(before!==tipData.neighbors.length){
    renderTipList();
  }
}
function updateTipAfterEdgeRemoval(nidA, nidB){
  if(!tipData || !Array.isArray(tipData.neighbors)) return;
  const baseNid='N:'+tipData.id;
  if(baseNid!==nidA && baseNid!==nidB) return;
  const other = baseNid===nidA? nidB : nidA;
  const before = tipData.neighbors.length;
  tipData.neighbors = tipData.neighbors.filter(n=>('N:'+n.id)!==other);
  if(before!==tipData.neighbors.length){
    renderTipList();
  }
}

function showMergeTooltip({ title='', meta='', html='', position=null }={}){
  tipMode='merge';
  tipData=null;
  tipShowReason=false;
  if(toggleReasonBtn){ toggleReasonBtn.style.display='none'; toggleReasonBtn.classList.remove('active'); }
  if(tipDeleteBtn){ tipDeleteBtn.disabled=true; tipDeleteBtn.removeAttribute('data-target'); }
  if(tipActionsEl) tipActionsEl.style.display='none';
  if(tipTitleEl) tipTitleEl.textContent=title;
  if(tipMetaEl) tipMetaEl.textContent=meta;
  if(tipListEl) tipListEl.innerHTML = html || '<div class="placeholder hint">暂无数据</div>';
  const vw=innerWidth, vh=innerHeight, pad=12;
  tip.style.display='block';
  tip.style.left='0px';
  tip.style.top='0px';
  const rect=tip.getBoundingClientRect();
  const baseX = position?.x !== undefined ? position.x : vw/2;
  const baseY = position?.y !== undefined ? position.y : vh/2;
  let x = baseX + 12;
  let y = baseY + 12;
  if(x+rect.width+pad>vw) x = vw-rect.width-pad;
  if(y+rect.height+pad>vh) y = vh-rect.height-pad;
  if(x<pad) x=pad;
  if(y<pad) y=pad;
  tip.style.left=x+'px';
  tip.style.top=y+'px';
}

if(typeof window!=='undefined'){
  window.showMergeTooltip = showMergeTooltip;
}

/* --------- 启动：加载依赖 → cpexcel → Worker → init --------- */
(function bootstrap(){
  loadScriptChain(VIS_URLS, ()=> !!(window.vis && window.vis.Network), ()=>{
    setStatus('已加载 vis-network');
    loadScriptChain(XLSX_URLS, ()=> !!window.XLSX, ()=>{
      setStatus('已加载 XLSX');
      loadScriptChain(CPEX_URLS, ()=> !!window.cptable, ()=>{
        try{ if(window.cptable && XLSX.set_cptable){ XLSX.set_cptable(window.cptable); setStatus('编码表就绪（cpexcel）'); } }catch{}
        ensureWorker(); initNetwork(); setStatus('就绪：请选择文件后点击“构建图谱”');
      }, ()=>{
        ensureWorker(); initNetwork(); setStatus('就绪（未加载 cpexcel）：若 CSV 中文乱码请联网重试');
      });
    }, ()=>{ setStatus('未能加载 XLSX，无法解析文件'); alert('未能加载 XLSX 依赖，请联网或更换网络后重试。'); initNetwork(); });
  }, ()=>{ alert('未能加载 vis-network。'); setStatus('未能加载 vis-network，页面功能受限'); });
})();
