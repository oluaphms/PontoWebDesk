const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type Parsed = { major: number; minor: number; patch: number; prerelease: string[] };

export function parseSemver(value: unknown): Parsed | null {
  const match = String(value ?? '').trim().match(SEMVER_RE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av == null) return -1;
    if (bv == null) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av) ? Number(av) : null;
    const bn = /^\d+$/.test(bv) ? Number(bv) : null;
    if (an != null && bn != null) return an - bn;
    if (an != null) return -1;
    if (bn != null) return 1;
    return av.localeCompare(bv);
  }
  return 0;
}

/** Negativo quando a < b, zero quando iguais, positivo quando a > b. Null se inválido. */
export function compareSemver(a: unknown, b: unknown): number | null {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) return null;
  if (av.major !== bv.major) return av.major - bv.major;
  if (av.minor !== bv.minor) return av.minor - bv.minor;
  if (av.patch !== bv.patch) return av.patch - bv.patch;
  return comparePrerelease(av.prerelease, bv.prerelease);
}

export function isValidSemver(value: unknown): boolean {
  return parseSemver(value) != null;
}
