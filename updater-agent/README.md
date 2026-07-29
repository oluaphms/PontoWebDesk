# PontoWebDesk Updater Service

Agente de atualização **LOCAL / HYBRID** — serviço Windows fora do navegador.

Executa o ciclo completo:

1. Heartbeat no Control Plane Master  
2. Claim de solicitação aprovada  
3. Download do artefato (HTTPS)  
4. Validação SHA-256 (+ HMAC/RSA opcional)  
5. Backup do diretório instalado  
6. Instalação (staging → troca)  
7. Restart dos serviços Windows  
8. Health check (`/api/health/ready` + versão)  
9. Rollback automático se falhar  

## Pré-requisitos

- Node.js 18+
- Instalação LOCAL/HYBRID registrada no Master (`master_installations`)
- Token do agente emitido pelo Master (uma vez)

## Emitir token (Master)

```http
POST /api/master/updates/installations/:id/agent-token
Authorization: Bearer <MASTER_JWT>
```

Resposta (token exibido **uma única vez**):

```json
{ "ok": true, "tokenId": "uat_...", "token": "uag_..." }
```

## Configuração

Copie `updater.env.example` para `updater.env` no diretório de instalação:

```env
PWD_CONTROL_PLANE_URL=https://master.seudominio.com
PWD_AGENT_TOKEN=uag_...
PWD_INSTALL_DIR=C:\PontoWebDesk
PWD_HEALTH_URL=http://127.0.0.1:3001/api/health/ready
PWD_SERVICE_NAMES=PontoWebDesk
```

## Build e execução

```bash
cd updater-agent
npm install
npm run build
npm test
node dist/index.js once   # um ciclo
node dist/index.js run    # loop (serviço)
```

## Instalar como serviço Windows

PowerShell **como Administrador**:

```powershell
.\scripts\install-windows-service.ps1 -InstallDir "C:\PontoWebDesk"
```

Remover:

```powershell
.\scripts\uninstall-windows-service.ps1
```

## API do agente (não usa navegador)

| Método | Path | Função |
|--------|------|--------|
| POST | `/api/update-agent/heartbeat` | Versão, health, fingerprint |
| POST | `/api/update-agent/claim` | Claim atômico + manifesto |
| POST | `/api/update-agent/report` | Estágios / conclusão / falha |

Autenticação: `Authorization: Bearer uag_...` ou `X-Update-Agent-Key`.

**Não** usa `MASTER_API_KEY` nem JWT operacional.

## Fluxo Master → Agente

```
Master: cria release → publica → cria request → aprova
Agente: heartbeat vê request → claim → download → verify → backup
      → install → restart → health → report completed
      (ou rolling_back → restore → report failed)
```

## Segurança

- Token por instalação (hash SHA-256 no servidor; texto puro só na emissão)
- Artefato só via HTTPS (localhost liberado para lab)
- SHA-256 obrigatório; assinatura HMAC/RSA opcional
- Rollback automático com checksum do backup
- Namespace isolado — não altera AuthSessionProvider / auth operacional
