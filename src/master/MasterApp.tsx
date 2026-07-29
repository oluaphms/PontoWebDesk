import React from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { getMasterToken, hasMasterPermission } from './api/masterApi';
import { MasterLayout } from './layouts/MasterLayout';
import { MasterLoginPage } from './pages/MasterLoginPage';
import { MasterHubPage } from './pages/MasterHubPage';
import { MasterDashboardPage } from './pages/MasterDashboardPage';
import { MasterCompaniesPage } from './pages/MasterCompaniesPage';
import { MasterCompanyDetailPage } from './pages/MasterCompanyDetailPage';
import { MasterCompanyFormPage } from './pages/MasterCompanyFormPage';
import { MasterSubscriptionsPage } from './pages/MasterSubscriptionsPage';
import { MasterLicensesPage } from './pages/MasterLicensesPage';
import { MasterChargesPage } from './pages/MasterChargesPage';
import { MasterFinancePage } from './pages/MasterFinancePage';
import { MasterAdminPage } from './pages/MasterAdminPage';
import { MasterPaymentsPage } from './pages/MasterPaymentsPage';
import { MasterInvoicesPage } from './pages/MasterInvoicesPage';
import { MasterPixPage } from './pages/MasterPixPage';
import { MasterDeploymentsPage } from './pages/MasterDeploymentsPage';
import { MasterUpdatesPage } from './pages/MasterUpdatesPage';
import { MasterSecurityPage } from './pages/MasterSecurityPage';
import { MasterImplantationWizardPage } from './pages/MasterImplantationWizardPage';
import { MasterSettingsPage } from './pages/MasterSettingsPage';
import { MasterUsersPage } from './pages/MasterUsersPage';
import { MasterPlansPage } from './pages/MasterPlansPage';

function RequireMasterSession() {
  if (!getMasterToken()) {
    return <Navigate to="/master/login" replace />;
  }
  return <Outlet />;
}

function RequireMasterPermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactElement;
}) {
  if (!hasMasterPermission(permission)) {
    return <Navigate to="/master" replace />;
  }
  return children;
}

/**
 * Shell React do Painel Master — isolado do PontoWebDesk operacional.
 *
 * /master → Dashboard Comercial (layout + sidebar exclusivos)
 */
export function MasterApp() {
  return (
    <Routes>
      <Route path="/master/login" element={<MasterLoginPage />} />
      <Route element={<RequireMasterSession />}>
        <Route path="/master" element={<MasterLayout />}>
          <Route index element={<RequireMasterPermission permission="dashboard:read"><MasterDashboardPage /></RequireMasterPermission>} />
          <Route path="hub" element={<RequireMasterPermission permission="dashboard:read"><MasterHubPage /></RequireMasterPermission>} />
          <Route path="tenants" element={<RequireMasterPermission permission="tenants:read"><MasterCompaniesPage /></RequireMasterPermission>} />
          <Route path="tenants/new" element={<RequireMasterPermission permission="tenants:write"><MasterCompanyFormPage /></RequireMasterPermission>} />
          <Route path="tenants/:companyId/edit" element={<RequireMasterPermission permission="tenants:write"><MasterCompanyFormPage /></RequireMasterPermission>} />
          <Route path="tenants/:companyId/implantacao" element={<RequireMasterPermission permission="tenants:write"><MasterImplantationWizardPage /></RequireMasterPermission>} />
          <Route path="tenants/:companyId" element={<RequireMasterPermission permission="tenants:read"><MasterCompanyDetailPage /></RequireMasterPermission>} />
          <Route path="clientes" element={<Navigate to="/master/tenants" replace />} />
          <Route path="subscriptions" element={<RequireMasterPermission permission="subscriptions:read"><MasterSubscriptionsPage /></RequireMasterPermission>} />
          <Route path="licenses" element={<RequireMasterPermission permission="licenses:read"><MasterLicensesPage /></RequireMasterPermission>} />
          <Route path="charges" element={<RequireMasterPermission permission="payments:read"><MasterChargesPage /></RequireMasterPermission>} />
          <Route path="payments" element={<RequireMasterPermission permission="payments:read"><MasterPaymentsPage /></RequireMasterPermission>} />
          <Route path="invoices" element={<RequireMasterPermission permission="payments:read"><MasterInvoicesPage /></RequireMasterPermission>} />
          <Route path="pix" element={<RequireMasterPermission permission="payments:read"><MasterPixPage /></RequireMasterPermission>} />
          <Route path="deployments" element={<RequireMasterPermission permission="deployments:read"><MasterDeploymentsPage /></RequireMasterPermission>} />
          <Route path="updates" element={<RequireMasterPermission permission="deployments:read"><MasterUpdatesPage /></RequireMasterPermission>} />
          <Route path="security" element={<RequireMasterPermission permission="system:read"><MasterSecurityPage /></RequireMasterPermission>} />
          <Route path="finance" element={<RequireMasterPermission permission="payments:read"><MasterFinancePage /></RequireMasterPermission>} />
          <Route path="settings" element={<RequireMasterPermission permission="admin:write"><MasterSettingsPage /></RequireMasterPermission>} />
          <Route path="users" element={<RequireMasterPermission permission="users:read"><MasterUsersPage /></RequireMasterPermission>} />
          <Route path="admin" element={<RequireMasterPermission permission="admin:read"><MasterAdminPage /></RequireMasterPermission>} />
          <Route path="system" element={<RequireMasterPermission permission="admin:read"><MasterAdminPage /></RequireMasterPermission>} />
          <Route path="gateway" element={<Navigate to="/master/admin" replace />} />
          <Route path="logs" element={<Navigate to="/master/admin?section=logs" replace />} />
          <Route path="plans" element={<RequireMasterPermission permission="subscriptions:read"><MasterPlansPage /></RequireMasterPermission>} />
        </Route>
      </Route>
      <Route path="/master/*" element={<Navigate to="/master" replace />} />
    </Routes>
  );
}

export default MasterApp;
