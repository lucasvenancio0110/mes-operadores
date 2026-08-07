import assert from 'node:assert/strict';
import { calculateMeasurementPlans } from '../app/measurement-engine.js';
import {
  DEFAULT_SHIFT_MINUTES,parseCycleInput,calculateFullShiftTarget,calculateMaterial,listMeasurementReleases,
  calculateOrderForecast,calculatePointingAccounting,operatorCardState,shiftWindow,predictionMessage
} from '../app/turn-assistant-engine.js';
import { bindAssistantSubmit,isAssistantForm,formControlValue } from '../app/turn-assistant-submit.js';
import { readFileSync } from 'node:fs';
const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const operatorMain=readFileSync(new URL('../app/operator-main.js',import.meta.url),'utf8');
const assistantSource=readFileSync(new URL('../app/turn-assistant.js',import.meta.url),'utf8');
const submitSource=readFileSync(new URL('../app/turn-assistant-submit.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/turn-assistant.css',import.meta.url),'utf8');
const worker=readFileSync(new URL('../worker/turn-assistant.js',import.meta.url),'utf8');
const secureMain=readFileSync(new URL('../worker/secure-main.js',import.meta.url),'utf8');
const operatorTest=readFileSync(new URL('./operator-flow-v6.test.mjs',import.meta.url),'utf8');

assert(index.includes('app/turn-assistant.js?v=6.0.1'),'index deve carregar o assistente 6.0.1.');
assert(index.includes('app/turn-assistant-autostart.js?v=6.0.0'),'index deve carregar autostart do assistente.');
assert(index.includes('app/turn-assistant.css?v=6.0.0'),'index deve carregar CSS do assistente.');
assert(!index.includes('production-counter.js'),'contador não pode participar do frontend operacional.');
assert(!index.includes('production-counter.css'),'contador não pode participar do frontend operacional.');
assert(operatorMain.includes("if (event.__NEOMES_ASSISTANT_HANDLED) return;"),'operator-main deve respeitar ownership do evento do assistente.');
assert(assistantSource.includes('function claimAssistantEvent(event)'),'assistente deve possuir eventos sem matar a propagação.');
assert(!assistantSource.includes('stopImmediatePropagation('),'assistente não pode matar propagação global de clique.');
assert(!submitSource.includes('stopImmediatePropagation('),'ponte móvel não pode matar propagação global de clique.');
assert(submitSource.includes('event.__NEOMES_ASSISTANT_HANDLED = true'),'ponte móvel deve marcar ownership cooperativo.');
assert(css.includes('.ta-layer{z-index:1200}'),'assistente precisa permanecer acima do painel somente quando modal está aberto.');
assert(worker.includes("'/api/v1/turn-assistant/context'"),'worker deve expor contexto do assistente.');
assert(secureMain.includes('handleTurnAssistant'),'secure-main deve rotear assistente.');
assert(operatorTest.includes('close-period'),'fluxo operador deve validar apontamento/fechamento.');

assert.equal(DEFAULT_SHIFT_MINUTES,480);
assert.equal(parseCycleInput('4:47'),287);
assert.equal(parseCycleInput('5,24'),324);
assert.equal(parseCycleInput('60'),60);

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
assert.equal(prevented,1,'A ponte deve impedir apenas o comportamento padrão do botão que possui.');
assert.equal(stopped,0,'A ponte não pode interromper listeners globais/target com stopImmediatePropagation.');
assert.equal(click.__NEOMES_ASSISTANT_HANDLED,true,'O evento deve ser marcado como pertencente ao assistente.');
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
  producedSoFar:14800,opTarget:18000,frequency1:200,frequency2:100,
  shiftTarget:100,availablePieces:576,limit:12
});
assert(releases.length>0);
assert.equal(releases[0].type,'II');
assert.equal(releases[0].opProduction,14900);
assert.equal(releases[0].piecesFromNow,100);

const releasesRounded=listMeasurementReleases({
  producedSoFar:14900,opTarget:18000,frequency1:333.333,frequency2:166.667,
  shiftTarget:100,availablePieces:576,limit:12
});
assert(releasesRounded.length>0,'frequência decimal arredondada deve gerar liberações.');
assert(releasesRounded.every(release=>Number.isInteger(release.opProduction)),'liberação deve cair em peça inteira.');

const forecast=calculateOrderForecast({
  producedSoFar:14800,opTarget:18000,cycleSeconds:287,pieceLengthMm:11,
  currentBarPieces:276,feederBars:1,shiftMinutes:480,now:new Date('2026-08-07T10:00:00-03:00')
});
assert.equal(forecast.shiftTarget,100);
assert.equal(forecast.availablePieces,576);
assert.equal(forecast.reason,'material');
assert.equal(forecast.piecesUntilClosure,576);
assert.equal(predictionMessage(forecast).includes('matéria-prima'),true);

const opForecast=calculateOrderForecast({
  producedSoFar:17950,opTarget:18000,cycleSeconds:60,pieceLengthMm:11,
  currentBarPieces:276,feederBars:1,shiftMinutes:480,now:new Date('2026-08-07T10:00:00-03:00')
});
assert.equal(opForecast.reason,'op');
assert.equal(opForecast.piecesUntilClosure,50);
assert.equal(predictionMessage(opForecast).includes('meta da OP'),true);

const accounting=calculatePointingAccounting({ totalMinutes:480,usedMinutes:120,goodPieces:50,rejects:2,stopMinutes:30,cycleSeconds:60 });
assert.equal(accounting.productiveMinutes,52);
assert.equal(accounting.accountedMinutes,82);
assert.equal(accounting.remainingAfter,278);

const over=calculatePointingAccounting({ totalMinutes:480,usedMinutes:450,goodPieces:100,rejects:0,stopMinutes:0,cycleSeconds:60 });
assert.equal(over.remainingAfter,0);
assert.equal(over.overrunMinutes,70);
assert.equal(over.advisory,true,'apontamento acima do saldo deve ser consultivo, não bloqueante.');

assert.equal(operatorCardState({ workflowStatus:'conference_pending',opStatus:'active',physicalStatus:'producing' }),'conference');
assert.equal(operatorCardState({ workflowStatus:'ready',opStatus:'active',physicalStatus:'producing' }),'ready');
assert.equal(operatorCardState({ workflowStatus:'shift_closed',opStatus:'active',physicalStatus:'producing' }),'pointed');
assert.equal(operatorCardState({ workflowStatus:'ready',opStatus:'closed',physicalStatus:'stopped' }),'closed');
assert.equal(operatorCardState({ workflowStatus:'ready',opStatus:'active',physicalStatus:'stopped' }),'stopped');

const shift=shiftWindow({ productionDate:'2026-08-07',shift:'2',now:new Date('2026-08-07T17:00:00-03:00') });
assert.equal(Math.round((shift.end-shift.start)/60000),480);

const plan=calculateMeasurementPlans({
  produced:14800,opTarget:18000,target:100,frequency1:200,frequency2:100,expectedTotal:14900
});
assert(plan.opPlan.releases.length>=1);
assert(plan.shiftPlan.releases.length>=1);

assert.equal(formControlValue({ elements:{ namedItem(name){ return name==='item' ? { value:'ITEM-123' } : null; } } },'item'),'ITEM-123');
assert.equal(formControlValue({ querySelector(selector){ return selector==='[name="item"]' ? { value:'ITEM-SAFARI' } : null; } },'item'),'ITEM-SAFARI');

console.log('Turn assistant checks passed.');
