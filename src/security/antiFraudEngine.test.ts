import { describe, expect, it } from 'vitest';
import {
  FRAUD_FLAGS,
  calculateFraudScore,
  detectAnomaly,
  generateDeviceFingerprint,
  validateDevice,
} from './antiFraudEngine';

describe('antiFraudEngine', () => {
  it('gera deviceId estável entre chamadas no mesmo navegador', () => {
    const a = generateDeviceFingerprint();
    const b = generateDeviceFingerprint();
    expect(a.deviceId).toBeTruthy();
    expect(a.deviceId).toBe(b.deviceId);
  });

  it('reconhece dispositivo confiável quando deviceId está na whitelist', () => {
    const fp = generateDeviceFingerprint();
    const out = validateDevice(fp, [fp.deviceId]);
    expect(out.valid).toBe(true);
    expect(out.trusted).toBe(true);
    expect(out.flag).toBeUndefined();
  });

  it('detecta anomalia em horário atípico com baixa precisão e sem device id', () => {
    const out = detectAnomaly({
      employeeId: 'e1',
      companyId: 'c1',
      type: 'entrada',
      timestamp: new Date('2026-04-24T02:10:00'),
      location: { latitude: -23.5, longitude: -46.6, accuracy: 1500 },
      deviceId: null,
    });
    expect(out.isAnomaly).toBe(true);
    expect(out.flag).toBe(FRAUD_FLAGS.BEHAVIOR_ANOMALY);
    expect((out.reasons || []).length).toBeGreaterThan(0);
  });

  it('calcula score de fraude limitado em 100', () => {
    const score = calculateFraudScore([
      FRAUD_FLAGS.FACE_MISMATCH,
      FRAUD_FLAGS.DEVICE_UNKNOWN,
      FRAUD_FLAGS.LOCATION_VIOLATION,
      FRAUD_FLAGS.BEHAVIOR_ANOMALY,
    ]);
    expect(score).toBe(100);
  });
});
