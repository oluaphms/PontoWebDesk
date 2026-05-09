type RolloutContext = {
  featureName: string;
  companyId?: string | null;
  tenantId?: string | null;
  allowlist?: string[];
  percentage?: number;
};

const rolloutCache = new Map<string, boolean>();

function simpleHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export function resolveOperationalRollout(ctx: RolloutContext): boolean {
  const id = ctx.companyId ?? ctx.tenantId ?? '';
  if (!id) {
    console.info('[ROLLOUT SKIPPED]', { feature: ctx.featureName, reason: 'missing_tenant_or_company' });
    return false;
  }
  const key = `${ctx.featureName}:${id}:${ctx.percentage ?? 0}`;
  const cached = rolloutCache.get(key);
  if (cached != null) return cached;

  if (ctx.allowlist?.includes(id)) {
    console.info('[ROLLOUT ENABLED]', { feature: ctx.featureName, target: id, mode: 'allowlist' });
    rolloutCache.set(key, true);
    return true;
  }

  const percentage = Math.max(0, Math.min(100, ctx.percentage ?? 0));
  const bucket = simpleHash(`${id}:${ctx.featureName}`) % 100;
  const enabled = bucket < percentage;
  console.info(enabled ? '[ROLLOUT ENABLED]' : '[ROLLOUT SKIPPED]', {
    feature: ctx.featureName,
    target: id,
    mode: 'percentage',
    bucket,
    percentage,
  });
  console.info('[ROLLOUT PERCENTAGE]', { feature: ctx.featureName, percentage, bucket, enabled });
  rolloutCache.set(key, enabled);
  return enabled;
}

export function clearOperationalRolloutCache(): void {
  rolloutCache.clear();
}

