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

// Bloco 086: começa ao lado da 091 e toda a fileira segue no mesmo sentido.
assert.equal(placement('tnl-086').y,placement('tnl-091').y,'TNL 086 deve ficar alinhada verticalmente com a TNL 091.');
approximately(horizontalGap('tnl-091','tnl-086'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 091/086 lado a lado');
for(const [left,right] of [['tnl-086','tnl-081'],['tnl-081','tnl-082'],['tnl-082','tnl-076'],['tnl-076','tnl-075']]){
  assert.equal(placement(left).y,placement(right).y,`${left}/${right} devem permanecer na mesma fileira.`);
  approximately(horizontalGap(left,right),FACTORY_MAP_GEOMETRY.compactGap,0.001,`Fileira da 086 ${left}/${right}`);
}

// Bloco 084: começa ao lado da 093 e conserva o mesmo espaçamento compacto.
assert.equal(placement('tnl-084').y,placement('tnl-093').y,'TNL 084 deve ficar alinhada verticalmente com a TNL 093.');
approximately(horizontalGap('tnl-093','tnl-084'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 093/084 lado a lado');
for(const [left,right] of [['tnl-084','tnl-079'],['tnl-079','tnl-077'],['tnl-077','tnl-074'],['tnl-074','tnl-073']]){
  assert.equal(placement(left).y,placement(right).y,`${left}/${right} devem permanecer na mesma fileira.`);
  approximately(horizontalGap(left,right),FACTORY_MAP_GEOMETRY.compactGap,0.001,`Fileira da 084 ${left}/${right}`);
}

// O bloco da 111 nasce na altura da 066, logo abaixo da 095, e segue à direita.
assert.equal(placement('tnl-111').y,placement('tnl-066').y,'TNL 111 deve começar na mesma altura física da TNL 066.');
assert(placement('tnl-111').y>placement('tnl-095').y,'TNL 111 deve começar abaixo da TNL 095.');
approximately(horizontalGap('tnl-066','tnl-111'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 066/111 lado a lado');
for(const [left,right] of [['tnl-111','tnl-103'],['tnl-103','tnl-110'],['tnl-110','tnl-062'],['tnl-062','tnl-045'],['tnl-045','tnl-055'],['tnl-055','tnl-054']]){
  assert.equal(placement(left).y,placement(right).y,`${left}/${right} devem permanecer na mesma fileira.`);
  approximately(horizontalGap(left,right),FACTORY_MAP_GEOMETRY.compactGap,0.001,`Fileira da 111 ${left}/${right}`);
}
assert.equal(placement('tnl-070').x,placement('tnl-111').x,'A fileira inferior do bloco da 111 deve começar no mesmo eixo horizontal.');
approximately(verticalGap('tnl-111','tnl-070'),FACTORY_MAP_GEOMETRY.normalGap,0.001,'Espaço entre as fileiras 111/070');

// Torres inferiores e corredor horizontal 121/124 permanecem padronizados.
approximately(verticalGap('tnl-121','tnl-124'),FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor horizontal 121/124');
const aisle9697=horizontalGap('tnl-096','tnl-097');
const aisle97100=horizontalGap('tnl-097','tnl-100');
approximately(aisle9697,FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor 096/097');
approximately(aisle97100,FACTORY_MAP_GEOMETRY.aisleGap,0.001,'Corredor 097/100');
approximately(aisle9697,aisle97100,0.001,'Corredores inferiores padronizados');

// Coluna especial: 145, 144, 143, 142, 141, 140 de cima para baixo.
const specialIds=['tnl-145','tnl-144','tnl-143','tnl-142','tnl-141','tnl-140'];
const expectedSourceCells=['S80','S83','F23','S86','S89','S92'];
for(let index=0;index<specialIds.length;index+=1){
  const item=placement(specialIds[index]);
  assert.equal(item.cell,expectedSourceCells[index],`Origem de ${specialIds[index]} deve permanecer auditável.`);
  assert.equal(item.physicalOverride,true,`${specialIds[index]} deve usar override físico.`);
  if(index>0){
    assert.equal(item.x,placement(specialIds[0]).x,'Toda a coluna 145→140 deve usar o mesmo eixo horizontal.');
    approximately(verticalGap(specialIds[index-1],specialIds[index]),FACTORY_MAP_GEOMETRY.compactGap,0.001,`Coluna especial ${specialIds[index-1]}/${specialIds[index]}`);
  }
}

assert.equal(placement('tnl-145').y,placement('tnl-134').y,'TNL 145 deve permanecer ao lado da TNL 134.');
approximately(horizontalGap('tnl-134','tnl-145'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 134/145 lado a lado');
assert.equal(placement('tnl-140').y,placement('tnl-139').y,'TNL 140 deve permanecer ao lado da TNL 139.');
approximately(horizontalGap('tnl-139','tnl-140'),FACTORY_MAP_GEOMETRY.compactGap,0.001,'TNL 139/140 lado a lado');

const milltap=placement('milltap');const discovery=placement('discovery');
assert.equal(milltap.x,placement('tnl-145').x,'MILLTAP deve ficar diretamente acima da TNL 145.');
assert(milltap.y<placement('tnl-145').y,'MILLTAP deve ficar acima da TNL 145.');
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

console.log(`Mapa físico validado: ${bounds.width}x${bounds.height}px; blocos 086/084/111 alinhados; coluna 145→140 validada.`);
