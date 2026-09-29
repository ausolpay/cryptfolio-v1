const { test } = require('node:test');
const assert = require('node:assert/strict');
global.EasyMiningModel = require('../easymining-model.js');
const { buildMiningTelemetry, miningTimestamp } = require('../mining-telemetry.js');
const vm = require('node:vm');
const fs = require('node:fs');
const start = 1800000000000;
const pkg = { startTime: start, endTime: start + 3600000, fullOrderData: {} };
test('time bins fit phones, tablets and desktops and keep irregular timestamps in place', () => {
    const samples = [{ timestamp: start, bestSharePercent: 0 }, { timestamp: start + 3000000, bestSharePercent: 106 }];
    const mobile = buildMiningTelemetry(pkg, samples, 280, start);
    const desktop = buildMiningTelemetry(pkg, samples, 1100, start);
    assert.ok(mobile.bins.length < desktop.bins.length);
    for (const width of [240, 280, 650, 1100]) {
        const model = buildMiningTelemetry(pkg, samples, width, start);
        assert.equal(model.bins[0].value, 0);
        assert.ok(model.bins.findIndex(b => b.value === 106) > model.bins.length * .75);
        assert.ok(model.bins.at(-1).value === null);
        assert.ok(model.ceiling > 106);
    }
});
test('bucket aggregation preserves peaks, confirmed rewards, and missing history', () => {
    const model = buildMiningTelemetry({ ...pkg, totalBlocks: 5, blockFound: true, fullOrderData: { soloReward: [{ createdTs: (start + 2000) / 1000 }, { createdTs: 'invalid' }] } },
        [{ timestamp: start + 1000, bestSharePercent: 74 }, { timestamp: start + 2000, bestSharePercent: 106 }, { timestamp: start + 3000, bestSharePercent: null }], 280, start);
    assert.equal(model.bins[0].value, 106);
    assert.equal(model.bins[0].samples, 2);
    assert.equal(model.bins.reduce((total, b) => total + b.rewards, 0), 1);
    assert.equal(buildMiningTelemetry({ ...pkg, blockFound: true, totalBlocks: 3 }, [], 280, start).bins.reduce((total, b) => total + b.rewards, 0), 0);
});
test('timestamps accept server seconds, milliseconds and ISO dates, rejecting invalid values', () => {
    assert.equal(miningTimestamp(start / 1000), start);
    assert.equal(miningTimestamp(start), start);
    assert.equal(miningTimestamp(new Date(start).toISOString()), start);
    for (const value of [null, '', undefined, 'invalid', -1]) assert.equal(miningTimestamp(value), null);
});
test('unreported shares remain empty and current server share keeps its actual update time', () => {
    assert.equal(buildMiningTelemetry({ ...pkg, progress: 99 }, [], 280, start).latest, undefined);
    const model = buildMiningTelemetry({ ...pkg, fullOrderData: { soloMiningSharesMaxPercent: 145, updatedTs: start + 60000 } }, [], 280, start);
    assert.equal(model.latest.timestamp, start + 60000);
    assert.equal(model.latest.value, 145);
    assert.equal(model.ceiling, 145);
});
test('countdown and fresh polling cannot replace a reported share with elapsed-time progress', () => {
    const elements = Object.fromEntries(['close-to-reward-fill', 'close-to-reward-percentage', 'mining-countdown', 'close-to-reward-icon'].map(id => [id, { style: {}, classList: { toggle() {} } }]));
    let collected = 0, saved = 0;
    const running = { ...pkg, id: 'live', active: true, localRemainingMs: 10000, totalBlocks: 1, blockFound: true, fullOrderData: { soloMiningSharesMaxPercent: 74 } };
    const context = { EasyMiningModel: global.EasyMiningModel, currentDetailPackage: running, lastDisplayedBlockCount: 0,
        document: { getElementById: id => elements[id] }, collectChartDataPoint: () => collected++, saveChartDataToStorage: () => saved++ };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(require.resolve('../mining-telemetry.js'), 'utf8'), context);
    context.installMiningTelemetry();
    context.updatePackageDetailLive();
    assert.equal(elements['close-to-reward-percentage'].textContent, '74.0%');
    assert.equal(elements['mining-countdown'].textContent, '00:00:09');
    const fresh = { ...running, estimateDurationInSeconds: 20, fullOrderData: { soloMiningSharesMaxPercent: 0 } };
    context.updateMiningChartLive(fresh);
    assert.equal(elements['close-to-reward-percentage'].textContent, '0.0%');
    assert.equal(fresh.localRemainingMs, 20000);
    assert.equal(collected, 1);
    assert.equal(saved, 1);
    context.updatePackageDetailLive();
    assert.equal(elements['mining-countdown'].textContent, '00:00:19');
    assert.equal(elements['close-to-reward-percentage'].textContent, '0.0%');
});
