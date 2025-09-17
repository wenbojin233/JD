/* -------------------- 多CDN加载 + 中文编码修复 -------------------- */
const statusEl = document.getElementById('status');
const setStatus = (t)=>{ statusEl.textContent = t; console.log('[状态]', t); };
function loadScriptChain(urls, test, onOk, onFail){
  let i=0; (function next(){
    if(i>=urls.length){ onFail&&onFail(); return; }
    const s=document.createElement('script'); s.src=urls[i++]; s.async=true; s.referrerPolicy='no-referrer';
    s.onload=()=>{ try{ const ok = typeof test==='function'? test(): (window[test]!==undefined); if(ok){ onOk&&onOk(); } else { next(); } }catch{ next(); } };
    s.onerror=()=> next(); document.head.appendChild(s);
  })();
}
const VIS_URLS  = [
  "https://cdn.jsdelivr.net/npm/vis-network/standalone/umd/vis-network.min.js",
  "https://unpkg.com/vis-network/standalone/umd/vis-network.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.6/vis-network.min.js"
];
const XLSX_URLS = [
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"
];
const CPEX_URLS = [
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/cpexcel.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/cpexcel.full.min.js",
  "https://unpkg.com/xlsx@0.18.5/dist/cpexcel.full.min.js"
];

let useWorker=false, workerReady=false, worker=null;

/* -------------------- Worker：解析 + 数据切片 -------------------- */
const workerSrc = `(() => {
  const XLSX_URLS = [
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"
  ];
  const CPEX_URLS = [
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/cpexcel.full.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/cpexcel.full.min.js",
    "https://unpkg.com/xlsx@0.18.5/dist/cpexcel.full.min.js"
  ];
  let xlsxLoaded=false;
  try{
    for(const u of XLSX_URLS){ try{ importScripts(u); xlsxLoaded=true; break; }catch{} }
    if(xlsxLoaded){
      let cpOK=false; for(const u of CPEX_URLS){ try{ importScripts(u); cpOK=true; break; }catch{} }
      if(cpOK && self.cptable && self.XLSX?.set_cptable){ self.XLSX.set_cptable(self.cptable); }
    }
  }catch{}
  self.postMessage({type:'ready', xlsx:xlsxLoaded});

  class DSU{ constructor(){this.p=new Map();this.r=new Map();} make(x){if(!this.p.has(x)){this.p.set(x,x);this.r.set(x,0);}}
    find(x){ let p=this.p.get(x); if(p!==x){ p=this.find(p); this.p.set(x,p);} return p; }
    union(a,b){ this.make(a); this.make(b); a=this.find(a); b=this.find(b); if(a===b) return;
      const ra=this.r.get(a), rb=this.r.get(b);
      if(ra<rb) this.p.set(a,b); else if(ra>rb) this.p.set(b,a); else { this.p.set(b,a); this.r.set(a,ra+1); } } }

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
  const qtile=(arr,q)=>{ if(!arr.length) return 0; const a=arr.slice().sort((x,y)=>x-y);
    const pos=(a.length-1)*q, b=Math.floor(pos), r=pos-b; return a[b+1]!==undefined? a[b]+r*(a[b+1]-a[b]):a[b]; };

  self.onmessage = (e)=>{
    const {type} = e.data||{};
    if(type==='parse'){
      if(!self.XLSX){ self.postMessage({type:'error', message:'worker_xlsx_missing'}); return; }
      try{
        const { buffer, sheetNamePreferred } = e.data;
        const wb = XLSX.read(new Uint8Array(buffer), { type:'array' });
        const sheetName = wb.SheetNames.includes(sheetNamePreferred) ? sheetNamePreferred : wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' });

        const { codeIdx, nameIdx, relIdx, reasonIdx } = inferHeaderIndexes(rows);
        if(codeIdx===-1 || relIdx===-1){ self.postMessage({type:'error', message:'no_required_headers'}); return; }

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

          processed++; if(processed%2000===0){ self.postMessage({type:'progress', p:Math.round(processed/total*50)}); }
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
        const degMax = degs.length?Math.max(...degs):0; const degP95 = qtile(degs,0.95);
        const edgesByComp=new Map(); for(const key of edgesSet){ const [a,b]=key.split('::'); const c=compOf.get(a); edgesByComp.set(c,(edgesByComp.get(c)||0)+1); }
        const compList = Array.from(comps.entries()).map(([cid,set])=>({cid,size:set.size})).sort((a,b)=>b.size-a.size);

        self.state = { comps, compOf, edgesGlobal:edgesSet, nameOf, adj, parsed:true, reasons:reasonMap };
        self.postMessage({ type:'summary',
          comps: compList, totalNodes: ids.size, totalEdges: edgesSet.size,
          degreeMax: degMax, degreeP95: degP95,
          edgesByComp: Array.from(edgesByComp.entries()).map(([cid,count])=>({cid,count}))
        });
      }catch(err){ self.postMessage({type:'error', message:'parse_fail:'+err.message}); }
    } else if(type==='getComponent'){
      const s=self.state; if(!s?.parsed){ self.postMessage({type:'error', message:'not_parsed'}); return; }
      const { cid, needEdges=true, needPrefix=true } = e.data;
      const set=s.comps.get(cid); if(!set){ self.postMessage({type:'error', message:'no_comp'}); return; }
      const nodes = Array.from(set);
      const names={}, degrees={};
      for(const id of nodes){ names[id]=s.nameOf.get(id)||''; degrees[id]=(s.adj.get(id)||new Set()).size; }

      let edges=null, prefixMap=null, prefixEdges=null;
      if(needEdges){
        edges=[]; for(const key of s.edgesGlobal){ const [a,b]=key.split('::'); if(set.has(a)&&set.has(b)) edges.push([a,b]); }
      }
      if(needPrefix){
        const pmap=new Map(); for(const id of nodes){ const p=String(id).slice(0,3); if(!pmap.has(p)) pmap.set(p,[]); pmap.get(p).push(id); }
        prefixMap = Array.from(pmap.entries()).map(([prefix,arr])=>({prefix,nodes:arr}));
        if(edges){
          const cntMap=new Map(), insideCnt=new Map();
          for(const [a,b] of edges){ const pa=String(a).slice(0,3), pb=String(b).slice(0,3);
            if(pa===pb){ insideCnt.set(pa,(insideCnt.get(pa)||0)+1); }
            else{ const k=pa<pb?pa+'::'+pb:pb+'::'+pa; cntMap.set(k,(cntMap.get(k)||0)+1); }
          }
          prefixEdges = {
            cross:Array.from(cntMap.entries()).map(([k,c])=>({pair:k,count:c})),
            inside:Array.from(insideCnt.entries()).map(([p,c])=>({prefix:p,count:c}))
          };
        }
      }
      self.postMessage({ type:'componentData', cid, nodes, names, degrees, edges, prefixMap, prefixEdges });
    } else if(type==='neighbors'){
      const s=self.state; const id=e.data.id; const set=(s?.adj.get(id)||new Set());
      const neighbors = Array.from(set).map(n=>{
        const info = s?.reasons?.get(id)?.get(n) || s?.reasons?.get(n)?.get(id) || null;
        const reason = info?.reason ?? '';
        const score = info?.score ?? null;
        return {id:n, name: s?.nameOf.get(n)||'', reason, score};
      });
      self.postMessage({ type:'neighbors', id, name:(s?.nameOf.get(id)||''), degree:set.size, neighbors });
    } else if(type==='getDegrees'){
      const s=self.state; const ids=e.data.ids||[]; const out={};
      for(const id of ids){ out[id]=(s?.adj.get(id)||new Set()).size; }
      self.postMessage({ type:'degrees', ids, degrees: out });
    }
  };
})();`;

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
document.getElementById('export').addEventListener('click', exportPNG);
document.getElementById('go').addEventListener('click', locateNode);

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

/* --------- 解析完成 → 初始渲染 --------- */
function onSummary(e){
  fullSummary = { comps:e.comps, totalNodes:e.totalNodes, totalEdges:e.totalEdges, degreeMax:e.degreeMax||0, degreeP95:e.degreeP95||0, edgesByComp:e.edgesByComp||[] };
  DEGREE_MAX = fullSummary.degreeMax||0;
  DEGREE_CAP = Math.max(1, Math.round(fullSummary.degreeP95||DEGREE_MAX));
  GROUP_MAX = fullSummary.comps.length? Math.max(...fullSummary.comps.map(c=>c.size)) : 0;
  const sizesAll=(fullSummary.comps||[]).map(c=>c.size);
  GROUP_CAP_ALL = percentile(sizesAll, 0.95);
  GROUP_CAP_NOSINGLES = percentile(sizesAll.filter(s=>s>1), 0.95);
  GROUP_CAP = GROUP_CAP_ALL;

  EDGES_PER_COMP = new Map((fullSummary.edgesByComp||[]).map(o=>[o.cid, o.count||0]));
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
function renderCollapsed(){
  nodesDS.clear(); edgesDS.clear(); expandedState.clear(); firstBatchDoneForCid.clear();
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
  const compInfo=fullSummary.comps.find(x=>x.cid===cid); if(!compInfo) return;
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
  const st=expandedState.get(cid);
  if(st){ nodesDS.remove(Array.from(st.nodes)); edgesDS.remove(Array.from(st.edges)); nodesDS.remove(Array.from(st.prefixClusters)); expandedState.delete(cid); }
  const comp=fullSummary.comps.find(c=>c.cid===cid);
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
  document.getElementById('hint').textContent='加载组件数据：'+cid;
  if(useWorker && workerReady){
    const onData=(e)=>{
      if(e.data?.type==='componentData' && e.data.cid===cid){
        worker.removeEventListener('message', onData);
        cacheComponentData(e.data); try{ cb(); }catch(err){ console.error(err); }
      }
    };
    worker.addEventListener('message', onData);
    worker.postMessage({type:'getComponent', cid, ...opts});
  }else{
    // 主线程构造
    const set=MT_ctx.comps.get(cid); const nodes=Array.from(set||[]);
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
  const st=expandedState.get(data.cid) || { nodes:new Set(), edges:new Set(), prefixClusters:new Set(), nodeToCid:new Map(), anchor:null, names:{} };
  st._payload=data; st.names=data.names||st.names; expandedState.set(data.cid, st);
}

/* --------- 渲染：完整节点/边 --------- */
function renderFullComponent(cid, deferRemove){
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

/* --------- 渲染：按前三位前缀聚类（大组件） --------- */
function renderPrefixClusters(cid, deferRemove){
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
          if(e.data?.type==='componentData' && e.data.cid===cid){
            worker.removeEventListener('message', onData);
            const m=new Map((e.data.prefixMap||[]).map(o=>[o.prefix, o.nodes])); st._prefixCache=m; cb(m);
          }
        }; worker.addEventListener('message', onData);
        worker.postMessage({type:'getComponent', cid, needEdges:false, needPrefix:true});
      }else{
        const set=MT_ctx.comps.get(cid); const nodes=Array.from(set||[]);
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
    .map(c=>c.cid)
    .sort((a,b)=>{
    const sa=fullSummary.comps.find(x=>x.cid===a)?.size??0;
    const sb=fullSummary.comps.find(x=>x.cid===b)?.size??0;
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
  const sizesMap=new Map(fullSummary.comps.map(c=>[c.cid,c.size]));
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
  document.getElementById('pause').textContent='暂停'; document.getElementById('eta').textContent='ETA: --'; hideTip(); updateStats(); updateLegends();
}

/* --------- 浮窗 --------- */
let pendingTipPos=null, _dragging=false, _dragOffset={x:0,y:0};
const tip=document.getElementById('tooltip'), tipHdr=document.getElementById('tipDrag');
const tipTitleEl=document.getElementById('tipTitle');
const tipMetaEl=document.getElementById('tipMeta');
const tipListEl=document.getElementById('tipList');
const tipActionsEl=document.getElementById('tipActions');
const toggleReasonBtn=document.getElementById('toggleReason');
const tipDeleteBtn=document.getElementById('deleteNode');
if(tipDeleteBtn){ tipDeleteBtn.disabled=true; }
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
  const actionsVisible = (toggleReasonBtn && toggleReasonBtn.style.display!=='none') || (tipDeleteBtn && !tipDeleteBtn.disabled);
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
function showTip(data){
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
  const vw=innerWidth, vh=innerHeight; tip.style.display='block'; tip.style.left='0px'; tip.style.top='0px';
  const rect=tip.getBoundingClientRect(), pad=12; let x=(pendingTipPos? pendingTipPos.x:40)+12, y=(pendingTipPos? pendingTipPos.y:40)+12;
  if(x+rect.width+pad>vw) x=vw-rect.width-pad; if(y+rect.height+pad>vh) y=vh-rect.height-pad; x=Math.max(pad,x); y=Math.max(pad,y); tip.style.left=x+'px'; tip.style.top=y+'px';
}
function hideTip(){
  tip.style.display='none';
  tipData=null;
  tipShowReason=false;
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
