/**
 * HTTP(S) para o relógio no Node — TLS inseguro opcional (certificado próprio).
 * Usa `http`/`https` nativos com `insecureHTTPParser: relógios costumam violar RFC 9110
 * em cabeçalhos (ex.: caracteres inválidos) e o fetch/undici rejeita com
 * "Invalid header value char". Não use este módulo no bundle do browser.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import type { RepDevice } from './types';

export function getRepConnectionFlags(device: RepDevice): { https: boolean; tlsInsecure: boolean } {
  const ex =
    device.config_extra && typeof device.config_extra === 'object'
      ? (device.config_extra as Record<string, unknown>)
      : {};
  return {
    https: ex.https === true || ex.protocol === 'https',
    tlsInsecure: ex.tls_insecure === true || ex.accept_self_signed === true,
  };
}

export function envTlsInsecureAll(): boolean {
  const v = (process.env.REP_DEVICE_TLS_INSECURE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function shouldUseInsecureTls(device: RepDevice): boolean {
  if (envTlsInsecureAll()) return true;
  return getRepConnectionFlags(device).tlsInsecure;
}

export function buildDeviceOrigin(device: RepDevice): string {
  const raw = (device.ip || '').trim();
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return new URL(raw).origin;
  }
  const { https: useHttps } = getRepConnectionFlags(device);
  let portNum = device.porta != null && device.porta > 0 ? device.porta : null;
  if (portNum == null) {
    const fab = (device.fabricante || '').toLowerCase();
    if (fab.includes('control')) portNum = useHttps ? 443 : 8080;
    else portNum = useHttps ? 443 : 80;
  }
  const scheme = useHttps ? 'https' : 'http';
  return `${scheme}://${raw}:${portNum}`;
}

function outgoingHeaders(h: RequestInit['headers']): http.OutgoingHttpHeaders {
  if (!h) return {};
  if (h instanceof Headers) {
    const o: http.OutgoingHttpHeaders = {};
    h.forEach((value, key) => {
      o[key] = value;
    });
    return o;
  }
  if (Array.isArray(h)) {
    const o: http.OutgoingHttpHeaders = {};
    for (const [k, v] of h) o[k] = v;
    return o;
  }
  return { ...(h as Record<string, string>) };
}

/** Evita que `new Headers()` quebre com valores estranhos vindos do firmware. */
function safeContentTypeHeader(raw: http.IncomingHttpHeaders['content-type']): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || typeof s !== 'string') return 'application/octet-stream';
  const cleaned = s.replace(/[^\t\x20-\x7E]/g, '').trim();
  return cleaned || 'application/octet-stream';
}

/**
 * GET/POST ao relógio. Parser HTTP permissivo + TLS inseguro quando configurado.
 */
export async function deviceFetch(
  device: RepDevice,
  pathnameWithQuery: string,
  init?: RequestInit
): Promise<Response> {
  const origin = buildDeviceOrigin(device);
  const path = pathnameWithQuery.startsWith('/') ? pathnameWithQuery : `/${pathnameWithQuery}`;
  const fullUrl = `${origin}${path}`;
  const insecure = shouldUseInsecureTls(device);
  const u = new URL(fullUrl);
  const isHttps = u.protocol === 'https:';
  const method = (init?.method || 'GET').toUpperCase();
  const headers = outgoingHeaders(init?.headers);
  const rawBody = init?.body;
  let payload: Buffer | null = null;
  if (rawBody != null && method !== 'GET' && method !== 'HEAD') {
    if (typeof rawBody === 'string') {
      payload = Buffer.from(rawBody, 'utf8');
    } else if (rawBody instanceof Uint8Array) {
      payload = Buffer.from(rawBody);
    } else {
      return Promise.reject(new Error('deviceFetch: corpo da requisição não suportado'));
    }
    const h = headers as Record<string, string | string[] | undefined>;
    if (!h['Content-Type'] && !h['content-type']) {
      h['Content-Type'] = 'application/json';
    }
    h['Content-Length'] = String(payload.length);
  }

  const port =
    u.port ||
    (isHttps ? '443' : '80');

  const rawTimeout = (process.env.REP_DEVICE_FETCH_TIMEOUT_MS ?? '90000').trim();
  const timeoutMs = Math.min(600_000, Math.max(3_000, parseInt(rawTimeout, 10) || 90_000));

  return new Promise((resolve, reject) => {
    let settled = false;
    let reqRef: http.ClientRequest | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      fn();
    };

    const opts: http.RequestOptions & { insecureHTTPParser?: boolean } = {
      hostname: u.hostname,
      port,
      path: u.pathname + u.search,
      method,
      headers,
      insecureHTTPParser: true,
    };

    if (isHttps) {
      (opts as https.RequestOptions).rejectUnauthorized = !insecure;
    }

    const lib = isHttps ? https : http;
    const req = lib.request(opts, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      incoming.on('end', () => {
        const buf = Buffer.concat(chunks);
        const status = incoming.statusCode ?? 0;
        const statusText = incoming.statusMessage || '';
        const h = new Headers();
        h.set('content-type', safeContentTypeHeader(incoming.headers['content-type']));
        settle(() => {
          resolve(new Response(buf, { status, statusText, headers: h }));
        });
      });
      incoming.on('error', (err) => settle(() => reject(err)));
    });

    reqRef = req;

    timeoutId = setTimeout(() => {
      reqRef?.destroy();
      settle(() =>
        reject(
          new Error(
            `Tempo esgotado (${timeoutMs}ms) ao contatar o relógio ${u.hostname}:${port}. Confira IP, porta, HTTP/HTTPS e firewall.`
          )
        )
      );
    }, timeoutMs);

    req.on('error', (err) => settle(() => reject(err)));

    if (init?.signal) {
      if (init.signal.aborted) {
        req.destroy();
        settle(() => reject(new DOMException('The operation was aborted', 'AbortError')));
        return;
      }
      const onAbort = () => {
        req.destroy();
        settle(() => reject(new DOMException('The operation was aborted', 'AbortError')));
      };
      init.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
