import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [worker,auth,secure]=await Promise.all([
  read('worker/turn-assistant.js'),
  read('worker/auth.js'),
  read('worker/secure-main.js')
]);

for(const table of ['machine_turn_states','machine_runtime_states']){
  assert(worker.includes(`CREATE TABLE IF NOT EXISTS ${table}`),`Tabela v6 ausente: ${table}`);
}
assert(worker.includes("SET status=CASE WHEN closed_at IS NULL THEN 'active' ELSE 'closed' END"),'Migração segura dos estados parados antigos ausente.');
assert(worker.includes("physical_status='stopped'"),'Estado físico parado não está separado da OP.');
assert(worker.includes('calculatePointingAccounting'),'API não usa a mesma contabilidade lógica validada no frontend.');
assert(worker.includes('const endedAt=now;'),'Apontamento deve fechar no instante real do registro.');
assert(!worker.includes("const endedAt=mode==='shift'?bounds.end:now"),'API ainda projeta o apontamento até o fim programado do turno.');
assert(worker.includes('stopMinutes'),'Minutos de parada informados pelo operador não chegam à API.');
assert(worker.includes("workflowStatus=finalShift?'shift_closed':'conference_pending'"),'Estado pós-apontamento não exige reconferência.');
assert(worker.includes("line-dashboard"),'Cockpit por linha não possui endpoint protegido.');
assert(worker.includes("['admin','leadership','preparator']"),'Endpoint da linha não restringe os papéis permitidos.');
assert(!worker.includes("||auth.permissions.includes('production.view_all')"),'Perfil técnico não deve herdar o cockpit por uma permissão genérica.');
assert(worker.includes('auth.lineAccess'),'Cockpit não respeita as linhas autorizadas do preparador.');
assert(worker.includes("SELECT id,line_id AS lineId FROM machines WHERE id=? AND active=1"),'API confia na linha enviada pelo cliente sem consultar a máquina real.');
assert(worker.includes("code:'MACHINE_LINE_MISMATCH'"),'API não rejeita máquina associada a outra linha.');
for(const permission of ['machines.view','conference.create','production.create','machines.update_status'])assert(worker.includes(`'${permission}'`),`Permissão operacional não é verificada: ${permission}`);
assert(worker.includes('function requireCapability'),'Rotas de escrita não possuem bloqueio por capacidade.');
assert(worker.includes("pointingValidation:'advisory-only'"),'Contrato consultivo foi removido.');
assert(worker.includes("minuteLedger:'logical-accounted-per-machine-shift'"),'Health check não declara o relógio lógico.');
assert(worker.includes("stateAxes:['physicalStatus','opStatus','workflowStatus']"),'Health check não declara os três estados.');

const loginSection=auth.slice(auth.indexOf("url.pathname === '/api/v1/auth/login'"),auth.indexOf("url.pathname === '/api/v1/auth/me'"));
assert(!loginSection.includes('body?.shift'),'Login seguro ainda aceita turno escolhido pelo cliente.');
assert(loginSection.includes("UPDATE users SET last_login_at=?"),'Login não atualiza o acesso sem alterar o turno padrão.');
assert(auth.includes('operationalContext:detectOperationalContext()'),'Autenticação não devolve o turno operacional automático.');
assert(secure.includes("minuteLedger:'logical-accounted-per-machine-shift'"),'Contrato de falha do health check v6 incompleto.');
assert(secure.includes('validateOperationalMutation(request,env,auth)'),'Proteção geral não recebe o banco para validar a linha real.');
assert(secure.includes("code:'MACHINE_LINE_MISMATCH'")&&secure.includes("SELECT id,line_id AS lineId FROM machines"),'Rotas legadas ainda confiam na linha enviada pelo cliente.');
for(const permission of ['machines.assign','machines.update_status','production.create'])assert(secure.includes(`'${permission}'`),`Rota legada não exige ${permission}.`);
assert(worker.includes('ORDER BY latest.updated_at DESC,latest.id DESC LIMIT 1'),'Cockpit pode duplicar máquina quando duas atribuições têm o mesmo horário.');

console.log('NEOMES v6 Worker: migração, estados, apontamento e cockpit protegidos validados.');
