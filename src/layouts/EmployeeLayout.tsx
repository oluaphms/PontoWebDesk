import React from 'react';
import Layout from '../../components/Layout';
import type { User } from '../../types';

export interface EmployeeLayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

const EmployeeLayout: React.FC<EmployeeLayoutProps> = (props) => (
  <Layout {...props} layoutVariant="employee" />
);

export default EmployeeLayout;
