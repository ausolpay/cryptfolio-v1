const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts.js'), 'utf8');
test('share buttons recalculate crypto and fiat rewards using the selected pool, without pausing live updates', () => {
    const reward = { textContent: '0.7813' }, fiat = { textContent: '≈ $25.00' };
    const base = { priceAUD: 10, totalRewardAUD: 100, totalMainReward: 3.125, totalBoughtShares: 4, myBoughtShares: 1, mainCrypto: 'BTC' };
    const card = { teamRewardBase: base, classList: { contains: name => name === 'buy-package-card' }, closest: () => null,
        querySelector: selector => selector === '#team-reward-Team' ? reward : selector === '#team-reward-value-Team' ? fiat : null };
    const input = { value: '1', min: '1', max: '100', dataset: { myBought: '1', totalBought: '4', totalAvailable: '100' }, style: {},
        closest: selector => selector.includes('buy-package-card') ? card : null, hasAttribute: () => false, setAttribute() {}, dispatchEvent() {} };
    const context = { TeamProbability: { changed() {} }, window: { packageBaseValues: { Team: { ...base, totalRewardAUD: 999 } } }, Event: class {}, console: { log() {}, error() {} },
        document: { getElementById: id => id === 'shares-Team' ? input : null },
        formatNumber: value => value, addFloatingIconForShares() {}, removeFloatingIconForShares() {} };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function adjustShares('), source.indexOf('// Make adjustShares globally accessible')), context);
    context.adjustShares('Team', 1);
    assert.equal(input.value, 2); assert.equal(reward.textContent, '1.2500'); assert.equal(fiat.textContent, '≈ $40.00');
    // Another user buys a share; the next selection uses the updated pool.
    base.totalBoughtShares = 5;
    context.adjustShares('Team', -1);
    assert.equal(reward.textContent, '0.6250'); assert.equal(fiat.textContent, '≈ $20.00');
});
