const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../api/nicehash.js'), 'utf8')
    .replace(/^import .*\n/, '').replace('export default async function handler', 'async function handler');
async function request({ body = {}, auth = true, reserveError = false, upstreamStatus = 200 } = {}) {
    const calls = [], rpcs = [];
    const context = {
        AbortSignal,
        createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'test' } } }) },
            rpc: async name => { rpcs.push(name); return { error: name === 'reserve_automation_action' && reserveError ? { message: 'Another device owns automation' } : null }; } }),
        fetch: async (url, options) => { calls.push({ url, options }); return { status: upstreamStatus, json: async () => ({ result: 'test' }) }; }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } };
    const headers = { 'x-cryptfolio-device': '11111111-1111-4111-8111-111111111111', 'x-cryptfolio-request': '22222222-2222-4222-8222-222222222222' };
    if (auth) headers.authorization = 'Bearer test';
    await context.handler({ method: 'POST', body, headers }, res);
    return { res, calls, rpcs };
}
const purchase = { endpoint: '/main/api/v2/hashpower/solo/order', method: 'POST', body: { test: true } };
test('unauthenticated mutations never reach NiceHash', async () => {
    const result = await request({ body: purchase, auth: false });
    assert.equal(result.res.code, 401);
    assert.equal(result.calls.length, 0);
});
test('a rejected device lock prevents upstream purchases', async () => {
    const result = await request({ body: purchase, reserveError: true });
    assert.equal(result.res.code, 409);
    assert.equal(result.calls.length, 0);
});
test('uncertain upstream failures leave actions pending and unacknowledged', async () => {
    const result = await request({ body: purchase, upstreamStatus: 503 });
    assert.deepEqual(result.rpcs, ['reserve_automation_action']);
    assert.equal(result.res.headers['X-Cryptfolio-Received'], undefined);
});
test('confirmed responses record receipt, while bookkeeping acknowledgement stays with the app', async () => {
    const result = await request({ body: purchase });
    assert.deepEqual(result.rpcs, ['reserve_automation_action', 'receive_automation_action']);
    assert.ok(result.res.headers['X-Cryptfolio-Received']);
});
test('invalid paths cannot escape the NiceHash API host', async () => {
    const result = await request({ body: { ...purchase, endpoint: '//example.test/steal' } });
    assert.equal(result.res.code, 400);
    assert.equal(result.calls.length, 0);
});
