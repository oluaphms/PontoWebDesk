import React from 'react';
import Layout from '../../components/Layout';
import type { User } from '../../types';

export interface AdminLayoutProps {
  user: User;
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

const AdminLayout: React.FC<AdminLayoutProps> = (props) => (
  <Layout {...props} layoutVariant="admin" />
);

export default AdminLayout;
