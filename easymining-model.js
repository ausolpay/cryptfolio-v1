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
        return result;
    }
    const api = { coinIds, payment, shareCount, packageIcon, assertSuccessfulOrder };
    if (typeof module !== 'undefined') module.exports = api;
    else root.EasyMiningModel = api;
})(typeof window === 'undefined' ? globalThis : window);
