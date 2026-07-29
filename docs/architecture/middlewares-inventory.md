# Middlewares Inventory (baseline P0.0)

## `backend/src/middlewares/`

| File | Função |
|------|--------|
| authMiddleware.ts | JWT Bearer/cookie; revogação; revalida role/companyId |
| requireRole.ts | adminOnly / adminOrHr / collaborator |
| dataApiGate.ts | Bloqueia writes /api/data se DATA_API_WRITES_ENABLED=false |
| rateLimit.ts | Rate limit Redis/Upstash |
| apiRateLimitPresets.ts | Presets por domínio |
| webSecurity.ts | CORS/CSRF/Origin |
| securityHeaders.ts | HSTS, CSP API |

## Outros

| File | Função |
|------|--------|
| middleware/requestContext.ts | x-request-id / x-correlation-id + logs REQUEST_START/END |
