import { describe, expect, it } from 'vitest';
import {
  validateAfdUpload,
  validateImageBuffer,
  validateImportDocument,
  validatePhotoUrl,
} from '../fileValidation.js';
import { validateUploadedFile } from '../validateUploadedFile.js';
import { sanitizeStoragePath } from '../sanitizeStoragePath.js';

describe('validateAfdUpload', () => {
  it('aceita CSV em texto', () => {
    const head = new TextEncoder().encode('nome,email\nJoao,joao@test.com');
    const r = validateAfdUpload({
      filename: 'func.csv',
      size: 100,
      head,
    });
    expect(r.ok).toBe(true);
  });

  it('rejeita binário PE', () => {
    const head = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    const r = validateAfdUpload({
      filename: 'mal.txt',
      size: 4,
      head,
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateImageBuffer', () => {
  it('aceita JPEG pelos magic bytes', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const r = validateImageBuffer({
      filename: 'foto.jpg',
      size: buf.length,
      buffer: buf,
      profile: 'punchPhoto',
    });
    expect(r.ok).toBe(true);
  });

  it('rejeita extensão incompatível', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const r = validateImageBuffer({
      filename: 'foto.png',
      size: buf.length,
      buffer: buf,
      profile: 'punchPhoto',
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateImportDocument', () => {
  it('aceita PDF', () => {
    const head = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const r = validateImportDocument({
      filename: 'lista.pdf',
      size: 500,
      head,
    });
    expect(r.ok).toBe(true);
  });
});

describe('validatePhotoUrl', () => {
  it('rejeita data URL', () => {
    const r = validatePhotoUrl('data:image/jpeg;base64,abc');
    expect(r.ok).toBe(false);
  });

  it('aceita URL https supabase', () => {
    const r = validatePhotoUrl('https://xyz.supabase.co/storage/v1/object/public/photos/a.jpg');
    expect(r.ok).toBe(true);
  });
});

describe('security upload policy', () => {
  it('rejeita JPG com conteúdo executável', () => {
    const bin = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    const r = validateUploadedFile({
      uploadType: 'punchPhoto',
      filename: 'foto.jpg',
      mimeType: 'image/jpeg',
      size: bin.length,
      buffer: bin,
    });
    expect(r.ok).toBe(false);
  });

  it('rejeita MIME falso', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const r = validateUploadedFile({
      uploadType: 'avatar',
      filename: 'ok.jpg',
      mimeType: 'application/pdf',
      size: jpg.length,
      buffer: jpg,
    });
    expect(r.ok).toBe(false);
  });

  it('rejeita magic bytes inválidos para foto', () => {
    const txt = new TextEncoder().encode('nao sou imagem');
    const r = validateUploadedFile({
      uploadType: 'avatar',
      filename: 'foto.jpg',
      mimeType: 'image/jpeg',
      size: txt.length,
      buffer: txt,
    });
    expect(r.ok).toBe(false);
  });

  it('rejeita arquivo acima do limite', () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const r = validateUploadedFile({
      uploadType: 'avatar',
      filename: 'foto.jpg',
      mimeType: 'image/jpeg',
      size: big.length,
      buffer: big,
    });
    expect(r.ok).toBe(false);
  });

  it('bloqueia path traversal', () => {
    expect(() => sanitizeStoragePath('../etc/passwd')).toThrow();
    expect(() => sanitizeStoragePath('..\\etc\\passwd')).toThrow();
    expect(() => sanitizeStoragePath('%2e%2e/%2e%2e/secret')).toThrow();
  });

  it('rejeita binário em endpoint AFD', () => {
    const pe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const r = validateUploadedFile({
      uploadType: 'afdImport',
      filename: 'registro.afd',
      mimeType: 'text/plain',
      size: pe.length,
      buffer: pe,
    });
    expect(r.ok).toBe(false);
  });

  it('rejeita extensão permitida com conteúdo incompatível', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const r = validateUploadedFile({
      uploadType: 'employeeImportDocument',
      filename: 'colaboradores.csv',
      mimeType: 'text/csv',
      size: pdf.length,
      buffer: pdf,
    });
    expect(r.ok).toBe(false);
  });

  it('rejeita csv com formula injection', () => {
    const csv = new TextEncoder().encode('nome,valor\n=HYPERLINK("http://evil"),10');
    const r = validateUploadedFile({
      uploadType: 'employeeImportCsv',
      filename: 'import.csv',
      mimeType: 'text/csv',
      size: csv.length,
      buffer: csv,
    });
    expect(r.ok).toBe(false);
  });
});
