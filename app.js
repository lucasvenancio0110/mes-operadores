const STORAGE_KEY = 'registros-producao-3maquinas';
const MACHINE_IDS = ['m1','m2','m3','m4'];
let machines = {
  m1: { name: 'Máquina 1', entries: [] },
  m2: { name: 'Máquina 2', entries: [] },
  m3: { name: 'Máquina 3', entries: [] },
  m4: { name: 'Máquina 4', entries: [] },
};
let activeMachine = 'm1';
const FIELD_IDS = ['f_tnl','f_op','f_item','f_pecas','f_tempo','f_seq','f_final','f_freq1','f_freq2','f_minutos','f_obs'];
let itemsCatalog = {};
let drafts = {
  m1: {}, m2: {}, m3: {}, m4: {},
};

function parseTempo(v){
  if(v === null || v === undefined) return NaN;
  v = String(v).trim();
  if(v === '') return NaN;

  // formatos "5:55" ou "5m55s" / "5m55"
  let m = v.match(/^(\d+)\s*[:m]\s*(\d{1,2})\s*s?$/i);
  if(m){
    const min = parseInt(m[1], 10);
    const seg = parseInt(m[2], 10);
    return min + (seg / 60);
  }

  // só segundos, ex: "55s"
  m = v.match(/^(\d+)\s*s$/i);
  if(m) return parseInt(m[1], 10) / 60;

  // fallback: número decimal direto (com vírgula ou ponto)
  const n = parseFloat(v.replace(',', '.'));
  return isNaN(n) ? NaN : n;
}

function toNum(v){
  if(v === null || v === undefined) return NaN;
  v = String(v).trim().replace(',', '.');
  if(v === '') return NaN;
  const n = parseFloat(v);
  return isNaN(n) ? NaN : n;
}

function fmtTime(decimalMin){
  if(isNaN(decimalMin) || decimalMin <= 0) return '0:00';
  const totalSeconds = Math.round(decimalMin * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ':' + String(s).padStart(2,'0');
}

function fmtNum(n, decimals){
  if(isNaN(n)) return '–';
  return n.toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits: decimals===undefined?2:decimals});
}

function getFields(){
  return {
    tnl: document.getElementById('f_tnl').value.trim(),
    op: document.getElementById('f_op').value.trim(),
    item: document.getElementById('f_item').value.trim(),
    pecas: toNum(document.getElementById('f_pecas').value),
    tempo: parseTempo(document.getElementById('f_tempo').value),
    seq: document.getElementById('f_seq').value.trim(),
    final: toNum(document.getElementById('f_final').value),
    freq1: toNum(document.getElementById('f_freq1').value),
    freq2: toNum(document.getElementById('f_freq2').value),
    minutos: toNum(document.getElementById('f_minutos').value),
    obs: document.getElementById('f_obs').value.trim(),
  };
}

function saveDraft(){
  const d = {};
  FIELD_IDS.forEach(id => { d[id] = document.getElementById(id).value; });
  drafts[activeMachine] = d;
}

function loadDraftIntoForm(){
  const d = drafts[activeMachine] || {};
  FIELD_IDS.forEach(id => { document.getElementById(id).value = d[id] || ''; });
}

function compute(f){
  const base = (!isNaN(f.minutos) && f.minutos > 0) ? f.minutos : 480;
  const meta = f.tempo > 0 ? base / f.tempo : NaN;
  const esperada = (!isNaN(f.pecas) && !isNaN(meta)) ? f.pecas + meta : NaN;
  const lib1 = (!isNaN(esperada) && f.freq1 > 0) ? esperada / f.freq1 : NaN;
  const lib2 = (!isNaN(esperada) && f.freq2 > 0) ? esperada / f.freq2 : NaN;
  const saldo = (!isNaN(f.final) && !isNaN(meta)) ? f.final - meta : NaN;
  const tempomin = (!isNaN(saldo) && !isNaN(f.tempo)) ? saldo * f.tempo : NaN;
  return { meta, esperada, lib1, lib2, saldo, tempomin, base };
}

function isToday(timestamp){
  const d = new Date(timestamp);
  const now = new Date();
  return d.getDate()===now.getDate() && d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
}

function minutosUsadosHoje(machineId){
  return machines[machineId].entries
    .filter(e => isToday(e.id))
    .reduce((sum, e) => sum + (e.base || 480), 0);
}

function updateReadoutAndCalc(){
  const f = getFields();
  document.getElementById('readoutTime').textContent = fmtTime(f.tempo);
  document.getElementById('readoutDecimal').textContent = isNaN(f.tempo) ? '0' : fmtNum(f.tempo, 2);

  const c = compute(f);
  document.getElementById('c_meta').textContent = fmtNum(c.meta, 1);
  document.getElementById('c_esperada').textContent = fmtNum(c.esperada, 1);
  document.getElementById('c_lib1').textContent = fmtNum(c.lib1, 2);
  document.getElementById('c_lib2').textContent = fmtNum(c.lib2, 2);

  const saldoEl = document.getElementById('c_saldo');
  saldoEl.textContent = fmtNum(c.saldo, 1);
  saldoEl.className = 'v' + (c.saldo > 0 ? ' pos' : c.saldo < 0 ? ' neg' : '');

  document.getElementById('c_tempomin').textContent = fmtNum(c.tempomin, 1);

  const usados = minutosUsadosHoje(activeMachine);
  const restante = Math.max(480 - usados, 0);
  document.getElementById('hintRestante').innerHTML =
    `Já usados hoje nesta máquina: <b>${usados} min</b> · Restam: <b>${restante} min</b> de 480`;
}

FIELD_IDS.forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=>{
    updateReadoutAndCalc();
    saveDraft();
  });
});

document.getElementById('f_item').addEventListener('blur', lookupItem);
document.getElementById('f_item').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); lookupItem(); }
});

function renderTabs(){
  const bar = document.getElementById('tabBar');
  bar.innerHTML = MACHINE_IDS.map(id=>{
    const m = machines[id];
    const cls = id === activeMachine ? 'tab active' : 'tab';
    return `<div class="${cls}" data-id="${id}">
      <div class="tab-name">${m.name}</div>
      <div class="tab-count">${m.entries.length} registro${m.entries.length===1?'':'s'}</div>
    </div>`;
  }).join('');
  bar.querySelectorAll('.tab').forEach(el=>{
    el.addEventListener('click', ()=> switchMachine(el.dataset.id));
  });
  document.getElementById('f_machinename').value = machines[activeMachine].name;
}

function switchMachine(id){
  saveDraft();
  activeMachine = id;
  renderTabs();
  loadDraftIntoForm();
  updateReadoutAndCalc();
  renderLog();
}

function renderLog(){
  const list = document.getElementById('logList');
  const entries = machines[activeMachine].entries;
  document.getElementById('logCount').textContent = entries.length;
  document.getElementById('btnClear').style.display = entries.length ? 'block' : 'none';

  if(entries.length === 0){
    list.innerHTML = '<div class="empty">Nenhum registro ainda nesta máquina.<br>Preencha o formulário acima e salve.</div>';
    return;
  }

  list.innerHTML = entries.slice().reverse().map(e=>{
    const cls = e.saldo > 0 ? 'pos' : e.saldo < 0 ? 'neg' : '';
    return `
      <div class="entry ${cls}">
        <div class="entry-top">
          <span class="entry-tag">${e.item ? 'Item ' + e.item + ' · ' : ''}TNL ${e.tnl || '–'} · OP ${e.op || '–'}</span>
          <button class="del" data-id="${e.id}">✕</button>
        </div>
        <div class="entry-grid">
          <div>Tempo<span>${fmtTime(e.tempo)}</span></div>
          <div>Peças<span>${e.pecas ?? '–'}</span></div>
          <div>Meta<span>${fmtNum(e.meta,1)}</span></div>
          <div>Prod. final<span>${e.final ?? '–'}</span></div>
          <div>Saldo<span>${fmtNum(e.saldo,1)}</span></div>
          <div>Min. turno<span>${e.base || 480}</span></div>
        </div>
        ${e.obs ? `<div class="entry-obs"><b>Obs.:</b> ${e.obs}</div>` : ''}
      </div>`;
  }).join('');

  list.querySelectorAll('.del').forEach(btn=>{
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
  });
}

// ======= CONEXÃO COM A NUVEM (Google Sheets via Apps Script) =======
// Depois de publicar seu Apps Script (veja instruções), cole a URL aqui embaixo:
const SHEETS_API_URL = 'COLE_AQUI_A_URL_DO_SEU_APPS_SCRIPT';

function nuvemConfigurada(){
  return SHEETS_API_URL && !SHEETS_API_URL.includes('COLE_AQUI');
}

async function cloudGet(key){
  const res = await fetch(`${SHEETS_API_URL}?key=${encodeURIComponent(key)}`);
  const text = await res.text();
  if(text === 'null' || text === '') return null;
  return { value: text };
}

async function cloudSet(key, value){
  await fetch(SHEETS_API_URL, {
    method: 'POST',
    body: JSON.stringify({ key, value }),
  });
}

function setCloudStatus(state){
  const el = document.getElementById('cloudStatus');
  if(!el) return;
  if(state === 'ok'){
    el.textContent = '☁️ Conectado — os registros são salvos na nuvem';
    el.className = 'cloud-status ok';
  } else if(state === 'off'){
    el.textContent = '⚠️ Nuvem não configurada — registros existem só nesta sessão (somem ao fechar o navegador)';
    el.className = 'cloud-status off';
  } else {
    el.textContent = '🔴 Não foi possível conectar à nuvem — verifique a URL do Apps Script';
    el.className = 'cloud-status err';
  }
}

async function loadItemsCatalog(){
  if(!nuvemConfigurada()) return;
  try{
    const res = await fetch(`${SHEETS_API_URL}?action=itens`);
    const arr = await res.json();
    itemsCatalog = {};
    arr.forEach(it => { itemsCatalog[String(it.item).trim()] = it; });
  }catch(e){
    console.error('Falha ao carregar catálogo de itens', e);
  }
}

function lookupItem(){
  const raw = document.getElementById('f_item').value.trim();
  const hint = document.getElementById('hintItem');
  if(!raw){ hint.textContent = ''; hint.className = 'hint'; return; }

  const found = itemsCatalog[raw];
  if(found){
    if(found.tempo) document.getElementById('f_tempo').value = found.tempo;
    if(found.freq1) document.getElementById('f_freq1').value = found.freq1;
    if(found.freq2) document.getElementById('f_freq2').value = found.freq2;
    hint.textContent = '✓ Item encontrado — tempo e frequência preenchidos';
    hint.className = 'hint found';
    updateReadoutAndCalc();
    saveDraft();
  }else{
    hint.textContent = nuvemConfigurada()
      ? '✗ Item não cadastrado — preencha tempo e frequência manualmente'
      : '';
    hint.className = 'hint notfound';
  }
}

async function loadEntries(){
  if(!nuvemConfigurada()){
    setCloudStatus('off');
    renderTabs();
    renderLog();
    return;
  }
  try{
    const res = await cloudGet(STORAGE_KEY);
    if(res){
      const saved = JSON.parse(res.value);
      MACHINE_IDS.forEach(id=>{
        if(saved[id]){
          machines[id].name = saved[id].name || machines[id].name;
          machines[id].entries = saved[id].entries || [];
        }
      });
    }
    setCloudStatus('ok');
  }catch(e){
    setCloudStatus('err');
  }
  renderTabs();
  renderLog();
}

async function saveEntries(){
  if(!nuvemConfigurada()) return;
  try{
    await cloudSet(STORAGE_KEY, JSON.stringify(machines));
    setCloudStatus('ok');
  }catch(e){
    console.error('Falha ao salvar', e);
    setCloudStatus('err');
  }
}

async function deleteEntry(id){
  const m = machines[activeMachine];
  m.entries = m.entries.filter(e => String(e.id) !== String(id));
  renderTabs();
  renderLog();
  await saveEntries();
}

document.getElementById('f_machinename').addEventListener('input', async (e)=>{
  machines[activeMachine].name = e.target.value.trim() || machines[activeMachine].name;
  renderTabs();
  document.getElementById('f_machinename').value = e.target.value;
  document.getElementById('f_machinename').focus();
  await saveEntries();
});

document.getElementById('btnSave').addEventListener('click', async ()=>{
  const f = getFields();
  const c = compute(f);
  const entry = {
    id: Date.now(),
    tnl: f.tnl, op: f.op, item: f.item, seq: f.seq,
    pecas: isNaN(f.pecas) ? null : f.pecas,
    tempo: f.tempo,
    final: isNaN(f.final) ? null : f.final,
    freq1: f.freq1, freq2: f.freq2,
    meta: c.meta, esperada: c.esperada,
    lib1: c.lib1, lib2: c.lib2,
    saldo: c.saldo, tempomin: c.tempomin,
    base: c.base,
    obs: f.obs,
  };
  machines[activeMachine].entries.push(entry);
  renderTabs();
  renderLog();
  await saveEntries();

  FIELD_IDS.forEach(id=>{ document.getElementById(id).value = ''; });
  drafts[activeMachine] = {};
  updateReadoutAndCalc();
});

document.getElementById('btnTrocarOp').addEventListener('click', ()=>{
  const usados = minutosUsadosHoje(activeMachine);
  const restante = Math.max(480 - usados, 0);
  document.getElementById('f_tnl').value = '';
  document.getElementById('f_op').value = '';
  document.getElementById('f_pecas').value = '';
  document.getElementById('f_final').value = '';
  document.getElementById('f_obs').value = '';
  document.getElementById('f_minutos').value = restante;
  // Número do item, tempo e frequência ficam como estavam — só mude se for item diferente
  saveDraft();
  updateReadoutAndCalc();
  document.getElementById('f_op').focus();
});

document.getElementById('btnClear').addEventListener('click', async ()=>{
  if(confirm('Apagar todos os registros salvos desta máquina?')){
    machines[activeMachine].entries = [];
    renderTabs();
    renderLog();
    await saveEntries();
  }
});

renderTabs();
updateReadoutAndCalc();
loadEntries();
loadItemsCatalog();
