export type FieldValidationResult = 'PASS' | 'WARNING' | 'FAIL';

export type FieldValidationInput = {
  foregroundBackgroundOk: boolean;
  lockscreenOk: boolean;
  androidLowEndOk: boolean;
  webviewFreezeOk: boolean;
  offlineOnlineOk: boolean;
  network3gOk: boolean;
  reconnectOk: boolean;
  staleLiveOk: boolean;
  ghostMarkerOk: boolean;
  temporalDriftOk: boolean;
  clockTamperOk: boolean;
  gpsMockOk: boolean;
  multiUserOk: boolean;
  realtimeStormOk: boolean;
};

export function runOperationalFieldValidationChecklist(input: FieldValidationInput): FieldValidationResult {
  console.info('[FIELD VALIDATION START]');
  const values = Object.values(input);
  const failed = values.filter((v) => !v).length;
  const warn = failed > 0 && failed <= 2;
  const result: FieldValidationResult = failed === 0 ? 'PASS' : warn ? 'WARNING' : 'FAIL';
  if (result === 'FAIL') {
    console.error('[FIELD VALIDATION FAILURE]', { failed_checks: failed });
  }
  console.info('[FIELD VALIDATION COMPLETE]', { result, failed_checks: failed });
  return result;
}

