import { TimeClockError } from '../errors/TimeClockError';
import type { DeviceConfig, TimeClockProviderKey } from '../interfaces/TimeClockProvider';
import { logTimeClockOp } from '../utils/timeClockLogger';

export function logPlaceholderOp(vendor: TimeClockProviderKey, op: string, config: DeviceConfig): void {
  logTimeClockOp({
    provider: vendor,
    op,
    deviceId: config.id,
    deviceIp: config.ip ?? undefined,
    durationMs: 0,
    payload: { ip: config.ip, port: config.port, providerType: config.providerType },
    response: { note: 'placeholder — integração real será plugada com documentação oficial' },
  });
}

export function notImplemented(vendor: TimeClockProviderKey, op: string): never {
  throw new TimeClockError(
    `${vendor}: ${op} não implementado — aguardando documentação oficial ou captura de requisições reais.`,
    'NOT_IMPLEMENTED',
    undefined,
    undefined,
    vendor
  );
}
