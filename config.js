const hostedOverHttp = ['http:', 'https:'].includes(window.location.protocol);
const isGitHubPages = window.location.hostname.endsWith('github.io');

window.APP_CONFIG = {
  // Na versão publicada pelo Cloudflare, site e API usam a mesma origem.
  // No GitHub Pages, o aplicativo continua disponível apenas no modo local/offline.
  cloudApiUrl: hostedOverHttp && !isGitHubPages ? window.location.origin : ''
};

// Evita que a interface apareça antes da identidade visual e da animação de entrada.
document.documentElement.classList.add('brand-loading');
const criticalBrandStyle = document.createElement('style');
criticalBrandStyle.textContent = 'html.brand-loading .app-shell,html.brand-loading .bottom-nav{opacity:0!important}';
document.head.appendChild(criticalBrandStyle);

const brandingStyles = document.createElement('link');
brandingStyles.rel = 'stylesheet';
brandingStyles.href = 'branding.css?v=20260802-2';
document.head.appendChild(brandingStyles);

function loadApplicationScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadApplicationScript('branding.js?v=20260802-2');
    // O catálogo oficial já é carregado diretamente pelo index.html.
    // Estes módulos adicionam o aprendizado automático e a consulta ao D1.
    await loadApplicationScript('learning-ui.js?v=20260801-4');
    await loadApplicationScript('master-data.js?v=20260801-4');
  } catch (error) {
    console.error('Falha ao carregar módulos complementares:', error);
    document.documentElement.classList.remove('brand-loading');
    document.documentElement.classList.add('brand-ready');
  }

  // Proteção para nunca deixar a aplicação escondida caso algum recurso demore.
  window.setTimeout(() => {
    document.documentElement.classList.remove('brand-loading');
    document.documentElement.classList.add('brand-ready');
  }, 3000);
});
