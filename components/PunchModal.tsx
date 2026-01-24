
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LogType, PunchMethod, User, Company } from '../types';
import { Camera, MapPin, Keyboard, X, Check, AlertTriangle, ShieldCheck, RefreshCw, Settings2, HelpCircle, Loader2, CameraIcon, AlertCircle } from 'lucide-react';
import { Button, LoadingState, Badge } from './UI';
import { PontoService } from '../services/pontoService';

interface PunchModalProps {
  user: User;
  type: LogType;
  onClose: () => void;
  onConfirm: (method: PunchMethod, data: { photo?: string, justification?: string, location?: any }) => void;
}

const PunchModal: React.FC<PunchModalProps> = ({ user, type, onClose, onConfirm }) => {
  const [company, setCompany] = useState<Company | null>(null);
  const [method, setMethod] = useState<PunchMethod>(PunchMethod.PHOTO);
  const [photo, setPhoto] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [location, setLocation] = useState<any>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    PontoService.getCompany(user.companyId).then(comp => {
      if (comp) {
        setCompany(comp);
        // Prioritize PHOTO method if mandatory, otherwise default to GPS for convenience
        if (comp.settings.requirePhoto) {
          setMethod(PunchMethod.PHOTO);
        } else {
          setMethod(PunchMethod.GPS);
        }
      }
    });
  }, [user.companyId]);

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
        setError("Acesso ao GPS negado. Verifique as permissões de localização do seu navegador.");
        setShowTroubleshoot(true);
        setIsLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCapturing(true);
      }
    } catch (err) {
      setError("Câmera bloqueada. Permita o acesso para realizar a biometria.");
      setShowTroubleshoot(true);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    if (method === PunchMethod.PHOTO && !photo && !showTroubleshoot) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [method, photo, showTroubleshoot]);

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        const data = canvasRef.current.toDataURL('image/jpeg', 0.8);
        setPhoto(data);
        stopCamera();
        setError(null);
      }
    }
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xl animate-in fade-in duration-300">
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
              { id: PunchMethod.PHOTO, icon: Camera, label: company.settings.requirePhoto ? 'Biometria *' : 'Foto' },
              { id: PunchMethod.GPS, icon: MapPin, label: 'GPS' },
              ...(company.settings.allowManualPunch ? [{ id: PunchMethod.MANUAL, icon: Keyboard, label: 'Manual' }] : [])
            ].map((m) => (
              <button 
                key={m.id}
                onClick={() => { setMethod(m.id as PunchMethod); setError(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${method === m.id ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                <m.icon size={16} /> {m.label}
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
                   <Button onClick={() => { setShowTroubleshoot(false); requestLocation(); if(method === PunchMethod.PHOTO) startCamera(); }} variant="outline" size="sm">Habilitar Acessos</Button>
                </div>
              ) : (
                <>
                  {/* Photo Requirement Nudge when in other tabs */}
                  {photoRequired && !isPhotoValid && method !== PunchMethod.PHOTO && (
                    <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-30 flex flex-col items-center justify-center p-8 text-center animate-in fade-in">
                        <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mb-4">
                           <CameraIcon size={32} />
                        </div>
                        <p className="text-white font-black text-sm uppercase tracking-widest">Biometria Obrigatória</p>
                        <p className="text-slate-400 text-xs mt-2 mb-6 leading-relaxed">Sua empresa exige validação facial para todo registro de ponto.</p>
                        <Button onClick={() => setMethod(PunchMethod.PHOTO)} size="sm" className="rounded-xl px-8">Capturar Agora</Button>
                    </div>
                  )}

                  {method === PunchMethod.PHOTO && (
                    <div className="w-full h-full">
                      {!photo ? (
                        <>
                          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover scale-x-[-1]" />
                          <button 
                            onClick={capturePhoto}
                            className="absolute bottom-8 left-1/2 -translate-x-1/2 w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-all z-20 group"
                          >
                            <div className="w-16 h-16 border-[6px] border-indigo-600 rounded-full group-hover:scale-110 transition-transform"></div>
                          </button>
                          <div className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-full text-[9px] font-black text-white uppercase tracking-widest pointer-events-none">
                             Posicione seu rosto
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
