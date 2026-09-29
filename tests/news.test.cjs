const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../api/news.js'), 'utf8').replace('export default async function handler', 'async function handler');
const context = { URL, URLSearchParams, AbortSignal };
vm.createContext(context); vm.runInContext(source, context);
test('news coverage deduplicates sources, excludes old/future articles and unsafe links', () => {
    const now = Date.now();
    const item = (title, url, age = 0) => ({ title, url, published_on: (now - age) / 1000 });
    const result = context.normaliseArticles([
        item('Bitcoin moves - Example', 'https://example.test/one'),
        item('Bitcoin moves - Example', 'https://news.google.com/rss/articles/one'),
        item('Old Bitcoin story', 'https://example.test/old', 31 * 86400000),
        item('Future Bitcoin story', 'https://example.test/future', -86400000),
        item('Unsafe', 'javascript:alert(1)'),
        item('Another Bitcoin story', 'https://example.test/new')
    ], now);
    assert.equal(result.length, 2);
});
test('RSS reads headline, source, date and entities without executing feed content', () => {
    const result = context.parseRss('<rss><channel><item><title><![CDATA[Bitcoin &amp; markets]]></title><link>https://example.test/news</link><pubDate>Tue, 29 Sep 2026 00:00:00 GMT</pubDate><source url="https://example.test">Example</source></item></channel></rss>');
    assert.equal(result[0].title, 'Bitcoin & markets');
    assert.equal(result[0].source, 'Example');
    assert.equal(result[0].published_on, Date.parse('2026-09-29T00:00:00Z') / 1000);
    assert.throws(() => context.parseRss('<html>Rate limited</html>'), /Invalid RSS/);
});
test('one news source can fail without hiding the other source or fabricating a zero', async () => {
    context.fetch = async url => {
        if (url.includes('gdelt')) throw new Error('Unavailable');
        return { ok: true, text: async () => '<rss><channel></channel></rss>' };
    };
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await context.handler({ method: 'GET', query: { name: 'Bitcoin', symbol: 'BTC' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.data.available[0], 'Google News');
    assert.equal(res.data.unavailable[0], 'GDELT');
    context.fetch = async () => { throw new Error('Unavailable'); };
    await context.handler({ method: 'GET', query: { name: 'Bitcoin', symbol: 'BTC' } }, res);
    assert.equal(res.code, 503);
});

test('AI headlines request skips slow 30-day mention counting and asks for the past week', async () => {
    const urls = [];
    context.fetch = async url => { urls.push(url); return { ok: true, text: async () => '<rss><channel></channel></rss>' }; };
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await context.handler({ method: 'GET', query: { name: 'Bitcoin', symbol: 'BTC', mode: 'headlines' } }, res);
    assert.equal(res.code, 200); assert.equal(urls.length, 1);
    assert.match(new URL(urls[0]).searchParams.get('q'), /when:7d/);
    assert.match(res.data.coverage, /last 7 days/);
});
