# ARCHITECTURE RULES

## Objetivo

Evitar entropia arquitetural com regras executáveis de boundary e contratos.

## Regras mandatórias

- Sem import cross-context direto (`domain/<ctx> -> domain/<ctx2>`) sem contrato em `src/contracts`.
- Sem acesso infra direto sensível em domínio (`supabaseClient` fora ACL definida).
- Sem introdução de dependência circular nova.
- Sem payload operacional sem `correlation_id` e `operation_id` quando aplicável.
- Sem quebra de contrato versionado em `src/contracts`.

## Gates obrigatórios

- `npm run lint:architecture`
- `npm run validate:contracts`
- `npm run validate:migrations`
- `npm run audit:dependency-graph`
- `npm run test:chaos`

## Imports proibidos (baseline atual)

- `domain/operational -> services/supabaseClient` (direto)
- `domain/geo <-> domain/rep` sem ACL/contrato

## Estratégia de evolução

- Toda integração cross-context deve expor contrato em `src/contracts`.
- Novos módulos operacionais devem consumir `src/sdk/operational`.
- Qualquer exceção de boundary deve ser documentada neste arquivo com prazo de remoção.
- Allowlist explícita em `architecture-lint.config.json` para reduzir falso positivo.
- Regra nova só entra com automação correspondente (script/check CI).
