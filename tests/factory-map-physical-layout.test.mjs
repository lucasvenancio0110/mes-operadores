import assert from 'node:assert/strict';
import {
  FACTORY_MAP_GEOMETRY,
  FACTORY_MAP_POSITIONS,
  factoryMapBounds,
  factoryMapMachineIds,
  mapMachineMetadata
} from '../app/preparer-map-layout.js';

const placement=id=>{
  const value=mapMachineMetadata(id).placement;
  assert(value,`Máquina sem posição física: ${id}`);
  return value;
};

const horizontalGap=(leftId,rightId)=>{
  const left=placement(leftId);const right=placement(rightId);
  const first=left.x<=right.x?left:right;const second=first===left?right:left;
  return second.x-(first.x+FACTORY_MAP_GEOMETRY.cardWidth);
};

const verticalGap=(topId,bottomId)=>{
  const top=placement(topId);const bottom=placement(bottomId);
  const first=top.y<=bottom.y?top:bottom;const second=first===top?bottom:top;
  return second.y-(first.y+FACTORY_MAP_GEOMETRY.cardHeight);
};

const approximately=(actual,expected,tolerance=0.001,message='')=>{
  assert(Math.abs(actual-expected)<=tolerance,`${message} esperado ${expected}px, encontrado ${actual}px`);
};

assert.equal(factoryMapMachineIds().length,136,'A planta deve continuar contendo 134 TNL, MILLTAP e DISCOVERY.');
assert.equal(new Set(factoryMapMachineIds()).size,136,'Nenhuma máquina pode ser duplicada pela geometria física.');

// Vários corredores verticais independentes no bloco superior esquerdo.
for(const [left,right] of [['tnl-024','tnl-017'],['tnl-017','tnl-028'],['tnl-028','tnl-009'],['tnl-009','tnl-060'],['tnl-060','tnl-085']]){
  approximately(horizontalGap(left,right),FACTORY_MAP_GEOMETRY.aisleGap,0.001,`Corredor ${left}/${right}`);
}

// 083 → 067 é bloco compacto, sem corredor entre máquinas vizinhas.
for(const [left,right] of [['tnl-083','tnl-072'],['tnl-072','tnl-069'],['tnl-069','tnl-068'],['tnl-068','tnl-067']]){
  approximately(horizontalGap(left,right),FACTORY_MAP_GEOMETRY.compactGap,0.001,`Bloco compacto ${left}/${right}`);
}
assert(FACTORY_MAP_GEOMETRY.compactGap<FACTORY_MAP_GEOMETRY.aisleGap,'Gap compacto precisa ser menor que corredor.');

// Corredores horizontais confirmados no bloco da 083 e entre 121/124.
approximately(verticalGap('tnl-083','tnl-084'),FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor horizontal 083/084');
approximately(verticalGap('tnl-084','tnl-086'),FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor horizontal 084/086');
approximately(verticalGap('tnl-121','tnl-124'),FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor horizontal 121/124');

// Torres inferiores: corredores com exatamente a mesma largura.
const aisle9697=horizontalGap('tnl-096','tnl-097');
const aisle97100=horizontalGap('tnl-097','tnl-100');
approximately(aisle9697,FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor 096/097');
approximately(aisle97100,FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor 097/100');
approximately(aisle9697,aisle97100,0.001,'Corredores inferiores padronizados');

// Equipamentos especiais: célula de origem preservada, posição física corrigida.
const p140=placement('tnl-140');const p139=placement('tnl-139');
assert.equal(p140.cell,'S92','A origem da TNL 140 na planilha deve permanecer auditável.');
assert.equal(p140.physicalOverride,true);
assert.equal(p140.y,p139.y,'TNL 140 deve ficar na mesma fileira física da TNL 139.');
approximately(horizontalGap('tnl-139','tnl-140'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 139/140 lado a lado');

const p145=placement('tnl-145');const p134=placement('tnl-134');
assert.equal(p145.cell,'S80','A origem provisória da TNL 145 deve permanecer auditável.');
assert.equal(p145.physicalOverride,true);
assert.equal(p145.y,p134.y,'TNL 145 deve ficar na mesma fileira física da TNL 134.');
approximately(horizontalGap('tnl-134','tnl-145'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 134/145 lado a lado');

const milltap=placement('milltap');const discovery=placement('discovery');
assert.equal(milltap.x,p145.x,'MILLTAP deve ficar diretamente acima da TNL 145.');
assert(milltap.y<p145.y,'MILLTAP deve ficar acima da TNL 145.');
assert.equal(discovery.y,milltap.y,'DISCOVERY deve ficar na mesma fileira da MILLTAP.');
approximately(horizontalGap('milltap','discovery'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'MILLTAP/DISCOVERY lado a lado');

// Nenhum card pode se sobrepor depois da nova malha física.
const overlaps=[];
for(let first=0;first<FACTORY_MAP_POSITIONS.length;first+=1){
  for(let second=first+1;second<FACTORY_MAP_POSITIONS.length;second+=1){
    const a=FACTORY_MAP_POSITIONS[first];const b=FACTORY_MAP_POSITIONS[second];
    const overlap=a.x<b.x+FACTORY_MAP_GEOMETRY.cardWidth&&a.x+FACTORY_MAP_GEOMETRY.cardWidth>b.x&&a.y<b.y+FACTORY_MAP_GEOMETRY.cardHeight&&a.y+FACTORY_MAP_GEOMETRY.cardHeight>b.y;
    if(overlap)overlaps.push([a.machineId,b.machineId]);
  }
}
assert.deepEqual(overlaps,[],'A geometria física não pode produzir sobreposição de máquinas.');

const bounds=factoryMapBounds();
assert(bounds.width>=2400&&bounds.width<=2600,`Largura física inesperada: ${bounds.width}px`);
assert(bounds.height>=2850&&bounds.height<=3050,`Altura física inesperada: ${bounds.height}px`);

console.log(`Mapa físico validado: ${bounds.width}x${bounds.height}px, corredor=${FACTORY_MAP_GEOMETRY.aisleGap}px, compacto=${FACTORY_MAP_GEOMETRY.compactGap}px.`);
