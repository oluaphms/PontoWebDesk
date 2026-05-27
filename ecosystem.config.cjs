/**
 * PM2 — use na raiz do projeto:
 *   cd /root/PontoWebDesk && pm2 start ecosystem.config.cjs
 *   pm2 save
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'pontoweb-api',
      script: 'dist/server.js',
      cwd: path.join(__dirname, 'backend'),
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
