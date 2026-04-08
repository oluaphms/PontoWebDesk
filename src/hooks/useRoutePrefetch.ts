import { useCallback } from 'react';
import { prefetchPortalRoute } from '../routes/routeChunks';

/**
 * Handlers para disparar prefetch do chunk da rota (hover/teclado) antes do clique.
 */
export function useRoutePrefetch(path: string | undefined) {
  const prefetch = useCallback(() => {
    if (path) prefetchPortalRoute(path);
  }, [path]);

  return {
    onMouseEnter: prefetch,
    onFocus: prefetch,
  };
}
