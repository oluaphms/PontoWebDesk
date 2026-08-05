/**
 * Origem da marcação (híbrido local + nuvem).
 * - `clock`: agente local / relógio físico → `clock_event_logs` + espelho em `time_records`.
 * - `web`: aplicativo (browser/mobile) → RPC `rep_register_punch` / tabela `punches` quando aplicável.
 */
export const PUNCH_SOURCE_CLOCK = 'clock' as const;
export const PUNCH_SOURCE_WEB = 'web' as const;

export type PunchSource = typeof PUNCH_SOURCE_CLOCK | typeof PUNCH_SOURCE_WEB;
