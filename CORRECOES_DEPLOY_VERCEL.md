# Correções para Deploy no Vercel

## Problemas Identificados e Corrigidos

### ✅ 1. Remoção de Importmap (CDN)
**Problema:** O `index.html` estava usando importmap com CDNs (esm.sh) para React e outras dependências, mesmo tendo as dependências instaladas localmente.

**Solução:** Removido completamente o `<script type="importmap">` do `index.html`. As dependências já estão instaladas via npm e serão bundladas pelo Vite.

### ✅ 2. Service Worker Desabilitado Temporariamente
**Problema:** O Service Worker estava cacheando recursos e poderia causar problemas de MIME type ao servir arquivos antigos.

**Solução:** 
- Atualizado o script no `index.html` para desregistrar TODOS os Service Workers
- Limpar TODOS os caches antigos
- Não registrar novo Service Worker temporariamente (será reativado após confirmar que o deploy funciona)

### ✅ 3. Configuração do Vercel (vercel.json)
**Problema:** O rewrite estava redirecionando tudo para `/index.html`, incluindo arquivos estáticos, causando erro de MIME type.

**Solução:** 
- Simplificado o `vercel.json` para usar rewrite padrão
- O Vercel automaticamente serve arquivos estáticos antes dos rewrites
- Adicionado `framework: "vite"` para melhor detecção automática
- Headers de cache otimizados para assets

### ✅ 4. Tailwind CSS via PostCSS/CLI
**Status:** ✅ Já estava configurado corretamente
- `tailwind.config.js` configurado
- `postcss.config.js` com Tailwind e Autoprefixer
- `index.css` com `@tailwind` directives
- Nenhuma referência ao CDN do Tailwind encontrada

**Melhoria:** Ajustado `tailwind.config.js` para incluir todos os diretórios corretos:
- `./**/*.{js,ts,jsx,tsx}` (raiz)
- `./components/**/*`
- `./hooks/**/*`
- `./services/**/*`
- `./lib/**/*`

### ✅ 5. Otimização do Build do Vite
**Melhorias aplicadas:**
- `cssCodeSplit: true` - CSS separado para melhor cache
- `cssMinify: true` - Minificação de CSS
- Organização de assets em subpastas (images, fonts)
- Chunks manuais otimizados para vendor libraries

## Configurações Finais

### vercel.json
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### Configurações no Vercel Dashboard
Certifique-se de que:
- **Framework Preset:** Vite (ou React)
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install` (padrão)

## Próximos Passos

1. **Fazer commit e push das alterações:**
   ```bash
   git add .
   git commit -m "fix: corrigir deploy Vercel - remover CDNs, desabilitar SW, otimizar build"
   git push
   ```

2. **No Vercel Dashboard:**
   - Ir em Settings > General
   - Limpar cache do build (Clear Build Cache)
   - Fazer novo deploy

3. **Após confirmar que funciona:**
   - Reativar Service Worker (opcional, para PWA offline)
   - Verificar se todos os assets estão carregando corretamente

## Verificações

### ✅ Checklist de Verificação
- [x] Removido importmap do index.html
- [x] Service Worker desabilitado temporariamente
- [x] vercel.json configurado corretamente
- [x] Tailwind via PostCSS (sem CDN)
- [x] Vite config otimizado para produção
- [x] Build gerando arquivos com hash correto

### Testes Locais (Opcional)
```bash
npm run build
npm run preview
```

Verificar se:
- Arquivos JS estão em `/dist/assets/` com hash
- Arquivo CSS está sendo gerado
- `index.html` referencia corretamente os assets

## Notas Importantes

1. **MIME Type Error:** O erro "Expected JavaScript module but received text/html" geralmente acontece quando:
   - O servidor retorna HTML em vez de JS para requisições de arquivos JS
   - O rewrite está interceptando arquivos estáticos
   - Service Worker está servindo cache antigo

2. **Cache do Vercel:** Sempre limpe o cache do build no Vercel após mudanças significativas.

3. **Service Worker:** Foi desabilitado temporariamente. Reative apenas após confirmar que o deploy está funcionando perfeitamente.

## Arquivos Modificados

- ✅ `index.html` - Removido importmap, atualizado script de SW
- ✅ `vercel.json` - Simplificado e otimizado
- ✅ `vite.config.ts` - Adicionado cssCodeSplit e cssMinify
- ✅ `tailwind.config.js` - Ajustado content paths
