/**
 * Shim para libs (como recharts) que fazem
 * `import uniqBy from 'es-toolkit/compat/uniqBy'`,
 * mas o pacote es-toolkit só exporta `uniqBy` como named export.
 * Re-exporta `uniqBy` como default.
 */
import { uniqBy } from 'es-toolkit/compat';

export default uniqBy;

