/**
 * Shim para libs (ex.: recharts ResponsiveContainer.js) que fazem
 * `import throttle from 'es-toolkit/compat/throttle'`,
 * mas o pacote es-toolkit só exporta `throttle` como named export.
 * Re-exporta `throttle` como default.
 */
import { throttle } from 'es-toolkit/compat';

export default throttle;
