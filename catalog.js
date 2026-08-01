'use strict';

const OFFICIAL_CATALOG_VERSION = 1;

const OFFICIAL_PRODUCTION_CATALOG = [
  {
    id: 'linha-01',
    name: 'Linha 1',
    machines: ['002','005','015','019','023','024','025','026','027','029','030','035','046','047','048']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-02',
    name: 'Linha 2',
    machines: ['003','004','007','008','013','016','017','018','028','031','032','049','050','051','143']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-03',
    name: 'Linha 3',
    machines: ['009','010','033','034','036','037','039','040','041','043','044']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-04',
    name: 'Linha 4',
    machines: ['042','052','053','057','058','059','060','061','064','065','066']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-05',
    name: 'Linha 5',
    machines: ['069','072','083','085','087','088','089','090','091','092','093','094','095']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-06',
    name: 'Linha 6',
    machines: ['067','068','073','074','075','076','077','079','081','082','084','086']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-07',
    name: 'Linha 7',
    machines: ['045','054','055','056','062','063','070','071','078','080','102','103','110','111']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-08',
    name: 'Linha 8',
    machines: ['096','098','104','107','112','113','115','116','118','119','121','122']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-09',
    name: 'Linha 9',
    machines: ['097','099','100','101','105','106','108','109','114','117','120','123']
      .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` }))
  },
  {
    id: 'linha-10',
    name: 'Linha 10',
    machines: [
      ...['006','124','125','126','127','128','129','130','134','135','136','137','138','139','140','141','142','144','145']
        .map(number => ({ id: `tnl-${number}`, name: `TNL ${number}` })),
      { id: 'milltap', name: 'MILLTAP' },
      { id: 'discovery', name: 'DISCOVERY' }
    ]
  }
];

function mergeOfficialCatalog(existingCatalog, officialCatalog) {
  const merged = new Map();

  officialCatalog.forEach(line => {
    merged.set(line.id, {
      id: line.id,
      name: line.name,
      machines: line.machines.map(machine => ({ ...machine }))
    });
  });

  (existingCatalog || []).forEach(existingLine => {
    if (!existingLine?.id) return;

    if (!merged.has(existingLine.id)) {
      merged.set(existingLine.id, {
        id: existingLine.id,
        name: existingLine.name || existingLine.id,
        machines: Array.isArray(existingLine.machines)
          ? existingLine.machines.map(machine => ({ ...machine }))
          : []
      });
      return;
    }

    const officialLine = merged.get(existingLine.id);
    const machineMap = new Map(officialLine.machines.map(machine => [machine.id, machine]));

    (existingLine.machines || []).forEach(machine => {
      if (machine?.id && !machineMap.has(machine.id)) {
        machineMap.set(machine.id, { ...machine });
      }
    });

    officialLine.machines = [...machineMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { numeric: true })
    );
  });

  return [...merged.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { numeric: true })
  );
}

function applyOfficialCatalogMigration() {
  if (typeof state === 'undefined') return;

  state.catalog = mergeOfficialCatalog(state.catalog, OFFICIAL_PRODUCTION_CATALOG);
  state.catalogVersion = OFFICIAL_CATALOG_VERSION;
  persistState();

  renderMachineTabs();
  renderContextSelectors();
  renderHistoryFilters(false);
  renderLatest();
  updateCalculations();

  if (state.activeView === 'history') renderHistory();
}

applyOfficialCatalogMigration();
