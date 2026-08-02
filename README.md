# NEODENT Manufacturing Execution System

MES mobile-first para acompanhamento operacional de máquinas CNC, com foco em Traub TNL, turnos, produção, Andon, alertas e passagem entre operadores.

## Arquitetura atual

- Front-end modular em JavaScript ES nativo
- Design system responsivo em CSS
- Cloudflare Worker
- Cloudflare D1
- PWA com service worker
- Armazenamento local e fila offline
- Sincronização de estados e eventos entre aparelhos

## Catálogo fabril

- 10 linhas
- Máquinas TNL
- MILLTAP
- DISCOVERY
- Catálogo local de contingência e catálogo oficial no D1

## Navegação

- Visão geral
- Máquinas
- Andon
- Alertas
- Mais

No desktop, a barra inferior se transforma em sidebar.

## Fluxos principais

### Sessão do turno

- Login por nome e matrícula
- Turno ativo
- Máquinas vinculadas por operador, data e turno
- Migração automática da versão anterior

### Conferência inicial

Fluxo guiado em cinco etapas:

1. OP e item
2. Ciclo, frequências e minutos restantes
3. Matéria-prima, gabaritos e recursos
4. Status inicial
5. Revisão e confirmação

### Apontamento

O operador informa somente:

- peças produzidas neste turno;
- observação opcional.

O sistema calcula o total após o apontamento, meta, saldo e previsão.

### Encerramento de ordem

- Encerrar OP
- Nova OP com o mesmo item
- Nova OP com outro item
- Máquina parada
- Recalcular minutos restantes

### Andon e alertas

- Estado compartilhado das máquinas
- Produzindo, setup, ajuste, parada, manutenção e pendente
- Conferência pendente
- Informação desatualizada
- Risco de matéria-prima insuficiente
- Reconhecimento de alerta

## Offline e PWA

- Manifesto instalável
- App shell em cache
- Página offline
- Fila de sincronização
- Reenvio ao recuperar conexão
- Indicador de estado da nuvem
- Aviso de nova versão

## Estrutura principal

```text
app/
  app.css           Design system e responsividade
  catalog.js        Catálogo local de contingência
  core.js           Estado, migração, cálculos e API
  components.js     Componentes e views
  main.js           Fluxos e navegação
  cloud-state.js    Andon e eventos compartilhados
  runtime.js        Acessibilidade e compatibilidade

worker/
  main.js           Roteamento da API
  index.js          Registros e assets
  database.js       Catálogo e dados mestres
  learning.js       Aprendizado de operador, item e OP
  shift.js          Turnos, máquinas e passagem
  operations.js     Estado atual e eventos
```

## API

- `GET /health`
- `GET|POST /api/v1/records`
- `GET /api/v1/catalog`
- `GET /api/v1/operators`
- `POST /api/v1/session/login`
- `GET|POST /api/v1/assignments`
- `GET /api/v1/shift-context`
- `POST /api/v1/shift-sessions`
- `GET /api/v1/items`
- `GET /api/v1/orders`
- `GET|POST /api/v1/machine-states`
- `GET|POST /api/v1/events`
- `GET /api/v1/database-summary`

## Desenvolvimento

```bash
npm install
npm run dev
```

Publicação:

```bash
npm run deploy
```

## Validação

O workflow `.github/workflows/validate.yml` verifica sintaxe, manifesto, PWA, design tokens, rotas e requisitos estruturais.

Documentação detalhada:

- `docs/ARCHITECTURE-V3.md`
- `docs/VALIDATION-V3.md`

## Endereços

- GitHub Pages: versão local/offline para conferência visual
- Cloudflare Workers: versão oficial com sincronização D1
