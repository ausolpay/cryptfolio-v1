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
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function mergeValue(base, local, remote) {
        if (same(local, base)) return remote;
        if (same(remote, base) || same(local, remote)) return local;
        const object = value => value && typeof value === 'object' && !Array.isArray(value);
        if (object(local) && object(remote) && (object(base) || base === undefined)) {
            const result = {};
            for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
                const value = mergeValue(base?.[key], local[key], remote[key]);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        throw new Error('Both devices changed the same data.');
    }
    function mergeRecords(base, local, remote) {
        const records = {}, conflicts = [];
        for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
            let value;
            try {
                if (local[key] === base[key]) value = remote[key];
                else if (remote[key] === base[key] || local[key] === remote[key]) value = local[key];
                // These are derived observations, never transaction entries or auto-buy rules.
                else if (/_recordHigh$/.test(key)) value = String(Math.max(Number(local[key]), Number(remote[key])));
                else if (/_recordLow$/.test(key)) value = String(Math.min(Number(local[key]), Number(remote[key])));
                else if (/(?:_display(?:AUD|Value|Holdings)|_easyMiningData|_chartDataStore|_packageStates|_candlestickData|_savedPackageProbabilities|_lastUpdated|_totalHoldings24hAgo)$/.test(key)) value = remote[key];
                else {
                    const parse = value => value === undefined ? undefined : JSON.parse(value);
                    value = JSON.stringify(mergeValue(parse(base[key]), parse(local[key]), parse(remote[key])));
                }
                if (value !== undefined) records[key] = value;
            } catch { conflicts.push(key); }
        }
        return { records, conflicts };
    }
    const api = { createStorage, mergeRecords };
    if (typeof module !== 'undefined') module.exports = api;
    else {
        root.CloudData = api;
        root.appStorage = createStorage({}, () => root.dispatchEvent(new Event('app-data-changed')));
    }
})(typeof window === 'undefined' ? globalThis : window);

