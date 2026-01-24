# Implementações recentes – Storage, Audit, PDF, Push, Testes, REP, Segurança, Monitoramento

## 1. Storage (bucket `photos`)

- **`supabase_storage.sql`**: cria o bucket `photos` e políticas RLS para upload (autenticados, pasta por usuário), leitura pública e update.
- Execute no **SQL Editor** do Supabase. Ver `SUPABASE_TABELAS.md`.

## 2. Audit em banco

- **`supabase_audit_logs.sql`**: tabela `audit_logs` e políticas RLS.
- **`LoggingService`**: grava em Supabase quando configurado; fallback em `localStorage`.
- Execute o SQL e rode o app com Supabase configurado.

## 3. Export PDF

- **`jspdf`** e **`jspdf-autotable`** em `package.json`.
- **`ReportsView`**: botão "Exportar PDF" gera e baixa o relatório em PDF.
- Rode `npm install` e use o botão na tela de relatórios (admin).

## 4. Push / lembretes

- **`pushReminderService`**: lembretes locais (ex.: 08:00, 12:00, 18:00) via `Notification` API.
- Ativado quando o usuário está logado e com "notificações" ligadas nas preferências.
- **`PUSH_NOTIFICACOES.md`**: como configurar e futura Web Push com backend.

## 5. Testes

- **Vitest** + **@testing-library/react** + **jsdom** em `package.json` e `vite.config.ts`.
- **`vitest.setup.ts`**: setup dos testes.
- **`validationService.test.ts`**: testes de `validateSequence`, `validateTimeInterval`, `validateLocation`.
- Comandos: `npm run test` (watch) e `npm run test:run` (uma vez). Ver `TESTES.md`.

## 6. Aspectos legais (REP)

- **`ASPECTOS_LEGAIS_REP.md`**: o que é REP, o que o app faz, o que falta para cenários “legais” e recomendações.

## 7. Segurança

- **Zod**: validação do login em `lib/validationSchemas.ts` (identifier e senha mín. 6 caracteres).
- **Throttle**: 5 s entre registros de ponto no client (`useRecords`) para evitar duplo clique.
- **Headers** em `vercel.json`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- **`SEGURANCA.md`**: resumo e sugestões (CSP, rate limit, etc.).

## 8. Monitoramento (Sentry)

- **`@sentry/react`** em `package.json`.
- **`lib/sentry.ts`**: `initSentry()` e `captureException()`. Inicialização em `index.tsx`.
- **`ErrorBoundary`**: envia erros para o Sentry quando `VITE_SENTRY_DSN` está definido.
- Configure `VITE_SENTRY_DSN` no `.env.local` ou na Vercel. Ver `MONITORAMENTO.md`.

---

## Como aplicar

1. **npm install** (novas deps: jspdf, jspdf-autotable, zod, @sentry/react, vitest, etc.).
2. **Supabase**: rodar `supabase_storage.sql` e `supabase_audit_logs.sql` (além do schema existente).
3. **Opcional**: configurar `VITE_SENTRY_DSN` para error tracking.
4. **Testes**: `npm run test:run`.
