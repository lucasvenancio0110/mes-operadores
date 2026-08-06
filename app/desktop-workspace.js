const app = document.getElementById('app');
let arranging = false;

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

function arrangeDesktopWorkspace() {
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

const observer = new MutationObserver(() => {
  window.requestAnimationFrame(arrangeDesktopWorkspace);
});

if (app) {
  observer.observe(app,{ childList:true,subtree:true });
  arrangeDesktopWorkspace();
}
