const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createStorage } = require('../cloud-data.js');
function client(storage) {
    const context = vm.createContext({ loggedInUser: 'test-user', appStorage: storage,
        crypto: require('node:crypto').webcrypto, TextEncoder, Date, setTimeout,
        window: { addEventListener() {} }, document: { querySelectorAll: () => [], getElementById: () => null } });
    vm.runInContext(fs.readFileSync('notifications.js', 'utf8'), context);
    return vm.runInContext('AppNotifications', context);
}
test('the same alert from two devices creates one cloud notification', async () => {
    const storage = createStorage();
    await Promise.all([client(storage).add('Milestone', 'Reached a milestone', 'milestone'), client(storage).add('Milestone', 'Reached a milestone', 'milestone')]);
    assert.equal(Object.keys(storage.snapshot()).length, 1);
});
test('read status persists independently of the alert, without deleting history', async () => {
    const storage = createStorage();
    const first = client(storage);
    await first.add('Market alert', 'RSI threshold reached', 'market');
    first.readAll();
    assert.equal(Object.keys(storage.snapshot()).length, 2);
    const second = client(storage);
    await second.add('Market alert', 'RSI threshold reached', 'market');
    assert.equal(Object.keys(storage.snapshot()).length, 2);
    assert.ok(Object.entries(storage.snapshot()).some(([key,value]) => key.includes('_read_') && value === 'true'));
});
test('the same market event deduplicates across devices with slightly different price snapshots', async () => {
    const storage = createStorage();
    await client(storage).add('BTC rally', '7 days: 20.1%', 'market', 'bitcoin:rally:20');
    await client(storage).add('BTC rally', '7 days: 20.2%', 'market', 'bitcoin:rally:20');
    assert.equal(Object.keys(storage.snapshot()).length, 1);
});
