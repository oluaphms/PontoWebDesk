/**
 * ⚠️ AUTH RULE — hook oficial de sessão (P0).
 *
 * NUNCA:
 * - `localStorage.getItem('current_user')` ou `JSON.parse` do perfil
 * - `useState<User | null>` para sessão fora de AuthSessionProvider
 *
 * SEMPRE: `const { user, companyId, role, loading } = useAuth()`
 *
 * Serviços sem React: `src/auth/sessionAccess.ts`
 */
import { useAuthSessionContext } from '../contexts/AuthSessionProvider';

export function useAuth() {
  return useAuthSessionContext();
}

export default useAuth;
