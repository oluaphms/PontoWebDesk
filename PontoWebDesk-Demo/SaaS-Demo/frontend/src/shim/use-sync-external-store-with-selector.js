/**
 * Shim ESM para dependências (ex.: recharts) que fazem
 * `import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector'`.
 * O módulo original é CJS e no ESM só expõe default; este arquivo re-exporta o named export.
 */
import m from 'use-sync-external-store/shim/with-selector.js';

const useSyncExternalStoreWithSelector =
  m?.useSyncExternalStoreWithSelector ?? m?.default?.useSyncExternalStoreWithSelector;

if (typeof useSyncExternalStoreWithSelector !== 'function') {
  throw new Error(
    '[shim] use-sync-external-store/shim/with-selector não expôs useSyncExternalStoreWithSelector. Verifique a instalação.'
  );
}

export { useSyncExternalStoreWithSelector };
export default useSyncExternalStoreWithSelector;
