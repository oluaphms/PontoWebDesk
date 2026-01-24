# Deploy na Vercel – SmartPonto

## Por que funciona local e 404 na Vercel?

Geralmente é **Root Directory** errado ou **cleanUrls** interferindo. Siga o checklist abaixo.

---

## Checklist obrigatório

### 1. Root Directory (principal causa de 404)

O repositório tem o projeto dentro da pasta **`APP Smartponto`**.

1. Vercel → **Project** → **Settings** → **General**
2. Em **Root Directory**:
   - Clique em **Edit**
   - Defina exatamente: **`APP Smartponto`** (o nome da pasta no GitHub)
   - Marque **Override** e salve.

Se estiver vazio ou errado, o build usa a raiz do repo, não acha `package.json` → **404**.

> **Se o seu repo tiver só os arquivos do projeto na raiz** (sem pasta `APP Smartponto`), deixe Root Directory **vazio**.

### 2. Build & Output

O `vercel.json` já define:

- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Rewrites:** tudo que não for arquivo estático → `/index.html` (SPA)
- **cleanUrls:** `false` (evita 404 em rotas)
- **trailingSlash:** `false`

Não é preciso alterar isso no painel, a menos que queira sobrescrever.

### 3. Framework Preset (se ainda der 404)

Em **Settings** → **General** → **Framework Preset**:

- Tente **Vite**.
- Se continuar 404, mude para **Other** e faça **Redeploy**. O `vercel.json` cuida do build.

### 4. Variáveis de ambiente (obrigatório)

Em **Settings** → **Environment Variables** adicione:

- **`VITE_SUPABASE_URL`** – URL do projeto Supabase (ex: `https://xxxxx.supabase.co`)
- **`VITE_SUPABASE_ANON_KEY`** – Chave **anon public** (Supabase → Settings → API)

Use os mesmos valores do `.env.local`. **Sem essas variáveis**, o app exibe **"Supabase não configurado"** e não permite login. Após configurar, faça **Redeploy**. Veja [CONFIGURAR_SUPABASE.md](./CONFIGURAR_SUPABASE.md).

### 5. Deploy

1. **Deployments** → **⋯** no último deploy → **Redeploy**  
   - Se existir, use **Redeploy** com **Clear build cache**.
2. Ou envie um novo commit para o GitHub.

---

## Conferir se o build está ok

1. **Deployments** → clique no último deploy.
2. Aba **Building**:
   - Deve aparecer algo como **Building in APP Smartponto** (ou na raiz, se não usar subpasta).
   - **Build** deve terminar com sucesso.
3. Aba **Output** (ou **Functions**): deve existir `index.html` e pasta `assets/` no output.

Se o build falhar, o 404 vem daí – corrija o erro do build primeiro.

---

## Resumo do que o `vercel.json` faz

- `buildCommand`: `npm run build`
- `outputDirectory`: `dist`
- `cleanUrls`: `false` – **importante** para evitar 404 em SPA (rotas como `/` ou `/dashboard`).
- `trailingSlash`: `false`
- `rewrites`: qualquer rota que não for arquivo estático (ex.: `favicon.ico`, `assets/`) é servida como `/index.html`.

---

## Ainda 404?

→ **Guia passo a passo:** [VERCEL_404_FIX.md](./VERCEL_404_FIX.md)

1. **Root Directory** correto? **`APP Smartponto`** (exatamente assim, com espaço).  
2. **Build & Output** no painel: deixe em branco para usar `vercel.json`, ou use **Build Command** `npm run build` e **Output Directory** `dist`.  
3. **cleanUrls** não deve estar `true` no painel.  
4. **Redeploy** com **Clear build cache**.  
5. Confira se o **build** terminou com sucesso e se **index.html** está no output.
