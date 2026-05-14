// ⚠️ TOKEN-ONLY UI RULE
// Não utilizar classes visuais hardcoded (padding, radius, font, shadow).
// Sempre utilizar uiTokens ou helpers centralizados.
import React from 'react';
import { repBadgesUi } from '../../../styles/repBadgesUi';
import { cx } from '../../../styles/cx';

export function repDeviceRowStatusBadge(status: string | null) {
  const s = (status || '').toLowerCase();
  const base = repBadgesUi.base;
  if (s === 'ativo') {
    return (
      <span className={cx(base, repBadgesUi.ok)}>
        Conectado
      </span>
    );
  }
  if (s === 'erro') {
    return (
      <span className={cx(base, repBadgesUi.err)}>Erro</span>
    );
  }
  return (
    <span className={cx(base, repBadgesUi.off)}>Sem comunicação</span>
  );
}
