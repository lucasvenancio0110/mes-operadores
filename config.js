const cloudflareHost = ['workers.dev', 'pages.dev']
  .some(suffix => window.location.hostname.endsWith(suffix));

window.APP_CONFIG = {
  // No endereço publicado pelo Cloudflare, a aplicação usa a própria origem
  // para consultar a API. No GitHub Pages, continua funcionando apenas offline.
  cloudApiUrl: cloudflareHost ? window.location.origin : ''
};

window.addEventListener('DOMContentLoaded', () => {
  const script = document.createElement('script');
  script.src = 'master-data.js?v=20260801-1';
  document.body.appendChild(script);
});
