/**
 * Router canônico da API Master — /api/master/*
 *
 * Isolado do operacional (auth empresas, REP, ponto, espelho, banco de horas).
 */
import { Router } from 'express';
import { rateLimit } from '../../../middlewares/rateLimit.js';
import { requireMasterLogin, requireMasterPermission } from '../middlewares/index.js';
import {
  postMasterLogin,
  postMasterLogout,
  postMasterRefresh,
  postMasterForgotPassword,
  postMasterResetPassword,
  getMasterMe,
  getDashboard,
  getSummary,
  getLogs,
  getHealth,
  getTenants,
  getTenant,
  postTenant,
  patchTenant,
  deleteTenant,
  postTenantAction,
  getSubscriptions,
  getHybrid,
  getSystem,
  getAudit,
  getUsers,
  postUser,
  patchUser,
  postUserResetPassword,
} from '../controllers/masterApi.controllers.js';
import { getMasterOpenApiJson, getMasterSwaggerHtml } from '../openapi/master.openapi.js';

/** Compat: ações já usadas pelo shell Master (sem alterar frontend). */
import {
  postMasterLocalLicenseActionController,
} from '../../../controllers/master/licensesController.js';
import {
  postMasterSubscriptionController,
  postMasterSubscriptionActionController,
} from '../../../controllers/master/subscriptionsController.js';
import {
  getMasterChargesController,
  postMasterChargeActionController,
} from '../../../controllers/master/chargesController.js';
import { getMasterFinanceController } from '../../../controllers/master/financeController.js';
import { getMasterAdminController } from '../../../controllers/master/adminController.js';
import {
  getMasterPlansController,
  postMasterPlanController,
  patchMasterPlanController,
  postMasterPlanActionController,
  getCompanyPlanSubscriptionController,
  postAssignCompanyPlanController,
  postChangeCompanyPlanController,
  postCancelCompanyPlanController,
} from '../../../controllers/master/plansController.js';
import {
  getBillingSnapshot,
  postBillingProvider,
  getInvoices,
  postInvoice,
  postInvoiceAction,
  getBillingPayments,
  postBillingPayment,
  postBillingPaymentAction,
  getPixCharges,
  postPixCharge,
  postPixAction,
  getBillingWebhooks,
} from '../controllers/billingEngine.controllers.js';
import {
  getSubscriptionFinance,
  getSubscriptionNotificationPreferences,
  postSubscriptionFinanceEntry,
  patchSubscriptionFinanceEntry,
  patchSubscriptionNotificationPreferences,
  postProcessSubscriptionOverdues,
} from '../controllers/subscriptionFinance.controllers.js';
import {
  getLicensesManager,
  postCompanyLicense,
  patchCompanyLicense,
  postCompanyLicenseRules,
  postCompanyLicenseAction,
  deleteCompanyLicense,
  getCompanyLicenseHistory,
} from '../controllers/licenseManager.controllers.js';
import {
  getDeploymentsExpanded,
  postTenantDeployment,
  patchTenantDeployment,
  postTenantDeploymentAction,
} from '../controllers/deploymentManager.controllers.js';
import {
  getMasterInstallations,
  getMasterReleases,
  getMasterUpdateHistory,
  getMasterUpdateRequests,
  getUpdatesCentral,
  postMasterInstallation,
  postMasterInstallationAgentToken,
  postMasterRelease,
  postMasterReleaseAction,
  postMasterUpdateRequest,
  postMasterUpdateRequestAction,
} from '../controllers/updateControlPlane.controllers.js';
import {
  getCommercialJourney,
  getDeploymentWizard,
  postCommercialJourneyProvision,
  postCommercialJourneyPrepareFirstAccessPassword,
  postCommercialJourneyResendFirstAccess,
  postDeploymentWizardStep,
} from '../controllers/commercialJourney.controllers.js';
import {
  getCommercialAutomation,
  getMasterNotifications,
  postCommercialAutomationConfirmPayment,
  postCommercialAutomationRetry,
  postMasterNotificationRead,
  postMasterNotificationsReadAll,
} from '../controllers/commercialAutomation.controllers.js';
import {
  getCrmDirectory,
  getTenantCrm,
  postTenantCrmAttendance,
  postTenantCrmReminder,
  postTenantCrmReminderStatus,
  putTenantCrmProfile,
} from '../controllers/commercialCrm.controllers.js';
import {
  getOperationalCompaniesDirectory,
  getOperationalCompanyOrphans,
  postInitializeOperationalCommercial,
} from '../controllers/operationalDiscovery.controllers.js';
import { getSecurityCompliance } from '../controllers/securityCompliance.controllers.js';

const router = Router();

const masterAuthRateLimit = rateLimit({
  keyPrefix: 'master:auth',
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  key: (req) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    return String(body.email ?? '');
  },
});

/** Docs — públicas (somente Master OpenAPI). */
router.get('/openapi.json', (_req, res) => {
  res.json(getMasterOpenApiJson());
});
router.get('/docs', (_req, res) => {
  res.type('html').send(getMasterSwaggerHtml());
});

/**
 * Auth Master — público (login/refresh).
 * Logout limpa cookie Master; refresh renova JWT Master.
 * Rate limit alinhado ao auth operacional (anti credential stuffing).
 */
router.post('/auth/login', masterAuthRateLimit, postMasterLogin);
router.post('/auth/refresh', masterAuthRateLimit, postMasterRefresh);
router.post('/auth/logout', postMasterLogout);
router.post('/auth/forgot-password', masterAuthRateLimit, postMasterForgotPassword);
router.post('/auth/reset-password', masterAuthRateLimit, postMasterResetPassword);

router.use(requireMasterLogin());

router.get('/auth/me', getMasterMe);
router.get('/security/compliance', requireMasterPermission('system:read'), getSecurityCompliance);

router.get('/dashboard', requireMasterPermission('dashboard:read'), getDashboard);
router.get('/summary', requireMasterPermission('dashboard:read'), getSummary);
router.get('/logs', requireMasterPermission('audit:read'), getLogs);
router.get('/health', requireMasterPermission('system:read'), getHealth);
router.get('/tenants', requireMasterPermission('tenants:read'), getTenants);
router.post('/tenants', requireMasterPermission('tenants:write'), postTenant);
router.get(
  '/operational-companies',
  requireMasterPermission('tenants:read'),
  getOperationalCompaniesDirectory,
);
router.get(
  '/operational-companies/orphans',
  requireMasterPermission('tenants:read'),
  getOperationalCompanyOrphans,
);
router.post(
  '/operational-companies/:companyId/initialize-commercial',
  requireMasterPermission('tenants:write'),
  postInitializeOperationalCommercial,
);
router.get('/crm/directory', requireMasterPermission('tenants:read'), getCrmDirectory);
router.get('/tenants/:id', requireMasterPermission('tenants:read'), getTenant);
router.get(
  '/tenants/:id/journey',
  requireMasterPermission('tenants:read'),
  getCommercialJourney,
);
router.get(
  '/tenants/:id/wizard',
  requireMasterPermission('tenants:read'),
  getDeploymentWizard,
);
router.post(
  '/tenants/:id/journey/provision',
  requireMasterPermission('tenants:write'),
  postCommercialJourneyProvision,
);
router.post(
  '/tenants/:id/journey/first-access/resend',
  requireMasterPermission('tenants:write'),
  postCommercialJourneyResendFirstAccess,
);
router.post(
  '/tenants/:id/journey/first-access/password',
  requireMasterPermission('tenants:write'),
  postCommercialJourneyPrepareFirstAccessPassword,
);
router.post(
  '/tenants/:id/wizard/steps/:step',
  requireMasterPermission('tenants:write'),
  postDeploymentWizardStep,
);
router.get(
  '/tenants/:id/automation',
  requireMasterPermission('tenants:read'),
  getCommercialAutomation,
);
router.post(
  '/tenants/:id/automation/confirm-payment',
  requireMasterPermission('tenants:write'),
  postCommercialAutomationConfirmPayment,
);
router.post(
  '/tenants/:id/automation/retry',
  requireMasterPermission('tenants:write'),
  postCommercialAutomationRetry,
);
router.get('/notifications', requireMasterPermission('dashboard:read'), getMasterNotifications);
router.post(
  '/notifications/read-all',
  requireMasterPermission('dashboard:read'),
  postMasterNotificationsReadAll,
);
router.post(
  '/notifications/:id/read',
  requireMasterPermission('dashboard:read'),
  postMasterNotificationRead,
);
router.get('/tenants/:id/crm', requireMasterPermission('tenants:read'), getTenantCrm);
router.put(
  '/tenants/:id/crm/profile',
  requireMasterPermission('tenants:write'),
  putTenantCrmProfile,
);
router.post(
  '/tenants/:id/crm/attendances',
  requireMasterPermission('tenants:write'),
  postTenantCrmAttendance,
);
router.post(
  '/tenants/:id/crm/reminders',
  requireMasterPermission('tenants:write'),
  postTenantCrmReminder,
);
router.post(
  '/tenants/:id/crm/reminders/:reminderId/:status',
  requireMasterPermission('tenants:write'),
  postTenantCrmReminderStatus,
);
router.patch('/tenants/:id', requireMasterPermission('tenants:write'), patchTenant);
router.delete('/tenants/:id', requireMasterPermission('tenants:write'), deleteTenant);
router.post(
  '/tenants/:id/actions/:action',
  requireMasterPermission('tenants:write', 'tenants:block'),
  postTenantAction,
);
router.get(
  '/tenants/:companyId/subscription',
  requireMasterPermission('subscriptions:read'),
  getCompanyPlanSubscriptionController,
);
router.post(
  '/tenants/:companyId/subscription/assign',
  requireMasterPermission('subscriptions:write'),
  postAssignCompanyPlanController,
);
router.post(
  '/tenants/:companyId/subscription/change',
  requireMasterPermission('subscriptions:write'),
  postChangeCompanyPlanController,
);
router.post(
  '/tenants/:companyId/subscription/cancel',
  requireMasterPermission('subscriptions:write'),
  postCancelCompanyPlanController,
);
router.get(
  '/tenants/:companyId/subscription/finance',
  requireMasterPermission('payments:read'),
  getSubscriptionFinance,
);
router.get(
  '/tenants/:companyId/subscription/notification-preferences',
  requireMasterPermission('payments:read'),
  getSubscriptionNotificationPreferences,
);
router.patch(
  '/tenants/:companyId/subscription/notification-preferences',
  requireMasterPermission('payments:write'),
  patchSubscriptionNotificationPreferences,
);
router.post(
  '/tenants/:companyId/subscription/finance',
  requireMasterPermission('payments:write'),
  postSubscriptionFinanceEntry,
);
router.patch(
  '/subscription-finance/:id',
  requireMasterPermission('payments:write'),
  patchSubscriptionFinanceEntry,
);
router.post(
  '/subscription-finance/process-overdue',
  requireMasterPermission('payments:write'),
  postProcessSubscriptionOverdues,
);
router.get('/licenses', requireMasterPermission('licenses:read'), getLicensesManager);
router.post('/licenses', requireMasterPermission('licenses:write'), postCompanyLicense);
router.post(
  '/licenses/local/:machineId/actions/:action',
  requireMasterPermission('licenses:write'),
  postMasterLocalLicenseActionController,
);
router.get(
  '/licenses/:id/history',
  requireMasterPermission('licenses:read'),
  getCompanyLicenseHistory,
);
router.patch('/licenses/:id', requireMasterPermission('licenses:write'), patchCompanyLicense);
router.delete('/licenses/:id', requireMasterPermission('licenses:write'), deleteCompanyLicense);
router.post(
  '/licenses/:id/rules',
  requireMasterPermission('licenses:write'),
  postCompanyLicenseRules,
);
router.post(
  '/licenses/:id/actions/:action',
  requireMasterPermission('licenses:write'),
  postCompanyLicenseAction,
);
router.get('/subscriptions', requireMasterPermission('subscriptions:read'), getSubscriptions);
router.post('/subscriptions', requireMasterPermission('subscriptions:write'), postMasterSubscriptionController);
router.post(
  '/subscriptions/:id/actions/:action',
  requireMasterPermission('subscriptions:write'),
  postMasterSubscriptionActionController,
);

/** Billing Engine desacoplado — invoices / payments / pix (InMemory). */
router.get('/billing', requireMasterPermission('payments:read'), getBillingSnapshot);
router.post('/billing/provider', requireMasterPermission('payments:write'), postBillingProvider);
router.get('/billing/webhooks', requireMasterPermission('payments:read'), getBillingWebhooks);

router.get('/invoices', requireMasterPermission('payments:read'), getInvoices);
router.post('/invoices', requireMasterPermission('payments:write'), postInvoice);
router.post(
  '/invoices/:id/actions/:action',
  requireMasterPermission('payments:write'),
  postInvoiceAction,
);

router.get('/payments', requireMasterPermission('payments:read'), getBillingPayments);
router.post('/payments', requireMasterPermission('payments:write'), postBillingPayment);
router.post(
  '/payments/:id/actions/:action',
  requireMasterPermission('payments:write'),
  postBillingPaymentAction,
);

router.get('/pix', requireMasterPermission('payments:read'), getPixCharges);
router.post('/pix', requireMasterPermission('payments:write'), postPixCharge);
router.post(
  '/pix/:id/actions/:action',
  requireMasterPermission('payments:write'),
  postPixAction,
);

router.get('/deployments', requireMasterPermission('deployments:read'), getDeploymentsExpanded);
router.post('/deployments', requireMasterPermission('deployments:write'), postTenantDeployment);
router.patch(
  '/deployments/:id',
  requireMasterPermission('deployments:write'),
  patchTenantDeployment,
);
router.post(
  '/deployments/:id/actions/:action',
  requireMasterPermission('deployments:write'),
  postTenantDeploymentAction,
);
router.get('/updates/releases', requireMasterPermission('deployments:read'), getMasterReleases);
router.post('/updates/releases', requireMasterPermission('deployments:write'), postMasterRelease);
router.post(
  '/updates/releases/:id/actions/:action',
  requireMasterPermission('deployments:write'),
  postMasterReleaseAction,
);
router.get(
  '/updates/installations',
  requireMasterPermission('deployments:read'),
  getMasterInstallations,
);
router.post(
  '/updates/installations',
  requireMasterPermission('deployments:write'),
  postMasterInstallation,
);
router.post(
  '/updates/installations/:id/agent-token',
  requireMasterPermission('deployments:write'),
  postMasterInstallationAgentToken,
);
router.get(
  '/updates/requests',
  requireMasterPermission('deployments:read'),
  getMasterUpdateRequests,
);
router.post(
  '/updates/requests',
  requireMasterPermission('deployments:write'),
  postMasterUpdateRequest,
);
router.post(
  '/updates/requests/:id/actions/:action',
  requireMasterPermission('deployments:write'),
  postMasterUpdateRequestAction,
);
router.get(
  '/updates/central',
  requireMasterPermission('deployments:read'),
  getUpdatesCentral,
);
router.get(
  '/updates/history',
  requireMasterPermission('deployments:read'),
  getMasterUpdateHistory,
);
router.get('/hybrid', requireMasterPermission('hybrid:read'), getHybrid);
router.get('/system', requireMasterPermission('system:read'), getSystem);
router.get('/audit', requireMasterPermission('audit:read'), getAudit);
router.get('/users', requireMasterPermission('users:read'), getUsers);
router.post('/users', requireMasterPermission('users:write'), postUser);
router.patch('/users/:id', requireMasterPermission('users:write'), patchUser);
router.post(
  '/users/:id/reset-password',
  requireMasterPermission('users:write'),
  postUserResetPassword,
);

/** Rotas extras já consumidas pelo shell (compat). */
router.get('/charges', requireMasterPermission('payments:read'), getMasterChargesController);
router.post(
  '/charges/:id/actions/:action',
  requireMasterPermission('payments:write'),
  postMasterChargeActionController,
);
router.get('/finance', requireMasterPermission('payments:read'), getMasterFinanceController);
router.get('/admin', requireMasterPermission('admin:read'), getMasterAdminController);
router.get('/plans', requireMasterPermission('subscriptions:read'), getMasterPlansController);
router.post('/plans', requireMasterPermission('subscriptions:write'), postMasterPlanController);
router.patch('/plans/:id', requireMasterPermission('subscriptions:write'), patchMasterPlanController);
router.post(
  '/plans/:id/actions/:action',
  requireMasterPermission('subscriptions:write'),
  postMasterPlanActionController,
);

export default router;
