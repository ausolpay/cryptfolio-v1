// Public headlines only. No portfolio details or user API keys are sent upstream.
const DAY = 86400000;
const clean = value => String(value || '').replace(/["<>():\\]/g, ' ').replace(/\s+/g, ' ').trim();
const decode = value => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
        const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n]);
function httpUrl(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function parseRss(xml, sourceName = 'Google News') {
    if (!/<rss\b/i.test(xml)) throw new Error('Invalid RSS response');
    const field = (item, name) => decode(item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
    return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, item]) => ({
        title: field(item, 'title'), url: field(item, 'link'), source: field(item, 'source') || sourceName,
        published_on: Date.parse(field(item, 'pubDate')) / 1000, index: sourceName,
        imageurl: httpUrl(decode(item.match(/<media:(?:thumbnail|content)\b[^>]*\burl=["']([^"']+)["']/i)?.[1]
            || item.match(/<enclosure\b(?=[^>]*\btype=["']image\/)[^>]*\burl=["']([^"']+)["']/i)?.[1]
            || (field(item, 'description') + field(item, 'content:encoded')).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]))
    }));
}
function normaliseArticles(items, now = Date.now()) {
    const seen = new Map();
    return items.filter(item => {
        item.url = httpUrl(item.url);
        item.imageurl = httpUrl(item.imageurl || item.socialimage);
        const published = item.published_on * 1000;
        if (!item.url || !item.title || !Number.isFinite(published) || published < now - 30 * DAY || published > now + 3600000) return false;
        // Syndicated copies and the same result from two indexes count once.
        const titleKey = item.title.toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/[^\p{L}\p{N}]/gu, '');
        const duplicate = seen.get(item.url) || seen.get(titleKey);
        if (duplicate) {
            if (!duplicate.imageurl && item.imageurl) duplicate.imageurl = item.imageurl;
            return false;
        }
        seen.set(item.url, item); seen.set(titleKey, item);
        return true;
    }).sort((a, b) => b.published_on - a.published_on);
}
export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const name = clean(req.query.name), symbol = clean(req.query.symbol).toUpperCase();
    if (name.length < 2 || name.length > 80 || !/^[A-Z0-9]{2,15}$/.test(symbol)) return res.status(400).json({ error: 'A coin name and symbol are required' });
    const query = `("${name}" OR "${symbol}") (crypto OR cryptocurrency OR blockchain)`;
    const headlinesOnly = req.query.mode === 'headlines';
    const fetchText = async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(headlinesOnly ? 4500 : 10000), headers: { 'Accept': 'application/json, application/rss+xml, text/xml' } });
        if (!response.ok) throw new Error('Source unavailable');
        const text = await response.text();
        if (text.length > 2000000) throw new Error('Source response too large');
        return text;
    };
    const sources = headlinesOnly ? ['Google News'] : ['Google News', 'GDELT', 'Cointelegraph', 'CoinDesk'];
    const publisherFeed = (url, source) => fetchText(url).then(xml => parseRss(xml, source))
        .then(articles => articles.filter(article => article.title.toLowerCase().includes(name.toLowerCase())
            || new RegExp(`\\b${symbol}\\b`, 'i').test(article.title)));
    const results = await Promise.allSettled([
        fetchText('https://news.google.com/rss/search?' + new URLSearchParams({ q: query + (headlinesOnly ? ' when:7d' : ' when:30d'), hl: 'en-AU', gl: 'AU', ceid: 'AU:en' })).then(parseRss),
        ...(!headlinesOnly ? [
        fetchText('https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '250', timespan: '30d', sort: 'datedesc' }))
            .then(text => {
                const result = JSON.parse(text);
                if (!Array.isArray(result.articles)) throw new Error('Invalid news response');
                return result.articles.map(article => ({ title: article.title, url: article.url, source: article.domain, imageurl: article.socialimage,
                    published_on: Date.parse(String(article.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) / 1000,
                    index: 'GDELT', dateType: 'indexed' }));
            }),
        publisherFeed('https://cointelegraph.com/rss', 'Cointelegraph'),
        publisherFeed('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk')] : [])
    ]);
    const available = sources.filter((_, i) => results[i].status === 'fulfilled');
    if (!available.length) { res.setHeader('Cache-Control', 'no-store'); return res.status(503).json({ error: 'News sources are temporarily unavailable' }); }
    const articles = normaliseArticles(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=600');
    return res.status(200).json({ articles, count: articles.length, available, unavailable: sources.filter(source => !available.includes(source)),
        checkedAt: new Date().toISOString(), coverage: headlinesOnly ? 'Recent headlines from Google News in the last 7 days; limited to returned results.' : 'Unique indexed news mentions in the last 30 days. Limited to returned results; not every online or social mention. GDELT dates are first-seen dates.' });
}
