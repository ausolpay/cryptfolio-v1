const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../api/ai.js'), 'utf8').replace(/^import .*\r?\n/gm, '').replace('export default async function handler', 'async function handler');
async function run({ authorized = true, enabled = false, action = 'generate', provider = 'openai', model = 'gpt-5-mini', existing = {} } = {}) {
    const calls = [];
    let state = { version: 1, state: { schema: 1, records: {
        'owner@test_aiSettings': JSON.stringify({ provider, apiKey: 'test-provider-key', enabled, model }),
        'owner@test_niceHash': 'must-not-be-sent', ...existing
    } } };
    const context = {
        AbortSignal, randomUUID: () => '11111111-1111-4111-8111-111111111111',
        createClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: 'owner@test' } } }) },
            rpc: async (name, args) => {
                if (name === 'load_account_state') return { data: structuredClone(state) };
                if (args.p_version !== state.version) return { error: { code: 'PT409' } };
                state.state.records = { ...state.state.records, ...args.p_records }; state.version++;
                return { data: state.version };
            } }),
        fetch: async (url, options) => {
            calls.push({ url, options });
            if (provider === 'gemini') return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'Internal' }, { text: 'Consider volatility.' }] } }], usageMetadata: { totalTokenCount: 18 } }) };
            return { ok: true, json: async () => action === 'models'
                ? { data: [{ id: 'gpt-5-mini' }, { id: 'gpt-image-1' }, { id: 'gpt-realtime' }, { id: 'text-embedding-3-small' }] }
                : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Consider concentration risk.' }] }], usage: { total_tokens: 22 } } };
        }
    };
    vm.createContext(context); vm.runInContext(source, context);
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await context.handler({ method: 'POST', headers: authorized ? { authorization: 'Bearer test' } : {}, body: { action,
        context: { scope: 'bitcoin', apiKey: 'never-send', wallet: 'never-send', coins: [{ name: 'Bitcoin', symbol: 'BTC', price: 12, holdings: 2, wallet: 'never-send' }] } } }, res);
    return { res, calls, state };
}
test('AI requires login and activation before sending financial context to a provider', async () => {
    const anonymous = await run({ authorized: false }); assert.equal(anonymous.res.code, 401); assert.equal(anonymous.calls.length, 0);
    const disabled = await run(); assert.equal(disabled.res.code, 403); assert.equal(disabled.calls.length, 0);
});
test('AI persists completed output and sends only the approved financial summary fields', async () => {
    const result = await run({ enabled: true });
    assert.equal(result.res.code, 200);
    assert.equal(result.calls.length, 1);
    const body = result.calls[0].options.body;
    assert.doesNotMatch(body, /never-send|must-not-be-sent|test-provider-key/);
    assert.equal(JSON.parse(body).model, 'gpt-5-mini');
    const saved = JSON.parse(result.state.state.records['owner@test_ai_generation_11111111-1111-4111-8111-111111111111']);
    assert.equal(saved.status, 'complete'); assert.equal(saved.text, 'Consider concentration risk.');
    assert.equal(saved.usage.total_tokens, 22);
});
test('a pending generation on another device prevents a second billable request', async () => {
    const result = await run({ enabled: true, existing: { 'owner@test_ai_generation_other': JSON.stringify({ status: 'pending', createdAt: new Date().toISOString() }) } });
    assert.equal(result.res.code, 503); assert.equal(result.calls.length, 0);
});
test('provider model dropdown excludes image audio and embedding models', async () => {
    const result = await run({ action: 'models' });
    assert.equal(result.res.code, 200); assert.equal(result.res.data.models.length, 1);
    assert.equal(result.res.data.models[0].id, 'gpt-5-mini');
});
test('model values cannot change the fixed provider destination', async () => {
    const result = await run({ enabled: true, model: '../../evil' });
    assert.equal(result.res.code, 400); assert.equal(result.calls.length, 0);
});
test('Gemini uses the selected model and saves only the visible summary', async () => {
    const result = await run({ enabled: true, provider: 'gemini', model: 'gemini-3.5-flash' });
    assert.equal(result.res.code, 200);
    assert.equal(result.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    assert.equal(result.res.data.generation.text, 'Consider volatility.');
    assert.equal(result.res.data.generation.usage.totalTokenCount, 18);
});
