export const CAMERA_LIMITS = Object.freeze({ minScale:0.24,maxScale:1.65,overscroll:72 });

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function normalizeLineLabel(value) {
  const text=String(value || '').trim().toLocaleUpperCase('pt-BR');
  const match=text.match(/LINHA\s*0?(\d{1,2})/);
  return match ? `LINHA ${Number(match[1])}` : text || 'SEM LINHA';
}

export function rectIntersects(a,b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function inflateRect(rect,padding=0) {
  const amount=Math.max(0,finite(padding));
  return { x:rect.x-amount,y:rect.y-amount,width:rect.width+amount*2,height:rect.height+amount*2 };
}

export function unionRects(rects=[]) {
  const valid=rects.filter(rect=>rect&&rect.width>=0&&rect.height>=0);
  if(!valid.length)return null;
  const minX=Math.min(...valid.map(rect=>finite(rect.x)));
  const minY=Math.min(...valid.map(rect=>finite(rect.y)));
  const maxX=Math.max(...valid.map(rect=>finite(rect.x)+finite(rect.width)));
  const maxY=Math.max(...valid.map(rect=>finite(rect.y)+finite(rect.height)));
  return { x:minX,y:minY,width:maxX-minX,height:maxY-minY };
}

export function calculateLineRegions(cards=[],options={}) {
  const padding=Math.max(0,finite(options.padding ?? 22));
  const groups=new Map();
  for(const card of cards){
    const line=normalizeLineLabel(card.line);
    if(!groups.has(line))groups.set(line,[]);
    groups.get(line).push({ x:finite(card.x),y:finite(card.y),width:finite(card.width),height:finite(card.height) });
  }
  return [...groups.entries()].map(([line,rects])=>{
    const bounds=inflateRect(unionRects(rects),padding);
    return { line,...bounds,count:rects.length };
  }).sort((a,b)=>{
    const number=value=>Number(value.match(/\d+/)?.[0] || 999);
    return number(a.line)-number(b.line)||a.y-b.y||a.x-b.x;
  });
}

function mergeCorridors(corridors=[]) {
  const merged=[];
  for(const corridor of corridors.sort((a,b)=>a.orientation.localeCompare(b.orientation)||a.x-b.x||a.y-b.y)){
    const current=merged.at(-1);
    if(current&&current.orientation===corridor.orientation){
      const gap=current.orientation==='vertical'
        ? Math.abs((current.x+current.width/2)-(corridor.x+corridor.width/2))
        : Math.abs((current.y+current.height/2)-(corridor.y+corridor.height/2));
      const overlap=current.orientation==='vertical'
        ? Math.min(current.y+current.height,corridor.y+corridor.height)-Math.max(current.y,corridor.y)
        : Math.min(current.x+current.width,corridor.x+corridor.width)-Math.max(current.x,corridor.x);
      if(gap<18&&overlap>-24){
        const union=unionRects([current,corridor]);
        Object.assign(current,union,{ label:current.label||corridor.label });
        continue;
      }
    }
    merged.push({ ...corridor });
  }
  return merged;
}

function emptyBands(cards,orientation,options) {
  const minGap=Math.max(20,finite(options.minGap ?? 42));
  const maxWidth=Math.max(28,finite(options.maxWidth ?? 68));
  const minLength=Math.max(100,finite(options.minLength ?? 210));
  const overall=unionRects(cards);
  if(!overall)return [];
  const edges=[...new Set(cards.flatMap(card=>orientation==='vertical'?[card.x,card.x+card.width]:[card.y,card.y+card.height]).map(value=>Math.round(value*100)/100))].sort((a,b)=>a-b);
  const corridors=[];
  for(let index=0;index<edges.length-1;index+=1){
    const start=edges[index];const end=edges[index+1];const gap=end-start;
    if(gap<minGap)continue;
    const band=orientation==='vertical'
      ? { x:start,y:overall.y,width:gap,height:overall.height }
      : { x:overall.x,y:start,width:overall.width,height:gap };
    if(cards.some(card=>rectIntersects(card,band)))continue;
    const before=cards.filter(card=>orientation==='vertical'?card.x+card.width<=start:card.y+card.height<=start).length;
    const after=cards.filter(card=>orientation==='vertical'?card.x>=end:card.y>=end).length;
    if(before<2||after<2)continue;
    const corridor=orientation==='vertical'
      ? { orientation,x:start+(gap-Math.min(maxWidth,gap-8))/2,y:overall.y,width:Math.min(maxWidth,gap-8),height:overall.height }
      : { orientation,x:overall.x,y:start+(gap-Math.min(maxWidth,gap-8))/2,width:overall.width,height:Math.min(maxWidth,gap-8) };
    const length=orientation==='vertical'?corridor.height:corridor.width;
    if(length>=minLength)corridors.push({ ...corridor,label:'CORREDOR' });
  }
  return corridors;
}

function betweenLineRegions(regions,options) {
  const minGap=Math.max(20,finite(options.minGap ?? 42));
  const maxWidth=Math.max(28,finite(options.maxWidth ?? 68));
  const corridors=[];
  for(let first=0;first<regions.length;first+=1){
    for(let second=first+1;second<regions.length;second+=1){
      const a=regions[first];const b=regions[second];
      const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
      const gapX=Math.max(b.x-a.x-a.width,a.x-b.x-b.width);
      const gapY=Math.max(b.y-a.y-a.height,a.y-b.y-b.height);
      if(overlapY>120&&gapX>=minGap){
        const left=a.x+a.width<=b.x?a:b;const right=left===a?b:a;
        const width=Math.min(maxWidth,right.x-(left.x+left.width)-8);
        corridors.push({ orientation:'vertical',x:left.x+left.width+((right.x-left.x-left.width)-width)/2,y:Math.max(a.y,b.y),width,height:overlapY,label:'CORREDOR' });
      }
      if(overlapX>160&&gapY>=minGap){
        const top=a.y+a.height<=b.y?a:b;const bottom=top===a?b:a;
        const height=Math.min(maxWidth,bottom.y-(top.y+top.height)-8);
        corridors.push({ orientation:'horizontal',x:Math.max(a.x,b.x),y:top.y+top.height+((bottom.y-top.y-top.height)-height)/2,width:overlapX,height,label:'CORREDOR' });
      }
    }
  }
  return corridors.filter(corridor=>corridor.width>12&&corridor.height>12);
}

export function calculateCorridors(cards=[],options={}) {
  const normalized=cards.map(card=>({ x:finite(card.x),y:finite(card.y),width:finite(card.width),height:finite(card.height),line:normalizeLineLabel(card.line) }));
  const regions=calculateLineRegions(normalized,{ padding:0 });
  const candidates=[...emptyBands(normalized,'vertical',options),...emptyBands(normalized,'horizontal',options),...betweenLineRegions(regions,options)];
  return mergeCorridors(candidates).filter(corridor=>!normalized.some(card=>rectIntersects(card,corridor)));
}

export function semanticZoomLevel(scale) {
  const value=finite(scale);
  if(value<0.48)return 'distant';
  if(value<0.88)return 'intermediate';
  return 'close';
}

export function fitCamera(viewport,rect,options={}) {
  const padding=Math.max(0,finite(options.padding ?? 28));
  const minScale=finite(options.minScale ?? CAMERA_LIMITS.minScale);
  const maxScale=finite(options.maxScale ?? CAMERA_LIMITS.maxScale);
  const safeWidth=Math.max(1,finite(viewport.width)-padding*2);
  const safeHeight=Math.max(1,finite(viewport.height)-padding*2);
  const scale=Math.min(maxScale,Math.max(minScale,Math.min(safeWidth/Math.max(1,rect.width),safeHeight/Math.max(1,rect.height))));
  return {
    scale,
    x:(finite(viewport.width)-rect.width*scale)/2-rect.x*scale,
    y:(finite(viewport.height)-rect.height*scale)/2-rect.y*scale
  };
}

export function clampCamera(camera,viewport,surface,options={}) {
  const overscroll=Math.max(0,finite(options.overscroll ?? CAMERA_LIMITS.overscroll));
  const scale=Math.min(finite(options.maxScale ?? CAMERA_LIMITS.maxScale),Math.max(finite(options.minScale ?? CAMERA_LIMITS.minScale),finite(camera.scale)||1));
  const scaledWidth=Math.max(1,finite(surface.width)*scale);
  const scaledHeight=Math.max(1,finite(surface.height)*scale);
  const viewportWidth=Math.max(1,finite(viewport.width));
  const viewportHeight=Math.max(1,finite(viewport.height));
  const centeredX=(viewportWidth-scaledWidth)/2;
  const centeredY=(viewportHeight-scaledHeight)/2;
  const minX=scaledWidth<=viewportWidth?centeredX:viewportWidth-scaledWidth-overscroll;
  const maxX=scaledWidth<=viewportWidth?centeredX:overscroll;
  const minY=scaledHeight<=viewportHeight?centeredY:viewportHeight-scaledHeight-overscroll;
  const maxY=scaledHeight<=viewportHeight?centeredY:overscroll;
  return { scale,x:Math.min(maxX,Math.max(minX,finite(camera.x))),y:Math.min(maxY,Math.max(minY,finite(camera.y))) };
}

export function viewportWorldRect(camera,viewport) {
  const scale=Math.max(0.0001,finite(camera.scale)||1);
  return { x:-finite(camera.x)/scale,y:-finite(camera.y)/scale,width:finite(viewport.width)/scale,height:finite(viewport.height)/scale };
}
