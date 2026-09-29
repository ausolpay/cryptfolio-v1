const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../market-alerts.js');
test('market alerts distinguish rallies, continuing declines and tentative recoveries', () => {
    const rally = evaluate({ change7d: 25, change24h: 8, change30d: 32, rsi: 78, weight: 50 });
    assert.equal(rally.direction, 'rally'); assert.match(rally.guidance, /concentration/); assert.match(rally.guidance, /RSI/);
    assert.match(evaluate({ change7d: -25, change24h: -8 }).title, /downside/);
    assert.match(evaluate({ change7d: -25, change24h: 3 }).title, /recovery/);
    assert.doesNotMatch(evaluate({ change7d: -25, change24h: 3 }).guidance, /good time to buy/i);
});
test('unavailable indicators are not invented and ordinary movements stay quiet', () => {
    assert.equal(evaluate({ change7d: null }), null);
    assert.equal(evaluate({ change7d: 5, rsi: 80 }), null);
    const result = evaluate({ change7d: -21, rsi: null, weight: null });
    assert.deepEqual(result.reasons, ['7 days: -21.0%']);
    assert.match(evaluate({ change7d: -21, rsi: 0 }).reasons.join(), /RSI: 0/);
});
