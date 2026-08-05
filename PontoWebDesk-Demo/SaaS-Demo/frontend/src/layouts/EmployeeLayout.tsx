import React from 'react';
import Layout from '../../components/Layout';

export interface EmployeeLayoutProps {
  children: React.ReactNode;
  onLogout: () => void | Promise<void>;
  operationalChromeReady?: boolean;
}

const EmployeeLayout: React.FC<EmployeeLayoutProps> = (props) => (
  <Layout onLogout={props.onLogout} layoutVariant="employee" operationalChromeReady={props.operationalChromeReady}>
    {props.children}
  </Layout>
);

export default EmployeeLayout;
