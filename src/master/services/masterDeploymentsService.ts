import * as api from '../api/deploymentsApi';

export const MasterDeploymentsService = {
  list: api.fetchTenantDeployments,
  create: api.createTenantDeployment,
  action: api.runDeploymentAction,
  formatDate: api.formatDeployDate,
};

export type {
  TenantDeployment,
  TenantDeploymentMode,
  TenantDeploymentStatus,
  TenantDeploymentAction,
  PlatformDeploymentIdentity,
} from '../api/deploymentsApi';

export default MasterDeploymentsService;
