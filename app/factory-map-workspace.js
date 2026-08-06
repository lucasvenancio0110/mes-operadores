import {
  CAMERA_LIMITS,
  calculateCorridors,
  calculateLineRegions,
  clampCamera,
  fitCamera,
  inflateRect,
  normalizeLineLabel,
  semanticZoomLevel,
  unionRects,
  viewportWorldRect
} from './factory-map-spatial.js';

const STORAGE_KEY='neomes:factory-map-workspace:v6.3';
const FILTERS=Object.freeze([
  ['all','Todas'],
  ['producing','Produzindo'],
  ['setup','Setup'],
  ['stopped','Paradas'],
  ['maintenance','Manutenção'],
  ['attention','Até 16h'],
  ['critical','Menos de 8h']
]);

const state={
  camera:{ x:0,y:0,scale:.6 },
  selectedLine:'all',
  filter:'all',
  filterMode:'highlight',
  minimap:true,
  surface:null,
  viewport:null,
  floor:null,
  cards:[],
  regions:[],
  corridors:[],
  signature:'',
  pointers:new Map(),
  gesture:null,
  raf:0,
  enhanceRaf:0,
  searchTimer:0,
  suppressClickUntil:0,
  observer:null
};

const finite=value=>Number.isFinite(Number(value))?Number(value):0;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);

function loadState(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');
    if(saved?.camera)state.camera={ x:finite(saved.camera.x),y:finite(saved.camera.y),scale:finite(saved.camera.scale)||.6 };
    if(saved?.selectedLine)state.selectedLine=saved.selectedLine;
    if(saved?.filter)state.filter=saved.filter;
    if(saved?.filterMode)state.filterMode=saved.filterMode;
    if(typeof saved?.minimap==='boolean')state.minimap=saved.minimap;
    state.signature=String(saved?.signature||'');
  }catch{}
}

function persistState(){
  try{
    sessionStorage.setItem(STORAGE_KEY,JSON.stringify({
      camera:state.camera,
      selectedLine:state.selectedLine,
      filter:state.filter,
      filterMode:state.filterMode,
      minimap:state.minimap,
      signature:state.signature
    }));
  }catch{}
}

function isMapActive(){
  return Boolean(document.querySelector('[data-view-mode="map"][aria-pressed="true"]')&&document.querySelector('[data-map-surface]'));
}

function parseCards(surface){
  return [...surface.querySelectorAll('.prep-map-machine:not(.is-unplaced)')].map(element=>{
    const line=normalizeLineLabel(element.querySelector('header small')?.textContent);
    const aria=element.getAttribute('aria-label')||'';
    const operator=aria.match(/operador\s+([^,]+)/i)?.[1]?.trim()||'Não atribuído';
    const x=finite(element.style.left);const y=finite(element.style.top);
    const width=finite(getComputedStyle(element).width)||142;
    const height=finite(getComputedStyle(element).height)||78;
    element.dataset.factoryLine=line;
    element.dataset.factoryX=String(x);
    element.dataset.factoryY=String(y);
    element.style.setProperty('--factory-x',`${x}px`);
    element.style.setProperty('--factory-y',`${y}px`);
    let operatorRow=element.querySelector('.factory-card-operator');
    if(!operatorRow){
      operatorRow=document.createElement('span');
      operatorRow.className='factory-card-operator';
      const footer=element.querySelector('footer');
      footer?.before(operatorRow);
    }
    operatorRow.textContent=operator;
    operatorRow.title=`Operador: ${operator}`;
    for(const strong of element.querySelectorAll('.prep-map-order strong'))strong.title=strong.textContent.trim();
    return { element,line,x,y,width,height,status:element.dataset.status||'',urgency:element.dataset.urgency||'' };
  });
}

function mapBounds(){
  const width=finite(state.surface?.dataset.baseWidth)||finite(state.surface?.style.width);
  const height=finite(state.surface?.dataset.baseHeight)||finite(state.surface?.style.height);
  return { x:0,y:0,width,height };
}

function cardRect(card){return { x:card.x,y:card.y,width:card.width,height:card.height };}

function renderFloorLayer(){
  const surface=state.surface;if(!surface)return;
  surface.querySelector('.factory-floor-layer')?.remove();
  surface.querySelector('.factory-line-labels')?.remove();
  const bounds=mapBounds();
  const layer=document.createElementNS('http://www.w3.org/2000/svg','svg');
  layer.setAttribute('class','factory-floor-layer');
  layer.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
  layer.setAttribute('width',String(bounds.width));
  layer.setAttribute('height',String(bounds.height));
  layer.setAttribute('aria-hidden','true');
  const corridorMarkup=state.corridors.map((corridor,index)=>{
    const centerLine=corridor.orientation==='vertical'
      ? `<line x1="${corridor.x+corridor.width/2}" y1="${corridor.y}" x2="${corridor.x+corridor.width/2}" y2="${corridor.y+corridor.height}" />`
      : `<line x1="${corridor.x}" y1="${corridor.y+corridor.height/2}" x2="${corridor.x+corridor.width}" y2="${corridor.y+corridor.height/2}" />`;
    const label=(corridor.orientation==='vertical'?corridor.height:corridor.width)>360
      ? `<text x="${corridor.x+corridor.width/2}" y="${corridor.y+corridor.height/2}" transform="rotate(${corridor.orientation==='vertical'?-90:0} ${corridor.x+corridor.width/2} ${corridor.y+corridor.height/2})">CORREDOR</text>`:'';
    return `<g class="factory-corridor" data-corridor="${index}"><rect x="${corridor.x}" y="${corridor.y}" width="${corridor.width}" height="${corridor.height}" rx="10" />${centerLine}${label}</g>`;
  }).join('');
  const regionMarkup=state.regions.map(region=>`<g class="factory-line-region" data-line="${escapeHtml(region.line)}"><rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="18" /></g>`).join('');
  layer.innerHTML=`<defs><pattern id="factoryFloorGrid" width="74" height="28" patternUnits="userSpaceOnUse"><path d="M 74 0 L 0 0 0 28" /></pattern></defs><rect class="factory-floor-base" width="100%" height="100%"/><rect class="factory-floor-grid" width="100%" height="100%" fill="url(#factoryFloorGrid)"/>${regionMarkup}${corridorMarkup}`;
  surface.prepend(layer);
  const labels=document.createElement('div');labels.className='factory-line-labels';
  labels.innerHTML=state.regions.map(region=>`<button type="button" data-factory-line-label="${escapeHtml(region.line)}" style="left:${Math.max(8,region.x+10)}px;top:${Math.max(8,region.y+10)}px">${escapeHtml(region.line)}</button>`).join('');
  surface.append(labels);
}

function ensureToolbar(){
  const header=state.floor?.querySelector(':scope > header');if(!header)return;
  let controls=header.querySelector('.factory-workspace-controls');
  if(!controls){
    controls=document.createElement('div');
    controls.className='factory-workspace-controls';
    controls.innerHTML=`<span class="factory-region-indicator" data-factory-region>Mapa geral</span><button type="button" data-factory-action="general" hidden>Mapa geral</button><button type="button" data-factory-action="minimap" aria-pressed="true">Mini mapa</button><button type="button" data-factory-action="fullscreen">Tela cheia</button>`;
    header.append(controls);
  }
  let filterbar=state.floor.querySelector('.factory-filterbar');
  if(!filterbar){
    filterbar=document.createElement('div');filterbar.className='factory-filterbar';
    filterbar.innerHTML=`<div class="factory-filterchips" aria-label="Filtros do mapa">${FILTERS.map(([id,label])=>`<button type="button" data-factory-filter="${id}" aria-pressed="${id===state.filter}">${label}</button>`).join('')}</div><button type="button" class="factory-filter-mode" data-factory-action="filter-mode">Destacar</button>`;
    state.floor.querySelector(':scope > header')?.after(filterbar);
  }
}

function ensureMinimap(){
  if(!state.viewport)return;
  let minimap=state.viewport.querySelector('.factory-minimap');
  if(!minimap){
    minimap=document.createElementNS('http://www.w3.org/2000/svg','svg');
    minimap.setAttribute('class','factory-minimap');
    minimap.setAttribute('role','img');
    minimap.setAttribute('aria-label','Mini mapa da fábrica');
    state.viewport.append(minimap);
    minimap.addEventListener('pointerdown',event=>{
      event.preventDefault();event.stopPropagation();
      const rect=minimap.getBoundingClientRect();const bounds=mapBounds();
      const worldX=(event.clientX-rect.left)/rect.width*bounds.width;
      const worldY=(event.clientY-rect.top)/rect.height*bounds.height;
      state.camera.x=state.viewport.clientWidth/2-worldX*state.camera.scale;
      state.camera.y=state.viewport.clientHeight/2-worldY*state.camera.scale;
      applyCamera();
    });
  }
  const bounds=mapBounds();minimap.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
  minimap.innerHTML=`${state.regions.map(region=>`<rect class="factory-minimap-line" x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="12"/>`).join('')}${state.corridors.map(corridor=>`<rect class="factory-minimap-corridor" x="${corridor.x}" y="${corridor.y}" width="${corridor.width}" height="${corridor.height}" rx="6"/>`).join('')}${state.cards.map(card=>`<rect class="factory-minimap-machine" x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="4"/>`).join('')}<rect class="factory-minimap-view" data-factory-minimap-view rx="8"/>`;
  minimap.hidden=!state.minimap;
}

function updateMinimap(){
  const view=state.viewport?.querySelector('[data-factory-minimap-view]');if(!view||!state.viewport)return;
  const world=viewportWorldRect(state.camera,{ width:state.viewport.clientWidth,height:state.viewport.clientHeight });
  view.setAttribute('x',String(world.x));view.setAttribute('y',String(world.y));view.setAttribute('width',String(world.width));view.setAttribute('height',String(world.height));
}

function viewportSize(){return { width:state.viewport?.clientWidth||1,height:state.viewport?.clientHeight||1 };}

function scheduleApply(){
  if(state.raf)return;
  state.raf=requestAnimationFrame(()=>{state.raf=0;applyCamera();});
}

function applyCamera(options={}){
  if(!state.surface||!state.viewport)return;
  state.camera=clampCamera(state.camera,viewportSize(),mapBounds(),CAMERA_LIMITS);
  if(options.animate){state.floor?.classList.add('is-camera-animating');setTimeout(()=>state.floor?.classList.remove('is-camera-animating'),260);}
  state.surface.style.transform=`translate3d(${state.camera.x}px,${state.camera.y}px,0) scale(${state.camera.scale})`;
  state.surface.style.transformOrigin='0 0';
  const stage=state.surface.parentElement;if(stage){stage.style.width='100%';stage.style.height='100%';}
  state.floor.dataset.semanticZoom=semanticZoomLevel(state.camera.scale);
  const label=state.floor.querySelector('[data-map-zoom-label]');if(label)label.textContent=`${Math.round(state.camera.scale*100)}%`;
  updateMinimap();persistState();
}

function fitRect(rect,options={}){
  if(!rect||!state.viewport)return;
  state.camera=fitCamera(viewportSize(),inflateRect(rect,options.context??24),{ padding:options.padding??28,minScale:options.minScale??CAMERA_LIMITS.minScale,maxScale:options.maxScale??1.35 });
  applyCamera({ animate:options.animate!==false });
}

function fitGeneral(){fitRect(mapBounds(),{ padding:24,context:0,maxScale:1 });}

function lineRegion(line){return state.regions.find(region=>region.line===line)||null;}

function updateSelectionButtons(){
  for(const button of document.querySelectorAll('[data-line-filter]')){
    const canonical=button.dataset.lineFilter==='all'?'all':normalizeLineLabel(button.textContent);
    button.setAttribute('aria-pressed',String(canonical===state.selectedLine));
  }
  for(const button of state.surface?.querySelectorAll('[data-factory-line-label]')||[])button.setAttribute('aria-pressed',String(button.dataset.factoryLineLabel===state.selectedLine));
  const indicator=state.floor?.querySelector('[data-factory-region]');if(indicator)indicator.textContent=state.selectedLine==='all'?'Mapa geral':state.selectedLine;
  const general=state.floor?.querySelector('[data-factory-action="general"]');if(general)general.hidden=state.selectedLine==='all';
}

function cardMatchesFilter(card){
  if(state.filter==='all')return true;
  if(state.filter==='attention')return ['attention','critical'].includes(card.urgency);
  if(state.filter==='critical')return card.urgency==='critical';
  if(state.filter==='stopped')return ['stopped','conference-pending','shift-closed','no-order'].includes(card.status);
  return card.status===state.filter;
}

function applyVisualFilters(){
  for(const card of state.cards){
    const outsideLine=state.selectedLine!=='all'&&card.line!==state.selectedLine;
    const outsideFilter=!cardMatchesFilter(card);
    card.element.classList.toggle('is-factory-context',outsideLine);
    card.element.classList.toggle('is-factory-filtered',outsideFilter);
    card.element.classList.toggle('is-factory-hidden',state.filterMode==='only'&&outsideFilter);
    card.element.setAttribute('aria-hidden',String(state.filterMode==='only'&&outsideFilter));
  }
  for(const region of state.surface?.querySelectorAll('.factory-line-region')||[])region.classList.toggle('is-selected',region.dataset.line===state.selectedLine);
  for(const button of state.floor?.querySelectorAll('[data-factory-filter]')||[])button.setAttribute('aria-pressed',String(button.dataset.factoryFilter===state.filter));
  const mode=state.floor?.querySelector('[data-factory-action="filter-mode"]');if(mode)mode.textContent=state.filterMode==='highlight'?'Destacar':'Mostrar somente';
  updateSelectionButtons();
}

function selectLine(line){
  state.selectedLine=line==='all'?'all':normalizeLineLabel(line);
  applyVisualFilters();
  if(state.selectedLine==='all')fitGeneral();else fitRect(lineRegion(state.selectedLine),{ padding:38,context:46,maxScale:1.28 });
}

function setFilter(filter){state.filter=FILTERS.some(([id])=>id===filter)?filter:'all';applyVisualFilters();persistState();}

function pulse(cards){
  for(const card of cards){card.element.classList.remove('is-factory-search-hit');void card.element.offsetWidth;card.element.classList.add('is-factory-search-hit');setTimeout(()=>card.element.classList.remove('is-factory-search-hit'),1800);}
}

function searchCards(term,openUnique=false){
  const normalized=String(term||'').trim().toLocaleLowerCase('pt-BR');
  const status=document.querySelector('.factory-search-status')||(()=>{const node=document.createElement('small');node.className='factory-search-status';document.querySelector('.prep-search')?.append(node);return node;})();
  if(!normalized){status.textContent='';return;}
  const matches=state.cards.filter(card=>`${card.element.textContent} ${card.element.getAttribute('aria-label')||''}`.toLocaleLowerCase('pt-BR').includes(normalized));
  if(!matches.length){status.textContent='Nenhum resultado';return;}
  status.textContent=matches.length===1?'1 máquina localizada':`${matches.length} máquinas localizadas`;
  pulse(matches);
  const bounds=unionRects(matches.map(cardRect));if(bounds)fitRect(bounds,{ padding:44,context:34,maxScale:matches.length===1?1.28:.95 });
  if(matches.length===1){
    matches[0].element.focus({ preventScroll:true });
    if(openUnique)setTimeout(()=>matches[0].element.click(),220);
  }
}

function zoomAt(clientX,clientY,nextScale){
  if(!state.viewport)return;
  const rect=state.viewport.getBoundingClientRect();
  const point={ x:clientX-rect.left,y:clientY-rect.top };
  const world={ x:(point.x-state.camera.x)/state.camera.scale,y:(point.y-state.camera.y)/state.camera.scale };
  const scale=Math.min(CAMERA_LIMITS.maxScale,Math.max(CAMERA_LIMITS.minScale,nextScale));
  state.camera={ scale,x:point.x-world.x*scale,y:point.y-world.y*scale };
  applyCamera();
}

function bindViewport(viewport){
  if(viewport.dataset.factoryGestures==='true')return;
  viewport.dataset.factoryGestures='true';
  viewport.addEventListener('pointerdown',event=>{
    if(event.target.closest('button,.factory-minimap'))return;
    viewport.setPointerCapture?.(event.pointerId);state.pointers.set(event.pointerId,{ x:event.clientX,y:event.clientY });
    if(state.pointers.size===1){state.gesture={ type:'pan',startX:event.clientX,startY:event.clientY,camera:{ ...state.camera },moved:false };}
    if(state.pointers.size===2){
      const points=[...state.pointers.values()];const midpoint={ x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2 };
      const rect=viewport.getBoundingClientRect();const local={ x:midpoint.x-rect.left,y:midpoint.y-rect.top };
      state.gesture={ type:'pinch',distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y),world:{ x:(local.x-state.camera.x)/state.camera.scale,y:(local.y-state.camera.y)/state.camera.scale },scale:state.camera.scale };
    }
  });
  viewport.addEventListener('pointermove',event=>{
    if(!state.pointers.has(event.pointerId))return;event.preventDefault();state.pointers.set(event.pointerId,{ x:event.clientX,y:event.clientY });
    if(state.pointers.size===1&&state.gesture?.type==='pan'){
      const dx=event.clientX-state.gesture.startX;const dy=event.clientY-state.gesture.startY;
      if(Math.hypot(dx,dy)>6)state.gesture.moved=true;
      state.camera={ ...state.camera,x:state.gesture.camera.x+dx,y:state.gesture.camera.y+dy };scheduleApply();
    }else if(state.pointers.size>=2){
      const points=[...state.pointers.values()].slice(0,2);const distance=Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y));
      const midpoint={ x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2 };const rect=viewport.getBoundingClientRect();
      const local={ x:midpoint.x-rect.left,y:midpoint.y-rect.top };const scale=Math.min(CAMERA_LIMITS.maxScale,Math.max(CAMERA_LIMITS.minScale,state.gesture.scale*distance/state.gesture.distance));
      state.camera={ scale,x:local.x-state.gesture.world.x*scale,y:local.y-state.gesture.world.y*scale };scheduleApply();
    }
  },{ passive:false });
  const end=event=>{
    const moved=state.gesture?.moved;state.pointers.delete(event.pointerId);
    if(moved)state.suppressClickUntil=Date.now()+260;
    if(state.pointers.size===1){const point=[...state.pointers.values()][0];state.gesture={ type:'pan',startX:point.x,startY:point.y,camera:{ ...state.camera },moved:false };}
    else if(!state.pointers.size)state.gesture=null;
  };
  viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
  viewport.addEventListener('wheel',event=>{event.preventDefault();const direction=event.deltaY>0?.9:1.1;zoomAt(event.clientX,event.clientY,state.camera.scale*direction);},{ passive:false });
  viewport.addEventListener('dblclick',event=>{event.preventDefault();zoomAt(event.clientX,event.clientY,state.camera.scale*1.3);});
}

function toggleFullscreen(){
  const floor=state.floor;if(!floor)return;
  const active=floor.classList.toggle('is-factory-fullscreen');document.body.classList.toggle('factory-fullscreen-open',active);
  const button=floor.querySelector('[data-factory-action="fullscreen"]');if(button)button.textContent=active?'Sair da tela cheia':'Tela cheia';
  if(active&&floor.requestFullscreen)floor.requestFullscreen().catch(()=>{});
  else if(!active&&document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});
  requestAnimationFrame(()=>state.selectedLine==='all'?fitGeneral():fitRect(lineRegion(state.selectedLine),{ padding:38,context:46,maxScale:1.28 }));
}

function enhanceMap(){
  const surface=document.querySelector('[data-map-surface]');const viewport=document.querySelector('[data-map-viewport]');const floor=surface?.closest('.prep-floor');
  if(!surface||!viewport||!floor)return;
  state.surface=surface;state.viewport=viewport;state.floor=floor;floor.classList.add('factory-workspace');
  state.cards=parseCards(surface);
  const signature=`${surface.dataset.baseWidth}x${surface.dataset.baseHeight}:${state.cards.length}`;
  const sameSignature=signature===state.signature;state.signature=signature;
  state.regions=calculateLineRegions(state.cards,{ padding:22 });
  state.corridors=calculateCorridors(state.cards,{ minGap:34,maxWidth:62,minLength:180 });
  renderFloorLayer();ensureToolbar();ensureMinimap();bindViewport(viewport);applyVisualFilters();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(sameSignature)applyCamera();
    else if(state.selectedLine!=='all'&&lineRegion(state.selectedLine))fitRect(lineRegion(state.selectedLine),{ padding:38,context:46,maxScale:1.28,animate:false });
    else fitGeneral();
  }));
}

function scheduleEnhance(){
  if(state.enhanceRaf)return;
  state.enhanceRaf=requestAnimationFrame(()=>{state.enhanceRaf=0;if(isMapActive())enhanceMap();});
}

function onCaptureClick(event){
  if(Date.now()<state.suppressClickUntil&&event.target.closest('[data-map-machine]')){event.preventDefault();event.stopImmediatePropagation();return;}
  const mapActive=isMapActive();
  const line=event.target.closest('[data-line-filter],[data-factory-line-label]');
  if(mapActive&&line){event.preventDefault();event.stopImmediatePropagation();selectLine(line.dataset.lineFilter==='all'?'all':line.dataset.factoryLineLabel||line.textContent);return;}
  const attention=event.target.closest('[data-attention-filter]');
  if(mapActive&&attention){event.preventDefault();event.stopImmediatePropagation();setFilter(attention.dataset.attentionFilter==='occurrence'?'stopped':attention.dataset.attentionFilter);return;}
  const zoom=event.target.closest('[data-map-zoom]');
  if(mapActive&&zoom){event.preventDefault();event.stopImmediatePropagation();const action=zoom.dataset.mapZoom;if(action==='fit')state.selectedLine==='all'?fitGeneral():fitRect(lineRegion(state.selectedLine),{ padding:38,context:46,maxScale:1.28 });else zoomAt(state.viewport.getBoundingClientRect().left+state.viewport.clientWidth/2,state.viewport.getBoundingClientRect().top+state.viewport.clientHeight/2,state.camera.scale+(action==='in'?.12:-.12));return;}
  const filter=event.target.closest('[data-factory-filter]');if(filter){event.preventDefault();setFilter(filter.dataset.factoryFilter);return;}
  const action=event.target.closest('[data-factory-action]');if(action){
    event.preventDefault();
    if(action.dataset.factoryAction==='general')selectLine('all');
    if(action.dataset.factoryAction==='fullscreen')toggleFullscreen();
    if(action.dataset.factoryAction==='minimap'){state.minimap=!state.minimap;action.setAttribute('aria-pressed',String(state.minimap));ensureMinimap();persistState();}
    if(action.dataset.factoryAction==='filter-mode'){state.filterMode=state.filterMode==='highlight'?'only':'highlight';applyVisualFilters();persistState();}
    return;
  }
  const view=event.target.closest('[data-view-mode="map"]');if(view){
    const search=document.getElementById('prepSearch');if(search&&search.value){search.value='';search.dispatchEvent(new Event('input',{ bubbles:true }));}
    setTimeout(scheduleEnhance,0);
  }
}

function onCaptureInput(event){
  if(event.target.id!=='prepSearch'||!isMapActive())return;
  event.stopImmediatePropagation();clearTimeout(state.searchTimer);
  const term=event.target.value;state.searchTimer=setTimeout(()=>searchCards(term,true),420);
}

function onCaptureKeydown(event){
  if(event.target.id==='prepSearch'&&isMapActive()&&event.key==='Enter'){
    event.preventDefault();event.stopImmediatePropagation();clearTimeout(state.searchTimer);searchCards(event.target.value,true);
  }
  if(event.key==='Escape'&&state.floor?.classList.contains('is-factory-fullscreen'))toggleFullscreen();
}

export function startFactoryMapWorkspace(){
  if(typeof document==='undefined'||typeof window==='undefined')return;
  loadState();
  document.addEventListener('click',onCaptureClick,true);
  document.addEventListener('input',onCaptureInput,true);
  document.addEventListener('keydown',onCaptureKeydown,true);
  document.addEventListener('fullscreenchange',()=>{
    if(!document.fullscreenElement&&state.floor?.classList.contains('is-factory-fullscreen')){state.floor.classList.remove('is-factory-fullscreen');document.body.classList.remove('factory-fullscreen-open');}
  });
  window.addEventListener('resize',()=>{if(state.surface)applyCamera();});
  state.observer=new MutationObserver(scheduleEnhance);
  state.observer.observe(document.documentElement,{ childList:true,subtree:true });
  scheduleEnhance();
}

if(typeof document!=='undefined')startFactoryMapWorkspace();
