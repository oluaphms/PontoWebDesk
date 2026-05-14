/**
 * POST /api/rep/punch — função serverless dedicada (bundle mínimo vs. rep-bridge).
 * O rewrite em vercel.json encaminha `/api/rep/punch` para este ficheiro.
 */

import { handleRepPunchHttp } from '../modules/rep-integration/repPunchHttp';

export default async function handler(request: Request): Promise<Response> {
  return handleRepPunchHttp(request);
}
