# Corrigir 404 na Vercel (app-smartponto.vercel.app)

O repositório tem o projeto **dentro da pasta `APP Smartponto`**.  
Se o **Root Directory** na Vercel não estiver apontando para essa pasta, o build falha ou não acha os arquivos → **404**.

---

## 1. Ajustar Root Directory (obrigatório)

1. Acesse **https://vercel.com** e faça login.
2. Abra o projeto **app-smartponto** (ou o nome que você deu).
3. Vá em **Settings** → **General**.
4. Role até **Root Directory**.
5. Clique em **Edit**.
6. Digite exatamente: **`APP Smartponto`**  
   (com espaço, A e P maiúsculos, resto minúsculo).
7. Marque **Override** (ou **Include source files outside of the Root Directory**, se aparecer).
8. Clique em **Save**.

---

## 2. Limpar cache e fazer redeploy

1. Vá em **Deployments**.
2. No último deploy, clique nos **três pontinhos (⋯)**.
3. Escolha **Redeploy**.
4. Se existir a opção **Clear build cache and redeploy**, use essa.
5. Confirme e aguarde o build terminar.

---

## 3. Conferir o build

1. Em **Deployments**, abra o deploy que acabou de rodar.
2. Aba **Building** (ou **Build Logs**):
   - Deve aparecer algo como **Building in APP Smartponto** ou que o build está rodando nessa pasta.
   - O build precisa terminar **com sucesso** (sem erro em vermelho).
3. Aba **Output** / **Functions**:
   - Deve haver **`index.html`** e a pasta **`assets/`**.

Se o build **falhar**, o 404 continua. Corrija o erro do build (ex.: variáveis de ambiente, dependências) e faça um novo deploy.

---

## 4. Variáveis de ambiente (se o app quebrar ao carregar)

Em **Settings** → **Environment Variables**, confira:

- **`VITE_SUPABASE_URL`** – URL do projeto Supabase
- **`VITE_SUPABASE_ANON_KEY`** – Chave anon do Supabase

Use os mesmos valores do seu `.env.local`. Depois disso, **Redeploy** de novo.

---

## 5. Alternativa: deploy via CLI (se ainda der 404)

Se mesmo com Root Directory correto o 404 continuar, faça um deploy **direto da pasta do projeto**:

```powershell
cd "D:\APP Smartponto"
npx vercel --prod
```

Na primeira vez, o CLI pergunta:
- **Set up and deploy?** → **Y**
- **Which scope?** → sua conta
- **Link to existing project?** → **Y** e escolha **app-smartponto** (ou **N** para criar um novo)

O deploy usa a pasta atual como raiz, então não há problema de Root Directory.  
Depois, você pode voltar a usar deploy pelo GitHub; o importante é que o **Root Directory** esteja certo.

---

## Resumo

| O que fazer | Onde |
|------------|------|
| Root Directory = **`APP Smartponto`** | Settings → General |
| Redeploy com **Clear build cache** | Deployments → ⋯ → Redeploy |
| Ver se o build passou e tem `index.html` | Deployments → último deploy → Building / Output |
| Variáveis Supabase | Settings → Environment Variables |

Na maioria dos casos, **ajustar o Root Directory** e **Redeploy com cache limpo** resolve o 404.
