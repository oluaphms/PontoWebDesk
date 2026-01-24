
import { PontoService } from './pontoService';
import { ValidationService } from './validationService';
import { LogType, TimeRecord, PunchMethod } from '../types';

export interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  error?: string;
  category: 'Unit' | 'Integration' | 'BusinessRule';
}

/**
 * TestingService: Executa simulações para garantir que regressões não ocorram.
 */
export const TestingService = {
  
  runAllTests: async (): Promise<TestResult[]> => {
    const results: TestResult[] = [];
    
    // 1. Teste de Cálculo de Horas (Unidade)
    results.push(testHourCalculation());
    
    // 2. Teste de Validação de Sequência (Regra de Negócio)
    results.push(testSequenceValidation());
    
    // 3. Teste de Intervalo Mínimo (Regra de Negócio)
    results.push(testIntervalValidation());

    // 4. Teste de Distância Geofence (Unidade)
    results.push(testDistanceCalculation());

    return results;
  }
};

function testHourCalculation(): TestResult {
  const mockRecords: any[] = [
    { type: LogType.IN, createdAt: new Date('2024-01-01T08:00:00') },
    { type: LogType.BREAK, createdAt: new Date('2024-01-01T12:00:00') },
    { type: LogType.IN, createdAt: new Date('2024-01-01T13:00:00') },
    { type: LogType.OUT, createdAt: new Date('2024-01-01T17:00:00') },
  ];
  
  // Forçamos o cálculo (Mockando o dia como 01/01/2024 internamente se necessário)
  // Como calculateDailyHours usa 'new Date().toDateString()', precisamos ajustar o mock para o dia atual para passar.
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const recordsToday = mockRecords.map(r => ({
    ...r,
    createdAt: new Date(`${todayStr}T${r.createdAt.toISOString().split('T')[1]}`)
  }));

  const result = PontoService.calculateDailyHours(recordsToday);
  const expected = "08h 00m";

  return {
    name: "Cálculo de Jornada Diária",
    category: "Unit",
    status: result === expected ? 'passed' : 'failed',
    error: result !== expected ? `Esperado ${expected}, obtido ${result}` : undefined
  };
}

function testSequenceValidation(): TestResult {
  const lastRecord: any = { type: LogType.IN, createdAt: new Date() };
  const validation = ValidationService.validateSequence(lastRecord, LogType.IN);
  
  return {
    name: "Validação de Sequência (Double IN)",
    category: "BusinessRule",
    status: validation.isValid === false ? 'passed' : 'failed',
    error: validation.isValid === true ? "Deveria ter bloqueado Entrada consecutiva" : undefined
  };
}

function testIntervalValidation(): TestResult {
  const lastRecord: any = { type: LogType.IN, createdAt: new Date(Date.now() - 2 * 60 * 1000) }; // 2 min atrás
  const validation = ValidationService.validateTimeInterval(lastRecord, new Date());
  
  return {
    name: "Validação de Intervalo Mínimo (5min)",
    category: "BusinessRule",
    status: validation.isValid === false ? 'passed' : 'failed',
    error: validation.isValid === true ? "Deveria ter bloqueado intervalo < 5min" : undefined
  };
}

function testDistanceCalculation(): TestResult {
  // Teste usando ValidationService.validateLocation que internamente calcula distância
  const lat1 = -23.5614, lng1 = -46.6559; // MASP SP
  const lat2 = -23.5615, lng2 = -46.6560; // Muito perto (cerca de 15-20 metros)
  
  const mockCompany = {
    id: 'test',
    name: 'Test',
    slug: 'test',
    settings: {
      fence: { lat: lat1, lng: lng1, radius: 150 },
      allowManualPunch: true,
      requirePhoto: false,
      standardHours: { start: '09:00', end: '18:00' },
      delayPolicy: { toleranceMinutes: 15 }
    }
  };
  
  const validation = ValidationService.validateLocation(
    { lat: lat2, lng: lng2, accuracy: 10 },
    mockCompany as any
  );
  
  // Se a validação passou, significa que está dentro do raio (distância < 150m)
  // Como os pontos estão muito próximos (~15-20m), deve passar
  const passed = validation.isValid && validation.flags.length === 0;

  return {
    name: "Cálculo de Distância Geodesica",
    category: "Unit",
    status: passed ? 'passed' : 'failed',
    error: !passed ? `Validação de localização falhou. Flags: ${validation.flags.join(', ')}` : undefined
  };
}
