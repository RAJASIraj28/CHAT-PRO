/**
 * ProChat Service Worker - Offline & Background Sync
 * Version: 1.2.0
 */

const CACHE_NAME = 'prochat-v2-cache';
const ASSETS = [
    '/',
    '/www/index.html',
    '/www/chat.js',
    '/www/chat.css',
    '/www/icon.png',
    '/www/manifest.json',
    'https://cdn.jsdelivr.net/npm/gun/gun.js',
    'https://cdn.jsdelivr.net/npm/gun/sea.js',
    'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
    'https://unpkg.com/mqtt/dist/mqtt.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@400;600;800&family=Orbitron:wght@400;700;900&display=swap'
];

// Install Event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching system assets');
            return cache.addAll(ASSETS);
        })
    );
});

// Activate Event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
});

// Fetch Event - Network First, then Cache
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});

// Background Sync (Future)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-messages') {
        event.waitUntil(syncMessages());
    }
});

// Push Notifications
self.addEventListener('push', (event) => {
    const data = event.data.json();
    self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/www/icon.png'
    });
});

async function syncMessages() {
    // Logic to sync offline messages from IndexedDB
    console.log('[SW] Syncing offline messages...');
}
