# CORS Fix Guide - NiceHash API Integration

## 🔴 The Problem

Your frontend app running on `localhost` cannot directly call the NiceHash API due to **CORS (Cross-Origin Resource Sharing)** restrictions. This is a browser security feature that blocks requests from one domain (localhost) to another (api2.nicehash.com).

**Current Status:**
- ✅ App works with mock data for testing
- ❌ Direct API calls fail with CORS error
- ✅ All code is ready for production with real API

---

## ✅ Solution Options

### Option 1: Backend Proxy (Recommended for Production)

Create a simple backend server that acts as a proxy between your frontend and NiceHash API.

#### Using Node.js/Express:

```javascript
// server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// Proxy endpoint for NiceHash API
app.all('/api/nicehash/*', async (req, res) => {
    const nicehashPath = req.path.replace('/api/nicehash', '');
    const url = `https://api2.nicehash.com${nicehashPath}`;

    // Forward the request to NiceHash with auth headers
    const response = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });

    const data = await response.json();
    res.json(data);
});

app.listen(3000, () => console.log('Proxy server running on port 3000'));
```

**Then update your frontend:**
```javascript
// Change API base URL
const API_BASE = 'http://localhost:3000/api/nicehash';
const response = await fetch(`${API_BASE}${endpoint}`, { ... });
```

---

### Option 2: Serverless Functions (Best for Deployment)

Deploy with **Netlify**, **Vercel**, or **Cloudflare Workers** which support serverless functions.

#### Netlify Function Example:

```javascript
// netlify/functions/nicehash-proxy.js
const fetch = require('node-fetch');
const crypto = require('crypto');

exports.handler = async (event, context) => {
    const { path, method, body, headers } = JSON.parse(event.body);

    const url = `https://api2.nicehash.com${path}`;

    const response = await fetch(url, {
        method: method,
        headers: headers,
        body: body
    });

    const data = await response.json();

    return {
        statusCode: 200,
        body: JSON.stringify(data)
    };
};
```

**Frontend update:**
```javascript
const endpoint = '/main/api/v2/accounting/accounts2';
const response = await fetch('/.netlify/functions/nicehash-proxy', {
    method: 'POST',
    body: JSON.stringify({
        path: endpoint,
        method: 'GET',
        headers: generateNiceHashAuthHeaders('GET', endpoint)
    })
});
```

---

### Option 3: Browser Extension (Development Only)

Install a CORS browser extension:
- [Allow CORS: Access-Control-Allow-Origin](https://chrome.google.com/webstore/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf)
- [CORS Unblock](https://chrome.google.com/webstore/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino)

⚠️ **Warning:** Only use for local testing. Never deploy with this approach.

---

### Option 4: Deploy to Production Domain

If you deploy your app to a production domain (e.g., `cryptfolio.ausolpay.com.au`), you can:
1. Set up the backend proxy on the same domain
2. Make API calls to your own backend
3. Backend makes authenticated calls to NiceHash

**Example nginx config:**
```nginx
location /api/nicehash/ {
    proxy_pass https://api2.nicehash.com/;
    proxy_set_header Host api2.nicehash.com;
}
```

---

## 🚀 Quick Start for Testing

**Current behavior:**
- App automatically detects CORS errors
- Falls back to mock data
- You can test all features locally
- Console shows: `⚠️ CORS error detected - using mock data for testing`

**To see real data:**
1. Deploy with Option 1 or 2 above
2. Update API base URL in `scripts.js`
3. Deploy to production

---

## 📝 Code Changes Needed for Production

When you have a backend proxy set up, make these changes in `scripts.js`:

```javascript
// Add at the top of scripts.js
const API_BASE_URL = 'https://your-domain.com/api/nicehash'; // or your proxy URL

// Update fetchNiceHashBalances
async function fetchNiceHashBalances() {
    try {
        const endpoint = '/main/api/v2/accounting/accounts2';
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        // Use proxy URL instead of direct NiceHash URL
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: headers
        });

        // ... rest of the code stays the same
    }
}

// Same pattern for fetchNiceHashOrders and buyPackage functions
```

---

## 🎯 Recommended Deployment Stack

**Best Setup:**
1. Frontend: Deploy to **Netlify** or **Vercel**
2. Backend: Use **Netlify Functions** or **Vercel Serverless Functions**
3. Database: Keep using localStorage or migrate to **Supabase**
4. Authentication: Add proper auth (JWT tokens)

**Benefits:**
- ✅ No CORS issues
- ✅ API keys hidden from frontend
- ✅ Automatic HTTPS
- ✅ CDN for fast loading
- ✅ Free tier available

---

## 🔒 Security Note

**Important:** Never expose API keys in frontend code when deployed to production. Always use a backend proxy to:
- Keep API keys secure
- Add rate limiting
- Log API usage
- Validate requests

---

## 📞 Next Steps

1. **For Testing:** Continue using mock data (current setup works)
2. **For Production:** Choose Option 1 or 2 above
3. **Update Config:** Set `API_BASE_URL` when ready
4. **Deploy:** Push to production with backend proxy

Your code is ready - you just need to add the backend proxy layer!
