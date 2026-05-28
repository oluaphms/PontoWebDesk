import { describe, expect, it } from 'vitest';
import {
  validateAfdUpload,
  validateImageBuffer,
  validateImportDocument,
  validatePhotoUrl,
} from '../fileValidation.js';

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
