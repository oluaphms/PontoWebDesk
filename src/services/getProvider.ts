import type { IDataProvider } from './dataProvider';
import { localApiProvider } from './providers/localApiProvider';

let modeLogged = false;

export function getProvider(): IDataProvider {
  if (!modeLogged) {
    modeLogged = true;
    console.log('[MODE] LOCAL_API ativo (API VPS)');
  }
  return localApiProvider;
}
