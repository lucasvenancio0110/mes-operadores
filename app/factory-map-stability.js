const STORAGE_KEY='neomes:factory-map-workspace:v6.3';
const NativeMutationObserver=window.MutationObserver;
let workspaceObserverPending=true;

class FactoryScopedMutationObserver extends NativeMutationObserver {
  constructor(callback){
    const scoped=workspaceObserverPending;
    if(scoped)workspaceObserverPending=false;
    super(scoped?(records,observer)=>{
      const external=records.filter(record=>!(record.target instanceof Element&&record.target.closest('.factory-workspace')));
      if(external.length)callback(external,observer);
    }:callback);
    if(scoped)queueMicrotask(()=>{if(window.MutationObserver===FactoryScopedMutationObserver)window.MutationObserver=NativeMutationObserver;});
  }
}

window.MutationObserver=FactoryScopedMutationObserver;

const normalizeLine=value=>{
  const text=String(value||'').trim().toLocaleUpperCase('pt-BR');
  const match=text.match(/LINHA\s*0?(\d{1,2})/);
  return match?`LINHA ${Number(match[1])}`:text;
};

function mapIsActive(){
  return Boolean(document.querySelector('[data-view-mode="map"][aria-pressed="true"]')&&document.querySelector('[data-map-surface]'));
}

function resetBaseFiltersBeforeMap(){
  for(const selector of ['[data-line-filter="all"]','[data-attention-filter="all"]']){
    const button=document.querySelector(selector);
    if(button&&button.getAttribute('aria-pressed')!=='true')button.click();
  }
  const input=document.getElementById('prepSearch');
  if(input?.value){input.value='';input.dispatchEvent(new Event('input',{ bubbles:true }));}
}

function sanitizeSavedLine(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');
    if(!saved?.selectedLine||saved.selectedLine==='all')return;
    const available=new Set([...document.querySelectorAll('[data-line-filter]')].filter(button=>button.dataset.lineFilter!=='all').map(button=>normalizeLine(button.textContent)));
    if(!available.has(normalizeLine(saved.selectedLine))){saved.selectedLine='all';sessionStorage.setItem(STORAGE_KEY,JSON.stringify(saved));}
  }catch{}
}

function addDistantLabels(){
  for(const card of document.querySelectorAll('[data-map-surface] .prep-map-machine:not(.is-unplaced)')){
    if(card.querySelector('.factory-card-distant'))continue;
    const name=card.querySelector('header strong')?.textContent?.trim()||'';
    const label=document.createElement('span');label.className='factory-card-distant';
    label.textContent=name.match(/(\d{1,3})/)?.[1]?.padStart(3,'0')||(/^milltap$/i.test(name)?'MT':(/^discovery$/i.test(name)?'DS':name.slice(0,3).toUpperCase()));
    card.append(label);
  }
}

let supplementRaf=0;
function supplement(){
  supplementRaf=0;
  const active=mapIsActive();
  document.body.classList.toggle('factory-map-mode',active);
  if(!active)return;
  sanitizeSavedLine();
  addDistantLabels();
}
function scheduleSupplement(){
  if(supplementRaf)return;
  supplementRaf=requestAnimationFrame(supplement);
}

new NativeMutationObserver(scheduleSupplement).observe(document.documentElement,{ childList:true,subtree:true });
document.addEventListener('click',event=>{
  if(event.target.closest('[data-view-mode="cards"]'))document.body.classList.remove('factory-map-mode');
  const mapButton=event.target.closest('[data-view-mode="map"]');
  if(mapButton&&!mapIsActive())resetBaseFiltersBeforeMap();
  scheduleSupplement();
},true);

scheduleSupplement();
