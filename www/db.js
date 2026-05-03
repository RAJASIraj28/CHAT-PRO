/**
 * ProChat Database Manager - IndexedDB Implementation
 * 
 * Handles large-scale message history storage to avoid localStorage limits.
 */

const ProDB = (() => {
    const DB_NAME = 'ProChatDB';
    const DB_VERSION = 1;
    let db = null;

    const init = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: 'id' });
                    store.createIndex('friendId', 'friendId', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('contacts')) {
                    db.createObjectStore('contacts', { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };

            request.onerror = (event) => reject(event.target.error);
        });
    };

    const saveMessage = (friendId, message) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['messages'], 'readwrite');
            const store = transaction.objectStore('messages');
            const data = { 
                ...message, 
                friendId, 
                timestamp: message.timestamp || Date.now() 
            };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    };

    const getMessages = (friendId) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['messages'], 'readonly');
            const store = transaction.objectStore('messages');
            const index = store.index('friendId');
            const request = index.getAll(IDBKeyRange.only(friendId));
            
            request.onsuccess = () => {
                const results = request.result;
                results.sort((a, b) => a.timestamp - b.timestamp);
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    };

    const clearHistory = (friendId) => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['messages'], 'readwrite');
            const store = transaction.objectStore('messages');
            const index = store.index('friendId');
            const request = index.openCursor(IDBKeyRange.only(friendId));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    };

    return { init, saveMessage, getMessages, clearHistory };
})();

// Inject into ProChat if available
if (typeof ProChat !== 'undefined') {
    ProChat.DB = ProDB;
}
