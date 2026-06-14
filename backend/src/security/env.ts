export function isProduction(): boolean {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}
