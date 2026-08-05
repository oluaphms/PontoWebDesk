/**
 * Reduz fotos antes do POST JSON/base64.
 * Nginx na VPS usa client_max_body_size default (1m) até o deploy do proxy;
 * payloads grandes geram 413 sem CORS → browser mostra "Failed to fetch".
 */

export type CompressImageProfile = 'avatar' | 'punchPhoto';

const PROFILE_DEFAULTS: Record<
  CompressImageProfile,
  { maxDimension: number; maxBinaryBytes: number; initialQuality: number }
> = {
  avatar: { maxDimension: 640, maxBinaryBytes: 400 * 1024, initialQuality: 0.82 },
  punchPhoto: { maxDimension: 1280, maxBinaryBytes: 600 * 1024, initialQuality: 0.8 },
};

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    img.src = dataUrl;
  });
}

function scaledSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao comprimir imagem.'))),
      'image/jpeg',
      quality,
    );
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler blob.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageDataUrl(
  dataUrl: string,
  profile: CompressImageProfile,
): Promise<{ dataUrl: string; mimeType: string; byteLength: number }> {
  if (typeof document === 'undefined') {
    return { dataUrl, mimeType: 'image/jpeg', byteLength: 0 };
  }

  const { maxDimension, maxBinaryBytes, initialQuality } = PROFILE_DEFAULTS[profile];
  const img = await loadImage(dataUrl);
  const { width, height } = scaledSize(img.width, img.height, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para compressão.');
  ctx.drawImage(img, 0, 0, width, height);

  let quality = initialQuality;
  let blob = await canvasToJpegBlob(canvas, quality);
  while (blob.size > maxBinaryBytes && quality > 0.45) {
    quality = Math.max(0.45, quality - 0.08);
    blob = await canvasToJpegBlob(canvas, quality);
  }

  const compressed = await blobToDataUrl(blob);
  return { dataUrl: compressed, mimeType: 'image/jpeg', byteLength: blob.size };
}
