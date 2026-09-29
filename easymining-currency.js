/* Currency-aware catalogue; BTC's existing rules retain their original keys. */
const EasyMiningCurrency = (() => {
    const catalogue = { single: [], team: [] };
    const fetchedAt = { single: 0, team: 0 };
    const selections = new Map();
    let buying = false;
    let tab = 'single';
    const selected = () => MiningWallet.currency();
    const ticket = raw => raw.currencyAlgoTicket || raw;
    function setCatalogue(kind, items) {
        catalogue[kind] = Array.isArray(items) ? items : [];
        fetchedAt[kind] = Date.now();
        if (kind === 'team') TeamProbability.setCatalogue(catalogue[kind]);
        render();
    }
    function selectTab(value) { tab = value === 'team' ? 'team' : 'single'; render(); }
    function selectCurrency(value) {
        MiningWallet.select(value);
    }
    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function localPrice(amount) {
        const rate = getPriceFromObject(window.packageCryptoPrices?.usdt);
        return rate > 0 ? new Intl.NumberFormat(undefined, { style: 'currency',
            currency: getCoinGeckoCurrency().toUpperCase() }).format(amount * rate) : 'Live conversion unavailable';
    }
    async function request(endpoint, method = 'GET', body) {
        const headers = generateNiceHashAuthHeaders(method, endpoint, body ? JSON.stringify(body) : undefined);
        const response = await CloudAccount.proxyFetch(VERCEL_PROXY_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ endpoint, method, headers, body })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.message || 'NiceHash could not confirm this request.');
        return data;
    }
    async function buy(raw, selected, status) {
        if (buying) return;
        buying = true; status.textContent = 'Checking live package and balance…';
        try {
            if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) throw new Error('Activate NiceHash API access in settings first.');
            await CloudAccount.runAutomation(async () => {
                const team = Boolean(raw.currencyAlgoTicket);
                const data = await request(team ? '/main/api/v2/hashpower/solo/shared/order?onlyGold=false&limit=100'
                    : '/main/api/v2/public/solo/package?limit=100');
                const current = (Array.isArray(data) ? data : data.list || []).find(item => item.id === raw.id);
                if (!current) throw new Error('This package is no longer available. Refresh the catalogue.');
                const t = ticket(current);
                const member = team ? current.members?.find(item => item.organizationId === easyMiningSettings.orgId) : null;
                if (team && !Array.isArray(current.members)) throw new Error('Could not verify your current shares. Try again after syncing.');
                const unit = EasyMiningModel.payment(current).shareAmount;
                const owned = member ? EasyMiningModel.shareCount(member.addedAmount, unit) : 0;
                if (team && owned === null) throw new Error('Could not verify your contribution.');
                const address = getWithdrawalAddress(t.currencyAlgo.currency) || prompt(`Enter your ${t.currencyAlgo.currency} reward address:`);
                if (!address) { status.textContent = 'Purchase cancelled.'; return; }
                const mergeAddress = t.mergeCurrencyAlgo ? getWithdrawalAddress(t.mergeCurrencyAlgo.currency) || prompt(`Enter your ${t.mergeCurrencyAlgo.currency} reward address:`) : null;
                const plan = EasyMiningModel.purchasePlan(current, owned, selected, address, mergeAddress);
                if (plan.currency !== 'USDT') throw new Error('Package payment currency changed. Refresh before buying.');
                await fetchNiceHashBalances();
                const balance = window.niceHashCurrencyBalances?.USDT?.available;
                if (plan.change > 0 && (!Number.isFinite(balance) || balance < plan.change)) throw new Error('Not enough available USDT in your NiceHash wallet.');
                if (!confirm(`${t.name}\n${team ? `Your shares: ${owned} → ${selected}\n` : ''}${plan.change < 0 ? 'Reduce contribution by' : 'Pay'} ${Math.abs(plan.change)} USDT (${localPrice(Math.abs(plan.change))})\nReward address: ${address}\n\nConfirm this NiceHash order?`)) { status.textContent = 'Purchase cancelled.'; return; }
                status.textContent = 'Submitting order…';
                const result = EasyMiningModel.assertSuccessfulOrder(await request(plan.endpoint, 'POST', plan.body));
                const id = result.id || result.orderId || crypto.randomUUID();
                appStorage.setItem(`${loggedInUser}_miningPurchase_${id}`, JSON.stringify({ id, packageId: current.id,
                    name: t.name, currency: plan.currency, amount: plan.change, shares: team ? selected : null, at: new Date().toISOString() }));
                if (team) { setPendingShares(current.id, selected); saveMyTeamShares(current.id, selected); }
                await CloudAccount.flush();
                status.textContent = 'Order confirmed. Your package will appear on the next refresh.';
            }, true);
        } catch (error) { status.textContent = error.message; }
        finally { buying = false; }
    }
    function render() {
        const root = document.getElementById('usdt-package-catalogue');
        const picker = document.getElementById('mining-payment-currency');
        if (!root || !picker || typeof loggedInUser === 'undefined') return;
        picker.value = selected();
        const usdt = selected() === 'USDT';
        root.hidden = !usdt;
        for (const kind of ['single', 'team']) {
            document.getElementById(`buy-${kind}-packages-page`)?.classList.toggle('currency-hidden', usdt);
        }
        if (!usdt || buying) return;
        root.replaceChildren();
        root.append(element('p', 'Paid in USDT • Rewards stay in the mined coin. Configure automation in Package Alerts.', 'mining-currency-note'));
        const packages = catalogue[tab].filter(raw => ticket(raw).currencyMarket === 'USDT' && ticket(raw).available && ticket(raw).status === 'A');
        if (!packages.length) root.append(element('p', 'No USDT packages are available in the latest catalogue.'));
        const grid = element('div', null, 'currency-package-grid');
        root.append(grid);
        for (const raw of packages) {
            const t = ticket(raw);
            const p = EasyMiningModel.payment(raw);
            const card = element('article', null, 'currency-package-card');
            const heading = element('div', null, 'currency-package-heading');
            const iconUrl = EasyMiningModel.packageIcon(raw);
            if (iconUrl) { const icon = element('img'); icon.src = iconUrl; icon.alt = ''; heading.append(icon); }
            heading.append(element('h3', t.name)); card.append(heading);
            card.append(element('p', `${t.currencyAlgo.currency} rewards`, 'mining-currency-note'));
            const cost = tab === 'team' ? p.shareAmount : p.amount;
            card.append(element('strong', cost ? `${cost} USDT${tab === 'team' ? ' / share' : ''}` : 'Share price unavailable', 'currency-package-price'));
            if (cost) card.append(element('p', localPrice(cost), 'mining-currency-note'));
            const stats = element('dl');
            const addStat = (name, value) => { stats.append(element('dt', name), element('dd', value)); };
            addStat('Package odds', formatProbability(raw.probabilityPrecision) || 'Unavailable');
            addStat('Duration', `${Number(raw.duration || t.duration) / 3600} hours`);
            addStat('Block reward', `${t.currencyAlgo.blockReward} ${t.currencyAlgo.currency}`);
            if (tab === 'team') {
                addStat('Pool funded', String(raw.addedAmount) + ' / ' + String(raw.fullAmount) + ' USDT');
                addStat('Participants', String(raw.numberOfParticipants ?? 0));
            }
            card.append(stats);
            const status = element('p', '', 'mining-currency-note'); status.setAttribute('role', 'status');
            let selected = selections.get(raw.id) ?? Math.max(1, getMyTeamShares(raw.id) || 0);
            const button = element('button', tab === 'team' ? 'Update shares' : 'Buy package', 'settings-save-btn');
            if (tab === 'team') {
                const controls = element('div', null, 'share-adjuster'), minus = element('button', '−'), plus = element('button', '+');
                const input = element('input'); input.type = 'number'; input.readOnly = true; input.className = 'share-adjuster-input';
                input.setAttribute('aria-label', `${t.name} total shares`); input.value = selected;
                const reward = element('p', null, 'mining-currency-note');
                const preview = () => {
                    try {
                        const value = EasyMiningModel.teamPreview(raw, getMyTeamShares(raw.id) || 0, selected);
                        reward.textContent = `Your potential reward: ${(Number(t.currencyAlgo.blockReward) * value.fraction).toFixed(6)} ${t.currencyAlgo.currency} • ${(value.fraction * 100).toFixed(2)}% of ${value.total} projected shares`;
                        minus.disabled = selected <= 1; plus.disabled = selected >= value.max;
                        button.disabled = selected > value.max || value.change === 0;
                        button.textContent = value.change < 0 ? `Remove ${Math.abs(value.change)} USDT of shares` : `Add ${value.change} USDT of shares`;
                    } catch (error) { reward.textContent = error.message; button.disabled = true; }
                };
                for (const [control, delta] of [[minus, -1], [plus, 1]]) control.onclick = () => {
                    selected = Math.max(1, selected + delta); selections.set(raw.id, selected); input.value = selected;
                    preview(); TeamProbability.changed(input);
                };
                controls.append(minus, input, plus); card.append(controls, reward);
                card.classList.add('buy-package-card');
                TeamProbability.bind(card, { id: raw.id, apiData: raw }); preview();
            }
            button.onclick = () => buy(raw, selected, status);
            card.append(button, status); grid.append(card);
        }
    }
    window.addEventListener('cloud-data-loaded', render);
    function blockReward(currency) {
        for (const raw of [...catalogue.single, ...catalogue.team]) {
            const t = ticket(raw);
            for (const algo of [t.currencyAlgo, t.mergeCurrencyAlgo]) {
                if (algo?.currency === currency && Number(algo.blockReward) > 0) return Number(algo.blockReward);
            }
        }
        return null;
    }
    function metricPackages(kind) {
        if (Date.now() - fetchedAt[kind] > 60000) return [];
        return catalogue[kind].filter(raw => ticket(raw).currencyMarket === 'USDT' && ticket(raw).available && ticket(raw).status === 'A')
            .map(raw => {
                const t = ticket(raw), p = EasyMiningModel.payment(raw, { BTC: getBuyPackagePrice('BTC'), USDT: getBuyPackagePrice('USDT') });
                const unit = getPackageDisplayUnit({ algorithm: t.currencyAlgo.miningAlgorithm, currency: t.currencyAlgo.currency, currencyAlgo: t.currencyAlgo });
                const team = kind === 'team', fill = Number(raw.fullAmount) > 0 ? Number(raw.addedAmount) / Number(raw.fullAmount) : 0;
                return { name: EasyMiningModel.alertName(raw), id: raw.id, apiData: raw, isTeam: team,
                    crypto: t.currencyAlgo.currency, mainCrypto: t.currencyAlgo.currency,
                    mergeCrypto: t.mergeCurrencyAlgo?.currency, isDualCrypto: !!t.mergeCurrencyAlgo,
                    paymentCurrency: 'USDT', paymentAmount: p.amount, sharePrice: p.shareAmount,
                    priceBTC: p.btcEquivalent, priceAUD: p.localAmount,
                    probabilityPrecision: raw.probabilityPrecision, probability: formatProbability(raw.probabilityPrecision),
                    mergeProbabilityPrecision: raw.mergeProbabilityPrecision, mergeProbability: formatProbability(raw.mergeProbabilityPrecision),
                    hashrate: `${Number(raw.projectedSpeed) * (team ? fill : 1)} ${unit}/s`, algorithm: t.currencyAlgo.miningAlgorithm,
                    duration: `${Number(raw.duration || t.duration) / 3600}h`, packageDuration: Number(raw.duration || t.duration),
                    blockReward: t.currencyAlgo.blockReward, numberOfParticipants: raw.numberOfParticipants,
                    fullAmount: raw.fullAmount, addedAmount: raw.addedAmount, shares: Number((fill * 100).toFixed(2)), lifeTimeTill: raw.lifeTimeTill,
                    observedAt: fetchedAt[kind] };
            });
    }
    let alertsRunning = false;
    async function runAlerts() {
        if (alertsRunning) return;
        alertsRunning = true;
        try {
            const solo = metricPackages('single'), team = metricPackages('team');
            const soloMatches = await checkPackageRecommendations(solo);
            const teamMatches = await checkTeamRecommendations(team, solo);
            renderAlerts('solo', soloMatches); renderAlerts('team', teamMatches);
            if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey || !canUserAccess('botFeatures')) return;
            for (const [kind, matches] of [['solo', soloMatches], ['team', teamMatches]]) {
                for (const pkg of matches) await CloudAccount.runAutomation(() => autoBuy(pkg, kind));
            }
        } finally { alertsRunning = false; }
    }
    function renderAlerts(kind, packages) {
        const host = document.getElementById(`usdt-${kind}-alerts`);
        if (!host) return;
        host.replaceChildren();
        for (const pkg of packages) {
            const card = element('article', null, 'currency-package-card');
            card.append(element('h3', pkg.name), element('p', `USDT wallet · ${pkg.crypto} rewards · Odds ${pkg.probability}`));
            const status = element('p', '', 'mining-currency-note'); status.setAttribute('role', 'status');
            const button = element('button', 'Review package', 'settings-action-btn');
            button.onclick = () => buy(pkg.apiData, pkg.isTeam ? (getMyTeamShares(pkg.id) || 0) + 1 : 1, status);
            card.append(button, status); host.append(card);
        }
    }
    async function autoBuy(pkg, kind) {
        const key = `${loggedInUser}_${kind}AutoBuy`;
        const readRule = () => JSON.parse(appStorage.getItem(key) || '{}')[pkg.name];
        let rule = readRule();
        if (!EasyMiningModel.automationReady(pkg.apiData, rule, Date.now(), easyMiningSettings.autoBuyCooldown !== false)) return;
        try {
            const team = kind === 'team';
            await syncNiceHashTime();
            const data = await request(team ? '/main/api/v2/hashpower/solo/shared/order?onlyGold=false&limit=100' : '/main/api/v2/public/solo/package?limit=100');
            const raw = (Array.isArray(data) ? data : data.list || []).find(p => p.id === pkg.apiData.id);
            rule = readRule();
            if (!raw || EasyMiningModel.alertName(raw) !== pkg.name || !EasyMiningModel.automationReady(raw, rule, Date.now(), easyMiningSettings.autoBuyCooldown !== false)) return;
            const fresh = { ...pkg, probabilityPrecision: raw.probabilityPrecision, mergeProbabilityPrecision: raw.mergeProbabilityPrecision,
                numberOfParticipants: raw.numberOfParticipants, shares: Number(raw.fullAmount) > 0 ? Number(raw.addedAmount) / Number(raw.fullAmount) * 100 : 0,
                lifeTimeTill: raw.lifeTimeTill };
            const matches = team ? await checkTeamRecommendations([fresh], metricPackages('single')) : await checkPackageRecommendations([fresh]);
            if (!matches.length) return;
            const t = ticket(raw), p = EasyMiningModel.payment(raw);
            if (team && !Array.isArray(raw.members)) throw new Error('Current team membership unavailable.');
            const member = team ? raw.members.find(m => m.organizationId === easyMiningSettings.orgId) : null;
            const owned = member ? EasyMiningModel.shareCount(member.addedAmount, p.shareAmount) : 0;
            const shares = Number(rule.shares ?? 1);
            if (team && (!Number.isSafeInteger(shares) || shares < 1 || owned === null)) throw new Error('Invalid share count.');
            const plan = EasyMiningModel.purchasePlan(raw, owned, owned + shares, getWithdrawalAddress(t.currencyAlgo.currency),
                t.mergeCurrencyAlgo ? getWithdrawalAddress(t.mergeCurrencyAlgo.currency) : null);
            await fetchNiceHashBalances();
            const balance = window.niceHashCurrencyBalances?.USDT;
            if (!balance || Date.now() - balance.fetchedAt > 30000 || !Number.isFinite(balance.available) || balance.available < plan.change) return;
            // The proxy refreshes cloud state before reserving this order; recheck the local rule too.
            if (!readRule()?.enabled) return;
            const result = EasyMiningModel.assertSuccessfulOrder(await request(plan.endpoint, 'POST', plan.body));
            const settings = JSON.parse(appStorage.getItem(key) || '{}');
            settings[pkg.name] = { ...settings[pkg.name], lastBuyTime: Date.now(), ...(team ? { lastPoolId: raw.id } : {}) };
            appStorage.setItem(key, JSON.stringify(settings));
            if (team) { setPendingShares(raw.id, owned + shares); saveMyTeamShares(raw.id, owned + shares); }
            const purchases = JSON.parse(appStorage.getItem(`${loggedInUser}_autoBoughtPackages`) || '{}');
            purchases[result.id || result.orderId || raw.id] = { type: kind, timestamp: Date.now(), paymentCurrency: 'USDT', paymentAmount: plan.change };
            appStorage.setItem(`${loggedInUser}_autoBoughtPackages`, JSON.stringify(purchases));
            await CloudAccount.flush();
        } catch (error) { console.error(`USDT auto-buy paused for ${pkg.name}:`, error.message); }
    }
    return { setCatalogue, selectTab, selectCurrency, render, blockReward, metricPackages, runAlerts, request };
})();
