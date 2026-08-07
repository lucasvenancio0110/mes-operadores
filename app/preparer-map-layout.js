const tnl = number => `tnl-${String(number).padStart(3,'0')}`;

// Âncoras extraídas da aba LAYOUT da planilha da fábrica. As células continuam
// preservadas como referência de origem; a geometria física abaixo corrige apenas
// o espaçamento visual conforme os corredores validados no chão de fábrica.
const SPREADSHEET_PLACEMENTS = `
B2:24 D2:17 F2:28 H2:9 J2:60 L2:85
N3:83 Q3:72 T3:69 W3:68 Z3:67
B5:2 D5:13 F5:7 H5:10 J5:59 L5:87
B8:15 D8:16 F8:8 H8:33 J8:58 L8:88
B11:23 D11:18 F11:3 H11:34 J11:57 L11:89
N13:84 Q13:79 T13:77 W13:74 Z13:73
B14:35 D14:19 F14:31 H14:36 J14:53 L14:90
B17:29 D17:25 F17:32 H17:37 J17:42 L17:91
B20:30 D20:26 F20:4 H20:43 J20:52 L20:92
B23:5 D23:27 F23:143 H23:44 J23:61 L23:93 N23:86 Q23:81 T23:82 W23:76 Z23:75
D26:46 F26:49 H26:39 J26:64 L26:94
D29:47 F29:50 H29:40 J29:65 L29:95
D32:48 F32:51 H32:41 J32:66 N32:111 Q32:103 T32:110 W32:62 Z32:45 AC32:55 AF32:54
N42:70 Q42:102 T42:80 W42:63 Z42:78 AC42:71 AF42:56
N52:96 U52:97 AB52:100
N55:98 U55:99 AB55:101
N58:104 U58:105 AB58:106
N61:107 U61:108 AB61:109
N64:112 U64:113 AB64:114
N67:115 U67:116 AB67:117
N70:118 U70:119 AB70:120
N73:121 U73:122 AB73:123
M76:124 P76:125 S76:126 V76:127 Y76:128 AB76:129 AE76:130
M86:134 S86:142 Y86:milltap
M89:135 S89:141
M92:136 S92:140
M95:137
M98:138
M101:139
`;

// A planilha ainda não fixa estas posições. Elas permanecem identificadas como
// provisórias para facilitar futuras correções após validação física.
const PROVISIONAL_PLACEMENTS = `S80:145 S83:144 V89:6`;
const SUPPLEMENTAL_PLACEMENTS = `AB86:discovery`;

export const FACTORY_MAP_GEOMETRY = Object.freeze({
  cardWidth:142,
  cardHeight:78,
  // Mantidos apenas como referência da malha original da planilha.
  columnStep:74,
  rowStep:28,
  padding:32,
  // Regras físicas centralizadas. Corredores equivalentes usam a mesma medida.
  compactGap:18,
  normalGap:44,
  aisleGap:92,
  sectionGap:100
});

const WORKCENTER_GROUPS = {
  TNL_A2:[61,64,65,66],
  TNL_A3:[105,106,107,108,109,118,119,121,122,123,134,135,136,137,138,139,82,89,90,91,92,93,94,95,98],
  TNL_C1:[45,54,62],
  TNL_C2:[103,124,125,126,127,128,129,130,56,71,80],
  TNL_C3:[110,111,63,70,78],
  TNL_D:[100,101,112,113,115,116,117,19,25,26,42,47,48,57,58,59,60,85,86,87,88,99],
  TNL_F:[2,3,4,6,7,8,9,10,28,31,32,33,34,49,50,51,52],
  TNL_I12:[114,13,15,16,18,23,27,53,67,68,69,72,73,74,75,76,77,79,83,84,96,97],
  TNL_I18:[55],
  TNL_K:[5,102,17,81]
};

function columnNumber(letters) {
  return [...letters].reduce((total,letter)=>total*26+letter.charCodeAt(0)-64,0);
}

function machineIdFromToken(value) {
  const raw=String(value || '').trim().toLowerCase();
  return raw === 'milltap' || raw === 'discovery' ? raw : tnl(Number(raw));
}

function axisPositions(labels,start,gap) {
  const positions=new Map();
  let cursor=start;
  for(const label of labels){
    positions.set(label,cursor);
    cursor+=FACTORY_MAP_GEOMETRY.cardWidth+gap;
  }
  return positions;
}

function rowPositions(rows,start,gap) {
  const positions=new Map();
  let cursor=start;
  for(const row of rows){
    positions.set(row,cursor);
    cursor+=FACTORY_MAP_GEOMETRY.cardHeight+gap;
  }
  return positions;
}

// Bloco esquerdo: 024 | 017 | 028 | 009 | 060 | 085 possuem corredores
// distintos entre cada coluna, repetidos verticalmente no bloco.
const LEFT_COLUMNS=['B','D','F','H','J','L'];
const LEFT_X=axisPositions(LEFT_COLUMNS,0,FACTORY_MAP_GEOMETRY.aisleGap);
const LEFT_ROWS=[2,5,8,11,14,17,20,23,26,29,32];
const LEFT_Y=rowPositions(LEFT_ROWS,0,FACTORY_MAP_GEOMETRY.compactGap);

const leftRightEdge=LEFT_X.get('L')+FACTORY_MAP_GEOMETRY.cardWidth;
const RIGHT_START=leftRightEdge+FACTORY_MAP_GEOMETRY.compactGap;

// Bloco superior direito: 083/072/069/068/067 não têm corredor entre si.
const UPPER_RIGHT_COLUMNS=['N','Q','T','W','Z','AC','AF'];
const UPPER_RIGHT_X=axisPositions(UPPER_RIGHT_COLUMNS,RIGHT_START,FACTORY_MAP_GEOMETRY.compactGap);
const UPPER_RIGHT_Y=new Map();
UPPER_RIGHT_Y.set(3,0);
UPPER_RIGHT_Y.set(13,UPPER_RIGHT_Y.get(3)+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.aisleGap);
UPPER_RIGHT_Y.set(23,UPPER_RIGHT_Y.get(13)+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.aisleGap);
UPPER_RIGHT_Y.set(32,UPPER_RIGHT_Y.get(23)+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.normalGap);
UPPER_RIGHT_Y.set(42,UPPER_RIGHT_Y.get(32)+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.normalGap);

const upperBottom=Math.max(
  LEFT_Y.get(32)+FACTORY_MAP_GEOMETRY.cardHeight,
  UPPER_RIGHT_Y.get(42)+FACTORY_MAP_GEOMETRY.cardHeight
);
const LOWER_START_Y=upperBottom+FACTORY_MAP_GEOMETRY.sectionGap;

// Torres inferiores: corredor padronizado entre 096/097 e 097/100.
const TOWER_COLUMNS=['N','U','AB'];
const TOWER_X=axisPositions(TOWER_COLUMNS,RIGHT_START,FACTORY_MAP_GEOMETRY.aisleGap);
const TOWER_ROWS=[52,55,58,61,64,67,70,73];
const TOWER_Y=rowPositions(TOWER_ROWS,LOWER_START_Y,FACTORY_MAP_GEOMETRY.compactGap);

// Linha 124..130 usa espaçamento compacto, mas existe corredor horizontal entre
// a linha da 121 e a linha da 124.
const LOWER_ROW_COLUMNS=['M','P','S','V','Y','AB','AE'];
const LOWER_ROW_X=axisPositions(LOWER_ROW_COLUMNS,RIGHT_START,FACTORY_MAP_GEOMETRY.compactGap);
const LOWER_ROW_Y=TOWER_Y.get(73)+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.aisleGap;

const SPECIAL_ROWS=[80,83,86,89,92,95,98,101];
const SPECIAL_Y=rowPositions(
  SPECIAL_ROWS,
  LOWER_ROW_Y+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.normalGap,
  FACTORY_MAP_GEOMETRY.compactGap
);

// Correções físicas confirmadas pelo usuário. A célula original continua sendo
// preservada em `cell`, enquanto estes anchors controlam somente a posição visual.
const PHYSICAL_OVERRIDES=new Map([
  [tnl(145),Object.freeze({ column:'P',row:86,reason:'TNL 145 ao lado da TNL 134' })],
  [tnl(140),Object.freeze({ column:'P',row:101,reason:'TNL 140 ao lado da TNL 139' })],
  ['milltap',Object.freeze({ column:'P',row:80,reason:'MILLTAP acima da TNL 145' })],
  ['discovery',Object.freeze({ column:'S',row:80,reason:'DISCOVERY ao lado da MILLTAP' })]
]);

function physicalX(column,row) {
  if(LEFT_X.has(column)&&LEFT_Y.has(row))return LEFT_X.get(column);
  if(UPPER_RIGHT_X.has(column)&&UPPER_RIGHT_Y.has(row))return UPPER_RIGHT_X.get(column);
  if(TOWER_X.has(column)&&TOWER_Y.has(row))return TOWER_X.get(column);
  if(row===76&&LOWER_ROW_X.has(column))return LOWER_ROW_X.get(column);
  if(SPECIAL_Y.has(row)&&LOWER_ROW_X.has(column))return LOWER_ROW_X.get(column);
  return (columnNumber(column)-2)*FACTORY_MAP_GEOMETRY.columnStep;
}

function physicalY(column,row) {
  if(LEFT_X.has(column)&&LEFT_Y.has(row))return LEFT_Y.get(row);
  if(UPPER_RIGHT_X.has(column)&&UPPER_RIGHT_Y.has(row))return UPPER_RIGHT_Y.get(row);
  if(TOWER_X.has(column)&&TOWER_Y.has(row))return TOWER_Y.get(row);
  if(row===76&&LOWER_ROW_X.has(column))return LOWER_ROW_Y;
  if(SPECIAL_Y.has(row)&&LOWER_ROW_X.has(column))return SPECIAL_Y.get(row);
  return (row-2)*FACTORY_MAP_GEOMETRY.rowStep;
}

function parsePlacement(token,provisional=false) {
  const [cell,machine]=token.split(':');
  const match=cell.match(/^([A-Z]+)(\d+)$/);
  if(!match)throw new Error(`Célula inválida no mapa: ${cell}`);
  const machineId=machineIdFromToken(machine);
  const sourceColumn=match[1];
  const sourceRow=Number(match[2]);
  const override=PHYSICAL_OVERRIDES.get(machineId) || null;
  const physicalColumn=override?.column || sourceColumn;
  const physicalRow=override?.row || sourceRow;
  return Object.freeze({
    machineId,
    cell,
    column:columnNumber(sourceColumn),
    row:sourceRow,
    physicalColumn,
    physicalRow,
    x:physicalX(physicalColumn,physicalRow),
    y:physicalY(physicalColumn,physicalRow),
    provisional,
    physicalOverride:Boolean(override),
    physicalOverrideReason:override?.reason || ''
  });
}

const placementTokens=(source,provisional)=>source.trim().split(/\s+/).filter(Boolean).map(token=>parsePlacement(token,provisional));
export const FACTORY_MAP_POSITIONS = Object.freeze([
  ...placementTokens(SPREADSHEET_PLACEMENTS,false),
  ...placementTokens(SUPPLEMENTAL_PLACEMENTS,false),
  ...placementTokens(PROVISIONAL_PLACEMENTS,true)
]);

const workcenterByMachine = new Map();
for (const [workcenter,machines] of Object.entries(WORKCENTER_GROUPS)) {
  for (const machine of machines) workcenterByMachine.set(tnl(machine),workcenter);
}

const placementByMachine = new Map();
for (const placement of FACTORY_MAP_POSITIONS) {
  if (placementByMachine.has(placement.machineId)) throw new Error(`Máquina repetida no mapa: ${placement.machineId}`);
  placementByMachine.set(placement.machineId,placement);
}

export function normalizeMapMachineId(value) {
  const raw=String(value || '').trim().toLowerCase();
  if (raw === 'milltap' || raw === 'discovery') return raw;
  const match=raw.match(/(?:tnl[-\s]*)?(\d{1,3})/);
  return match ? tnl(Number(match[1])) : raw;
}

export function mapMachineMetadata(machineId) {
  const id=normalizeMapMachineId(machineId);
  const placement=placementByMachine.get(id) || null;
  return {
    machineId:id,
    placement,
    workcenter:workcenterByMachine.get(id) || '',
    provisional:Boolean(placement?.provisional)
  };
}

export function factoryMapMachineIds() {
  return FACTORY_MAP_POSITIONS.map(placement=>placement.machineId);
}

export function factoryMapBounds(machineIds = factoryMapMachineIds()) {
  const positions=machineIds.map(normalizeMapMachineId).map(machineId=>placementByMachine.get(machineId)).filter(Boolean);
  if(!positions.length)return null;
  const minX=Math.min(...positions.map(position=>position.x));
  const minY=Math.min(...positions.map(position=>position.y));
  const maxX=Math.max(...positions.map(position=>position.x));
  const maxY=Math.max(...positions.map(position=>position.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    width:maxX-minX+FACTORY_MAP_GEOMETRY.cardWidth+FACTORY_MAP_GEOMETRY.padding*2,
    height:maxY-minY+FACTORY_MAP_GEOMETRY.cardHeight+FACTORY_MAP_GEOMETRY.padding*2
  };
}

export function factoryMapCoverage(machineIds = []) {
  const supplied=new Set(machineIds.map(normalizeMapMachineId));
  const mapped=factoryMapMachineIds();
  return {
    mapped:mapped.filter(machineId => supplied.has(machineId)),
    missingFromMap:[...supplied].filter(machineId => !placementByMachine.has(machineId)),
    unavailable:mapped.filter(machineId => !supplied.has(machineId))
  };
}
