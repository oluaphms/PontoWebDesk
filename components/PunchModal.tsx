
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { LogType, PunchMethod, User, Company } from '../types';
import { Camera, MapPin, Keyboard, X, Check, AlertTriangle, ShieldCheck, RefreshCw, Settings2, HelpCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button, LoadingState, Badge } from './UI';
import { PontoService } from '../services/pontoService';

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
  
  // Garantir que showTroubleshoot seja false quando o modal abre com método PHOTO
  useEffect(() => {
    if (method === PunchMethod.PHOTO) {
      console.log('Modal aberto com método PHOTO - resetando showTroubleshoot');
      setShowTroubleshoot(false);
      setIsCapturing(false);
    }
  }, []);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    PontoService.getCompany(user.companyId).then(comp => {
      if (comp) {
        setCompany(comp);
        // Se houver método inicial definido, usar ele
        if (initialMethod) {
          setMethod(initialMethod);
        } else if (comp.settings.requirePhoto) {
          // Prioritize PHOTO method if mandatory, otherwise default to GPS for convenience
          setMethod(PunchMethod.PHOTO);
        } else {
          setMethod(PunchMethod.GPS);
        }
      }
    });
  }, [user.companyId, initialMethod]);

  // Atualizar método quando initialMethod mudar (importante quando vem do modal de seleção)
  useEffect(() => {
    if (initialMethod) {
      setMethod(initialMethod);
      // Resetar foto quando mudar de método para garantir que a câmera seja reiniciada
      if (initialMethod === PunchMethod.PHOTO) {
        setPhoto(null);
        setError(null);
        setShowTroubleshoot(false); // Sempre resetar troubleshoot quando mudar para PHOTO
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setIsLocationLoading(false);
      },
      (err) => {
        // Não bloquear a câmera por erro de GPS - apenas mostrar aviso
        // setShowTroubleshoot(true); // Removido para não bloquear overlay da câmera
        setIsLocationLoading(false);
        // O erro de GPS será mostrado na seção de status, não bloqueia a câmera
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  // Resetar showTroubleshoot quando o método muda para PHOTO
  useEffect(() => {
    if (method === PunchMethod.PHOTO) {
      setShowTroubleshoot(false);
    }
  }, [method]);

  const startCamera = useCallback(async () => {
    console.log('🎬 startCamera chamada');
    setError(null);
    setIsCapturing(false);
    
    // Verificar se getUserMedia está disponível
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Seu navegador não suporta acesso à câmera. Use Chrome, Firefox ou Safari atualizado.");
      // Não definir showTroubleshoot - deixar o overlay aparecer para o usuário tentar novamente
      return;
    }

    // Verificar se está em HTTPS (requerido para getUserMedia em produção)
    const currentLocation = window.location;
    if (currentLocation.protocol !== 'https:' && currentLocation.hostname !== 'localhost' && currentLocation.hostname !== '127.0.0.1') {
      setError("Acesso à câmera requer conexão segura (HTTPS). Certifique-se de estar usando HTTPS.");
      // Não definir showTroubleshoot - deixar o overlay aparecer para o usuário tentar novamente
      return;
    }

    // Aguardar um pouco para garantir que o elemento de vídeo está no DOM
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // Parar qualquer stream existente primeiro
      if (videoRef.current?.srcObject) {
        const existingStream = videoRef.current.srcObject as MediaStream;
        existingStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      console.log('Solicitando acesso à câmera...');

      // NOTA: Não verificar enumerateDevices() antes de solicitar permissão
      // porque os dispositivos só aparecem com labels após permissão ser concedida
      // Vamos tentar getUserMedia diretamente - se não houver câmera, retornará erro específico

      // Tentar com configurações progressivas
      console.log('Tentando obter stream com diferentes configurações...');
      let stream: MediaStream | null = null;
      let lastError: any = null;
      const videoConstraints = [
        { 
          video: { 
            facingMode: 'user', 
            width: { ideal: 640 }, 
            height: { ideal: 640 } 
          } 
        },
        { 
          video: { 
            facingMode: 'user', 
            width: { ideal: 480 }, 
            height: { ideal: 480 } 
          } 
        },
        { video: { facingMode: 'user' } },
        { video: true }
      ];

      for (let i = 0; i < videoConstraints.length; i++) {
        const constraints = videoConstraints[i];
        try {
          console.log(`Tentativa ${i + 1}/${videoConstraints.length} com configurações:`, JSON.stringify(constraints));
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('✅ Acesso à câmera concedido com configurações:', JSON.stringify(constraints));
          break;
        } catch (err: any) {
          lastError = err;
          console.log(`❌ Falha na tentativa ${i + 1}:`, err.name, err.message);
          if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
          }
        }
      }

      console.log('🔍 Após loop - stream:', !!stream, 'lastError:', lastError?.name, lastError?.message);
      console.log('🔍 lastError completo:', lastError);

      if (!stream) {
        console.log('❌ Nenhum stream obtido após todas as tentativas. Último erro:', lastError);
        console.log('❌ Vou definir o erro agora...');
        // Tratar erros comuns com mensagens mais específicas para ajudar no debug
        if (lastError) {
          const name = lastError.name;
          console.log('Tipo de erro:', name);
          if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
            console.log('Permissão negada');
            setError("Câmera bloqueada. Toque em 'Ativar Câmera' novamente e permita o acesso à câmera quando solicitado.");
            setIsCapturing(false);
            setShowTroubleshoot(false);
            return;
          }
          if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
            console.log('Câmera não encontrada - pode ser que não haja câmera ou permissão não foi concedida');
            console.log('Definindo erro e estados...');
            setError("Nenhuma câmera encontrada. Verifique se há uma câmera conectada ou integrada ao dispositivo.");
            setIsCapturing(false);
            setShowTroubleshoot(false);
            console.log('Estados definidos - erro deve aparecer no overlay');
            return;
          }
          if (name === 'NotReadableError' || name === 'TrackStartError') {
            console.log('Câmera em uso');
            setError("Câmera está sendo usada por outro aplicativo. Feche outros apps e tente novamente.");
            setIsCapturing(false);
            setShowTroubleshoot(false);
            return;
          }

          // Mensagem fallback incluindo detalhe do último erro
          console.log('Erro desconhecido:', lastError);
          setError(`Não foi possível acessar a câmera: ${lastError.message || lastError}. Tente novamente.`);
          setIsCapturing(false);
          setShowTroubleshoot(false);
          return;
        }

        console.log('Nenhum erro específico capturado');
        setError('Não foi possível acessar a câmera. Tente novamente.');
        setIsCapturing(false);
        setShowTroubleshoot(false);
        return;
      }
      
      if (!videoRef.current) {
        console.warn('Elemento de vídeo não encontrado após obter stream');
        stream.getTracks().forEach(track => track.stop());
        setError("Elemento de vídeo não encontrado. Recarregue a página.");
        return;
      }

      console.log('Stream obtido, atribuindo ao elemento de vídeo...');
      videoRef.current.srcObject = stream;
      console.log('Stream atribuído, aguardando metadata...');
      
      // Aguardar o vídeo estar pronto
      await new Promise((resolve, reject) => {
        if (!videoRef.current) {
          console.error('Elemento de vídeo perdido durante espera de metadata');
          reject(new Error('Elemento de vídeo perdido'));
          return;
        }

        const timeout = setTimeout(() => {
          console.error('Timeout ao carregar vídeo (10s)');
          reject(new Error('Timeout ao carregar vídeo'));
        }, 10000);

        videoRef.current.onloadedmetadata = () => {
          console.log('Metadata do vídeo carregado');
          clearTimeout(timeout);
          resolve(void 0);
        };

        videoRef.current.onerror = (e) => {
          console.error('Erro no elemento de vídeo durante carregamento:', e);
          clearTimeout(timeout);
          reject(e);
        };
      });
      
      console.log('Tentando reproduzir vídeo...');
      // Tentar reproduzir
      try {
        await videoRef.current.play();
        setIsCapturing(true);
        setError(null);
        console.log('✅ Vídeo iniciado com sucesso - câmera ativa!');
      } catch (playErr) {
        console.error('❌ Erro ao reproduzir vídeo:', playErr);
        setError("Erro ao iniciar a visualização da câmera. Tente recarregar a página.");
        setIsCapturing(false);
      }

    } catch (err: any) {
      console.error('❌ Erro ao acessar câmera:', err);
      console.error('Detalhes do erro:', { name: err.name, message: err.message, stack: err.stack });
      setIsCapturing(false);
      
      // Parar qualquer stream que possa ter sido iniciado
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      // Tratar erros específicos mas não definir showTroubleshoot - permitir nova tentativa
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.log('Permissão negada - usuário precisa permitir acesso');
        setError("Câmera bloqueada. Toque em 'Ativar Câmera' novamente e permita o acesso quando solicitado.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        console.log('Nenhuma câmera encontrada');
        setError("Nenhuma câmera encontrada. Verifique se há uma câmera conectada e tente novamente.");
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        console.log('Câmera em uso por outro app');
        setError("Câmera está sendo usada por outro aplicativo. Feche outros apps e tente novamente.");
      } else if (err.name === 'OverconstrainedError') {
        console.log('Configuração não suportada, tentando alternativa...');
        setError("Configuração da câmera não suportada. Tentando configuração alternativa...");
        // Tentar com configuração mais simples
        try {
           console.log('Tentando com configuração básica...');
           const simpleStream = await navigator.mediaDevices.getUserMedia({ video: true });
           if (videoRef.current) {
             videoRef.current.srcObject = simpleStream;
             await videoRef.current.play();
             setIsCapturing(true);
             setError(null);
             console.log('✅ Câmera iniciada com configuração alternativa');
           }
        } catch (retryErr) {
           console.error('❌ Erro na tentativa alternativa:', retryErr);
           setError("Não foi possível acessar a câmera. Tente novamente.");
        }
        return;
      } else {
        console.log('Erro desconhecido:', err);
        setError(`Erro ao acessar a câmera: ${err.message || 'Erro desconhecido'}. Tente novamente.`);
      }
      // Não definir showTroubleshoot aqui - deixar o usuário tentar novamente através do overlay
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
      
      // Em dispositivos móveis, não tentar iniciar automaticamente
      // getUserMedia requer gesto do usuário em muitos navegadores móveis
      // O overlay "Ativar Câmera" será mostrado para o usuário clicar
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      if (!isMobile) {
        // Apenas em desktop, tentar iniciar automaticamente
        cameraTimeout = setTimeout(async () => {
          if (mounted && method === PunchMethod.PHOTO && !photo && !showTroubleshoot && !error) {
            console.log('Tentando iniciar câmera automaticamente (desktop)...');
            await startCamera();
          }
        }, 200);
      } else {
        console.log('Dispositivo móvel detectado - câmera será ativada pelo gesto do usuário');
      }
    };

    // Iniciar câmera apenas se:
    // 1. Método é PHOTO
    // 2. Não há foto capturada
    // 3. Não está em modo troubleshoot
    // 4. Câmera não está já capturando
    // Nota: Em dispositivos móveis, pode ser necessário que o usuário clique no botão "Ativar Câmera"
    // devido a restrições de segurança do navegador (getUserMedia requer gesto do usuário)
    if (method === PunchMethod.PHOTO && !photo && !showTroubleshoot && !isCapturing) {
      console.log('Condições para iniciar câmera:', { method, photo: !!photo, showTroubleshoot, isCapturing, error });
      initializeCamera();
    } else if (method !== PunchMethod.PHOTO || photo) {
      // Parar câmera apenas se mudou de método ou já tem foto
      stopCamera();
    }
    
    return () => {
      mounted = false;
      if (cameraTimeout) {
        clearTimeout(cameraTimeout);
      }
      stopCamera();
    };
  }, [method, photo, showTroubleshoot, startCamera, stopCamera]);

  const capturePhoto = async () => {
    try {
      if (!videoRef.current || !canvasRef.current) {
        setError("Câmera não está pronta. Aguarde um momento e tente novamente.");
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Aguardar um pouco para garantir que o vídeo está pronto
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        if (video.readyState === video.HAVE_ENOUGH_DATA && 
            video.videoWidth > 0 && 
            video.videoHeight > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // Verificação final
      if (video.readyState !== video.HAVE_ENOUGH_DATA || 
          video.videoWidth === 0 || 
          video.videoHeight === 0) {
        setError("A câmera não está pronta. Aguarde a inicialização completa e tente novamente.");
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        setError("Erro ao acessar o canvas. Tente novamente.");
        return;
      }

      // Definir dimensões do canvas baseado no vídeo
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Limpar canvas antes de desenhar
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Capturar frame do vídeo
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Converter para base64 com qualidade razoável
      const data = canvas.toDataURL('image/jpeg', 0.85);
      
      // Validação mais rigorosa
      if (!data || data.length < 1000) {
        setError("Erro ao capturar foto. A imagem capturada é muito pequena. Tente novamente.");
        return;
      }

      // Verificar se é uma imagem válida
      if (!data.startsWith('data:image/')) {
        setError("Formato de imagem inválido. Tente novamente.");
        return;
      }

      // Salvar foto e parar câmera
      setPhoto(data);
      stopCamera();
      setError(null);
      console.log('Foto capturada com sucesso, tamanho:', data.length, 'bytes');
    } catch (err) {
      console.error('Erro ao capturar foto:', err);
      setError("Erro ao capturar foto. Verifique as permissões da câmera e tente novamente.");
    }
  };

  const diagnoseCamera = async () => {
    const diagnostics = {
      userAgent: navigator.userAgent,
      https: window.location.protocol === 'https:',
      hostname: window.location.hostname,
      getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      videoElement: !!videoRef.current,
      videoSrcObject: !!videoRef.current?.srcObject,
      videoReadyState: videoRef.current?.readyState,
      videoWidth: videoRef.current?.videoWidth,
      videoHeight: videoRef.current?.videoHeight,
      isCapturing,
      error,
      permissions: {}
    };

    try {
      const cameraPermission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      (diagnostics.permissions as any).camera = cameraPermission.state;
    } catch (e) {
      (diagnostics.permissions as any).camera = 'unsupported';
    }

    console.log('=== DIAGNÓSTICO DA CÂMERA ===');
    console.log(JSON.stringify(diagnostics, null, 2));
    
    setError(`Diagnóstico executado. Verifique o console do navegador (F12) para detalhes.`);
  };

  const isPhotoValid = useMemo(() => {
    if (!photo) return false;
    // Strict validation: check for valid data URL and minimum data size (approx > 5kb)
    return photo.startsWith('data:image/jpeg;base64,') && photo.length > 2000;
  }, [photo]);

  const photoRequired = useMemo(() => {
    return (company?.settings.requirePhoto ?? false) || method === PunchMethod.PHOTO;
  }, [method, company]);

  const isFormValid = useMemo(() => {
    if (!company) return false;
    
    // 1. Hard Photo Check
    if (photoRequired && !isPhotoValid) return false;
    
    // 2. Manual Justification Check
    if (method === PunchMethod.MANUAL && !justification.trim()) return false;
    
    // 3. Location Check for non-manual methods
    if (method !== PunchMethod.MANUAL && (!location || !location.lat)) return false;
    
    return true;
  }, [company, photoRequired, isPhotoValid, method, justification, location]);

  const handleConfirm = () => {
    // Final defensive validation
    if (photoRequired && !isPhotoValid) {
      setError("Captura de foto biométrica obrigatória.");
      setMethod(PunchMethod.PHOTO);
      return;
    }

    if (method === PunchMethod.MANUAL && !justification.trim()) {
      setError("Justificativa obrigatória para registro manual.");
      return;
    }

    if (method !== PunchMethod.MANUAL && (!location || !location.lat)) {
      setError("Localização não identificada. Verifique seu GPS.");
      return;
    }

    onConfirm(method, { photo: photo || undefined, justification, location });
  };

  if (!company) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300">
      <div 
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/10 outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="px-10 py-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
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
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-[1.5rem] mb-8">
            {[
              { id: PunchMethod.PHOTO, icon: Camera, label: company.settings.requirePhoto ? 'Biometria *' : 'Foto', color: 'indigo' },
              { id: PunchMethod.GPS, icon: MapPin, label: 'GPS', color: 'blue' },
              ...(company.settings.allowManualPunch ? [{ id: PunchMethod.MANUAL, icon: Keyboard, label: 'Manual', color: 'slate' }] : [])
            ].map((m) => (
              <button 
                key={m.id}
                onClick={() => { setMethod(m.id as PunchMethod); setError(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${method === m.id ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <m.icon size={18} className={method === m.id ? 'text-indigo-600 dark:text-indigo-400' : ''} /> {m.label}
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
                     <Button onClick={() => { setShowTroubleshoot(false); requestLocation(); if(method === PunchMethod.PHOTO) startCamera(); }} variant="outline" size="sm">Habilitar Acessos</Button>
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

                  {method === PunchMethod.PHOTO && (
                    <div className="w-full h-full">
                      {!photo ? (
                        <>
                          {/* Overlay quando câmera não está ativa */}
                          {/* Em dispositivos móveis, o overlay sempre aparece inicialmente para garantir gesto do usuário */}
                          {(() => {
                            const shouldShow = !isCapturing && !showTroubleshoot;
                            console.log('🔍 Verificando overlay:', { 
                              shouldShow, 
                              isCapturing, 
                              showTroubleshoot, 
                              error, 
                              method,
                              photo: !!photo
                            });
                            return shouldShow;
                          })() && (
                            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-30 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
                              <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mb-4 animate-pulse">
                                <Camera size={32} />
                              </div>
                              <p className="text-white font-black text-sm uppercase tracking-widest mb-2">
                                {error ? 'Erro ao Acessar Câmera' : 'Ativar Câmera'}
                              </p>
                              <p className="text-slate-400 text-xs mb-6 leading-relaxed">
                                {error 
                                  ? 'Não foi possível acessar a câmera. Toque no botão abaixo para tentar novamente.'
                                  : 'Toque no botão abaixo para permitir o acesso à câmera e iniciar a captura.'}
                              </p>
                              {error && (
                                <p className="text-red-400 text-xs mb-4 font-medium max-w-xs">{error}</p>
                              )}
                              <Button 
                                onClick={async () => {
                                  try {
                                    // Resetar todos os estados de erro antes de tentar novamente
                                    setError(null);
                                    setShowTroubleshoot(false);
                                    setIsCapturing(false);
                                    
                                    // Pequeno delay para garantir que os estados foram atualizados
                                    await new Promise(resolve => setTimeout(resolve, 50));
                                    
                                    // Tentar iniciar a câmera
                                    await startCamera();
                                  } catch (err) {
                                    console.error('Erro ao ativar câmera:', err);
                                    setError("Erro ao ativar a câmera. Verifique as permissões do navegador.");
                                    setIsCapturing(false);
                                  }
                                }}
                                size="sm" 
                                className="rounded-xl px-8 flex items-center gap-2"
                              >
                                <Camera size={18} /> {error ? 'Tentar Novamente' : 'Ativar Câmera'}
                              </Button>
                            </div>
                          )}
                          
                          <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            muted
                            className={`w-full h-full object-cover scale-x-[-1] ${!isCapturing ? 'opacity-0' : 'opacity-100'}`}
                            onLoadedMetadata={() => {
                              // Garantir que o vídeo está pronto
                              if (videoRef.current) {
                                videoRef.current.play().catch(err => {
                                  console.error('Erro ao reproduzir vídeo:', err);
                                  setError("Erro ao iniciar a câmera. Tente novamente.");
                                  setIsCapturing(false);
                                });
                              }
                            }}
                            onError={(e) => {
                              console.error('Erro no elemento de vídeo:', e);
                              setError("Erro ao carregar o vídeo da câmera.");
                              setIsCapturing(false);
                            }}
                          />
                          {/* Botão de captura - só aparece quando câmera está ativa */}
                          {isCapturing && (
                            <button
                              onClick={capturePhoto}
                              disabled={!isCapturing || !videoRef.current}
                              className="absolute bottom-8 left-1/2 -translate-x-1/2 w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all z-20 group hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
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

                  {method === PunchMethod.GPS && (
                    <div className="w-full h-full flex flex-col items-center justify-center text-white bg-indigo-950 p-10 text-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent"></div>
                      <div className="w-24 h-24 bg-indigo-500/10 border border-indigo-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                        <MapPin size={48} className="text-indigo-400" />
                      </div>
                      <h4 className="text-xl font-bold mb-2 tracking-tight">Geolocalização Ativa</h4>
                      {location ? (
                        <div className="space-y-1">
                           <p className="text-sm text-indigo-300 font-medium">Sinal validado com sucesso</p>
                           <p className="text-[10px] text-indigo-500 font-black uppercase tracking-widest">Precisão: {Math.round(location.accuracy)}m</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-indigo-400">
                          <Loader2 size={16} className="animate-spin" />
                          <span className="text-xs font-bold uppercase tracking-widest">Sincronizando satélites...</span>
                        </div>
                      )}
                    </div>
                  )}

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

            <div className="grid grid-cols-2 gap-4">
               <div className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${location ? 'bg-green-50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30 text-green-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400'}`}>
                 <div className={`w-6 h-6 rounded-full flex items-center justify-center ${location ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'}`}>
                   {location ? <Check size={14} strokeWidth={3} /> : <MapPin size={12} />}
                 </div>
                 <span className="text-[10px] font-bold uppercase tracking-widest">GPS OK</span>
               </div>
               <div className={`p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${isPhotoValid ? 'bg-green-50 dark:bg-green-950/10 border-green-200 dark:border-green-900/30 text-green-700' : (photoRequired ? 'bg-amber-50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900/30 text-amber-700' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400')}`}>
                 <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isPhotoValid ? 'bg-green-500 text-white' : (photoRequired ? 'bg-amber-500 text-white' : 'bg-slate-200 dark:bg-slate-700')}`}>
                   {isPhotoValid ? <Check size={14} strokeWidth={3} /> : <Camera size={12} />}
                 </div>
                 <span className="text-[10px] font-bold uppercase tracking-widest">Biometria</span>
               </div>
            </div>
          </div>
        </div>

        <div className="px-10 py-8 bg-slate-50 dark:bg-slate-800/50 flex gap-4">
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
