# Validação NEODENT MES v3

## Validação automatizada

Workflow: `.github/workflows/validate.yml`

Verificações:

- sintaxe dos módulos JavaScript;
- sintaxe do Worker;
- manifesto JSON;
- presença dos arquivos PWA;
- tokens essenciais do design system;
- zoom permitido;
- safe areas;
- movimento reduzido;
- rotas essenciais da API;
- migração da versão anterior;
- fila offline;
- fluxos de conferência, apontamento, Andon e alertas.

## Matriz de viewports

| Largura | Composição esperada |
|---|---|
| 320 px | Uma coluna; cards e seletores sem rolagem horizontal; grids condicionais em uma coluna |
| 360 px | Mobile compacto; barra inferior com cinco áreas |
| 375 px | Layout padrão de iPhone; seletor de máquinas horizontal |
| 390 px | Layout padrão; métricas em duas colunas |
| 430 px | Cards mais largos; formulários em duas colunas quando apropriado |
| 768 px | Andon em três colunas; dashboard principal em duas áreas |
| 1024 px | Sidebar; Andon em quatro colunas; modais centralizados |
| 1366 px | Dashboard amplo; Andon em cinco colunas |
| 1440 px | Densidade alta com largura máxima controlada |
| Ultrawide | Conteúdo limitado e Andon em até seis colunas |

## Fluxos funcionais

### Sessão

- [ ] Login com nome, matrícula e turno.
- [ ] Sessão preservada após atualizar.
- [ ] Alterar turno redefine as máquinas daquele turno.
- [ ] Logout solicita nova identificação.

### Máquinas

- [ ] Mínimo de três máquinas.
- [ ] Seleção Linha → Máquina.
- [ ] Busca por TNL.
- [ ] Revisão antes de salvar.
- [ ] Adicionar e remover máquina.
- [ ] Troca rápida pelo carrossel.

### Conferência

- [ ] OP e item obrigatórios.
- [ ] Produção anterior carregada automaticamente.
- [ ] Ciclo aceita 90, 1:30, 1,30, 00:01:30 e 1m30s.
- [ ] Frequências opcionais.
- [ ] Matéria-prima e recursos opcionais.
- [ ] Status inicial obrigatório por escolha explícita.
- [ ] Rascunho preservado entre etapas.
- [ ] Resumo antes da confirmação.

### Produção

- [ ] Operador informa somente peças do turno.
- [ ] Total após apontamento calculado.
- [ ] Saldo contra meta calculado.
- [ ] Observação opcional.
- [ ] Apontamento salvo localmente.
- [ ] Apontamento sincronizado no D1.
- [ ] Duplicidade evitada por UUID.

### Encerramento de OP

- [ ] Confirmação explícita.
- [ ] Ordem marcada como encerrada.
- [ ] Nova OP com mesmo item mantém parâmetros.
- [ ] Nova OP com outro item limpa parâmetros.
- [ ] Máquina parada atualiza status.
- [ ] Minutos restantes recalculados.

### Andon e alertas

- [ ] Status compartilhado entre aparelhos.
- [ ] Atualização automática quando a página está visível.
- [ ] Conferência pendente gera alerta.
- [ ] Parada e manutenção aparecem como críticos.
- [ ] Setup e ajuste aparecem como importantes.
- [ ] Informação desatualizada gera alerta.
- [ ] Matéria-prima insuficiente gera alerta explicável.
- [ ] Reconhecimento remove o alerta da lista local.

### Offline/PWA

- [ ] Instalação no Android/Chrome.
- [ ] Instrução para instalação no iPhone.
- [ ] App shell abre sem internet após primeira visita.
- [ ] Apontamento offline entra na fila.
- [ ] Fila é enviada ao recuperar conexão.
- [ ] Indicador apresenta offline, pendente, erro e sincronizado.
- [ ] Nova versão é anunciada.

## Acessibilidade

- [ ] Zoom de 200% sem perda de função.
- [ ] Navegação por teclado.
- [ ] Foco visível.
- [ ] Foco preso dentro de modais.
- [ ] Escape fecha modal.
- [ ] Fundo inerte com modal aberto.
- [ ] Labels associados.
- [ ] Status com texto além da cor.
- [ ] Áreas de toque mínimas.
- [ ] Movimento reduzido respeitado.

## Casos de conteúdo

- [ ] OP sem descrição.
- [ ] Item nunca cadastrado.
- [ ] Máquina sem conferência.
- [ ] Máquina sem matéria-prima informada.
- [ ] Textos e observações longas.
- [ ] Muitas máquinas no turno.
- [ ] Alertas simultâneos.
- [ ] Registro antigo migrado.
- [ ] D1 temporariamente indisponível.
- [ ] Dois aparelhos alterando máquinas diferentes.

## Observação

A checagem automatizada garante integridade estrutural. A validação visual e operacional final deve ser executada na URL Cloudflare após o deploy, usando aparelhos reais e os viewports acima.
