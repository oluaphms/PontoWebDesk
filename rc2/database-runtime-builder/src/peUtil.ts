import fs from 'node:fs';

/** IMAGE_FILE_MACHINE_AMD64 */
const PE_MACHINE_AMD64 = 0x8664;

/**
 * Lê o campo Machine do cabeçalho COFF de um executável PE Windows.
 * Retorna null se o arquivo não for um PE válido.
 */
export function readPeMachineType(exePath: string): number | null {
  const buf = fs.readFileSync(exePath);
  if (buf.length < 64 || buf.readUInt16LE(0) !== 0x5a4d) return null;

  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 6 > buf.length) return null;
  if (buf.readUInt32LE(peOffset) !== 0x00004550) return null;

  return buf.readUInt16LE(peOffset + 4);
}

export function isAmd64Pe(exePath: string): boolean {
  return readPeMachineType(exePath) === PE_MACHINE_AMD64;
}
