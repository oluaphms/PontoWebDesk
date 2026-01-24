import { describe, it, expect } from 'vitest';
import { ValidationService } from './validationService';
import { LogType, TimeRecord, Company, GeoLocation, FraudFlag } from '../types';

const baseCompany: Company = {
  id: 'c1',
  name: 'Test',
  slug: 'test',
  settings: {
    fence: { lat: -23.55, lng: -46.63, radius: 150 },
    allowManualPunch: true,
    requirePhoto: false,
    standardHours: { start: '09:00', end: '18:00' },
    delayPolicy: { toleranceMinutes: 15 },
  },
};

function record(type: LogType, createdAt: Date): TimeRecord {
  return {
    id: 'r1',
    userId: 'u1',
    companyId: 'c1',
    type,
    method: 'manual',
    createdAt,
    ipAddress: '127.0.0.1',
    deviceId: 'd1',
    deviceInfo: { browser: '', os: '', isMobile: false, userAgent: '' },
  };
}

describe('ValidationService', () => {
  describe('validateSequence', () => {
    it('first punch of day must be IN', () => {
      expect(ValidationService.validateSequence(undefined, LogType.IN)).toEqual({ isValid: true });
      expect(ValidationService.validateSequence(undefined, LogType.OUT).isValid).toBe(false);
      expect(ValidationService.validateSequence(undefined, LogType.BREAK).isValid).toBe(false);
    });

    it('cannot repeat same type', () => {
      const last = record(LogType.IN, new Date());
      expect(ValidationService.validateSequence(last, LogType.IN).isValid).toBe(false);
      expect(ValidationService.validateSequence(last, LogType.OUT).isValid).toBe(true);
      expect(ValidationService.validateSequence(last, LogType.BREAK).isValid).toBe(true);
    });

    it('allows valid progression IN -> OUT, IN -> BREAK', () => {
      const lastIn = record(LogType.IN, new Date());
      expect(ValidationService.validateSequence(lastIn, LogType.OUT)).toEqual({ isValid: true });
      expect(ValidationService.validateSequence(lastIn, LogType.BREAK)).toEqual({ isValid: true });
    });
  });

  describe('validateTimeInterval', () => {
    it('no last record is valid', () => {
      expect(ValidationService.validateTimeInterval(undefined, new Date())).toEqual({ isValid: true });
    });

    it('rejects interval < 5 min', () => {
      const now = new Date();
      const last = record(LogType.IN, new Date(now.getTime() - 2 * 60 * 1000));
      const r = ValidationService.validateTimeInterval(last, now);
      expect(r.isValid).toBe(false);
      expect(r.error).toMatch(/Intervalo insuficiente|minuto/);
    });

    it('accepts interval >= 5 min', () => {
      const now = new Date();
      const last = record(LogType.IN, new Date(now.getTime() - 6 * 60 * 1000));
      expect(ValidationService.validateTimeInterval(last, now)).toEqual({ isValid: true });
    });
  });

  describe('validateLocation', () => {
    it('no location or no fence returns valid', () => {
      expect(ValidationService.validateLocation(undefined, baseCompany)).toEqual({ isValid: true, flags: [] });
      const noFence = { ...baseCompany, settings: { ...baseCompany.settings, fence: undefined } } as Company;
      expect(ValidationService.validateLocation({ lat: 0, lng: 0 }, noFence)).toEqual({ isValid: true, flags: [] });
    });

    it('within radius is valid', () => {
      const loc: GeoLocation = { lat: -23.55, lng: -46.63, accuracy: 10 };
      const r = ValidationService.validateLocation(loc, baseCompany);
      expect(r.isValid).toBe(true);
      expect(r.flags).toHaveLength(0);
    });

    it('far from fence adds LOCATION_SUSPICIOUS', () => {
      const loc: GeoLocation = { lat: 0, lng: 0, accuracy: 5 };
      const r = ValidationService.validateLocation(loc, baseCompany);
      expect(r.isValid).toBe(false);
      expect(r.flags).toContain(FraudFlag.LOCATION_SUSPICIOUS);
    });
  });
});
