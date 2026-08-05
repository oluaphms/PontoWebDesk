import { handlePhotoUpload } from '../_shared/upload/photoUploadHttp.js';
import { handleServeUploadFile } from '../_shared/upload/servePhotoHttp.js';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '');

    const filesMatch = pathname.match(/^\/api\/uploads\/files\/([^/]+)\/([^/]+)$/);
    if (filesMatch) {
      const userId = decodeURIComponent(filesMatch[1]);
      const fileName = decodeURIComponent(filesMatch[2]);
      return handleServeUploadFile(request, userId, fileName);
    }

    const tail = pathname.replace(/^\/api\/uploads\/?/, '');
    if (tail === 'photo' || tail === '') {
      return handlePhotoUpload(request);
    }

    return new Response(JSON.stringify({ error: 'route_not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
