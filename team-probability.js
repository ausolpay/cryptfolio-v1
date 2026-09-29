/* Estimated selection odds remain separate from the provider's confirmed live odds. */
const TeamProbability = (() => {
    const catalogue = new Map();
    const cards = new Set();
    let pending;
    const odds = value => `1:${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    function render(card, stale = false) {
        if (!card.isConnected) { cards.delete(card); return; }
        const raw = catalogue.get(card.teamProbabilityId);
        const input = card.querySelector('.share-adjuster-input');
        if (!raw || !input) return;
        let panel = card.querySelector('.team-probability-preview');
        if (!panel) { panel = document.createElement('div'); panel.className = 'team-probability-preview'; panel.setAttribute('aria-live', 'polite'); card.append(panel); }
        const ticket = raw.currencyAlgoTicket;
        const unit = Number(raw.minShareAmount ?? ticket?.minShareAmount);
        const bought = EasyMiningModel.shareCount(raw.addedAmount, unit);
        const owned = getMyTeamShares(raw.id) || 0;
        const selected = Number(input.value);
        if (card.teamRewardBase && bought !== null) {
            card.teamRewardBase.totalBoughtShares = bought;
            card.teamRewardBase.myBoughtShares = owned;
        }
        const values = [[ticket?.currencyAlgo?.currency, raw.probabilityPrecision]];
        if (ticket?.mergeCurrencyAlgo) values.push([ticket.mergeCurrencyAlgo.currency, raw.mergeProbabilityPrecision]);
        panel.replaceChildren();
        for (const [coin, denominator] of values) {
            const result = EasyMiningModel.probabilityPreview(denominator, bought, owned, selected);
            const row = document.createElement('div');
            row.textContent = result
                ? `${coin}: live ${odds(denominator)} → preview ≈ ${odds(result.denominator)} (${(result.probability * 100).toFixed(2)}%)`
                : `${coin}: preview unavailable until the pool has a measurable live share baseline.`;
            panel.append(row);
        }
        const note = document.createElement('small');
        note.textContent = stale ? 'Live refresh failed. Preview uses the last received package data.'
            : 'Estimated team chance with your selected total shares, assuming unchanged mining terms. Shares are not purchased yet.';
        panel.append(note);
    }
    function setCatalogue(items) {
        catalogue.clear();
        for (const raw of items) catalogue.set(raw.id, raw);
        for (const card of cards) {
            if (!catalogue.has(card.teamProbabilityId)) {
                const panel = card.querySelector('.team-probability-preview');
                if (panel) panel.textContent = 'This pool is no longer in the live catalogue.';
            } else render(card);
        }
    }
    function bind(card, pkg) {
        card.teamProbabilityId = pkg.apiData?.id || pkg.id;
        if (pkg.apiData) catalogue.set(pkg.apiData.id, pkg.apiData);
        cards.add(card);
        // Newly built cards are attached by the caller after this function returns.
        queueMicrotask(() => render(card));
    }
    async function refresh() {
        if (pending) return pending;
        pending = (async () => {
            const endpoint = '/main/api/v2/public/solo/shared/order?onlyGold=false&limit=100';
            const response = await CloudAccount.proxyFetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
                body: JSON.stringify({ endpoint, method: 'GET', headers: {} })
            });
            if (!response.ok) throw new Error('Package refresh failed');
            const data = await response.json();
            if (!Array.isArray(data.list)) throw new Error('Package data unavailable');
            EasyMiningCurrency.setCatalogue('team', data.list);
        })();
        try { await pending; } catch { for (const card of cards) render(card, true); }
        finally { pending = null; }
    }
    function changed(input) {
        const card = input.closest('.buy-package-card, .easymining-alert-card');
        if (card?.teamProbabilityId) { render(card); void refresh(); }
    }
    return { bind, setCatalogue, changed, refresh };
})();
