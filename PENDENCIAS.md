# Pendências — PontoWebDesk v1.0.0 RC1

## Veredito

**APROVADO PARA IMPLANTAÇÃO EM CLIENTE PILOTO**

Não há pendência **crítica de código** bloqueando o piloto, desde que os pré-requisitos operacionais abaixo sejam cumpridos no ambiente alvo.

**Não** é Produção Geral. Reavaliar após 30 dias sem incidentes críticos.

---

## Críticas de código

_Nenhuma aberta para o escopo RC1 piloto._

---

## Operacionais (obrigatórias no deploy — não são bugs de código)

| ID | Item | Impacto se omitido | Ação |
|----|------|--------------------|------|
| OPS-1 | Aplicar migration `043` no Postgres do piloto/prod | RLS incompleta no ambiente | Rodar migrations 016→017→043 |
| OPS-2 | `VPS_RLS_ENFORCED=true` | Boot falha ou isolamento frágil | Setar env e validar health |
| OPS-3 | Redis/Upstash para rate-limit | Login/API 503 em produção | Provisionar Redis antes do go-live |
| OPS-4 | Drill de restore completo | RTO/RPO não comprovados | Executar `docs/disaster-recovery.md` em staging |
| OPS-5 | `VITE_API_URL` só Express | Front falar com API morta (Vercel) | Conferir build/env do front |

## Não bloqueantes (Release 1.1+)

| ID | Item | Severidade |
|----|------|------------|
| 1.1-A | Extrair / reduzir `App.tsx` monólito | MÉDIA |
| 1.1-B | BillingEngine `/billing` residual (gateway; fora de KPIs) | BAIXA/MÉDIA |
| 1.1-C | Cache GEO `localStorage` global (auditoria antiga) | MÉDIA |
| 1.1-D | Suite `npm test`/`vitest` ampla do monorepo: ruído (paths mistos FE/BE); RC1 validou suíte crítica backend (PASS). Um teste de fallback in_memory do dashboard espera ledger antigo — alinhar na 1.1 | BAIXA |
| 1.1-E | Cópias `SaaS-Demo` / `PontoWebDesk-Demo` ainda com `api/` legado | MÉDIA (processo) |

## Escopo conscientemente fora desta RC

- Novas funcionalidades
- Refatoração estética / UI / UX
- Produção Geral multi-tenant em escala massiva sem período piloto

---

## Evidências RC1

- `VERSION` → `1.0.0-rc.1`
- `docs/RC1_SMOKE_RESULTS.txt`
- `docs/WAVE2_DUAL_STACK_REMOVAL.md`
- `docs/WAVE2_API_REMOVED.txt`
- Cross-tenant: role `rls_probe` (Empresa A vê próprios; Empresa B vê 0 de A)
