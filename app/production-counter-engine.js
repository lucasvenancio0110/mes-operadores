export const RUNNING_STATUS='producing';
export const PAUSED_STATUSES=Object.freeze(['stopped','setup','adjustment','maintenance']);

const finite=value=>Number.isFinite(Number(value));
const nonNegative=value=>finite(value)?Math.max(0,Number(value)):0;
const integer=value=>Math.max(0,Math.floor(nonNegative(value)));
const instant=value=>{
  if(value===null||value===undefined||value==='')return null;
  const date=value instanceof Date?value:new Date(value);
  return Number.isNaN(date.getTime())?null:date;
};

export function normalizePhysicalStatus(value){
  const status=String(value||'').trim().toLowerCase();
  if(status==='producing')return 'producing';
  if(status==='setup')return 'setup';
  if(['adjustment','adjust','ajuste'].includes(status))return 'adjustment';
  if(['maintenance','alarm','manutencao','manutenção'].includes(status))return 'maintenance';
  return 'stopped';
}

export function isCounterRunning(status){
  return normalizePhysicalStatus(status)===RUNNING_STATUS;
}

export function calculateEstimatedCounter(input={}){
  const conferenceAt=instant(input.conferenceAt);
  const now=instant(input.now||new Date());
  const cycleSeconds=nonNegative(input.cycleSeconds);
  const initialShiftPieces=integer(input.initialShiftPieces);
  const officialProduced=nonNegative(input.officialProduced);
  const currentBarPieces=integer(input.currentBarPieces);
  const feederBars=integer(input.feederBars);
  const piecesPerFullBar=integer(input.piecesPerFullBar);
  const intervals=Array.isArray(input.runningIntervals)?input.runningIntervals:[];
  const status=normalizePhysicalStatus(input.physicalStatus);

  if(!conferenceAt||!now||!(cycleSeconds>0)){
    return {
      status:'missing',estimatedShiftPieces:initialShiftPieces,estimatedOrderProduced:officialProduced,
      productiveSeconds:0,nextPieceAt:null,estimatedRemainingPieces:0,estimatedFinishAt:null,
      estimatedRemainingSeconds:0,partialCycleSeconds:0
    };
  }

  let productiveSeconds=0;
  let openIntervalStart=null;
  for(const interval of intervals){
    const start=instant(interval?.startedAt);
    const end=instant(interval?.endedAt);
    if(!start)continue;
    const effectiveEnd=end&&end<now?end:now;
    if(effectiveEnd>start)productiveSeconds+=(effectiveEnd-start)/1000;
    if(!end)openIntervalStart=start;
  }
  if(!intervals.length&&status===RUNNING_STATUS){
    productiveSeconds=Math.max(0,(now-conferenceAt)/1000);
    openIntervalStart=conferenceAt;
  }

  const completedAfterConference=Math.max(0,Math.floor(productiveSeconds/cycleSeconds));
  const partialCycleSeconds=Math.max(0,productiveSeconds%cycleSeconds);
  const estimatedShiftPieces=initialShiftPieces+completedAfterConference;
  const estimatedOrderProduced=officialProduced+completedAfterConference;
  const materialPieces=Math.max(0,currentBarPieces+feederBars*piecesPerFullBar);
  const estimatedRemainingPieces=Math.max(0,materialPieces-completedAfterConference);
  const estimatedRemainingSeconds=Math.max(0,estimatedRemainingPieces*cycleSeconds-partialCycleSeconds);

  let nextPieceAt=null;
  if(status===RUNNING_STATUS&&estimatedRemainingPieces>0){
    const secondsToNext=partialCycleSeconds===0?cycleSeconds:cycleSeconds-partialCycleSeconds;
    nextPieceAt=new Date(now.getTime()+secondsToNext*1000).toISOString();
  }

  // Durante setup/ajuste/manutenção/parada a quantidade congela, mas o ETA
  // continua avançando com o relógio. Ao retomar, o progresso parcial do ciclo é preservado.
  const estimatedFinishAt=new Date(now.getTime()+estimatedRemainingSeconds*1000).toISOString();

  return {
    status:'ready',physicalStatus:status,cycleSeconds,initialShiftPieces,officialProduced,
    completedAfterConference,estimatedShiftPieces,estimatedOrderProduced,productiveSeconds,partialCycleSeconds,
    estimatedRemainingPieces,estimatedRemainingSeconds,nextPieceAt,estimatedFinishAt
  };
}

export function auditDiff(before={},after={},fields=[]){
  const changes=[];
  for(const field of fields){
    const previous=before?.[field]??null;
    const next=after?.[field]??null;
    if(String(previous)!==String(next))changes.push({field,before:previous,after:next});
  }
  return changes;
}
