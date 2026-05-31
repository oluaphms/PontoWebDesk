import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import { distanceMeters } from './geoDistance.service';

type Candidate = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAtMs: number;
};

type ConfirmationState = {
  pending: Candidate | null;
  confirmations: number;
  accepted: Candidate | null;
};

const byEmployee = new Map<string, ConfirmationState>();

function ensureState(employeeId: string): ConfirmationState {
  let s = byEmployee.get(employeeId);
  if (!s) {
    s = { pending: null, confirmations: 0, accepted: null };
    byEmployee.set(employeeId, s);
  }
  return s;
}

function rollingMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[m - 1]! + arr[m]!) / 2 : arr[m]!;
}

export function confirmGeoCandidate(
  employeeId: string,
  candidate: Candidate,
): { accepted: boolean; reason: string; latitude?: number; longitude?: number } {
  const state = ensureState(employeeId);
  const current = state.accepted;
  if (!current) {
    state.accepted = candidate;
    state.pending = null;
    state.confirmations = 0;
    observabilityConsole.info('[GEO CONFIRMATION ACCEPTED]', { employee_id: employeeId, reason: 'bootstrap' });
    return { accepted: true, reason: 'bootstrap', latitude: candidate.latitude, longitude: candidate.longitude };
  }

  const dist = distanceMeters(
    { latitude: current.latitude, longitude: current.longitude },
    { latitude: candidate.latitude, longitude: candidate.longitude },
  );
  const betterAccuracy =
    candidate.accuracy != null &&
    (current.accuracy == null || (!Number.isNaN(candidate.accuracy) && candidate.accuracy < current.accuracy));

  if (dist > 50 && betterAccuracy) {
    state.accepted = candidate;
    state.pending = null;
    state.confirmations = 0;
    observabilityConsole.info('[GEO CONFIRMATION ACCEPTED]', { employee_id: employeeId, reason: 'distance_and_better_accuracy', distance_m: dist });
    return { accepted: true, reason: 'distance_and_better_accuracy', latitude: candidate.latitude, longitude: candidate.longitude };
  }

  if (
    state.pending &&
    distanceMeters(
      { latitude: state.pending.latitude, longitude: state.pending.longitude },
      { latitude: candidate.latitude, longitude: candidate.longitude },
    ) < 15
  ) {
    state.confirmations += 1;
  } else {
    state.pending = candidate;
    state.confirmations = 1;
  }

  if (state.confirmations >= 2) {
    const medianLat = rollingMedian([current.latitude, state.pending!.latitude, candidate.latitude]);
    const medianLng = rollingMedian([current.longitude, state.pending!.longitude, candidate.longitude]);
    state.accepted = { ...candidate, latitude: medianLat, longitude: medianLng };
    state.pending = null;
    state.confirmations = 0;
    observabilityConsole.info('[GEO CONFIRMATION ACCEPTED]', { employee_id: employeeId, reason: '2x_confirmation', latitude: medianLat, longitude: medianLng });
    return { accepted: true, reason: '2x_confirmation', latitude: medianLat, longitude: medianLng };
  }

  if (dist < 8) {
    observabilityConsole.info('[GEO OSCILLATION BLOCKED]', { employee_id: employeeId, distance_m: dist });
    return { accepted: false, reason: 'oscillation_blocked' };
  }

  observabilityConsole.info('[GEO CONFIRMATION REJECTED]', { employee_id: employeeId, confirmations: state.confirmations });
  return { accepted: false, reason: 'awaiting_confirmation' };
}

