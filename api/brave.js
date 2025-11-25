// Vercel serverless function to proxy Brave Search API requests
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { q, count = 20, freshness = 'pm', apiKey: userApiKey } = req.query;

        if (!q) {
            return res.status(400).json({
                error: 'Missing required parameter: q (search query)'
            });
        }

        // Use user-provided key or fallback to environment variable
        const apiKey = userApiKey || process.env.BRAVE_API_KEY;

        if (!apiKey) {
            console.warn('No Brave API key provided');
            return res.status(200).json({ results: [], count: 0, noKey: true });
        }

        // Brave Search API - news endpoint with freshness filter
        // freshness: pd (past day), pw (past week), pm (past month)
        const braveUrl = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(q)}&count=${count}&freshness=${freshness}`;

        console.log(`Proxying Brave Search request for: ${q}`);

        const response = await fetch(braveUrl, {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': apiKey
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Brave API error: ${response.status} ${response.statusText} - ${errorText}`);
            return res.status(200).json({ results: [], count: 0, error: `API error: ${response.status}` });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        console.error('Brave proxy error:', error);
        return res.status(200).json({ results: [], count: 0, error: error.message });
    }
}
