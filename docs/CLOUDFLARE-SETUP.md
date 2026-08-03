# Conectar o NEOMES ao Cloudflare

O projeto já está configurado para publicar, no mesmo endereço:

- aplicativo PWA;
- Cloudflare Worker;
- API `/api/v1/*`;
- banco Cloudflare D1;
- assets estáticos;
- funcionamento offline e fila de sincronização.

## Configuração já presente

- Worker: `mes-operadores`
- Arquivo principal: `worker/main.js`
- Binding do banco: `DB`
- Banco: `mes-operadores-db`
- ID do D1: `31666c87-0970-44e1-9969-51458e7888b5`
- Deploy: `.github/workflows/deploy-cloudflare.yml`

## 1. Criar o token no Cloudflare

No painel do Cloudflare:

1. Abra **My Profile**.
2. Entre em **API Tokens**.
3. Selecione **Create Token**.
4. Escolha **Create Custom Token**.
5. Nome sugerido: `GitHub NEOMES Deploy`.
6. Adicione as permissões da conta:
   - **Workers Scripts — Edit**;
   - **D1 — Edit**.
7. Em recursos da conta, selecione somente a conta onde está o banco `mes-operadores-db`.
8. Crie o token e copie o valor. Ele aparece apenas uma vez.

Nunca salve esse token em um arquivo do projeto.

## 2. Copiar o Account ID

No painel do Cloudflare, abra a conta utilizada pelo projeto e copie o **Account ID**.

## 3. Salvar os dois segredos no GitHub

No repositório `lucasvenancio0110/mes-operadores`:

1. Abra **Settings**.
2. Abra **Secrets and variables**.
3. Entre em **Actions**.
4. Selecione **New repository secret**.
5. Crie estes dois segredos exatamente com estes nomes:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

O primeiro recebe o token criado no Cloudflare. O segundo recebe o Account ID.

## 4. Fazer o primeiro deploy

1. No GitHub, abra a aba **Actions**.
2. Selecione **Deploy NEOMES to Cloudflare**.
3. Selecione **Run workflow**.
4. Aguarde o job **Publicar aplicação e API** ficar verde.

No resumo do workflow aparecerão:

- endereço oficial do aplicativo;
- endereço da API;
- endereço `/health`.

## 5. O que o workflow verifica

Depois da publicação, o GitHub chama automaticamente:

```text
/health
```

O deploy só é considerado válido quando a resposta confirma:

```json
{
  "ok": true,
  "database": true
}
```

Isso confirma que:

- o Worker foi publicado;
- o binding `DB` existe;
- o D1 está acessível;
- o aplicativo e a API compartilham a mesma origem.

## 6. Teste entre aparelhos

1. Abra o endereço Cloudflare em um aparelho.
2. Entre com operador, matrícula e turno.
3. Selecione as máquinas.
4. Faça uma conferência.
5. Abra o mesmo endereço em outro aparelho.
6. Entre no turno correspondente e confira os dados compartilhados.

Quando não houver problema, a home não mostra aviso de sincronização. O aviso aparece somente quando houver:

- falta de internet;
- registros aguardando envio;
- erro real de sincronização.

## 7. Próxima etapa

Após o primeiro deploy funcionar, o workflow poderá ser alterado para publicar automaticamente a cada atualização da branch `main`.
