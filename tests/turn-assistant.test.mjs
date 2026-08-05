import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  calculateMaterial,calculateOrderForecast,calculatePeriodPerformance,
  calculateTurnClock,predictionMessage,shiftWindow,minutesBetween
} from '../app/turn-assistant-engine.js';
import { bindAssistantSubmit,formControlValue,isAssistantForm } from '../app/turn-assistant-submit.js';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const submitBridgePath=fileURLToPath(new URL('app/turn-assistant-submit.js',root));
const assistantPath=fileURLToPath(new URL('app/turn-assistant.js',root));
execFileSync(process.execPath,['--check',submitBridgePath],{ stdio:'pipe' });
execFileSync(process.execPath,['--check',assistantPath],{ stdio:'pipe' });
const [submitBridge,assistant,index,serviceWorker]=await Promise.all([
  read('app/turn-assistant-submit.js'),
  read('app/turn-assistant.js'),
  read('index.html'),
  read('sw.js')
]);

assert(submitBridge.includes('onSubmit(form,button)'),'A ponte de toque não chama a rotina real de envio.');
assert(!submitBridge.includes('SubmitEvent'),'A ponte não deve sintetizar eventos de submit.');
assert(!submitBridge.includes('form.dispatchEvent'),'A ponte não deve reenviar eventos artificialmente.');
assert(assistant.includes("bindAssistantSubmit(document,submitAssistantForm)"),'A ponte móvel não está conectada ao assistente.');
assert(assistant.includes("post('/api/v1/turn-assistant/handoff',body)"),'Persistência da passagem de turno não está conectada.');
assert(assistant.includes("formControlValue(form,'item')"),'O campo Item não usa leitura segura para Safari.');
assert(!assistant.includes('form.elements.item.value'),'A colisão com HTMLFormControlsCollection.item ainda existe.');
assert(assistant.includes('A matéria-prima consegue produzir até'),'Autonomia do material após a meta ausente.');
assert(!assistant.includes('Ação necessária: adicionar'),'A recomendação inviável de adicionar barra ainda está visível.');
assert(!assistant.includes('Faltarão cerca de'),'A quantidade faltante ainda está visível.');
for(const formId of ['taHandoffForm','taFirstOrderForm','taShiftCloseForm','taOrderCloseForm','taNewOrderForm','taStoppedForm']) {
  assert(assistant.includes(`data-ta-submit-form="${formId}"`),`Envio direto ausente em ${formId}.`);
}
assert(index.includes('turn-assistant.js?v=5.0.4'),'Assistente 5.0.4 não está carregado no HTML.');
assert(!index.includes('turn-assistant-submit-fix'),'Hotfix sintético antigo ainda está carregado no HTML.');
assert(serviceWorker.includes("'./app/turn-assistant-submit.js'"),'Ponte de envio não está no cache do PWA.');
assert(!serviceWorker.includes('turn-assistant-submit-fix'),'Hotfix sintético antigo ainda está no cache do PWA.');
assert(serviceWorker.includes('v5.0.4-turn-assistant-submit'),'Versão do cache móvel não foi renovada.');

const safariItemInput={ value:'317396' };
const safariForm={
  elements:{
    item(){ return null; },
    namedItem(name){ return name==='item' ? safariItemInput : null; }
  }
};
assert.equal(formControlValue(safariForm,'item'),'317396','Safari deve ler o campo Item sem colidir com elements.item().');

const listeners=new Map();
const firstOrderForm={ id:'taFirstOrderForm' };
const fakeRoot={
  addEventListener(type,listener,capture){ assert.equal(capture,true);listeners.set(type,listener); },
  removeEventListener(type,listener,capture){ assert.equal(capture,true);assert.equal(listeners.get(type),listener);listeners.delete(type); },
  getElementById(id){ return id===firstOrderForm.id ? firstOrderForm : null; }
};
let submitted=0;
const button={
  disabled:false,
  dataset:{ taSubmitForm:firstOrderForm.id },
  closest(selector){ return selector==='[data-ta-submit-form]' ? this : null; }
};
let prevented=0;let stopped=0;
const unbind=bindAssistantSubmit(fakeRoot,(form,submitter)=>{
  assert.equal(form,firstOrderForm);assert.equal(submitter,button);submitted+=1;submitter.disabled=true;
});
const click={ target:button,preventDefault(){prevented+=1;},stopImmediatePropagation(){stopped+=1;} };
listeners.get('click')(click);
listeners.get('click')(click);
assert.equal(submitted,1,'Um toque deve iniciar exatamente um salvamento.');
assert.equal(prevented,1);
assert.equal(stopped,1);
assert.equal(isAssistantForm(firstOrderForm),true);
assert.equal(isAssistantForm({ id:'outroForm' }),false);
unbind();
assert.equal(listeners.has('click'),false);

const material=calculateMaterial({ pieceLengthMm:11,currentBarPieces:276,feederBars:1,barLengthMm:3600,kerfMm:1 });
assert.equal(material.piecesPerFullBar,300);
assert.equal(material.availablePieces,576);

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

console.log('NEOMES 5.0.4: fechamento por material ou meta e autonomia total validados.');
