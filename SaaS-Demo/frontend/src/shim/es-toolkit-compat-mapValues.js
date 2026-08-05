/**
 * Shim para libs (ex.: recharts) que fazem
 * `import mapValues from 'es-toolkit/compat/mapValues'`,
 * mas es-toolkit só exporta named export. Re-exporta como default.
 */
import { mapValues } from 'es-toolkit/compat';

export default mapValues;
