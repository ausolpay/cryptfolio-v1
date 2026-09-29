const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ai-overview.js'), 'utf8').replace('return { install, configure, observeMarket };', 'return { install, configure, api, checkDaily, generate, render, loadHistory };');
function setup(response) {
    const requests = [], writes = [], elements = new Map();
    const root = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, { classList: { toggle() {} }, replaceChildren() {}, setAttribute() {} }); return elements.get(selector); } };
    const context = { AbortSignal, setTimeout, clearTimeout, loggedInUser: 'owner', currentCryptoId: 'bitcoin', navigator: { onLine: true },
        users: { owner: { cryptos: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' }] } },
        cryptoPrices: { bitcoin: 12 }, cryptoPriceChanges: {}, storedOHLCDataPerCrypto: { bitcoin: [[1, 10, 14, 9, 12]] },
        getPriceFromObject: value => value, getTotalActiveHoldings: () => 2, getStoredRSI: () => 50, getCoinGeckoCurrency: () => 'aud',
        document: { hidden: false, getElementById: id => id === 'ai-portfolio' || id === 'ai-coin' ? root : null },
        appStorage: { getItem: key => key.endsWith('aiSettings') ? JSON.stringify({ enabled: true, provider: 'openai', apiKey: 'test' }) : null, snapshot: () => ({}), setItem: (...args) => writes.push(args) },
        CloudAccount: { isReady: true, flush: async () => {}, refresh: async () => {}, authorizedFetch: async (url, options) => { requests.push(JSON.parse(options.body)); return response; } }
    };
    vm.createContext(context); vm.runInContext(source + '\nglobalThis.ai = AIOverview;', context);
    return { context, requests, writes, elements };
}
test('plain text service errors show a readable message instead of a JSON parser exception', async () => {
    const { context } = setup({ ok: false, status: 504, json: async () => { throw new SyntaxError("Unexpected token A"); } });
    await assert.rejects(context.ai.api({ action: 'generate' }), /took too long/);
});

test('loading a saved overview with a newer pending record never claims to be generating', () => {
    const { context, elements } = setup({});
    const getElement = context.document.getElementById;
    context.document.getElementById = id => id === 'ai-coin' ? null : getElement(id);
    context.appStorage.snapshot = () => ({
        owner_ai_generation_done: JSON.stringify({ id: 'done', scope: 'portfolio', status: 'complete', text: 'Saved summary', createdAt: new Date(Date.now() - 60000).toISOString() }),
        owner_ai_generation_pending: JSON.stringify({ id: 'pending', scope: 'portfolio', status: 'pending', createdAt: new Date().toISOString() })
    });
    context.ai.render();
    assert.equal(elements.get('.ai-output').textContent, 'Saved summary');
    assert.equal(elements.get('.ai-status').textContent, '');
});
test('server-cached pending generations never overwrite Supabase from the browser', async () => {
    const { context, writes } = setup({ ok: true, json: async () => ({ reused: true, generation: { id: 'id', status: 'pending' } }) });
    await context.ai.api({ action: 'daily' }); assert.equal(writes.length, 0);
});
test('automatic check requests only portfolio scope; coin generation is explicitly manual with chart candles', async () => {
    const { context, requests } = setup({ ok: false, json: async () => ({ error: 'Test provider unavailable' }) });
    context.ai.checkDaily();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1); assert.equal(requests[0].action, 'daily'); assert.equal(requests[0].context.scope, 'portfolio');
    context.ai.checkDaily(); await new Promise(resolve => setImmediate(resolve)); assert.equal(requests.length, 1);
    await context.ai.generate('coin');
    assert.equal(requests[1].action, 'generate'); assert.equal(requests[1].context.scope, 'bitcoin');
    assert.deepEqual(requests[1].context.coins[0].chart.candles, [[1, 10, 14, 9, 12]]);
});
test('automatic summary waits for market data and does not run with AI disabled', async () => {
    const { context, requests } = setup({ ok: true, json: async () => ({}) });
    context.cryptoPrices = {}; context.ai.checkDaily();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(requests.length, 0);
    context.cryptoPrices = { bitcoin: 12 }; context.appStorage.getItem = () => '{}'; context.ai.checkDaily();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(requests.length, 0);
});
test('daily work cannot run during login and skips days already loaded from Supabase', async () => {
    const { context, requests } = setup({ ok: true, json: async () => ({}) });
    context.CloudAccount.isReady = false;
    context.ai.checkDaily(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 0);
    context.CloudAccount.isReady = true;
    const getItem = context.appStorage.getItem;
    context.appStorage.getItem = key => key.includes('_ai_daily_') ? '{"status":"complete"}' : getItem(key);
    context.ai.checkDaily(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 0);
});
test('saved portfolio summary without a daily marker prevents a false generating state on reload', async () => {
    for (const status of ['complete', 'pending', 'error']) {
        const { context, requests, elements } = setup({ ok: true, json: async () => ({}) });
        context.appStorage.snapshot = () => ({ owner_ai_generation_saved: JSON.stringify({ scope: 'portfolio', status, createdAt: new Date().toISOString(), text: 'Saved overview' }) });
        context.ai.checkDaily();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests.length, 0);
        assert.equal(elements.size, 0, 'must not enter the generating UI or collect news');
    }
});

test('completed server response renders and releases the button while background sync is unfinished', async () => {
    const { context, elements } = setup({ ok: true, json: async () => ({ generation: { id: 'new', scope: 'portfolio', status: 'complete', createdAt: new Date().toISOString(), text: 'Fresh saved analysis', model: 'test' } }) });
    // This test only renders the portfolio section.
    const getElement = context.document.getElementById;
    context.document.getElementById = id => id === 'ai-coin' ? null : getElement(id);
    let refreshStarted = false;
    context.CloudAccount.refresh = () => { refreshStarted = true; return new Promise(() => {}); };
    await Promise.race([context.ai.generate('portfolio'), new Promise((_, reject) => setTimeout(() => reject(new Error('Generation waited for background sync')), 100))]);
    assert.equal(refreshStarted, false, 'summary storage must not trigger a whole-account refresh');
    assert.equal(elements.get('.ai-output').textContent, 'Fresh saved analysis');
    assert.equal(elements.get('.ai-generate').disabled, false);
    assert.equal(elements.get('.ai-generate').textContent, 'Generate overview');
});

test('yesterday portfolio and today coin summaries do not suppress the morning portfolio run', async () => {
    const { context, requests } = setup({ ok: false, json: async () => ({ error: 'test' }) });
    context.appStorage.snapshot = () => ({
        owner_ai_generation_old: JSON.stringify({ scope: 'portfolio', status: 'complete', createdAt: new Date(Date.now() - 86400000).toISOString() }),
        owner_ai_generation_coin: JSON.stringify({ scope: 'bitcoin', status: 'complete', createdAt: new Date().toISOString() })
    });
    context.ai.checkDaily(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1); assert.equal(requests[0].action, 'daily');
});

test('manual analysis includes only this coin history and still works when online news is unavailable', async () => {
    const { context, requests } = setup({ ok: false, json: async () => ({ error: 'test' }) });
    context.window = { fetchAICoverage: async () => { throw new Error('News offline'); } };
    const read = context.appStorage.getItem;
    context.appStorage.getItem = key => key.endsWith('_holdingsHistory') ? JSON.stringify([
        { cryptoId: 'bitcoin', action: 'sell', amount: 1, soldPrice: 10, wallet: 'private' },
        { cryptoId: 'ethereum', action: 'sell', amount: 99 }
    ]) : key.endsWith('_holdingsEntries') ? JSON.stringify([{ amount: 2, boughtPrice: 8, source: 'manual' }]) : read(key);
    await context.ai.generate('coin');
    const history = requests[0].context.coins[0].history;
    assert.equal(history.eventCount, 1); assert.equal(history.purchaseEntryCount, 1);
    assert.equal(history.recent[0].amount, 1); assert.equal(history.recent[0].currency, null);
    assert.equal(history.recent[0].wallet, undefined);
});

test('portfolio generation bypasses a stuck cloud flush and sends a compact snapshot with fresh news', async () => {
    const { context, requests } = setup({ ok: true, json: async () => ({}) });
    context.CloudAccount.flush = () => new Promise(() => {});
    context.window = { fetchAICoverage: async (id, symbol, options) => {
        assert.equal(options.headlinesOnly, true);
        return { checkedAt: new Date().toISOString(), articles: [
            { title: 'Recent protocol upgrade', published_on: Date.now() / 1000, source: 'Publisher', url: 'https://example.com/recent' },
            { title: 'Old report', published_on: (Date.now() - 8 * 86400000) / 1000 }
        ] };
    } };
    await Promise.race([context.ai.generate('portfolio'), new Promise((_, reject) => setTimeout(() => reject(new Error('Waited for unrelated cloud sync')), 100))]);
    assert.equal(requests.length, 1);
    const coin = requests[0].context.coins[0];
    assert.equal(coin.history, undefined); assert.equal(coin.chart, undefined);
    assert.equal(coin.headlines.length, 1); assert.equal(coin.headlines[0].title, 'Recent protocol upgrade');
});

test('a never-ending news request reaches its deadline and still generates a portfolio summary', async () => {
    const { context, requests, elements } = setup({ ok: true, json: async () => ({}) });
    context.window = { fetchAICoverage: () => new Promise(() => {}) };
    let deadline;
    context.setTimeout = (callback, ms) => { deadline = ms; return setTimeout(callback, 0); };
    await context.ai.generate('portfolio');
    assert.equal(deadline, 6000); assert.equal(requests.length, 1);
    assert.equal(elements.get('.ai-generate').disabled, false);
});

test('completed output survives a server-save failure without waiting for browser recovery sync', async () => {
    const { context, requests } = setup({ ok: false, json: async () => ({ generation: { id: 'done', status: 'complete', text: 'Saved locally' } }) });
    context.CloudAccount.flush = () => new Promise(() => {});
    const result = await context.ai.api({ action: 'generate' });
    assert.equal(result.generation.text, 'Saved locally'); assert.equal(requests.length, 1);
});

test('separate saved summary history renders after reload and prevents another daily billable request', async () => {
    const { context, requests, writes, elements } = setup({ ok: true, json: async () => ({ generations: [{
        id: 'saved', scope: 'portfolio', status: 'complete', createdAt: new Date().toISOString(), text: 'Cloud saved brief'
    }] }) });
    const getElement = context.document.getElementById;
    context.document.getElementById = id => id === 'ai-coin' ? null : getElement(id);
    await context.ai.loadHistory();
    context.ai.checkDaily(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1); assert.equal(requests[0].action, 'history');
    assert.equal(writes.length, 0); assert.equal(elements.get('.ai-output').textContent, 'Cloud saved brief');
});
