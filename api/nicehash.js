/**
 * Vercel Serverless Function - NiceHash API Proxy
 *
 * This function acts as a proxy between your frontend and NiceHash API,
 * solving CORS issues and keeping API credentials secure.
 *
 * Endpoint: /api/nicehash
 */

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        // Get request data from frontend
        const { endpoint, method, headers, body } = req.body;

        console.log(`📡 Proxying ${method} request to NiceHash: ${endpoint}`);

        // Build the full NiceHash API URL
        const nicehashUrl = `https://api2.nicehash.com${endpoint}`;

        // Forward the request to NiceHash
        const response = await fetch(nicehashUrl, {
            method: method,
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        // Get the response data
        const data = await response.json();

        console.log(`✅ NiceHash responded with status: ${response.status}`);

        // Check if NiceHash returned an error
        if (!response.ok) {
            console.error(`❌ NiceHash API Error:`, data);
            return res.status(response.status).json({
                error: 'NiceHash API Error',
                details: data,
                status: response.status
            });
        }

        // Return successful response
        return res.status(200).json(data);

    } catch (error) {
        console.error('❌ Proxy Error:', error);

        return res.status(500).json({
            error: 'Proxy Error',
            message: error.message,
            details: 'Failed to communicate with NiceHash API'
        });
    }
}
