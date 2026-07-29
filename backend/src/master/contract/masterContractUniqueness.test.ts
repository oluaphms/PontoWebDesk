/**
 * Governança de compilação: o shape de CommercialLicenseViewState
 * só pode existir em shared/master-contract — inclusive clones com outro nome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMERCIAL_VALIDITY_KEYS } from '@pontowebdesk/master-contract';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const sharedCanonical = path.resolve(repoRoot, 'shared/master-contract');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.vite',
  'build',
  'out',
]);

/** Fingerprint mínimo: se um type tiver TODOS esses campos, é clone do contrato. */
const VALIDITY_FINGERPRINT = [
  'phase',
  'displayStatus',
  'statusLabel',
  'shouldBlock',
  'remainingLabel',
  'daysRemaining',
  'daysExpired',
  'startsAtEffective',
  'startsToday',
  'expiresToday',
] as const;

const FORBIDDEN_TYPE_NAMES = new Set([
  'CommercialLicenseViewState',
  'CommercialValidityDto',
  'LicenseValidityDto',
  'CommercialLicenseResponse',
  'CommercialValidityView',
  'LicenseValidityViewState',
]);

type TypeDef = {
  name: string;
  props: string[];
  file: string;
  kind: 'type' | 'interface';
};

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    // Fixtures/exemplos em testes não são clones de produção.
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function isUnderSharedCanonical(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const canonical = path.normalize(sharedCanonical);
  return normalized === canonical || normalized.startsWith(canonical + path.sep);
}

function extractObjectBody(source: string, openBraceIndex: number): string | null {
  if (source[openBraceIndex] !== '{') return null;
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, i);
    }
  }
  return null;
}

function propsFromBody(body: string): string[] {
  const props = new Set<string>();
  const re = /(?:^|[;{,\n])\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[?]?\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    props.add(m[1]);
  }
  return [...props].sort();
}

function extractTypeDefs(source: string, file: string): TypeDef[] {
  const defs: TypeDef[] = [];
  const typeRe = /(?:export\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = typeRe.exec(source))) {
    const body = extractObjectBody(source, m.index + m[0].length - 1);
    if (!body) continue;
    defs.push({
      name: m[1],
      props: propsFromBody(body),
      file,
      kind: 'type',
    });
  }
  const ifaceRe = /(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:extends\s+[^{]+)?\{/g;
  while ((m = ifaceRe.exec(source))) {
    const body = extractObjectBody(source, m.index + m[0].length - 1);
    if (!body) continue;
    defs.push({
      name: m[1],
      props: propsFromBody(body),
      file,
      kind: 'interface',
    });
  }
  return defs;
}

function hasFullFingerprint(props: string[]): boolean {
  const set = new Set(props);
  return VALIDITY_FINGERPRINT.every((k) => set.has(k));
}

function hasAllCanonicalKeys(props: string[]): boolean {
  const set = new Set(props);
  return COMMERCIAL_VALIDITY_KEYS.every((k) => set.has(k));
}

describe('master-contract — sem definições duplicadas (nome + shape)', () => {
  it('não há clones estruturais de CommercialLicenseViewState fora do pacote compartilhado', () => {
    const roots = [
      path.join(repoRoot, 'src'),
      path.join(repoRoot, 'backend', 'src'),
      path.join(repoRoot, 'shared'),
      path.join(repoRoot, 'api'),
    ];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of walkTsFiles(root)) {
        if (isUnderSharedCanonical(file)) continue;
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        const text = fs.readFileSync(file, 'utf8');
        for (const def of extractTypeDefs(text, rel)) {
          const forbiddenName = FORBIDDEN_TYPE_NAMES.has(def.name);
          const structuralClone =
            hasFullFingerprint(def.props) || hasAllCanonicalKeys(def.props);
          if (forbiddenName || structuralClone) {
            offenders.push(
              `${def.kind} ${def.name} em ${rel} (props=${def.props.join(',')})`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      offenders.length
        ? `Clones / definições proibidas fora de shared/master-contract:\n${offenders.join('\n')}`
        : undefined,
    ).toEqual([]);
  });

  it('única definição canônica vive em shared/master-contract', () => {
    const shapeSrc = fs.readFileSync(
      path.join(sharedCanonical, 'commercialLicenseViewState.ts'),
      'utf8',
    );
    const defs = extractTypeDefs(shapeSrc, 'shared/master-contract/commercialLicenseViewState.ts');
    const canonical = defs.find((d) => d.name === 'CommercialLicenseViewState');
    expect(canonical).toBeTruthy();
    expect(canonical!.props).toEqual([...COMMERCIAL_VALIDITY_KEYS].sort());
  });

  it('detector estrutural flagraria um CommercialValidityDto clone', () => {
    const fake = `
      export type CommercialValidityDto = {
        phase: string;
        displayStatus: string;
        statusLabel: string;
        shouldBlock: boolean;
        reason: string | null;
        label: string;
        remainingLabel: string;
        daysDelta: number | null;
        daysRemaining: number | null;
        daysExpired: number | null;
        startsAtEffective: string;
        expiresAt: string | null;
        startsToday: boolean;
        expiresToday: boolean;
      };
    `;
    const defs = extractTypeDefs(fake, 'fake.ts');
    expect(defs).toHaveLength(1);
    expect(hasFullFingerprint(defs[0].props)).toBe(true);
    expect(FORBIDDEN_TYPE_NAMES.has(defs[0].name)).toBe(true);
  });
});
