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
        console.log(`📋 Headers:`, JSON.stringify(headers, null, 2));

        // Build the full NiceHash API URL
        const nicehashUrl = `https://api2.nicehash.com${endpoint}`;

        // Forward the request to NiceHash
        // Use headers exactly as provided (including Content-Type)
        const response = await fetch(nicehashUrl, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined
        });

        console.log(`📊 NiceHash responded with status: ${response.status}`);

        // Get response text first (for better error handling)
        const responseText = await response.text();

        // Try to parse as JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('❌ Failed to parse response as JSON:', responseText);
            // If not JSON, return text response
            if (!response.ok) {
                return res.status(response.status).json({
                    error: 'NiceHash API Error',
                    details: responseText,
                    status: response.status
                });
            }
            return res.status(500).json({
                error: 'Invalid Response',
                details: 'NiceHash returned non-JSON response',
                responseText: responseText
            });
        }

        // Check if NiceHash returned an error
        if (!response.ok) {
            console.error(`❌ NiceHash API Error (${response.status}):`, data);
            return res.status(response.status).json({
                error: 'NiceHash API Error',
                details: data,
                status: response.status
            });
        }

        console.log(`✅ Request successful`);
        // Return successful response
        return res.status(200).json(data);

    } catch (error) {
        console.error('❌ Proxy Error:', error);

        return res.status(500).json({
            error: 'Proxy Error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            details: 'Failed to communicate with NiceHash API'
        });
    }
}
