const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CloudData = require('../cloud-data.js');
const { createStorage } = CloudData;

test('concurrent AI news and market refreshes keep the freshest whole snapshot without pausing sync', () => {
    for (const [key, field] of [['owner_freeNews_bitcoin_btc', 'checkedAt'], ['owner_ai_market_bitcoin', 'observedAt']]) {
        const old = JSON.stringify({ [field]: '2026-09-29T00:00:00Z', articles: ['old'], price: 1 });
        const newer = JSON.stringify({ [field]: '2026-09-29T01:00:00Z', articles: ['new'], price: 2 });
        const merged = CloudData.mergeRecords({}, { [key]: newer }, { [key]: old });
        assert.deepEqual(merged.conflicts, []);
        assert.equal(merged.records[key], newer);
    }
});

test('AI completion cannot be regressed by a pending record from another device', () => {
    const key = 'owner_ai_generation_id';
    const done = JSON.stringify({ id: 'id', status: 'complete', text: 'Saved' });
    const pending = JSON.stringify({ id: 'id', status: 'pending' });
    for (const [local, remote] of [[done, pending], [pending, done]]) {
        const result = CloudData.mergeRecords({}, { [key]: local }, { [key]: remote });
        assert.deepEqual(result.conflicts, []); assert.equal(result.records[key], done);
    }
    assert.deepEqual(CloudData.mergeRecords({}, { owner_holdingsHistory: '[1]' }, { owner_holdingsHistory: '[2]' }).conflicts, ['owner_holdingsHistory']);
});

test('all settings, histories and API credentials round-trip through the working copy', () => {
    let changes = 0;
    const first = createStorage({}, () => changes++);
    first.setItem('user_easyMiningSettings', JSON.stringify({ apiKey: 'test-key', apiSecret: 'test-secret', enabled: true }));
    first.setItem('user_holdingsHistory', JSON.stringify([{ action: 'sell', amount: 2 }]));
    first.setItem('theme', 'dark');
    const second = createStorage(JSON.parse(JSON.stringify(first.snapshot())));
    assert.deepEqual(second.snapshot(), first.snapshot());
    assert.equal(changes, 3);
    assert.equal(createStorage().getItem('theme'), null, 'fresh browser state has no persistent app data');
});

async function device(database, owner, beforeSave = async () => {}, startupError = null, hooks = {}) {
    const events = new Map(), requests = [];
    const appended = [], bodyClasses = new Set();
    const noticeText = { textContent: '' };
    const loadNotice = { hidden: true, querySelector: () => noticeText };
    const storage = createStorage({}, () => events.get('app-data-changed')?.());
    const status = { textContent: '', classList: { toggle() {} } };
    const context = {
        console, CloudData, queueMicrotask, crypto: require('node:crypto').webcrypto, appStorage: storage,
        Date: class extends Date { static now() { return hooks.now ?? Date.now(); } },
        setInterval(fn, ms) { if (ms === 1000) hooks.autosave = fn; }, setTimeout() {}, clearTimeout() {},
        dispatchEvent() {}, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        navigator: { onLine: true }, location: { reload() {}, origin: 'https://test.invalid' },
        addEventListener(name, handler) { events.set(name, handler); }, alert() {},
        document: {
            hidden: false,
            addEventListener() {},
            getElementById: id => id === 'cloud-load-error' ? loadNotice : status,
            createElement: () => ({}),
            body: { classList: { remove(name) { bodyClasses.delete(name); }, add(name) { bodyClasses.add(name); } }, appendChild(element) { appended.push(element); if (typeof element.onload === 'function') element.onload(); } }
        },
        supabase: { createClient: () => ({
            channel: () => ({ on(event, filter, callback) { hooks.notify = callback; return this; }, subscribe(callback) { hooks.subscribe = callback; } }),
            from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() {
                await hooks.beforeRevision?.();
                return { data: { version: database.get(owner)?.version || 0 } };
            } }),
            auth: {
                getSession: async () => ({ data: { session: { user: { id: owner, email: owner, user_metadata: {} } } } }),
                onAuthStateChange() {}
            },
            rpc: async (name, args) => {
                if (name === 'claim_automation') { await hooks.beforeLease?.(); return { data: true }; }
                if (name === 'get_account_access') return { data: { isAdmin: false, tier: 'free' } };
                let saved = database.get(owner) || { version: 0, state: null };
                if (name === 'load_account_state') {
                    const data = structuredClone(saved);
                    await hooks.beforeLoad?.();
                    return startupError ? { error: startupError } : { data };
                }
                requests.push(structuredClone(args));
                await beforeSave(args);
                saved = database.get(owner) || { version: 0, state: null };
                if (args.p_version !== saved.version) return { error: { code: 'PT409' } };
        const records = { ...saved.state?.records, ...structuredClone(args.p_records) };
        for (const key of args.p_removed) delete records[key];
        const next = { version: saved.version + 1, state: { schema: 1, records } };
                database.set(owner, next);
                return { data: next.version };
            }
        }) }
    };
    context.window = context;
    vm.createContext(context);
    const source = fs.readFileSync(require('node:path').join(__dirname, '../cloud-account.js'), 'utf8');
    vm.runInContext(source.replace('CloudAccount.start();', 'window.started = CloudAccount.start();'), context);
    await context.started;
    return { cloud: context.CloudAccount, storage, status, events, requests, appended, bodyClasses, loadNotice, noticeText };
}

test('startup failure places its retry notice outside the hidden unhydrated app', async () => {
    const first = await device(new Map(), 'load@example.test', undefined, { message: 'Database connection unavailable' });
    assert.ok(first.appended.includes(first.loadNotice));
    assert.equal(first.loadNotice.hidden, false);
    assert.equal(first.noticeText.textContent, 'Database connection unavailable');
    assert.ok(first.bodyClasses.has('auth-load-failed'));
    assert.equal(first.appended.some(element => element.src === 'scripts.js'), false);
    assert.deepEqual(first.storage.snapshot(), {}, 'failed hydration must not create an empty replacement account');
});

test('edits auto-save without a timer and only changed records are uploaded', async () => {
    const database = new Map();
    const first = await device(database, 'auto@example.test');
    first.storage.setItem('largeHistory', 'x'.repeat(200000));
    await first.cloud.flush();
    first.storage.setItem('theme', 'light');
    await new Promise(setImmediate);
    assert.equal(database.get('auto@example.test').state.records.theme, 'light');
    assert.deepEqual(first.requests.at(-1).p_records, { theme: 'light' });
    first.storage.removeItem('theme');
    await new Promise(setImmediate);
    assert.equal(database.get('auto@example.test').state.records.theme, undefined);
    assert.equal(first.events.has('beforeunload'), false);
    assert.match(first.status.textContent, /^Last synced /);
});

test('an edit arriving during a save is drained immediately without losing either edit', async () => {
    const database = new Map();
    let release;
    const first = await device(database, 'flight@example.test', args =>
        args.p_records.first ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    first.storage.setItem('first', '1');
    await new Promise(setImmediate);
    first.storage.setItem('second', '2');
    release();
    await first.cloud.flush();
    assert.equal(database.get('flight@example.test').state.records.first, '1');
    assert.equal(database.get('flight@example.test').state.records.second, '2');
});

test('a second device loads the full saved account from the server', async () => {
    const database = new Map();
    const first = await device(database, 'one@example.test');
    first.storage.setItem('one@example.test_nicehash', JSON.stringify({ apiSecret: 'test-only' }));
    first.storage.setItem('one@example.test_notifications', '[{"id":"notice"}]');
    await first.cloud.flush();
    const second = await device(database, 'one@example.test');
    assert.deepEqual(second.storage.snapshot(), first.storage.snapshot());
    const other = await device(database, 'two@example.test');
    assert.equal(other.storage.getItem('one@example.test_nicehash'), null);
});

test('stale device writes preserve the newer cloud copy and local unsaved changes', async () => {
    const database = new Map();
    const first = await device(database, 'one@example.test');
    const second = await device(database, 'one@example.test');
    first.storage.setItem('holdings', '12');
    await first.cloud.flush();
    second.storage.setItem('holdings', '99');
    await assert.rejects(second.cloud.flush());
    assert.equal(database.get('one@example.test').state.records.holdings, '12');
    assert.equal(second.storage.getItem('holdings'), '99');
    assert.equal(second.cloud.canPurchase, false);
    await assert.rejects(second.cloud.flush(), /sync is paused/);
});

test('database object key ordering does not create spurious saves', async () => {
    const database = new Map();
    const first = await device(database, 'one@example.test');
    first.storage.setItem('z', 'last');
    first.storage.setItem('a', 'first');
    await first.cloud.flush();
    const saved = database.get('one@example.test');
    saved.state.records = Object.fromEntries(Object.entries(saved.state.records).reverse());
    const version = saved.version;
    const second = await device(database, 'one@example.test');
    await second.cloud.flush();
    assert.equal(database.get('one@example.test').version, version);
});

test('main app has no persistent browser-storage fallback or plaintext password field', () => {
    const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts.js'), 'utf8');
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b/);
    assert.doesNotMatch(source, /users\[[^\]]+\]\.password/);
});

test('a live device refresh receives holdings and auto-buy settings without reloading', async () => {
    const database = new Map();
    const first = await device(database, 'one@example.test');
    const second = await device(database, 'one@example.test');
    first.storage.setItem('one@example.test_bitcoin_holdingsEntries', '[{"id":"buy1","amount":2}]');
    first.storage.setItem('one@example.test_soloAutoBuy', '{"Bronze":{"enabled":true}}');
    await first.cloud.flush();
    await second.cloud.refresh();
    assert.deepEqual(second.storage.snapshot(), first.storage.snapshot());
});

test('simultaneous independent settings edits merge and are durably saved', async () => {
    const database = new Map();
    const first = await device(database, 'one@example.test');
    const second = await device(database, 'one@example.test');
    first.storage.setItem('theme', 'dark');
    second.storage.setItem('sound', 'off');
    await first.cloud.flush();
    await second.cloud.flush();
    assert.equal(database.get('one@example.test').state.records.theme, 'dark');
    assert.equal(database.get('one@example.test').state.records.sound, 'off');
});

test('settings merge separately, while conflicting financial arrays require resolution', () => {
    const base = { settings: '{"btc":true,"usdt":false}' };
    const merged = CloudData.mergeRecords(base, { settings: '{"btc":false,"usdt":false}' }, { settings: '{"btc":true,"usdt":true}' });
    assert.deepEqual(JSON.parse(merged.records.settings), { btc: false, usdt: true });
    assert.equal(CloudData.mergeRecords({ holdings: '[]' }, { holdings: '[1]' }, { holdings: '[2]' }).conflicts.length, 1);
});
test('hydrated app becomes ready while startup save is still pending', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const database = new Map();
    let timer;
    try {
        const first = await Promise.race([
            device(database, 'startup@example.test', () => gate),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Login waited for background save')), 250); })
        ]);
        assert.equal(first.cloud.isReady, true);
        assert.equal(first.storage.getItem('loggedInUser'), 'startup@example.test');
        assert.equal(database.has('startup@example.test'), false);
        release(); await first.cloud.flush();
        assert.equal(database.has('startup@example.test'), true);
    } finally { release(); clearTimeout(timer); }
});

test('concurrent refreshes share one full account download', async () => {
    const hooks = {}, first = await device(new Map(), 'refresh@example.test', undefined, null, hooks);
    await first.cloud.flush();
    let release, loads = 0;
    hooks.beforeLoad = () => { loads++; return new Promise(resolve => { release = resolve; }); };
    const requests = [first.cloud.refresh(), first.cloud.refresh(), first.cloud.refresh()];
    await new Promise(setImmediate);
    release();
    await Promise.all(requests);
    assert.equal(loads, 1);
});

test('a genuinely newer realtime revision arriving during a load is not missed', async () => {
    const database = new Map(), hooks = {}, owner = 'revisions@example.test';
    const first = await device(database, owner, undefined, null, hooks);
    await first.cloud.flush();
    let release, loads = 0;
    hooks.beforeLoad = () => { if (++loads === 1) return new Promise(resolve => { release = resolve; }); };
    const pending = first.cloud.refresh();
    await new Promise(setImmediate);
    const saved = database.get(owner);
    saved.version++;
    saved.state.records.theme = 'new remote theme';
    hooks.notify({ new: { version: saved.version } });
    release(); await pending;
    assert.equal(loads, 2);
    assert.equal(first.storage.getItem('theme'), 'new remote theme');
});

test('realtime reconnect and repeated online events share a revision check without redownloading unchanged data', async () => {
    const hooks = {}, first = await device(new Map(), 'poll@example.test', undefined, null, hooks);
    await first.cloud.flush();
    let release, checks = 0, loads = 0;
    hooks.beforeLoad = () => { loads++; };
    hooks.beforeRevision = () => { checks++; return new Promise(resolve => { release = resolve; }); };
    hooks.subscribe('SUBSCRIBED');
    first.events.get('online')(); first.events.get('online')();
    assert.equal(checks, 1);
    release(); await new Promise(setImmediate);
    assert.equal(loads, 0);
});

test('automation lease checks cannot pile up while Supabase is slow', async () => {
    const hooks = {}, first = await device(new Map(), 'lease@example.test', undefined, null, hooks);
    await first.cloud.flush(); await new Promise(setImmediate);
    let release, checks = 0;
    hooks.beforeLease = () => { checks++; return new Promise(resolve => { release = resolve; }); };
    const pending = [first.cloud.ensureAutomation(), first.cloud.ensureAutomation()];
    assert.equal(checks, 1);
    release(); await Promise.all(pending);
});

test('market ticks are batched, while holdings edits and explicit saves remain immediate', async () => {
    const hooks = { now: 100000 }, database = new Map();
    const first = await device(database, 'batch@example.test', undefined, null, hooks);
    await first.cloud.flush();
    const initial = first.requests.length;
    for (let tick = 0; tick < 10; tick++) {
        first.storage.setItem('owner_displayValue', String(tick));
        hooks.autosave();
        await new Promise(setImmediate);
    }
    assert.equal(first.requests.length, initial);
    hooks.now += 30000;
    hooks.autosave(); await new Promise(setImmediate);
    assert.equal(first.requests.length, initial + 1);
    assert.equal(database.get('batch@example.test').state.records.owner_displayValue, '9');
    first.storage.setItem('owner_holdingsEntries', '[{"amount":2}]');
    await new Promise(setImmediate);
    assert.equal(first.requests.length, initial + 2);
    first.storage.setItem('owner_displayValue', '12');
    await first.cloud.flush();
    assert.equal(database.get('batch@example.test').state.records.owner_displayValue, '12');
});

test('failed autosaves back off without losing edits, and manual retry can recover immediately', async () => {
    const hooks = { now: 100000 }, database = new Map();
    let fail = false;
    const first = await device(database, 'backoff@example.test', async () => {
        if (fail) throw new Error('Database unavailable');
    }, null, hooks);
    await first.cloud.flush();
    fail = true;
    first.storage.setItem('theme', 'dark');
    await new Promise(setImmediate);
    const failedCount = first.requests.length;
    for (let i = 0; i < 10; i++) { hooks.autosave(); await new Promise(setImmediate); }
    assert.equal(first.requests.length, failedCount);
    assert.equal(first.storage.getItem('theme'), 'dark');
    hooks.now += 2000;
    hooks.autosave(); await new Promise(setImmediate);
    assert.equal(first.requests.length, failedCount + 1);
    hooks.now += 2000;
    hooks.autosave(); await new Promise(setImmediate);
    assert.equal(first.requests.length, failedCount + 1, 'second failure has a longer retry delay');
    fail = false;
    await first.cloud.retry();
    assert.equal(database.get('backoff@example.test').state.records.theme, 'dark');
});
