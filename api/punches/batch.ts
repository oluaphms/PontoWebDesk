import { handleRepPunchesBatch } from '../_shared/repPunchesBatchHttp.js';

async function handler(request: Request): Promise<Response> {
  return handleRepPunchesBatch(request);
}

export default { fetch: handler };
