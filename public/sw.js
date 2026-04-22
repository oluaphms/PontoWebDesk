/**
 * Service Worker para SmartPonto
 * 
 * Gerencia cache offline e sincronização em background
 */

const CACHE_NAME = 'smartponto-v2';
const RUNTIME_CACHE = 'smartponto-runtime-v2';

// Assets para cache estático
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.svg',
  '/1024.png',
  '/play_store_512.png',
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        // Tentar adicionar assets, mas não falhar se algum não existir
        return Promise.allSettled(
          STATIC_ASSETS.map(asset => 
            cache.add(asset).catch(err => {
              console.warn(`[SW] Failed to cache ${asset}:`, err);
              return null;
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
    .then(() => self.clients.claim())
  );
});

// Interceptação de requisições
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições não-GET
  if (request.method !== 'GET') {
    return;
  }

  // Não cachear endpoints de API (podem conter dados sensíveis / variáveis por usuário)
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  // Ignorar requisições para APIs externas (Firebase, etc)
  if (url.origin !== self.location.origin && 
      !url.hostname.includes('firebase') &&
      !url.hostname.includes('googleapis')) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Retornar do cache se disponível
        if (cachedResponse) {
          return cachedResponse;
        }

        // Buscar da rede
        return fetch(request)
          .then((response) => {
            // Não cachear se não for sucesso
            if (!response || response.status !== 200 || response.type !== 'basic') {
              // Se for 404, não cachear e não propagar erro
              if (response && response.status === 404) {
                console.warn(`[SW] 404 for ${request.url}`);
                return response;
              }
              return response;
            }

            // Clonar resposta para cache
            const responseToCache = response.clone();

            // Cachear assets estáticos
            const isStaticAsset = STATIC_ASSETS.some((asset) => url.pathname === asset);
            if (isStaticAsset) {
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, responseToCache).catch(err => {
                    console.warn(`[SW] Failed to cache ${request.url}:`, err);
                  });
                });
            } else {
              // Cachear outras requisições no runtime cache
              caches.open(RUNTIME_CACHE)
                .then((cache) => {
                  cache.put(request, responseToCache).catch(err => {
                    console.warn(`[SW] Failed to cache ${request.url}:`, err);
                  });
                });
            }

            return response;
          })
          .catch((error) => {
            console.warn(`[SW] Fetch failed for ${request.url}:`, error);
            // Se offline e for uma página, retornar index.html
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            // Para outros recursos, retornar erro silenciosamente
            return new Response('', { status: 404, statusText: 'Not Found' });
          });
      })
  );
});

// Background Sync para registros de ponto
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-punch-records') {
    event.waitUntil(syncPunchRecords());
  }
});

async function syncPunchRecords() {
  try {
    // Buscar registros pendentes do IndexedDB ou localStorage
    if (typeof localStorage === 'undefined') {
      console.warn('[SW] localStorage indisponível no service worker.');
      return;
    }
    let pendingRecords = [];
    try {
      pendingRecords = JSON.parse(
        localStorage.getItem('pending_punch_records') || '[]'
      );
    } catch (error) {
      console.warn('[SW] Falha ao ler pendentes:', error);
      return;
    }

    if (pendingRecords.length === 0) {
      return;
    }

    // Tentar sincronizar cada registro
    for (const record of pendingRecords) {
      try {
        // Aqui você faria a requisição para o backend
        // await fetch('/api/punch', { method: 'POST', body: JSON.stringify(record) });
        
        // Remover do array de pendentes após sucesso
        const updated = pendingRecords.filter((r) => r.id !== record.id);
        try {
          localStorage.setItem('pending_punch_records', JSON.stringify(updated));
        } catch (error) {
          console.warn('[SW] Falha ao salvar pendentes:', error);
        }
      } catch (error) {
        console.error('[SW] Erro ao sincronizar registro:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Erro no background sync:', error);
  }
}

// Push notifications (para futuras implementações)
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'SmartPonto';
  const options = {
    body: data.body || 'Nova notificação',
    icon: '/favicon.svg',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Click em notificações
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
