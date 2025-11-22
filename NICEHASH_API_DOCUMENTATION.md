# NiceHash API Endpoints Documentation

Complete reference for all NiceHash API endpoints used in CryptFolio v1.6.

**Base URL**: `https://api2.nicehash.com`

**Authentication**: HMAC-SHA256 signature using API Key, Secret, and Organization ID

**Proxy Mode**: All requests can be routed through Vercel proxy when `USE_VERCEL_PROXY = true`

---

## Table of Contents

1. [Solo/Small Packages](#1-solosmall-packages)
2. [Team/Shared Packages](#2-teamshared-packages)
3. [Order Management](#3-order-management)
4. [Account & Balances](#4-account--balances)
5. [Withdrawal Addresses](#5-withdrawal-addresses)
6. [Time Synchronization](#6-time-synchronization)
7. [Authentication Headers](#7-authentication-headers)

---

## 1. Solo/Small Packages

### 1.1 List Available Solo Packages

**Endpoint**: `GET /main/api/v2/public/solo/package`

**Authentication**: ❌ Not required (public endpoint)

**Function**: `fetchNiceHashSoloPackages()`

**Purpose**: Get list of all available solo mining packages with current probabilities

**Request**:
```javascript
// Via proxy
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: '/main/api/v2/public/solo/package',
        method: 'GET',
        headers: {},
        isPublic: true
    })
})

// Direct
fetch('https://api2.nicehash.com/main/api/v2/public/solo/package', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
})
```

**Response Structure**:
```json
{
  "list": [
    {
      "id": "GOLD_S",
      "name": "Gold S",
      "crypto": "BTC",
      "probability": "1:142",
      "price": "0.00010000",
      "duration": "24h",
      "algorithm": "SHA256",
      "description": "Small Bitcoin package",
      "available": true
    },
    {
      "id": "PALLADIUM_S",
      "name": "Palladium S",
      "mainCrypto": "LTC",
      "mergeCrypto": "DOGE",
      "probability": "1:156",
      "mergeProbability": "1:198",
      "price": "0.00010000",
      "duration": "24h",
      "algorithm": "Scrypt",
      "isDualCrypto": true,
      "available": true
    }
  ]
}
```

**Key Fields**:
- `id`: Package identifier (used for purchasing)
- `name`: Display name
- `probability`: Probability string for main crypto (format: "1:XXX")
- `mergeProbability`: Probability for merge crypto (dual-crypto packages only)
- `price`: Package price in BTC
- `isDualCrypto`: Boolean indicating dual-crypto package (LTC+DOGE)

**Usage Notes**:
- Used to display available packages in Buy Packages page
- Used to check current probabilities in alert settings
- Public endpoint - no authentication required

---

### 1.2 Purchase Solo Package

**Endpoint**: `POST /main/api/v2/hashpower/solo/order?ticketId={ticketId}`

**Authentication**: ✅ Required

**Function**: `buySoloPackage(ticketId, crypto)`

**Purpose**: Purchase a solo mining package

**Request**:
```javascript
const ticketId = "GOLD_S";
const endpoint = `/main/api/v2/hashpower/solo/order?ticketId=${ticketId}`;
const body = JSON.stringify({});
const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

// Via proxy
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'POST',
        headers: headers,
        body: {}
    })
})

// Direct
fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'POST',
    headers: headers,
    body: body
})
```

**Request Body**:
```json
{}
```
(Empty object - package ID is in URL parameter)

**Response**:
```json
{
  "id": "abc123-def456-ghi789",
  "orderId": "abc123-def456-ghi789",
  "success": true,
  "status": "ACTIVE",
  "ticketId": "GOLD_S",
  "amount": "0.00010000",
  "currency": "BTC",
  "createdAt": 1234567890000
}
```

**Key Response Fields**:
- `id` / `orderId`: Order identifier for tracking
- `success`: Boolean indicating purchase success
- `status`: Order status (ACTIVE, COMPLETED, etc.)

**Usage Notes**:
- Requires valid API credentials with purchase permissions
- Balance must be sufficient for package price
- Empty body required (package specified in URL)

---

## 2. Team/Shared Packages

### 2.1 List Available Team Packages

**Endpoint**: `GET /main/api/v2/public/solo/shared/order`

**Authentication**: ❌ Not required (public endpoint)

**Function**: `fetchNiceHashTeamPackages()`

**Purpose**: Get list of all active team mining packages

**Request**:
```javascript
// Via proxy
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: '/main/api/v2/public/solo/shared/order',
        method: 'GET',
        headers: {},
        isPublic: true
    })
})

// Direct
fetch('https://api2.nicehash.com/main/api/v2/public/solo/shared/order', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
})
```

**Response Structure**:
```json
{
  "list": [
    {
      "id": "team-gold-123",
      "name": "Team Gold",
      "crypto": "BTC",
      "probability": "1:128",
      "shares": "45.32",
      "numberOfParticipants": 127,
      "startTs": 1735689600000,
      "endTs": 1735776000000,
      "status": "ACTIVE",
      "algorithm": "SHA256",
      "currencyAlgoTicket": {
        "id": "GOLD_TEAM",
        "name": "Gold Team"
      }
    },
    {
      "id": "team-palladium-456",
      "name": "Team Palladium",
      "mainCrypto": "LTC",
      "mergeCrypto": "DOGE",
      "mainProbability": "1:145",
      "mergeProbability": "1:189",
      "shares": "32.18",
      "numberOfParticipants": 89,
      "startTs": 1735689600000,
      "endTs": 1735776000000,
      "status": "ACTIVE",
      "algorithm": "Scrypt",
      "isDualCrypto": true,
      "currencyAlgoTicket": {
        "id": "PALLADIUM_TEAM",
        "name": "Palladium Team"
      }
    }
  ]
}
```

**Key Fields**:
- `id`: Team package identifier
- `currencyAlgoTicket.id`: Package ID for purchasing
- `probability` / `mainProbability`: Probability for main crypto
- `mergeProbability`: Probability for merge crypto (Palladium only)
- `shares`: Current total share percentage
- `numberOfParticipants`: Number of participants in pool
- `startTs` / `endTs`: Package start/end timestamps (milliseconds)
- `isDualCrypto`: Boolean for dual-crypto packages

**Usage Notes**:
- Returns currently active team packages
- Used for Buy Packages page and team alerts
- Share percentage is cumulative from all participants
- Public endpoint - no authentication required

---

### 2.2 Purchase Team Package Shares

**Endpoint**: `POST /hashpower/api/v2/hashpower/shared/ticket/{packageId}`

**Authentication**: ✅ Required

**Functions**:
- `buyTeamPackageUpdated(packageId, crypto, cardId)` - Manual buy
- Auto-buy function (line 8376+) - Automatic buy

**Purpose**: Purchase shares in a team mining package

**Request**:
```javascript
const packageId = "GOLD_TEAM";
const shares = 5; // Number of shares to purchase
const totalAmount = shares * 0.0001; // 1 share = 0.0001 BTC
const endpoint = `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`;

const bodyData = {
    amount: totalAmount,
    shares: {
        small: shares,
        medium: 0,
        large: 0,
        couponSmall: 0,
        couponMedium: 0,
        couponLarge: 0,
        massBuy: 0
    },
    soloMiningRewardAddr: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
};

const body = JSON.stringify(bodyData);
const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

// Via proxy
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'POST',
        headers: headers,
        body: bodyData
    })
})

// Direct
fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'POST',
    headers: headers,
    body: body
})
```

**Request Body**:
```json
{
  "amount": 0.0005,
  "shares": {
    "small": 5,
    "medium": 0,
    "large": 0,
    "couponSmall": 0,
    "couponMedium": 0,
    "couponLarge": 0,
    "massBuy": 0
  },
  "soloMiningRewardAddr": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
}
```

**Request Body (Dual-Crypto - Palladium)**:
```json
{
  "amount": 0.0005,
  "shares": {
    "small": 5,
    "medium": 0,
    "large": 0,
    "couponSmall": 0,
    "couponMedium": 0,
    "couponLarge": 0,
    "massBuy": 0
  },
  "soloMiningRewardAddr": "ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "mergeSoloMiningRewardAddr": "DGq2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
}
```

**Key Request Fields**:
- `amount`: Total BTC amount (shares × 0.0001)
- `shares.small`: Number of small shares (1 share = 0.0001 BTC)
- `soloMiningRewardAddr`: Withdrawal address for rewards (main crypto)
- `mergeSoloMiningRewardAddr`: Withdrawal address for merge crypto (Palladium only)

**Response**:
```json
{
  "id": "order-abc123-def456",
  "orderId": "order-abc123-def456",
  "success": true,
  "status": "ACTIVE",
  "ticketId": "GOLD_TEAM",
  "amount": "0.00050000",
  "shares": 5,
  "currency": "BTC",
  "soloMiningRewardAddr": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "createdAt": 1735689600000
}
```

**Key Response Fields**:
- `id` / `orderId`: Order identifier
- `success`: Purchase success indicator
- `shares`: Number of shares purchased
- `status`: Order status

**Share Calculation**:
- 1 share = 0.0001 BTC
- 5 shares = 0.0005 BTC
- Amount = shares × 0.0001

**Usage Notes**:
- Single POST request for all shares (not 1 per share)
- Must provide withdrawal address for rewards
- Dual-crypto packages (Palladium) require TWO addresses
- Requires sufficient BTC balance
- Response includes order ID for tracking

---

## 3. Order Management

### 3.1 Get Solo Order History (With Rewards)

**Endpoint**: `GET /main/api/v2/hashpower/solo/order?rewardsOnly=true&limit=5000`

**Authentication**: ✅ Required

**Function**: `fetchNiceHashOrders()` - Part of multi-endpoint fetch

**Purpose**: Get solo packages that have found blocks/rewards

**Request**:
```javascript
const endpoint = '/main/api/v2/hashpower/solo/order?rewardsOnly=true&limit=5000';
const headers = generateNiceHashAuthHeaders('GET', endpoint);

// Via proxy
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'GET',
        headers: headers
    })
})

// Direct
fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'GET',
    headers: headers
})
```

**Response**:
```json
{
  "list": [
    {
      "id": "order-123",
      "ticketId": "GOLD_S",
      "amount": "0.00010000",
      "payedAmount": "0.00050000",
      "availableAmount": "0.00030000",
      "status": "COMPLETED",
      "blocksFound": 3,
      "currency": "BTC",
      "createdAt": 1735689600000,
      "endedAt": 1735776000000
    }
  ]
}
```

**Key Fields**:
- `blocksFound`: Number of blocks found
- `payedAmount`: Total rewards paid out
- `availableAmount`: Rewards available for withdrawal
- `amount`: Initial package cost

---

### 3.2 Get Active Solo Orders

**Endpoint**: `GET /main/api/v2/hashpower/solo/order?limit=5000&active=true`

**Authentication**: ✅ Required

**Function**: `fetchNiceHashOrders()` - Part of multi-endpoint fetch

**Purpose**: Get currently active solo packages

**Request**:
```javascript
const endpoint = '/main/api/v2/hashpower/solo/order?limit=5000&active=true';
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'GET',
        headers: headers
    })
})
```

**Response**:
```json
{
  "list": [
    {
      "id": "order-456",
      "ticketId": "SILVER_S",
      "amount": "0.00010000",
      "status": "ACTIVE",
      "blocksFound": 0,
      "currency": "BCH",
      "createdAt": 1735689600000,
      "estimatedEndAt": 1735776000000
    }
  ]
}
```

**Usage Notes**:
- Shows packages currently mining
- `blocksFound` may be 0 for active packages
- Used to track active investments

---

### 3.3 Get Completed Solo Orders

**Endpoint**: `GET /main/api/v2/hashpower/solo/order?limit=5000&status=COMPLETED`

**Authentication**: ✅ Required

**Function**: `fetchNiceHashOrders()` - Part of multi-endpoint fetch

**Purpose**: Get completed solo packages (mining finished)

**Request**:
```javascript
const endpoint = '/main/api/v2/hashpower/solo/order?limit=5000&status=COMPLETED';
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'GET',
        headers: headers
    })
})
```

**Response**:
```json
{
  "list": [
    {
      "id": "order-789",
      "ticketId": "CHROMIUM_S",
      "amount": "0.00010000",
      "payedAmount": "0.00000000",
      "status": "COMPLETED",
      "blocksFound": 0,
      "currency": "RVN",
      "createdAt": 1735689600000,
      "endedAt": 1735776000000
    }
  ]
}
```

**Usage Notes**:
- Shows historical packages
- `blocksFound` can be 0 (no luck)
- `payedAmount` shows total earnings

---

### 3.4 Get Order Rewards

**Endpoint**: `GET /main/api/v2/hashpower/order/{orderId}/rewards`

**Authentication**: ✅ Required

**Function**: Used internally for reward tracking

**Purpose**: Get detailed reward information for a specific order

**Request**:
```javascript
const orderId = "order-abc123";
const endpoint = `/main/api/v2/hashpower/order/${orderId}/rewards`;
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'GET',
    headers: headers
})
```

**Response**:
```json
{
  "list": [
    {
      "blockHash": "00000000000000000001a2b3c4d5e6f7",
      "blockHeight": 823456,
      "amount": "0.00012500",
      "currency": "BTC",
      "timestamp": 1735689600000
    }
  ]
}
```

**Usage Notes**:
- Shows individual block rewards
- Used for detailed reward breakdown
- May be empty if no blocks found

---

## 4. Account & Balances

### 4.1 Get Account Balances (All Currencies)

**Endpoint**: `GET /main/api/v2/accounting/accounts2`

**Authentication**: ✅ Required

**Function**: `fetchNiceHashBalances()`

**Purpose**: Get balances for all currencies in account

**Request**:
```javascript
const endpoint = '/main/api/v2/accounting/accounts2';
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'GET',
        headers: headers
    })
})
```

**Response**:
```json
{
  "currencies": [
    {
      "currency": "BTC",
      "available": "0.00123456",
      "pending": "0.00000000",
      "total": "0.00123456"
    },
    {
      "currency": "LTC",
      "available": "0.12345678",
      "pending": "0.01000000",
      "total": "0.13345678"
    }
  ],
  "total2": {
    "currency": "BTC",
    "totalBalance": "0.00123456"
  }
}
```

**Key Fields**:
- `available`: Available balance for withdrawal/spending
- `pending`: Pending deposits/transactions
- `total`: Total balance (available + pending)

**Usage Notes**:
- Shows all currency balances in account
- Used to check if sufficient balance before purchases
- Returns array of all currencies with balances

---

### 4.2 Get Single Currency Balance

**Endpoint**: `GET /main/api/v2/accounting/account2/{currency}?extendedResponse=true`

**Authentication**: ✅ Required

**Function**: Internal balance checking

**Purpose**: Get detailed balance for specific currency

**Request**:
```javascript
const currency = "BTC";
const endpoint = `/main/api/v2/accounting/account2/${currency}?extendedResponse=true`;
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'GET',
    headers: headers
})
```

**Response**:
```json
{
  "currency": "BTC",
  "available": "0.00123456",
  "pending": "0.00000000",
  "total": "0.00123456",
  "debt": "0.00000000"
}
```

---

### 4.3 Get Hashpower Earnings

**Endpoint**: `GET /main/api/v2/accounting/hashpowerEarnings/{currency}?timestamp={timestamp}&page=0&size=100`

**Authentication**: ✅ Required

**Function**: Internal earnings tracking

**Purpose**: Get earnings history for hashpower

**Request**:
```javascript
const currency = "BTC";
const timestamp = Date.now();
const endpoint = `/main/api/v2/accounting/hashpowerEarnings/${currency}?timestamp=${timestamp}&page=0&size=100`;
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'GET',
    headers: headers
})
```

**Response**:
```json
{
  "list": [
    {
      "amount": "0.00001234",
      "currency": "BTC",
      "timestamp": 1735689600000,
      "type": "HASHPOWER_MINING"
    }
  ],
  "pagination": {
    "page": 0,
    "size": 100,
    "totalRecords": 150
  }
}
```

---

## 5. Withdrawal Addresses

### 5.1 List Saved Withdrawal Addresses

**Endpoint**: `GET /main/api/v2/hashpower/sharedTicketExternalAddress/list`

**Authentication**: ✅ Required

**Function**: `loadNiceHashSavedAddresses()`

**Purpose**: Get list of saved withdrawal addresses for team packages

**Request**:
```javascript
const endpoint = '/main/api/v2/hashpower/sharedTicketExternalAddress/list';
const headers = generateNiceHashAuthHeaders('GET', endpoint);

fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'GET',
        headers: headers
    })
})
```

**Response**:
```json
{
  "list": [
    {
      "id": "addr-123",
      "currency": "BTC",
      "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "name": "My BTC Wallet",
      "isDefault": true
    },
    {
      "id": "addr-456",
      "currency": "LTC",
      "address": "ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "name": "My LTC Wallet",
      "isDefault": false
    },
    {
      "id": "addr-789",
      "currency": "DOGE",
      "address": "DGq2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "name": "My DOGE Wallet",
      "isDefault": false
    }
  ]
}
```

**Key Fields**:
- `currency`: Cryptocurrency code (BTC, LTC, DOGE, etc.)
- `address`: Withdrawal address
- `name`: User-defined name for address
- `isDefault`: Whether this is the default address for this currency

**Usage Notes**:
- Used to auto-populate withdrawal addresses
- Addresses must be saved in NiceHash account first
- User can select from saved addresses or enter new one
- Required for team package purchases

---

## 6. Time Synchronization

### 6.1 Get NiceHash Server Time

**Endpoint**: `GET /api/v2/time`

**Authentication**: ❌ Not required (public endpoint)

**Function**: `syncNiceHashTime()`

**Purpose**: Synchronize client time with NiceHash server for HMAC signatures

**Request**:
```javascript
const endpoint = '/api/v2/time';

// Via proxy
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: endpoint,
        method: 'GET',
        headers: {},
        isPublic: true
    })
})

// Direct
fetch('https://api2.nicehash.com/api/v2/time', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
})
```

**Response**:
```json
{
  "serverTime": 1735689600000
}
```

**Key Fields**:
- `serverTime`: Current server timestamp in milliseconds

**Usage Notes**:
- **CRITICAL**: Must be called before any authenticated request
- Used to calculate time offset: `niceHashTimeOffset = serverTime - Date.now()`
- HMAC signature uses server time, not client time
- Prevents signature validation failures due to clock drift
- Called in `syncNiceHashTime()` before purchases

---

## 7. Authentication Headers

### 7.1 HMAC-SHA256 Signature Generation

**Function**: `generateNiceHashAuthHeaders(method, endpoint, body)`

**Purpose**: Generate authentication headers for NiceHash API requests

**Implementation**:
```javascript
function generateNiceHashAuthHeaders(method, endpoint, body = null) {
    const apiKey = easyMiningSettings.apiKey;
    const apiSecret = easyMiningSettings.apiSecret;
    const orgId = easyMiningSettings.orgId;

    // Use synchronized server time
    const timestamp = Date.now() + niceHashTimeOffset;
    const nonce = uuidv4(); // Generate unique request ID

    // Build signature string
    const message = [
        apiKey,
        timestamp,
        nonce,
        null, // Reserved
        orgId,
        null, // Reserved
        method,
        endpoint,
        null, // Reserved
        body || '' // Request body (empty string if null)
    ].join('\x00'); // Join with NULL byte

    // Generate HMAC-SHA256 signature
    const signature = CryptoJS.HmacSHA256(message, apiSecret).toString();

    // Return headers
    return {
        'X-Time': timestamp,
        'X-Nonce': nonce,
        'X-Auth': `${apiKey}:${signature}`,
        'X-Organization-Id': orgId,
        'X-Request-Id': nonce,
        'Content-Type': 'application/json'
    };
}
```

**Header Fields**:
- `X-Time`: Request timestamp (must match NiceHash server time)
- `X-Nonce`: Unique request identifier (UUID v4)
- `X-Auth`: API key and HMAC signature (`apiKey:signature`)
- `X-Organization-Id`: NiceHash organization ID
- `X-Request-Id`: Request tracking ID (same as nonce)
- `Content-Type`: Always `application/json`

**Signature Components** (joined with NULL byte `\x00`):
1. API Key
2. Timestamp
3. Nonce (UUID)
4. `null` (reserved)
5. Organization ID
6. `null` (reserved)
7. HTTP Method (GET/POST)
8. Endpoint path (including query params)
9. `null` (reserved)
10. Request body (stringified JSON or empty string)

**Critical Notes**:
- **MUST call `syncNiceHashTime()` first** to get correct timestamp
- Signature is case-sensitive
- NULL bytes (`\x00`) are required separators
- Body must be stringified JSON or empty string
- Endpoint must include query parameters if present

---

## 8. Proxy vs Direct Calls

### 8.1 Vercel Proxy Mode

**When**: `USE_VERCEL_PROXY = true`

**Format**:
```javascript
fetch(VERCEL_PROXY_ENDPOINT, {
    method: 'POST', // Always POST to proxy
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        endpoint: '/main/api/v2/...',
        method: 'GET', // Actual NiceHash method
        headers: {...}, // NiceHash auth headers
        body: {...}, // NiceHash request body (optional)
        isPublic: false // True for public endpoints
    })
})
```

**Benefits**:
- Bypasses CORS restrictions
- Hides API credentials from client
- Centralized request handling

---

### 8.2 Direct API Calls

**When**: `USE_VERCEL_PROXY = false`

**Format**:
```javascript
fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'GET', // or 'POST'
    headers: generateNiceHashAuthHeaders('GET', endpoint),
    body: body // For POST requests
})
```

**Notes**:
- Direct connection to NiceHash API
- Requires CORS enabled in NiceHash
- May expose API credentials in browser

---

## 9. Common Response Patterns

### 9.1 Success Response

```json
{
  "id": "...",
  "success": true,
  "status": "ACTIVE"
}
```

### 9.2 Error Response

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient BTC balance for this order"
  }
}
```

**Common Error Codes**:
- `INSUFFICIENT_FUNDS`: Not enough balance
- `INVALID_SIGNATURE`: Authentication failed (time sync issue)
- `PACKAGE_NOT_FOUND`: Invalid package ID
- `INVALID_ADDRESS`: Invalid withdrawal address
- `RATE_LIMIT_EXCEEDED`: Too many requests

---

## 10. Usage Examples

### 10.1 Complete Manual Team Package Purchase Flow

```javascript
// 1. Sync time
await syncNiceHashTime();

// 2. Get package ID
const packageId = "GOLD_TEAM";
const shares = 3;
const totalAmount = shares * 0.0001;

// 3. Get withdrawal address
const address = getWithdrawalAddress('BTC');

// 4. Create request
const endpoint = `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`;
const bodyData = {
    amount: totalAmount,
    shares: {
        small: shares,
        medium: 0,
        large: 0,
        couponSmall: 0,
        couponMedium: 0,
        couponLarge: 0,
        massBuy: 0
    },
    soloMiningRewardAddr: address
};

// 5. Generate auth headers
const body = JSON.stringify(bodyData);
const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

// 6. Make request
const response = await fetch(`https://api2.nicehash.com${endpoint}`, {
    method: 'POST',
    headers: headers,
    body: body
});

// 7. Handle response
const result = await response.json();
console.log('Order ID:', result.id);
```

### 10.2 Check Package Probability Before Alert

```javascript
// 1. Fetch solo packages (public, no auth)
const soloPackages = await fetchNiceHashSoloPackages();

// 2. Find specific package
const goldPackage = soloPackages.find(p => p.name === 'Gold S');

// 3. Extract probability
const probabilityMatch = goldPackage.probability.match(/1:(\d+)/);
const probabilityValue = parseInt(probabilityMatch[1]); // e.g., 142

// 4. Check against threshold
const threshold = 130;
if (probabilityValue <= threshold) {
    console.log('Alert! Probability met threshold');
}
```

---

## 11. Important Notes

### Authentication
- **Always call `syncNiceHashTime()` before authenticated requests**
- Signature includes server timestamp, not client timestamp
- Invalid time = `INVALID_SIGNATURE` error

### Rate Limiting
- No official rate limit documented
- Recommended: 1-2 second delay between requests
- Auto-buy has 1-hour cooldown per package

### Dual-Crypto Packages
- Palladium mines both LTC (main) and DOGE (merge)
- Requires TWO withdrawal addresses
- Has TWO probability values
- Request body includes `mergeSoloMiningRewardAddr`

### Package IDs
- Solo packages use ticket ID (e.g., "GOLD_S")
- Team packages use `currencyAlgoTicket.id` or `apiData.id`
- Always use consistent ID across purchases for proper tracking

### Share Calculations
- 1 share = 0.0001 BTC
- Amount must match shares: `amount = shares × 0.0001`
- Shares object always uses `small` field for standard shares

---

## 12. Troubleshooting

### Issue: INVALID_SIGNATURE
**Cause**: Time synchronization issue
**Solution**: Call `syncNiceHashTime()` before request

### Issue: INSUFFICIENT_FUNDS
**Cause**: Not enough BTC balance
**Solution**: Check balance via `fetchNiceHashBalances()`

### Issue: Empty Response
**Cause**: Wrong endpoint or missing data
**Solution**: Check response has `list` property, use fallback: `data.list || []`

### Issue: Package Not Found
**Cause**: Invalid package ID
**Solution**: Verify ID from `fetchNiceHashSoloPackages()` or `fetchNiceHashTeamPackages()`

---

## 13. Changelog

**Version 1.6** (2025-01-23):
- ✅ Added dual small package probability for Palladium
- ✅ Fixed team package purchase to use single POST
- ✅ Added `shares` object to all purchase requests
- ✅ Standardized `amount` field in all purchases
- ✅ Implemented proper time synchronization

---

**Document Version**: 1.0
**Last Updated**: 2025-01-23
**App Version**: CryptFolio v1.6
