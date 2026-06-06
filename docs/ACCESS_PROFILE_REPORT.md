# Controle de perfil de acesso — COLABORADOR / ADMIN_RH

## Resumo

Implementação de perfis de acesso em camada de produto sobre o RBAC existente (`admin`, `hr`, `employee`, `supervisor`), preservando compatibilidade com RLS e autenticação atual.

| Perfil API | Roles canônicas no banco |
|------------|--------------------------|
| `COLABORADOR` | `employee`, `supervisor`, aliases `colaborador`, `funcionario` |
| `ADMIN_RH` | `admin`, `hr`, aliases `administrador`, `rh`, `admin_rh` |

## 1. Arquivos alterados

### Backend
- `backend/db/migrations/010_access_profile_role.sql` — **novo**
- `backend/src/utils/accessProfile.ts` — **novo**
- `backend/src/utils/authContext.ts`
- `backend/src/middlewares/requireRole.ts`
- `backend/src/services/authLoginService.ts`
- `backend/src/controllers/authController.ts`
- `backend/src/controllers/authMeController.ts`
- `backend/src/controllers/authLogoutController.ts`
- `backend/src/controllers/employeeController.ts`
- `backend/src/routes/employeeRoutes.ts`

### Frontend
- `src/utils/accessProfile.ts` — **novo**
- `src/utils/userRole.ts`
- `src/components/auth/Forbidden403.tsx` — **novo**
- `src/components/auth/RoleGuard.tsx`
- `src/navigation/navigationSchema.ts`
- `src/pages/employee/Dashboard.tsx`
- `App.tsx`

## 2. Migrations criadas

- `backend/db/migrations/010_access_profile_role.sql`
  - Garante coluna `role` em `users` e `employees`
  - Normaliza aliases legados para roles canônicas (compatível com RLS Postgres)

## 3. Rotas protegidas (backend)

| Rota | COLABORADOR | ADMIN_RH |
|------|-------------|----------|
| `GET /api/auth/me` | ✅ | ✅ |
| `POST /api/auth/logout` | ✅ | ✅ |
| `GET /api/employees` | ❌ 403 | ✅ |
| `GET /api/employees/:id` | ✅ (próprio) | ✅ |
| `/api/admin/*` | ❌ 403 | ✅ |
| `POST/PATCH/DELETE /api/employees` | ❌ 403 | ✅ |
| `/api/data/*` (tabelas admin) | ❌ (política existente) | ✅ |
| `/api/punches`, `/api/bank-hours` (próprios) | ✅ | ✅ |

Helpers: `hasAdminAccess()`, `isCollaborator()`, `isAdminRH()`, `resolveAccessProfile()`.

## 4. Componentes criados

- `src/components/auth/Forbidden403.tsx` — tela 403 para acesso negado
- Dashboard colaborador aprimorado em `src/pages/employee/Dashboard.tsx` (relógio, escala, avisos)

## 5. Frontend — rotas e menu

| Perfil | Redirect pós-login | Menu lateral |
|--------|-------------------|--------------|
| COLABORADOR | `/dashboard-colaborador` → `/employee/dashboard` | Dashboard, Registrar Ponto, Minhas Marcações, Minha Escala, Banco de Horas, Perfil |
| ADMIN_RH | `/dashboard-admin` → `/admin/dashboard` | Menu administrativo completo |

- Rotas `/admin/*`: `RoleGuard` com `deniedMode="forbidden"` (403)
- Colaborador digitando `/admin/employees` manualmente: **403 Forbidden**
- ADMIN_RH pode acessar rotas do colaborador (`/employee/*`)

## 6. JWT e sessão

Payload JWT (inalterado na estrutura, role normalizada):
```json
{ "sub", "userId", "companyId", "role", "jti" }
```

`/api/auth/me` retorna:
```json
{ "id", "nome", "email", "role", "accessProfile", "company_id", ... }
```

## 7. Auditoria

Eventos registrados em `tenant_audit_log` (quando tabela disponível):
- `LOGIN` — login bem-sucedido (role + accessProfile)
- `LOGOUT` — logout
- `AUTH_DENIED_403` — tentativas negadas (middleware + listagem employees)
- `PROFILE_ROLE_CHANGED` — alteração de role de colaborador

## 8. Possíveis impactos

- **RLS Supabase** continua usando `admin`/`hr`/`employee` — migration normaliza aliases, não grava `COLABORADOR` literal no banco
- **Deploy backend** necessário na VPS para efeito em produção
- **Sessões antigas**: usuários devem refazer login após deploy
- **Supervisor** mapeado como COLABORADOR (com rota extra `/employee/monitoring` preservada)

## 9. Testes executados

- `npm run build` (backend TypeScript) — pendente nesta sessão
- Linter nos arquivos editados — pendente

## 10. Pendências

1. Executar migration `010_access_profile_role.sql` na VPS/produção
2. Deploy do backend com alterações de auth e employees
3. Validar E2E: login colaborador → 403 em `/admin/reports`; login admin → dashboard admin
4. Opcional: expor `accessProfile` no tipo `User` do frontend para UI condicional
5. Opcional: migration espelhada em `supabase/migrations/` se usar Supabase direto
