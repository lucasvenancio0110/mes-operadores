const STORAGE_KEY='neomes:factory-map-renderer:v1';
let preference='classic';
let controller=null;
let activeViewport=null;
let activeSurface=null;
let activeFloor=null;
let activeHost=null;
let activeControls=null;
let surfaceObserver=null;
let enhanceRaf=0;
let mountToken=0;

try{preference=sessionStorage.getItem(STORAGE_KEY)==='pixi'?'pixi':'classic';}catch{}

const number=value=>Number.parseFloat(String(value||'').replace(/[^\d.,-]/g,'').replace(',','.'))||0;
const text=(root,selector)=>root.querySelector(selector)?.textContent?.trim()||'';

function describeMachine(element){
  const progress=text(element,'.prep-map-progress span');
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
    ariaLabel:element.getAttribute('aria-label')||'',
    filtered:element.classList.contains('is-factory-filtered'),
    context:element.classList.contains('is-factory-context'),
    hidden:element.classList.contains('is-factory-hidden')||element.getAttribute('aria-hidden')==='true'
  };
}

function machineDescriptors(){
  if(!activeSurface)return[];
  return [...activeSurface.querySelectorAll('.prep-map-machine:not(.is-unplaced)')].map(describeMachine);
}

function updateSwitch(){
  if(!activeControls)return;
  for(const button of activeControls.querySelectorAll('[data-factory-renderer]'))button.setAttribute('aria-pressed',String(button.dataset.factoryRenderer===preference));
}

function persist(){try{sessionStorage.setItem(STORAGE_KEY,preference);}catch{}}

function destroyPixi(){
  mountToken+=1;
  try{controller?.destroy?.();}catch(error){console.warn('NEOMES Pixi destroy:',error);}
  controller=null;
  activeHost?.remove();activeHost=null;
  activeViewport?.querySelector('.factory-pixi-controls')?.remove();
  activeViewport?.querySelector('.factory-pixi-badge')?.remove();
  activeFloor?.classList.remove('factory-renderer-pixi');
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

function createHost(){
  let host=activeViewport.querySelector('.factory-pixi-host');
  if(!host){host=document.createElement('div');host.className='factory-pixi-host';host.dataset.pixiHost='';activeViewport.append(host);}
  let controls=activeViewport.querySelector('.factory-pixi-controls');
  if(!controls){
    controls=document.createElement('div');controls.className='factory-pixi-controls';
    controls.innerHTML='<button type="button" data-pixi-action="out" aria-label="Diminuir zoom">−</button><button type="button" data-pixi-action="fit">Ajustar</button><output data-pixi-scale>--%</output><button type="button" data-pixi-action="in" aria-label="Aumentar zoom">+</button>';
    activeViewport.append(controls);
  }
  if(!activeViewport.querySelector('.factory-pixi-badge')){
    const badge=document.createElement('div');badge.className='factory-pixi-badge';badge.innerHTML='<i></i><span>PixiJS · GPU · arraste e faça pinch para navegar</span>';activeViewport.append(badge);
  }
  return host;
}

function updateScale(value){const output=activeViewport?.querySelector('[data-pixi-scale]');if(output)output.value=`${Math.round((Number(value)||0)*100)}%`;}

function syncFromDom(){
  if(preference!=='pixi'||!controller||!activeSurface)return;
  controller.update(machineDescriptors());
}

async function mountPixi(){
  if(preference!=='pixi'||!activeViewport||!activeSurface||!activeFloor)return;
  destroyPixi();
  if(preference!=='pixi'||!activeViewport||!activeSurface||!activeFloor)return;
  const token=++mountToken;
  activeFloor.classList.add('factory-renderer-pixi');
  const host=createHost();activeHost=host;
  try{
    const module=await import('./vendor/factory-map-pixi.bundle.js?v=1.0.0');
    if(token!==mountToken||preference!=='pixi'||!document.contains(host))return;
    const worldWidth=number(activeSurface.dataset.baseWidth)||number(activeSurface.style.width)||1;
    const worldHeight=number(activeSurface.dataset.baseHeight)||number(activeSurface.style.height)||1;
    const machineElements=new Map([...activeSurface.querySelectorAll('[data-map-machine]')].map(element=>[element.dataset.mapMachine,element]));
    const mounted=await module.mountPixiFactoryMap({
      host,worldWidth,worldHeight,machines:machineDescriptors(),
      onSelect:id=>machineElements.get(id)?.click(),
      onCamera:camera=>updateScale(camera.scale)
    });
    if(token!==mountToken){mounted?.destroy?.();return;}
    controller=mounted;
    updateScale(controller.scale);
    const search=document.getElementById('prepSearch')?.value?.trim();
    const descriptors=machineDescriptors();
    if(search&&descriptors.length===1)controller.focus(descriptors[0].id);
  }catch(error){
    console.error('NEOMES Pixi renderer:',error);
    host.innerHTML='<div class="factory-pixi-error"><div><strong>Mapa Pixi indisponível</strong><br><span>O mapa clássico foi preservado. Toque em “Clássico” para continuar.</span></div></div>';
    activeFloor.classList.remove('factory-renderer-pixi');
    preference='classic';persist();updateSwitch();
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
  if(!surface||!viewport||!floor){destroyPixi();activeSurface=null;activeViewport=null;activeFloor=null;return;}
  const changed=surface!==activeSurface||viewport!==activeViewport||floor!==activeFloor;
  activeSurface=surface;activeViewport=viewport;activeFloor=floor;
  ensureSwitch();
  if(changed){observeSurface();if(preference==='pixi')mountPixi();}
  else if(preference==='pixi'&&!controller&&!activeHost)mountPixi();
}

function scheduleEnhance(){if(enhanceRaf)return;enhanceRaf=requestAnimationFrame(()=>{enhanceRaf=0;enhance();});}

const app=document.getElementById('app');
const appObserver=new MutationObserver(scheduleEnhance);
if(app)appObserver.observe(app,{ childList:true,subtree:true });

document.addEventListener('click',event=>{
  const renderer=event.target.closest('[data-factory-renderer]');
  if(renderer){event.preventDefault();setPreference(renderer.dataset.factoryRenderer);return;}
  if(preference!=='pixi'||!controller)return;
  const action=event.target.closest('[data-pixi-action]')?.dataset.pixiAction;
  if(action==='fit')controller.fit();
  if(action==='in')controller.zoomIn();
  if(action==='out')controller.zoomOut();
});

document.addEventListener('input',event=>{if(event.target.id==='prepSearch'&&preference==='pixi')requestAnimationFrame(()=>{const list=machineDescriptors();controller?.update(list);if(event.target.value.trim()&&list.length===1)controller?.focus(list[0].id);});});

window.NEOMES_FACTORY_PIXI={
  setRenderer:setPreference,
  get renderer(){return preference;},
  get ready(){return Boolean(controller);},
  get machineCount(){return controller?.machineCount||0;},
  project(id){return controller?.project?.(id)||null;},
  focus(id){return controller?.focus?.(id)||false;},
  fit(){return controller?.fit?.();}
};

window.addEventListener('beforeunload',()=>{surfaceObserver?.disconnect();appObserver.disconnect();destroyPixi();});
scheduleEnhance();
