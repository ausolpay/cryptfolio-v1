(function (root) {
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    function evaluate(data) {
        if (!finite(data.change7d)) return null;
        const up = data.change7d >= 20, down = data.change7d <= -20;
        if (!up && !down) return null;
        const recovering = down && finite(data.change24h) && data.change24h > 0;
        const reasons = [`7 days: ${data.change7d.toFixed(1)}%`];
        if (finite(data.change24h)) reasons.push(`24 hours: ${data.change24h.toFixed(1)}%`);
        if (finite(data.change30d)) reasons.push(`30 days: ${data.change30d.toFixed(1)}%`);
        if (finite(data.rsi)) reasons.push(`Last available RSI: ${data.rsi.toFixed(0)}`);
        if (finite(data.weight)) reasons.push(`Tracked portfolio weight: ${data.weight.toFixed(1)}%`);
        let title = up ? 'Strong rally — review your plan' : recovering ? 'Early recovery — watch for confirmation' : 'Sharp decline — review downside risk';
        let guidance = up ? 'Review position size and any profit-taking targets you set. A strong rally alone does not establish the best time to sell.'
            : recovering ? 'A positive day after a weekly decline may be an early recovery, but it can also be a temporary bounce. Look for sustained strength before changing your plan.'
            : 'A lower price is not evidence of a bargain. Review the cause of the decline, your exposure and your maximum acceptable loss before adding.';
        if (finite(data.rsi) && (data.rsi >= 70 || data.rsi <= 30)) guidance += ' RSI is at an extreme; it can stay there during a strong trend.';
        if (data.weight >= 35) guidance += ' This coin is a large part of your tracked portfolio, so adding would increase concentration.';
        return { title, reasons, guidance, direction: up ? 'rally' : 'decline', band: Math.floor(Math.abs(data.change7d) / 10) * 10 };
    }
    if (typeof module !== 'undefined') { module.exports = { evaluate }; return; }
    let pending = [], dialog, dialogUser;
    function el(tag, text, cls) { const node = document.createElement(tag); node.textContent = text || ''; if (cls) node.className = cls; return node; }
    function showNext() {
        if (typeof loggedInUser === 'undefined' || !root.CloudAccount?.isReady) return;
        if (dialog?.open && dialogUser !== loggedInUser) dialog.close();
        pending = pending.filter(item => item.user === loggedInUser);
        if (!loggedInUser) return;
        if (!pending.length || document.hidden || dialog?.open || document.querySelector('dialog[open]') ||
            document.activeElement?.matches('input, textarea, select') ||
            [...document.querySelectorAll('.modal')].some(modal => getComputedStyle(modal).display !== 'none')) return;
        const item = pending.shift();
        if (!dialog) { dialog = el('dialog', '', 'market-alert-dialog'); document.body.append(dialog); }
        dialog.replaceChildren(el('small', 'PORTFOLIO WATCH'), el('h2', `${item.name} · ${item.title}`));
        const metrics = el('div', '', 'market-alert-metrics'); for (const reason of item.reasons) metrics.append(el('span', reason));
        dialog.append(metrics, el('p', item.guidance), el('small', 'Based on the latest loaded market snapshot. This is a review prompt, not a price forecast.'));
        const actions = el('div', '', 'market-alert-actions');
        const chart = el('button', 'Review chart'); chart.onclick = () => { dialog.close(); openCandlestickModal(item.cryptoId); };
        const close = el('button', 'Dismiss'); close.onclick = () => dialog.close();
        const snooze = el('button', 'Snooze popups for 24 hours'); snooze.onclick = () => {
            appStorage.setItem(`${loggedInUser}_marketPopupSnooze`, String(Date.now() + 86400000)); pending = []; dialog.close();
        };
        actions.append(chart, close, snooze); dialog.append(actions); dialogUser = loggedInUser; dialog.showModal();
    }
    async function observe(cryptoId, market) {
        if (!loggedInUser) return;
        const user = loggedInUser;
        const coins = users[user]?.cryptos || [];
        const coin = coins.find(item => item.id === cryptoId); if (!coin) return;
        const values = coins.map(item => (getPriceFromObject(cryptoPrices[item.id]) || 0) * getTotalActiveHoldings(item.id));
        const total = values.reduce((a, b) => a + b, 0), value = values[coins.indexOf(coin)];
        const item = evaluate({ ...market, rsi: getStoredRSI(cryptoId), weight: total > 0 ? value / total * 100 : null });
        if (!item) return;
        const day = new Date().toISOString().slice(0, 10);
        const key = `${user}_marketWatch_${cryptoId}_${item.direction}_${day}`;
        const prior = Number(appStorage.getItem(key) || 0);
        if (prior >= item.band) return;
        appStorage.setItem(key, String(item.band));
        const name = coin.name || coin.symbol || cryptoId;
        await AppNotifications.add(`${name}: ${item.title}`, [...item.reasons, item.guidance].join('\n'), 'market', `${cryptoId}:${item.direction}:${item.band}`);
        if (loggedInUser !== user || Number(appStorage.getItem(`${user}_marketPopupSnooze`)) > Date.now()) return;
        // Only the device holding the automation lease presents the popup; all devices see the inbox.
        await CloudAccount.runAutomation(async () => {
            if (loggedInUser !== user) return;
            if (!pending.some(entry => entry.cryptoId === cryptoId)) pending.push({ ...item, cryptoId, name, user });
            showNext();
        });
    }
    setInterval(showNext, 5000);
    root.MarketAlerts = { evaluate, observe };
})(typeof window === 'undefined' ? globalThis : window);
