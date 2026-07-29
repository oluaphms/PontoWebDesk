# Fase 6.5 — preferências de notificações por empresa

## Entrega

- Configuração persistente por tenant/empresa.
- Defaults fail-open para compatibilidade: todos os avisos habilitados quando não há linha.
- Controles Master:
  - receber e-mail/webhook;
  - aviso 7 dias antes;
  - aviso 3 dias antes;
  - aviso no vencimento;
  - aviso após bloqueio.
- Aviso de pagamento recebido permanece automático e respeita apenas a preferência geral
  de e-mail; o inbox SaaS continua disponível.
- Tipos desabilitados deixam de ser enviados à empresa, mas o inbox operacional Master
  continua recebendo o espelho.
- Alterações exigem `payments:write`, usuário Master humano e geram
  `SUBSCRIPTION_NOTIFICATION_PREFERENCES_UPDATED`.

## Migration

- `backend/db/migrations/034_master_subscription_notification_preferences.sql`
- `supabase/migrations/20260721220000_master_subscription_notification_preferences.sql`

SHA-256 dos arquivos espelho:
`54235431D19B1612B5D6A952E94D9AB5839B541304152F92872C77B75BC74BDA`.

## Segurança

- Nenhuma alteração em autenticação, `companyId`, roles operacionais ou `AuthSessionProvider`.
- Bloqueio e desbloqueio continuam exclusivamente pelo fluxo oficial da Fase 6.2.

## Validação executada

- Typecheck backend: aprovado.
- Testes focados: 9 aprovados.
- Suíte backend: 67 arquivos e 278 testes aprovados.
- Build frontend: aprovado.
- Validação de migrations: aprovada.
