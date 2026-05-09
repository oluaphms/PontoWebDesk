import React from 'react';
import Layout from '../../components/Layout';
import type { User } from '../../types';

export interface AdminLayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void | Promise<void>;
  operationalChromeReady?: boolean;
}

const AdminLayout: React.FC<AdminLayoutProps> = (props) => (
  <Layout {...props} layoutVariant="admin" />
);

export default React.memo(AdminLayout, (a, b) => {
  return (
    a.user.id === b.user.id &&
    a.user.role === b.user.role &&
    a.user.companyId === b.user.companyId &&
    a.activeTab === b.activeTab &&
    a.operationalChromeReady === b.operationalChromeReady &&
    a.children === b.children
  );
});
