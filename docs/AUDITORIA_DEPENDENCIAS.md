# Auditoria de Dependencias

## Escopo e metodo

- Escopo analisado: `package.json`, `src/`, `services/`, `hooks/`, `modules/`, `domain/`, `pages/`, `components/`.
- Ferramentas usadas: `depcheck`, `ts-prune`, `npm outdated`, `vite build`.
- Premissa: evitar remocao automatica de libs criticas/dinamicas sem validacao manual.

## Evidencias de varredura

```text
[DEPENDENCY AUDIT] depcheck executado
[UNUSED IMPORT] ts-prune executado (873 apontamentos, maioria exports legados)
[DEAD MODULE] candidatos identificados por ts-prune/depcheck (requer triagem manual)
[CIRCULAR IMPORT] madge nao conseguiu processar arquivos TS/TSX (0 arquivos)
```

## Dependencias suspeitas (nao remover automaticamente)

| Dependencia | Motivo | Usada ou nao | Risco de remocao | Impacto estimado bundle/build | Recomendacao |
|---|---|---|---|---|---|
| `list` | `depcheck` marcou como nao usada; nao houve import direto encontrado na app | Suspeita de nao uso | Medio (pode existir uso indireto legado) | Pequeno | Validar por busca direcionada e remover se confirmado |
| `motion-utils` | Sinalizada como nao usada; app usa `framer-motion` diretamente | Suspeita de nao uso direto | Baixo | Pequeno | Verificar se e dependencia transitive obrigatoria; remover do `package.json` se nao houver import |
| `pdf-parse` | Sem evidencias de import direto no frontend | Suspeita de nao uso | Medio | Medio | Confirmar se ha uso apenas em API/server scripts; mover para dependencia de runtime correto ou remover |
| `@types/crypto-js` | Tipagem possivelmente redundante com TS atual e uso restrito | Uso pontual | Baixo | Nulo em bundle | Manter por ora; revisar junto de `crypto-js` |
| `dotenv` | Dependencia de runtime em projeto Vite; parece usada em `agent`/scripts | Usada fora do browser | Alto (quebra scripts) | Nulo no bundle cliente | Manter |
| `sharp` | Usada em scripts de geracao de assets | Usada em tooling | Alto para pipeline de assets | Nulo em runtime app | Manter em `devDependencies` |

## Dependencias desatualizadas (prioridade de seguranca)

- Alta prioridade: `@supabase/supabase-js`, `@tanstack/react-query`, `react-router-dom`, `pdfjs-dist`.
- Mudanca maior (avaliar regressao): `react`/`react-dom` 18 -> 19, `vite` 5 -> 8, `vitest` 2 -> 4, `zod` 3 -> 4, `@sentry/react` 8 -> 10.
- Recomendacao: atualizar por ondas pequenas e rodar regressao funcional de autenticacao/rotas/tenant.

## Dependencias faltantes detectadas (triagem)

`depcheck` reportou referencias para modulos nao declarados:

- `@supabase/auth-js` (imports diretos em utilitarios)
- `firebase` (arquivo legado em `services/firebase.ts`)
- `@aws-sdk/client-kms` (arquivo legado `services/kmsProvider.js`)
- aliases/shims (`es-toolkit*`, `eventemitter3-cjs-entry`) que aparentam mapeamento interno

Recomendacao: classificar por categoria:

1. **Ativo em runtime**: adicionar explicitamente no `package.json`.
2. **Legado morto**: remover arquivo/import.
3. **Shim interno**: documentar no build config para evitar falso positivo.

## Observacoes de tree-shaking e chunks

- Build de producao concluido com sucesso.
- Warn de chunking: modulos com import dinamico e estatico simultaneo (`timeEngine`, `repDeviceBrowser`) impedem separacao ideal.
- Chunks mais pesados observados: `exceljs`, `pdf`, `xlsx`, bundle principal de UI.

Recomendacao: postergar otimização de chunk para PR especifico de performance (sem alterar regra de negocio nesta auditoria).
