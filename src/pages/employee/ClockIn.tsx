import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, MapPin, LogIn, LogOut, Coffee, Fingerprint, Clock, CheckCircle2, Shield } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, storage, isSupabaseConfigured } from '../../services/supabaseClient';
import { getDayRecords, validatePunchSequence } from '../../services/timeProcessingService';
import {
  getCurrentLocationResult,
  geolocationReasonMessage,
  type GeoPosition,
  type GeolocationFailureReason,
} from '../../services/locationService';
import {
  validatePunch,
  generateDeviceFingerprint,
  type AllowedLocation,
  type DeviceFingerprint,
} from '../../security/antiFraudEngine';
import { detectBehaviorAnomaly } from '../../ai/anomalyDetection';
import { registerPunchSecure } from '../../rep/repEngine';
import { savePunchEvidence, createFraudAlertsForFlags } from '../../services/punchEvidenceService';
import { getCompanyLocations, isWithinAllowedLocation } from '../../services/settingsService';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../components/ToastProvider';
import { LogType, PunchMethod } from '../../../types';
import { LoadingState } from '../../../components/UI';

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      resolve();
      return;
    }
    let tid: number;
    const onMeta = () => {
      video.removeEventListener('loadedmetadata', onMeta);
      window.clearTimeout(tid);
      if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
      else reject(new Error('dimensões'));
    };
    video.addEventListener('loadedmetadata', onMeta);
    tid = window.setTimeout(() => {
      video.removeEventListener('loadedmetadata', onMeta);
      if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
      else reject(new Error('timeout'));
    }, 12000);
  });
}

/** Normaliza tipo vindo do banco para comparação com a UI */
function normalizeLastType(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase();
  if (lower === 'saída' || lower === 'saida') return 'saída';
  if (lower === 'entrada') return 'entrada';
  if (lower === 'pausa') return 'pausa';
  return lower;
}

const EmployeeClockIn: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { settings: globalSettings } = useSettings();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Último tipo de batida **do dia atual** (entrada | saída | pausa) */
  const [lastType, setLastType] = useState<string | null>(null);
  const [lastRecordAt, setLastRecordAt] = useState<string | null>(null);
  const [useDigital, setUseDigital] = useState(false);
  /** Modal de comprovação (GPS + câmera / digital) */
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [pendingLogType, setPendingLogType] = useState<LogType | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [geo, setGeo] = useState<GeoPosition | null>(null);
  const [gpsFailReason, setGpsFailReason] = useState<GeolocationFailureReason | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [hadBiometric, setHadBiometric] = useState(false);
  const [digitalFallbackToPhoto, setDigitalFallbackToPhoto] = useState(false);
  const [webAuthnBusy, setWebAuthnBusy] = useState(false);
  const modalVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadTodayState = useCallback(async () => {
    if (!user || !isSupabaseConfigured) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dayRecords = await getDayRecords(user.id, today);
      if (!dayRecords.length) {
        setLastType(null);
        setLastRecordAt(null);
        return;
      }
      const last = dayRecords[dayRecords.length - 1];
      setLastType(normalizeLastType(last.type));
      setLastRecordAt(last.timestamp || last.created_at || null);
    } catch {
      setLastType(null);
      setLastRecordAt(null);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadTodayState();
  }, [loadTodayState]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadTodayState();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadTodayState]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (modalVideoRef.current) modalVideoRef.current.srcObject = null;
  }, []);

  const startCameraPreview = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.addToast('error', 'Este navegador não permite acesso à câmera.');
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost') {
      toast.addToast('error', 'Câmera e GPS costumam exigir HTTPS (exceto em localhost).');
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const video = modalVideoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
    } catch {
      toast.addToast('error', 'Permita o acesso à câmera nas configurações do navegador.');
    }
  }, [stopCamera, toast]);

  const captureFrameFromModal = async (): Promise<string | null> => {
    const video = modalVideoRef.current;
    if (!video || !streamRef.current) return null;
    try {
      await waitForVideoReady(video);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || video.videoWidth < 2) return null;
      ctx.drawImage(video, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      return null;
    }
  };

  const closeProofModal = useCallback(() => {
    stopCamera();
    setProofModalOpen(false);
    setPendingLogType(null);
    setGeo(null);
    setGpsFailReason(null);
    setPhotoDataUrl(null);
    setHadBiometric(false);
    setDigitalFallbackToPhoto(false);
    setGpsLoading(false);
    setWebAuthnBusy(false);
  }, [stopCamera]);

  const retryGps = useCallback(async () => {
    setGpsLoading(true);
    setGpsFailReason(null);
    const r = await getCurrentLocationResult();
    setGpsLoading(false);
    if (r.ok === false) {
      setGeo(null);
      setGpsFailReason(r.reason);
      return;
    }
    setGeo(r.position);
    setGpsFailReason(null);
  }, []);

  useEffect(() => {
    if (!proofModalOpen) return;
    let cancelled = false;
    (async () => {
      setGpsLoading(true);
      setGpsFailReason(null);
      setGeo(null);
      const r = await getCurrentLocationResult();
      if (cancelled) return;
      setGpsLoading(false);
      if (r.ok === false) {
        setGeo(null);
        setGpsFailReason(r.reason);
        return;
      }
      setGeo(r.position);
      setGpsFailReason(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [proofModalOpen]);

  const needsCameraPreview =
    proofModalOpen &&
    (globalSettings?.photo_required === true || !useDigital || (useDigital && digitalFallbackToPhoto));

  useEffect(() => {
    if (!needsCameraPreview) {
      if (!proofModalOpen) stopCamera();
      return;
    }
    void startCameraPreview();
    return () => {
      stopCamera();
    };
  }, [needsCameraPreview, proofModalOpen, startCameraPreview, stopCamera]);

  const tryWebAuthn = async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'preferred',
        },
      });
      return true;
    } catch {
      return false;
    }
  };

  const uploadPhoto = async (dataUrl: string): Promise<string | null> => {
    if (!storage || !user) return null;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `punch-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const path = `${user.id}/${Date.now()}-${file.name}`;
      await storage.upload('photos', path, file);
      return storage.getPublicUrl('photos', path);
    } catch {
      return null;
    }
  };

  const resolveMethod = (
    hadBiometric: boolean,
    photoUrl: string | null,
    geo: { latitude: number; longitude: number; accuracy?: number } | null
  ): PunchMethod => {
    if (hadBiometric) return PunchMethod.BIOMETRIC;
    if (photoUrl) return PunchMethod.PHOTO;
    if (geo?.latitude != null && geo?.longitude != null) return PunchMethod.GPS;
    return PunchMethod.MANUAL;
  };

  const executePunchRegistration = async (
    type: LogType,
    geoPos: GeoPosition | null,
    localPhotoDataUrl: string | null,
    biometricOk: boolean
  ) => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const fingerprint: DeviceFingerprint = generateDeviceFingerprint();

      const today = new Date().toISOString().slice(0, 10);
      const dayRecords = await getDayRecords(user.id, today);
      const typeStr = type === LogType.IN ? 'entrada' : type === LogType.OUT ? 'saída' : 'pausa';
      const validation = validatePunchSequence(dayRecords, typeStr);
      if (!validation.valid) {
        setError(validation.error || 'Sequência inválida.');
        toast.addToast('error', validation.error || 'Sequência inválida.');
        return;
      }

      if (globalSettings?.gps_required) {
        if (!geoPos?.latitude || !geoPos?.longitude) {
          setError('O registro de ponto exige localização. Ative o GPS e tente novamente.');
          toast.addToast('error', 'Ative o GPS para registrar o ponto.');
          return;
        }
        const locations = await getCompanyLocations(user.companyId);
        if (locations.length > 0 && !isWithinAllowedLocation(geoPos.latitude, geoPos.longitude, locations)) {
          setError('Você não está dentro da área permitida para registrar ponto.');
          toast.addToast('error', 'Fora da área permitida.');
          return;
        }
      }

      let photoUrl: string | null = null;
      if (localPhotoDataUrl) {
        photoUrl = await uploadPhoto(localPhotoDataUrl);
        if (!photoUrl) {
          setError('Não foi possível enviar a foto. Verifique o bucket de armazenamento ou tente novamente.');
          toast.addToast('error', 'Falha ao enviar a foto.');
          return;
        }
      }

      const method = resolveMethod(biometricOk, photoUrl, geoPos);

      let allowedLocations: AllowedLocation[] = [];
      let trustedDeviceIds: string[] = [];
      let history: any[] = [];
      try {
        const [locRows, devRows, histRows] = await Promise.all([
          db.select('work_locations', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('trusted_devices', [{ column: 'employee_id', operator: 'eq', value: user.id }]) as Promise<any[]>,
          db.select('time_records', [{ column: 'user_id', operator: 'eq', value: user.id }], { column: 'created_at', ascending: false }, 50) as Promise<any[]>,
        ]);
        allowedLocations = (locRows ?? []).map((r) => ({
          id: r.id,
          company_id: r.company_id,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          radius: r.radius ?? 200,
        }));
        trustedDeviceIds = (devRows ?? []).map((d) => d.device_id).filter(Boolean);
        history = (histRows ?? []).map((r) => ({
          type: r.type,
          timestamp: r.timestamp || r.created_at,
          latitude: r.latitude,
          longitude: r.longitude,
          device_id: r.device_id,
          created_at: r.created_at,
        }));
      } catch {
        // continua sem zonas/dispositivos confiáveis
      }

      const now = new Date();
      const anomaly = detectBehaviorAnomaly({
        employeeId: user.id,
        companyId: user.companyId,
        type: typeStr,
        timestamp: now,
        latitude: geoPos?.latitude,
        longitude: geoPos?.longitude,
        deviceId: fingerprint.deviceId,
        history,
      });

      const validationResult = validatePunch({
        employeeId: user.id,
        companyId: user.companyId,
        type: typeStr,
        location: geoPos ? { latitude: geoPos.latitude, longitude: geoPos.longitude, accuracy: geoPos.accuracy } : undefined,
        deviceFingerprint: fingerprint,
        allowedLocations,
        trustedDeviceIds,
        behaviorAnomaly: anomaly.behaviorAnomaly,
      });

      const recordId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `rec-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      const result = await registerPunchSecure({
        userId: user.id,
        companyId: user.companyId,
        type: typeStr,
        method,
        recordId,
        location: geoPos ? { lat: geoPos.latitude, lng: geoPos.longitude, accuracy: geoPos.accuracy } : undefined,
        photoUrl: photoUrl || undefined,
        source: 'web',
        latitude: geoPos?.latitude ?? null,
        longitude: geoPos?.longitude ?? null,
        accuracy: geoPos?.accuracy ?? null,
        deviceId: fingerprint.deviceId,
        deviceType: 'web',
        ipAddress: null,
        fraudScore: validationResult.fraudScore,
        fraudFlags: validationResult.fraudFlags.length ? validationResult.fraudFlags : null,
      });

      await savePunchEvidence({
        timeRecordId: result.id,
        photoUrl: photoUrl || null,
        locationLat: geoPos?.latitude ?? null,
        locationLng: geoPos?.longitude ?? null,
        deviceId: fingerprint.deviceId,
        fraudScore: validationResult.fraudScore,
      });

      if (validationResult.fraudFlags.length > 0) {
        await createFraudAlertsForFlags(user.id, result.id, validationResult.fraudFlags);
      }

      await loadTodayState();
      const label =
        typeStr === 'entrada'
          ? 'Entrada'
          : typeStr === 'saída'
            ? 'Saída'
            : typeStr === 'pausa'
              ? 'Intervalo'
              : typeStr;
      toast.addToast('success', `${label} registrada com sucesso.`);
      closeProofModal();
    } catch (e: any) {
      const msg = e?.message || 'Erro ao registrar ponto';
      setError(msg);
      toast.addToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmProof = async () => {
    if (!user || pendingLogType == null) return;
    if (globalSettings?.gps_required && (!geo?.latitude || !geo?.longitude)) {
      toast.addToast('error', 'É necessário obter a localização antes de registrar.');
      return;
    }
    if (globalSettings?.photo_required && !photoDataUrl) {
      toast.addToast('error', 'Capture a foto obrigatória antes de registrar.');
      return;
    }
    await executePunchRegistration(pendingLogType, geo, photoDataUrl, hadBiometric);
  };

  const handleTryWebAuthnInModal = async () => {
    setWebAuthnBusy(true);
    try {
      const ok = await tryWebAuthn();
      setHadBiometric(ok);
      if (ok) {
        toast.addToast('success', 'Dispositivo validado.');
      } else {
        setDigitalFallbackToPhoto(true);
        toast.addToast(
          'info',
          'A biometria WebAuthn completa exige cadastro no servidor. Use a foto abaixo ou continue só com GPS, se permitido.'
        );
      }
    } finally {
      setWebAuthnBusy(false);
    }
  };

  const handleCapturePhotoClick = async () => {
    const dataUrl = await captureFrameFromModal();
    if (!dataUrl) {
      toast.addToast('error', 'Não foi possível capturar a imagem. Aguarde a câmera iniciar e tente de novo.');
      return;
    }
    setPhotoDataUrl(dataUrl);
    toast.addToast('success', 'Foto capturada.');
  };

  const beginPunch = async (type: LogType) => {
    if (!user) return;
    if (!isSupabaseConfigured) {
      setError('Sistema de ponto indisponível. Tente mais tarde.');
      toast.addToast('error', 'Sistema de ponto indisponível.');
      return;
    }
    if (!user.companyId || String(user.companyId).trim() === '') {
      setError('Seu cadastro está incompleto (empresa não vinculada). Entre em contato com o administrador.');
      toast.addToast('error', 'Cadastro sem empresa vinculada.');
      return;
    }
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const dayRecords = await getDayRecords(user.id, today);
    const typeStr = type === LogType.IN ? 'entrada' : type === LogType.OUT ? 'saída' : 'pausa';
    const validation = validatePunchSequence(dayRecords, typeStr);
    if (!validation.valid) {
      setError(validation.error || 'Sequência inválida.');
      toast.addToast('error', validation.error || 'Sequência inválida.');
      return;
    }
    setPendingLogType(type);
    setGeo(null);
    setGpsFailReason(null);
    setPhotoDataUrl(null);
    setHadBiometric(false);
    setDigitalFallbackToPhoto(false);
    setProofModalOpen(true);
  };

  const handlePunch = (type: LogType) => {
    void beginPunch(type);
  };

  /** Em jornada: última batida do dia foi entrada (trabalhando ou após retorno de intervalo) */
  const isIn = lastType === 'entrada';
  /** Em intervalo: última batida foi início de pausa */
  const isBreak = lastType === 'pausa';

  if (loading || !user) return <LoadingState message="Carregando..." />;

  const buttonBase =
    'flex flex-col items-center justify-center gap-4 p-8 rounded-2xl border-2 min-h-[44px] touch-manipulation cursor-pointer select-none transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';

  const lastLabel =
    lastType === 'entrada'
      ? 'Entrada'
      : lastType === 'saída'
        ? 'Saída'
        : lastType === 'pausa'
          ? 'Intervalo (em pausa)'
          : null;

  return (
    <div className="space-y-8 relative z-10">
      <PageHeader
        title="Registrar Ponto"
        subtitle="Marcações do dia com validação de sequência, GPS e comprovação (foto ou digital)."
        icon={<Clock className="w-5 h-5" />}
      />

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {user && (!user.companyId || String(user.companyId).trim() === '') && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-sm">
          Seu cadastro está sem empresa vinculada. Os botões de ponto só funcionarão após o administrador corrigir isso.
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Shield className="w-4 h-4 text-indigo-500 shrink-0" />
          <span>
            <strong>Hoje:</strong>{' '}
            {lastLabel ? (
              <>
                última batida — <strong>{lastLabel}</strong>
                {lastRecordAt && (
                  <span className="text-slate-500 dark:text-slate-400">
                    {' '}
                    às{' '}
                    {new Date(lastRecordAt).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                )}
              </>
            ) : (
              'nenhuma batida ainda'
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
          {globalSettings?.gps_required && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200">
              <MapPin className="w-3 h-3" /> GPS obrigatório
            </span>
          )}
          {globalSettings?.photo_required && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-800 dark:text-sky-200">
              <Camera className="w-3 h-3" /> Foto obrigatória
            </span>
          )}
          {globalSettings && !globalSettings.gps_required && !globalSettings.photo_required && (
            <span className="text-slate-500">Comprovação opcional (foto ou digital conforme seleção abaixo).</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Escolha como deseja comprovar o registro (usado ao tocar nos botões de Entrada, Saída ou Intervalo).
        </p>
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-100 dark:bg-slate-800/50">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Método:</span>
          <button
            type="button"
            role="radio"
            aria-checked={!useDigital}
            aria-label="Usar foto para comprovar o ponto"
            disabled={!!globalSettings?.photo_required}
            onClick={() => setUseDigital(false)}
            onTouchEnd={(e) => e.currentTarget.blur()}
            className={`flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-medium border-2 touch-manipulation cursor-pointer select-none transition-colors ${
              globalSettings?.photo_required
                ? 'opacity-60 cursor-not-allowed border-slate-200 dark:border-slate-700'
                : !useDigital
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-400/50 ring-offset-2 dark:ring-offset-slate-900'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Camera className="w-4 h-4 shrink-0" /> Foto
            {!useDigital && <span className="text-xs font-normal opacity-90">(selecionado)</span>}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={useDigital}
            aria-label="Usar impressão digital WebAuthn para comprovar o ponto"
            disabled={!!globalSettings?.photo_required}
            onClick={() => setUseDigital(true)}
            onTouchEnd={(e) => e.currentTarget.blur()}
            className={`flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-medium border-2 touch-manipulation cursor-pointer select-none transition-colors ${
              globalSettings?.photo_required
                ? 'opacity-60 cursor-not-allowed border-slate-200 dark:border-slate-700'
                : useDigital
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-400/50 ring-offset-2 dark:ring-offset-slate-900'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Fingerprint className="w-4 h-4 shrink-0" /> Digital (WebAuthn)
            {useDigital && <span className="text-xs font-normal opacity-90">(selecionado)</span>}
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-500 ml-1">
            {globalSettings?.photo_required ? 'Política da empresa exige foto.' : 'Se não suportado, usa foto ou GPS.'}
          </span>
        </div>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        <strong>Sequência do dia:</strong> Entrada → (opcional) Início do intervalo (pausa) → Entrada (retorno) → Saída. Após pausa, use <strong>Registrar Entrada</strong> para voltar ou o atalho &quot;Finalizar intervalo&quot; abaixo.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <button
          type="button"
          disabled={saving || isIn}
          title={isIn ? 'Você já está em jornada (última batida: entrada). Use Saída ou Intervalo.' : saving ? 'Registrando...' : 'Primeira entrada do dia ou retorno de intervalo'}
          onClick={() => handlePunch(LogType.IN)}
          className={`${buttonBase} border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30`}
        >
          <LogIn className="w-16 h-16 shrink-0" />
          <span className="text-xl font-bold">Registrar Entrada</span>
          {isBreak && <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400">Retorno do intervalo</span>}
        </button>
        <button
          type="button"
          disabled={saving || !isIn}
          title={!isIn ? 'Registre uma entrada antes' : saving ? 'Registrando...' : 'Encerrar a jornada'}
          onClick={() => handlePunch(LogType.OUT)}
          className={`${buttonBase} border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30`}
        >
          <LogOut className="w-16 h-16 shrink-0" />
          <span className="text-xl font-bold">Registrar Saída</span>
        </button>
        <button
          type="button"
          disabled={saving || !isIn || isBreak}
          title={!isIn ? 'Registre uma entrada antes' : isBreak ? 'Você já está em intervalo' : saving ? 'Registrando...' : 'Início do intervalo (pausa)'}
          onClick={() => handlePunch(LogType.BREAK)}
          className={`${buttonBase} border-amber-500 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30`}
        >
          <Coffee className="w-16 h-16 shrink-0" />
          <span className="text-xl font-bold">Iniciar Intervalo</span>
        </button>
        <button
          type="button"
          disabled={saving || !isBreak}
          title={!isBreak ? 'Inicie um intervalo antes' : saving ? 'Registrando...' : 'Registra retorno (entrada) após o intervalo'}
          onClick={() => handlePunch(LogType.IN)}
          className={`${buttonBase} border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/30`}
        >
          <CheckCircle2 className="w-16 h-16 shrink-0" />
          <span className="text-xl font-bold">Finalizar intervalo</span>
          <span className="text-xs font-normal text-sky-600 dark:text-sky-400 text-center px-2">Registra entrada (retorno)</span>
        </button>
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
        <MapPin className="w-4 h-4 shrink-0" /> GPS quando disponível; comprovação por {globalSettings?.photo_required ? 'foto (obrigatória)' : useDigital ? 'WebAuthn ou foto' : 'foto opcional'}.
      </p>

      {proofModalOpen && pendingLogType != null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => !saving && closeProofModal()}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="proof-modal-title"
            className="relative z-[101] w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-5 md:p-6 space-y-5"
          >
            <h2 id="proof-modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Comprovar registro de ponto
            </h2>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
                Localização (GPS)
              </div>
              {typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Em HTTP (sem HTTPS), o navegador pode bloquear GPS e câmera. Use HTTPS em produção ou teste em localhost.
                </p>
              )}
              {gpsLoading && <p className="text-sm text-slate-600 dark:text-slate-400">Obtendo localização…</p>}
              {!gpsLoading && geo && (
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  Posição obtida (precisão ~{Math.round(geo.accuracy)} m).
                </p>
              )}
              {!gpsLoading && gpsFailReason && (
                <p className="text-sm text-red-700 dark:text-red-300">{geolocationReasonMessage(gpsFailReason)}</p>
              )}
              <button
                type="button"
                disabled={gpsLoading || saving}
                onClick={() => void retryGps()}
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
              >
                Tentar localização novamente
              </button>
            </div>

            {useDigital && !globalSettings?.photo_required && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <Fingerprint className="w-4 h-4 text-indigo-500 shrink-0" />
                  Comprovação digital (WebAuthn)
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  A validação biométrica completa depende de cadastro no servidor (FIDO2). Aqui você pode tentar o leitor do sistema; se não funcionar, use a foto abaixo ou registre só com GPS.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || webAuthnBusy || hadBiometric}
                    onClick={() => void handleTryWebAuthnInModal()}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 min-h-[44px]"
                  >
                    {webAuthnBusy ? 'Aguardando…' : hadBiometric ? 'Dispositivo validado' : 'Tentar no dispositivo'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setDigitalFallbackToPhoto(true)}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium min-h-[44px]"
                  >
                    Usar foto
                  </button>
                </div>
              </div>
            )}

            {needsCameraPreview && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <Camera className="w-4 h-4 text-sky-500 shrink-0" />
                  {globalSettings?.photo_required ? 'Foto obrigatória' : 'Foto (opcional)'}
                </div>
                <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-black">
                  <video ref={modalVideoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleCapturePhotoClick()}
                    className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium min-h-[44px]"
                  >
                    Capturar foto
                  </button>
                  {photoDataUrl && !globalSettings?.photo_required && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setPhotoDataUrl(null)}
                      className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm min-h-[44px]"
                    >
                      Remover foto
                    </button>
                  )}
                </div>
                {photoDataUrl && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">Foto pronta para envio.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                disabled={saving}
                onClick={() => closeProofModal()}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium min-h-[44px]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  gpsLoading ||
                  (globalSettings?.gps_required === true && (!geo?.latitude || !geo?.longitude)) ||
                  (globalSettings?.photo_required === true && !photoDataUrl)
                }
                onClick={() => void handleConfirmProof()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium disabled:opacity-50 min-h-[44px]"
              >
                {saving ? 'Registrando…' : 'Confirmar e registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeClockIn;
