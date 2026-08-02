# NEODENT MES v3 — Auditoria e Arquitetura

## 1. Auditoria da versão anterior

### UX e hierarquia

- A tela principal misturava conferência inicial, cadastro técnico, apontamento, encerramento de ordem e histórico.
- Informações de consulta e campos editáveis possuíam o mesmo peso visual.
- O operador precisava percorrer formulários extensos para executar ações simples.
- O status da máquina não era o centro da experiência.
- A seleção de máquinas evoluiu por correções incrementais e ficou dependente de vários módulos sobrepostos.
- A nomenclatura “produção recebida/acumulado” causava dúvida operacional.

### UI e responsividade

- O tema possuía boa identidade, mas utilizava magenta em excesso e pouca diferenciação entre superfícies.
- Os cartões tinham aparência semelhante, reduzindo a hierarquia.
- A navegação era limitada a Registro e Histórico.
- O layout desktop era uma ampliação do mobile, sem sidebar ou grade operacional adequada.
- A viewport bloqueava zoom em versões anteriores.

### Arquitetura

- `app.js` concentrava estado, persistência, cálculos, renderização, histórico e sincronização.
- Módulos posteriores (`session-v2`, `shift-authority`, `assignment-confirm`, `no-sequence`, `production-flow`, `production-entry`) alteravam o DOM e o estado depois do carregamento.
- O catálogo existia no front-end e no Worker.
- O modelo ainda possuía “sequência”, mesmo depois de o campo ter sido escondido.
- Status operacional e Andon não eram compartilhados entre aparelhos.
- Não havia manifesto, service worker ou fila offline explícita da nova arquitetura.

### Riscos de regressão identificados

- Perda da sessão e das máquinas já escolhidas.
- Perda dos registros locais existentes.
- Divergência entre produção salva localmente e D1.
- Dupla contagem de produção ao migrar o significado de “produção final”.
- Reaproveitamento indevido de cache do Safari.
- Encerramento visual da OP sem atualização do cadastro de ordens no D1.

## 2. Estratégia aplicada

### Princípios

1. Operação antes de cadastro.
2. Uma máquina ativa por vez, com troca imediata pelo seletor superior.
3. Status, alerta e ação prioritária antes dos detalhes técnicos.
4. Conferência inicial guiada em etapas.
5. Apontamento com apenas produção do turno e observação.
6. Offline-first com sincronização posterior.
7. Estado compartilhado para Andon e passagem entre aparelhos.
8. Compatibilidade com os registros e tabelas existentes.

### Navegação

Mobile:

- Visão geral
- Máquinas
- Andon
- Alertas
- Mais

Desktop:

- Sidebar compacta com as mesmas áreas.

### Hierarquia de informação

1. Máquina selecionada e status.
2. OP, item e progresso do turno.
3. Alertas e necessidade de ação.
4. Ciclo, previsão, medições e matéria-prima.
5. Histórico e ferramentas de compartilhamento.

## 3. Design system

O arquivo `app/app.css` concentra tokens para:

- escala de fundos e superfícies;
- cores de marca e status;
- tipografia Inter e JetBrains Mono com fallbacks;
- espaçamento;
- raios;
- sombras;
- duração de animações;
- tamanhos de toque;
- altura da navegação;
- largura máxima do conteúdo.

Status nunca depende somente de cor: utiliza texto, ponto, badge, borda e posição.

## 4. Arquitetura de componentes

### Núcleo

- `app/core.js`: estado, migração, cálculos, API, fila offline e sincronização.
- `app/catalog.js`: catálogo local de contingência.
- `app/cloud-state.js`: sincronização de estados e eventos operacionais.

### Interface

- `app/components.js`: componentes reutilizáveis e views.
- `app/main.js`: fluxos, navegação e ações.
- `app/runtime.js`: acessibilidade, menu, turno, atualização e compatibilidade.
- `app/app.css`: design system e responsividade.

### Nuvem

- `worker/main.js`: roteamento da API.
- `worker/index.js`: registros de produção e assets.
- `worker/database.js`: catálogo e dados mestres.
- `worker/learning.js`: aprendizado de operador, item, máquina e OP.
- `worker/shift.js`: máquinas do turno e sessões.
- `worker/operations.js`: estado atual das máquinas e eventos.

## 5. Estado e migração

Nova chave local:

- `neodent-mes:v3`

Chave anterior preservada e migrada:

- `mes-operadores:v2`

Dados migrados:

- operador e matrícula;
- turno;
- catálogo;
- máquinas selecionadas;
- conferências existentes;
- registros de produção;
- máquina ativa.

Os arquivos antigos continuam no repositório, mas não são carregados pelo novo `index.html`.

## 6. Fluxos implementados

### Login

- nome;
- matrícula;
- turno;
- persistência local;
- aprendizado no D1.

### Seleção de máquinas

- mínimo de três;
- Linha → Máquina;
- busca;
- revisão;
- adição posterior;
- salvamento local e no D1.

### Conferência inicial

1. OP e item;
2. ciclo e frequências;
3. matéria-prima e recursos;
4. status inicial;
5. revisão final.

A produção anterior é consultada automaticamente por OP e máquina.

### Apontamento

- peças produzidas neste turno;
- observação opcional;
- total após apontamento calculado;
- saldo contra meta;
- salvamento local e no D1.

### Encerramento da ordem

- confirmação crítica;
- OP marcada como inativa no aprendizado;
- nova OP com mesmo item;
- nova OP com outro item;
- máquina parada;
- minutos restantes recalculados.

### Andon e alertas

- estado compartilhado por máquina;
- atualização periódica;
- status visível por texto e cor;
- conferência pendente;
- máquina parada/manutenção;
- setup/ajuste;
- dado desatualizado;
- risco de matéria-prima insuficiente.

## 7. PWA e offline

Arquivos:

- `manifest.webmanifest`;
- `sw.js`;
- `offline.html`;
- `icons/mes-icon.svg`.

Comportamento:

- app shell em cache;
- navegação offline;
- fila de POSTs pendentes;
- reenvio ao recuperar conexão;
- aviso de nova versão;
- indicador local, pendente, sincronizado e erro.

## 8. Acessibilidade

- zoom do navegador permitido;
- áreas de toque de 44–48 px;
- foco visível;
- labels associados;
- ARIA em progresso, status e modais;
- foco preso no modal;
- conteúdo de fundo inerte durante modal;
- Escape fecha modal;
- `prefers-reduced-motion`;
- suporte a `forced-colors`;
- status não dependentes somente da cor.

## 9. Performance

- zero framework pesado;
- módulos ES nativos;
- CSS sem biblioteca de componentes;
- catálogo local de contingência;
- atualização do estado operacional a cada 30 segundos somente quando visível;
- fila offline incremental;
- limite de registros na API;
- assets estáticos em cache pelo service worker.

## 10. Funcionalidades preservadas

- dez linhas e catálogo oficial;
- seleção de linha e máquina;
- login e turno;
- OP e item;
- ciclo e frequências por máquina;
- cálculos de meta;
- produção entre turnos;
- apontamentos e histórico;
- D1 e Cloudflare Worker;
- aprendizado de operadores, itens e OPs;
- modo local no GitHub Pages;
- sincronização na origem Cloudflare.

## 11. Próximas evoluções técnicas

Dependem de fonte de dados ou integração externa:

- coleta automática de ciclo real diretamente da máquina;
- OEE com disponibilidade, performance e qualidade reais;
- integração com manutenção e chamados;
- refugo e qualidade;
- autenticação com PIN ou SSO;
- permissões por perfil;
- exportação PDF e imagem pelo servidor;
- notificações push;
- telemetria e observabilidade;
- conflitos multiusuário com versionamento por registro.
