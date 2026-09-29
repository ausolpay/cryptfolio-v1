const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../auth-storage.js');
function database() {
    const values = new Map();
    return { get: async key => values.get(key), put: async (key, value) => { values.set(key, value); } };
}
function sessionStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
test('unchecked stay signed in survives a reload but not a new browser session', async () => {
    const db = database(); const tab = sessionStorage();
    const first = createStorage(db, () => null, () => tab);
    await first.setItem('auth', 'previously-remembered');
    first.setPersistence(false);
    await first.setItem('auth', 'temporary-session');
    assert.equal(await createStorage(db, () => null, () => tab).getItem('auth'), 'temporary-session');
    assert.equal(await createStorage(db, () => null, () => sessionStorage()).getItem('auth'), null);
});
test('checked stay signed in restores a session after browser restart', async () => {
    const db = database();
    const first = createStorage(db, () => null, () => sessionStorage());
    first.setPersistence(true);
    await first.setItem('auth', 'remembered-session');
    assert.equal(await createStorage(db, () => null, () => sessionStorage()).getItem('auth'), 'remembered-session');
});
test('sign-in succeeds with full localStorage and is readable by another session', async () => {
    const db = database();
    const legacy = () => ({ getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }, removeItem() {} });
    await createStorage(db, legacy).setItem('auth', 'test-session');
    assert.equal(await createStorage(db, legacy).getItem('auth'), 'test-session');
});
test('existing token migrates without deleting unrelated portfolio storage', async () => {
    const values = new Map([['auth', 'existing-session'], ['portfolio', 'old-data']]);
    const storage = createStorage(database(), () => ({ getItem: key => values.get(key), removeItem: key => values.delete(key) }));
    assert.equal(await storage.getItem('auth'), 'existing-session');
    assert.deepEqual([...values], [['portfolio', 'old-data']]);
});
test('sign-out stays signed out even if legacy storage cannot be cleared', async () => {
    const storage = createStorage(database(), () => ({ getItem: () => 'old-session', removeItem() { throw new Error('Denied'); } }));
    await storage.removeItem('auth');
    assert.equal(await storage.getItem('auth'), null);
});
test('failed durable writes are reported and do not delete the existing session', async () => {
    let removed = false;
    const storage = createStorage({ get: async () => undefined, put: async () => { throw new Error('Disk full'); } },
        () => ({ getItem: () => 'old-session', removeItem() { removed = true; } }));
    await assert.rejects(storage.getItem('auth'), /Disk full/);
    assert.equal(removed, false);
});
