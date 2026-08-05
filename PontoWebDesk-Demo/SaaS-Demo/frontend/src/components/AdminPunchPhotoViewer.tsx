import { useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import { refreshAdminPhotoUrl } from '../services/adminPhotoAccess.service';
import { logger } from '../shared/logger/logger';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

type AdminPunchPhotoViewerProps = {
  photoUrl?: string | null;
  label?: string;
};

function pickPhotoUrlFromObject(obj: Record<string, unknown>): string | null {
  const direct = obj.photo_url ?? obj.photoUrl;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const payload = obj.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const nested = (payload as Record<string, unknown>).photo_url ?? (payload as Record<string, unknown>).photoUrl;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return null;
}

/** Resolve URL da selfie em time_records (coluna, raw_data ou metadata legado). */
export function resolvePunchPhotoUrl(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const row = record as Record<string, unknown>;
  const fromRow = pickPhotoUrlFromObject(row);
  if (fromRow) {
    observabilityConsole.info('[SELFIE-FLOW] selfie encontrada no registro', { source: 'row' });
    return fromRow;
  }
  const rawData = row.raw_data;
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    const fromRaw = pickPhotoUrlFromObject(rawData as Record<string, unknown>);
    if (fromRaw) {
      observabilityConsole.info('[SELFIE-FLOW] selfie encontrada no registro', { source: 'raw_data' });
      return fromRaw;
    }
  }
  const metadata = row.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const fromMeta = pickPhotoUrlFromObject(metadata as Record<string, unknown>);
    if (fromMeta) {
      observabilityConsole.info('[SELFIE-FLOW] selfie encontrada no registro', { source: 'metadata' });
      return fromMeta;
    }
  }
  return null;
}

export function AdminPunchPhotoViewer({ photoUrl, label = 'Ver foto' }: AdminPunchPhotoViewerProps) {
  const [open, setOpen] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!photoUrl) return <span className="text-slate-400">—</span>;

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      observabilityConsole.info('[SELFIE-FLOW] selfie renderizada (abrindo viewer)', { hasUrl: Boolean(photoUrl) });
      const nextUrl = await refreshAdminPhotoUrl(photoUrl);
      setSignedUrl(nextUrl);
    } catch (err) {
      logger.warn({
        module: 'admin.photo-viewer',
        action: 'ADMIN_PHOTO_LOAD_FAILED',
        message: 'Falha ao carregar foto de ponto para admin',
        error: err,
      });
      setError('Não foi possível carregar a foto.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
      >
        <Camera className="h-3.5 w-3.5" />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Foto da marcação</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">URL temporária e assinada para visualização administrativa.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                aria-label="Fechar foto"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-[280px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando foto...
                </div>
              ) : error ? (
                <div className="p-6 text-center text-sm text-red-600 dark:text-red-300">{error}</div>
              ) : signedUrl ? (
                <img
                  src={signedUrl}
                  alt="Foto da marcação de ponto"
                  className="max-h-[70vh] w-auto max-w-full object-contain"
                  loading="eager"
                  decoding="async"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
