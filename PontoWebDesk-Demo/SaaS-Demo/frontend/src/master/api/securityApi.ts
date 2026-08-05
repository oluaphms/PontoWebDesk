import { masterApi } from './masterApi';

export type ComplianceStatus = 'ok' | 'partial' | 'missing' | 'optional';

export type ComplianceCheckItem = {
  id: string;
  label: string;
  status: ComplianceStatus;
  summary: string;
  evidence: string[];
  actions: string[];
};

export type SecurityCompliance = {
  generatedAt: string;
  score: { ok: number; partial: number; missing: number; optional: number; total: number };
  grade: 'A' | 'B' | 'C' | 'D';
  items: ComplianceCheckItem[];
  note: string;
};

export async function fetchSecurityCompliance(): Promise<SecurityCompliance> {
  const res = await masterApi<{ ok: boolean; compliance: SecurityCompliance }>(
    '/security/compliance',
  );
  return res.compliance;
}
