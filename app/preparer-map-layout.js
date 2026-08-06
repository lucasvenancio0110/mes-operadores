const tnl = number => `tnl-${String(number).padStart(3,'0')}`;

// Âncoras extraídas da aba LAYOUT da planilha da fábrica. Os espaços entre
// células são parte do mapa: representam corredores, recuos e grupos físicos.
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

// A planilha ainda não fixa estas posições. Elas permanecem separadas da
// geometria homologada para serem fáceis de corrigir após a validação no chão.
const PROVISIONAL_PLACEMENTS = `S80:145 S83:144 V89:6`;
const SUPPLEMENTAL_PLACEMENTS = `AB86:discovery`;

export const FACTORY_MAP_GEOMETRY = Object.freeze({
  cardWidth:142,
  cardHeight:78,
  columnStep:74,
  rowStep:28,
  padding:24
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

function parsePlacement(token,provisional=false) {
  const [cell,machine]=token.split(':');
  const match=cell.match(/^([A-Z]+)(\d+)$/);
  if(!match)throw new Error(`Célula inválida no mapa: ${cell}`);
  const column=columnNumber(match[1]);
  const row=Number(match[2]);
  return Object.freeze({
    machineId:machineIdFromToken(machine),
    cell,
    column,
    row,
    x:(column-2)*FACTORY_MAP_GEOMETRY.columnStep,
    y:(row-2)*FACTORY_MAP_GEOMETRY.rowStep,
    provisional
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
