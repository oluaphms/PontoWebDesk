/**
 * Bridge ESM para `eventemitter3`: o pacote expõe `index.mjs` que faz
 * `import EventEmitter from './index.js'`, mas `index.js` é CJS puro e o Vite
 * no dev não expõe `default` nesse sub-import — quebra o carregamento (tela branca).
 *
 * Importamos o CJS como namespace e reexportamos como default + named.
 */
import * as ns from 'eventemitter3-cjs-entry';

const EventEmitter = ns.default ?? ns;

export { EventEmitter };
export default EventEmitter;
