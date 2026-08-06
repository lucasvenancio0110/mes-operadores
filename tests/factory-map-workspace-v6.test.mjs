import assert from 'node:assert/strict';
import {
  calculateCorridors,
  calculateLineRegions,
  clampCamera,
  fitCamera,
  rectIntersects,
  semanticZoomLevel,
  viewportWorldRect
} from '../app/factory-map-spatial.js';

const cards=[
  { line:'Linha 1',x:0,y:0,width:142,height:78 },
  { line:'Linha 1',x:0,y:110,width:142,height:78 },
  { line:'Linha 2',x:250,y:0,width:142,height:78 },
  { line:'Linha 2',x:250,y:110,width:142,height:78 },
  { line:'Linha 3',x:0,y:330,width:142,height:78 },
  { line:'Linha 3',x:250,y:330,width:142,height:78 }
];

const regions=calculateLineRegions(cards,{ padding:20 });
assert.equal(regions.length,3);
assert.equal(regions[0].line,'LINHA 1');

const corridors=calculateCorridors(cards,{ minGap:32,maxWidth:64,minLength:150 });
assert(corridors.length>=2,'Corredores verticais e horizontais devem ser inferidos dos vazios físicos.');
for(const corridor of corridors)for(const card of cards)assert.equal(rectIntersects(corridor,card),false,'Corredor não pode atravessar máquina.');

const fitted=fitCamera({ width:390,height:600 },{ x:0,y:0,width:1000,height:800 },{ padding:20 });
assert(fitted.scale>=.24&&fitted.scale<.5);

const clamped=clampCamera({ x:9999,y:-9999,scale:1 },{ width:390,height:600 },{ width:1000,height:800 });
assert(clamped.x<=72&&clamped.y>=600-800-72);

assert.equal(semanticZoomLevel(.479),'distant');
assert.equal(semanticZoomLevel(.48),'intermediate');
assert.equal(semanticZoomLevel(.879),'intermediate');
assert.equal(semanticZoomLevel(.88),'close');

const world=viewportWorldRect({ x:-100,y:-50,scale:.5 },{ width:400,height:300 });
assert.deepEqual(world,{ x:200,y:100,width:800,height:600 });

for(const viewport of [{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1366,height:768}]){
  const camera=fitCamera(viewport,{x:0,y:0,width:2500,height:2800},{padding:24});
  assert(Number.isFinite(camera.scale)&&Number.isFinite(camera.x)&&Number.isFinite(camera.y),`Camera inválida para ${viewport.width}x${viewport.height}`);
}

console.log('Workspace industrial: corredores, câmera, semantic zoom e matriz responsiva validados.');
