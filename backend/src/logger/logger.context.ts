import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './logger.types.js';

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, cb: () => T): T {
  return requestStorage.run(ctx, cb);
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

export function updateRequestContext(next: Partial<RequestContext>): void {
  const current = requestStorage.getStore();
  if (!current) return;
  if (typeof next.userId !== 'undefined') current.userId = next.userId;
  if (typeof next.companyId !== 'undefined') current.companyId = next.companyId;
}
