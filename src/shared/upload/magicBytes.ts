export type DetectedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type DetectedDocumentMime =
  | 'text/plain'
  | 'application/pdf'
  | 'application/zip'
  | 'application/vnd.ms-excel'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function matchAt(buf: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** Assinaturas binárias conhecidas (executáveis, etc.) — rejeitar em uploads de texto. */
const BINARY_REJECT_SIGNATURES: Array<{ name: string; bytes: readonly number[]; offset?: number }> = [
  { name: 'pe', bytes: [0x4d, 0x5a] },
  { name: 'elf', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { name: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { name: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: 'gzip', bytes: [0x1f, 0x8b] },
  { name: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { name: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
];

export function detectImageMime(buf: Uint8Array): DetectedImageMime | null {
  if (matchAt(buf, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (matchAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (matchAt(buf, 0, [0x52, 0x49, 0x46, 0x46]) && matchAt(buf, 8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

export function detectDocumentMime(buf: Uint8Array): DetectedDocumentMime | null {
  if (matchAt(buf, 0, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (matchAt(buf, 0, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (matchAt(buf, 0, [0xd0, 0xcf, 0x11, 0xe0])) return 'application/vnd.ms-excel';
  return null;
}

/** Amostra deve ser predominantemente texto (AFD, CSV, TXT). */
export function isMostlyTextBuffer(buf: Uint8Array, sampleSize = 2048): boolean {
  const n = Math.min(buf.length, sampleSize);
  if (n === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13) continue;
    if (b >= 32 && b <= 126) continue;
    if (b >= 0xc2 && b <= 0xf4) continue;
    suspicious++;
  }
  return suspicious / n < 0.08;
}

export function hasRejectedBinarySignature(buf: Uint8Array): boolean {
  for (const sig of BINARY_REJECT_SIGNATURES) {
    const off = sig.offset ?? 0;
    if (matchAt(buf, off, sig.bytes)) return true;
  }
  return false;
}

export function extensionForImageMime(mime: DetectedImageMime): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}
