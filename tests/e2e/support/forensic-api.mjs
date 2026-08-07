export const MACHINE_ID='tnl-091';
export const LINE_ID='linha-05';
export const PRODUCTION_DATE='2026-08-07';

function json(route,payload,status=200){
  return route.fulfill({ status,contentType:'application/json',headers:{ 'Cache-Control':'no-store' },body:JSON.stringify(payload) });
}
async function bodyOf(request){
  try{return request.postDataJSON()||{};}catch{return {};}
}

export async function installForensicApi(page,{ noActiveOrder=false,contextDelay=0 }={}){
  let activeOrder=noActiveOrder?null:{
    machineId:MACHINE_ID,lineId:LINE_ID,lineName:'Linha 05',machineName:'TNL 091',
    op:'9001',item:'I-100',description:'Implante forense',opTarget:1000,cycleSeconds:60,
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
  const context=()=>({ ok:true,activeOrder,segments:[],turnClock:turnClock(),turnState:turnState(),runtimeState:runtimeState(),flowAxes:axes(),opShiftGoodPieces:0 });

  await page.route('**/api/v1/**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const path=url.pathname;
    const method=request.method();
    requests.push(`${method} ${path}`);

    if(path==='/api/v1/auth/me'&&method==='GET')return json(route,{
      user:{ id:'user-forensic',name:'Operador Forense',registration:'99001',roleCode:'operator',mustChangePassword:false,
        permissions:['machines.view','machines.assign','machines.update_status','conference.create','conference.edit','production.create','production.close_shift','reports.view'],
        lineAccess:[LINE_ID],machineAccess:[MACHINE_ID],operationalContext:{ shift:'1',productionDate:PRODUCTION_DATE,shiftMinutes:480,timeZone:'America/Sao_Paulo' } },
      expiresAt:'2026-08-07T23:00:00.000Z'
    });
    if(path==='/api/v1/catalog'&&method==='GET')return json(route,{ lines:[{ id:LINE_ID,name:'Linha 05',sortOrder:5,machines:[{ id:MACHINE_ID,name:'TNL 091',equipmentType:'TNL',sortOrder:91 }] }] });
    if(path==='/api/v1/records'&&method==='GET')return json(route,{ records:[] });
    if(path==='/api/v1/records'&&method==='POST')return json(route,{ ok:true });
    if(path==='/api/v1/assignments'&&method==='GET')return json(route,{ assignments:[{ id:'assignment-forensic',slotOrder:1,lineId:LINE_ID,machineId:MACHINE_ID }] });
    if(path==='/api/v1/assignments'&&method==='POST')return json(route,{ ok:true });
    if(path==='/api/v1/turn-assistant/context'&&method==='GET'){
      if(contextDelay)await new Promise(resolve=>setTimeout(resolve,contextDelay));
      return json(route,context());
    }
    if(path==='/api/v1/turn-assistant/handoff'&&method==='POST'){
      const body=await bodyOf(request);const now=new Date().toISOString();
      if(!activeOrder){
        activeOrder={ machineId:MACHINE_ID,lineId:LINE_ID,lineName:'Linha 05',machineName:'TNL 091',op:String(body.op),item:String(body.item),description:body.description||'',
          opTarget:Number(body.opTarget),cycleSeconds:Number(body.cycleSeconds),frequency1:Number(body.frequency1),frequency2:body.frequency2==null?null:Number(body.frequency2),pieceLengthMm:Number(body.pieceLengthMm),
          producedSoFar:Number(body.productionConfirmed||0),currentBarPieces:Number(body.currentBarPieces),feederBars:Number(body.feederBars),barLengthMm:3600,kerfMm:1,status:'active',openedAt:now,updatedAt:now };
      }else activeOrder={ ...activeOrder,producedSoFar:Number(body.productionConfirmed??activeOrder.producedSoFar),currentBarPieces:Number(body.currentBarPieces),feederBars:Number(body.feederBars),updatedAt:now };
      physicalStatus=physicalStatus==='stopped'?'producing':physicalStatus;workflowStatus='ready';confirmedAt=now;
      events.unshift({ id:`event-handoff-${events.length}`,eventType:'turn.handoff_confirmed',op:activeOrder.op,actorName:'Operador Forense',payload:{},createdAt:now,productionDate:PRODUCTION_DATE,shift:'1' });
      return json(route,{ ...context(),segmentId:'segment-1',segments:[{ id:'segment-1',segmentType:'order',status:'open',startedAt:now,op:activeOrder.op,item:activeOrder.item }],handoff:{ id:'handoff-1',confirmedAt:now } },201);
    }
    if(path==='/api/v1/machine-runtime/status'&&method==='POST'){
      const body=await bodyOf(request);const before=physicalStatus;physicalStatus=body.physicalStatus;const now=new Date().toISOString();
      const runtime={ machineId:MACHINE_ID,lineId:LINE_ID,physicalStatus,reason:body.reason||'',note:body.note||'',updatedAt:now,updatedByName:'Operador Forense',updatedByRegistration:'99001' };
      events.unshift({ id:`event-status-${events.length}`,eventType:'machine.status_changed',op:activeOrder?.op||'',actorName:'Operador Forense',payload:{ before,after:physicalStatus,note:body.note||'' },createdAt:now,productionDate:PRODUCTION_DATE,shift:'1' });
      return json(route,{ ok:true,runtimeState:runtime });
    }
    if(path==='/api/v1/machine-runtime/history'&&method==='GET')return json(route,{ ok:true,machineId:MACHINE_ID,events });
    if(path==='/api/v1/turn-assistant/close-period'&&method==='POST'){
      const body=await bodyOf(request);const good=Number(body.goodPieces||0);const rejects=Number(body.rejects||0);const stop=Number(body.stopMinutes||0);const productive=(good+rejects)*(Number(activeOrder?.cycleSeconds||60)/60);const accounted=productive+stop;
      const remainingBefore=Math.max(0,480-usedMinutes);usedMinutes+=accounted;const remainingAfter=Math.max(0,480-usedMinutes);const now=new Date().toISOString();const previous=activeOrder;
      if(activeOrder)activeOrder={ ...activeOrder,producedSoFar:Number(activeOrder.producedSoFar||0)+good,updatedAt:now };
      const orderMode=body.mode==='order';workflowStatus=body.finalShift?'shift_closed':'conference_pending';if(orderMode)activeOrder=null;
      return json(route,{ ok:true,mode:orderMode?'order':'pointing',finalShift:Boolean(body.finalShift),activeOrder,closedOrder:orderMode?{ ...previous,status:'closed',closedAt:now }:null,
        performance:{ totalCycles:good+rejects,productiveMinutes:productive,runningMinutes:productive,stopMinutes:stop,downtimeMinutes:stop,accountedMinutes:accounted,remainingBefore,remainingAfter,rejectMinutes:rejects,overrunMinutes:Math.max(0,usedMinutes-480) },
        turnState:turnState(),runtimeState:runtimeState(),flowAxes:axes(),segments:[],turnClock:turnClock(),endedAt:now });
    }
    if(path==='/api/v1/turn-assistant/stopped'&&method==='POST'){
      physicalStatus='stopped';workflowStatus='conference_pending';activeOrder=null;return json(route,{ ok:true,turnState:turnState(),runtimeState:runtimeState(),flowAxes:axes(),turnClock:turnClock() });
    }
    if(path==='/api/v1/machine-states'&&method==='GET')return json(route,{ states:[] });
    if(path==='/api/v1/events'&&method==='GET')return json(route,{ events:[] });
    if(path==='/api/v1/shift-sessions'&&method==='GET')return json(route,{ sessions:[] });
    if(path==='/api/v1/settings'&&method==='GET')return json(route,{ settings:{} });
    if(path==='/api/v1/production-counter/config'&&method==='GET')return json(route,{ config:null });
    if(path.startsWith('/api/v1/production-counter/'))return json(route,{ ok:true,state:null });
    if(method==='POST')return json(route,{ ok:true });
    return json(route,{});
  });

  return { requests,events,getActiveOrder:()=>activeOrder };
}
