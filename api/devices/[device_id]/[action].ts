import devicesHandler from '../[slug].js';

export default {
  fetch(request: Request): Promise<Response> {
    return devicesHandler.fetch(request);
  },
};
