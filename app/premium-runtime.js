import { brandHeader, brandMenuHeader, brandLogo } from './brand.js';

const app = document.getElementById('app');
const layers = document.getElementById('layers');

function enhanceBranding() {
  const brand = document.querySelector('.ops-brand');
  if (brand && brand.dataset.brandVersion !== 'official-neomes') {
    brand.dataset.brandVersion = 'official-neomes';
    brand.innerHTML = brandHeader({ subtitle: 'Registro operacional do turno' });
  }
}

function enhanceMenu() {
  const menu = document.querySelector('#menuLayer .ops-sheet__body');
  if (!menu || menu.dataset.brandVersion === 'official-neomes') return;
  menu.dataset.brandVersion = 'official-neomes';
  const header = document.createElement('div');
  header.className = 'ops-menu-brand';
  header.innerHTML = brandMenuHeader();
  menu.prepend(header);
}

function enhanceLogin() {
  const login = document.querySelector('#loginLayer .ops-sheet__body');
  if (!login || login.dataset.brandVersion === 'official-neomes') return;
  login.dataset.brandVersion = 'official-neomes';
  const header = document.createElement('div');
  header.className = 'ops-login-brand';
  header.innerHTML = `${brandLogo({ variant: 'horizontal', size: 'large', alt: 'NEOMES', priority: true })}<span>Acesse sua operação</span>`;
  login.prepend(header);
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
  enhanceLogin();
  enhanceMachineCards();
}

const observer = new MutationObserver(enhanceApp);
observer.observe(app, { childList: true, subtree: true });
observer.observe(layers, { childList: true, subtree: true });
enhanceApp();

document.documentElement.dataset.displayMode = window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser';

document.addEventListener('pointerup', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (navigator.vibrate && (button.matches('.ops-btn--primary,.ops-btn--danger') || button.dataset.action === 'close-shift')) {
    navigator.vibrate(button.matches('.ops-btn--danger') ? [14, 24, 14] : 8);
  }
});
