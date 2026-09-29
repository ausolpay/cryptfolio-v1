const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../easymining-model.js');
test('USDT uses its actual live quote, never the BTC price or a fixed dollar peg', () => {
    const price = model.payment({ currencyMarket: 'USDT', price: 20 }, { BTC: 120000, USDT: 1.43 });
    assert.equal(price.localAmount, 28.599999999999998);
    assert.equal(price.btcEquivalent, price.localAmount / 120000);
    assert.equal(model.payment({ currencyMarket: 'USDT', price: 20 }).localAmount, null);
});
test('team share units come from the catalogue for either currency', () => {
    for (const [currency, unit] of [['BTC', 0.0001], ['USDT', 1]]) {
        const payment = model.payment({ minShareAmount: unit, currencyAlgoTicket: { currencyMarket: currency, price: 20 } });
        assert.equal(model.shareCount(unit * 17, payment.shareAmount), 17);
    }
    assert.throws(() => model.payment({ currencyMarket: 'OTHER', price: 20 }), /Unsupported/);
});
test('package artwork permits only official HTTPS assets', () => {
    const raw = icon => ({ configuration: JSON.stringify({ configuration: [{ icon }] }) });
    assert.equal(model.packageIcon(raw('https://static.nicehash.com/marketing%2FBronze-icon.png')), 'https://static.nicehash.com/marketing%2FBronze-icon.png');
    assert.equal(model.packageIcon(raw('https://other.invalid/icon.png')), null);
    assert.equal(model.packageIcon(raw('javascript:alert(1)')), null);
});
test('HTTP success does not turn a declined or partial mining order into a full purchase', () => {
    assert.throws(() => model.assertSuccessfulOrder({ success: false, message: 'Insufficient funds' }), /Insufficient/);
    assert.throws(() => model.assertSuccessfulOrder({ success: true, successType: 'PARTIAL_SUCCESS' }), /partially/);
    assert.deepEqual(model.assertSuccessfulOrder({ success: true, successType: 'SUCCESSFUL' }), { success: true, successType: 'SUCCESSFUL' });
});
