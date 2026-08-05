import { create } from 'zustand';
import { getDepartments } from '../services/department.service';
import { getJobTitles } from '../services/role.service';
import { getEstruturas } from '../services/estrutura.service';

export type CatalogDepartment = { id: string; name: string };
export type CatalogJobTitle = { id: string; name: string };
export type CatalogEstrutura = { id: string; codigo: string; descricao: string };

type CompanyCatalog = {
  departments: CatalogDepartment[];
  jobTitles: CatalogJobTitle[];
  estruturas: CatalogEstrutura[];
};

type CatalogState = {
  byCompany: Record<string, CompanyCatalog | undefined>;
  inflight: Record<string, Promise<void> | undefined>;
  ensureCatalog: (companyId: string) => Promise<void>;
  getCatalog: (companyId: string) => CompanyCatalog;
  clearCompany: (companyId: string) => void;
};

const emptyCatalog = (): CompanyCatalog => ({
  departments: [],
  jobTitles: [],
  estruturas: [],
});

export const useCatalogStore = create<CatalogState>((set, get) => ({
  byCompany: {},
  inflight: {},
  getCatalog: (companyId) => get().byCompany[companyId] ?? emptyCatalog(),
  clearCompany: (companyId) =>
    set((s) => {
      const next = { ...s.byCompany };
      delete next[companyId];
      return { byCompany: next };
    }),
  ensureCatalog: async (companyId: string) => {
    if (!companyId) return;
    if (get().byCompany[companyId]) return;
    const running = get().inflight[companyId];
    if (running) {
      await running;
      return;
    }

    const task = (async () => {
      const [deps, jobs, est] = await Promise.all([
        getDepartments(companyId),
        getJobTitles(companyId),
        getEstruturas(companyId),
      ]);
      const departments = (deps as any[]).map((d: any) => ({ id: d.id, name: String(d.name || '') }));
      const jobTitles = (jobs as any[]).map((j: any) => ({ id: j.id, name: String(j.name || '') }));
      const estruturas = (est as any[]).map((e: any) => ({
        id: e.id,
        codigo: String(e.codigo || ''),
        descricao: String(e.descricao || e.codigo || ''),
      }));
      set((s) => ({
        byCompany: {
          ...s.byCompany,
          [companyId]: { departments, jobTitles, estruturas },
        },
        inflight: { ...s.inflight, [companyId]: undefined },
      }));
    })();

    set((s) => ({ inflight: { ...s.inflight, [companyId]: task } }));
    await task;
  },
}));
