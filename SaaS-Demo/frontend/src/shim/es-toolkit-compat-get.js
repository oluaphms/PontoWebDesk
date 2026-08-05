/**
 * Shim para recharts (DataUtils.js): recharts usa "import get from 'es-toolkit/compat/get'",
 * mas es-toolkit expõe apenas named export { get }. Este módulo re-exporta get como default.
 */
import { get } from 'es-toolkit-compat-get-internal';
export default get;
