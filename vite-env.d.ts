/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** LOCAL_API (padrão) | SUPABASE (futuro) */
  readonly VITE_DATA_PROVIDER?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_LOCAL_API_BASE_URL?: string;
  readonly VITE_APP_URL?: string;
  /** Versão da plataforma exibida em diagnósticos e no Painel Master. */
  readonly VITE_APP_VERSION?: string;
  readonly VITE_SUPABASE_REDIRECT?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  /** Opcional: ex. gemini-2.0-flash — padrão no app gemini-1.5-flash */
  readonly VITE_GEMINI_MODEL?: string;
  /** `true` para gerar insight de IA no dashboard automaticamente (padrão: desligado) */
  readonly VITE_ENABLE_AI_INSIGHTS?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  /** Feature flags operacionais — `false` desliga o módulo (prefixo VITE_OP_). */
  readonly VITE_OP_REPLAY_OFFLINE?: string;
  readonly VITE_OP_AUTO_RECOVERY?: string;
  readonly VITE_OP_STREAM_COORDINATOR?: string;
  readonly VITE_OP_CIRCUIT_BREAKER?: string;
  readonly VITE_OP_GEO_FORENSICS?: string;
  readonly VITE_OP_PROFILER?: string;
  readonly VITE_OP_AGGRESSIVE_TELEMETRY?: string;
  readonly VITE_OP_REALTIME_BUFFERING?: string;
  readonly VITE_OP_GEO_CONSENSUS_ENABLED?: string;
  readonly VITE_OP_NATIVE_GPS_ENABLED?: string;
  readonly VITE_OP_REALTIME_COORDINATOR_ENABLED?: string;
  readonly VITE_OP_GEO_FORENSICS_ENABLED?: string;
  readonly VITE_OP_OPERATIONAL_INCIDENTS_ENABLED?: string;
  readonly VITE_OP_SCALE_MODE_ENABLED?: string;
  readonly VITE_OP_COS_STRICT_MODE?: string;
  readonly VITE_OP_MAP_STALE_BLOCK_ENABLED?: string;
  readonly VITE_OP_GEO_HEALTH_GUARD_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injetado em alguns ambientes (ex.: preview com index.html custom). */
interface WindowSupabaseEnvEntry {
  url?: string;
  key?: string;
}

interface Window {
  ENV?: {
    ENVIRONMENT?: string;
    SUPABASES?: Record<string, WindowSupabaseEnvEntry>;
  };
  __VITE_SUPABASE_URL?: string;
  __VITE_SUPABASE_ANON_KEY?: string;
  __SUPABASE_OFFLINE_DEV?: boolean;
}
