// Vercel serverless function to proxy Reddit API requests with OAuth support
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
        const { q, sort = 'new', t = 'month', limit = 100, clientId, clientSecret } = req.query;

        if (!q) {
            return res.status(400).json({
                error: 'Missing required parameter: q (search query)'
            });
        }

        let accessToken = null;

        // If OAuth credentials provided, get access token via Application-Only OAuth
        if (clientId && clientSecret) {
            try {
                console.log('Attempting Reddit OAuth token exchange...');
                const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'web:CryptFolio:v1.0 (by /u/cryptfolio_app)'
                    },
                    body: 'grant_type=client_credentials'
                });

                if (tokenResponse.ok) {
                    const tokenData = await tokenResponse.json();
                    accessToken = tokenData.access_token;
                    console.log('Reddit OAuth token obtained successfully');
                } else {
                    const errorText = await tokenResponse.text();
                    console.warn(`Failed to get Reddit OAuth token: ${tokenResponse.status} - ${errorText}`);
                }
            } catch (tokenError) {
                console.warn('Failed to get Reddit OAuth token:', tokenError.message);
            }
        }

        // Use authenticated or public endpoint
        let redditUrl, headers;

        if (accessToken) {
            // Authenticated request to oauth.reddit.com (100 req/min)
            redditUrl = `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=${sort}&t=${t}&limit=${limit}`;
            headers = {
                'Authorization': `bearer ${accessToken}`,
                'User-Agent': 'web:CryptFolio:v1.0 (by /u/cryptfolio_app)'
            };
            console.log(`Authenticated Reddit request for: ${q}`);
        } else {
            // Public request to old.reddit.com (10 req/min - heavily rate limited)
            redditUrl = `https://old.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=${sort}&t=${t}&limit=${limit}`;
            headers = {
                'User-Agent': 'web:CryptFolio:v1.0 (by /u/cryptfolio_app)',
                'Accept': 'application/json'
            };
            console.log(`Public Reddit request for: ${q}`);
        }

        const response = await fetch(redditUrl, { headers });

        if (!response.ok) {
            throw new Error(`Reddit API error: ${response.status} ${response.statusText}`);
        }

        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Reddit returned non-JSON response (possible rate limit)');
        }

        const data = await response.json();

        // Return the data with metadata about auth status
        return res.status(200).json({
            ...data,
            _meta: {
                authenticated: !!accessToken,
                endpoint: accessToken ? 'oauth.reddit.com' : 'old.reddit.com'
            }
        });

    } catch (error) {
        console.error('Reddit proxy error:', error);
        // Return empty results instead of 500 error to prevent UI breakage
        return res.status(200).json({
            data: { children: [] },
            error: error.message,
            _meta: { authenticated: false, error: true }
        });
    }
}
