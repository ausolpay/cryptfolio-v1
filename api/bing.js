// Vercel serverless function to proxy Bing News Search API requests
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
        const { q, count = 50, freshness = 'Month', apiKey: userApiKey } = req.query;

        if (!q) {
            return res.status(400).json({
                error: 'Missing required parameter: q (search query)'
            });
        }

        // Bing News Search API - free tier allows 1000 calls/month
        const bingUrl = `https://api.bing.microsoft.com/v7.0/news/search?q=${encodeURIComponent(q)}&count=${count}&freshness=${freshness}&mkt=en-US`;

        console.log(`Proxying Bing News request for: ${q}`);

        // Use user-provided API key from query param, or fallback to environment variable
        const apiKey = userApiKey || process.env.BING_API_KEY;
        if (!apiKey) {
            console.warn('No Bing API key provided (neither user key nor BING_API_KEY env var)');
            return res.status(200).json({ value: [], totalEstimatedMatches: 0, noKey: true });
        }

        const response = await fetch(bingUrl, {
            headers: {
                'Ocp-Apim-Subscription-Key': apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Bing API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Return the data
        return res.status(200).json(data);

    } catch (error) {
        console.error('Bing proxy error:', error);
        // Return empty result instead of error to allow fallbacks
        return res.status(200).json({ value: [], totalEstimatedMatches: 0, error: error.message });
    }
}
