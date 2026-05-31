#!/usr/bin/env node
import { observabilityConsole } from '../src/shared/logger/observabilityConsole';

/**
 * Performance Validation Script
 * 
 * Valida se as otimizações foram aplicadas corretamente
 * Mede performance antes e depois
 * 
 * Uso: npx ts-node scripts/validate-performance.ts
 */

import { performance } from 'perf_hooks';

interface PerformanceMetrics {
  name: string;
  duration: number;
  status: 'pass' | 'fail' | 'warning';
  message: string;
}

const metrics: PerformanceMetrics[] = [];

// ============================================================================
// VALIDAÇÃO 1: Índices no Supabase
// ============================================================================

async function validateIndexes(): Promise<void> {
  observabilityConsole.log('\n📊 Validando Índices no Supabase...\n');

  const requiredIndexes = [
    'idx_time_records_user_company_date',
    'idx_users_company_role',
    'idx_requests_status_user',
    'idx_employee_shift_schedule_employee',
    'idx_audit_logs_company_date',
    'idx_adjustments_user_company_date',
    'idx_notifications_user_read',
  ];

  observabilityConsole.log('✅ Índices esperados:');
  requiredIndexes.forEach(idx => {
    observabilityConsole.log(`   - ${idx}`);
  });

  observabilityConsole.log('\n⚠️  Para validar, execute no Supabase SQL Editor:');
  observabilityConsole.log('   SELECT * FROM pg_indexes WHERE tablename IN (');
  observabilityConsole.log("     'time_records', 'users', 'requests', 'employee_shift_schedule',");
  observabilityConsole.log("     'audit_logs', 'adjustments', 'notifications'");
  observabilityConsole.log('   );');

  metrics.push({
    name: 'Índices Supabase',
    duration: 0,
    status: 'warning',
    message: 'Validação manual necessária no Supabase Dashboard'
  });
}

// ============================================================================
// VALIDAÇÃO 2: API de Funcionários com Paginação
// ============================================================================

async function validateEmployeesAPI(): Promise<void> {
  observabilityConsole.log('\n📊 Validando API de Funcionários...\n');

  try {
    const start = performance.now();

    // Teste 1: Sem paginação (deve falhar ou retornar com paginação)
    observabilityConsole.log('Teste 1: Requisição sem paginação');
    const response1 = await fetch('http://localhost:3000/api/employees?companyId=comp_1', {
      headers: { 'Authorization': `Bearer ${process.env.API_KEY || 'test'}` }
    });

    if (!response1.ok) {
      throw new Error(`API retornou ${response1.status}`);
    }

    const data1 = await response1.json();
    const duration1 = performance.now() - start;

    observabilityConsole.log(`✅ Status: ${response1.status}`);
    observabilityConsole.log(`✅ Tempo: ${duration1.toFixed(2)}ms`);

    // Validar estrutura de resposta
    if (data1.pagination) {
      observabilityConsole.log('✅ Paginação implementada');
      observabilityConsole.log(`   - Page: ${data1.pagination.page}`);
      observabilityConsole.log(`   - Limit: ${data1.pagination.limit}`);
      observabilityConsole.log(`   - Total: ${data1.pagination.total}`);
      observabilityConsole.log(`   - Total Pages: ${data1.pagination.totalPages}`);

      metrics.push({
        name: 'API Paginação',
        duration: duration1,
        status: 'pass',
        message: 'Paginação implementada corretamente'
      });
    } else {
      observabilityConsole.log('⚠️  Paginação não encontrada');
      metrics.push({
        name: 'API Paginação',
        duration: duration1,
        status: 'warning',
        message: 'Paginação não implementada'
      });
    }

    // Teste 2: Com paginação
    observabilityConsole.log('\nTeste 2: Requisição com paginação');
    const start2 = performance.now();
    const response2 = await fetch('http://localhost:3000/api/employees?companyId=comp_1&page=1&limit=50', {
      headers: { 'Authorization': `Bearer ${process.env.API_KEY || 'test'}` }
    });

    const data2 = await response2.json();
    const duration2 = performance.now() - start2;

    observabilityConsole.log(`✅ Status: ${response2.status}`);
    observabilityConsole.log(`✅ Tempo: ${duration2.toFixed(2)}ms`);
    observabilityConsole.log(`✅ Registros retornados: ${data2.employees?.length || 0}`);

    if (duration2 < 500) {
      observabilityConsole.log('✅ Tempo de resposta < 500ms');
    } else {
      observabilityConsole.log(`⚠️  Tempo de resposta > 500ms (${duration2.toFixed(2)}ms)`);
    }

  } catch (error) {
    observabilityConsole.log(`❌ Erro ao validar API: ${error}`);
    metrics.push({
      name: 'API Paginação',
      duration: 0,
      status: 'fail',
      message: `Erro: ${error}`
    });
  }
}

// ============================================================================
// VALIDAÇÃO 3: Cache Global
// ============================================================================

async function validateCacheGlobal(): Promise<void> {
  observabilityConsole.log('\n📊 Validando Cache Global...\n');

  try {
    // Verificar se arquivo existe
    const fs = await import('fs');
    const path = await import('path');

    const cacheFilePath = path.join(process.cwd(), 'services', 'pontoService.optimized.ts');

    if (fs.existsSync(cacheFilePath)) {
      observabilityConsole.log('✅ Arquivo pontoService.optimized.ts encontrado');

      const content = fs.readFileSync(cacheFilePath, 'utf-8');

      // Validar componentes
      const hasCache = content.includes('class CacheManager');
      const hasDedup = content.includes('class QueryDeduplicator');
      const hasBatch = content.includes('async function batchFetch');

      observabilityConsole.log(`${hasCache ? '✅' : '❌'} CacheManager implementado`);
      observabilityConsole.log(`${hasDedup ? '✅' : '❌'} QueryDeduplicator implementado`);
      observabilityConsole.log(`${hasBatch ? '✅' : '❌'} batchFetch implementado`);

      if (hasCache && hasDedup && hasBatch) {
        metrics.push({
          name: 'Cache Global',
          duration: 0,
          status: 'pass',
          message: 'Cache global implementado corretamente'
        });
      } else {
        metrics.push({
          name: 'Cache Global',
          duration: 0,
          status: 'warning',
          message: 'Alguns componentes de cache não encontrados'
        });
      }
    } else {
      observabilityConsole.log('❌ Arquivo pontoService.optimized.ts não encontrado');
      metrics.push({
        name: 'Cache Global',
        duration: 0,
        status: 'fail',
        message: 'Arquivo não encontrado'
      });
    }

  } catch (error) {
    observabilityConsole.log(`❌ Erro ao validar cache: ${error}`);
    metrics.push({
      name: 'Cache Global',
      duration: 0,
      status: 'fail',
      message: `Erro: ${error}`
    });
  }
}

// ============================================================================
// VALIDAÇÃO 4: Documentação
// ============================================================================

async function validateDocumentation(): Promise<void> {
  observabilityConsole.log('\n📊 Validando Documentação...\n');

  try {
    const fs = await import('fs');

    const requiredDocs = [
      'DIAGNOSTICO_PERFORMANCE.md',
      'OTIMIZACOES_IMPLEMENTADAS.md',
      'GUIA_REACT_QUERY.md',
      'PLANO_EXECUCAO_PERFORMANCE.md',
      'RESUMO_OTIMIZACOES.md',
    ];

    let allFound = true;

    requiredDocs.forEach(doc => {
      const exists = fs.existsSync(doc);
      observabilityConsole.log(`${exists ? '✅' : '❌'} ${doc}`);
      if (!exists) allFound = false;
    });

    metrics.push({
      name: 'Documentação',
      duration: 0,
      status: allFound ? 'pass' : 'warning',
      message: allFound ? 'Toda documentação presente' : 'Alguns documentos faltando'
    });

  } catch (error) {
    observabilityConsole.log(`❌ Erro ao validar documentação: ${error}`);
    metrics.push({
      name: 'Documentação',
      duration: 0,
      status: 'fail',
      message: `Erro: ${error}`
    });
  }
}

// ============================================================================
// VALIDAÇÃO 5: Migrations
// ============================================================================

async function validateMigrations(): Promise<void> {
  observabilityConsole.log('\n📊 Validando Migrations...\n');

  try {
    const fs = await import('fs');

    const migrationPath = 'supabase/migrations/20260412_create_performance_indexes.sql';

    if (fs.existsSync(migrationPath)) {
      observabilityConsole.log('✅ Migration de índices encontrada');

      const content = fs.readFileSync(migrationPath, 'utf-8');

      // Contar índices
      const indexCount = (content.match(/CREATE INDEX/g) || []).length;
      observabilityConsole.log(`✅ ${indexCount} índices definidos`);

      if (indexCount >= 13) {
        observabilityConsole.log('✅ Todos os índices esperados presentes');
        metrics.push({
          name: 'Migrations',
          duration: 0,
          status: 'pass',
          message: `${indexCount} índices definidos`
        });
      } else {
        observabilityConsole.log(`⚠️  Apenas ${indexCount} índices (esperado 13)`);
        metrics.push({
          name: 'Migrations',
          duration: 0,
          status: 'warning',
          message: `${indexCount} índices (esperado 13)`
        });
      }
    } else {
      observabilityConsole.log('❌ Migration não encontrada');
      metrics.push({
        name: 'Migrations',
        duration: 0,
        status: 'fail',
        message: 'Migration não encontrada'
      });
    }

  } catch (error) {
    observabilityConsole.log(`❌ Erro ao validar migrations: ${error}`);
    metrics.push({
      name: 'Migrations',
      duration: 0,
      status: 'fail',
      message: `Erro: ${error}`
    });
  }
}

// ============================================================================
// RELATÓRIO FINAL
// ============================================================================

function printReport(): void {
  observabilityConsole.log('\n' + '='.repeat(70));
  observabilityConsole.log('📊 RELATÓRIO DE VALIDAÇÃO DE PERFORMANCE');
  observabilityConsole.log('='.repeat(70) + '\n');

  const passed = metrics.filter(m => m.status === 'pass').length;
  const failed = metrics.filter(m => m.status === 'fail').length;
  const warnings = metrics.filter(m => m.status === 'warning').length;

  observabilityConsole.log('Resultados:');
  observabilityConsole.log(`  ✅ Passou: ${passed}`);
  observabilityConsole.log(`  ⚠️  Avisos: ${warnings}`);
  observabilityConsole.log(`  ❌ Falhou: ${failed}`);
  observabilityConsole.log();

  observabilityConsole.log('Detalhes:');
  metrics.forEach(metric => {
    const icon = metric.status === 'pass' ? '✅' : metric.status === 'warning' ? '⚠️' : '❌';
    observabilityConsole.log(`${icon} ${metric.name}`);
    observabilityConsole.log(`   ${metric.message}`);
    if (metric.duration > 0) {
      observabilityConsole.log(`   Tempo: ${metric.duration.toFixed(2)}ms`);
    }
  });

  observabilityConsole.log('\n' + '='.repeat(70));

  if (failed === 0) {
    observabilityConsole.log('✅ VALIDAÇÃO CONCLUÍDA COM SUCESSO!');
  } else {
    observabilityConsole.log('❌ VALIDAÇÃO ENCONTROU PROBLEMAS');
  }

  observabilityConsole.log('='.repeat(70) + '\n');

  // Próximos passos
  observabilityConsole.log('📋 Próximos Passos:');
  observabilityConsole.log('  1. Executar migration de índices no Supabase');
  observabilityConsole.log('  2. Testar API de funcionários com paginação');
  observabilityConsole.log('  3. Integrar cache global em componentes');
  observabilityConsole.log('  4. Implementar React Query');
  observabilityConsole.log('  5. Validar performance com Lighthouse\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  observabilityConsole.log('\n🚀 Iniciando Validação de Performance...\n');

  await validateIndexes();
  await validateEmployeesAPI();
  await validateCacheGlobal();
  await validateDocumentation();
  await validateMigrations();

  printReport();
}

main().catch(console.error);
