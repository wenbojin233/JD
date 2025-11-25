/* -------------------- 多CDN加载 + 中文编码修复 -------------------- */
const statusEl = document.getElementById('status');
const groupListEl = document.getElementById('groupList');
const groupListCountEl = document.getElementById('groupListCount');
const groupPanelEl = document.getElementById('groupPanel');
const groupPanelToggle = document.getElementById('toggleGroupPanel');
const groupPanelClose = document.getElementById('closeGroupPanel');
const confirmedPanelEl = document.getElementById('confirmedPanel');
const confirmedPanelToggle = document.getElementById('toggleConfirmedPanel');
const confirmedPanelClose = document.getElementById('closeConfirmedPanel');
const confirmedListEl = document.getElementById('confirmedList');
const confirmedListCountEl = document.getElementById('confirmedListCount');
const themeToggleBtn = document.getElementById('toggleTheme');
const groupPanelToggleDefault = groupPanelToggle ? (groupPanelToggle.textContent || '').trim() : '同品组列表';
const GROUP_PANEL_TOGGLE_CLOSE_LABEL = '收起同品组';
const confirmedPanelToggleDefault = confirmedPanelToggle ? (confirmedPanelToggle.textContent || '').trim() : '已确认同品组';
const CONFIRMED_PANEL_TOGGLE_CLOSE_LABEL = '收起已确认组';
const THEME_STORAGE_KEY = 'skuGene_theme';
const confirmedGroups = new Set();
let activeGroupCid = null;
function applyThemePreference(theme){
  const isLight = theme === 'light';
  document.body.classList.toggle('theme-light', isLight);
  if(themeToggleBtn){
    themeToggleBtn.textContent = isLight ? '切换黑暗模式' : '切换白天模式';
    themeToggleBtn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
  }
  try{
    if(typeof refreshMergeGraph === 'function'){
      refreshMergeGraph({ keepPositions:true, fit:false });
    }
  }catch(err){ console.warn('刷新吞并视图配色失败', err); }
  try{
    if(typeof refreshVisTheme === 'function'){
      refreshVisTheme();
    }
  }catch(err){ console.warn('同步画布主题失败', err); }
}
function inferInitialTheme(){
  try{
    if(typeof localStorage !== 'undefined'){
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if(stored === 'light' || stored === 'dark'){
        return stored;
      }
    }
  }catch(e){}
  return 'light';
}
let currentTheme = inferInitialTheme();
applyThemePreference(currentTheme);
(function subscribeSystemTheme(){
  try{
    if(window.matchMedia){
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const handler = (ev)=>{
        try{
          if(typeof localStorage !== 'undefined'){
            const stored = localStorage.getItem(THEME_STORAGE_KEY);
            if(stored === 'light' || stored === 'dark'){
              return;
            }
          }
        }catch(e){}
        currentTheme = ev.matches ? 'light' : 'dark';
        applyThemePreference(currentTheme);
      };
      if(mq.addEventListener){ mq.addEventListener('change', handler); }
      else if(mq.addListener){ mq.addListener(handler); }
    }
  }catch(e){}
})();
if(themeToggleBtn){
  themeToggleBtn.addEventListener('click', ()=>{
    const isLightNow = document.body.classList.contains('theme-light');
    const next = isLightNow ? 'dark' : 'light';
    currentTheme = next;
    applyThemePreference(next);
    try{
      if(typeof localStorage !== 'undefined'){
        localStorage.setItem(THEME_STORAGE_KEY, next);
      }
    }catch(e){}
  });
}
const setStatus = (t)=>{ statusEl.textContent = t; console.log('[状态]', t); };
function loadScriptChain(urls, test, onOk, onFail){
  let i=0; (function next(){
    if(i>=urls.length){ onFail&&onFail(); return; }
    const s=document.createElement('script'); s.src=urls[i++]; s.async=false; s.referrerPolicy='no-referrer';
    s.onload=()=>{ try{ const ok = typeof test==='function'? test(): (window[test]!==undefined); if(ok){ onOk&&onOk(); } else { next(); } }catch{ next(); } };
    s.onerror=()=> next(); document.head.appendChild(s);
  })();
}
const VIS_URLS  = [
  "./vendor/vis-network.min.js",
  "https://cdn.jsdelivr.net/npm/vis-network/standalone/umd/vis-network.min.js",
  "https://unpkg.com/vis-network/standalone/umd/vis-network.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.6/vis-network.min.js"
];
const XLSX_URLS = [
  "./vendor/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js"
];
const CPEX_URLS = [
  "./vendor/cpexcel.full.min.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/cpexcel.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/cpexcel.full.min.js",
  "https://unpkg.com/xlsx@0.18.5/dist/cpexcel.full.min.js"
];

let useWorker=false, workerReady=false, worker=null;
