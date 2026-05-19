/**
 * POST /api/rep/collect — coleta manual por intervalo.
 */
import { handleRepCollect } from '../_shared/repCollectHttp.js';

export default { fetch: handleRepCollect };
