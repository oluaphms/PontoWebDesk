/**
 * Infraestrutura de auto-update assinado do rep-agent.exe (preparação).
 * O download/apply efetivo exige deploy manual até Authenticode estar configurado.
 */
import { createHash } from 'node:crypto';

export const AGENT_VERSION_ENV = 'REP_AGENT_VERSION';
export const DEFAULT_AGENT_VERSION = '1.0.0';

/**
 * @returns {string}
 */
export function getCurrentAgentVersion() {
  return (
    String(process.env[AGENT_VERSION_ENV] || '').trim() ||
    (typeof __REP_AGENT_BUILD_ID__ !== 'undefined' ? String(__REP_AGENT_BUILD_ID__) : '') ||
    DEFAULT_AGENT_VERSION
  );
}

/**
 * @param {string} version
 */
export function parseAgentSemver(version) {
  const m = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), raw: m[0] };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} -1 | 0 | 1
 */
export function compareAgentVersions(a, b) {
  const pa = parseAgentSemver(a);
  const pb = parseAgentSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

/**
 * Stub de verificação Authenticode — em produção substituir por WinVerifyTrust via script PS.
 * @param {Buffer} _artifactBytes
 * @param {string} expectedSha256
 * @param {string} actualSha256Hex
 */
export function verifySignedArtifactSha256(actualSha256Hex, expectedSha256) {
  const a = String(actualSha256Hex || '').trim().toLowerCase();
  const e = String(expectedSha256 || '').trim().toLowerCase();
  return Boolean(a && e && a === e);
}

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * @param {{ saasUrl: string, apiKey: string, deviceId?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
export async function checkForAgentUpdate(opts) {
  const saas = String(opts.saasUrl || '').replace(/\/+$/, '');
  const apiKey = String(opts.apiKey || '').trim();
  const current = getCurrentAgentVersion();
  if (!saas || !apiKey) {
    return { ok: false, message: 'saasUrl e apiKey obrigatórios', current_version: current };
  }

  const deviceQ = opts.deviceId ? `?device_id=${encodeURIComponent(opts.deviceId)}` : '';
  const url = `${saas}/api/rep/agent-version${deviceQ}`;
  const fetchFn = opts.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      return { ok: false, message: `agent-version HTTP ${res.status}`, current_version: current };
    }
    const latest = String(data?.version || data?.latest_version || '').trim();
    const minSupported = String(data?.min_supported_version || '').trim();
    const downloadUrl = String(data?.download_url || '').trim();
    const sha256 = String(data?.sha256 || '').trim();
    const signatureKind = String(data?.signature_kind || 'sha256+authenticode').trim();
    const needsUpdate = latest ? compareAgentVersions(current, latest) < 0 : false;
    const belowMin = minSupported ? compareAgentVersions(current, minSupported) < 0 : false;
    return {
      ok: true,
      current_version: current,
      latest_version: latest || current,
      min_supported_version: minSupported || null,
      needs_update: needsUpdate,
      below_minimum: belowMin,
      download_url: downloadUrl || null,
      sha256: sha256 || null,
      signature_kind: signatureKind,
      release_notes: data?.release_notes || null,
    };
  } catch (e) {
    return { ok: false, message: e?.message || String(e), current_version: current };
  } finally {
    clearTimeout(timer);
  }
}
