import {
  store,
  getMachine,
  currentMachineSession,
  calculateSession,
  formatNumber,
  formatCycle,
  formatDate,
  formatClock,
  localDateKey
} from './core.js';
import { statusMeta } from './components.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function machineRows() {
  return store.state.assignments.map(assignment => {
    const machine = getMachine(assignment.machineId);
    const session = currentMachineSession(assignment.machineId);
    const calc = calculateSession(session);
    return {
      machine:machine?.name || assignment.machineId,
      line:machine?.lineName || '',
      status:statusMeta(session?.status || 'pending').label,
      op:session?.op || '—',
      item:session?.item || '—',
      produced:Number(session?.producedThisShift || 0),
      target:calc.target,
      cycle:formatCycle(session?.cycleSeconds),
      updated:session?.updatedAt || session?.checkedAt || null
    };
  });
}

function summaryText() {
  const session = store.state.session;
  const lines = [
    `NEODENT MES — ${formatDate()}`,
    `${session?.name || 'Operador'} · ${session?.shift || '—'}º turno`,
    ''
  ];
  for (const row of machineRows()) {
    lines.push(`${row.machine} · ${row.status}`);
    lines.push(`OP ${row.op} · Item ${row.item} · Produção ${formatNumber(row.produced)}/${formatNumber(row.target,1)} · Ciclo ${row.cycle}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function reportHtml() {
  const session = store.state.session;
  const rows = machineRows();
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>NEODENT MES — ${localDateKey()}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#111827;font:12px/1.45 Arial,sans-serif}header{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;border-bottom:2px solid #b92d7e}h1{margin:0;font-size:22px;letter-spacing:.04em}header p{margin:4px 0 0;color:#64748b}.meta{text-align:right}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.summary div,.machine{border:1px solid #d8dee9;border-radius:8px;padding:10px}.summary span,.metric span{display:block;color:#64748b;font-size:9px;text-transform:uppercase}.summary strong,.metric strong{display:block;margin-top:3px;font-size:14px}.machines{display:grid;gap:10px}.machine-head{display:flex;justify-content:space-between;gap:12px}.machine h2{margin:0;font-size:16px}.status{font-weight:700;color:#b92d7e}.machine p{margin:3px 0 10px;color:#64748b}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.footer{margin-top:18px;color:#64748b;font-size:9px;text-align:center}@media print{button{display:none}}</style></head><body>
    <header><div><h1>NEODENT MES</h1><p>Resumo operacional do turno</p></div><div class="meta"><strong>${escapeHtml(formatDate())}</strong><p>${escapeHtml(session?.name || '')} · ${escapeHtml(session?.shift || '—')}º turno</p></div></header>
    <section class="summary"><div><span>Máquinas</span><strong>${rows.length}</strong></div><div><span>Produzindo</span><strong>${rows.filter(row => row.status === 'Produzindo').length}</strong></div><div><span>Atenção</span><strong>${rows.filter(row => row.status !== 'Produzindo').length}</strong></div></section>
    <section class="machines">${rows.map(row => `<article class="machine"><div class="machine-head"><h2>${escapeHtml(row.machine)}</h2><span class="status">${escapeHtml(row.status)}</span></div><p>${escapeHtml(row.line)} · OP ${escapeHtml(row.op)} · Item ${escapeHtml(row.item)}</p><div class="metrics"><div class="metric"><span>Produção</span><strong>${formatNumber(row.produced)}</strong></div><div class="metric"><span>Meta</span><strong>${formatNumber(row.target,1)}</strong></div><div class="metric"><span>Ciclo</span><strong>${escapeHtml(row.cycle)}</strong></div><div class="metric"><span>Atualização</span><strong>${row.updated ? escapeHtml(formatClock(row.updated)) : '—'}</strong></div></div></article>`).join('')}</section>
    <div class="footer">Gerado pelo NEODENT Manufacturing Execution System</div>
  </body></html>`;
}

function exportPdf() {
  const printWindow = window.open('','_blank','noopener,noreferrer');
  if (!printWindow) {
    alert('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(reportHtml());
  printWindow.document.close();
  printWindow.addEventListener('load',() => setTimeout(() => printWindow.print(),180),{once:true});
}

function svgReport() {
  const session = store.state.session;
  const rows = machineRows();
  const width = 1080;
  const rowHeight = 150;
  const height = 260 + rows.length * rowHeight + 70;
  const cards = rows.map((row,index) => {
    const y = 220 + index * rowHeight;
    return `<rect x="60" y="${y}" width="960" height="126" rx="18" fill="#151d2b" stroke="#303b4d"/>
      <text x="88" y="${y + 38}" fill="#f5f7fb" font-size="28" font-weight="700" font-family="Arial">${escapeXml(row.machine)}</text>
      <text x="992" y="${y + 38}" text-anchor="end" fill="#ef69b3" font-size="20" font-weight="700" font-family="Arial">${escapeXml(row.status)}</text>
      <text x="88" y="${y + 70}" fill="#a7b0bf" font-size="18" font-family="Arial">${escapeXml(row.line)} · OP ${escapeXml(row.op)} · Item ${escapeXml(row.item)}</text>
      <text x="88" y="${y + 104}" fill="#f5f7fb" font-size="20" font-family="Arial">Produção ${escapeXml(formatNumber(row.produced))} / Meta ${escapeXml(formatNumber(row.target,1))}</text>
      <text x="992" y="${y + 104}" text-anchor="end" fill="#a7b0bf" font-size="18" font-family="Arial">Ciclo ${escapeXml(row.cycle)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#090d17"/>
    <rect x="60" y="54" width="78" height="78" rx="20" fill="#2a1730" stroke="#b92d7e"/>
    <text x="99" y="104" text-anchor="middle" fill="#ef69b3" font-size="24" font-weight="700" font-family="Arial">NM</text>
    <text x="166" y="88" fill="#f5f7fb" font-size="38" font-weight="800" font-family="Arial">NEODENT MES</text>
    <text x="166" y="121" fill="#a7b0bf" font-size="19" font-family="Arial">Resumo operacional do turno</text>
    <text x="1020" y="84" text-anchor="end" fill="#f5f7fb" font-size="22" font-family="Arial">${escapeXml(formatDate())}</text>
    <text x="1020" y="118" text-anchor="end" fill="#a7b0bf" font-size="18" font-family="Arial">${escapeXml(session?.name || '')} · ${escapeXml(session?.shift || '—')}º turno</text>
    <line x1="60" y1="162" x2="1020" y2="162" stroke="#303b4d"/>
    ${cards}
    <text x="540" y="${height - 30}" text-anchor="middle" fill="#758094" font-size="16" font-family="Arial">Gerado pelo NEODENT Manufacturing Execution System</text>
  </svg>`;
}

function downloadBlob(blob,name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function exportImage() {
  const svg = svgReport();
  const svgBlob = new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob => {
      if (blob) downloadBlob(blob,`neodent-mes-${localDateKey()}.png`);
      else downloadBlob(svgBlob,`neodent-mes-${localDateKey()}.svg`);
    },'image/png',.94);
  };
  image.onerror = () => { URL.revokeObjectURL(url); downloadBlob(svgBlob,`neodent-mes-${localDateKey()}.svg`); };
  image.src = url;
}

async function shareSummary() {
  const text = summaryText();
  if (navigator.share) {
    try { await navigator.share({ title:'NEODENT MES — Resumo do turno',text }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  await navigator.clipboard?.writeText(text);
}

function injectActions() {
  const csv = document.querySelector('[data-action="export-csv"]');
  const list = csv?.closest('.action-list');
  if (!list || list.querySelector('[data-export-enhanced]')) return;
  const marker = document.createElement('span');
  marker.hidden = true;
  marker.dataset.exportEnhanced = 'true';
  list.appendChild(marker);
  const items = [
    ['share-summary','Compartilhar resumo','WhatsApp ou menu de compartilhamento','↗'],
    ['export-pdf','Exportar PDF','Abre a impressão para salvar em PDF','PDF'],
    ['export-image','Exportar imagem','Gera um resumo em PNG','IMG']
  ];
  for (const [action,title,detail,symbol] of items) {
    const button = document.createElement('button');
    button.className = 'action-row';
    button.type = 'button';
    button.dataset.exportAction = action;
    button.innerHTML = `<div><strong>${title}</strong><span>${detail}</span></div><span>${symbol}</span>`;
    csv.insertAdjacentElement('afterend',button);
  }
}

new MutationObserver(injectActions).observe(document.getElementById('app'),{childList:true,subtree:true});
injectActions();

document.addEventListener('click',event => {
  const action = event.target.closest('[data-export-action]')?.dataset.exportAction;
  if (action === 'share-summary') shareSummary();
  if (action === 'export-pdf') exportPdf();
  if (action === 'export-image') exportImage();
});
