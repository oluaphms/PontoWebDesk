import { observabilityConsole } from '../../../src/shared/logger/observabilityConsole';
type LogCtx = {
  provider: string;
  op: string;
  deviceId?: string;
  deviceIp?: string;
  durationMs: number;
  payload?: unknown;
  response?: unknown;
};

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const kl = k.toLowerCase();
    if (
      kl.includes('password') ||
      kl.includes('senha') ||
      kl === 'rep_password' ||
      kl === 'session' ||
      kl === 'authorization'
    ) {
      out[k] = '[redacted]';
    } else {
      out[k] = redactDeep(v, depth + 1) as unknown;
    }
  }
  return out;
}

/** Log estruturado para auditoria e debug (sem credenciais). */
export function logTimeClockOp(ctx: LogCtx): void {
  try {
    observabilityConsole.info(
      '[TimeClock]',
      JSON.stringify({
        provider: ctx.provider,
        op: ctx.op,
        deviceId: ctx.deviceId,
        deviceIp: ctx.deviceIp,
        durationMs: ctx.durationMs,
        payload: ctx.payload != null ? redactDeep(ctx.payload) : undefined,
        response: ctx.response != null ? redactDeep(ctx.response) : undefined,
      })
    );
  } catch {
    observabilityConsole.info('[TimeClock]', ctx.provider, ctx.op, ctx.durationMs, 'ms');
  }
}
