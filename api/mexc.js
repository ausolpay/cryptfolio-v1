// Vercel serverless function to proxy MEXC API requests (avoid CORS)
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
        const { endpoint, symbol } = req.query;

        if (!endpoint || !symbol) {
            return res.status(400).json({
                error: 'Missing required parameters: endpoint and symbol'
            });
        }

        // Construct MEXC API URL
        const mexcUrl = `https://api.mexc.com/api/v3/${endpoint}?symbol=${symbol}`;

        console.log(`Proxying MEXC request: ${mexcUrl}`);

        // Fetch from MEXC
        const response = await fetch(mexcUrl, {
            headers: {
                'User-Agent': 'CryptFolio/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`MEXC API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Return the data
        return res.status(200).json(data);

    } catch (error) {
        console.error('MEXC proxy error:', error);
        return res.status(500).json({
            error: 'Failed to fetch from MEXC API',
            message: error.message
        });
    }
}
