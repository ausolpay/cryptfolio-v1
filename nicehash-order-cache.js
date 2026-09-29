/* Bounded provider requests; completed history need not be downloaded every five seconds. */
const NiceHashOrderCache = (() => {
    const cache = new Map();
    async function list(filter, ttl = 0) {
        const identity = `${easyMiningSettings.orgId}:${easyMiningSettings.apiKey}:${filter}`;
        const saved = cache.get(identity);
        if (saved?.pending) return saved.pending;
        if (saved && Date.now() - saved.at < ttl) return saved.orders;
        const pending = (async () => {
            const orders = new Map();
            for (let page = 0; page < 1000; page++) {
                const endpoint = `/main/api/v2/hashpower/solo/order?${filter}&limit=100&page=${page}`;
                const headers = generateNiceHashAuthHeaders('GET', endpoint);
                const response = await CloudAccount.proxyFetch(VERCEL_PROXY_ENDPOINT, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint, method: 'GET', headers })
                });
                if (!response.ok) throw new Error(`NiceHash order history returned ${response.status}. Saved data is retained.`);
                const data = await response.json();
                const items = Array.isArray(data) ? data : data.list;
                if (!Array.isArray(items)) throw new Error('NiceHash returned an unexpected order list.');
                const previousSize = orders.size;
                for (const order of items) if (order.id) orders.set(order.id, order);
                if (items.length && orders.size === previousSize) throw new Error('NiceHash repeated an order page. History refresh paused.');
                if (items.length < 100 || (Number.isFinite(data.pagination?.totalPageCount) && page + 1 >= data.pagination.totalPageCount)) {
                    const result = [...orders.values()];
                    cache.set(identity, { at: Date.now(), orders: result });
                    return result;
                }
            }
            throw new Error('NiceHash history is too large to refresh in one pass.');
        })();
        cache.set(identity, { ...saved, pending });
        try { return await pending; }
        catch (error) {
            if (saved?.orders && filter !== 'active=true') {
                cache.set(identity, { orders: saved.orders, at: Date.now() - Math.max(0, ttl - 15000) });
                console.warn(error.message);
                return saved.orders;
            }
            cache.delete(identity);
            throw error;
        }
    }
    return { list };
})();
