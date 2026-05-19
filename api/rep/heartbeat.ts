/**
 * POST /api/rep/heartbeat — rota dedicada (Vercel não usa [slug] de um segmento só).
 */
import { handleRepHeartbeat } from '../_shared/repHeartbeatHttp.js';

export default { fetch: handleRepHeartbeat };
