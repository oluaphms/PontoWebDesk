import { Router } from 'express';
import { requireUpdateAgentAuth } from '../middlewares/updateAgentAuth.js';
import {
  postAgentClaim,
  postAgentHeartbeat,
  postAgentReport,
} from '../controllers/updateAgentController.js';

/**
 * Namespace isolado do Updater (Fase 23). Fora do navegador.
 * Autenticação própria por instalação — não usa Master nem auth operacional.
 * Montado em `/api/update-agent`.
 */
const updateAgentRoutes = Router();

updateAgentRoutes.use(requireUpdateAgentAuth());

updateAgentRoutes.post('/heartbeat', postAgentHeartbeat);
updateAgentRoutes.post('/claim', postAgentClaim);
updateAgentRoutes.post('/report', postAgentReport);

export default updateAgentRoutes;
