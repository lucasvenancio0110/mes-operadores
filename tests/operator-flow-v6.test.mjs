import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [authShell,core,operator,assistant,index,serviceWorker]=await Promise.all([
  read('app/auth-shell.js'),read('app/core.js'),read('app/operator-main.js'),
  read('app/turn-assistant.js'),read('index.html'),read('sw.js')
]);

assert(!authShell.includes('secureShift'),'Login ainda mostra ou lê o seletor de turno.');
assert(authShell.includes('JSON.stringify({ registration,password })'),'Login ainda envia turno escolhido pelo cliente.');
assert(authShell.includes('user.operationalContext || detectOperationalContext()'),'Sessão não usa o turno automático do servidor.');
assert(core.includes('detectFactoryOperationalContext'),'Core não compartilha a regra oficial de turno.');
assert(core.includes('productionDate:String(session.productionDate)'),'Máquinas ainda são carregadas com a data civil errada na madrugada.');

assert(operator.includes('SELEÇÃO MÚLTIPLA'),'Tela única de seleção múltipla ausente.');
assert(operator.includes('data-assignment-machine'),'Grade de máquinas selecionáveis ausente.');
assert(operator.includes('aria-pressed'),'Seleção múltipla não expõe o estado de cada máquina.');
assert(!operator.includes("assignmentStage = 'machines'"),'Fluxo ainda obriga adicionar uma máquina por vez.');
assert(!operator.includes('assignmentDraft.length < 3'),'Quantidade de máquinas ainda possui limite mínimo artificial.');
assert(!operator.includes("action === 'change-shift'"),'Operador ainda pode trocar manualmente o turno.');

assert(assistant.includes('id="taPointingForm"'),'Apontamento individual por máquina ausente.');
assert(assistant.includes('data-ta-stops'),'Campo de minutos de parada ausente.');
assert(assistant.includes('calculatePointingAccounting'),'Tela não usa o relógio lógico validado.');
assert(assistant.includes('A quantidade é livre.'),'Interface não deixa claro que o cálculo é consultivo.');
assert(assistant.includes("closePayload(machineId,'pointing',false)"),'Apontamento normal não está separado do fechamento final.');
assert(assistant.includes("closePayload(machineId,'pointing',true)"),'Encerramento final do turno não está identificado.');
assert(assistant.includes('response?.turnClock?.remainingMinutes'),'Próxima OP ainda não herda o saldo devolvido pelo servidor.');
assert(!assistant.includes('remainingShiftMinutes({'),'Próxima OP ainda usa a hora atual em vez do saldo lógico.');
assert(assistant.includes("operatorCardState({ physicalStatus,opStatus,workflowStatus })"),'Cartão ainda mistura os três estados.');
assert(assistant.includes('Confira novamente antes de continuar'),'Reconferência após apontamento não está visível.');
assert(assistant.includes('release.turnPiece'),'Liberações após reconferência não usam a produção acumulada no turno.');

assert(index.includes('app/auth-shell.js?v=6.0.0'));
assert(index.includes('app/turn-assistant.js?v=6.0.0'));
assert(serviceWorker.includes('neomes-v6.0.0-operator-flow'));

console.log('NEOMES v6 operador: login, multisseleção, apontamento e continuidade validados.');
