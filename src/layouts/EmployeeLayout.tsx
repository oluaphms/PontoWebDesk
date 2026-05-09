import React from 'react';
import Layout from '../../components/Layout';
import type { User } from '../../types';

export interface EmployeeLayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void | Promise<void>;
  operationalChromeReady?: boolean;
}

const EmployeeLayout: React.FC<EmployeeLayoutProps> = (props) => (
  <Layout {...props} layoutVariant="employee" />
);

export default React.memo(EmployeeLayout, (a, b) => {
  return (
    a.user.id === b.user.id &&
    a.user.role === b.user.role &&
    a.user.companyId === b.user.companyId &&
    a.activeTab === b.activeTab &&
    a.operationalChromeReady === b.operationalChromeReady &&
    a.children === b.children
  );
});
