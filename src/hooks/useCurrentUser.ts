/**
 * @deprecated Prefer `useAuth()` — mantido para compatibilidade com imports existentes.
 */
import type { User } from '../../types';
import { useAuth } from './useAuth';

export type { User };

export function useCurrentUser() {
  const { user, loading, refresh } = useAuth();
  return { user, loading, refresh };
}

export { readCachedSessionUser as readCachedUser } from '../contexts/AuthSessionProvider';

export default useCurrentUser;
