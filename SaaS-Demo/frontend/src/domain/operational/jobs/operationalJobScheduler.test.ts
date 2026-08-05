import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runOperationalJob, listOperationalJobs, getOperationalJobHealth } from './operationalJobScheduler';

describe('operationalJobScheduler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('lista jobs registrados e saúde', () => {
    const jobs = listOperationalJobs();
    expect(jobs.length).toBeGreaterThan(0);
    const h = getOperationalJobHealth();
    expect(h.jobs_registered).toBe(jobs.length);
  });

  it('executa purge_old_metrics sem contexto Supabase', async () => {
    const r = await runOperationalJob('purge_old_metrics', {});
    expect(r.ok).toBe(true);
  });
});
