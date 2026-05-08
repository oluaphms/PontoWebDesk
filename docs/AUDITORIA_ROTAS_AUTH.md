# Auditoria de Rotas e AuthGuard

## Escopo

- Arquivos auditados: `App.tsx`, `src/routes/routeChunks.ts`, `src/routes/portalLazyPages.tsx`, `src/navigation/navigationSchema.ts`, `src/config/navigation.ts`, guards em `src/components/auth/`.
- Perfis avaliados: `admin`, `hr`, `employee`, `supervisor`, anonimo.

## Evidencias

```text
[ROUTE AUTH AUDIT] malha principal de rotas validada
[UNPROTECTED ROUTE] sem rota administrativa publica identificada
[ROLE ESCALATION RISK] bloqueios admin/employee presentes em camada de rota
[TENANT ACCESS RISK] tenant nao e validado na rota; depende da camada de dados
```

## Matriz de protecao

| Rota | Protecao atual | Risco | Role esperada | Status |
|---|---|---|---|---|
| `/admin/*` | `ProtectedRoute allowedRoles=['admin','hr']` + redirects defensivos | Baixo | `admin`, `hr` | OK |
| `/employee/*` | `RoleGuard allowedRoles=['employee','supervisor']` | Baixo | `employee`, `supervisor` | OK |
| `/dashboard-admin` | `RoleGuard` explicito | Baixo | `admin`, `hr` | OK |
| `/dashboard-employee` | `RoleGuard` explicito | Baixo | `employee`, `supervisor` | OK |
| `/time-clock`, `/time-records` | `RoleGuard` explicito | Baixo | `employee`, `supervisor` | OK |
| `/settings` (legada) | `RoleGuard` admin/hr | Medio (confusao de UX) | `admin`, `hr` | OK |
| `/profile` (legada) | Autenticado (sem role guard) | Medio | autenticado | OK com ressalva |
| `/reset-password`, `/accept-invite` | Fluxos publicos controlados | Baixo | publico controlado | OK |

## Riscos identificados

1. **Tenant validation nao acontece na camada de roteamento**
   - Impacto: acesso por URL depende totalmente do filtro em queries/RLS.
   - Severidade: **MEDIO** (defesa em profundidade faltante na borda).
2. **Rota legada `/profile` sem guard de role**
   - Nao gera escalacao de privilegio por si so, mas permite acesso autenticado sem perfil especifico.
   - Severidade: **BAIXO**.

## Recomendacoes

- Manter arquitetura atual de guard (ja protege area admin/employee).
- Fortalecer observabilidade: log de tentativas de acesso negado por role.
- Opcional (hardening futuro): adicionar validacao de tenant-context na entrada de paginas sensiveis para fail-fast de sessao inconsistente.
