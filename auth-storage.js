/* Only Supabase session credentials live here. Account data remains in Supabase. */
(function (root) {
    'use strict';
    function databaseStore(indexedDB) {
        let opening;
        function open() {
            if (!opening) opening = new Promise((resolve, reject) => {
                if (!indexedDB) return reject(new Error('This browser has disabled sign-in storage. Allow site storage and try again.'));
                const request = indexedDB.open('cryptfolio-auth', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('session');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => { opening = null; reject(new Error('Could not open sign-in storage. Allow site storage and try again.')); };
            });
            return opening;
        }
        async function transaction(mode, operation) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('session', mode);
                const request = operation(tx.objectStore('session'));
                tx.oncomplete = () => resolve(request.result);
                tx.onerror = tx.onabort = () => reject(new Error('Could not save your sign-in. Free some browser storage and try again.'));
            });
        }
        return {
            get: key => transaction('readonly', store => store.get(key)),
            put: (key, value) => transaction('readwrite', store => store.put(value, key))
        };
    }
    function createStorage(database, legacy) {
        const old = (method, key) => { try { return legacy()?.[method](key); } catch { return null; } };
        return {
            async getItem(key) {
                const saved = await database.get(key);
                // A null tombstone prevents a logged-out legacy session from reappearing.
                if (saved !== undefined) return saved;
                const value = old('getItem', key);
                if (value != null) { await database.put(key, value); old('removeItem', key); }
                return value ?? null;
            },
            async setItem(key, value) { await database.put(key, value); old('removeItem', key); },
            async removeItem(key) { await database.put(key, null); old('removeItem', key); }
        };
    }
    if (typeof module !== 'undefined') module.exports = { createStorage, databaseStore };
    else root.CryptfolioAuthStorage = createStorage(databaseStore(root.indexedDB), () => root.localStorage);
})(typeof window === 'undefined' ? globalThis : window);
