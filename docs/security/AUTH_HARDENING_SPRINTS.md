# Hardening de autenticação e autorização — implementado

## Sprint 1 (urgente)

| ID | Item | Implementação |
|----|------|----------------|
| 1.1 | Tenant employees | `requireCompanyId` só do JWT; `rejectTenantOverride` bloqueia query/body |
| 1.2 | Anti-impersonação punches | `user_id`/`company_id` do body só para admin/hr |
| 1.3 | Data write tenant | INSERT/UPDATE/DELETE com `company_id` forçado e WHERE tenant |
| 1.4 | Tabelas sem tenant | `companies`, `global_settings`, `devices` → `ADMIN_ONLY_TABLES` |
| 1.5 | Logout JWT | `POST /api/auth/logout`, `clearToken()`, revogação por `jti` |

## Sprint 2

| ID | Item | Implementação |
|----|------|----------------|
| 2.1 | `requireRole` | `backend/src/middlewares/requireRole.ts` |
| 2.2 | Employees write | `requireAdminOrHr` em POST/PATCH/DELETE |
| 2.3 | Self punch | Employee só registra próprio `user_id` |
| 3.1 | JWT TTL | Padrão `2h` em `JWT_EXPIRES_IN` |
| 3.5 | 401 frontend | `setUnauthorizedHandler` + `clearToken` em `api.ts` |
| 4.1 | RequireAuth | Exige `getToken()` + `refresh()` |

## Sprint 3

| ID | Item | Implementação |
|----|------|----------------|
| 2.5 | Rotas tipadas (início) | Políticas por tabela em `dataTablePolicy.ts` |
| 5.2 | callerContext VPS | `callerContextService.ts` + `AUTH_REVALIDATE_DB` |
| 3.3 | Revogação | `revoked_tokens` + `jti` no JWT |
| 6.2 | Audit auth | `authAuditService.ts` → `tenant_audit_log` |

## Sprint 4+

| ID | Item | Implementação |
|----|------|----------------|
| 5.4 | Feature flag data API | `DATA_API_WRITES_ENABLED=false` |
| 2.4 | Rotas admin | `GET /api/admin/health-scope` |
| 6.1 | RLS | Template em `006_rls_tenant_policies.sql` |

## Deploy

```bash
cd backend
npm run db:migrate   # aplica 005 e 006
# Reiniciar API (PM2/systemd)
```

Variáveis novas em `backend/.env`:

- `JWT_EXPIRES_IN=2h`
- `AUTH_REVALIDATE_DB=true`
- `DATA_API_WRITES_ENABLED=true` (ou `false` para bloquear escritas em `/api/data`)

## Próximos passos (opcional)

- Migrar mais operações de `/api/data` para rotas REST dedicadas
- Consolidar APIs Vercel com JWT VPS
- Ativar RLS no Postgres com `app.current_company_id` por conexão
