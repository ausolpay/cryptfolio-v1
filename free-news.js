/* Shared request for the coin's latest headlines and its 30-day coverage count. */
function installFreeNews() {
    const pending = new Map();
    async function coverage(name, symbol) {
        const owner = loggedInUser;
        const normalized = String(name).replace(/-/g, ' ').toLowerCase();
        const key = `${loggedInUser}_freeNews_${normalized}_${symbol.toLowerCase()}`;
        let cached;
        try { cached = JSON.parse(appStorage.getItem(key)); } catch {}
        if (cached && Date.now() - Date.parse(cached.checkedAt) < 600000) return cached;
        if (pending.has(key)) return pending.get(key);
        const request = (async () => {
            const response = await fetch('/api/news?' + new URLSearchParams({ name: normalized, symbol }), { signal: AbortSignal.timeout(12000) });
            if (!response.ok) throw new Error('News sources are temporarily unavailable.');
            const data = await response.json();
            if (owner === loggedInUser) appStorage.setItem(key, JSON.stringify(data));
            return data;
        })();
        pending.set(key, request);
        try { return await request; } finally { pending.delete(key); }
    }
    window.fetchAICoverage = coverage;
    window.fetchMentions30d = async function (name, symbol) {
        const coin = currentCryptoId;
        const label = document.getElementById('mentions30d');
        if (label) label.textContent = 'Loading…';
        try {
            const data = await coverage(name, symbol);
            if (currentCryptoId !== coin) return;
            if (label) { label.textContent = data.count.toLocaleString() + ' indexed'; label.title = data.coverage; }
            const details = document.getElementById('mentions-breakdown');
            if (details) details.textContent = `${data.coverage} Sources: ${data.available.join(', ')}.${data.unavailable.length ? ' Unavailable: ' + data.unavailable.join(', ') + '.' : ''} Checked ${new Date(data.checkedAt).toLocaleString()}.`;
        } catch {
            if (currentCryptoId === coin && label) label.textContent = 'Unavailable';
        }
    };
    window.fetchAndRenderNews = async function (coin, symbol) {
        const container = document.getElementById('news-slider-container');
        if (container) container.textContent = 'Loading recent headlines…';
        try {
            const data = await coverage(coin, symbol);
            if (currentCryptoId !== coin) return;
            renderNewsSlider(data.articles.slice(0, 30));
        } catch {
            if (currentCryptoId === coin && container) container.textContent = 'News sources are temporarily unavailable. Try again shortly.';
        }
    };
}
