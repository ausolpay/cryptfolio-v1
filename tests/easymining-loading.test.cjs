const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../scripts.js'), 'utf8');

function load(name, context) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    assert.ok(start >= 0 && end > start);
    vm.runInContext((source.slice(start - 6, start) === 'async ' ? 'async ' : '') + source.slice(start, end), context);
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup() {
    const balances = deferred();
    const orders = deferred();
    const preload = deferred();
    const calls = [];
    const elements = Object.fromEntries(['easymining-loading-bar', 'easymining-section', 'easymining-loading-progress'].map(id => [id, { style: {} }]));
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        document: { getElementById: id => elements[id] },
        setInterval: () => 1, clearInterval() {},
        Math: { random: () => 0.5 },
        isFirstEasyMiningLoad: true, isFetchingEasyMiningData: false,
        loadingProgressInterval: null, currentProgress: 0, targetProgress: 0,
        easyMiningSettings: { enabled: true, apiKey: 'key', apiSecret: 'secret', orgId: 'org' },
        easyMiningData: { activePackages: [{ id: 'saved' }] },
        loggedInUser: 'test', savedPackageProbabilities: {}, currentDetailPackage: null,
        validateNiceHashCredentials: () => true,
        syncNiceHashTime: async () => { calls.push('sync'); },
        fetchNiceHashBalances: () => { calls.push('balances'); return balances.promise; },
        fetchNiceHashOrders: () => { calls.push('orders'); return orders.promise; },
        setStorageItem() {}, fetchPublicPackageData: async () => {},
        updateEasyMiningUI: () => { calls.push('render'); },
        autoAddCryptoBoxesForActivePackages: async () => {},
        loadBuyPackagesDataOnPage: () => { calls.push('preload'); return preload.promise; },
        scheduleEasyMiningErrorAlert: () => { calls.push('error'); }
    });
    for (const name of ['verifyUniquePackageData', 'collectChartDataForAllPackages', 'syncCountdownsWithApiData', 'checkForNewBlocks', 'checkForPackageStatusChanges', 'checkAutoClearActiveShares', 'checkRewardAndBail', 'updateBTCHoldings', 'fixMissingBoughtPrices', 'recalculateAddedToday', 'clearEasyMiningErrorAlert']) context[name] = () => {};
    for (const name of ['showEasyMiningLoadingBar', 'hideEasyMiningLoadingBar', 'updateEasyMiningLoadingProgress', 'setEasyMiningLoadingTarget', 'fetchEasyMiningData']) load(name, context);
    return { context, balances, orders, preload, calls, elements };
}

test('fresh mining data is revealed without waiting for catalogue preloading or animation', async () => {
    const app = setup();
    const fetch = app.context.fetchEasyMiningData();
    await tick();
    assert.deepEqual(app.calls, ['sync', 'balances', 'orders']);
    app.balances.resolve({ available: 1, pending: 0.25 });
    app.orders.resolve([{ id: 'live', name: 'Bronze' }]);
    await fetch;
    assert.equal(app.elements['easymining-section'].style.display, 'block');
    assert.equal(app.elements['easymining-loading-bar'].style.display, 'none');
    assert.equal(app.context.easyMiningData.availableBTC, '1.00000000');
    assert.equal(app.context.easyMiningData.activePackages[0].id, 'live');
    assert.ok(app.calls.indexOf('render') < app.calls.indexOf('preload'));
    assert.equal(app.context.isFetchingEasyMiningData, false);
    assert.equal(app.context.loadingProgressInterval, null);
    // A failed optional preload must not turn a successful refresh into an error.
    app.preload.reject(new Error('Catalogue offline'));
    await tick();
    assert.ok(!app.calls.includes('error'));
});

test('a failed read retains saved data and waits for the other read before allowing another poll', async () => {
    const app = setup();
    const fetch = app.context.fetchEasyMiningData();
    await tick();
    app.balances.reject(new Error('API Error: 503'));
    await tick();
    assert.equal(app.context.isFetchingEasyMiningData, true);
    await app.context.fetchEasyMiningData();
    assert.equal(app.calls.filter(call => call === 'orders').length, 1);
    app.orders.resolve([]);
    await fetch;
    assert.equal(app.context.isFetchingEasyMiningData, false);
    assert.equal(app.context.easyMiningData.activePackages[0].id, 'saved');
    assert.ok(!app.calls.includes('preload'));
    assert.ok(app.calls.includes('error'));
});

test('active, reward and completed order lists start together', async () => {
    const reads = [deferred(), deferred(), deferred()];
    const filters = [];
    const context = vm.createContext({
        console: { log() {}, warn() {}, error() {} },
        savedPackageProbabilities: { saved: 1 },
        NiceHashOrderCache: { list: filter => { filters.push(filter); return reads[filters.length - 1].promise; } }
    });
    load('fetchNiceHashOrders', context);
    const fetch = context.fetchNiceHashOrders();
    assert.deepEqual(filters, ['active=true', 'rewardsOnly=true', 'status=COMPLETED']);
    // End the refresh through its existing error path after checking dispatch.
    reads[0].reject(new Error('offline'));
    reads[1].resolve([]);
    reads[2].resolve([]);
    await assert.rejects(fetch, /offline/);
});
