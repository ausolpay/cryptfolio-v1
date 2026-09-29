const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const model = require('../easymining-model.js');
test('percentage targets account for the shares being added and respect capacity', () => {
    assert.equal(model.targetShares(100, 0, 10), 12);
    assert.equal(model.targetShares(100, 10, 10), 10);
    assert.equal(model.targetShares(100, 0, 50), 100);
    assert.equal(model.targetShares(100, 0, 50, 110), 10);
    assert.equal(model.targetShares(100, 0, 100), null);
    assert.equal(model.targetShares(10, 20, 10), null);
});
test('Bronze auto-shares stays paused after verification timeout instead of buying twice', async () => {
    let notices = 0, purchases = 0;
    const saved = { 'Team Bronze': { enabled: true, percentage: 50, trackedPackageIds: { pool: {
        pendingVerification: true, expectedShares: 5, lastBuyTime: Date.now() - 60000
    } } } };
    const records = { 'user_teamAutoShares': JSON.stringify(saved) };
    const context = { EasyMiningModel: model, loggedInUser: 'user', authenticatedTeamShares: { pool: 2 },
        autoSharesQueue: [], autoSharesCurrentPackage: 'Team Bronze',
        appStorage: { getItem: key => records[key], setItem: (key, value) => { records[key] = value; } },
        console: { log() {}, error() {} }, AppNotifications: { add: async () => { notices++; } },
        syncNiceHashTime: async () => { purchases++; } };
    const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts.js'), 'utf8');
    const start = source.indexOf('async function executeAutoSharesTeam(');
    const end = source.indexOf('\nfunction isAutoSharesActive(', start);
    vm.createContext(context); vm.runInContext(source.slice(start, end), context);
    const packages = [{ name: 'Team Bronze', addedAmount: .002, numberOfParticipants: 6, apiData: { id: 'pool', state: 'OPEN', minShareAmount: .0001 } }];
    await context.executeAutoSharesTeam(packages); await context.executeAutoSharesTeam(packages);
    assert.equal(purchases, 0); assert.equal(notices, 1);
    assert.equal(JSON.parse(records.user_teamAutoShares)['Team Bronze'].trackedPackageIds.pool.pendingVerification, true);
});
