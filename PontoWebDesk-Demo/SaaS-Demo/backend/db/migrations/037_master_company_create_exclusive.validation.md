# 037 — Criação de empresas exclusiva do Painel Master

## Entrega

- Policy `companies_insert_master_only`: INSERT autenticado em `companies` sempre negado.
- RPC `create_tenant_onboarding` (se existir) passa a lançar `COMPANY_CREATE_MASTER_ONLY`.
- Empresas já existentes não são alteradas.
- Control plane Master (`queryMaster` / service role) continua criando via bypass RLS.

## Compatibilidade

- UPDATE cadastral operacional em `companies` permanece.
- Discovery / initialize-commercial para companies órfãs permanece.
- Seeds internos (dev) usam service role — fora do escopo authenticated.
