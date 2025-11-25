/* -------------------- Worker：解析 + 数据切片 -------------------- */
const workerSrc = `(() => {
  const XLSX_URLS = [
    "./vendor/xlsx.full.min.js",
    "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"
  ];
  let xlsxLoaded=false;
  try{
    for(const u of XLSX_URLS){ try{ importScripts(u); xlsxLoaded=true; break; }catch{} }
    /* cpexcel optional: skip to avoid errors */
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
        let lastPrimaryCode='';

        for(let r=1;r<rows.length;r++){
          const row=rows[r]; if(!row) continue;
          const rawPrimary=String(row[codeIdx]||'').trim();
          let code=rawPrimary;
          if(code){
            lastPrimaryCode=code;
          }else if(lastPrimaryCode){
            code=lastPrimaryCode;
          }
          const rel =String(row[relIdx]||'').trim(); if(!code || !rel) continue;
          const nameCell=String(row[nameIdx]||'').trim();
          const updateName=(targetId, candidate)=>{
            if(!candidate || !targetId) return;
            const targetNorm=String(targetId).replace(/\s+/g,'').toLowerCase();
            const candNorm=String(candidate).replace(/\s+/g,'').toLowerCase();
            if(!candNorm || targetNorm===candNorm) return; // 避免把编码当作名称
            const existed=nameOf.get(targetId);
            if(!existed || existed.length===0){
              nameOf.set(targetId, candidate);
              return;
            }
            // 仅当新名称更长且与编码不同才替换
            const existNorm=String(existed).replace(/\s+/g,'').toLowerCase();
            if(existNorm===targetNorm) {
              nameOf.set(targetId, candidate);
              return;
            }
            if(candidate.length > existed.length){
              nameOf.set(targetId, candidate);
            }
          };
          if(rawPrimary){
            updateName(code, nameCell);
          }else if(nameCell){
            updateName(rel, nameCell);
          }
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
        let carryPrimary='';
        for(let r=1;r<rows.length;r++){
          const row=rows[r]; if(!row) continue;
          const rawPrimary=String(row[codeIdx]||'').trim();
          if(rawPrimary){ ids.add(rawPrimary); carryPrimary=rawPrimary; }
          else if(carryPrimary){ ids.add(carryPrimary); }
          const rel =String(row[relIdx]||'').trim();
          if(rel){ rel.split(',').forEach(x=>{ x=x.trim(); if(x) ids.add(x); }); }
          const name=String(row[nameIdx]||'').trim();
          if(rawPrimary && name && !nameOf.has(rawPrimary)) nameOf.set(rawPrimary,name);
          else if(!rawPrimary && name){
            const relCode=String(row[relIdx]||'').trim();
            if(relCode && !nameOf.has(relCode)) nameOf.set(relCode, name);
          }
        }
        for(const id of ids){ dsu.make(id); compOf.set(id, dsu.find(id)); }
        for(const id of ids){ const c=compOf.get(id); if(!comps.has(c)) comps.set(c,new Set()); comps.get(c).add(id); }

        const degs=[]; for(const [_,set] of adj.entries()){ degs.push(set.size); }
        const degMax = degs.length?Math.max(...degs):0; const degP95 = qtile(degs,0.95);
        const edgesByComp=new Map(); for(const key of edgesSet){ const [a,b]=key.split('::'); const c=compOf.get(a); edgesByComp.set(c,(edgesByComp.get(c)||0)+1); }
        const compList = Array.from(comps.entries()).map(([cid,set])=>({cid,size:set.size})).sort((a,b)=>b.size-a.size);

        self.state = { comps, compOf, edgesGlobal:edgesSet, nameOf, adj, parsed:true, reasons:reasonMap };
        // 轻量 state dump（供主线程虚拟剔品/吞并链路使用）
        const stateDump={
          comps:Array.from(comps.entries()).map(([cid,set])=>[cid, Array.from(set)]),
          nameOf:Array.from(nameOf.entries()),
          adj:Array.from(adj.entries()).map(([id,set])=>[id, Array.from(set)]),
          edgesByComp:Array.from(edgesByComp.entries())
        };
        self.postMessage({ type:'summary',
          comps: compList, totalNodes: ids.size, totalEdges: edgesSet.size,
          degreeMax: degMax, degreeP95: degP95,
          edgesByComp: Array.from(edgesByComp.entries()).map(([cid,count])=>({cid,count})),
          rawRows: rows,
          codeIndex: codeIdx,
          stateDump
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
