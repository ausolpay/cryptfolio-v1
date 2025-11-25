// Vercel serverless function to proxy Reddit API requests (avoid CORS)
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
        const { q, sort = 'new', t = 'month', limit = 100 } = req.query;

        if (!q) {
            return res.status(400).json({
                error: 'Missing required parameter: q (search query)'
            });
        }

        // Construct Reddit search URL - use old.reddit.com which is more lenient with API requests
        const redditUrl = `https://old.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=${sort}&t=${t}&limit=${limit}`;

        console.log(`Proxying Reddit request: ${redditUrl}`);

        // Fetch from Reddit with Reddit-compliant User-Agent format
        const response = await fetch(redditUrl, {
            headers: {
                'User-Agent': 'web:CryptFolio:v1.0 (by /u/cryptfolio_app)',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
        }

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Reddit returned non-JSON response (possible rate limit)');
        }

        const data = await response.json();

        // Return the data
        return res.status(200).json(data);

    } catch (error) {
        console.error('Reddit proxy error:', error);
        return res.status(500).json({
            error: 'Failed to fetch from Reddit API',
            message: error.message
        });
    }
}
