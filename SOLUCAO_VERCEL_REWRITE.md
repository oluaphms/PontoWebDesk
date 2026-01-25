# Solução para Erro de Rewrite no Vercel

## Problema

O Vercel pode estar retornando erro de "Padrão de origem de rota inválido" ou arquivos estáticos sendo servidos como HTML.

## Solução Aplicada

Simplificamos o `vercel.json` para usar o rewrite padrão. O Vercel **automaticamente** serve arquivos estáticos antes de aplicar rewrites, então não precisamos de regex complexa.

### Configuração Atual

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

## Por que isso funciona?

1. **O Vercel serve arquivos estáticos primeiro**: Arquivos em `/assets/`, `.js`, `.css`, etc. são servidos automaticamente antes dos rewrites serem aplicados.

2. **Headers garantem MIME type correto**: Os headers que configuramos garantem que arquivos `.js` e `.css` tenham Content-Type correto.

3. **Apenas rotas SPA são redirecionadas**: Se um arquivo não existir (como uma rota SPA), então o rewrite redireciona para `index.html`.

## Se ainda houver problemas

### Opção 1: Verificar se arquivos estão sendo gerados

Execute localmente:
```bash
npm run build
ls dist/assets/
```

Deve haver arquivos `.js` e `.css` na pasta `dist/assets/`.

### Opção 2: Configuração alternativa (se necessário)

Se o problema persistir, podemos usar esta configuração mais explícita:

```json
{
  "rewrites": [
    {
      "source": "/assets/:path*",
      "destination": "/assets/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### Opção 3: Remover rewrite completamente

Para projetos Vite, o Vercel pode detectar automaticamente. Tente remover a seção `rewrites` completamente e deixar apenas:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

## Verificação

Após o deploy:

1. **Verificar arquivo JS diretamente:**
   ```
   https://app-smartponto.vercel.app/assets/index-[hash].js
   ```
   - Deve retornar JavaScript
   - Content-Type: `application/javascript`

2. **Verificar no console:**
   - Não deve haver erro de MIME type
   - Arquivos devem carregar corretamente

## Notas Importantes

- O Vercel com `framework: "vite"` já detecta automaticamente e configura rewrites
- Arquivos estáticos são sempre servidos antes dos rewrites
- Headers de Content-Type garantem MIME type correto mesmo se houver problema no rewrite
