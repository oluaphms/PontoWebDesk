// @vitest-environment node
/**
 * Governança: inspeciona masterApiRouter automaticamente e exige
 * reportMasterContractViolations em todo handler que expõe vigência.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MASTER_VALIDITY_ROUTE_COVERAGE } from '../contract/masterEndpointContracts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const routerPath = path.resolve(here, 'routes/masterApiRouter.ts');
const backendSrc = path.resolve(here, '../..');

type DiscoveredRoute = {
  method: string;
  path: string;
  handler: string;
  importPath: string;
};

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function resolveImportToFile(fromFile: string, spec: string): string | null {
  const cleaned = spec.replace(/\.js$/i, '');
  const base = path.resolve(path.dirname(fromFile), cleaned);
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function buildHandlerImportMap(routerSrc: string, routerFile: string): Map<string, string> {
  const map = new Map<string, string>();
  const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(routerSrc))) {
    const names = m[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.replace(/\s+as\s+.+$/, '').trim());
    const file = resolveImportToFile(routerFile, m[2]);
    if (!file) continue;
    for (const name of names) {
      if (name) map.set(name, file);
    }
  }
  return map;
}

/**
 * Extrai rotas do source do Express Router.
 * Handler = último identificador antes do `)` de fechamento da chamada.
 */
function discoverRoutes(routerSrc: string): Array<{ method: string; path: string; handler: string }> {
  const routes: Array<{ method: string; path: string; handler: string }> = [];
  const callRe = /router\.(get|post|put|patch|delete)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(routerSrc))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < routerSrc.length && depth > 0) {
      const ch = routerSrc[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    const args = routerSrc.slice(start, i - 1);
    const pathMatch = args.match(/['`]([^'`]+)['`]/);
    if (!pathMatch) continue;
    const idents = [...args.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)].map((x) => x[1]);
    // Remove keywords / helpers comuns; o handler é o último ident da lista.
    const handler = idents[idents.length - 1];
    if (!handler || handler === 'requireMasterPermission' || handler === 'masterAuthRateLimit') {
      continue;
    }
    routes.push({
      method: m[1].toUpperCase(),
      path: pathMatch[1],
      handler,
    });
  }
  return routes;
}

function extractHandlerBody(source: string, handlerName: string): string | null {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${handlerName}\\s*\\([\\s\\S]*?\\)\\s*(?::\\s*[^{]+)?\\{`,
  );
  const match = re.exec(source);
  if (!match || match.index == null) return null;
  let i = match.index + match[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return source.slice(match.index, i);
}

function handlerExposesValidity(body: string): boolean {
  const markers = [
    'reportMasterContractViolations',
    'validateTenantResponse',
    'validateTenantsResponse',
    'validateLicensesResponse',
    'validateLicenseMutationResponse',
    'validateDashboardResponse',
    'validateSummaryResponse',
    'validateOperationalCompaniesResponse',
    'ensureCompanyLicenseValidity',
    'enrichTenantWithLicenseValidity',
  ];
  return markers.some((mk) => body.includes(mk));
}

describe('masterApiRouter — descoberta automática de governança de vigência', () => {
  const routerSrc = read(routerPath);
  const handlerFiles = buildHandlerImportMap(routerSrc, routerPath);
  const routes: DiscoveredRoute[] = discoverRoutes(routerSrc).map((r) => ({
    ...r,
    importPath: handlerFiles.get(r.handler) ?? '',
  }));

  it('descobre rotas reais a partir do masterApiRouter', () => {
    expect(routes.length).toBeGreaterThan(40);
    const keys = new Set(routes.map((r) => `${r.method} ${r.path} → ${r.handler}`));
    expect(keys.has('GET /dashboard → getDashboard')).toBe(true);
    expect(keys.has('GET /licenses → getLicensesManager')).toBe(true);
    expect(keys.has('GET /tenants → getTenants')).toBe(true);
    expect(keys.has('GET /operational-companies → getOperationalCompaniesDirectory')).toBe(true);
    expect(keys.has('PATCH /tenants/:id → patchTenant')).toBe(true);
    expect(keys.has('POST /tenants/:id/actions/:action → postTenantAction')).toBe(true);
  });

  it('toda rota descoberta no router que expõe vigência está guardada', () => {
    const exposed: Array<{
      method: string;
      path: string;
      handler: string;
      file: string;
      guarded: boolean;
    }> = [];

    for (const route of routes) {
      if (!route.importPath || !fs.existsSync(route.importPath)) continue;
      // Controllers legados fora de api/controllers sem contrato Master — ignorar.
      if (!route.importPath.replace(/\\/g, '/').includes('/master/api/controllers/')) continue;
      const source = read(route.importPath);
      const body = extractHandlerBody(source, route.handler);
      if (!body) continue;
      if (!handlerExposesValidity(body)) continue;
      exposed.push({
        method: route.method,
        path: route.path,
        handler: route.handler,
        file: path.relative(backendSrc, route.importPath).replace(/\\/g, '/'),
        guarded: body.includes('reportMasterContractViolations'),
      });
    }

    expect(exposed.length).toBeGreaterThanOrEqual(13);
    const unguarded = exposed.filter((e) => !e.guarded);
    expect(
      unguarded,
      unguarded.length
        ? `Handlers que expõem vigência sem reportMasterContractViolations:\n${unguarded
            .map((u) => `- ${u.method} ${u.path} → ${u.handler} (${u.file})`)
            .join('\n')}`
        : undefined,
    ).toEqual([]);
  });

  it('MASTER_VALIDITY_ROUTE_COVERAGE está 100% presente e guardada no router descoberto', () => {
    const byKey = new Map(routes.map((r) => [`${r.method} ${r.path}`, r]));

    for (const cov of MASTER_VALIDITY_ROUTE_COVERAGE) {
      const key = `${cov.method} ${cov.path}`;
      const found = byKey.get(key);
      expect(found, `Rota ${key} ausente no masterApiRouter`).toBeTruthy();
      expect(found!.handler).toBe(cov.handler);

      const file = handlerFiles.get(cov.handler);
      expect(file, `import do handler ${cov.handler} não encontrado no router`).toBeTruthy();
      const body = extractHandlerBody(read(file!), cov.handler);
      expect(body, `body do handler ${cov.handler}`).toBeTruthy();
      expect(body!.includes('reportMasterContractViolations')).toBe(true);
      expect(body!.includes(cov.validator)).toBe(true);
    }

    // Toda rota descoberta com guard de contrato deve constar na cobertura.
    const coverageKeys = new Set(
      MASTER_VALIDITY_ROUTE_COVERAGE.map((c) => `${c.method} ${c.path}`),
    );
    const discoveredGuarded: string[] = [];
    for (const route of routes) {
      if (!route.importPath) continue;
      if (!route.importPath.replace(/\\/g, '/').includes('/master/api/controllers/')) continue;
      const body = extractHandlerBody(read(route.importPath), route.handler);
      if (!body?.includes('reportMasterContractViolations')) continue;
      discoveredGuarded.push(`${route.method} ${route.path}`);
    }
    const missing = discoveredGuarded.filter((k) => !coverageKeys.has(k));
    expect(
      missing,
      missing.length
        ? `Rotas guardadas no router fora de MASTER_VALIDITY_ROUTE_COVERAGE:\n${missing.join('\n')}`
        : undefined,
    ).toEqual([]);
  });
});
