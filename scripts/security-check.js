#!/usr/bin/env node
import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * Script de verificação de segurança pré-deploy.
 *
 * Executa validações críticas antes de permitir deploy em produção.
 *
 * Uso:
 *   node scripts/security-check.js
 *
 * Saída:
 *   - Código 0: Tudo OK
 *   - Código 1: Falha crítica (bloqueia deploy)
 *   - Código 2: Avisos (permite deploy com cautela)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Cores para terminal
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

let exitCode = 0;
let warnings = 0;
let errors = 0;

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.blue}[INFO]${colors.reset}`,
    warn: `${colors.yellow}[AVISO]${colors.reset}`,
    error: `${colors.red}[ERRO]${colors.reset}`,
    success: `${colors.green}[OK]${colors.reset}`,
  }[type] || '';

  observabilityConsole.log(`${prefix} ${message}`);
}

function section(title) {
  observabilityConsole.log(`\n${colors.bold}${'='.repeat(60)}${colors.reset}`);
  observabilityConsole.log(`${colors.bold}${title}${colors.reset}`);
  observabilityConsole.log(`${colors.bold}${'='.repeat(60)}${colors.reset}`);
}

// ============================================
// CHECK 1: Verificar se .env.local existe
// ============================================
function checkEnvLocal() {
  section('1. Verificação de Variáveis de Ambiente');

  const envPath = path.join(process.cwd(), '.env.local');

  if (!fs.existsSync(envPath)) {
    log('.env.local não encontrado! Copie de .env.local.example', 'error');
    errors++;
    return false;
  }

  log('.env.local existe', 'success');

  const envContent = fs.readFileSync(envPath, 'utf8');

  // Verificar variáveis obrigatórias
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'API_KEY',
  ];

  for (const key of required) {
    const regex = new RegExp(`^${key}=.+`, 'm');
    if (!regex.test(envContent)) {
      log(`${key} não configurada`, 'error');
      errors++;
    } else {
      const value = envContent.match(regex)[0].split('=')[1];

      // Verificar se é valor de exemplo
      if (value.includes('your_') || value.includes('example') || value === '') {
        log(`${key} contém valor de exemplo: ${value}`, 'error');
        errors++;
      } else {
        log(`${key} configurada`, 'success');
      }
    }
  }

  // Verificar chaves fracas
  const weakPatterns = [
    '123456',
    'password',
    'admin',
    'test',
    'changeme',
    'default',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', // JWT de exemplo
  ];

  for (const pattern of weakPatterns) {
    if (envContent.includes(pattern)) {
      log(`Possível chave fraca detectada: "${pattern}"`, 'error');
      errors++;
    }
  }

  return errors === 0;
}

// ============================================
// CHECK 2: Verificar se .env.local está no .gitignore
// ============================================
function checkGitignore() {
  section('2. Verificação de .gitignore');

  const gitignorePath = path.join(process.cwd(), '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    log('.gitignore não encontrado!', 'error');
    errors++;
    return false;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const patterns = ['.env.local', '.env', '*.log'];

  for (const pattern of patterns) {
    if (!gitignoreContent.includes(pattern)) {
      log(`${pattern} não está no .gitignore!`, 'error');
      errors++;
    } else {
      log(`${pattern} protegido no .gitignore`, 'success');
    }
  }

  return errors === 0;
}

// ============================================
// CHECK 3: Verificar arquivos de exemplo
// ============================================
function checkExampleFiles() {
  section('3. Verificação de Arquivos de Exemplo');

  const files = ['.env.example', '.env.local.example'];
  let ok = true;

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);

    if (!fs.existsSync(filePath)) {
      log(`${file} não encontrado!`, 'error');
      errors++;
      ok = false;
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Verificar se contém valores reais (heurística)
    const realValuePatterns = [
      /https:\/\/[a-z0-9-]+\.supabase\.co/, // URL Supabase real
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/, // JWT
      /[a-f0-9]{64}/, // Hex de 64 chars (possível chave)
    ];

    for (const pattern of realValuePatterns) {
      if (pattern.test(content)) {
        log(`${file} parece conter dados reais (padrão: ${pattern})`, 'error');
        errors++;
        ok = false;
      }
    }

    if (ok) {
      log(`${file} contém apenas placeholders`, 'success');
    }
  }

  return ok;
}

// ============================================
// CHECK 4: Verificar hardcoded secrets no código
// ============================================
function checkHardcodedSecrets() {
  section('4. Verificação de Secrets Hardcoded');

  const patterns = [
    /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']{20,}["']/,
    /api[_-]?key\s*=\s*["'][^"']{10,}["']/i,
    /password\s*=\s*["'][^"']{8,}["']/i,
    /secret\s*=\s*["'][^"']{10,}["']/i,
  ];

  const srcDir = path.join(process.cwd(), 'src');
  const apiDir = path.join(process.cwd(), 'api');

  // Verificar arquivos TypeScript/JavaScript
  const checkDir = (dir) => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir, { recursive: true });

    for (const file of files) {
      if (typeof file !== 'string') continue;
      if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;

      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Ignorar arquivos de teste
      if (file.includes('.test.') || file.includes('.spec.')) continue;

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          log(`Possível secret hardcoded em ${file}`, 'warn');
          warnings++;
        }
      }
    }
  };

  checkDir(srcDir);
  checkDir(apiDir);

  if (warnings === 0) {
    log('Nenhum secret hardcoded detectado', 'success');
  }

  return true;
}

// ============================================
// CHECK 5: Verificar configuração de CORS
// ============================================
function checkCorsConfig() {
  section('5. Verificação de Configuração CORS');

  const envPath = path.join(process.cwd(), '.env.local');

  if (!fs.existsSync(envPath)) {
    log('Não é possível verificar CORS sem .env.local', 'warn');
    warnings++;
    return false;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');

  // Verificar se CORS_ALLOWED_ORIGINS está configurado para produção
  const hasCorsConfig = envContent.includes('CORS_ALLOWED_ORIGINS');

  if (!hasCorsConfig) {
    log('CORS_ALLOWED_ORIGINS não configurado (usando defaults)', 'warn');
    log('Configure explicitamente para produção!', 'warn');
    warnings++;
  } else {
    const corsValue = envContent.match(/CORS_ALLOWED_ORIGINS=(.+)/)?.[1];
    if (corsValue && !corsValue.includes('*')) {
      log(`CORS configurado: ${corsValue}`, 'success');
    } else if (corsValue) {
      log('CORS_ALLOWED_ORIGINS contém wildcard (*)!', 'error');
      errors++;
    }
  }

  return errors === 0;
}

// ============================================
// CHECK 6: Verificar comprimento das chaves
// ============================================
function checkKeyStrength() {
  section('6. Verificação de Força das Chaves');

  const envPath = path.join(process.cwd(), '.env.local');

  if (!fs.existsSync(envPath)) {
    return false;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');

  // Verificar API_KEY
  const apiKeyMatch = envContent.match(/API_KEY=(.+)/);
  if (apiKeyMatch) {
    const key = apiKeyMatch[1];
    if (key.length < 16) {
      log(`API_KEY muito curta (${key.length} chars, mínimo 16)`, 'error');
      errors++;
    } else if (key.length < 32) {
      log(`API_KEY curta (${key.length} chars, recomendado 32+)`, 'warn');
      warnings++;
    } else {
      log(`API_KEY com comprimento adequado (${key.length} chars)`, 'success');
    }
  }

  // Verificar TIMESTAMP_SECRET_KEY
  const tsKeyMatch = envContent.match(/TIMESTAMP_SECRET_KEY=(.+)/);
  if (tsKeyMatch) {
    const key = tsKeyMatch[1];
    if (key.length < 32) {
      log(`TIMESTAMP_SECRET_KEY muito curta (${key.length} chars, mínimo 32)`, 'error');
      errors++;
    } else {
      log(`TIMESTAMP_SECRET_KEY com comprimento adequado`, 'success');
    }
  } else {
    log('TIMESTAMP_SECRET_KEY não configurada', 'warn');
    warnings++;
  }

  // Verificar BIOMETRIC_ENCRYPTION_KEY
  const bioKeyMatch = envContent.match(/BIOMETRIC_ENCRYPTION_KEY=(.+)/);
  if (bioKeyMatch) {
    const key = bioKeyMatch[1];
    if (key.length < 32) {
      log(`BIOMETRIC_ENCRYPTION_KEY muito curta (${key.length} chars)`, 'error');
      errors++;
    } else {
      log(`BIOMETRIC_ENCRYPTION_KEY configurada`, 'success');
    }
  }

  return errors === 0;
}

// ============================================
// MAIN
// ============================================
function main() {
  observabilityConsole.log(`${colors.bold}`);
  observabilityConsole.log('╔══════════════════════════════════════════════════════════╗');
  observabilityConsole.log('║     PontoWebDesk - Verificação de Segurança              ║');
  observabilityConsole.log('║              Pré-Deploy Checklist                        ║');
  observabilityConsole.log('╚══════════════════════════════════════════════════════════╝');
  observabilityConsole.log(`${colors.reset}`);

  // Executar checks
  checkEnvLocal();
  checkGitignore();
  checkExampleFiles();
  checkHardcodedSecrets();
  checkCorsConfig();
  checkKeyStrength();

  // Resumo
  section('RESUMO');

  if (errors === 0 && warnings === 0) {
    log('✅ Todas as verificações passaram!', 'success');
    log('Deploy pode prosseguir.', 'success');
    exitCode = 0;
  } else if (errors === 0) {
    log(`⚠️  ${warnings} aviso(s) encontrado(s)`, 'warn');
    log('Deploy pode prosseguir, mas reveja os avisos.', 'warn');
    exitCode = 2;
  } else {
    log(`❌ ${errors} erro(s) crítico(s) encontrado(s)`, 'error');
    log(`${warnings} aviso(s)`, 'warn');
    log('Deploy BLOQUEADO - Corrija os erros antes de prosseguir.', 'error');
    exitCode = 1;
  }

  observabilityConsole.log(`\n${colors.bold}Para mais informações, consulte SECURITY_MIGRATION_GUIDE.md${colors.reset}\n`);

  process.exit(exitCode);
}

main();
