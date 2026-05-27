/**
 * PM2 na VPS — garante cwd no backend (dotenv lê backend/.env).
 * Preferir ecosystem na raiz:
 *   cd /root/PontoWebDesk && pm2 start ecosystem.config.cjs && pm2 save
 *
 * Alternativa direta:
 *   cd /root/PontoWebDesk/backend && pm2 start dist/server.js --name pontoweb-api
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'pontoweb-api',
      script: 'dist/server.js',
      cwd: path.join(__dirname, '..', 'backend'),
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
