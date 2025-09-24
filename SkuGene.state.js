/* --------- 运行态变量 --------- */
let network, nodesDS, edgesDS;
let fullSummary=null;
const expandedState = new Map();
let DEGREE_CAP=0, DEGREE_MAX=0, GROUP_CAP=0, GROUP_MAX=0, GROUP_CAP_ALL=0, GROUP_CAP_NOSINGLES=0;
let EDGES_PER_COMP=new Map();
const GROUP_LABEL_LIMIT=300;
const FULL_NODE_LIMIT=1200;

let explodeQueue=[]; let exploding=false; let paused=false;
let currentGroup=null; // 用于 ETA/进度
let firstBatchDoneForCid=new Set(); // 防“空屏”
let deletedNodes=new Set(); let deletedEdges=new Set(); const undoStack=[];

/* --------- UI：扩散强度 & 展开速度 --------- */
const speedInput = document.getElementById('speed');
const speedLabel = document.getElementById('speedLabel');
const speedText = ['柔和','较弱','标准','较强','更强'];
speedLabel.textContent = speedText[Number(speedInput.value)-1];
speedInput.addEventListener('input', ()=>{ speedLabel.textContent = speedText[Number(speedInput.value)-1]; applyPhysics(); if(exploding) updateETA(); });

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
                         interaction:{ dragView:true, dragNodes:true, zoomView:true }});
  }else{
    network.setOptions({ physics:{ enabled:true, solver:'barnesHut', barnesHut:prof.bh, stabilization:{enabled:false}, minVelocity:prof.minVelocity },
                         interaction:{ dragView:true, dragNodes:true, zoomView:true }});
  }
  document.getElementById('pause').disabled=false;
}
const setProgress=(p,txt)=>{ document.getElementById('progBar').style.width=(p||0)+'%'; if(txt) document.getElementById('hint').textContent=txt; };

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
  const container=document.getElementById('network');
  network = new vis.Network(container, { nodes:nodesDS, edges:edgesDS }, {
    layout:{ improvedLayout:false }, physics:{ enabled:false },
    nodes:{ shape:'dot', size:9, font:{ color:'#e5e7eb', size:12, face:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif" }, borderWidth:1 },
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
        if(useWorker && workerReady){ worker.postMessage({type:'neighbors', id:code}); }
        else{ showTip(neighborsMainThread(code)); }
      } else hideTip();
    } else hideTip();
  });
}

/* --------- UI 事件 --------- */
document.getElementById('collapseAll').addEventListener('click',()=>{ exploding=false; paused=false; hideTip(); renderCollapsed(); document.getElementById('eta').textContent='ETA: --'; ensurePhysicsOn(); });
document.getElementById('explode').addEventListener('click',()=> startExplodeAll());
document.getElementById('pause').addEventListener('click',()=>{
  paused=!paused; document.getElementById('pause').textContent = paused?'继续':'暂停';
  if(paused){ network?.setOptions({ physics:{enabled:false} }); } else { ensurePhysicsOn(); if(explodeQueue.length>0){ scheduleNextExplode(); } }
});
document.getElementById('reset').addEventListener('click',()=> network?.fit({animation:true}));
document.getElementById('export').addEventListener('click', () => { if (typeof exportPNG === 'function') { exportPNG(); } });
document.getElementById('autoPrune').addEventListener('click', () => { if (typeof autoPruneUnstableNodes === 'function') { autoPruneUnstableNodes(); } });
document.getElementById('go').addEventListener('click', () => { if (typeof locateNode === 'function') { locateNode(); } });

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

const minGroupInput=document.getElementById('minGroup');
minGroupInput.addEventListener('input',()=>{ document.getElementById('minGroupLabel').textContent='≥ '+(minGroupInput.value||'2'); renderCollapsed(); if(exploding) updateETA(); });

document.getElementById('build').addEventListener('click', async ()=>{
  const f=document.getElementById('file').files[0]; if(!f){ alert('请选择 Excel/CSV 文件'); return; }
  resetAll(); setProgress(0,'解析文件…');
  setStatus(useWorker? '正在后台解析（Worker）…':'正在主线程解析…');
  const buf=await f.arrayBuffer(); const preferred=(document.getElementById('sheet').value||'').trim();

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
let MT_ctx={ parsed:false, comps:null, compOf:null, edgesGlobal:null, nameOf:null, adj:null, edgesByComp:null, reasons:null };
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
  return { comps:compList, totalNodes:ids.size, totalEdges:edgesSet.size, degreeMax:degMax, degreeP95:degP95,
           edgesByComp:Array.from(edgesByComp.entries()).map(([cid,count])=>({cid,count})) };
}
function neighborsMainThread(id){ const set=(MT_ctx.adj?.get(id)||new Set()); const neighbors=Array.from(set).map(n=>{
  const info = MT_ctx.reasons?.get(id)?.get(n) || MT_ctx.reasons?.get(n)?.get(id) || null;
  const reason = info?.reason ?? '';
  const score = info?.score ?? null;
  return {id:n, name:MT_ctx.nameOf?.get(n)||'', reason, score};
});
  return { type:'neighbors', id, name:MT_ctx.nameOf?.get(id)||'', degree:set.size, neighbors }; }

