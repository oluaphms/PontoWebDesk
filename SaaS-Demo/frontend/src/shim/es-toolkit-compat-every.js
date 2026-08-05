/**
 * Shim para libs (ex.: recharts) que fazem
 * `import every from 'es-toolkit/compat/every'`,
 * mas es-toolkit só exporta named export. Re-exporta como default.
 */
import { every } from 'es-toolkit/compat';

export default every;
