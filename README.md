# Painel de Produção — Mês Operadores

Aplicação web responsiva para registro e acompanhamento da produção por máquina no chão de fábrica.

## Acessar o painel

**GitHub Pages:** https://lucasvenancio0110.github.io/mes-operadores/

## Funcionalidades

- Controle de até quatro máquinas
- Registro de TNL, OP, item, peças e tempo de ciclo
- Cálculo automático de meta, produção esperada, liberações e saldo
- Histórico separado por máquina
- Observações e troca de OP no meio do turno
- Estrutura preparada para integração com Google Sheets via Apps Script

## Estrutura

- `index.html` — interface do painel
- `styles.css` — identidade visual e responsividade
- `app.js` — cálculos, registros e integração com a nuvem
- `.nojekyll` — configuração para publicação direta no GitHub Pages

## Integração com Google Sheets

No arquivo `app.js`, substitua:

```js
const SHEETS_API_URL = 'COLE_AQUI_A_URL_DO_SEU_APPS_SCRIPT';
```

pela URL publicada do Google Apps Script.

Sem essa configuração, o painel abre e calcula normalmente, mas os registros não são persistidos na nuvem.
