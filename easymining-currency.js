/* USDT catalogue is isolated from legacy BTC automation and its saved thresholds. */
const EasyMiningCurrency = (() => {
    const catalogue = { single: [], team: [] };
    let tab = 'single';
    const key = () => `${loggedInUser}_miningPayment_${tab}`;
    const selected = () => appStorage.getItem(key()) === 'USDT' ? 'USDT' : 'BTC';
    const ticket = raw => raw.currencyAlgoTicket || raw;
    function setCatalogue(kind, items) {
        catalogue[kind] = Array.isArray(items) ? items : [];
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
        if (!usdt || root.contains(document.activeElement)) return;
        root.replaceChildren();
        root.append(element('p', 'Paid in USDT • Rewards stay in the mined coin. USDT purchases currently open in NiceHash. BTC automation settings apply only to BTC packages.', 'mining-currency-note'));
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
            const button = element('a', 'Open in NiceHash', 'settings-save-btn');
            button.href = 'https://www.nicehash.com/my/easymining';
            button.target = '_blank'; button.rel = 'noopener noreferrer';
            card.append(button); grid.append(card);
        }
    }
    window.addEventListener('cloud-data-loaded', render);
    return { setCatalogue, selectTab, selectCurrency, render };
})();
