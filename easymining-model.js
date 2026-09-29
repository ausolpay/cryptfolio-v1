(function (root) {
    'use strict';
    const coinIds = { BTC: 'bitcoin', BCH: 'bitcoin-cash', LTC: 'litecoin', DOGE: 'dogecoin',
        RVN: 'ravencoin', KAS: 'kaspa', ZEC: 'zcash', USDT: 'tether' };
    function payment(raw, rates = {}) {
        const ticket = raw.currencyAlgoTicket || raw;
        const currency = ticket.currencyMarket;
        if (!['BTC', 'USDT'].includes(currency)) throw new Error('Unsupported package payment currency');
        const amount = Number(ticket.price);
        const shareAmount = Number(raw.minShareAmount ?? ticket.minShareAmount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid package price');
        const rate = Number(rates[currency]);
        const btcRate = Number(rates.BTC);
        const localAmount = Number.isFinite(rate) && rate > 0 ? amount * rate : null;
        const btcEquivalent = currency === 'BTC' ? amount :
            localAmount !== null && btcRate > 0 ? localAmount / btcRate : null;
        return { currency, amount, shareAmount: shareAmount > 0 ? shareAmount : null, localAmount, btcEquivalent };
    }
    function shareCount(amount, shareAmount) {
        if (!Number.isFinite(Number(amount)) || !(Number(shareAmount) > 0)) return null;
        return Math.round(Number(amount) / Number(shareAmount));
    }
    function bestSharePercent(pkg) {
        const value = pkg.fullOrderData?.soloMiningSharesMaxPercent ?? pkg.soloMiningSharesMaxPercent;
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }
    function orderPayment(order, amount, rates = {}) {
        const ticket = order.sharedTicket?.currencyAlgoTicket || order.currencyAlgoTicket || order.soloTicket || {};
        const currency = order.currencyMarket || ticket.currencyMarket || 'BTC';
        if (!['BTC', 'USDT'].includes(currency)) throw new Error('Unsupported order currency');
        amount = Number(amount);
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid order cost');
        const shareAmount = Number(order.sharedTicket?.minShareAmount ?? ticket.minShareAmount ?? (currency === 'BTC' ? 0.0001 : 0));
        const rate = Number(rates[currency]), btc = Number(rates.BTC);
        return { currency, amount, shareAmount: shareAmount > 0 ? shareAmount : null,
            localAmount: rate > 0 ? amount * rate : null,
            btcEquivalent: currency === 'BTC' ? amount : rate > 0 && btc > 0 ? amount * rate / btc : null };
    }
    function teamPreview(raw, owned, selected) {
        const p = payment(raw);
        if (!p.shareAmount) throw new Error('Share price unavailable');
        owned = Number(owned); selected = Number(selected);
        if (!Number.isSafeInteger(owned) || owned < 0 || !Number.isSafeInteger(selected) || selected < 1) throw new Error('Invalid share count');
        const bought = shareCount(raw.addedAmount, p.shareAmount), capacity = shareCount(raw.fullAmount, p.shareAmount);
        if (bought === null || capacity === null || bought < 0 || capacity < 1) throw new Error('Pool data unavailable');
        const others = Math.max(0, bought - owned), total = others + selected;
        return { bought, capacity, total, fraction: selected / total, max: Math.max(owned, capacity - others),
            amount: Number((selected * p.shareAmount).toFixed(8)), change: Number(((selected - owned) * p.shareAmount).toFixed(8)) };
    }
    function purchasePlan(raw, owned, selected, address, mergeAddress) {
        const p = payment(raw), ticket = raw.currencyAlgoTicket || raw;
        const team = Boolean(raw.currencyAlgoTicket);
        if (!ticket.available || ticket.status !== 'A' || !/^[0-9a-f-]{36}$/i.test(raw.id || '')) throw new Error('Package is unavailable');
        if (!address?.trim()) throw new Error('A reward address is required');
        const body = { soloMiningRewardAddr: address.trim() };
        if (ticket.mergeCurrencyAlgo && !mergeAddress?.trim()) throw new Error('A merge reward address is required');
        if (mergeAddress?.trim()) body.mergeSoloMiningRewardAddr = mergeAddress.trim();
        if (team) {
            const preview = teamPreview(raw, owned, selected);
            if (preview.change === 0 || selected > preview.max) throw new Error('Choose available shares to add or remove');
            if (raw.state !== 'OPEN') throw new Error('This pool no longer accepts share changes');
            body.amount = preview.amount;
            body.shares = { small: selected, medium: 0, large: 0, couponSmall: 0, couponMedium: 0, couponLarge: 0, massBuy: 0 };
            return { endpoint: `/main/api/v2/hashpower/shared/ticket/${raw.id}`, body, currency: p.currency, change: preview.change };
        }
        body.ticketId = raw.id; body.buyWithCurrency = p.currency;
        return { endpoint: '/main/api/v2/hashpower/solo/order', body, currency: p.currency, change: p.amount };
    }
    function probabilityPreview(denominator, liveShares, ownedShares, selectedShares) {
        const d = Number(denominator), live = Number(liveShares), owned = Number(ownedShares), selected = Number(selectedShares);
        if (![d, live, owned, selected].every(Number.isFinite) || d <= 1 || live <= 0 || owned < 0 || owned > live || selected < 1) return null;
        const projected = live - owned + selected;
        // NiceHash models at least one block with P = 1 - exp(-lambda).
        // Scale lambda by the projected hash-work, not the probability itself.
        const probability = -Math.expm1(Math.log1p(-1 / d) * projected / live);
        return { probability, denominator: 1 / probability, projectedShares: projected, liveProbability: 1 / d };
    }
    function packageIcon(raw) {
        try {
            const ticket = raw.currencyAlgoTicket || raw;
            const config = typeof ticket.configuration === 'string' ? JSON.parse(ticket.configuration) : ticket.configuration;
            const url = new URL(config.configuration.find(item => item.icon)?.icon);
            return url.protocol === 'https:' && url.hostname === 'static.nicehash.com' ? url.href : null;
        } catch { return null; }
    }
    function assertSuccessfulOrder(result) {
        if (!result || result.success === false || ['NOT_SUCCESSFUL', 'PARTIAL_SUCCESS'].includes(result.successType)) {
            throw new Error(result?.successType === 'PARTIAL_SUCCESS'
                ? 'NiceHash partially filled this order. Check your active packages before trying again.'
                : result?.message || 'NiceHash did not confirm the order. Check your active packages before trying again.');
        }
        if (!(result.success === true || result.successType === 'SUCCESSFUL' ||
              (typeof result.id === 'string' && result.id) || (typeof result.orderId === 'string' && result.orderId))) {
            throw new Error('NiceHash has not confirmed this order. Check your packages before trying again.');
        }
        return result;
    }
    const api = { coinIds, payment, shareCount, orderPayment, teamPreview, purchasePlan, probabilityPreview, packageIcon, assertSuccessfulOrder, bestSharePercent };
    if (typeof module !== 'undefined') module.exports = api;
    else root.EasyMiningModel = api;
})(typeof window === 'undefined' ? globalThis : window);
