# Monitoramento e Error Tracking – SmartPonto

## Sentry

O app usa **Sentry** para captura de erros quando o DSN está configurado.

### Configuração

1. Crie um projeto em [sentry.io](https://sentry.io) (React/Vite).
2. Copie o **DSN** do projeto.
3. Adicione ao `.env.local` (local) ou às variáveis de ambiente da **Vercel**:
   ```env
   VITE_SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz
   ```
4. Faça **rebuild** (as variáveis são injetadas em tempo de build).

### O que é enviado

- Erros capturados pelo **ErrorBoundary** (React).
- `Sentry.captureException` pode ser chamado manualmente em pontos críticos (ex.: falha ao registrar ponto).

### Recursos

- **Replay**: amostra de sessões e 100% dos erros (configurável em `lib/sentry.ts`).
- **Tracing**: `tracesSampleRate` 0.1.

Desative ou ajuste em `lib/sentry.ts` (ex.: `replaysSessionSampleRate: 0`).

---

## Audit logs

Os **audit logs** são persistidos no Supabase (`audit_logs`) quando configurado. Use para auditoria e análise de ações (login, alterações, etc.). Veja `SUPABASE_TABELAS.md` e `LoggingService`.

---

## Logs no console

Em desenvolvimento, o `LoggingService` também escreve no **console** (incluindo severidade e detalhes). Em produção, convém reduzir ou desligar; nesse caso, priorize Sentry e audit em banco.
