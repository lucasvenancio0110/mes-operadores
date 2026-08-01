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
}

async function lookupCloudItem() {
  if (!CLOUD_API_URL) return;
  const itemNumber = el('f_item').value.trim();
  if (!itemNumber) return;

  const hint = el('hintItem');
  hint.textContent = 'Consultando item no banco...';
  hint.className = 'hint item-hint';

  try {
    const payload = await fetchCloudJson(`/api/v1/items?itemNumber=${encodeURIComponent(itemNumber)}`);
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;

    if (!item) {
      hint.textContent = 'Item ainda não cadastrado no banco D1.';
      hint.className = 'hint item-hint notfound';
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

    hint.textContent = item.description
      ? `✓ ${item.description} · parâmetros carregados da nuvem`
      : '✓ Tempo e frequências carregados da nuvem';
    hint.className = 'hint item-hint found';
    updateCalculations();
    saveDraft();
  } catch (error) {
    console.error('Falha ao consultar item:', error);
    hint.textContent = 'Não foi possível consultar o item agora. Preencha manualmente.';
    hint.className = 'hint item-hint notfound';
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

el('f_item').addEventListener('blur', lookupCloudItem);
el('f_item').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    lookupCloudItem();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadCloudMasterData();
});

loadCloudMasterData();
