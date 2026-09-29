/* In-memory working copy only. Supabase is the sole persistent app-data store. */
(function (root) {
    'use strict';
    function createStorage(initial = {}, changed = () => {}) {
        let data = new Map(Object.entries(initial));
        return {
            get length() { return data.size; },
            key(index) { return [...data.keys()][index] ?? null; },
            getItem(key) { return data.get(String(key)) ?? null; },
            setItem(key, value) {
                key = String(key); value = String(value);
                if (data.get(key) !== value) { data.set(key, value); changed(); }
            },
            removeItem(key) { if (data.delete(String(key))) changed(); },
            clear() { if (data.size) { data.clear(); changed(); } },
            replace(next) { data = new Map(Object.entries(next)); },
            snapshot() { return Object.fromEntries([...data.entries()].sort(([a], [b]) => a.localeCompare(b))); }
        };
    }
    const api = { createStorage };
    if (typeof module !== 'undefined') module.exports = api;
    else {
        root.CloudData = api;
        root.appStorage = createStorage({}, () => root.dispatchEvent(new Event('app-data-changed')));
    }
})(typeof window === 'undefined' ? globalThis : window);

