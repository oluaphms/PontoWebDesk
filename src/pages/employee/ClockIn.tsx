import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Camera,
  MapPin,
  ScanLine,
  Clock,
  Shield,
  Keyboard,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, storage, isSupabaseConfigured } from '../../services/supabaseClient';
import { getDayRecords, getLocalDateString, validatePunchSequence } from '../../services/timeProcessingService';
import {
  getCurrentLocationResult,
  geolocationReasonMessage,
  geolocationActionHint,
  queryGeolocationPermission,
  logGeolocationDebug,
  watchGeoPosition,
  type GeoPosition,
  type GeolocationFailureReason,
  type GeoPermissionState,
} from '../../services/locationService';
import { uploadPunchPhotoWithRetry, validatePunchImageDataUrl } from '../../utils/punchPhotoUpload';
import {
  validatePunch,
  generateDeviceFingerprint,
  type AllowedLocation,
  type DeviceFingerprint,
} from '../../security/antiFraudEngine';
import { detectBehaviorAnomaly } from '../../ai/anomalyDetection';
import { PUNCH_SOURCE_WEB } from '../../constants/punchSource';
import { registerPunchSecure, normalizePunchRegistrationError } from '../../rep/repEngine';
import { savePunchEvidence, createFraudAlertsForFlags } from '../../services/punchEvidenceService';
import { getCompanyLocations, isWithinAllowedLocation } from '../../services/settingsService';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../components/ToastProvider';
import { LogType, PunchMethod } from '../../../types';
import { LoadingState } from '../../../components/UI';
import { queryClient } from '../../lib/queryClient';
import { invalidateAfterPunch } from '../../services/queryCache';
import {
  hasStoredPasskey,
  isWebAuthnSupported,
  registerPlatformPasskey,
  verifyPlatformPasskey,
} from '../../services/webAuthnPunchService';

const LocationMap = React.lazy(() => import('../../../components/LocationMap'));
/** Comprovação explícita: foto, biometria ou registro manual (quando a política permitir). */
type VerificationMode = 'photo' | 'digital' | 'manual';

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

/** Normaliza tipo vindo do banco para comparação com a UI (entrada | saída | pausa) */
function normalizeLastType(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().replace(/\s/g, '_');
  if (lower === 'saída' || lower === 'saida') return 'saída';
  if (lower === 'entrada' || lower === 'fim_intervalo') return 'entrada';
  if (lower === 'pausa' || lower === 'inicio_intervalo') return 'pausa';
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
  const [verificationMode, setVerificationMode] = useState<VerificationMode>('photo');
  /** Cartão cujos botões de batida estão visíveis (null = só ícones de comprovação) */
  const [expandedPunchMode, setExpandedPunchMode] = useState<VerificationMode | null>(null);
  /** Feedback de GPS para o usuário */
  const [geoLiveStatus, setGeoLiveStatus] = useState<'idle' | 'obtaining' | 'captured' | 'failed'>('idle');
  /** Modal de comprovação (GPS + câmera / digital) */
  const [proofModalOpen, setProofModalOpen] = useState(false);
  const [pendingLogType, setPendingLogType] = useState<LogType | null>(null);
  /** Texto da batida escolhida no grid (ex.: "Registrar entrada") para título do modal */
  const [pendingPunchLabel, setPendingPunchLabel] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [geo, setGeo] = useState<GeoPosition | null>(null);
  const [gpsFailReason, setGpsFailReason] = useState<GeolocationFailureReason | null>(null);
  const [geoPermissionState, setGeoPermissionState] = useState<GeoPermissionState>('unknown');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [hadBiometric, setHadBiometric] = useState(false);
  const [digitalFallbackToPhoto, setDigitalFallbackToPhoto] = useState(false);
  const [webAuthnBusy, setWebAuthnBusy] = useState(false);
  const modalVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadTodayState = useCallback(async () => {
    if (!user || !isSupabaseConfigured()) return;
    try {
      const today = getLocalDateString();
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
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
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
    setPendingPunchLabel('');
    setGeo(null);
    setGpsFailReason(null);
    setPhotoDataUrl(null);
    setHadBiometric(false);
    setDigitalFallbackToPhoto(false);
    setGpsLoading(false);
    setWebAuthnBusy(false);
    setGeoLiveStatus('idle');
    setGeoPermissionState('unknown');
  }, [stopCamera]);

  const retryGps = useCallback(async () => {
    setGeo(null);
    setGpsFailReason(null);
    setGeoLiveStatus('obtaining');
    setGpsLoading(true);
    logGeolocationDebug('retryGps:start', {});
    const perm = await queryGeolocationPermission();
    setGeoPermissionState(perm);
    logGeolocationDebug('retryGps:permission', { permission: perm });
    const r = await getCurrentLocationResult({ timeout: 20000, maximumAge: 0 });
    setGpsLoading(false);
    if (r.ok === false) {
      setGeo(null);
      setGpsFailReason(r.reason);
      setGeoLiveStatus('failed');
      logGeolocationDebug('retryGps:fail', { reason: r.reason, apiMessage: r.apiMessage });
      return;
    }
    setGeo(r.position);
    setGpsFailReason(null);
    setGeoLiveStatus('captured');
    logGeolocationDebug('retryGps:ok', { position: r.position });
  }, []);

  useEffect(() => {
    if (!proofModalOpen) return;
    let cancelled = false;
    setGeoLiveStatus('obtaining');
    (async () => {
      setGpsLoading(true);
      setGpsFailReason(null);
      setGeo(null);
      const perm = await queryGeolocationPermission();
      if (!cancelled) {
        setGeoPermissionState(perm);
        logGeolocationDebug('modal:permission', { permission: perm });
      }
      const r = await getCurrentLocationResult({ timeout: 20000, maximumAge: 0 });
      if (cancelled) return;
      setGpsLoading(false);
      if (r.ok === false) {
        setGeo(null);
        setGpsFailReason(r.reason);
        setGeoLiveStatus('failed');
        logGeolocationDebug('modal:initial:fail', { reason: r.reason, apiMessage: r.apiMessage });
        return;
      }
      setGeo(r.position);
      setGpsFailReason(null);
      setGeoLiveStatus('captured');
    })();

    const stopWatch = watchGeoPosition(
      (r) => {
        if (cancelled) return;
        if (r.ok && r.position) {
          setGeo(r.position);
          setGpsFailReason(null);
          setGeoLiveStatus('captured');
        }
      },
      { minIntervalMs: 3000, timeout: 25000, maximumAge: 0, enableHighAccuracy: true },
    );

    return () => {
      cancelled = true;
      stopWatch();
    };
  }, [proofModalOpen]);

  /** Ponto manual sem foto/GPS quando global e preferências do colaborador permitem. */
  const canUseManualPunch =
    (globalSettings?.allow_manual_punch ?? true) && (user?.preferences?.allowManualPunch ?? true);

  const manualBypassActive = canUseManualPunch && verificationMode === 'manual';

  /** Câmera só no modo Foto ou quando, no Digital, o usuário escolheu “Usar foto”. Manual e Digital (só WebAuthn) não ligam a câmera. */
  const needsCameraPreview =
    proofModalOpen &&
    !manualBypassActive &&
    (verificationMode === 'photo' || (verificationMode === 'digital' && digitalFallbackToPhoto));

  useEffect(() => {
    if (!canUseManualPunch && verificationMode === 'manual') {
      setVerificationMode('photo');
    }
  }, [canUseManualPunch, verificationMode]);

  useEffect(() => {
    if (!needsCameraPreview) {
      if (!proofModalOpen) stopCamera();
      return;
    }
    // Com foto já capturada: parar o stream para “congelar” o preview (mostramos <img> abaixo).
    if (photoDataUrl) {
      stopCamera();
      return;
    }
    void startCameraPreview();
    return () => {
      stopCamera();
    };
  }, [needsCameraPreview, proofModalOpen, photoDataUrl, startCameraPreview, stopCamera]);

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
    biometricOk: boolean,
    opts?: { manualBypass?: boolean }
  ) => {
    if (!user) return;
    const manualBypass = opts?.manualBypass === true && canUseManualPunch;
    setSaving(true);
    setError(null);
    try {
      const fingerprint: DeviceFingerprint = generateDeviceFingerprint();

      const today = getLocalDateString();
      const dayRecords = await getDayRecords(user.id, today);
      const typeStr = type === LogType.IN ? 'entrada' : type === LogType.OUT ? 'saída' : 'pausa';
      const validation = validatePunchSequence(dayRecords, typeStr);
      if (!validation.valid) {
        setError(validation.error || 'Sequência inválida.');
        toast.addToast('error', validation.error || 'Sequência inválida.');
        return;
      }

      if (globalSettings?.gps_required && !manualBypass) {
        if (geoPos?.latitude == null || geoPos?.longitude == null) {
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
        const validated = validatePunchImageDataUrl(localPhotoDataUrl);
        if (validated.ok === false) {
          setError(validated.message);
          toast.addToast('error', validated.message);
          return;
        }
        if (!storage || !user) {
          setError('Armazenamento indisponível para envio da foto.');
          toast.addToast('error', 'Armazenamento indisponível.');
          return;
        }
        const uploaded = await uploadPunchPhotoWithRetry(storage, user.id, localPhotoDataUrl);
        if (uploaded.publicUrl) {
          photoUrl = uploaded.publicUrl;
        } else if (uploaded.error && !uploaded.transientFailure) {
          setError(uploaded.error);
          toast.addToast('error', uploaded.error);
          return;
        } else {
          photoUrl = localPhotoDataUrl;
          toast.addToast(
            'info',
            uploaded.transientFailure
              ? 'Rede instável: foto mantida no registro; tente novamente mais tarde para sincronizar o arquivo.'
              : 'Não foi possível enviar a foto ao servidor; o registro segue com referência local.'
          );
        }
      }

      const method = manualBypass ? PunchMethod.MANUAL : resolveMethod(biometricOk, photoUrl, geoPos);

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

      const punchPayload = {
        userId: user.id,
        companyId: user.companyId,
        type: typeStr,
        method,
        hasLocation: !!(geoPos?.latitude != null && geoPos?.longitude != null),
        hasPhoto: !!photoUrl,
        manualBypass,
      };
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        console.info('[ClockIn] registerPunchSecure', punchPayload);
      }

      const result = await registerPunchSecure({
        userId: user.id,
        companyId: user.companyId,
        type: typeStr,
        method,
        location: geoPos ? { lat: geoPos.latitude, lng: geoPos.longitude, accuracy: geoPos.accuracy } : undefined,
        photoUrl: photoUrl || undefined,
        source: PUNCH_SOURCE_WEB,
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
      await queryClient.invalidateQueries({ queryKey: ['records'] });
      invalidateAfterPunch(user.id, user.companyId);
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
    } catch (e: unknown) {
      console.error('Erro ao registrar ponto:', e);
      const err = normalizePunchRegistrationError(e);
      const msg = err.message || 'Erro ao registrar ponto';
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        console.warn('[ClockIn] registerPunch erro', e);
      }
      setError(msg);
      toast.addToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  /** Envia a batida; `biometricOverride` usa o valor recém-obtido no WebAuthn antes do React atualizar o estado. */
  const submitProof = async (biometricOverride?: boolean) => {
    if (!user || pendingLogType == null) return;
    const biometricOk = biometricOverride ?? hadBiometric;
    const manualBypass = manualBypassActive;
    if (globalSettings?.gps_required && (geo?.latitude == null || geo?.longitude == null) && !manualBypass) {
      toast.addToast('error', 'É necessário obter a localização antes de registrar.');
      return;
    }
    if (globalSettings?.photo_required && !manualBypass) {
      if (verificationMode === 'digital') {
        if (!biometricOk && !photoDataUrl) {
          toast.addToast('error', 'Valide a biometria ou capture a foto obrigatória.');
          return;
        }
      } else if (verificationMode === 'photo') {
        if (!photoDataUrl) {
          toast.addToast('error', 'Capture a foto obrigatória antes de registrar.');
          return;
        }
      }
    }
    await executePunchRegistration(pendingLogType, geo, photoDataUrl, biometricOk, { manualBypass });
  };

  const handleConfirmProof = async () => {
    await submitProof();
  };

  const handleTryWebAuthnInModal = async () => {
    if (!user) return;
    setWebAuthnBusy(true);
    try {
      if (!isWebAuthnSupported()) {
        toast.addToast(
          'error',
          'Biometria digital requer HTTPS (ou localhost) e navegador compatível. Use a foto.'
        );
        setDigitalFallbackToPhoto(true);
        return;
      }
      const hadKeyBefore = hasStoredPasskey(user.id);
      const ok = hadKeyBefore
        ? await verifyPlatformPasskey(user.id)
        : await registerPlatformPasskey(user.id, user.email ?? '', user.nome ?? 'Colaborador');
      setHadBiometric(ok);
      if (ok) {
        toast.addToast(
          'success',
          hadKeyBefore ? 'Dispositivo validado com biometria.' : 'Biometria cadastrada neste aparelho.'
        );
        // Após biometria válida no modo digital, registra o ponto automaticamente (sem segundo clique em "Confirmar").
        if (verificationMode === 'digital') {
          await submitProof(true);
        }
      } else {
        setDigitalFallbackToPhoto(true);
        toast.addToast('info', 'Não foi possível validar. Use a foto.');
      }
    } catch {
      setDigitalFallbackToPhoto(true);
      toast.addToast('error', 'Operação cancelada ou indisponível. Use a foto.');
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

  const beginPunch = async (type: LogType, mode: VerificationMode, punchActionLabel: string) => {
    if (!user) return;
    if (!isSupabaseConfigured()) {
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
    const today = getLocalDateString();
    const dayRecords = await getDayRecords(user.id, today);
    const typeStr = type === LogType.IN ? 'entrada' : type === LogType.OUT ? 'saída' : 'pausa';
    const validation = validatePunchSequence(dayRecords, typeStr);
    if (!validation.valid) {
      setError(validation.error || 'Sequência inválida.');
      toast.addToast('error', validation.error || 'Sequência inválida.');
      return;
    }
    setVerificationMode(mode);
    setPendingLogType(type);
    setPendingPunchLabel(punchActionLabel);
    setGeo(null);
    setGpsFailReason(null);
    setPhotoDataUrl(null);
    setHadBiometric(false);
    setDigitalFallbackToPhoto(false);
    setProofModalOpen(true);
  };

  const handlePunch = (type: LogType, mode: VerificationMode, punchActionLabel: string) => {
    void beginPunch(type, mode, punchActionLabel);
  };

  /** Em jornada: última batida do dia foi entrada (trabalhando ou após retorno de intervalo) */
  const isIn = lastType === 'entrada';
  /** Em intervalo: última batida foi início de pausa */
  const isBreak = lastType === 'pausa';

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

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
        subtitle="Marcações com sequência válida, localização automática, foto ou biometria do aparelho (HTTPS)."
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

      <div className="rounded-2xl border border-slate-200 dark:border-slate-600 bg-white/90 dark:bg-slate-900 dark:shadow-lg dark:shadow-black/30 p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Shield className="w-4 h-4 text-indigo-500 shrink-0" />
          <span>
            {lastLabel && lastRecordAt ? (
              <>
                <strong>Último registro hoje:</strong>{' '}
                <span className="text-slate-900 dark:text-slate-100">{lastLabel}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}
                  às{' '}
                  {new Date(lastRecordAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            ) : (
              <>
                <strong>Hoje:</strong> ainda não há registros. Use os botões abaixo para marcar ponto.
              </>
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
            <span className="text-slate-500">Localização obtida automaticamente; comprovação opcional: foto ou digital.</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Toque em <strong>Foto</strong>, <strong>Digital</strong> ou <strong>Manual</strong> para abrir as opções de registro. A localização é obtida automaticamente no envio.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-500">
          {globalSettings?.photo_required
            ? 'Foto ou Digital obrigatórios conforme política da empresa.'
            : 'Localização automática + comprovação opcional.'}
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { mode: 'photo' as const, label: '📸 Foto', icon: Camera, color: 'sky' },
            { mode: 'digital' as const, label: '🔐 Digital', icon: ScanLine, color: 'indigo' },
            ...(canUseManualPunch ? [{ mode: 'manual' as const, label: '⌨️ Manual', icon: Keyboard, color: 'amber' }] : []),
          ].map((card) => {
            const Icon = card.icon;
            const isExpanded = expandedPunchMode === card.mode;
            return (
              <div key={card.mode} className={`rounded-3xl border-2 ${isExpanded ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'} p-6 transition-all hover:shadow-md`}>
                <button
                  type="button"
                  disabled={saving}
                  aria-expanded={isExpanded}
                  aria-controls={`punch-actions-${card.mode}`}
                  id={`comprovante-trigger-${card.mode}`}
                  onClick={() => {
                    setVerificationMode(card.mode);
                    if (card.mode === 'photo' || card.mode === 'manual') setDigitalFallbackToPhoto(false);
                    setExpandedPunchMode((prev) => (prev === card.mode ? null : card.mode));
                  }}
                  className="w-full flex flex-col items-center gap-4"
                >
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${isExpanded ? 'bg-indigo-100 dark:bg-indigo-900' : 'bg-slate-100 dark:bg-slate-800'}`}>
                    <Icon className={`w-8 h-8 ${isExpanded ? 'text-indigo-600' : 'text-slate-500 dark:text-slate-400'}`} />
                  </div>
                  <div>
                    <div className="font-semibold text-xl text-slate-800 dark:text-slate-100">{card.label}</div>
                    {!isExpanded && (
                      <div className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-2 font-medium">Clique aqui</div>
                    )}
                  </div>
                </button>

                {isExpanded && (
                <div id={`punch-actions-${card.mode}`} className="mt-6 space-y-2" role="region" aria-labelledby={`comprovante-trigger-${card.mode}`}>
                  <button
                    onClick={() => handlePunch(LogType.IN, card.mode, 'Registrar entrada')}
                    disabled={saving || (isIn && !isBreak && card.mode !== 'manual')}
                    className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Registrar Entrada
                  </button>
                  <button
                    onClick={() => handlePunch(LogType.BREAK, card.mode, 'Início de intervalo')}
                    disabled={saving || !isIn || isBreak}
                    className="w-full py-3 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Iniciar Intervalo
                  </button>
                  <button
                    onClick={() => handlePunch(LogType.IN, card.mode, 'Retorno do intervalo')}
                    disabled={saving || !isBreak}
                    className="w-full py-3 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Finalizar Intervalo
                  </button>
                  <button
                    onClick={() => handlePunch(LogType.OUT, card.mode, 'Registrar saída')}
                    disabled={saving || !isIn}
                    className="w-full py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    Registrar Saída
                  </button>
                </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
            className={`relative z-[101] w-full max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-xl p-5 md:p-6 space-y-5 ${
              verificationMode === 'digital'
                ? 'border-2 border-indigo-400/90 dark:border-indigo-500 ring-2 ring-indigo-200/60 dark:ring-indigo-900/80'
                : verificationMode === 'photo'
                  ? 'border-2 border-sky-400/85 dark:border-sky-600 ring-2 ring-sky-200/50 dark:ring-sky-900/70'
                  : verificationMode === 'manual'
                    ? 'border-2 border-amber-400/85 dark:border-amber-600 ring-2 ring-amber-200/50 dark:ring-amber-900/60'
                    : 'border border-slate-200 dark:border-slate-700'
            }`}
          >
            <div className="space-y-1">
              <h2 id="proof-modal-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                {pendingPunchLabel || 'Comprovar registro de ponto'}
              </h2>
              {verificationMode === 'photo' && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Capture a foto e confirme. GPS em paralelo.
                </p>
              )}
              {verificationMode === 'manual' && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Confirmação auditada, sem biometria/foto quando permitido.
                </p>
              )}
            </div>

            {verificationMode === 'digital' && (
              <div className="rounded-xl border-2 border-indigo-300/80 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <ScanLine className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  Validar biometria
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Primeira vez: cadastro neste aparelho. Depois: Face ID, Windows Hello ou sensor. Em caso de falha, use foto ou registro manual.
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    disabled={saving || webAuthnBusy || hadBiometric}
                    onClick={() => void handleTryWebAuthnInModal()}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 min-h-[44px]"
                  >
                    {webAuthnBusy ? 'Aguardando…' : hadBiometric ? 'Validado' : 'Validar no dispositivo'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setDigitalFallbackToPhoto(true)}
                    className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium min-h-[44px]"
                  >
                    Usar foto
                  </button>
                  {canUseManualPunch && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setVerificationMode('manual');
                        setDigitalFallbackToPhoto(false);
                      }}
                      className="px-4 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-sm font-medium min-h-[44px]"
                    >
                      Manual
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Localização</p>
                    {gpsLoading && (
                      <p className="text-xs text-slate-500" role="status">
                        Obtendo…
                      </p>
                    )}
                    {!gpsLoading && geoLiveStatus === 'captured' && geo && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">
                        OK (~{Math.round(geo.accuracy)} m)
                      </p>
                    )}
                    {!gpsLoading && geoLiveStatus === 'failed' && gpsFailReason && (
                      <p className="text-xs text-red-600 dark:text-red-400" role="status">
                        Sem posição
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={gpsLoading || saving}
                  onClick={() => void retryGps()}
                  className="shrink-0 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50"
                >
                  Atualizar
                </button>
              </div>
              {typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  {verificationMode === 'digital' && 'Use HTTPS para GPS e biometria (ou localhost).'}
                  {verificationMode === 'photo' && 'Use HTTPS para GPS e câmera (ou localhost).'}
                  {verificationMode === 'manual' && 'Use HTTPS para GPS (ou localhost).'}
                </p>
              )}
              {geoPermissionState === 'denied' && (
                <p className="text-xs text-slate-600 dark:text-slate-400" role="status">
                  Permissão de localização negada no navegador.
                </p>
              )}
              {!gpsLoading && geoLiveStatus === 'failed' && gpsFailReason && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-950/30 p-2.5 space-y-1" role="alert">
                  <p className="text-xs font-medium text-red-800 dark:text-red-200">
                    {gpsFailReason === 'denied' ? 'Localização bloqueada' : 'GPS indisponível'}
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">{geolocationReasonMessage(gpsFailReason)}</p>
                  <p className="text-[11px] text-red-800/90 dark:text-red-200/90">{geolocationActionHint(gpsFailReason)}</p>
                  {import.meta.env?.DEV && (
                    <p className="text-[10px] font-mono text-slate-500 break-all">Debug: motivo={gpsFailReason}</p>
                  )}
                </div>
              )}
              {canUseManualPunch && !manualBypassActive && geoLiveStatus === 'failed' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setVerificationMode('manual')}
                  className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-900/30 py-2 text-xs font-medium text-amber-900 dark:text-amber-200"
                >
                  Sem GPS — continuar em manual
                </button>
              )}
              {geo && geo.latitude != null && geo.longitude != null && (
                <div className="h-28 sm:h-32 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800">
                  <Suspense
                    fallback={
                      <div className="h-full flex items-center justify-center text-[11px] text-slate-500">Mapa…</div>
                    }
                  >
                    <LocationMap lat={geo.latitude} lng={geo.longitude} accuracy={geo.accuracy} className="rounded-lg" />
                  </Suspense>
                </div>
              )}
            </div>

            {verificationMode === 'manual' && manualBypassActive && (
              <div className="rounded-lg border border-amber-300/90 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-900/25 p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
                  <Keyboard className="w-4 h-4 shrink-0" />
                  Registro manual
                </div>
                <p className="text-xs text-amber-800/95 dark:text-amber-300/95">
                  Confirme abaixo. Método registrado como manual para auditoria.
                </p>
              </div>
            )}

            {needsCameraPreview && (
              <div
                className={`rounded-xl p-4 space-y-3 ${
                  verificationMode === 'photo'
                    ? 'border-2 border-sky-300/80 dark:border-sky-700 bg-sky-50/40 dark:bg-sky-950/30'
                    : 'border border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Camera className="w-5 h-5 text-sky-500 shrink-0" />
                  {globalSettings?.photo_required
                    ? 'Foto obrigatória'
                    : verificationMode === 'photo'
                      ? 'Capturar foto'
                      : 'Foto de apoio'}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {verificationMode === 'photo'
                    ? 'Enquadre o rosto ou o ambiente solicitado pela empresa.'
                    : 'Use se a biometria não estiver disponível.'}
                </p>
                <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-black">
                  {photoDataUrl ? (
                    <img
                      src={photoDataUrl}
                      alt="Pré-visualização da foto capturada para o registro de ponto"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <video ref={modalVideoRef} className="w-full h-full object-cover" playsInline muted autoPlay />
                  )}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (photoDataUrl) {
                        setPhotoDataUrl(null);
                        return;
                      }
                      void handleCapturePhotoClick();
                    }}
                    className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-medium min-h-[44px]"
                  >
                    {photoDataUrl ? 'Tirar outra foto' : 'Capturar foto'}
                  </button>
                  {canUseManualPunch && !manualBypassActive && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setVerificationMode('manual')}
                      className="px-4 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-sm font-medium min-h-[44px]"
                    >
                      Registro manual
                    </button>
                  )}
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
                  (gpsLoading && !manualBypassActive && globalSettings?.gps_required === true) ||
                  (globalSettings?.gps_required === true &&
                    (geo?.latitude == null || geo?.longitude == null) &&
                    !manualBypassActive) ||
                  (globalSettings?.photo_required === true &&
                    !manualBypassActive &&
                    ((verificationMode === 'digital' && !hadBiometric && !photoDataUrl) ||
                      (verificationMode === 'photo' && !photoDataUrl)))
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
