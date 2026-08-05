/**
 * Módulo REP Integration (Enterprise) - Integração com relógios REP
 * Control iD, Henry, Topdata
 */

import { registerREPAdapter } from './repAdapters';
import controlidAdapter from './adapters/controlidAdapter';
import henryAdapter from './adapters/henryAdapter';
import topdataAdapter from './adapters/topdataAdapter';

registerREPAdapter(controlidAdapter);
registerREPAdapter(henryAdapter);
registerREPAdapter(topdataAdapter);

export * from './types';
export * from './repAdapters';
export * from './repParser';
export * from './repDeviceManager';
export * from './repSyncService';
export { default as controlidAdapter } from './adapters/controlidAdapter';
export { default as henryAdapter } from './adapters/henryAdapter';
export { default as topdataAdapter } from './adapters/topdataAdapter';
