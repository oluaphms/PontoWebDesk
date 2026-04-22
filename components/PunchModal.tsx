
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { LogType, PunchMethod, User, Company } from '../types';
import { Camera, MapPin, Keyboard, X, Check, AlertTriangle, ShieldCheck, RefreshCw, Settings2, HelpCircle, Loader2, AlertCircle, Upload, ScanLine, Navigation, MapPinned } from 'lucide-react';
import { Button, LoadingState, Badge } from './UI';
import { PontoService } from '../services/pontoService';
import { BiometricService } from '../services/biometricService';
import { GeocodingService } from '../services/geocodingService';
import LocationMap from './LocationMap';

interface PunchModalProps {
  user: User;
  type: LogType;
  onClose: () => void;
  onConfirm: (method: PunchMethod, data: { photo?: string, justification?: string, location?: any }) => void;
  initialMethod?: PunchMethod;
}

const PunchModal: React.FC<PunchModalProps> = ({ user, type, onClose, onConfirm, initialMethod }) => {
  const [company, setCompany] = useState<Company | null>(null);
  const [method, setMethod] = useState<PunchMethod>(initialMethod || PunchMethod.PHOTO);
  const [photo, setPhoto] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [location, setLocation] = useState<any>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);

  // Biometric states
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [biometricRegistered, setBiometricRegistered] = useState(false);
  const [biometricVerified, setBiometricVerified] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricDeviceName, setBiometricDeviceName] = useState<string>('');

  // Geocoding states
  const [addressInfo, setAddressInfo] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Verificar dispositivos disponíveis quando o modal abre
  useEffect(() => {
    if (method === PunchMethod.PHOTO && hasCamera === null) {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(devices => {
          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          console.log('📹 Verificação inicial - dispositivos encontrados:', videoDevices.length);
          setAvailableDevices(videoDevices);
        }).catch((err) => {
          console.warn('Falha ao enumerar dispositivos de vídeo:', err);
        });
      }
    }
  }, [method, hasCamera]);

  // Verificar disponibilidade de biometria
  useEffect(() => {
    const checkBiometric = async () => {
      const availability = await BiometricService.isAvailable();
      setBiometricAvailable(availability.platformAvailable);
      const hasCredential = BiometricService.hasRegisteredCredential(user.id);
      setBiometricRegistered(hasCredential);
      if (hasCredential) {
        const info = BiometricService.getCredentialInfo(user.id);
        if (info) setBiometricDeviceName(info.deviceName);
      }
    };
    checkBiometric();
  }, [user.id]);

  // Resetar estados quando método muda
  useEffect(() => {
    if (method === PunchMethod.PHOTO) {
      setShowTroubleshoot(false);
      setIsCapturing(false);
    }
  }, []);

  useEffect(() => {
    PontoService.getCompany(user.companyId).then(comp => {
      if (comp) {
        setCompany(comp);
        if (initialMethod) {
          setMethod(initialMethod);
        } else if (comp.settings.requirePhoto) {
          setMethod(PunchMethod.PHOTO);
        } else {
          setMethod(PunchMethod.GPS);
        }
      }
    });
  }, [user.companyId, initialMethod]);

  // Atualizar método quando initialMethod mudar
  useEffect(() => {
    if (initialMethod) {
      setMethod(initialMethod);
      if (initialMethod === PunchMethod.PHOTO) {
        setPhoto(null);
        setError(null);
        setShowTroubleshoot(false);
        setIsCapturing(false);
      }
    }
  }, [initialMethod]);

  // Resetar showTroubleshoot quando o método muda para PHOTO
  useEffect(() => {
    if (method === PunchMethod.PHOTO) {
      setShowTroubleshoot(false);
    }
  }, [method]);

  useEffect(() => {
    if (error) {
      console.log('🔄 Erro definido:', error);
    }
  }, [error]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    modalRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const requestLocation = () => {
    setError(null);
    setIsLocationLoading(true);
    setAddressInfo(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setLocation(loc);
        setIsLocationLoading(false);

        // Geocoding reverso automático
        setAddressLoading(true);
        try {
          const geoResult = await GeocodingService.reverseGeocode(loc.lat, loc.lng);
          if (geoResult) {
            setAddressInfo(GeocodingService.formatShortAddress(geoResult));
          }
        } catch (err) {
          console.warn('Geocoding falhou:', err);
        } finally {
          setAddressLoading(false);
        }
      },
      (err) => {
        setIsLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  useEffect(() => {
    if (method === PunchMethod.PHOTO) {
      setShowTroubleshoot(false);
    }
  }, [method]);

  const startCamera = useCallback(async () => {
    console.log('🎬 startCamera chamada');
    setError(null);
    setIsCapturing(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Seu navegador não suporta acesso à câmera. Use Chrome, Firefox ou Safari atualizado.");
      setHasCamera(false);
      return;
    }

    const currentLocation = window.location;
    const isSecureContext = currentLocation.protocol === 'https:' ||
      currentLocation.hostname === 'localhost' ||
      currentLocation.hostname === '127.0.0.1' ||
      window.isSecureContext;

    if (!isSecureContext) {
      setError("Acesso à câmera requer conexão segura (HTTPS).");
      setHasCamera(false);
      return;
    }

    let videoDevices: MediaDeviceInfo[] = [];
    try {
      console.log('📹 Verificando dispositivos disponíveis...');
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.warn('Falha ao testar câmera (pré-check):', e);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      videoDevices = devices.filter(d => d.kind === 'videoinput');

      console.log('📹 Dispositivos de vídeo encontrados:', videoDevices.length);
      setAvailableDevices(videoDevices);

      if (videoDevices.length === 0) {
        setHasCamera(false);
        setError("Nenhuma câmera encontrada. Use o botão 'Enviar foto do dispositivo' para fazer upload de uma imagem.");
        return;
      }

      setHasCamera(true);
    } catch (err) {
      console.error('Erro ao verificar dispositivos:', err);
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      if (videoRef.current?.srcObject) {
        const existingStream = videoRef.current.srcObject as MediaStream;
        existingStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const videoConstraints: any[] = [];

      if (videoDevices.length > 0 && videoDevices[0].deviceId) {
        videoConstraints.push({ video: { deviceId: { exact: videoDevices[0].deviceId } } });
        videoConstraints.push({ video: { deviceId: videoDevices[0].deviceId } });
      }

      if (isMobile) {
        videoConstraints.push({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } } });
        videoConstraints.push({ video: { facingMode: 'environment' } });
        videoConstraints.push({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } } });
        videoConstraints.push({ video: { facingMode: 'user' } });
      } else {
        videoConstraints.push({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } } });
        videoConstraints.push({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } });
        videoConstraints.push({ video: { facingMode: 'user' } });
      }

      videoConstraints.push({ video: true });

      let stream: MediaStream | null = null;
      let lastError: any = null;

      for (let i = 0; i < videoConstraints.length; i++) {
        const constraints = videoConstraints[i];
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('✅ Acesso à câmera concedido');
          break;
        } catch (err: any) {
          lastError = err;
          if (err.name === 'NotFoundError' && i >= 3) break;
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
          }
        }
      }

      if (!stream) {
        if (lastError) {
          const name = lastError.name;
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            setError("Câmera bloqueada. Toque em 'Ativar Câmera' novamente e permita o acesso.");
            setIsCapturing(false);
            return;
          }
          if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            setHasCamera(false);
            setError("Nenhuma câmera encontrada. Use 'Enviar foto do dispositivo'.");
            setIsCapturing(false);
            return;
          }
          if (name === 'NotReadableError' || name === 'TrackStartError') {
            setError("Câmera em uso por outro aplicativo. Feche outros apps.");
            setIsCapturing(false);
            return;
          }
          setError(`Não foi possível acessar a câmera: ${lastError.message || 'Erro desconhecido'}.`);
        } else {
          setError('Não foi possível acessar a câmera. Tente novamente.');
        }
        setIsCapturing(false);
        return;
      }

      if (!videoRef.current) {
        stream.getTracks().forEach(track => track.stop());
        setError("Elemento de vídeo não encontrado. Recarregue a página.");
        return;
      }

      videoRef.current.srcObject = stream;

      await new Promise((resolve, reject) => {
        if (!videoRef.current) {
          reject(new Error('Elemento de vídeo perdido'));
          return;
        }
        const timeout = setTimeout(() => reject(new Error('Timeout ao carregar vídeo')), 10000);
        videoRef.current.onloadedmetadata = () => { clearTimeout(timeout); resolve(void 0); };
        videoRef.current.onerror = (e) => { clearTimeout(timeout); reject(e); };
      });

      try {
        await videoRef.current.play();
        setIsCapturing(true);
        setError(null);
        console.log('✅ Vídeo iniciado com sucesso');
      } catch (playErr) {
        setError("Erro ao iniciar a visualização da câmera.");
        setIsCapturing(false);
      }

    } catch (err: any) {
      console.error('❌ Erro ao acessar câmera:', err);
      setIsCapturing(false);

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError("Câmera bloqueada. Toque em 'Ativar Câmera' novamente e permita o acesso.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError("Nenhuma câmera encontrada.");
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError("Câmera está sendo usada por outro aplicativo.");
      } else if (err.name === 'OverconstrainedError') {
        try {
          const simpleStream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = simpleStream;
            await videoRef.current.play();
            setIsCapturing(true);
            setError(null);
          }
        } catch (retryErr) {
          setError("Não foi possível acessar a câmera. Tente novamente.");
        }
        return;
      } else {
        setError(`Erro ao acessar a câmera: ${err.message || 'Erro desconhecido'}.`);
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsCapturing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let cameraTimeout: NodeJS.Timeout;

    const initializeCamera = async () => {
      if (!mounted) return;
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (!isMobile) {
        cameraTimeout = setTimeout(async () => {
          if (mounted && method === PunchMethod.PHOTO && !photo && !showTroubleshoot && !error) {
            await startCamera();
          }
        }, 200);
      }
    };

    if (method === PunchMethod.PHOTO && !photo && !showTroubleshoot && !isCapturing) {
      initializeCamera();
    } else if (method !== PunchMethod.PHOTO || photo) {
      stopCamera();
    }

    return () => {
      mounted = false;
      if (cameraTimeout) clearTimeout(cameraTimeout);
      stopCamera();
    };
  }, [method, photo, showTroubleshoot, startCamera, stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Por favor, selecione um arquivo de imagem válido.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('A imagem deve ter no máximo 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result && result.startsWith('data:image/')) {
        setPhoto(result);
        setError(null);
      } else {
        setError('Erro ao processar a imagem. Tente novamente.');
      }
    };
    reader.onerror = () => {
      setError('Erro ao ler o arquivo. Tente novamente.');
    };
    reader.readAsDataURL(file);
  };

  const capturePhoto = async () => {
    try {
      if (!videoRef.current || !canvasRef.current) {
        setError("Câmera não está pronta. Aguarde um momento.");
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      let attempts = 0;
      while (attempts < 10) {
        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (video.readyState !== video.HAVE_ENOUGH_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
        setError("A câmera não está pronta. Aguarde.");
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        setError("Erro ao acessar o canvas.");
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const data = canvas.toDataURL('image/jpeg', 0.85);

      if (!data || data.length < 1000) {
        setError("Imagem capturada muito pequena. Tente novamente.");
        return;
      }

      if (!data.startsWith('data:image/')) {
        setError("Formato de imagem inválido.");
        return;
      }

      // Validação facial básica usando FaceDetector API (quando disponível)
      try {
        const AnyWindow = window as any;
        if (AnyWindow.FaceDetector) {
          const detector = new AnyWindow.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
          const imageBitmap = await createImageBitmap(canvas);
          const faces = await detector.detect(imageBitmap);

          if (!faces || faces.length === 0) {
            setError("Nenhum rosto detectado. Posicione seu rosto na câmera e tente novamente.");
            return;
          }
        }
      } catch (faceErr) {
        console.warn('Face detection não suportada ou falhou:', faceErr);
      }

      setPhoto(data);
      stopCamera();
      setError(null);
    } catch (err) {
      console.error('Erro ao capturar foto:', err);
      setError("Erro ao capturar foto. Verifique as permissões.");
    }
  };

  const diagnoseCamera = async () => {
    const diagnostics = {
      userAgent: navigator.userAgent,
      https: window.location.protocol === 'https:',
      hostname: window.location.hostname,
      getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      videoElement: !!videoRef.current,
      isCapturing,
      error,
    };

    try {
      const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      (diagnostics as any).cameraPermission = cameraPermission.state;
    } catch (e) {
      console.warn('Falha ao consultar permissão de câmera:', e);
    }

    console.log('=== DIAGNÓSTICO DA CÂMERA ===', JSON.stringify(diagnostics, null, 2));
    setError(`Diagnóstico executado. Verifique o console (F12).`);
  };

  // ============================================================
  // BIOMETRIC HANDLERS
  // ============================================================
  const handleBiometricRegister = async () => {
    setBiometricLoading(true);
    setError(null);
    try {
      const result = await BiometricService.register(user.id, user.nome);
      if (result.success) {
        setBiometricRegistered(true);
        setBiometricDeviceName(result.authenticatorType || 'Biometria');
        // Após registrar, autenticar automaticamente
        setBiometricVerified(true);
      } else {
        setError(result.error || 'Erro ao registrar biometria.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro inesperado na biometria.');
    } finally {
      setBiometricLoading(false);
    }
  };

  const handleBiometricAuth = async () => {
    setBiometricLoading(true);
    setError(null);
    try {
      const result = await BiometricService.authenticate(user.id);
      if (result.success && result.verified) {
        setBiometricVerified(true);
        setBiometricDeviceName(result.authenticatorType || 'Biometria');
      } else {
        setError(result.error || 'Falha na autenticação biométrica.');
      }
    } catch (err: any) {
      setError(err.message || 'Erro inesperado na biometria.');
    } finally {
      setBiometricLoading(false);
    }
  };

  const isPhotoValid = useMemo(() => {
    if (!photo) return false;
    return photo.startsWith('data:image/jpeg;base64,') && photo.length > 2000;
  }, [photo]);

  const photoRequired = useMemo(() => {
    return (company?.settings.requirePhoto ?? false) || method === PunchMethod.PHOTO;
  }, [method, company]);

  const isFormValid = useMemo(() => {
    if (!company) return false;

    // Photo check
    if (photoRequired && !isPhotoValid) return false;

    // Manual justification check
    if (method === PunchMethod.MANUAL && !justification.trim()) return false;

    // Biometric check
    if (method === PunchMethod.BIOMETRIC && !biometricVerified) return false;

    // Location check - OBRIGATÓRIA para TODOS os métodos (foto, GPS, biométrico, manual)
    if (!location || location.lat == null || location.lng == null) return false;

    return true;
  }, [company, photoRequired, isPhotoValid, method, justification, location, biometricVerified]);

  const handleConfirm = () => {
    if (photoRequired && !isPhotoValid) {
      setError("Captura de foto biométrica obrigatória.");
      setMethod(PunchMethod.PHOTO);
      return;
    }

    if (method === PunchMethod.MANUAL && !justification.trim()) {
      setError("Justificativa obrigatória para registro manual.");
      return;
    }

    if (method === PunchMethod.BIOMETRIC && !biometricVerified) {
      setError("Autenticação biométrica necessária.");
      return;
    }

    // Localização OBRIGATÓRIA para TODOS os métodos (foto, GPS, biométrico, manual)
    if (!location || location.lat == null || location.lng == null) {
      setError("Localização não identificada. Verifique seu GPS. Todos os registros de ponto requerem localização.");
      return;
    }

    onConfirm(method, { photo: photo || undefined, justification, location });
  };

  if (!company) return null;

  // Build method tabs
  const methodTabs = [
    { id: PunchMethod.PHOTO, icon: Camera, label: company.settings.requirePhoto ? 'Biometria *' : 'Foto', color: 'indigo' },
    { id: PunchMethod.GPS, icon: MapPin, label: 'GPS', color: 'blue' },
    { id: PunchMethod.BIOMETRIC, icon: ScanLine, label: 'Digital', color: 'violet' },
    ...(company.settings.allowManualPunch ? [{ id: PunchMethod.MANUAL, icon: Keyboard, label: 'Manual', color: 'slate' }] : [])
  ];

  // Filter out biometric if not available
  const filteredTabs = biometricAvailable === false
    ? methodTabs.filter(t => t.id !== PunchMethod.BIOMETRIC)
    : methodTabs;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300">
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full h-full bg-white dark:bg-slate-900 rounded-none shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/10 outline-none overflow-y-auto flex flex-col lg:max-w-5xl lg:h-[90vh] lg:rounded-[3rem] lg:my-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="px-10 py-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div>
            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-1 inline-block ${type === LogType.IN ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
              Registro de {type}
            </div>
            <h3 id="modal-title" className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Validar Identidade</h3>
          </div>
          <button onClick={onClose} className="p-3 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all">
            <X size={24} />
          </button>
        </header>

        <div className="p-10">
          {/* Method Tabs */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-[1.5rem] mb-8 overflow-x-auto">
            {filteredTabs.map((m) => (
              <button
                key={m.id}
                onClick={() => { setMethod(m.id as PunchMethod); setError(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all min-w-0 ${method === m.id ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <m.icon size={18} className={method === m.id ? 'text-indigo-600 dark:text-indigo-400' : ''} />
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-6">
            <div className="relative aspect-square max-w-[340px] mx-auto bg-slate-950 rounded-[2.5rem] overflow-hidden group shadow-2xl border-4 border-slate-100 dark:border-slate-800">
              {showTroubleshoot ? (
                <div className="w-full h-full p-8 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800 text-center">
                  <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 text-red-600 rounded-full flex items-center justify-center mb-6"><Settings2 size={32} /></div>
                  <h4 className="font-bold text-slate-900 dark:text-white mb-2">Acesso Negado</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-6">O sistema requer acesso à câmera e localização para validar sua jornada.</p>
                  <div className="flex flex-col gap-3 w-full">
                    <Button onClick={() => { setShowTroubleshoot(false); requestLocation(); if (method === PunchMethod.PHOTO) startCamera(); }} variant="outline" size="sm">Habilitar Acessos</Button>
                    <Button onClick={diagnoseCamera} variant="ghost" size="sm" className="text-xs">
                      <HelpCircle size={14} className="mr-1" /> Diagnóstico
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Photo Requirement Nudge when in other tabs */}
                  {photoRequired && !isPhotoValid && method !== PunchMethod.PHOTO && (
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-30 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
                      <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mb-4 animate-pulse">
                        <Camera size={32} />
                      </div>
                      <p className="text-white font-black text-sm uppercase tracking-widest mb-2">Biometria Obrigatória</p>
                      <p className="text-slate-400 text-xs mb-6 leading-relaxed">Sua empresa exige validação facial para todo registro de ponto.</p>
                      <Button onClick={() => setMethod(PunchMethod.PHOTO)} size="sm" className="rounded-xl px-8 flex items-center gap-2">
                        <Camera size={18} /> Capturar Foto Agora
                      </Button>
                    </div>
                  )}

                  {/* ============================================ */}
                  {/* PHOTO METHOD */}
                  {/* ============================================ */}
                  {method === PunchMethod.PHOTO && (
                    <div className="w-full h-full">
                      {!photo ? (
                        <>
                          {!isCapturing && !showTroubleshoot && (
                            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-30 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
                              <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mb-4 animate-pulse">
                                <Camera size={32} />
                              </div>
                              <p className="text-white font-black text-sm uppercase tracking-widest mb-2">
                                {hasCamera === false ? 'Câmera Não Disponível'
                                  : error ? 'Erro ao Acessar Câmera'
                                    : 'Ativar Câmera'}
                              </p>
                              <p className="text-slate-400 text-xs mb-6 leading-relaxed max-w-xs">
                                {hasCamera === false
                                  ? 'Use o botão abaixo para enviar uma foto do seu dispositivo.'
                                  : error
                                    ? 'Não foi possível acessar a câmera. Tente novamente.'
                                    : 'Toque no botão abaixo para permitir o acesso à câmera.'}
                              </p>
                              {error && <p className="text-red-400 text-xs mb-4 font-medium max-w-xs">{error}</p>}
                              <div className="flex flex-col gap-3 w-full max-w-xs">
                                {hasCamera !== false && (
                                  <Button
                                    onClick={async () => {
                                      setError(null);
                                      setShowTroubleshoot(false);
                                      setIsCapturing(false);
                                      await new Promise(resolve => setTimeout(resolve, 50));
                                      await startCamera();
                                    }}
                                    size="sm"
                                    className="rounded-xl px-8 flex items-center gap-2"
                                  >
                                    <Camera size={18} /> {error ? 'Tentar Novamente' : 'Ativar Câmera'}
                                  </Button>
                                )}
                                <Button
                                  onClick={() => fileInputRef.current?.click()}
                                  variant="outline"
                                  size="sm"
                                  className="rounded-xl px-8 flex items-center gap-2 border-white/20 text-white hover:bg-white/10"
                                >
                                  <Upload size={18} /> Enviar Foto do Dispositivo
                                </Button>
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  accept="image/*"
                                  capture="environment"
                                  onChange={handleFileUpload}
                                  className="hidden"
                                />
                              </div>
                            </div>
                          )}

                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`w-full h-full object-cover scale-x-[-1] ${!isCapturing ? 'opacity-0' : 'opacity-100'}`}
                            onLoadedMetadata={() => {
                              if (videoRef.current) {
                                videoRef.current.play().catch(err => {
                                  setError("Erro ao iniciar a câmera.");
                                  setIsCapturing(false);
                                });
                              }
                            }}
                            onError={() => {
                              setError("Erro ao carregar o vídeo da câmera.");
                              setIsCapturing(false);
                            }}
                          />
                          {isCapturing && (
                            <button
                              onClick={capturePhoto}
                              disabled={!isCapturing || !videoRef.current}
                              className="absolute bottom-8 left-1/2 -translate-x-1/2 w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all z-20 group hover:scale-105 disabled:opacity-50"
                              aria-label="Capturar foto"
                              type="button"
                            >
                              <div className="w-16 h-16 border-[6px] border-indigo-600 rounded-full group-hover:scale-110 transition-transform flex items-center justify-center">
                                <Camera size={24} className="text-indigo-600" />
                              </div>
                            </button>
                          )}
                          <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-full text-[9px] font-black text-white uppercase tracking-widest pointer-events-none flex items-center gap-2">
                            <Camera size={12} /> Posicione seu rosto
                          </div>
                        </>
                      ) : (
                        <div className="relative w-full h-full">
                          <img src={photo} className="w-full h-full object-cover scale-x-[-1]" alt="Visualização biométrica" />
                          <div className="absolute inset-0 border-[12px] border-indigo-500/10 pointer-events-none"></div>
                          <button
                            onClick={() => setPhoto(null)}
                            className="absolute bottom-8 left-1/2 -translate-x-1/2 px-8 py-3 bg-white/20 backdrop-blur-xl text-white rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] border border-white/20 hover:bg-white/30 transition-all"
                          >
                            Recapturar Foto
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============================================ */}
                  {/* GPS METHOD - COM MAPA E GEOCODING */}
                  {/* ============================================ */}
                  {method === PunchMethod.GPS && (
                    <div className="w-full h-full relative overflow-hidden">
                      {location ? (
                        <>
                          {/* Mapa Leaflet */}
                          <LocationMap
                            lat={location.lat}
                            lng={location.lng}
                            accuracy={location.accuracy}
                          />
                          {/* Botão para atualizar GPS */}
                          <button
                            type="button"
                            onClick={requestLocation}
                            disabled={isLocationLoading}
                            className="absolute top-4 right-4 z-[600] inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-900/80 text-slate-200 hover:bg-slate-800 disabled:opacity-60 border border-white/10 shadow-lg"
                            aria-label="Atualizar localização GPS"
                          >
                            <RefreshCw size={16} className={isLocationLoading ? 'animate-spin' : ''} />
                          </button>
                          {/* Overlay de informações sobre o mapa */}
                          <div className="absolute top-0 left-0 right-0 p-4 z-[500]">
                            <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl px-5 py-3 border border-white/10">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest">
                                  Sinal GPS Validado
                                </span>
                              </div>
                              <p className="text-white text-xs font-medium">
                                Precisão: ~{Math.round(location.accuracy)}m
                              </p>
                            </div>
                          </div>
                          {/* Endereço no rodapé do mapa */}
                          <div className="absolute bottom-0 left-0 right-0 p-4 z-[500]">
                            <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl px-5 py-3 border border-white/10">
                              <div className="flex items-center gap-2">
                                <MapPinned size={14} className="text-indigo-400 shrink-0" />
                                {addressLoading ? (
                                  <div className="flex items-center gap-2">
                                    <Loader2 size={12} className="animate-spin text-indigo-400" />
                                    <span className="text-slate-400 text-xs">Identificando endereço...</span>
                                  </div>
                                ) : addressInfo ? (
                                  <span className="text-white text-xs font-medium leading-tight">{addressInfo}</span>
                                ) : (
                                  <span className="text-slate-400 text-xs">
                                    {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white bg-indigo-950 p-10 text-center relative overflow-hidden">
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent"></div>
                          <div className="w-24 h-24 bg-indigo-500/10 border border-indigo-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                            <Navigation
                              size={48}
                              className="text-indigo-400 animate-spin"
                              style={{ animationDuration: '3s' }}
                            />
                          </div>
                          <h4 className="text-xl font-bold mb-2 tracking-tight">Localizando...</h4>
                          <div className="flex items-center gap-2 text-indigo-400">
                            <Loader2 size={16} className="animate-spin" />
                            <span className="text-xs font-bold uppercase tracking-widest">
                              Sincronizando satélites...
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============================================ */}
                  {/* BIOMETRIC METHOD */}
                  {/* ============================================ */}
                  {method === PunchMethod.BIOMETRIC && (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center relative overflow-hidden bg-gradient-to-b from-violet-950 to-slate-950">
                      {/* Background decoration */}
                      <div className="absolute inset-0">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-violet-500/5 rounded-full blur-3xl"></div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 border border-violet-500/10 rounded-full"></div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 border border-violet-500/5 rounded-full"></div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 border border-violet-500/[0.03] rounded-full"></div>
                      </div>

                      <div className="relative z-10">
                        {biometricVerified ? (
                          // SUCESSO - Biometria verificada
                          <>
                            <div className="w-24 h-24 bg-green-500/20 border-2 border-green-500/30 rounded-full flex items-center justify-center mb-6 mx-auto animate-in zoom-in duration-500">
                              <Check size={48} className="text-green-400" strokeWidth={3} />
                            </div>
                            <h4 className="text-xl font-bold mb-2 text-white tracking-tight">Identidade Confirmada</h4>
                            <p className="text-green-400 text-sm font-medium mb-1">{biometricDeviceName}</p>
                            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
                              Autenticação biométrica validada
                            </p>
                          </>
                        ) : biometricLoading ? (
                          // LOADING - Aguardando biometria
                          <>
                            <div className="w-24 h-24 bg-violet-500/20 border-2 border-violet-500/30 rounded-full flex items-center justify-center mb-6 mx-auto">
                              <ScanLine size={48} className="text-violet-400 animate-pulse" />
                            </div>
                            <h4 className="text-xl font-bold mb-2 text-white tracking-tight">
                              Use seu sensor biométrico
                            </h4>
                            <div className="flex items-center gap-2 text-violet-400 justify-center">
                              <Loader2 size={16} className="animate-spin" />
                              <span className="text-xs font-bold uppercase tracking-widest">Aguardando autenticação...</span>
                            </div>
                          </>
                        ) : biometricRegistered ? (
                          // JÁ REGISTRADO - Pedir autenticação
                          <>
                            <div className="w-24 h-24 bg-violet-500/10 border border-violet-500/20 rounded-full flex items-center justify-center mb-6 mx-auto group cursor-pointer hover:bg-violet-500/20 transition-all"
                              onClick={handleBiometricAuth}>
                              <ScanLine size={48} className="text-violet-400 group-hover:scale-110 transition-transform" />
                            </div>
                            <h4 className="text-xl font-bold mb-2 text-white tracking-tight">Autenticação Biométrica</h4>
                            <p className="text-slate-400 text-xs mb-1">{biometricDeviceName}</p>
                            <p className="text-violet-400/60 text-[10px] mb-6 font-bold uppercase tracking-widest">
                              Toque no sensor para validar
                            </p>
                            <Button
                              onClick={handleBiometricAuth}
                              size="sm"
                              className="rounded-xl px-8 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 shadow-xl shadow-violet-600/20"
                            >
                              <ScanLine size={18} /> Verificar Agora
                            </Button>
                          </>
                        ) : (
                          // NÃO REGISTRADO - Primeiro uso
                          <>
                            <div className="w-24 h-24 bg-violet-500/10 border border-violet-500/20 rounded-full flex items-center justify-center mb-6 mx-auto">
                              <ScanLine size={48} className="text-violet-400" />
                            </div>
                            <h4 className="text-xl font-bold mb-2 text-white tracking-tight">Configurar Biometria</h4>
                            <p className="text-slate-400 text-xs mb-6 leading-relaxed max-w-xs mx-auto">
                              Registre sua impressão digital ou Face ID para validar seus registros de ponto com segurança.
                            </p>
                            <Button
                              onClick={handleBiometricRegister}
                              size="sm"
                              className="rounded-xl px-8 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 shadow-xl shadow-violet-600/20"
                            >
                              <ScanLine size={18} /> Registrar Biometria
                            </Button>
                            <p className="text-slate-600 text-[9px] mt-4 font-bold uppercase tracking-widest">
                              Necessário apenas na primeira vez
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ============================================ */}
                  {/* MANUAL METHOD */}
                  {/* ============================================ */}
                  {method === PunchMethod.MANUAL && (
                    <div className="w-full h-full p-10 bg-slate-50 dark:bg-slate-800 flex flex-col">
                      <textarea
                        value={justification}
                        onChange={(e) => setJustification(e.target.value)}
                        placeholder="Descreva o motivo desta marcação manual (obrigatório)..."
                        className="flex-1 w-full p-6 bg-white dark:bg-slate-700 border-none rounded-[1.5rem] text-sm font-medium outline-none focus:ring-4 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 transition-all resize-none shadow-inner"
                      />
                      <p className="mt-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Registro sujeito à auditoria da gerência</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400 text-xs font-bold animate-in shake duration-500">
                <AlertCircle size={16} /> <span>{error}</span>
              </div>
            )}

            {/* Status indicators */}
            <div className="grid grid-cols-3 gap-3">
              <div className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${location ? 'bg-green-50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30 text-green-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${location ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                  {location ? <Check size={14} strokeWidth={3} /> : <MapPin size={12} />}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">GPS</span>
              </div>
              <div className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${isPhotoValid ? 'bg-green-50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30 text-green-700' : (photoRequired ? 'bg-amber-50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/30 text-amber-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400')}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isPhotoValid ? 'bg-green-500 text-white' : (photoRequired ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-700')}`}>
                  {isPhotoValid ? <Check size={14} strokeWidth={3} /> : <Camera size={12} />}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">Foto</span>
              </div>
              <div className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${biometricVerified ? 'bg-green-50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30 text-green-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${biometricVerified ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                  {biometricVerified ? <Check size={14} strokeWidth={3} /> : <ScanLine size={12} />}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">Bio</span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-10 py-8 bg-slate-50 dark:bg-slate-800/50 flex gap-4 sticky bottom-0">
          <button onClick={onClose} className="flex-1 py-4 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-800 rounded-2xl transition-all text-xs uppercase tracking-widest">Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!isFormValid}
            className="flex-2 px-10 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-600/20 transition-all disabled:opacity-40 disabled:grayscale text-xs uppercase tracking-widest flex items-center justify-center gap-2 focus:ring-4 focus:ring-indigo-500/50 outline-none"
          >
            {isFormValid ? <ShieldCheck size={18} /> : (photoRequired && !isPhotoValid ? <AlertTriangle size={18} /> : <Loader2 size={18} className="animate-spin" />)}
            Confirmar Ponto
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default PunchModal;
