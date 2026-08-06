import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [validate,deploy]=await Promise.all([
  read('.github/workflows/validate.yml'),
  read('.github/workflows/deploy-cloudflare.yml')
]);

assert(validate.includes('pull_request:')&&validate.includes('branches: [main]'),'Validação deve cobrir PR e main.');
assert(deploy.includes('workflow_run:')&&deploy.includes("workflows: ['Validate MES']")&&deploy.includes('types: [completed]'),'Deploy não aguarda o Validate MES.');
assert(!/^  push:\s*$/m.test(deploy),'Deploy ainda dispara em paralelo no push da main.');
assert(deploy.includes("github.event.workflow_run.conclusion == 'success'"),'Deploy não bloqueia validação reprovada.');
assert(deploy.includes('github.event.workflow_run.head_sha')&&deploy.includes('ref: ${{ env.SOURCE_SHA }}'),'Deploy não fixa exatamente o commit validado.');
assert(deploy.includes('test "$CHECKED_SHA" = "$SOURCE_SHA"'),'Checkout aprovado não é conferido antes da publicação.');
assert.equal((deploy.match(/commit:process\.env\.SOURCE_SHA/g)||[]).length,2,'Registros de sucesso e falha devem apontar para o commit validado.');
assert(deploy.includes('validationWorkflowRun:process.env.VALIDATION_RUN_ID'),'Registro de deploy não liga a validação que o autorizou.');
for(const test of ['tests/operator-flow-v6.test.mjs','tests/preparer-dashboard-v6.test.mjs','tests/workflow-gate-v6.test.mjs'])assert(deploy.includes(test),`Deploy não repete ${test} antes de publicar.`);

console.log('NEOMES CI: deploy bloqueado até validação verde do mesmo commit.');
