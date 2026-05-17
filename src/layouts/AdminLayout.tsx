import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../../components/Layout';
import { AdminAutoHelpChrome } from '../components/help/AdminAutoHelpChrome';
import { HelpActionHintBanner } from '../components/help/HelpActionHintBanner';
import { BehaviorSuggestionBanner } from '../components/help/BehaviorSuggestionBanner';
import { HelpBehaviorTracker } from '../components/help/HelpBehaviorTracker';
import { preloadCriticalHelpDocs } from '../help/helpDocLoader';

export interface AdminLayoutProps {
  children: React.ReactNode;
  onLogout: () => void | Promise<void>;
  operationalChromeReady?: boolean;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children, operationalChromeReady, onLogout }) => {
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const showBehaviorSuggestionBanner = path !== '/admin/dashboard';

  useEffect(() => {
    void preloadCriticalHelpDocs();
  }, []);

  return (
    <>
      <Layout onLogout={onLogout} layoutVariant="admin" operationalChromeReady={operationalChromeReady}>
        <HelpBehaviorTracker />
        {showBehaviorSuggestionBanner && <BehaviorSuggestionBanner />}
        <HelpActionHintBanner />
        {children}
      </Layout>
      <AdminAutoHelpChrome enabled={operationalChromeReady !== false} />
    </>
  );
};

export default AdminLayout;
