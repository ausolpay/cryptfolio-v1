const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../easymining-model.js');
const vm = require('node:vm');
const fs = require('node:fs');
test('probability preview scales Poisson work, not chance or personal reward share', () => {
    const unchanged = model.probabilityPreview(4, 4, 1, 1);
    assert.ok(Math.abs(unchanged.probability - .25) < 1e-12);
    const doubled = model.probabilityPreview(4, 4, 1, 5);
    assert.equal(doubled.projectedShares, 8);
    assert.ok(Math.abs(doubled.probability - .4375) < 1e-12);
    const removed = model.probabilityPreview(4, 4, 3, 1);
    assert.ok(Math.abs(removed.probability - (1 - Math.sqrt(.75))) < 1e-12);
});
test('fresh provider odds affect preview and rounded or empty baselines are not guessed', () => {
    assert.notEqual(model.probabilityPreview(242.8, 4, 1, 2).probability, model.probabilityPreview(250.3, 4, 1, 2).probability);
    assert.equal(model.probabilityPreview(1, 4, 1, 2), null);
    assert.equal(model.probabilityPreview(20, 0, 0, 2), null);
    assert.equal(model.probabilityPreview(20, 4, 5, 2), null);
    assert.ok(model.probabilityPreview(1.1, 4, 1, 200).probability <= 1);
});
test('USDT order costs and shares retain native units while legacy aggregates receive BTC equivalents', () => {
    const order = { currencyMarket: 'USDT', sharedTicket: { minShareAmount: 1 } };
    const cost = model.orderPayment(order, 5, { BTC: 100000, USDT: 1.5 });
    assert.equal(cost.amount, 5); assert.equal(cost.localAmount, 7.5);
    assert.equal(cost.btcEquivalent, .000075); assert.equal(model.shareCount(5, cost.shareAmount), 5);
    assert.equal(model.orderPayment(order, 5).btcEquivalent, null);
    assert.equal(model.orderPayment({ currencyMarket: 'BTC' }, .001).btcEquivalent, .001);
});
test('purchase plans explicitly pay USDT and use total shares for team changes', () => {
    const solo = { id: '12345678-1234-1234-1234-123456789abc', available: true, status: 'A', currencyMarket: 'USDT', price: 20 };
    assert.equal(model.purchasePlan(solo, 0, 1, 'reward-address').body.buyWithCurrency, 'USDT');
    const team = { id: solo.id, state: 'OPEN', currencyAlgoTicket: { ...solo, minShareAmount: 1 }, addedAmount: 4, fullAmount: 100 };
    const plan = model.purchasePlan(team, 1, 2, 'reward-address');
    assert.equal(plan.body.amount, 2); assert.equal(plan.body.shares.small, 2); assert.equal(plan.change, 1);
    assert.equal(model.teamPreview(team, 1, 2).fraction, 2 / 5);
    assert.throws(() => model.purchasePlan(team, 1, 200, 'reward-address'), /available shares/);
    assert.throws(() => model.purchasePlan({ ...team, state: 'RUNNING' }, 1, 2, 'reward-address'), /no longer/);
});
test('rapid share taps share one live refresh and the response renders the latest selection', async () => {
    let calls = 0, finish;
    const raw = { id: 'pool', addedAmount: 4, minShareAmount: 1, probabilityPrecision: 4, currencyAlgoTicket: { currencyAlgo: { currency: 'BTC' } } };
    const input = { value: '1', closest: () => card };
    const card = { isConnected: true, children: [], append(el) { this.children.push(el); },
        querySelector(selector) { return selector === '.share-adjuster-input' ? input : this.children.find(el => el.className === 'team-probability-preview'); } };
    const context = { queueMicrotask, EasyMiningModel: model, getMyTeamShares: () => 1, VERCEL_PROXY_ENDPOINT: '/api/nicehash',
        document: { createElement: () => ({ children: [], setAttribute() {}, append(el) { this.children.push(el); }, replaceChildren() { this.children = []; } }) },
        CloudAccount: { proxyFetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } };
    context.EasyMiningCurrency = { setCatalogue: (_, items) => context.preview.setCatalogue(items) };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../team-probability.js'), 'utf8') + '\nglobalThis.preview = TeamProbability;', context);
    context.preview.bind(card, { apiData: raw }); await Promise.resolve();
    input.value = '2'; context.preview.changed(input);
    input.value = '3'; context.preview.changed(input);
    assert.equal(calls, 1);
    finish({ ok: true, json: async () => ({ list: [{ ...raw, probabilityPrecision: 5 }] }) });
    await context.preview.refresh();
    const row = card.children[0].children[0].textContent;
    assert.match(row, /live 1:5/);
    assert.match(row, /28.45%/);
    assert.equal(input.value, '3');
});
