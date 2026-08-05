# Relatório — Onda 5 (concluída)

**Commit:** `96bf5f2` (+ setup.iss se aplicável)  
**Branch:** `migrate/local-rc1-ondas`  
**Data:** 2026-08-04

## Escopo
- `VERSION` = `1.0.0-rc.1`
- Docs Wave 2, planos de implantação/migração, checklist produção
- `package.json` / lock (scripts `local:*`)
- Instalador Local: `setup.iss`, scripts PowerShell, bats de build (arquivo a arquivo)
- `docker-compose.local-postgres.yml`, scripts smoke/security/vps-validate
- Scripts `scripts/local/*.bat`

## Validação
- Vitest crítico: **37/37 PASS** (webSecurity, dataTablePolicy, revenueSignals, subscriptionLicenseSync)
- Front `npm run build`: **PASS** (Onda 4)
- `api/` ausente; migration `043` presente

## Não portado (consciente)
- Pastas `SaaS-Demo/` e `PontoWebDesk-Demo/` (~3380 arquivos) — proibido copiar pasta inteira; runtime do Setup continua a referenciar fonte Demo no build machine / Local
- Evidências golive binárias / logs volumosos do instalador

## Próximo
Relatório final consolidado + push GitHub (quando autorizado) + apply VPS conforme `PLANO_IMPLANTACAO_VPS_RC1.md`
