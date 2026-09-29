const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../api/ai.js'), 'utf8').replace(/^import .*\r?\n/gm, '').replace('export default async function handler', 'async function handler');
async function run({ authorized = true, enabled = false, action = 'generate', provider = 'openai', model = 'gpt-5-mini', existing = {}, coinExtras = {}, shared, scope = 'bitcoin', currency = 'usd', providerFailure = false, id = '11111111-1111-4111-8111-111111111111' } = {}) {
    const calls = [], rpcCalls = [];
    let state = shared || { version: 1, state: { schema: 1, records: {
        'owner@test_aiSettings': JSON.stringify({ provider, apiKey: 'test-provider-key', enabled, model }),
        'owner@test_niceHash': 'must-not-be-sent', ...existing
    } } };
    const context = {
        AbortSignal, URL, randomUUID: () => id,
        createClient: () => ({ auth: { getUser: async () => ({ data: { user: { email: 'owner@test' } } }) },
            rpc: async (name, args) => {
                rpcCalls.push(name);
                if (name === 'load_ai_overview_state') return { data: structuredClone(state) };
                if (name === 'reserve_ai_overview') {
                    const records = state.state.records;
                    if (args.p_daily) {
                        const marker = records[`owner@test_ai_daily_${args.p_day}`];
                        if (marker) { const saved=JSON.parse(marker); return { data: { generation: JSON.parse(records[`owner@test_ai_generation_${saved.id}`]), dailyStatus: saved.status, reused: true } }; }
                    }
                    if (Object.entries(records).some(([key,value]) => key.includes('_ai_generation_') && JSON.parse(value).status === 'pending' && Date.now()-Date.parse(JSON.parse(value).createdAt)<120000)) return {error:{code:'PT429'}};
                }
                const generation=args.p_generation;
                state.state.records[`owner@test_ai_generation_${generation.id}`]=JSON.stringify(generation);
                if (generation.scope === 'portfolio') state.state.records[`owner@test_ai_daily_${generation.summaryDay}`]=JSON.stringify({id:generation.id,status:generation.status});
                state.version++;
                return { data: null };
            } }),
        fetch: async (url, options) => {
            calls.push({ url, options });
            if (providerFailure) return { ok: true, json: async () => { throw new SyntaxError('Unexpected token A'); } };
            if (provider === 'gemini') return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'Internal' }, { text: 'Consider volatility.' }] } }], usageMetadata: { totalTokenCount: 18 } }) };
            return { ok: true, json: async () => action === 'models'
                ? { data: [{ id: 'gpt-5-mini' }, { id: 'gpt-image-1' }, { id: 'gpt-realtime' }, { id: 'text-embedding-3-small' }] }
                : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Consider concentration risk.' }] }], usage: { total_tokens: 22 } } };
        }
    };
    vm.createContext(context); vm.runInContext(source, context);
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await context.handler({ method: 'POST', headers: authorized ? { authorization: 'Bearer test' } : {}, body: { action,
        context: { scope, currency, apiKey: 'never-send', wallet: 'never-send', coins: [{ name: 'Bitcoin', symbol: 'BTC', price: 12, holdings: 2, wallet: 'never-send', ...coinExtras, chart: { candles: [[1790600000000, 10, 14, 9, 12], ['bad', 1, 2, 3, 4]], secret: 'never-send' } }] } } }, res);
    return { res, calls, state, rpcCalls };
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
const day = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
test('Brisbane daily boundary is exactly 6am', () => {
    const context = {}; vm.createContext(context); vm.runInContext(source, context);
    assert.equal(vm.runInContext("summaryDay(Date.parse('2026-09-28T19:59:59Z'))", context), '2026-09-28');
    assert.equal(vm.runInContext("summaryDay(Date.parse('2026-09-28T20:00:00Z'))", context), '2026-09-29');
});
test('daily completion is reused across refresh and manual coin generations do not mark the day', async () => {
    const coin = await run({ enabled: true });
    assert.equal(coin.state.state.records[`owner@test_ai_daily_${day()}`], undefined);
    const first = await run({ enabled: true, action: 'daily' });
    assert.equal(JSON.parse(first.state.state.records[`owner@test_ai_daily_${day()}`]).status, 'complete');
    const second = await run({ enabled: true, action: 'daily', shared: first.state });
    assert.equal(second.calls.length, 0); assert.equal(second.res.data.reused, true);
});
test('two devices reserve one billable daily summary atomically', async () => {
    const shared = { version: 1, state: { records: { 'owner@test_aiSettings': JSON.stringify({ enabled: true, provider: 'openai', apiKey: 'test', model: 'gpt-5-mini' }) } } };
    const results = await Promise.all([run({ action: 'daily', shared }), run({ action: 'daily', shared, id: '22222222-2222-4222-8222-222222222222' })]);
    assert.equal(results.reduce((sum, r) => sum + r.calls.length, 0), 1);
    assert.equal(JSON.parse(shared.state.records[`owner@test_ai_daily_${day()}`]).status, 'complete');
});
test('failed daily provider responses are readable and not automatically billed again', async () => {
    const failed = await run({ enabled: true, action: 'daily', providerFailure: true });
    assert.match(failed.res.data.error, /unreadable response/);
    assert.doesNotMatch(failed.res.data.error, /Unexpected token/);
    const retry = await run({ action: 'daily', shared: failed.state });
    assert.equal(retry.calls.length, 0); assert.equal(retry.res.data.dailyStatus, 'error');
});
test('previous day markers do not prevent new daily summary; manual portfolio refresh marks today', async () => {
    const result = await run({ enabled: true, action: 'daily', existing: { 'owner@test_ai_daily_2020-01-01': JSON.stringify({ status: 'complete' }) } });
    assert.equal(result.calls.length, 1);
    const manual = await run({ enabled: true, scope: 'portfolio' });
    assert.equal(JSON.parse(manual.state.state.records[`owner@test_ai_daily_${day()}`]).status, 'complete');
});
test('chart analysis includes only valid USD candles and requests a concise response', async () => {
    const result = await run({ enabled: true });
    const body = JSON.parse(result.calls[0].options.body), input = JSON.parse(body.input);
    assert.deepEqual(input.coins[0].chart.candles, [[1790600000000, 10, 14, 9, 12]]);
    assert.equal(input.coins[0].chart.currency, 'USD');
    assert.match(body.instructions, /up to 400 words/);
});
test('analysis receives bounded trade history, comparisons and safe source links without private fields', async () => {
    const result = await run({ enabled: true, coinExtras: {
        history: { purchaseEntryCount: 1, eventCount: 1, recordedAcquiredUnits: 2,
            purchases: [{ amount: 2, boughtPrice: 5, currency: 'AUD', wallet: 'secret-address' }],
            recent: [{ action: 'sell', amount: 1, soldPrice: 6, currency: 'AUD', timestamp: 123, apiKey: 'secret-key' }] },
        market: { change7d: 4, change30d: 8, volume24hUSD: 120000, observedAt: '2026-09-29T00:00:00Z' },
        headlines: [{ title: 'Report', source: 'Publisher', url: 'https://example.com/report' }, { title: 'Unsafe', url: 'javascript:alert(1)' }]
    } });
    const body = JSON.parse(result.calls[0].options.body), input = JSON.parse(body.input);
    assert.equal(input.coins[0].history.recent[0].soldPrice, 6);
    assert.equal(input.coins[0].market.change7d, 4);
    assert.equal(input.coins[0].headlines[0].url, 'https://example.com/report');
    assert.equal(input.coins[0].headlines[1].url, null);
    assert.doesNotMatch(body.input, /secret-address|secret-key/);
    assert.match(body.instructions, /buy\/add, hold\/wait, trim\/sell and reinvest/);
    assert.match(body.instructions, /Do not treat sale proceeds as available cash/);
});

test('portfolio brief strips bulky chart and trade details on the server and prioritises important dated news', async () => {
    const result = await run({ enabled: true, scope: 'portfolio', coinExtras: { history: { purchases: [{ amount: 2, boughtPrice: 10 }] } } });
    const body = JSON.parse(result.calls[0].options.body), input = JSON.parse(body.input);
    assert.equal(input.coins[0].history, undefined); assert.equal(input.coins[0].chart, undefined);
    assert.match(body.instructions, /Portfolio summary, Important latest news, Recommendations, Watch next/);
    assert.match(body.instructions, /last 48 hours within the last 7 days/);
    assert.match(body.instructions, /never invent news/i);
});

test('Gemini uses supported fast reasoning settings without guessing settings for unknown models', async () => {
    for (const [model, config] of [
        ['gemini-3.5-flash', { thinkingLevel: 'minimal' }],
        ['gemini-3.8-flash', { thinkingLevel: 'low' }],
        ['gemini-2.5-flash', { thinkingBudget: 0 }],
        ['gemini-2.5-pro', undefined], ['gemini-future-model', undefined]
    ]) {
        const result = await run({ enabled: true, provider: 'gemini', model });
        assert.equal(result.res.code, 200);
        assert.deepEqual(JSON.parse(result.calls[0].options.body).generationConfig.thinkingConfig, config);
    }
});

test('generation uses one compact account read and two small saves, never full-account writes or CAS retries', async () => {
    const result = await run({ enabled: true });
    assert.deepEqual(result.rpcCalls, ['load_ai_overview_state', 'reserve_ai_overview', 'finish_ai_overview']);
    assert.equal(result.res.code, 200);
});

test('saved summary history never exposes provider credentials or unrelated account records', async () => {
    const result = await run({ action: 'history', existing: {
        'owner@test_ai_generation_saved': JSON.stringify({ id: 'saved', status: 'complete', text: 'A portfolio brief', createdAt: new Date().toISOString() })
    } });
    assert.equal(result.res.code, 200); assert.equal(result.res.data.generations.length, 1);
    assert.doesNotMatch(JSON.stringify(result.res.data), /test-provider-key|must-not-be-sent/);
    assert.equal(result.calls.length, 0);
});

test('provider receives sanitised app-calculated tracker figures and explicit selected-currency instructions', async () => {
    const result = await run({ enabled: true, scope: 'portfolio', currency: 'aud', coinExtras: { tracker: { currency: 'AUD', dca: 9, unrealizedProfit: 25, realizedProfit: -7, wallet: 'private-wallet' } } });
    const body = JSON.parse(result.calls[0].options.body), input = JSON.parse(body.input);
    assert.equal(input.coins[0].tracker.dca, 9); assert.equal(input.coins[0].tracker.realizedProfit, -7);
    assert.equal(input.coins[0].tracker.currency, 'AUD'); assert.doesNotMatch(body.input, /private-wallet/);
    assert.match(body.instructions, /Use supplied tracker DCA/);
    assert.match(body.instructions, /selected context.currency/);
    assert.equal(input.currency, 'AUD');
});
