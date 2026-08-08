import 'pixi.js/accessibility';
import { Application, Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';

const COLORS=Object.freeze({
  floor:0x070b13,
  floorGrid:0x172033,
  machine:0x0d1624,
  machineBorder:0x2b3b55,
  text:0xf6f8fc,
  muted:0x9ba8bb,
  accent:0xd32fb7,
  producing:0x28d17c,
  setup:0x9b65ff,
  adjustment:0xc98753,
  maintenance:0xf5a524,
  stopped:0xff626e,
  critical:0xff626e,
  attention:0xf3bd41,
  neutral:0x6f809a
});

const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number(value)||0));
const statusColor=status=>COLORS[status]||COLORS.neutral;
const urgencyColor=urgency=>urgency==='critical'?COLORS.critical:urgency==='attention'?COLORS.attention:COLORS.neutral;
const machineNumber=label=>String(label||'').replace(/^TNL\s*/i,'').trim()||String(label||'');

const titleStyle=new TextStyle({ fontFamily:'system-ui',fontSize:20,fontWeight:'700',fill:COLORS.text });
const statusStyle=new TextStyle({ fontFamily:'system-ui',fontSize:10,fontWeight:'700',fill:COLORS.muted });
const smallStyle=new TextStyle({ fontFamily:'system-ui',fontSize:9,fontWeight:'600',fill:COLORS.muted });
const metricStyle=new TextStyle({ fontFamily:'system-ui',fontSize:10,fontWeight:'700',fill:COLORS.text });

function drawFloor(width,height){
  const group=new Container();
  const base=new Graphics().roundRect(0,0,width,height,26).fill({ color:COLORS.floor,alpha:1 }).stroke({ color:0x22304a,width:3,alpha:.9 });
  group.addChild(base);
  const grid=new Graphics();
  const step=160;
  for(let x=step;x<width;x+=step)grid.moveTo(x,0).lineTo(x,height);
  for(let y=step;y<height;y+=step)grid.moveTo(0,y).lineTo(width,y);
  grid.stroke({ color:COLORS.floorGrid,width:1,alpha:.35 });
  group.addChild(grid);
  return group;
}

function machineVisual(machine,onSelect){
  const group=new Container();
  group.position.set(machine.x,machine.y);
  group.eventMode='static';
  group.cursor='pointer';
  group.hitArea=new Rectangle(0,0,machine.width,machine.height);
  group.accessible=true;
  group.accessibleType='button';
  group.accessibleTitle=machine.ariaLabel||machine.label;
  group.accessibleHint='Abrir detalhes da máquina';
  group.tabIndex=0;

  const ring=new Graphics();
  const body=new Graphics();
  const accent=new Graphics();
  group.addChild(ring,body,accent);

  const title=new Text({ text:machineNumber(machine.label),style:titleStyle });
  title.position.set(14,9);
  group.addChild(title);

  const statusDot=new Graphics().circle(0,0,4.5).fill(statusColor(machine.status));
  statusDot.position.set(machine.width-17,18);
  group.addChild(statusDot);

  const status=new Text({ text:String(machine.statusLabel||machine.status||'').toUpperCase(),style:statusStyle });
  status.position.set(14,37);
  group.addChild(status);

  const order=new Text({ text:machine.op?`OP ${machine.op}`:'SEM OP',style:smallStyle });
  order.position.set(14,52);
  group.addChild(order);

  const metric=new Text({ text:machine.production||'',style:metricStyle });
  metric.anchor.set(1,0);
  metric.position.set(machine.width-12,51);
  group.addChild(metric);

  function redraw(){
    const color=statusColor(machine.status);
    ring.clear().roundRect(-4,-4,machine.width+8,machine.height+8,20).stroke({ color:urgencyColor(machine.urgency),width:machine.urgency==='critical'?3:1.5,alpha:machine.urgency==='none'?.18:.65 });
    body.clear().roundRect(0,0,machine.width,machine.height,16).fill({ color:COLORS.machine,alpha:.98 }).stroke({ color:COLORS.machineBorder,width:1.5,alpha:.95 });
    accent.clear().roundRect(0,0,5,machine.height,16).fill({ color,alpha:1 });
    statusDot.clear().circle(0,0,4.5).fill(color);
    title.text=machineNumber(machine.label);
    status.text=String(machine.statusLabel||machine.status||'').toUpperCase();
    order.text=machine.op?`OP ${machine.op}`:'SEM OP';
    metric.text=machine.production||'';
    group.alpha=machine.hidden?0:((machine.filtered||machine.context)?.6:1);
    group.visible=!machine.hidden;
  }

  redraw();
  group.on('pointerover',()=>{if(!machine.hidden){group.scale.set(1.035);body.tint=0x152239;}});
  group.on('pointerout',()=>{group.scale.set(1);body.tint=0xffffff;});
  group.on('pointertap',()=>{if(!machine.hidden)onSelect?.(machine.id);});

  return { group,ring,body,title,status,order,metric,machine,redraw };
}

function semantic(nodes,scale){
  const compact=scale<.42;
  const medium=scale>=.42&&scale<.72;
  for(const node of nodes.values()){
    node.status.visible=!compact;
    node.order.visible=!compact&&!medium;
    node.metric.visible=!compact&&!medium;
    node.title.style.fontSize=compact?26:20;
    node.title.position.y=compact?20:9;
  }
}

export async function mountPixiFactoryMap({ host,worldWidth,worldHeight,machines,onSelect,onCamera }){
  if(!host)throw new Error('Host Pixi não informado.');
  const app=new Application();
  await app.init({
    resizeTo:host,
    preference:'webgl',
    autoDensity:true,
    resolution:Math.min(globalThis.devicePixelRatio||1,2),
    antialias:true,
    backgroundAlpha:0,
    powerPreference:'high-performance'
  });
  app.canvas.className='factory-pixi-canvas';
  app.canvas.setAttribute('aria-label','Mapa interativo Pixi da fábrica');
  app.canvas.style.touchAction='none';
  host.replaceChildren(app.canvas);
  app.ticker.maxFPS=45;

  const viewport=new Viewport({
    screenWidth:host.clientWidth,
    screenHeight:host.clientHeight,
    worldWidth,
    worldHeight,
    events:app.renderer.events,
    ticker:app.ticker,
    threshold:8,
    stopPropagation:true
  });
  viewport.eventMode='static';
  viewport.drag({ mouseButtons:'left' }).pinch().wheel({ smooth:3 }).decelerate({ friction:.92 }).clampZoom({ minScale:.16,maxScale:2.4 }).clamp({ direction:'all',underflow:'center' });
  app.stage.addChild(viewport);

  const floor=drawFloor(worldWidth,worldHeight);
  viewport.addChild(floor);
  const machineLayer=new Container();
  viewport.addChild(machineLayer);
  const nodes=new Map();

  function sync(nextMachines){
    const incoming=new Set(nextMachines.map(machine=>machine.id));
    for(const [id,node] of nodes){
      if(incoming.has(id))continue;
      machineLayer.removeChild(node.group);
      node.group.destroy({ children:true });
      nodes.delete(id);
    }
    for(const machine of nextMachines){
      let node=nodes.get(machine.id);
      if(!node){
        node=machineVisual(machine,onSelect);
        nodes.set(machine.id,node);
        machineLayer.addChild(node.group);
      }else{
        Object.assign(node.machine,machine);
        node.group.position.set(machine.x,machine.y);
        node.group.hitArea=new Rectangle(0,0,machine.width,machine.height);
        node.group.accessibleTitle=machine.ariaLabel||machine.label;
        node.redraw();
      }
    }
    semantic(nodes,viewport.scale.x);
  }

  sync(machines);
  viewport.fitWorld(true).moveCenter(worldWidth/2,worldHeight/2);
  const initialScale=clamp(viewport.scale.x,.18,1);
  viewport.setZoom(initialScale,false).moveCenter(worldWidth/2,worldHeight/2);
  semantic(nodes,viewport.scale.x);

  const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  app.ticker.add(ticker=>{
    if(reducedMotion)return;
    const pulse=.42+.25*(1+Math.sin(ticker.lastTime/320))/2;
    for(const node of nodes.values())if(node.machine.urgency==='critical')node.ring.alpha=pulse;
  });

  const emitCamera=()=>{
    semantic(nodes,viewport.scale.x);
    onCamera?.({ scale:viewport.scale.x,center:{ x:viewport.center.x,y:viewport.center.y } });
  };
  viewport.on('zoomed',emitCamera);
  viewport.on('moved',emitCamera);

  const resizeObserver=new ResizeObserver(()=>{
    const width=Math.max(1,host.clientWidth);const height=Math.max(1,host.clientHeight);
    viewport.resize(width,height,worldWidth,worldHeight);
    app.resize();
  });
  resizeObserver.observe(host);

  const blockBubble=event=>event.stopPropagation();
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','wheel'])app.canvas.addEventListener(type,blockBubble,{ passive:type==='wheel' });

  return {
    update(nextMachines){sync(nextMachines);},
    fit(){viewport.animate({ time:320,position:{ x:worldWidth/2,y:worldHeight/2 },scale:clamp(Math.min(host.clientWidth/worldWidth,host.clientHeight/worldHeight),.18,1),ease:'easeInOutSine' });},
    zoomIn(){viewport.animate({ time:180,scale:clamp(viewport.scale.x*1.22,.16,2.4),ease:'easeOutSine' });},
    zoomOut(){viewport.animate({ time:180,scale:clamp(viewport.scale.x/1.22,.16,2.4),ease:'easeOutSine' });},
    focus(id){const node=nodes.get(id);if(!node)return false;viewport.animate({ time:420,position:{ x:node.machine.x+node.machine.width/2,y:node.machine.y+node.machine.height/2 },scale:Math.max(.9,viewport.scale.x),ease:'easeInOutSine' });return true;},
    project(id){const node=nodes.get(id);if(!node)return null;const point=viewport.toScreen(node.machine.x+node.machine.width/2,node.machine.y+node.machine.height/2);return { x:point.x,y:point.y };},
    get machineCount(){return nodes.size;},
    get scale(){return viewport.scale.x;},
    destroy(){resizeObserver.disconnect();app.destroy(true,{ children:true });host.replaceChildren();}
  };
}
