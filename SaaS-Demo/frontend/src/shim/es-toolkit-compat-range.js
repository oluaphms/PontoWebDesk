/**
 * Shim para libs (ex.: recharts) que fazem
 * `import range from 'es-toolkit/compat/range'`,
 * mas o es-toolkit expõe `range` como export nomeado (em `es-toolkit/compat`).
 * Re-exporta como `default`.
 */
import { range } from 'es-toolkit/compat';

export default range;

