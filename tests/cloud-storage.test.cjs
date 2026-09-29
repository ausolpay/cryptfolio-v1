const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createStorage } = require('../cloud-data.js');

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

async function device(database, owner) {
    const storage = createStorage();
    const status = { textContent: '', classList: { toggle() {} } };
    const context = {
        console, appStorage: storage, setInterval() {},
        navigator: { onLine: true }, location: { reload() {}, origin: 'https://test.invalid' },
        addEventListener() {}, alert() {},
        document: {
            hidden: false,
            getElementById: () => status,
            createElement: () => ({}),
            body: { appendChild(script) { script.onload(); } }
        },
        supabase: { createClient: () => ({
            auth: {
                getSession: async () => ({ data: { session: { user: { email: owner, user_metadata: {} } } } }),
                onAuthStateChange() {}
            },
            rpc: async (name, args) => {
                const saved = database.get(owner) || { version: 0, state: null };
                if (name === 'load_account_state') return { data: structuredClone(saved) };
                if (args.p_version !== saved.version) return { error: { code: 'PT409' } };
                const next = { version: saved.version + 1, state: structuredClone(args.p_state) };
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
    return { cloud: context.CloudAccount, storage, status };
}

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
