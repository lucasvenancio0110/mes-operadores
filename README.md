# Painel de Produção — Mês Operadores

Aplicação web mobile-first para apontamento e consulta da produção no chão de fábrica.

## Acesso atual

GitHub Pages: https://lucasvenancio0110.github.io/mes-operadores/

## Funcionalidades

- Quatro postos de máquina por operador
- Seleção encadeada de **Linha → Máquina**
- Cadastro rápido de novas linhas e máquinas, sem limitar o mapa fabril
- Registro de OP, item, produção, tempo de ciclo, frequências e observações
- Cálculo automático de meta, produção esperada, liberações, saldo e minutos ganhos/perdidos
- Aba **Histórico** com filtros por linha, máquina, período e busca
- Resumo consolidado de registros, produção final, meta e saldo
- Detalhamento completo de cada lançamento
- Cancelamento auditável, preservando o registro no histórico
- Armazenamento local offline no aparelho
- Estrutura preparada para sincronização com Cloudflare Worker + D1

## Nuvem

A aplicação funciona offline e mantém os dados no navegador. A URL da futura API Cloudflare será configurada no arquivo `config.js`.

Contrato previsto da API:

- `GET /health`
- `GET /api/v1/records`
- `POST /api/v1/records`

## Arquivos

- `index.html`: estrutura das telas
- `styles.css`: identidade visual e responsividade
- `app.js`: regras, cálculos, histórico e persistência
- `config.js`: configuração da API Cloudflare
