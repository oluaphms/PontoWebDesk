import { LogType, PunchMethod } from '../types';

interface OfflinePunchPayload {
  id: string;
  userId: string;
  companyId: string;
  type: LogType;
  method: PunchMethod;
  data: {
    photo?: string;
    justification?: string;
    location?: any;
  };
  createdAt: string;
}

const STORAGE_KEY = 'smartponto_offline_queue';

const loadQueue = (): OfflinePunchPayload[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as OfflinePunchPayload[];
  } catch (err) {
    console.warn('[offlinePunchService] Falha ao ler fila offline:', err);
    return [];
  }
};

const saveQueue = (queue: OfflinePunchPayload[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.warn('[offlinePunchService] Falha ao salvar fila offline:', err);
  }
};

export const OfflinePunchService = {
  enqueue(
    userId: string,
    companyId: string,
    type: LogType,
    method: PunchMethod,
    data: { photo?: string; justification?: string; location?: any }
  ) {
    const queue = loadQueue();
    const payload: OfflinePunchPayload = {
      id: crypto.randomUUID(),
      userId,
      companyId,
      type,
      method,
      data,
      createdAt: new Date().toISOString(),
    };
    queue.push(payload);
    saveQueue(queue);
  },

  getQueue(): OfflinePunchPayload[] {
    return loadQueue();
  },

  clearQueue() {
    saveQueue([]);
  },

  removeByIds(ids: string[]) {
    if (!ids.length) return;
    const queue = loadQueue();
    const filtered = queue.filter(item => !ids.includes(item.id));
    saveQueue(filtered);
  },
};

