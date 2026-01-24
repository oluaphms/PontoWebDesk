# Segurança – SmartPonto

## O que está implementado

- **Validação de formulários (Zod)**: login (identifier, senha mín. 6 caracteres) em `lib/validationSchemas.ts`.
- **Throttle de ponto**: intervalo mínimo de 5 s entre registros no client (`useRecords`) para evitar duplo clique; regra de 5 min é aplicada no `ValidationService`.
- **Headers de segurança** (`vercel.json`):
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **RLS no Supabase**: políticas por tabela; audit logs e fotos com políticas específicas.
- **Variáveis sensíveis**: `VITE_*` apenas para build; `.env.local` no `.gitignore`.

## Recomendações

- **CSP (Content-Security-Policy)**: o app usa Tailwind via CDN e scripts inline. Para CSP restritivo, migre para Tailwind compilado e evite `unsafe-inline`; use nonces ou hashes se manter inline.
- **Rate limiting**: no client há throttle; em APIs próprias, use rate limit no backend (ex.: Vercel Edge Middleware ou Supabase Edge Functions).
- **Senha**: exija complexidade maior no signup se necessário; considere 2FA no Supabase Auth.

## Monitoramento

Ver `MONITORAMENTO.md` para error tracking (Sentry) e logs.
