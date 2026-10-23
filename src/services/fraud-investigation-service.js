import { fraudInvestigationRepository } from '../repositories/fraud-investigation-repository.js';
import { fraudIntelligenceService } from './fraud-intelligence-service.js';
import { HttpError } from '../middleware/errors.js';

const transitions={NEW:new Set(['UNDER_REVIEW','ESCALATED']),UNDER_REVIEW:new Set(['ESCALATED','CLOSED_NO_FRAUD','CONFIRMED_FRAUD']),ESCALATED:new Set(['UNDER_REVIEW','CLOSED_NO_FRAUD','CONFIRMED_FRAUD']),CLOSED_NO_FRAUD:new Set(['UNDER_REVIEW']),CONFIRMED_FRAUD:new Set(['UNDER_REVIEW'])};
export const fraudInvestigationService={async update(alertId,input,actor,scope){
  const allowed=new Set(['NEW','UNDER_REVIEW','ESCALATED','CLOSED_NO_FRAUD','CONFIRMED_FRAUD']);
  if(input.status&&!allowed.has(input.status))throw new HttpError(400,'Invalid investigation status','VALIDATION_ERROR');
  if(input.assignedTo!==undefined&&input.assignedTo!==null&&(typeof input.assignedTo!=='string'||input.assignedTo.length>120))throw new HttpError(400,'assignedTo must be a string under 120 characters','VALIDATION_ERROR');
  if(input.decisionNote!==undefined&&(typeof input.decisionNote!=='string'||input.decisionNote.length>2000))throw new HttpError(400,'decisionNote must be under 2000 characters','VALIDATION_ERROR');
  const alert=await fraudIntelligenceService.getAlert(alertId,scope),existing=(await fraudInvestigationRepository.list()).find(x=>x.alertId===alertId),current=existing?.status||'NEW';
  if(input.status&&input.status!==current&&!transitions[current]?.has(input.status))throw new HttpError(409,`Cannot change investigation from ${current} to ${input.status}`,'INVALID_TRANSITION');
  if(['CLOSED_NO_FRAUD','CONFIRMED_FRAUD'].includes(input.status)&&!input.decisionNote?.trim())throw new HttpError(400,'A decision note is required to close an investigation','DECISION_NOTE_REQUIRED');
  return fraudInvestigationRepository.update(alert,input,actor);
}};
