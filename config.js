window.APP_CONFIG = {
  // Será preenchido na próxima etapa com a URL do Cloudflare Worker.
  // Exemplo: "https://mes-operadores-api.seu-subdominio.workers.dev"
  cloudApiUrl: ""
};

// Carrega o catálogo oficial depois que a aplicação principal estiver pronta.
// Isso também executa a migração automática nos aparelhos que já usaram a versão anterior.
window.addEventListener('DOMContentLoaded', () => {
  const script = document.createElement('script');
  script.src = `catalog.js?v=1`;
  script.defer = true;
  document.body.appendChild(script);
});
