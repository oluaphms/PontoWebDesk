import type { Request, Response } from 'express';
import { MasterError } from '../../master/errors.js';
import { MasterPlatformService } from '../../services/master/masterPlatformService.js';
import type { SubscriptionEntity } from '../../master/subscriptions/subscription.entity.js';
import {
  MasterSubscriptionsService,
  type MasterSubscriptionView,
} from '../../master/subscriptions/MasterSubscriptionsService.js';
import type { CreateSubscriptionInput } from '../../master/subscriptions/subscription.types.js';

const viewHelper = new MasterSubscriptionsService();

async function resolveEmpresa(tenantId: string): Promise<string> {
  try {
    const managed = await MasterPlatformService.getTenants().get(tenantId);
    return managed.company.name;
  } catch {
    return tenantId;
  }
}

async function toView(entity: SubscriptionEntity): Promise<MasterSubscriptionView> {
  const empresa = await resolveEmpresa(entity.tenantId);
  return viewHelper.toCommercialView(entity, empresa);
}

function sendMasterError(res: Response, error: unknown): void {
  if (error instanceof MasterError) {
    const status =
      error.code === 'MASTER_NOT_FOUND'
        ? 404
        : error.code === 'MASTER_CONFLICT'
          ? 409
          : error.code === 'MASTER_INVALID'
            ? 400
            : 500;
    res.status(status).json({
      ok: false,
      error: error.code,
      message: error.message,
    });
    return;
  }
  res.status(500).json({
    ok: false,
    error: 'master_subscriptions_failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

/** GET /api/master/subscriptions */
export async function getMasterSubscriptionsController(_req: Request, res: Response): Promise<void> {
  try {
    const rows = await MasterPlatformService.getDashboard().subscriptions.list();
    const subscriptions = await Promise.all(rows.map((s) => toView(s)));
    res.json({
      ok: true,
      subscriptions,
      count: subscriptions.length,
      gatewayIntegrated: false,
      paymentIntegrated: false,
      note: 'Arquitetura Master — 1 assinatura/empresa; sem gateway de pagamento',
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}

/** POST /api/master/subscriptions — criar (arquitetura; sem pagamento). */
export async function postMasterSubscriptionController(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as CreateSubscriptionInput;
    const entity = await MasterPlatformService.getDashboard().subscriptions.create(body);
    res.status(201).json({
      ok: true,
      subscription: await toView(entity),
      paymentIntegrated: false,
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}

type SubscriptionAction =
  | 'pause'
  | 'cancel'
  | 'reactivate'
  | 'enter_grace'
  | 'block'
  | 'unblock'
  | 'renew'
  | 'expire'
  | 'suspend';

/** POST /api/master/subscriptions/:id/actions/:action */
export async function postMasterSubscriptionActionController(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const id = String(req.params.id || '').trim();
    const action = String(req.params.action || '').trim() as SubscriptionAction;
    if (!id) {
      res.status(400).json({ ok: false, error: 'invalid_id', message: 'id is required' });
      return;
    }

    const mod = MasterPlatformService.getDashboard().subscriptions;
    let entity: SubscriptionEntity;

    switch (action) {
      case 'pause':
      case 'suspend':
        entity = await mod.pause(id);
        break;
      case 'cancel':
        entity = await mod.cancel(id);
        break;
      case 'reactivate':
        entity = await mod.reactivate(id);
        break;
      case 'enter_grace': {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          graceDays?: number;
        };
        entity = await mod.enterGrace(id, body.graceDays);
        break;
      }
      case 'block':
        entity = await mod.block(id);
        break;
      case 'unblock':
        entity = await mod.unblock(id);
        break;
      case 'renew': {
        const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
          durationDays?: number;
        };
        entity = await mod.renew(id, body.durationDays);
        break;
      }
      case 'expire':
        entity = await mod.expire(id);
        break;
      default:
        res.status(400).json({
          ok: false,
          error: 'invalid_action',
          message: `Ação inválida: ${action}`,
          allowed: [
            'pause',
            'suspend',
            'cancel',
            'reactivate',
            'enter_grace',
            'block',
            'unblock',
            'renew',
            'expire',
          ],
        });
        return;
    }

    res.json({
      ok: true,
      action,
      subscription: await toView(entity),
      paymentIntegrated: false,
    });
  } catch (error) {
    sendMasterError(res, error);
  }
}
