#!/usr/bin/env bash
# Instala o site api.phmsdev.com.br no Nginx (Ubuntu/Debian).
# Uso na VPS: sudo bash deploy/nginx/install-api-vps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_NAME="api.phmsdev.com.br"
SRC="${SCRIPT_DIR}/${CONF_NAME}.conf"
DEST="/etc/nginx/sites-available/${CONF_NAME}"

if [[ ! -f "$SRC" ]]; then
  echo "[nginx] Arquivo não encontrado: $SRC"
  exit 1
fi

cp "$SRC" "$DEST"
ln -sf "$DEST" "/etc/nginx/sites-enabled/${CONF_NAME}"

# Evita que sites-available/default com proxy_pass errado capture o tráfego
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  echo "[nginx] Removendo symlink default (proxy incorreto costuma estar aqui)"
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

echo "[nginx] OK — ${CONF_NAME} ativo"
echo "[nginx] Teste: curl -sS https://${CONF_NAME}/api/health"
