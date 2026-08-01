'use strict';

async function fetchCloudJson(path) {
  if (!CLOUD_API_URL) return null;
  const response = await fetch(`${CLOUD_API_URL}${path}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function refreshCatalogInterface() {
  persistState();
  renderMachineTabs();
  renderContextSelectors();
  renderHistoryFilters(false);
  renderLatest();
  updateCalculations();
  if (state.activeView === 'history') renderHistory();
}

async function loadCloudCatalog() {
  const payload = await fetchCloudJson('/api/v1/catalog');
  const cloudCatalog = Array.isArray(payload?.lines)
    ? payload.lines.map(line => ({
        id: line.id,
        name: line.name,
        machines: Array.isArray(line.machines)
          ? line.machines.map(machine => ({
              id: machine.id,
              name: machine.name,
              equipmentType: machine.equipmentType || 'TNL'
            }))
          : []
      }))
    : [];

  if (!cloudCatalog.length) return;

  state.catalog = typeof mergeOfficialCatalog === 'function'
    ? mergeOfficialCatalog(state.catalog, cloudCatalog)
    : cloudCatalog;
  state.catalogSource = 'cloudflare-d1';
  refreshCatalogInterface();
}

function ensureOperatorDatalist() {
  let datalist = document.getElementById('operatorOptions');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'operatorOptions';
    document.body.appendChild(datalist);
  }
  el('f_operator').setAttribute('list', datalist.id);
  return datalist;
}

async function loadCloudOperators() {
  const payload = await fetchCloudJson('/api/v1/operators');
  const operators = Array.isArray(payload?.operators) ? payload.operators : [];
  const datalist = ensureOperatorDatalist();
  datalist.innerHTML = operators.map(operator =>
    `<option value="${escapeHtml(operator.name)}">${escapeHtml(operator.registration || '')}</option>`
  ).join('');
  state.operatorCatalog = operators;
  persistState();
  applyKnownOperator();
}

function applyKnownOperator() {
  const name = el('f_operator').value.trim().toLocaleLowerCase('pt-BR');
  if (!name) return;

  const operator = (state.operatorCatalog || []).find(item =>
    String(item.name || '').trim().toLocaleLowerCase('pt-BR') === name
  );
  if (!operator) return;

  if (el('f_registration') && operator.registration) {
    el('f_registration').value = operator.registration;
    state.operatorRegistration = operator.registration;
  }

  if (operator.defaultShift && ['1', '2', '3'].includes(String(operator.defaultShift))) {
    state.shift = String(operator.defaultShift);
    el('f_shift').value = state.shift;
    el('activeShiftBadge').textContent = `${state.shift}º turno`;
  }

  persistState();
}

async function lookupCloudItem() {
  if (!CLOUD_API_URL) return;
  const itemNumber = el('f_item').value.trim();
  if (!itemNumber) return;

  const machineId = currentSlot()?.machineId || '';
  const hint = el('hintItem');
  hint.textContent = 'Consultando item no banco...';
  hint.className = 'hint item-hint';

  try {
    const query = new URLSearchParams({ itemNumber });
    if (machineId) query.set('machineId', machineId);
    const payload = await fetchCloudJson(`/api/v1/items?${query.toString()}`);
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;

    if (!item) {
      hint.textContent = 'Item novo: os dados digitados serão aprendidos quando o registro for salvo.';
      hint.className = 'hint item-hint';
      return;
    }

    if (Number.isFinite(Number(item.cycleTimeSeconds)) && Number(item.cycleTimeSeconds) > 0) {
      el('f_tempo').value = fmtTimeFromSeconds(Number(item.cycleTimeSeconds));
    }
    if (Number.isFinite(Number(item.frequency1))) {
      el('f_freq1').value = String(item.frequency1).replace('.', ',');
    }
    if (Number.isFinite(Number(item.frequency2))) {
      el('f_freq2').value = String(item.frequency2).replace('.', ',');
    }
    if (el('f_item_description') && item.description) {
      el('f_item_description').value = item.description;
    }

    hint.textContent = item.parameterSource === 'machine'
      ? '✓ Parâmetros específicos desta máquina carregados do banco'
      : '✓ Parâmetros gerais do item carregados do banco';
    hint.className = 'hint item-hint found';
    updateCalculations();
    saveDraft();
  } catch (error) {
    console.error('Falha ao consultar item:', error);
    hint.textContent = 'Não foi possível consultar o item agora. O registro continuará salvo localmente.';
    hint.className = 'hint item-hint notfound';
  }
}

async function lookupCloudOrder() {
  if (!CLOUD_API_URL) return;
  const opNumber = el('f_op').value.trim();
  if (!opNumber) return;

  try {
    const payload = await fetchCloudJson(`/api/v1/orders?op=${encodeURIComponent(opNumber)}`);
    const order = payload?.order;
    if (!order) return;

    if (!el('f_item').value && order.item) el('f_item').value = order.item;
    if (!el('f_seq').value && order.sequence) el('f_seq').value = order.sequence;

    const slot = currentSlot();
    if (!slot.lineId && order.lineId && getLine(order.lineId)) {
      slot.lineId = order.lineId;
      slot.machineId = getMachine(order.lineId, order.machineId) ? order.machineId : '';
      refreshCatalogInterface();
    }

    saveDraft();
    if (el('f_item').value) await lookupCloudItem();
    showToast(`OP ${opNumber} encontrada no histórico`);
  } catch (error) {
    console.error('Falha ao consultar OP:', error);
  }
}

async function loadCloudMasterData() {
  if (!CLOUD_API_URL) return;
  try {
    await Promise.all([
      loadCloudCatalog(),
      loadCloudOperators()
    ]);
  } catch (error) {
    console.error('Falha ao carregar dados mestres:', error);
  }
}

el('f_operator').addEventListener('change', applyKnownOperator);
el('f_operator').addEventListener('blur', applyKnownOperator);

el('f_item').addEventListener('blur', lookupCloudItem);
el('f_item').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupCloudItem();
  }
});

el('f_op').addEventListener('blur', lookupCloudOrder);
el('f_op').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupCloudOrder();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadCloudMasterData();
});

loadCloudMasterData();
