const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts.js'), 'utf8');
function loadFunction(name, context) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(start, end), context);
}

test('later buy pages remain reachable when earlier buys are sold', () => {
    const context = vm.createContext({
        currentHoldingsCryptoId: 'bitcoin', currentHoldingsPage: 1,
        getHoldingsEntries: () => Array.from({ length: 23 }, (_, i) => ({ status: i < 21 ? 'sold' : 'active' })),
        displayHoldingsEntries: () => {}
    });
    loadFunction('getHoldingsCardsPerPage', context);
    loadFunction('nextHoldingsPage', context);
    vm.runInContext('nextHoldingsPage(); nextHoldingsPage(); nextHoldingsPage();', context);
    assert.equal(context.currentHoldingsPage, 3);
});

test('sell navigation counts only sales, not unrelated history', () => {
    const context = vm.createContext({
        currentHoldingsCryptoId: 'bitcoin', currentHistoryPage: 1,
        getHoldingsHistoryByCrypto: () => [
            ...Array.from({ length: 11 }, () => ({ action: 'sell' })),
            ...Array.from({ length: 30 }, () => ({ action: 'update' }))
        ],
        displayHistoryEntries: () => {}
    });
    loadFunction('getHoldingsCardsPerPage', context);
    loadFunction('nextHistoryPage', context);
    vm.runInContext('nextHistoryPage(); nextHistoryPage();', context);
    assert.equal(context.currentHistoryPage, 2);
});
