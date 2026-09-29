const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(respond) {
    const requests = [];
    let time = 100000;
    const context = vm.createContext({ easyMiningSettings: { orgId: 'org', apiKey: 'test' },
        generateNiceHashAuthHeaders: () => ({}), VERCEL_PROXY_ENDPOINT: '/api/nicehash', console,
        Date: { now: () => time }, CloudAccount: { proxyFetch: async (_url, options) => {
            const payload = JSON.parse(options.body); requests.push(payload.endpoint);
            return respond(payload.endpoint, requests.length);
        } } });
    vm.runInContext(fs.readFileSync('nicehash-order-cache.js', 'utf8'), context);
    return { cache: vm.runInContext('NiceHashOrderCache', context), requests, advance: value => { time += value; } };
}
test('large histories paginate in bounded requests and are cached between polls', async () => {
    const app = setup(endpoint => ({ ok: true, json: async () => ({ list: Array.from({ length: endpoint.endsWith('page=0') ? 100 : 6 }, (_, index) => ({ id: endpoint.endsWith('page=0') ? String(index) : String(100 + index) })) }) }));
    assert.equal((await app.cache.list('status=COMPLETED', 60000)).length, 106);
    assert.equal((await app.cache.list('status=COMPLETED', 60000)).length, 106);
    assert.equal(app.requests.length, 2);
    assert.ok(app.requests.every(url => url.includes('limit=100')));
});
test('a temporary history failure retains the last confirmed history', async () => {
    const app = setup((_endpoint, count) => count === 1 ? { ok:true, json:async () => [{id:'one'}] } : {ok:false,status:500});
    await app.cache.list('status=COMPLETED', 60000); app.advance(61000);
    assert.equal((await app.cache.list('status=COMPLETED', 60000))[0].id, 'one');
});
test('failed active-order refresh is not presented as a fresh empty list', async () => {
    const app = setup(() => ({ok:false,status:503}));
    await assert.rejects(app.cache.list('active=true'), /503/);
});
