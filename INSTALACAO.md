# 🔧 Guia de Instalação - Resolução de Conflitos

## Problema: Conflito de Dependências

O `recharts@2.12.7` não suporta React 19. Foram aplicadas duas soluções:

### ✅ Solução 1: Versão Atualizada (Recomendado)

O `package.json` foi atualizado para usar `recharts@^3.0.0` que tem melhor suporte para React 19.

**Execute:**
```bash
npm install
```

### ✅ Solução 2: Legacy Peer Deps (Alternativa)

Se ainda houver problemas, use:

```bash
npm install --legacy-peer-deps
```

Isso permite que o npm ignore conflitos de peer dependencies.

### ✅ Solução 3: Force Install (Último Recurso)

Se as soluções acima não funcionarem:

```bash
npm install --force
```

**⚠️ Atenção:** Use `--force` apenas se necessário, pois pode causar problemas em runtime.

---

## Verificação

Após a instalação, verifique se tudo está correto:

```bash
npm list react react-dom recharts
```

Deve mostrar as versões instaladas sem erros.

---

## Se o Recharts Não Funcionar

Se mesmo após a instalação o recharts não funcionar corretamente com React 19, você pode:

1. **Usar uma alternativa temporária:**
   - Remover recharts temporariamente
   - Usar gráficos simples com CSS/HTML5 Canvas
   - Ou usar outra biblioteca como `chart.js` ou `victory`

2. **Downgrade do React (não recomendado):**
   ```bash
   npm install react@^18.2.0 react-dom@^18.2.0
   ```

---

## Status Atual

- ✅ `package.json` atualizado para `recharts@^3.0.0`
- ✅ `overrides` adicionado para forçar React 19 no recharts
- ✅ Pronto para instalação

---

## Próximos Passos

1. Execute `npm install` (ou `npm install --legacy-peer-deps`)
2. Se houver erros, verifique os logs
3. Teste o app com `npm run dev`
4. Verifique se os gráficos funcionam corretamente
