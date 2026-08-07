import { test,expect } from '@playwright/test';

const MACHINE_ID='tnl-091';
const LINE_ID='linha-05';
const PRODUCTION_DATE='2026-08-07';

function json(route,payload,status=200){
  return route.fulfill({ status,contentType:'application/json',headers:{ 'Cache-Control':'no-store' },body:JSON.stringify(payload) });
}

async function bodyOf(request){
  try{return request.postDataJSON()||{};}catch{return {};}
}

async function installApi(page,{ noActiveOrder=false }={}){
  let activeOrder=noActiveOrder?null:{
    machineId:MACHINE_ID,lineId:LINE_ID,lineName:'Linha 05',machineName:'TNL 091',
    op:'9001',item:'I-100',description:'Implante de teste',opTarget:1000,cycleSeconds:60,
    frequency1:100,frequency2:50,pieceLengthMm:10,producedSoFar:100,currentBarPieces:20,feederBars:2,
    barLengthMm:3600,kerfMm:1,status:'active',openedAt:'2026-08-07T09:00:00.000Z',updatedAt:'2026-08-07T10:00:00.000Z'
  };
  let physicalStatus=activeOrder?'producing':'stopped';
  let workflowStatus='conference_pending';
  let usedMinutes=0;
  let confirmedAt=null;
  const events=[];
  const requests=[];

  const turnClock=()=>({ totalMinutes:480,usedMinutes,remainingMinutes:Math.max(0,480-usedMinutes),overrunMinutes:Math.max(0,usedMinutes-480) });
  const runtimeState=()=>({ machineId:MACHINE_ID,lineId:LINE_ID,physicalStatus,reason:'',note:'',updatedAt:new Date().toISOString() });
  const turnState=()=>({ productionDate:PRODUCTION_DATE,shift:'1',machineId:MACHINE_ID,lineId:LINE_ID,workflowStatus,accountedMinutes:usedMinutes,goodPieces:0,rejects:0,stopMinutes:0,lastConferenceAt:confirmedAt,lastPointingAt:null,updatedAt:new Date().toISOString() });
  const axes=()=>({ physicalStatus,opStatus:activeOrder?'active':'none',workflowStatus });
  const context=()=>({
    ok:true,activeOrder,segments:confirmedAt&&activeOrder?[{ id:'segment-1',segmentType:'order',status:'open',startedAt:confirmedAt,op:activeOrder.op,item:activeOrder.item }]:[],
    turnClock:turnClock(),turnState:turnState(),runtimeState:runtimeState(),flowAxes:axes(),opShiftGoodPieces:0
  });

  await page.route('**/api/v1/**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const path=url.pathname;
    const method=request.method();
    requests.push(`${method} ${path}`);

    if(path==='/api/v1/auth/me'&&method==='GET')return json(route,{
      user:{
        id:'user-e2e',name:'Operador E2E',registration:'99001',roleCode:'operator',mustChangePassword:false,
        permissions:['machines.view','machines.assign','machines.update_status','conference.create','conference.edit','production.create','production.close_shift','reports.view'],
        lineAccess:[LINE_ID],machineAccess:[MACHINE_ID],
        operationalContext:{ shift:'1',productionDate:PRODUCTION_DATE,shiftMinutes:480,timeZone:'America/Sao_Paulo' }
      },
      expiresAt:'2026-08-07T23:00:00.000Z'
    });
    if(path==='/api/v1/catalog'&&method==='GET')return json(route,{ lines:[{ id:LINE_ID,name:'Linha 05',sortOrder:5,machines:[{ id:MACHINE_ID,name:'TNL 091',equipmentType:'TNL',sortOrder:91 }] }] });
    if(path==='/api/v1/records'&&method==='GET')return json(route,{ records:[] });
    if(path==='/api/v1/records'&&method==='POST')return json(route,{ ok:true });
    if(path==='/api/v1/assignments'&&method==='GET')return json(route,{ assignments:[{ id:'assignment-e2e',slotOrder:1,lineId:LINE_ID,machineId:MACHINE_ID }] });
    if(path==='/api/v1/assignments'&&method==='POST')return json(route,{ ok:true });
    if(path==='/api/v1/turn-assistant/context'&&method==='GET')return json(route,context());

    if(path==='/api/v1/turn-assistant/handoff'&&method==='POST'){
      const body=await bodyOf(request);
      const now=new Date().toISOString();
      if(!activeOrder){
        activeOrder={
          machineId:MACHINE_ID,lineId:LINE_ID,lineName:'Linha 05',machineName:'TNL 091',op:String(body.op),item:String(body.item),description:body.description||'',
          opTarget:Number(body.opTarget),cycleSeconds:Number(body.cycleSeconds),frequency1:Number(body.frequency1),frequency2:body.frequency2==null?null:Number(body.frequency2),
          pieceLengthMm:Number(body.pieceLengthMm),producedSoFar:Number(body.productionConfirmed||0),currentBarPieces:Number(body.currentBarPieces),feederBars:Number(body.feederBars),
          barLengthMm:3600,kerfMm:1,status:'active',openedAt:now,updatedAt:now
        };
      }else{
        activeOrder={ ...activeOrder,producedSoFar:Number(body.productionConfirmed??activeOrder.producedSoFar),currentBarPieces:Number(body.currentBarPieces),feederBars:Number(body.feederBars),updatedAt:now };
      }
      physicalStatus=physicalStatus==='stopped'?'producing':physicalStatus;
      workflowStatus='ready';confirmedAt=now;
      events.unshift({ id:`event-handoff-${events.length}`,eventType:'turn.handoff_confirmed',op:activeOrder.op,actorName:'Operador E2E',payload:{},createdAt:now,productionDate:PRODUCTION_DATE,shift:'1' });
      return json(route,{ ...context(),segmentId:'segment-1',handoff:{ id:'handoff-1',confirmedAt:now } },201);
    }

    if(path==='/api/v1/machine-runtime/status'&&method==='POST'){
      const body=await bodyOf(request);
      const before=physicalStatus;physicalStatus=body.physicalStatus;
      const now=new Date().toISOString();
      const runtime={ machineId:MACHINE_ID,lineId:LINE_ID,physicalStatus,reason:body.reason||'',note:body.note||'',updatedAt:now,updatedByName:'Operador E2E',updatedByRegistration:'99001' };
      events.unshift({ id:`event-status-${events.length}`,eventType:'machine.status_changed',op:activeOrder?.op||'',actorName:'Operador E2E',payload:{ before,after:physicalStatus,note:body.note||'' },createdAt:now,productionDate:PRODUCTION_DATE,shift:'1' });
      return json(route,{ ok:true,runtimeState:runtime });
    }
    if(path==='/api/v1/machine-runtime/history'&&method==='GET')return json(route,{ ok:true,machineId:MACHINE_ID,events });

    if(path==='/api/v1/turn-assistant/close-period'&&method==='POST'){
      const body=await bodyOf(request);
      const good=Number(body.goodPieces||0);const rejects=Number(body.rejects||0);const stop=Number(body.stopMinutes||0);
      const productive=(good+rejects)*(Number(activeOrder?.cycleSeconds||60)/60);
      const accounted=productive+stop;
      const remainingBefore=Math.max(0,480-usedMinutes);usedMinutes+=accounted;
      const remainingAfter=Math.max(0,480-usedMinutes);
      const now=new Date().toISOString();
      const previous=activeOrder;
      if(activeOrder)activeOrder={ ...activeOrder,producedSoFar:Number(activeOrder.producedSoFar||0)+good,updatedAt:now };
      const orderMode=body.mode==='order';
      workflowStatus=body.finalShift?'shift_closed':'conference_pending';
      if(orderMode)activeOrder=null;
      events.unshift({ id:`event-close-${events.length}`,eventType:orderMode?'order.closed':'production.pointed',op:previous?.op||'',actorName:'Operador E2E',payload:{ goodPieces:good,rejects,stopMinutes:stop },createdAt:now,productionDate:PRODUCTION_DATE,shift:'1' });
      return json(route,{
        ok:true,mode:orderMode?'order':'pointing',finalShift:Boolean(body.finalShift),activeOrder,
        closedOrder:orderMode?{ ...previous,producedSoFar:Number(previous?.producedSoFar||0)+good,status:'closed',closedAt:now }:null,
        performance:{ totalCycles:good+rejects,productiveMinutes:productive,runningMinutes:productive,stopMinutes:stop,downtimeMinutes:stop,accountedMinutes:accounted,remainingBefore,remainingAfter,rejectMinutes:rejects,overrunMinutes:Math.max(0,usedMinutes-480) },
        turnState:turnState(),runtimeState:runtimeState(),flowAxes:axes(),segments:[],turnClock:turnClock(),endedAt:now
      });
    }

    if(path==='/api/v1/turn-assistant/stopped'&&method==='POST'){
      const body=await bodyOf(request);physicalStatus='stopped';workflowStatus='conference_pending';activeOrder=null;
      const now=new Date().toISOString();
      events.unshift({ id:`event-stop-${events.length}`,eventType:'machine.stopped',op:'',actorName:'Operador E2E',payload:{ reason:body.reason,note:body.note },createdAt:now,productionDate:PRODUCTION_DATE,shift:'1' });
      return json(route,{ ok:true,turnState:turnState(),runtimeState:runtimeState(),flowAxes:axes(),turnClock:turnClock() });
    }

    if(path==='/api/v1/turn-assistant/start-order'&&method==='POST')return json(route,{ error:'not used by this scenario' },400);
    if(path==='/api/v1/machine-states'&&method==='GET')return json(route,{ states:[] });
    if(path==='/api/v1/events'&&method==='GET')return json(route,{ events:[] });
    if(path==='/api/v1/shift-sessions'&&method==='GET')return json(route,{ sessions:[] });
    if(path==='/api/v1/settings'&&method==='GET')return json(route,{ settings:{} });
    if(method==='POST')return json(route,{ ok:true });
    return json(route,{});
  });

  return { requests,events,getActiveOrder:()=>activeOrder };
}

async function waitForOperatorCard(page){
  await expect(page.getByText('TNL 091',{ exact:true }).first()).toBeVisible();
  await expect(page.locator('.ops-machine-card').first()).toBeVisible();
}

async function expectReadyForTurn(page){
  await expect(page.getByText('Pronta para o turno',{ exact:true })).toBeVisible();
}

async function confirmMachine(page){
  await page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first().click();
  const form=page.locator('#taHandoffForm');
  await expect(form).toBeVisible();
  await form.locator('[name="currentBarPieces"]').fill('20');
  await form.locator('[name="feederBars"]').fill('2');
  await page.locator('[data-ta-submit-form="taHandoffForm"]').click();
  await expectReadyForTurn(page);
  await page.locator('[data-ta-close]').click();
  await expect(page.locator('[data-ta-point]')).toBeVisible();
}

test('boot operacional não depende de um módulo visual opcional',async({ page })=>{
  await installApi(page);
  await page.route('**/app/factory-map-workspace.js*',route=>route.abort('failed'));
  await page.goto('/');
  await waitForOperatorCard(page);
  await expect(page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first()).toBeVisible();
});

test('fluxo completo do operador funciona por consequência real no WebKit mobile',async({ page })=>{
  const pageErrors=[];const counterRequests=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>{ if(request.url().includes('production-counter'))counterRequests.push(request.url()); });
  const backend=await installApi(page);

  await page.goto('/');
  await waitForOperatorCard(page);
  await confirmMachine(page);

  await expect(page.locator('.ta-release')).toContainText('LIBERA');
  await expect(page.locator('.ta-forecast')).toContainText('FECHAMENTO PREVISTO');
  await expect(page.locator('.ta-forecast')).toContainText('falta de matéria-prima');
  await expect(page.locator('.ta-compact-facts')).toContainText('Meta do turno');
  await expect(page.locator('.ta-material-line')).toContainText('Peças por barra');

  const statuses=[
    ['producing','Produzindo',''],['setup','Setup',''],['adjustment','Ajuste',''],
    ['maintenance','Manutenção','Manutenção programada'],['stopped','Parada','Aguardando liberação'],['producing','Produzindo','']
  ];
  for(const [value,label,note] of statuses){
    await expect(page.locator('[data-runtime-open]')).toBeVisible();
    await page.locator('[data-runtime-open]').click();
    const layer=page.locator('[data-machine-runtime-layer]');
    await layer.locator(`[data-runtime-choice="${value}"]`).click();
    if(note)await layer.locator('[data-runtime-note]').fill(note);
    await layer.locator('[data-runtime-save]').click();
    await expect(page.locator('[data-runtime-tools] strong')).toHaveText(label);
    await expect(page.locator('.ops-machine-card')).toContainText('OP 9001');
    expect(backend.getActiveOrder()?.op).toBe('9001');
  }

  await page.locator('[data-runtime-history-open]').click();
  await expect(page.locator('[data-runtime-history]')).toContainText('Situação da máquina alterada');
  await expect(page.locator('[data-runtime-history]')).toContainText('Operador E2E');
  await page.locator('[data-runtime-close]').click();

  await page.locator('[data-ta-update]').click();
  await expect(page.locator('#taHandoffForm')).toBeVisible();
  await page.locator('#taHandoffForm [name="feederBars"]').fill('3');
  await page.locator('[data-ta-submit-form="taHandoffForm"]').click();
  await expectReadyForTurn(page);
  await page.locator('[data-ta-close]').click();
  await expect(page.locator('.ta-material-line')).toContainText('3 barras');

  await page.locator('[data-ta-point]').click();
  await expect(page.locator('#taPointingForm')).toBeVisible();
  await page.locator('[data-ta-good]').fill('40');
  await page.locator('[data-ta-reject-plus]').click();
  await expect(page.locator('[data-ta-rejects]')).toHaveValue('1');
  await page.locator('[data-ta-stops]').fill('10');
  await page.locator('#taPointingForm [data-ta-reason="adjustment"]').click();
  await expect(page.locator('.ta-time-preview')).toContainText('Saldo depois');
  await page.locator('[data-ta-submit-form="taPointingForm"]').click();
  await expect(page.locator('.ops-machine-card')).toContainText('CONFERÊNCIA PENDENTE');
  await expect(page.locator('[data-ta-reconfirm]')).toBeVisible();

  await page.locator('[data-ta-reconfirm]').click();
  await page.locator('#taHandoffForm [name="currentBarPieces"]').fill('12');
  await page.locator('#taHandoffForm [name="feederBars"]').fill('2');
  await page.locator('[data-ta-submit-form="taHandoffForm"]').click();
  await expectReadyForTurn(page);
  await page.locator('[data-ta-close]').click();

  await page.locator('[data-ta-close-order]').click();
  await expect(page.locator('#taOrderCloseForm')).toBeVisible();
  await page.locator('#taOrderCloseForm [data-ta-good]').fill('20');
  await page.locator('#taOrderCloseForm [data-ta-rejects]').fill('0');
  await page.locator('#taOrderCloseForm [data-ta-stops]').fill('0');
  await page.locator('[data-ta-submit-form="taOrderCloseForm"]').click();
  await expect(page.getByText('Nova OP do mesmo item')).toBeVisible();
  await expect(page.getByText('Máquina ficará parada')).toBeVisible();
  await page.locator('[data-ta-next-order="stopped"]').click();
  await page.locator('[data-ta-stop-reason="no-schedule"]').click();
  await page.locator('[data-ta-submit-form="taStoppedForm"]').click();
  await expect(page.locator('.ops-machine-card')).toContainText('PARADA');
  await expect(page.locator('[data-ta-reconfirm]')).toContainText('Cadastrar nova OP');

  expect(counterRequests).toEqual([]);
  expect(backend.requests.some(value=>value==='POST /api/v1/turn-assistant/handoff')).toBeTruthy();
  expect(backend.requests.some(value=>value==='POST /api/v1/machine-runtime/status')).toBeTruthy();
  expect(backend.requests.some(value=>value==='POST /api/v1/turn-assistant/close-period')).toBeTruthy();
  expect(pageErrors).toEqual([]);
});

test('primeiro cadastro de OP usa o campo item corretamente no WebKit',async({ page })=>{
  await installApi(page,{ noActiveOrder:true });
  await page.goto('/');
  await waitForOperatorCard(page);
  await page.locator('[data-action="open-conference"],[data-ta-reconfirm]').first().click();
  const form=page.locator('#taFirstOrderForm');
  await expect(form).toBeVisible();
  await form.locator('[name="op"]').fill('9100');
  await form.locator('[name="item"]').fill('ITEM-WEBKIT');
  await form.locator('[name="opTarget"]').fill('500');
  await form.locator('[name="cycle"]').fill('1:00');
  await form.locator('[name="frequency1"]').fill('100');
  await form.locator('[name="frequency2"]').fill('50');
  await form.locator('[name="pieceLengthMm"]').fill('10');
  await form.locator('[name="productionConfirmed"]').fill('0');
  await form.locator('[name="currentBarPieces"]').fill('10');
  await form.locator('[name="feederBars"]').fill('1');
  await page.locator('[data-ta-submit-form="taFirstOrderForm"]').click();
  await expectReadyForTurn(page);
});
