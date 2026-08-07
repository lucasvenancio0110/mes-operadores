const app = document.getElementById('app');
const desktopMedia = window.matchMedia('(min-width: 760px)');
let arranging = false;
let frame = 0;

function roleLabel(code) {
  return ({
    admin:'Administrador',
    leadership:'Liderança',
    preparator:'Preparador',
    operator:'Operador',
    technical:'Técnico'
  })[code] || 'Usuário';
}

function initials(name) {
  const parts = String(name || 'Usuário').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'US';
  return `${parts[0][0] || ''}${parts.length > 1 ? parts.at(-1)[0] || '' : parts[0][1] || ''}`.toUpperCase();
}

function desktopUserCard() {
  const user = window.NEOMES_AUTH?.user || {};
  const name = user.name || document.querySelector('.ops-session strong')?.textContent?.trim() || 'Usuário';
  const registration = user.registration || '';
  const shift = user.operationalContext?.shift || document.querySelector('.ops-shift')?.textContent?.replace(/\D/g,'') || '—';
  const machineText = document.querySelector('.ops-session button')?.textContent?.trim() || '0 máquinas';

  return `<section class="ops-desktop-user" aria-label="Sessão atual">
    <div class="ops-desktop-user__identity">
      <span class="ops-desktop-user__avatar" aria-hidden="true">${initials(name)}</span>
      <div><strong>${name}</strong><small>${registration ? `Matrícula ${registration} · ` : ''}${roleLabel(user.roleCode)} · ${shift}º turno</small></div>
    </div>
    <button type="button" data-action="assign-machines">${machineText}</button>
  </section>`;
}

function sidebarMarkup() {
  return `<aside class="ops-desktop-sidebar" aria-label="Navegação e sessão">
    <button class="ops-desktop-menu" type="button" data-action="menu">
      <span class="ops-desktop-menu__icon" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Abrir menu</span>
    </button>
    ${desktopUserCard()}
  </aside>`;
}

function restoreMobileWorkspace() {
  const shell = app?.querySelector('.ops-shell');
  const layout = shell?.querySelector(':scope > .ops-desktop-layout');
  if (!shell || !layout) return;
  const content = layout.querySelector('.ops-desktop-content');
  const page = content?.querySelector(':scope > .ops-page');
  const connection = content?.querySelector(':scope > .ops-connection');
  const nav = layout.querySelector('.ops-desktop-sidebar .ops-nav');
  if (connection) shell.insertBefore(connection, layout);
  if (page) shell.insertBefore(page, layout);
  if (nav) shell.appendChild(nav);
  layout.remove();
}

function arrangeDesktopWorkspace() {
  if (!desktopMedia.matches) {
    restoreMobileWorkspace();
    return;
  }
  if (arranging) return;
  const shell = app?.querySelector('.ops-shell');
  if (!shell || shell.querySelector(':scope > .ops-desktop-layout')) return;

  const page = shell.querySelector(':scope > .ops-page');
  const nav = shell.querySelector(':scope > .ops-nav');
  const connection = shell.querySelector(':scope > .ops-connection');
  const headerMenu = shell.querySelector('.ops-header .ops-icon-btn[data-action="menu"]');
  if (!page || !nav) return;

  arranging = true;
  try {
    headerMenu?.setAttribute('title','Abrir menu');
    headerMenu?.setAttribute('aria-label','Abrir menu');

    const layout = document.createElement('div');
    layout.className = 'ops-desktop-layout';
    layout.innerHTML = `${sidebarMarkup()}<div class="ops-desktop-content"></div>`;

    const sidebar = layout.querySelector('.ops-desktop-sidebar');
    const content = layout.querySelector('.ops-desktop-content');
    sidebar.appendChild(nav);
    if (connection) content.appendChild(connection);
    content.appendChild(page);
    shell.appendChild(layout);
  } finally {
    arranging = false;
  }
}

function scheduleArrange() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(arrangeDesktopWorkspace);
}

const observer = new MutationObserver(scheduleArrange);

if (app) {
  observer.observe(app,{ childList:true,subtree:true });
  desktopMedia.addEventListener?.('change',scheduleArrange);
  scheduleArrange();
}
