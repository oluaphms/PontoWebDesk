import React, { useEffect } from 'react';
import Layout from '../../components/Layout';
import { AdminAutoHelpChrome } from '../components/help/AdminAutoHelpChrome';
import { HelpBehaviorTracker } from '../components/help/HelpBehaviorTracker';
import { preloadCriticalHelpDocs } from '../help/helpDocLoader';

export interface AdminLayoutProps {
  children: React.ReactNode;
  onLogout: () => void | Promise<void>;
  operationalChromeReady?: boolean;
}

const AdminLayout: React.FC<AdminLayoutProps> = ({ children, operationalChromeReady, onLogout }) => {
  useEffect(() => {
    void preloadCriticalHelpDocs();
  }, []);

  return (
    <>
      <Layout onLogout={onLogout} layoutVariant="admin" operationalChromeReady={operationalChromeReady}>
        <HelpBehaviorTracker />
        {children}
      </Layout>
      <AdminAutoHelpChrome enabled={operationalChromeReady !== false} />
    </>
  );
};

export default AdminLayout;
