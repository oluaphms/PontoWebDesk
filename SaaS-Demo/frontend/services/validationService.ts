
import { LogType, TimeRecord, Company, GeoLocation, FraudFlag } from '../types';
import { auditNextPunchRegistration } from '../src/domain/attendance/punchSequenceAudit';

/**
 * ValidationService: Regras de negócio puras e testáveis.
 * Focado em garantir que os dados atendam aos requisitos de conformidade e segurança.
 */
export const ValidationService = {
  
  // Valida se o intervalo entre batidas é aceitável (mínimo 5 min)
  validateTimeInterval: (lastRecord: TimeRecord | undefined, currentTime: Date): { isValid: boolean; error?: string } => {
    if (!lastRecord) return { isValid: true };
    
    const diff = currentTime.getTime() - lastRecord.createdAt.getTime();
    const minInterval = 5 * 60 * 1000; // 5 minutos
    
    if (diff < minInterval) {
      return { 
        isValid: false, 
        error: `Intervalo insuficiente. Aguarde ${Math.ceil((minInterval - diff) / 60000)} minuto(s).` 
      };
    }
    return { isValid: true };
  },

  // Valida Geofencing
  validateLocation: (location: GeoLocation | undefined, company: Company): { isValid: boolean; flags: FraudFlag[] } => {
    const flags: FraudFlag[] = [];
    if (!location || !company.settings.fence) return { isValid: true, flags };

    // Cálculo Haversine integrado (simplificado aqui mas preciso para geofence)
    const distance = calculateDistance(
      location.lat, 
      location.lng, 
      company.settings.fence.lat, 
      company.settings.fence.lng
    );

    const isWithin = distance <= company.settings.fence.radius;
    if (!isWithin) flags.push(FraudFlag.LOCATION_SUSPICIOUS);
    if (location.accuracy && location.accuracy > 100) flags.push(FraudFlag.ACCURACY_LOW);

    return { isValid: isWithin, flags };
  },

  // Valida sequência — registrar sempre; sinalizar inconsistências (não bloqueia).
  validateSequence: (lastRecord: TimeRecord | undefined, newType: LogType): { isValid: boolean; error?: string; warnings?: string[] } => {
    const logical =
      newType === LogType.IN ? 'entrada' : newType === LogType.OUT ? 'saida' : 'pausa';
    const dayRecords = lastRecord
      ? [{
          id: lastRecord.id,
          type: String(lastRecord.type),
          timestamp: lastRecord.createdAt.toISOString(),
          created_at: lastRecord.createdAt.toISOString(),
        }]
      : [];
    const audit = auditNextPunchRegistration(dayRecords, logical);
    return {
      isValid: true,
      warnings: audit.warnings.map((w) => w.message),
    };
  },
};

// Helper interno para testes
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; 
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
