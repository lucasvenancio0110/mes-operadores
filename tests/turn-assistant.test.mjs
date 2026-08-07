import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  calculateFullShiftTarget,calculateMaterial,calculateOrderForecast,calculatePeriodPerformance,
  listMeasurementReleases,
  calculateTurnClock,predictionMessage,shiftWindow,minutesBetween,continuousMinutesBetween
} from '../app/turn-assistant-engine.js';
import { calculateMeasurementPlans } from '../app/measurement-engine.js';
import { bindAssistantSubmit,formControlValue,isAssistantForm } from '../app/turn-assistant-submit.js';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const submitBridgePath=fileURLToPath(new URL('app/turn-assistant-submit.js',root));
const assistantPath=fileURLToPath(new URL('app/turn-assistant.js',root));
execFileSync(process.execPath,['--check',submitBridgePath],{ stdio:'pipe' });
execFileSync(process.execPath,['--check',assistantPath],{ stdio:'pipe' });
const [submitBridge,assistant,index,serviceWorker,workerAssistant]=await Promise.all([
  read('app/turn-assistant-submit.js'),
  read('app/turn-assistant.js'),
  read('index.html'),
  read('sw.js'),
  read('worker/turn-assistant.js')
]);

assert(submitBridge.includes('onSubmit(form,button)'),'A ponte de toque não chama a rotina real de envio.');
assert(!submitBridge.includes('SubmitEvent'),'A ponte não deve sintetizar eventos de submit.');
assert(!submitBridge.includes('form.dispatchEvent'),'A ponte não deve reenviar eventos artificialmente.');
assert(assistant.includes("bindAssistantSubmit(document,submitAssistantForm)"),'A ponte móvel não está conectada ao assistente.');
assert(assistant.includes('taPointingForm:submitPointing'),'O formulário de apontamento não está ligado à rotina de persistência.');
assert(assistant.includes("post('/api/v1/turn-assistant/handoff',body)"),'Persistência da passagem de turno não está conectada.');
assert(assistant.includes('Tempo de ciclo da peça'),'Atualizar dados não oferece edição do tempo de ciclo.');
assert(assistant.includes("flow?.mode==='update'?parseCycle(form.elements.cycle?.value)"),'O ciclo editado não é validado pelo parser oficial.');
assert(assistant.includes('opTarget:order.opTarget,cycleSeconds,frequency1'),'O ciclo editado não entra no payload da OP ativa.');
assert(assistant.includes("formControlValue(form,'item')"),'O campo Item não usa leitura segura para Safari.');
assert(!assistant.includes('form.elements.item.value'),'A colisão com HTMLFormControlsCollection.item ainda existe.');
assert(assistant.includes('A matéria-prima consegue produzir até'),'Autonomia do material após a meta ausente.');
assert(!assistant.includes('Ação necessária: adicionar'),'A recomendação inviável de adicionar barra ainda está visível.');
assert(!assistant.includes('Faltarão cerca de'),'A quantidade faltante ainda está visível.');
for(const formId of ['taHandoffForm','taFirstOrderForm','taPointingForm','taShiftCloseForm','taOrderCloseForm','taNewOrderForm','taStoppedForm']) {
  assert(assistant.includes(`data-ta-submit-form="${formId}"`),`Envio direto ausente em ${formId}.`);
}
assert(index.includes('turn-assistant.js?v=6.0.2'),'Hotfix 6.0.1 do apontamento não está carregado no HTML.');
assert(!index.includes('turn-assistant-submit-fix'),'Hotfix sintético antigo ainda está carregado no HTML.');
assert(serviceWorker.includes("'./app/turn-assistant-submit.js'"),'Ponte de envio não está no cache do PWA.');
assert(!serviceWorker.includes('turn-assistant-submit-fix'),'Hotfix sintético antigo ainda está no cache do PWA.');
assert(serviceWorker.includes('neomes-v6.2.0-factory-floor-layout'),'Cache móvel não foi renovado para a planta física sem perder o hotfix do apontamento.');
assert(workerAssistant.includes("rolloverMinutes===1375"),'O Worker não valida períodos que atravessam a madrugada.');
assert(workerAssistant.includes('const endedAt=now;'),'O Worker não fecha o apontamento no instante real do registro.');
assert(workerAssistant.includes("T${clock}:00-03:00"),'Os turnos do Worker não usam o horário de Curitiba.');
assert(assistant.includes('quantidade será salva normalmente.'),'A divergência calculada não é apresentada como aviso consultivo.');
assert(!assistant.includes('if(result.inconsistent)return showError'),'O frontend ainda bloqueia quantidades pela estimativa de tempo.');
assert(!workerAssistant.includes('PERIOD_TIME_INCONSISTENT'),'O Worker ainda rejeita apontamentos pela estimativa de tempo.');
assert(workerAssistant.includes("pointingValidation:'advisory-only'"),'O contrato consultivo do Worker está ausente.');
assert(assistant.includes('data-ta-reconfirm'),'A nova conferência após o apontamento está ausente.');
assert(assistant.includes('clearLocalMachineSession'),'A reconciliação de OP fantasma está ausente.');
assert(assistant.includes('!context.error&&!context.activeOrder'),'O estado local não respeita a ausência de OP no Cloudflare.');
assert(assistant.includes('Meta do turno'),'A meta calculada para os 480 minutos não está visível.');
assert(!assistant.includes('480 min ÷ ciclo'),'A fórmula técnica da meta ainda está exposta ao operador.');
assert(assistant.includes('LIBERAÇÕES DO TURNO'),'A lista completa de liberações não está visível.');
assert(assistant.includes('listMeasurementReleases(plans)'),'O cartão não usa a lista completa de liberações.');
assert(assistant.includes('A próxima liberação'),'A primeira liberação não está escrita como instrução operacional.');
assert(assistant.includes('peças produzidas neste turno.'),'A quantidade da liberação não está vinculada ao turno.');
assert(assistant.includes("if(index===0)return 'Primeira'"),'A primeira liberação não está identificada.');
assert(assistant.includes("if(index===1)return 'Segunda'"),'A segunda liberação não está identificada.');
assert(!assistant.includes('peças possíveis nesta OP durante o turno.'),'O resumo técnico antigo das liberações ainda está visível.');

const safariItemInput={ value:'317396' };
const safariForm={
  elements:{
    item(){ return null; },
    namedItem(name){ return name==='item' ? safariItemInput : null; }
  }
};
assert.equal(formControlValue(safariForm,'item'),'317396','Safari deve ler o campo Item sem colidir com elements.item().');

const listeners=new Map();
const pointingForm={ id:'taPointingForm' };
const fakeRoot={
  addEventListener(type,listener,capture){ assert.equal(capture,true);listeners.set(type,listener); },
  removeEventListener(type,listener,capture){ assert.equal(capture,true);assert.equal(listeners.get(type),listener);listeners.delete(type); },
  getElementById(id){ return id===pointingForm.id ? pointingForm : null; }
};
let submitted=0;
const button={
  disabled:false,
  dataset:{ taSubmitForm:pointingForm.id },
  closest(selector){ return selector==='[data-ta-submit-form]' ? this : null; }
};
let prevented=0;let stopped=0;
const unbind=bindAssistantSubmit(fakeRoot,(form,submitter)=>{
  assert.equal(form,pointingForm);assert.equal(submitter,button);submitted+=1;submitter.disabled=true;
});
const click={ target:button,preventDefault(){prevented+=1;},stopImmediatePropagation(){stopped+=1;} };
listeners.get('click')(click);
listeners.get('click')(click);
assert.equal(submitted,1,'Um toque deve iniciar exatamente um salvamento.');
assert.equal(prevented,1);
assert.equal(stopped,1);
for(const formId of ['taHandoffForm','taFirstOrderForm','taPointingForm','taShiftCloseForm','taOrderCloseForm','taNewOrderForm','taStoppedForm']) {
  assert.equal(isAssistantForm({ id:formId }),true,`${formId} precisa ser reconhecido pela ponte móvel.`);
}
assert.equal(isAssistantForm({ id:'outroForm' }),false);
unbind();
assert.equal(listeners.has('click'),false);

const material=calculateMaterial({ pieceLengthMm:11,currentBarPieces:276,feederBars:1,barLengthMm:3600,kerfMm:1 });
assert.equal(material.piecesPerFullBar,300);
assert.equal(material.availablePieces,576);

assert.equal(calculateFullShiftTarget(287),100,'287 s por peça deve resultar em 100 peças por turno.');
assert.equal(calculateFullShiftTarget(324),88,'324 s por peça deve resultar em 88 peças por turno.');
assert.equal(calculateFullShiftTarget(60),480,'60 s por peça deve resultar em 480 peças por turno.');
assert.equal(calculateFullShiftTarget(0),0,'Tempo de ciclo inválido não deve gerar meta.');

const releases=listMeasurementReleases({
  frequency1:{ points:[
    { shiftPiece:100,measurementNumber:8,totalMeasurements:13 },
    { shiftPiece:14,measurementNumber:7,totalMeasurements:13 }
  ] },
  frequency2:{ points:[
    { shiftPiece:60,measurementNumber:3,totalMeasurements:5 }
  ] }
});
assert.deepEqual(releases.map(release=>release.shiftPiece),[14,60,100],'Todas as liberações devem ser preservadas e ordenadas.');
assert.deepEqual(releases.map(release=>release.frequencyLabel),['Frequência I','Frequência II','Frequência I']);

const tnl119Releases=listMeasurementReleases(calculateMeasurementPlans({
  opTarget:1112,producedSoFar:585,shiftTarget:calculateFullShiftTarget(287),frequency1:85.538
}));
assert.deepEqual(tnl119Releases.map(release=>release.shiftPiece),[14,100],'A TNL 119 deve mostrar as liberações de 14 e 100 peças no turno.');

const finishesByOp=calculateOrderForecast({
  now:'2026-08-05T14:42:00-03:00',cycleSeconds:287,opTarget:1000,producedSoFar:472,
  pieceLengthMm:11,currentBarPieces:276,feederBars:1,barLengthMm:3600,kerfMm:1
});
assert.equal(finishesByOp.reason,'op');
assert.equal(finishesByOp.opRemaining,528);
assert.equal(finishesByOp.leftoverMaterialPieces,48);
assert.equal(new Date(finishesByOp.materialEstimatedAt)-new Date(finishesByOp.estimatedAt),48*287*1000);
assert.equal(predictionMessage(finishesByOp),'Vai fechar por atingir a meta da OP.');

const stopsByMaterial=calculateOrderForecast({
  now:'2026-08-05T14:42:00-03:00',cycleSeconds:60,opTarget:1000,producedSoFar:472,
  pieceLengthMm:11,currentBarPieces:100,feederBars:1,barLengthMm:3600,kerfMm:1
});
assert.equal(stopsByMaterial.reason,'material');
assert.equal(stopsByMaterial.availablePieces,400);
assert.equal(stopsByMaterial.missingPieces,128);
assert.equal(stopsByMaterial.additionalBars,1);
assert.equal(stopsByMaterial.materialEstimatedAt,stopsByMaterial.estimatedAt);
assert.equal(predictionMessage(stopsByMaterial),'Vai fechar neste horário por falta de matéria-prima.');

const period=calculatePeriodPerformance({ availableMinutes:480,goodPieces:80,rejects:4,cycleSeconds:300 });
assert.equal(period.totalCycles,84);
assert.equal(period.runningMinutes,420);
assert.equal(period.downtimeMinutes,60);
assert.equal(period.rejectMinutes,20);
assert.equal(period.inconsistent,false);

const first=calculatePeriodPerformance({ availableMinutes:180,goodPieces:70,rejects:5,cycleSeconds:120 });
const second=calculatePeriodPerformance({ availableMinutes:300,goodPieces:85,rejects:5,cycleSeconds:180 });
assert.equal(first.runningMinutes,150);
assert.equal(first.downtimeMinutes,30);
assert.equal(second.runningMinutes,270);
assert.equal(second.downtimeMinutes,30);
const clock=calculateTurnClock([{ durationMinutes:180 },{ durationMinutes:300 }]);
assert.equal(clock.usedMinutes,480);
assert.equal(clock.remainingMinutes,0);
assert.equal(clock.consistent,true);

const inconsistent=calculatePeriodPerformance({ availableMinutes:30,goodPieces:20,rejects:0,cycleSeconds:120 });
assert.equal(inconsistent.inconsistent,true);
assert.equal(inconsistent.downtimeMinutes,0);
assert.equal(inconsistent.overrunMinutes,10);

const bounds=shiftWindow('2','2026-08-05');
assert.equal(minutesBetween(bounds.start,bounds.end),480);

const continuousPeriod=continuousMinutesBetween(
  '2026-08-05T14:30:00-03:00',
  '2026-08-05T13:25:00-03:00'
);
assert.equal(continuousPeriod,1375,'14:30 até 13:25 deve atravessar a virada e totalizar 22h55.');
const tnl091=calculatePeriodPerformance({ availableMinutes:continuousPeriod,goodPieces:100,rejects:2,cycleSeconds:324 });
assert.equal(tnl091.inconsistent,false,'O apontamento real da TNL 091 não pode ser bloqueado.');
assert.equal(Math.round(tnl091.runningMinutes),551);
assert.equal(Math.round(tnl091.downtimeMinutes),824);

const tnl092=calculatePeriodPerformance({ availableMinutes:158,goodPieces:100,rejects:0,cycleSeconds:287 });
assert.equal(tnl092.inconsistent,true,'A estimativa da TNL 092 deve continuar alertando sobre a divergência.');
assert.equal(Math.round(tnl092.runningMinutes),478);
assert.equal(Math.round(tnl092.overrunMinutes),320);

console.log('NEOMES 6.0.2: apontamento móvel, fluxo consultivo e instruções operacionais validados.');
