/**
 * Shim para libs (ex.: recharts legendSelectors.js) que fazem
 * `import sortBy from 'es-toolkit/compat/sortBy'`,
 * mas o pacote es-toolkit só exporta `sortBy` como named export.
 * Re-exporta `sortBy` como default.
 */
import { sortBy } from 'es-toolkit/compat';

export default sortBy;
