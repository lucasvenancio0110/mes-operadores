const app = document.getElementById('app');

function enhanceBranding() {
  const brand = document.querySelector('.ops-brand');
  if (brand && !brand.dataset.premiumReady) {
    brand.dataset.premiumReady = 'true';
    const mark = brand.querySelector('.ops-brand__mark');
    const title = brand.querySelector('strong');
    const subtitle = brand.querySelector('span');
    if (mark) {
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', 'Símbolo NEODENT MES');
      mark.textContent = '';
    }
    if (title) title.textContent = 'NEODENT MES';
    if (subtitle) subtitle.textContent = 'NeoMES · operação industrial';
  }

  const header = document.querySelector('.ops-header');
  if (header && !header.querySelector('.ops-manual-label')) {
    const label = document.createElement('span');
    label.className = 'ops-manual-label';
    label.textContent = 'Apontamento manual';
    label.title = 'A produção é informada manualmente no fechamento do turno';
    header.querySelector('.ops-brand')?.appendChild(label);
  }
}

function enhanceMenu() {
  const menu = document.querySelector('#menuLayer .ops-sheet__body');
  if (!menu || menu.dataset.premiumReady) return;
  menu.dataset.premiumReady = 'true';
  const header = document.createElement('div');
  header.className = 'ops-menu-brand';
  header.innerHTML = '<img src="icons/neomes-mark.svg" alt=""><div><strong>NEODENT MES</strong><span>NeoMES · central operacional</span></div>';
  menu.prepend(header);
}

function enhanceMachineCards() {
  document.querySelectorAll('.ops-machine-card').forEach((card, index) => {
    card.style.setProperty('--card-index', String(index));
    card.dataset.premiumReady = 'true';
  });
}

function enhanceApp() {
  enhanceBranding();
  enhanceMenu();
  enhanceMachineCards();
}

const observer = new MutationObserver(enhanceApp);
observer.observe(app, { childList: true, subtree: true });
observer.observe(document.getElementById('layers'), { childList: true, subtree: true });
enhanceApp();

document.documentElement.dataset.displayMode = window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser';

document.addEventListener('pointerup', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (navigator.vibrate && (button.matches('.ops-btn--primary,.ops-btn--danger') || button.dataset.action === 'close-shift')) {
    navigator.vibrate(button.matches('.ops-btn--danger') ? [14, 24, 14] : 8);
  }
});
