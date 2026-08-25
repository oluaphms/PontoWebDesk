#!/usr/bin/env node
/**
 * Host SCM — PontoWebDesk Frontend (:3010).
 * Lê %ProgramData%\PontoWebDesk\Config\frontend-service.json (escrito pelo Bootstrap).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

function defaultConfigPath() {
  const pd = process.env.ProgramData || process.env.PROGRAMDATA;
  if (pd) return path.join(pd, 'PontoWebDesk', 'Config', 'frontend-service.json');
  return path.join(__dirname, '..', '..', 'ProgramData', 'PontoWebDesk', 'Config', 'frontend-service.json');
}

function loadConfig() {
  const cfgPath = process.env.PWD_FRONTEND_CONFIG || defaultConfigPath();
  if (fs.existsSync(cfgPath)) {
    const doc = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return {
      wwwRoot: String(doc.wwwRoot),
      host: String(doc.host || '127.0.0.1'),
      port: Number(doc.port || 3010),
      logFile: String(doc.logFile || ''),
    };
  }
  return {
    wwwRoot: path.resolve(__dirname, '..', 'Frontend', 'www'),
    host: process.env.PWD_FRONTEND_HOST || '127.0.0.1',
    port: Number(process.env.PWD_FRONTEND_PORT || 3010),
    logFile: '',
  };
}

function appendLog(logFile, line) {
  if (!logFile) return;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const rel = decoded.replace(/^\/+/, '') || 'index.html';
  const abs = path.normalize(path.join(root, rel));
  if (!abs.startsWith(root)) return null;
  return abs;
}

const cfg = loadConfig();
const wwwRoot = path.resolve(cfg.wwwRoot);
const logFile = cfg.logFile;

appendLog(logFile, `[${new Date().toISOString()}] frontend-service starting host=${cfg.host} port=${cfg.port} www=${wwwRoot}`);

const server = http.createServer((req, res) => {
  let file = safeJoin(wwwRoot, req.url || '/');
  if (!file) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file)) {
    file = path.join(wwwRoot, 'index.html');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      appendLog(logFile, `[${new Date().toISOString()}] 404 ${req.url}`);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(cfg.port, cfg.host, () => {
  appendLog(logFile, `[${new Date().toISOString()}] listening http://${cfg.host}:${cfg.port}/`);
});

function shutdown() {
  appendLog(logFile, `[${new Date().toISOString()}] shutdown`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
