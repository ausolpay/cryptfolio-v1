/**
 * Vercel Serverless Function - QR Code Generator API Proxy
 *
 * This function acts as a proxy between your frontend and QR Code Generator API,
 * solving CORS issues.
 *
 * Endpoint: /api/qrcode
 */

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        // Get request data from frontend
        const { url, body } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'Missing required parameter: url' });
        }

        console.log(`📱 Proxying QR code generation request to: ${url}`);
        console.log(`📋 Request body:`, JSON.stringify(body, null, 2));

        // Forward the request to QR Code Generator API
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        console.log(`📊 QR Code API responded with status: ${response.status}`);

        // Get response as text (SVG is text format)
        const svgText = await response.text();

        // Check if request was successful
        if (!response.ok) {
            console.error(`❌ QR Code API Error (${response.status}):`, svgText);
            return res.status(response.status).json({
                error: 'QR Code API Error',
                details: svgText,
                status: response.status
            });
        }

        console.log(`✅ QR code generated successfully, SVG length: ${svgText.length}`);

        // Return SVG as text
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.status(200).send(svgText);

    } catch (error) {
        console.error('❌ Proxy Error:', error);

        return res.status(500).json({
            error: 'Proxy Error',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            details: 'Failed to communicate with QR Code Generator API'
        });
    }
}
