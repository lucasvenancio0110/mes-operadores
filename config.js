const hostedOverHttp = ['http:', 'https:'].includes(window.location.protocol);
const isGitHubPages = window.location.hostname.endsWith('github.io');

window.APP_CONFIG = {
  // Na versão publicada pelo Cloudflare, site e API usam a mesma origem.
  // No GitHub Pages, o aplicativo continua disponível apenas no modo local/offline.
  cloudApiUrl: hostedOverHttp && !isGitHubPages ? window.location.origin : ''
};

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
    // O catálogo oficial já é carregado diretamente pelo index.html.
    // Estes módulos adicionam o aprendizado automático e a consulta ao D1.
    await loadApplicationScript('learning-ui.js?v=20260801-4');
    await loadApplicationScript('master-data.js?v=20260801-4');
  } catch (error) {
    console.error('Falha ao carregar módulos complementares:', error);
  }
});
