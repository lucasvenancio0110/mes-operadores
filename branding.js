(() => {
  const BRAND_NAME = 'NEODENT';
  const BRAND_SUBTITLE = 'Manufacturing Execution System';
  const MIN_SPLASH_MS = 850;
  const startedAt = performance.now();

  document.title = `${BRAND_NAME} MES`;

  function wordmarkMarkup(context = 'header') {
    return `
      <div class="${context}-wordmark" aria-label="${BRAND_NAME} ${BRAND_SUBTITLE}">
        <span class="${context}-brand-name">${BRAND_NAME}</span>
        <span class="${context}-brand-subtitle">${BRAND_SUBTITLE}</span>
      </div>`;
  }

  function buildHeader() {
    const header = document.querySelector('.app-header');
    const cloudStatus = document.getElementById('cloudStatus');
    if (!header || !cloudStatus) return;

    const brand = document.createElement('div');
    brand.className = 'brand-header';
    brand.innerHTML = `
      ${wordmarkMarkup('header')}
      <span class="brand-mes-badge" aria-hidden="true">MES</span>`;

    header.innerHTML = '';
    header.appendChild(brand);
    header.appendChild(cloudStatus);
  }

  function buildSplash() {
    const splash = document.createElement('div');
    splash.className = 'app-splash';
    splash.setAttribute('role', 'status');
    splash.setAttribute('aria-label', 'Abrindo NEODENT Manufacturing Execution System');
    splash.innerHTML = `
      <div class="splash-content">
        ${wordmarkMarkup('splash')}
        <div class="splash-rule" aria-hidden="true"></div>
        <span class="splash-caption">Painel de Produção</span>
      </div>
      <div class="splash-loader" aria-hidden="true"><span></span></div>`;

    document.body.prepend(splash);
    return splash;
  }

  function finishSplash(splash) {
    if (!splash || splash.classList.contains('is-hiding')) return;
    splash.classList.add('is-hiding');
    document.documentElement.classList.remove('brand-loading');
    document.documentElement.classList.add('brand-ready');
    window.setTimeout(() => splash.remove(), 520);
  }

  buildHeader();
  const splash = buildSplash();

  const ready = document.fonts?.ready || Promise.resolve();
  ready.finally(() => {
    const remaining = Math.max(0, MIN_SPLASH_MS - (performance.now() - startedAt));
    window.setTimeout(() => finishSplash(splash), remaining);
  });

  splash.addEventListener('click', () => finishSplash(splash));
  window.setTimeout(() => finishSplash(splash), 2200);
})();
