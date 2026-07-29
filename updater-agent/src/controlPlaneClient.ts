import type { UpdaterConfig } from './config.js';
import { hostIdentity } from './fingerprint.js';
import type {
  AvailableRequest,
  ClaimedExecution,
  ControlPlaneClient,
  ReportPayload,
} from './types.js';

type Json = Record<string, unknown>;

async function requestJson(
  baseUrl: string,
  token: string,
  path: string,
  body: Json,
): Promise<Json> {
  const url = `${baseUrl}/api/update-agent${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Update-Agent-Key': token,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    throw new Error(`Resposta inválida do Control Plane (${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    const message = String(json.message ?? json.error ?? `HTTP ${response.status}`);
    throw new Error(message);
  }
  return json;
}

export function createControlPlaneClient(
  config: UpdaterConfig,
  currentVersionProvider: () => Promise<string | null>,
): ControlPlaneClient {
  const identity = hostIdentity(config.fingerprintComponents);

  return {
    async heartbeat() {
      const currentVersion = (await currentVersionProvider()) ?? config.currentVersion;
      const json = await requestJson(config.controlPlaneUrl, config.agentToken, '/heartbeat', {
        machineId: identity.machineId,
        hardwareHash: identity.hardwareHash,
        hostname: identity.hostname,
        platform: identity.platform,
        arch: identity.arch,
        channel: config.channel,
        currentVersion,
        agentVersion: config.agentVersion,
        health: { status: 'healthy' },
      });
      return {
        availableRequest: (json.availableRequest as AvailableRequest) ?? null,
        serverTime: String(json.serverTime ?? new Date().toISOString()),
      };
    },

    async claim() {
      const json = await requestJson(config.controlPlaneUrl, config.agentToken, '/claim', {});
      const execution = json.execution;
      if (!execution || typeof execution !== 'object') return null;
      return execution as ClaimedExecution;
    },

    async report(payload: ReportPayload) {
      const json = await requestJson(config.controlPlaneUrl, config.agentToken, '/report', {
        ...payload,
      });
      return {
        ok: json.ok !== false,
        finished: Boolean(json.finished),
      };
    },
  };
}
