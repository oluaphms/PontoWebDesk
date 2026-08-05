// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  composeUpdatesCentral,
  deriveInstallationStatus,
  filterUpdateHistory,
} from './composeUpdatesCentral.js';
import type {
  MasterInstallation,
  MasterRelease,
  MasterUpdateEvent,
  MasterUpdateRequest,
} from './updateControlPlane.types.js';

function installation(
  partial: Partial<MasterInstallation> & Pick<MasterInstallation, 'id' | 'companyId' | 'companyName'>,
): MasterInstallation {
  return {
    mode: 'LOCAL',
    component: 'platform',
    channel: 'stable',
    reportedVersion: '1.0.0',
    latestVersion: '1.0.0',
    updateStatus: 'current',
    lastSeenAt: '2026-07-19T10:00:00.000Z',
    source: 'heartbeat',
    targetReleaseId: null,
    activeRequestId: null,
    activeRequestStatus: null,
    lastUpdateAt: '2026-07-18T10:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-18T10:00:00.000Z',
    ...partial,
  };
}

function request(
  partial: Partial<MasterUpdateRequest> &
    Pick<MasterUpdateRequest, 'id' | 'installationId' | 'status' | 'kind'>,
): MasterUpdateRequest {
  return {
    releaseId: 'rel_1',
    fromVersion: '1.0.0',
    targetVersion: '1.1.0',
    reason: null,
    requestedBy: null,
    requestedEmail: null,
    approvedBy: null,
    approvedAt: null,
    completedAt: null,
    failedAt: null,
    createdAt: '2026-07-19T09:00:00.000Z',
    updatedAt: '2026-07-19T09:00:00.000Z',
    ...partial,
  };
}

describe('composeUpdatesCentral (FASE 27)', () => {
  it('compõe contagens e canais Stable/Beta/RC', () => {
    const releases: MasterRelease[] = [
      {
        id: 'r1',
        component: 'platform',
        version: '2.0.0',
        channel: 'stable',
        status: 'published',
        changelog: 'x',
        artifactUrl: 'https://cdn.example.com/a.zip',
        sha256: 'a'.repeat(64),
        signature: null,
        signatureAlgorithm: null,
        signerKeyId: null,
        artifactSize: null,
        minSupportedVersion: null,
        rollbackReleaseId: null,
        publishedAt: '2026-07-10T00:00:00.000Z',
        createdBy: null,
        createdByEmail: null,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
      {
        id: 'r2',
        component: 'platform',
        version: '2.1.0-rc.1',
        channel: 'rc',
        status: 'published',
        changelog: 'rc',
        artifactUrl: 'https://cdn.example.com/b.zip',
        sha256: 'b'.repeat(64),
        signature: null,
        signatureAlgorithm: null,
        signerKeyId: null,
        artifactSize: null,
        minSupportedVersion: null,
        rollbackReleaseId: null,
        publishedAt: '2026-07-15T00:00:00.000Z',
        createdBy: null,
        createdByEmail: null,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      },
    ];

    const installations = [
      installation({
        id: 'i1',
        companyId: 'c1',
        companyName: 'Atualizada',
        updateStatus: 'current',
      }),
      installation({
        id: 'i2',
        companyId: 'c2',
        companyName: 'Pendente',
        reportedVersion: '1.0.0',
        latestVersion: '2.0.0',
        updateStatus: 'outdated',
        activeRequestId: 'u2',
        activeRequestStatus: 'requested',
      }),
      installation({
        id: 'i3',
        companyId: 'c3',
        companyName: 'Executando',
        updateStatus: 'outdated',
        activeRequestId: 'u3',
        activeRequestStatus: 'manual_required',
        channel: 'beta',
      }),
      installation({
        id: 'i4',
        companyId: 'c4',
        companyName: 'Falhou',
        updateStatus: 'outdated',
      }),
      installation({
        id: 'i5',
        companyId: 'c5',
        companyName: 'Rollback',
        channel: 'rc',
        updateStatus: 'outdated',
        activeRequestId: 'u5',
        activeRequestStatus: 'approved',
      }),
    ];

    const requests = [
      request({
        id: 'u2',
        installationId: 'i2',
        status: 'requested',
        kind: 'update',
      }),
      request({
        id: 'u3',
        installationId: 'i3',
        status: 'manual_required',
        kind: 'update',
      }),
      request({
        id: 'u4',
        installationId: 'i4',
        status: 'failed',
        kind: 'update',
        failedAt: '2026-07-19T11:00:00.000Z',
        createdAt: '2026-07-19T10:00:00.000Z',
      }),
      request({
        id: 'u5',
        installationId: 'i5',
        status: 'approved',
        kind: 'rollback',
      }),
    ];

    const snap = composeUpdatesCentral({
      releases,
      installations,
      requests,
      currentPlatformVersion: '1.9.0',
    });

    expect(snap.agentOnlyExecution).toBe(true);
    expect(snap.currentPlatformVersion).toBe('1.9.0');
    expect(snap.latestRelease.version).toBe('2.1.0-rc.1');
    expect(snap.channels.find((c) => c.channel === 'stable')?.latestReleaseVersion).toBe('2.0.0');
    expect(snap.channels.find((c) => c.channel === 'rc')?.label).toBe('Release Candidate');
    expect(snap.counts.updated).toBe(1);
    expect(snap.counts.pending).toBe(1);
    expect(snap.counts.executing).toBe(1);
    expect(snap.counts.failed).toBe(1);
    expect(snap.counts.rollback).toBe(1);

    const row = snap.rows.find((r) => r.companyName === 'Pendente');
    expect(row?.statusLabel).toBe('Pendente');
    expect(row?.lastHeartbeatAt).toBeTruthy();
  });

  it('deriveInstallationStatus prioriza execução do agente', () => {
    const inst = installation({
      id: 'ix',
      companyId: 'cx',
      companyName: 'X',
      activeRequestId: 'ux',
      activeRequestStatus: 'approved',
      updateStatus: 'outdated',
    });
    expect(
      deriveInstallationStatus(inst, [
        request({ id: 'ux', installationId: 'ix', status: 'approved', kind: 'update' }),
      ]),
    ).toBe('executing');
  });

  it('filterUpdateHistory filtra por requestId', () => {
    const events: MasterUpdateEvent[] = [
      {
        id: 'e1',
        requestId: 'req_a',
        eventType: 'status_changed',
        fromStatus: 'requested',
        toStatus: 'approved',
        message: 'ok',
        actorId: null,
        actorEmail: null,
        metadata: {},
        createdAt: '2026-07-19T00:00:00.000Z',
      },
      {
        id: 'e2',
        requestId: 'req_b',
        eventType: 'status_changed',
        fromStatus: null,
        toStatus: 'failed',
        message: 'fail',
        actorId: null,
        actorEmail: null,
        metadata: {},
        createdAt: '2026-07-19T01:00:00.000Z',
      },
    ];
    expect(filterUpdateHistory(events, { requestId: 'req_a' })).toHaveLength(1);
  });
});
