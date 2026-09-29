/* USDT catalogue is isolated from legacy BTC automation and its saved thresholds. */
const EasyMiningCurrency = (() => {
    const catalogue = { single: [], team: [] };
    const selections = new Map();
    let buying = false;
    let tab = 'single';
    const key = () => `${loggedInUser}_miningPayment_${tab}`;
    const selected = () => appStorage.getItem(key()) === 'USDT' ? 'USDT' : 'BTC';
    const ticket = raw => raw.currencyAlgoTicket || raw;
    function setCatalogue(kind, items) {
        catalogue[kind] = Array.isArray(items) ? items : [];
        if (kind === 'team') TeamProbability.setCatalogue(catalogue[kind]);
        render();
    }
    function selectTab(value) { tab = value === 'team' ? 'team' : 'single'; render(); }
    function selectCurrency(value) {
        appStorage.setItem(key(), value === 'USDT' ? 'USDT' : 'BTC');
        render();
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
        root.append(element('p', 'Paid in USDT • Rewards stay in the mined coin. BTC automation settings apply only to BTC packages.', 'mining-currency-note'));
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
    return { setCatalogue, selectTab, selectCurrency, render };
})();
