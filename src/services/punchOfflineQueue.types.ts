import type { RegisterPunchSecureParams } from '../rep/repEngine';
import type { SavePunchEvidenceParams } from './punchEvidenceService';

export type QueuedWebPunch = {
  id: string;
  params: RegisterPunchSecureParams;
  evidence?: Omit<SavePunchEvidenceParams, 'timeRecordId'> | null;
  createdAt: number;
  status: 'pending' | 'sent' | 'error';
  error?: string;
};
