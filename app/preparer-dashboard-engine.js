import { calculateMeasurementPlans } from './measurement-engine.js';
import { calculateFullShiftTarget, listMeasurementReleases } from './turn-assistant-engine.js';

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function calculatePreparerMetrics(machine = {}) {
  const order = machine.activeOrder;
  const remainingMinutes = Math.max(0,number(machine.turnClock?.remainingMinutes));
  if (!order) return { remainingMinutes,turnTarget:0,shiftTarget:0,releases:[] };

  const opRemaining = Math.max(0,number(machine.forecast?.opRemaining));
  const availablePieces = Math.max(0,number(machine.forecast?.availablePieces));
  const turnTarget = calculateFullShiftTarget(order.cycleSeconds,remainingMinutes);
  const shiftTarget = Math.max(0,Math.min(turnTarget,opRemaining,availablePieces));
  const plans = calculateMeasurementPlans({
    opTarget:order.opTarget,
    producedSoFar:order.producedSoFar,
    shiftTarget,
    frequency1:order.frequency1,
    frequency2:order.frequency2
  });
  const alreadyProduced = Math.max(0,number(machine.turnState?.goodPieces));
  const releases = listMeasurementReleases(plans).map((release,index) => ({
    ...release,
    sequence:index + 1,
    turnPiece:alreadyProduced + release.shiftPiece
  }));
  return { remainingMinutes,turnTarget,shiftTarget,releases };
}

export function preparerMachineState(machine = {}) {
  const physical = machine.flowAxes?.physicalStatus || machine.runtimeState?.physicalStatus || 'stopped';
  const order = machine.flowAxes?.opStatus || (machine.activeOrder ? 'active' : 'none');
  const workflow = machine.flowAxes?.workflowStatus || 'conference_pending';
  if (physical === 'maintenance') return { code:'maintenance',label:'Em manutenção',tone:'critical' };
  if (physical === 'stopped') return { code:'stopped',label:'Máquina parada',tone:'critical' };
  if (physical === 'setup') return { code:'setup',label:'Setup em andamento',tone:'attention' };
  if (order !== 'active') return { code:'no-order',label:'Sem OP ativa',tone:'neutral' };
  if (workflow === 'conference_pending') return { code:'conference-pending',label:'Conferência pendente',tone:'attention' };
  if (workflow === 'shift_closed') return { code:'shift-closed',label:'Turno encerrado',tone:'neutral' };
  return { code:'producing',label:'Produzindo',tone:'success' };
}

export function closureCopy(machine = {}) {
  const forecast = machine.forecast || {};
  if (!machine.activeOrder || !forecast.estimatedAt) {
    return { reason:'none',primary:'Sem previsão enquanto não houver OP ativa.',secondary:'' };
  }
  if (forecast.reason === 'material') {
    return {
      reason:'material',
      primary:'Vai fechar neste horário por falta de matéria-prima.',
      secondary:''
    };
  }
  return {
    reason:'op',
    primary:'Vai fechar neste horário por atingir a meta da OP.',
    secondary:forecast.materialEstimatedAt ? 'A matéria-prima consegue produzir até este horário.' : ''
  };
}
