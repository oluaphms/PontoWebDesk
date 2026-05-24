# Nginx + API Node (`api.phmsdev.com.br`)

## Arquitetura

```text
Browser / Frontend
  → https://api.phmsdev.com.br/api/auth/login
       → Nginx (443)
            → http://127.0.0.1:3000/api/auth/login
                 → Express (backend)
```

O **prefixo `/api` deve existir nos dois lados** (Nginx e Node). O frontend usa `VITE_API_URL=https://api.phmsdev.com.br/api` e paths relativos (`/auth/login`).

## Erro comum: `Cannot POST /auth/login`

Significa que a requisição chegou ao Node **sem** `/api` no path. Causas típicas:

| Configuração incorreta | Efeito |
|------------------------|--------|
| `proxy_pass http://127.0.0.1:3000/;` em `location /api/` | Remove `/api` → Node recebe `/auth/login` |
| Cliente chama `https://api.phmsdev.com.br/auth/login` | Nginx não encaminha (ou devolve 404) |

**Correto:**

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
}
```

## Instalação na VPS

```bash
cd /caminho/PontoWebDesk
sudo bash deploy/nginx/install-api-vps.sh
```

Ou manualmente:

```bash
sudo cp deploy/nginx/api.phmsdev.com.br.conf /etc/nginx/sites-available/api.phmsdev.com.br
sudo ln -sf /etc/nginx/sites-available/api.phmsdev.com.br /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # se tiver proxy_pass http://127.0.0.1:3000/
sudo nginx -t && sudo systemctl reload nginx
```

### Verificar o ficheiro ativo (evitar `sites-enabled/default` errado)

```bash
sudo nginx -T 2>/dev/null | grep -A3 "server_name api.phmsdev.com.br"
sudo nginx -T 2>/dev/null | grep proxy_pass
```

Deve aparecer **apenas** `proxy_pass http://127.0.0.1:3000/api/;` no server de `api.phmsdev.com.br`.

Certificado (se ainda não existir):

```bash
sudo certbot certonly --nginx -d api.phmsdev.com.br
```

## Backend (PM2)

```bash
cd backend
npm run build
pm2 restart server   # ou: pm2 start dist/server.js --name server
pm2 save
```

`backend/.env` na VPS:

```env
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=<openssl rand -hex 32>
JWT_EXPIRES_IN=7d
CORS_ORIGINS=https://seu-frontend.vercel.app,https://smartponto.app
```

Seed do admin:

```bash
npm run db:seed
```

## Testes obrigatórios

```bash
curl -sS https://api.phmsdev.com.br/api/health | jq .

curl -sS -X POST https://api.phmsdev.com.br/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.test","password":"123456"}' | jq .
```

Resposta esperada do login: `"ok": true` e campo `"token"`.

Teste local (sem Nginx):

```bash
curl -sS http://127.0.0.1:3000/api/health
curl -sS -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.test","password":"123456"}'
```

## Rotas Express (referência)

| Método | Path |
|--------|------|
| GET | `/api/health` |
| POST | `/api/auth/login` |
| GET | `/api/auth/me` |
| CRUD | `/api/employees` |
| POST | `/api/punches`, `/api/punches/batch` |
| * | `/api/data/:table` |
