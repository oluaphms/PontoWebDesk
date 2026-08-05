import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackBehaviorRoute } from '../../help/helpBehaviorTracker';

/** Registra visitas a rotas admin para sugestões de comportamento. */
export const HelpBehaviorTracker: React.FC = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pathname.startsWith('/admin')) return;
    trackBehaviorRoute(pathname);
  }, [pathname]);

  return null;
};

export default HelpBehaviorTracker;
