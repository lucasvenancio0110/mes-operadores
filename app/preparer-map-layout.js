const tnl = number => `tnl-${String(number).padStart(3,'0')}`;
const row = (...machines) => machines.map(machine => {
  if (!machine) return null;
  if (machine === 'milltap' || machine === 'discovery') return machine;
  return tnl(machine);
});

export const FACTORY_MAP_ZONES = [
  {
    id:'main-bank',
    title:'Bloco principal',
    description:'Linhas 1 a 5',
    columns:6,
    rows:[
      row(24,17,28,9,60,85),
      row(2,13,7,10,59,87),
      row(15,16,8,33,58,88),
      row(23,18,3,34,57,89),
      row(35,19,31,36,53,90),
      row(29,25,32,37,42,91),
      row(30,26,4,43,52,92),
      row(5,27,143,44,61,93),
      row(null,46,49,39,64,94),
      row(null,47,50,40,65,95),
      row(null,48,51,41,66,null)
    ]
  },
  {
    id:'front-bank',
    title:'Bloco frontal',
    description:'Linhas 5 e 6',
    columns:5,
    rows:[
      row(83,72,69,68,67),
      row(84,79,77,74,73),
      row(86,81,82,76,75)
    ]
  },
  {
    id:'line-seven-bank',
    title:'Bloco intermediário',
    description:'Linha 7',
    columns:7,
    rows:[
      row(111,103,110,62,45,55,54),
      row(70,102,80,63,78,71,56)
    ]
  },
  {
    id:'lines-eight-nine-bank',
    title:'Bloco inferior',
    description:'Linhas 8 e 9',
    columns:3,
    rows:[
      row(96,97,100),
      row(98,99,101),
      row(104,105,106),
      row(107,108,109),
      row(112,113,114),
      row(115,116,117),
      row(118,119,120),
      row(121,122,123)
    ]
  },
  {
    id:'line-ten-bank',
    title:'Bloco especial',
    description:'Linha 10 · posições provisórias sinalizadas',
    columns:7,
    rows:[
      row(124,125,126,127,128,129,130),
      row(null,null,null,'milltap','discovery',null,145),
      row(134,6,null,null,null,null,144),
      row(135,null,null,null,null,null,142),
      row(136,null,null,null,null,null,141),
      row(137,null,null,null,null,null,140),
      row(138,null,null,null,null,null,null),
      row(139,null,null,null,null,null,null)
    ]
  }
];

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

const provisionalMachines = new Set([tnl(6),tnl(144),tnl(145)]);
const workcenterByMachine = new Map();
for (const [workcenter,machines] of Object.entries(WORKCENTER_GROUPS)) {
  for (const machine of machines) workcenterByMachine.set(tnl(machine),workcenter);
}

const placementByMachine = new Map();
for (const zone of FACTORY_MAP_ZONES) {
  zone.rows.forEach((machines,rowIndex) => machines.forEach((machineId,columnIndex) => {
    if (!machineId) return;
    if (placementByMachine.has(machineId)) throw new Error(`Máquina repetida no mapa: ${machineId}`);
    placementByMachine.set(machineId,{
      zoneId:zone.id,
      zoneTitle:zone.title,
      row:rowIndex + 1,
      column:columnIndex + 1
    });
  }));
}

export function normalizeMapMachineId(value) {
  const raw=String(value || '').trim().toLowerCase();
  if (raw === 'milltap' || raw === 'discovery') return raw;
  const match=raw.match(/(?:tnl[-\s]*)?(\d{1,3})/);
  return match ? tnl(Number(match[1])) : raw;
}

export function mapMachineMetadata(machineId) {
  const id=normalizeMapMachineId(machineId);
  return {
    machineId:id,
    placement:placementByMachine.get(id) || null,
    workcenter:workcenterByMachine.get(id) || '',
    provisional:provisionalMachines.has(id)
  };
}

export function factoryMapMachineIds() {
  return [...placementByMachine.keys()];
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
