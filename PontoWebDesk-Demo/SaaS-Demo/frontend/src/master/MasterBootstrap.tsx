import React from 'react';
import { MasterApp } from './MasterApp';

/**
 * Entry leve do Painel Master.
 * Não monta AuthSessionProvider, SettingsProvider nem o App operacional.
 */
export default function MasterBootstrap() {
  return <MasterApp />;
}
