const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CloudData = require('../cloud-data.js');
const { createStorage } = CloudData;

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

async function device(database, owner, beforeSave = async () => {}) {
    const events = new Map(), requests = [];
    const storage = createStorage({}, () => events.get('app-data-changed')?.());
    const status = { textContent: '', classList: { toggle() {} } };
    const context = {
        console, CloudData, queueMicrotask, crypto: require('node:crypto').webcrypto, appStorage: storage, setInterval() {}, setTimeout() {},
        dispatchEvent() {}, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        navigator: { onLine: true }, location: { reload() {}, origin: 'https://test.invalid' },
        addEventListener(name, handler) { events.set(name, handler); }, alert() {},
        document: {
            hidden: false,
            addEventListener() {},
            getElementById: () => status,
            createElement: () => ({}),
            body: { classList: { remove() {} }, appendChild(element) { if (typeof element.onload === 'function') element.onload(); } }
        },
        supabase: { createClient: () => ({
            channel: () => ({ on() { return this; }, subscribe() {} }),
            auth: {
                getSession: async () => ({ data: { session: { user: { id: owner, email: owner, user_metadata: {} } } } }),
                onAuthStateChange() {}
            },
            rpc: async (name, args) => {
                if (name === 'claim_automation') return { data: true };
                if (name === 'get_account_access') return { data: { isAdmin: false, tier: 'free' } };
                let saved = database.get(owner) || { version: 0, state: null };
                if (name === 'load_account_state') return { data: structuredClone(saved) };
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
    return { cloud: context.CloudAccount, storage, status, events, requests };
}

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
