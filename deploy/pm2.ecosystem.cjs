/**
 * PM2 na VPS — garante cwd no backend (dotenv lê backend/.env).
 * Uso na VPS:
 *   cd /root/PontoWebDesk/backend && npm run build
 *   pm2 delete pontoweb-api 2>/dev/null; pm2 start ../deploy/pm2.ecosystem.cjs
 *   pm2 save
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
