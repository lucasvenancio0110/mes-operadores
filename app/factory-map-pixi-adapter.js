const STORAGE_KEY='neomes:factory-map-renderer:v1';
let preference='classic';
let controller=null;
let activeViewport=null;
let activeSurface=null;
let activeFloor=null;
let activeHost=null;
let activeControls=null;
let activePixiControls=null;
let activePixiBadge=null;
let activeWorldKey='';
let savedCamera=null;
let surfaceObserver=null;
let enhanceRaf=0;
let mountToken=0;
let lastSearchFocus='';

try{preference=sessionStorage.getItem(STORAGE_KEY)==='pixi'?'pixi':'classic';}catch{}

const number=value=>Number.parseFloat(String(value||'').replace(/[^\d.,-]/g,'').replace(',','.'))||0;
const text=(root,selector)=>root.querySelector(selector)?.textContent?.trim()||'';
const searchTerm=()=>document.getElementById('prepSearch')?.value?.trim().toLocaleLowerCase('pt-BR')||'';

function describeMachine(element){
  const progress=text(element,'.prep-map-progress span');
  const ariaLabel=element.getAttribute('aria-label')||'';
  const term=searchTerm();
  const searchable=`${element.textContent||''} ${ariaLabel}`.toLocaleLowerCase('pt-BR');
  return {
    id:element.dataset.mapMachine||'',
    label:text(element,'header strong')||element.dataset.mapMachine||'',
    line:text(element,'header small'),
    x:number(element.style.left),
    y:number(element.style.top),
    width:number(getComputedStyle(element).width)||142,
    height:number(getComputedStyle(element).height)||78,
    status:element.dataset.status||'',
    statusLabel:text(element,'.prep-map-status b'),
    urgency:element.dataset.urgency||'none',
    op:text(element,'.prep-map-order span:first-child strong'),
    item:text(element,'.prep-map-order span:nth-child(2) strong'),
    production:progress,
    ariaLabel,
    filtered:element.classList.contains('is-factory-filtered'),
    context:element.classList.contains('is-factory-context'),
    hidden:element.classList.contains('is-factory-hidden')||element.getAttribute('aria-hidden')==='true',
    searchHit:Boolean(term&&searchable.includes(term))
  };
}

function machineDescriptors(){
  if(!activeSurface)return[];
  return [...activeSurface.querySelectorAll('.prep-map-machine:not(.is-unplaced)')].map(describeMachine);
}

function worldMetrics(surface=activeSurface){
  const width=number(surface?.dataset.baseWidth)||number(surface?.style.width)||1;
  const height=number(surface?.dataset.baseHeight)||number(surface?.style.height)||1;
  return { width,height,key:`${width}x${height}` };
}

function updateSwitch(){
  if(!activeControls)return;
  for(const button of activeControls.querySelectorAll('[data-factory-renderer]'))button.setAttribute('aria-pressed',String(button.dataset.factoryRenderer===preference));
}

function persist(){try{sessionStorage.setItem(STORAGE_KEY,preference);}catch{}}

function rememberCamera(){
  const camera=controller?.camera;
  if(camera?.scale>0&&Number.isFinite(camera.center?.x)&&Number.isFinite(camera.center?.y))savedCamera={ scale:camera.scale,center:{ x:camera.center.x,y:camera.center.y } };
}

function destroyPixi({ preserveCamera=true }={}){
  mountToken+=1;
  if(preserveCamera)rememberCamera();
  try{controller?.destroy?.();}catch(error){console.warn('NEOMES Pixi destroy:',error);}
  controller=null;
  activeHost?.remove();activeHost=null;
  activePixiControls?.remove();activePixiControls=null;
  activePixiBadge?.remove();activePixiBadge=null;
  activeFloor?.classList.remove('factory-renderer-pixi');
  activeWorldKey='';
}

function setPreference(next){
  preference=next==='pixi'?'pixi':'classic';
  persist();updateSwitch();
  if(preference==='pixi')mountPixi();else destroyPixi();
}

function ensureSwitch(){
  const controls=activeFloor?.querySelector('.factory-workspace-controls');
  if(!controls)return;
  let switcher=controls.querySelector('.factory-renderer-switch');
  if(!switcher){
    switcher=document.createElement('div');
    switcher.className='factory-renderer-switch';
    switcher.setAttribute('aria-label','Motor de renderização do mapa');
    switcher.innerHTML='<button type="button" data-factory-renderer="classic">Clássico</button><button type="button" data-factory-renderer="pixi">Mapa Pixi</button>';
    controls.prepend(switcher);
  }
  activeControls=switcher;updateSwitch();
}

function runPixiAction(action){
  if(preference!=='pixi'||!controller)return;
  if(action==='fit')controller.fit();
  if(action==='in')controller.zoomIn();
  if(action==='out')controller.zoomOut();
  rememberCamera();updateScale(controller.scale);
}

function createHost(){
  const host=document.createElement('div');host.className='factory-pixi-host';host.dataset.pixiHost='';
  const stopAtPixiBoundary=event=>event.stopPropagation();
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','wheel','dblclick'])host.addEventListener(type,stopAtPixiBoundary);
  activeViewport.append(host);activeHost=host;

  const controls=document.createElement('div');controls.className='factory-pixi-controls';
  controls.innerHTML='<button type="button" data-pixi-action="out" aria-label="Diminuir zoom">−</button><button type="button" data-pixi-action="fit">Ajustar</button><output data-pixi-scale>--%</output><button type="button" data-pixi-action="in" aria-label="Aumentar zoom">+</button>';
  const stopControlPointer=event=>event.stopPropagation();
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','wheel'])controls.addEventListener(type,stopControlPointer);
  controls.addEventListener('click',event=>{
    const button=event.target.closest('[data-pixi-action]');
    if(!button)return;
    event.preventDefault();event.stopPropagation();runPixiAction(button.dataset.pixiAction);
  });
  activeViewport.append(controls);activePixiControls=controls;

  const badge=document.createElement('div');badge.className='factory-pixi-badge';badge.innerHTML='<i></i><span>PixiJS · GPU · arraste e faça pinch para navegar</span>';
  activeViewport.append(badge);activePixiBadge=badge;
  return host;
}

function updateScale(value){const output=activeViewport?.querySelector('[data-pixi-scale]');if(output)output.value=`${Math.round((Number(value)||0)*100)}%`;}

function selectCurrentMachine(id){
  const element=[...(activeSurface?.querySelectorAll('[data-map-machine]')||[])].find(candidate=>candidate.dataset.mapMachine===id);
  element?.click();
}

function syncFromDom(){
  if(preference!=='pixi'||!controller||!activeSurface)return;
  const list=machineDescriptors();
  controller.update(list);rememberCamera();
  const search=searchTerm();
  const hits=list.filter(machine=>machine.searchHit);
  const focusKey=search&&hits.length===1?`${search}:${hits[0].id}`:'';
  if(focusKey&&focusKey!==lastSearchFocus){controller.focus(hits[0].id);rememberCamera();lastSearchFocus=focusKey;}
  if(!search)lastSearchFocus='';
  updateScale(controller.scale);
}

function adoptPixi(oldViewport,oldFloor){
  if(preference!=='pixi'||!controller||!activeHost||!activeViewport)return false;
  const metrics=worldMetrics();
  if(metrics.key!==activeWorldKey)return false;
  oldFloor?.classList.remove('factory-renderer-pixi');
  activeFloor?.classList.add('factory-renderer-pixi');
  activeViewport.append(activeHost);
  if(activePixiControls)activeViewport.append(activePixiControls);
  if(activePixiBadge)activeViewport.append(activePixiBadge);
  observeSurface();syncFromDom();updateScale(controller.scale);
  return true;
}

async function mountPixi(){
  if(preference!=='pixi'||!activeViewport||!activeSurface||!activeFloor)return;
  destroyPixi();
  if(preference!=='pixi'||!activeViewport||!activeSurface||!activeFloor)return;
  const token=++mountToken;
  activeFloor.classList.add('factory-renderer-pixi');
  const host=createHost();
  try{
    const module=await import('./vendor/factory-map-pixi.bundle.js?v=1.0.0');
    if(token!==mountToken||preference!=='pixi'||!document.contains(host))return;
    const metrics=worldMetrics();
    const descriptors=machineDescriptors();
    const mounted=await module.mountPixiFactoryMap({
      host,worldWidth:metrics.width,worldHeight:metrics.height,machines:descriptors,initialCamera:savedCamera,
      onSelect:selectCurrentMachine,
      onCamera:camera=>{savedCamera={ scale:camera.scale,center:{ x:camera.center.x,y:camera.center.y } };updateScale(camera.scale);}
    });
    if(token!==mountToken){mounted?.destroy?.();return;}
    controller=mounted;activeWorldKey=metrics.key;rememberCamera();updateScale(controller.scale);syncFromDom();
  }catch(error){
    console.error('NEOMES Pixi renderer:',error);
    preference='classic';persist();updateSwitch();destroyPixi({ preserveCamera:false });
  }
}

function observeSurface(){
  surfaceObserver?.disconnect();surfaceObserver=null;
  if(!activeSurface)return;
  surfaceObserver=new MutationObserver(()=>requestAnimationFrame(syncFromDom));
  surfaceObserver.observe(activeSurface,{ subtree:true,attributes:true,attributeFilter:['class','aria-hidden'] });
}

function enhance(){
  const surface=document.querySelector('[data-map-surface]');
  const viewport=document.querySelector('[data-map-viewport]');
  const floor=surface?.closest('.factory-workspace,.prep-floor');
  if(!surface||!viewport||!floor){
    if(activeSurface?.isConnected||activeViewport?.isConnected)return;
    destroyPixi();activeSurface=null;activeViewport=null;activeFloor=null;activeControls=null;return;
  }
  const oldViewport=activeViewport;const oldFloor=activeFloor;
  const changed=surface!==activeSurface||viewport!==activeViewport||floor!==activeFloor;
  activeSurface=surface;activeViewport=viewport;activeFloor=floor;
  ensureSwitch();
  if(changed){
    observeSurface();
    if(preference==='pixi'&&!adoptPixi(oldViewport,oldFloor))mountPixi();
  }else if(preference==='pixi'&&!controller&&!activeHost)mountPixi();
  else if(preference==='pixi'&&controller)syncFromDom();
}

function scheduleEnhance(){if(enhanceRaf)return;enhanceRaf=requestAnimationFrame(()=>{enhanceRaf=0;enhance();});}

const app=document.getElementById('app');
const appObserver=new MutationObserver(scheduleEnhance);
if(app)appObserver.observe(app,{ childList:true,subtree:true,characterData:true });

document.addEventListener('click',event=>{
  const renderer=event.target.closest('[data-factory-renderer]');
  if(renderer){event.preventDefault();setPreference(renderer.dataset.factoryRenderer);}
});

window.NEOMES_FACTORY_PIXI={
  setRenderer:setPreference,
  get renderer(){return preference;},
  get ready(){return Boolean(controller);},
  get machineCount(){return controller?.machineCount||0;},
  get visibleMachineCount(){return controller?.visibleMachineCount||0;},
  get highlightedMachineCount(){return controller?.highlightedMachineCount||0;},
  get scale(){return Number(controller?.scale||0);},
  get camera(){return controller?.camera||savedCamera||null;},
  project(id){return controller?.project?.(id)||null;},
  focus(id){const result=controller?.focus?.(id)||false;if(result)rememberCamera();return result;},
  fit(){const result=controller?.fit?.();rememberCamera();return result;}
};

window.addEventListener('beforeunload',()=>{surfaceObserver?.disconnect();appObserver.disconnect();destroyPixi();});
scheduleEnhance();
