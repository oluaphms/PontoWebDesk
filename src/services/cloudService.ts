import { SYSTEM_CONFIG } from '../config/system';
import { isDegradedMode } from './systemMode';

export function isCloudEnabled(): boolean {
  return SYSTEM_CONFIG.CLOUD_ENABLED === true && !isDegradedMode();
}

