# WebSocket Implementation Analysis for MEXC Migration

## Executive Summary

The current implementation uses:
- **MEXC WebSocket** (primary): `wss://wbs.mexc.com/ws` with `spot@public.deals.v3.api@{SYMBOL}USDT`
- **LBank WebSocket** (fallback): `wss://www.lbkex.net/ws/V2/` with tick subscription

**Migration Required**: Update to new MEXC endpoint and trade-by-trade stream format:
- **New Endpoint**: `wss://wbs-api.mexc.com/ws`
- **New Channel**: `spot@public.aggre.deals.v3.api.pb@100ms@{SYMBOL}USDT`

---

## Current WebSocket Architecture

### 1. Global Variables (Lines 32-33, 595-597)

```javascript
// Line 32-33
let socket;
let lastWebSocketUpdate = Date.now();
const twoMinutes = 2 * 60 * 1000;

// Lines 595-597
let lbankSocket;
let isLbankWebSocketOpen = false;
let lastWebSocketUpdateForCrypto = {}; // To track WebSocket updates for each coin
```

**Action Required**: Remove all LBank-related variables.

---

### 2. WebSocket Cycle Management (Lines 290-319 and DUPLICATE 716-745)

**WARNING**: There are TWO identical `setWebSocketCycle()` functions!

```javascript
// Lines 290-319 (FIRST INSTANCE)
function setWebSocketCycle() {
    let isWebSocketOpen = false;

    const openWebSocket = () => {
        if (!isWebSocketOpen) {
            initializeWebSocket();  // MEXC WebSocket
            initializeLBankWebSocket();  // LBank WebSocket ← REMOVE
            isWebSocketOpen = true;
        }
    };

    const closeWebSocket = () => {
        if (isWebSocketOpen) {
            if (socket) {
                socket.close();
            }
            if (lbankSocket) {  // ← REMOVE
                lbankSocket.close();
            }
            isWebSocketOpen = false;
        }
    };

    openWebSocket();

    setInterval(() => {
        closeWebSocket();
        setTimeout(openWebSocket, 5000);
    }, 600000); // Reconnect every 10 minutes
}
```

**Lines 716-745**: EXACT DUPLICATE of the above function.

**Actions Required**:
1. Delete ONE of the duplicate functions (keep lines 290-319, delete 716-745)
2. Remove `initializeLBankWebSocket()` call
3. Remove `lbankSocket.close()` logic
4. Update reconnection interval if needed (currently 10 minutes)

---

### 3. MEXC WebSocket Initialization (Lines 2149-2217)

```javascript
function initializeWebSocket() {
    const wsEndpoint = 'wss://wbs.mexc.com/ws';  // ← UPDATE TO: wss://wbs-api.mexc.com/ws
    socket = new WebSocket(wsEndpoint);
    lastWebSocketUpdate = Date.now();

    socket.onopen = function(event) {
        console.log('WebSocket connection opened');

        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos.forEach(crypto => {
                const subscriptionMessage = JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [`spot@public.deals.v3.api@${crypto.symbol.toUpperCase()}USDT`],
                    // ← UPDATE TO: spot@public.aggre.deals.v3.api.pb@100ms@${crypto.symbol.toUpperCase()}USDT
                    "id": 1
                });

                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(subscriptionMessage);
                } else {
                    socket.addEventListener('open', () => {
                        socket.send(subscriptionMessage);
                    });
                }
            });
        }
    };

    socket.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);

            if (message.msg === 'PONG') {
                return;
            }

            console.log('Message received:', message);

            // ← CURRENT MESSAGE PARSING (needs update)
            if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
                const deals = message.d.deals;
                const firstDeal = deals[0];

                if (firstDeal && firstDeal.p !== undefined && message.s) {
                    const price = parseFloat(firstDeal.p);
                    const symbol = message.s.split('USDT')[0].toLowerCase();

                    console.log(`Extracted price for ${symbol}: ${price}`);

                    lastWebSocketUpdate = Date.now();

                    updatePriceFromWebSocket(symbol, price);
                } else {
                    console.log('Deal structure is not as expected:', firstDeal);
                }
            } else {
                console.log('Unexpected message format or empty data:', message);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    socket.onclose = function(event) {
        console.log('WebSocket connection closed');
    };

    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}
```

**Actions Required**:

1. **Update Endpoint** (Line 2150):
   ```javascript
   const wsEndpoint = 'wss://wbs-api.mexc.com/ws';
   ```

2. **Update Subscription Channel** (Line 2161):
   ```javascript
   "params": [`spot@public.aggre.deals.v3.api.pb@100ms@${crypto.symbol.toUpperCase()}USDT`]
   ```

3. **Update Message Parsing** (Lines 2186-2201):
   Based on mexcapidoc.md, the new message format is:
   ```javascript
   if (data.channel === "spot@public.aggre.deals.v3.api.pb") {
       const trade = data.data;
       const livePrice = trade.price;
       // trade.side = buy/sell
       // trade.volume = amount traded
       // trade.ts = timestamp
   }
   ```

   **New parsing logic**:
   ```javascript
   if (message && message.channel && message.channel.includes('spot@public.aggre.deals')) {
       const trade = message.data;

       if (trade && trade.price !== undefined) {
           const price = parseFloat(trade.price);

           // Extract symbol from channel name
           // Channel format: spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT
           const channelParts = message.channel.split('@');
           const symbolPart = channelParts[channelParts.length - 1]; // Gets "BTCUSDT"
           const symbol = symbolPart.replace('USDT', '').toLowerCase(); // Gets "btc"

           console.log(`Extracted price for ${symbol}: ${price}`);

           lastWebSocketUpdate = Date.now();
           updatePriceFromWebSocket(symbol, price);
       }
   }
   ```

---

### 4. LBank WebSocket Implementation (Lines 599-669) - TO BE REMOVED

```javascript
// Lines 599-669 - ENTIRE SECTION TO BE DELETED
function initializeLBankWebSocket() { ... }
function reconnectLBankWebSocket() { ... }
function monitorLBankWebSocket() { ... }
setInterval(monitorLBankWebSocket, 60000);
```

**Action**: Delete all LBank WebSocket code (lines 595-669).

---

### 5. Price Update Handler (Lines 2310-2410)

```javascript
async function updatePriceFromWebSocket(symbol, priceInUsd, source = 'MEXC') {
    // This function is called by both MEXC and LBank
    // Line 631: updatePriceFromWebSocket(symbol, price, 'LBank'); ← REMOVE LBank call
    // Line 2198: updatePriceFromWebSocket(symbol, price); ← KEEP MEXC call

    // Function body processes price updates - NO CHANGES NEEDED
    // It already handles:
    // - USD to AUD conversion
    // - UI updates
    // - Flash animations
    // - Total holdings calculation
}
```

**Action**: Remove `source` parameter (default to MEXC only) or keep for logging purposes.

---

### 6. Symbol Mapping

**Current Format**:
- **MEXC**: `${crypto.symbol.toUpperCase()}USDT` (e.g., "BTCUSDT")
- **LBank**: `${crypto.symbol.toLowerCase()}_usdt` (e.g., "btc_usdt")

**New Format** (MEXC only):
- `${crypto.symbol.toUpperCase()}USDT` (same as before)

**No changes needed** to symbol formatting logic.

---

## Other WebSocket References to Check

### Lines 2762-2773: Fallback Logic
```javascript
// Function to initialize WebSocket with fallback for MEXC and LBank
function initializeWebSocketWithFallback(symbol) {
    // Set a timeout to switch to LBank WebSocket if MEXC WebSocket fails
    setTimeout(() => {
        if (Date.now() - lastWebSocketUpdate > twoMinutes) {
            console.log(`MEXC WebSocket failed. Switching to LBank WebSocket for ${symbol}`);
            initializeLBankWebSocket(symbol);
        }
    }, 5000); // 5 seconds delay before switching to LBank
}
```

**Action**: Delete this entire fallback function (no longer needed).

---

### Line 3069: Per-Crypto WebSocket
```javascript
function initializeWebSocketForCrypto(symbol) {
    // May contain LBank references - needs inspection
}
```

**Action**: Read this function and remove any LBank references.

---

## Summary of Changes Required

### Files to Modify:
- `C:\Users\hanna\cryptfolio-v1\scripts.js`

### Line-by-Line Changes:

1. **Lines 595-669**: DELETE entire LBank WebSocket section
2. **Line 296**: REMOVE `initializeLBankWebSocket();` call
3. **Lines 306-308**: REMOVE LBank socket close logic
4. **Lines 716-745**: DELETE duplicate `setWebSocketCycle()` function
5. **Line 2150**: UPDATE endpoint to `wss://wbs-api.mexc.com/ws`
6. **Line 2161**: UPDATE subscription channel to `spot@public.aggre.deals.v3.api.pb@100ms@{SYMBOL}USDT`
7. **Lines 2176-2207**: UPDATE message parsing logic for new format
8. **Lines 2762-2773**: DELETE `initializeWebSocketWithFallback()` function
9. **Line 3069+**: INSPECT and clean `initializeWebSocketForCrypto()` function

### Testing Checklist:

1. WebSocket connects to new MEXC endpoint
2. Subscription messages use new channel format
3. Price updates are received and parsed correctly
4. Symbol extraction from channel name works
5. UI updates with price changes
6. Flash animations work
7. Total holdings calculate correctly
8. No console errors related to LBank
9. Reconnection logic works (every 10 minutes)
10. Multiple cryptocurrencies update simultaneously

---

## New Message Format Reference

### Old Format (current):
```json
{
  "s": "BTCUSDT",
  "d": {
    "deals": [
      {
        "p": "45000.00",
        "v": "0.5",
        "t": 1678901234567
      }
    ]
  }
}
```

### New Format (from mexcapidoc.md):
```json
{
  "channel": "spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT",
  "data": {
    "price": "45000.00",
    "volume": "0.5",
    "side": "buy",
    "ts": 1678901234567
  }
}
```

---

## Recommended Implementation Order

1. **Phase 1: Remove LBank**
   - Delete LBank variables (lines 595-597)
   - Delete LBank functions (lines 599-669)
   - Remove LBank calls from setWebSocketCycle (lines 296, 306-308)
   - Delete duplicate setWebSocketCycle (lines 716-745)
   - Delete fallback function (lines 2762-2773)

2. **Phase 2: Update MEXC**
   - Update endpoint URL (line 2150)
   - Update subscription channel format (line 2161)
   - Update message parsing logic (lines 2186-2207)

3. **Phase 3: Test**
   - Test with single crypto (Bitcoin)
   - Test with multiple cryptos
   - Test reconnection logic
   - Test error handling

---

## Additional Notes

### Current Reconnection Strategy:
- WebSocket connections are closed and reopened every 10 minutes (600,000ms)
- 5-second delay between close and reopen

### Current Update Throttling:
- Price updates are deduplicated (lines 2315-2318)
- Only updates UI if price actually changed

### Focus Management:
- System saves/restores input focus during updates (lines 2323-2324, 2408-2409)
- Important for user experience during typing

### Conversion Rate Caching:
- USDT to AUD rate is cached for 15 minutes (lines 2225-2281)
- Reduces API calls to CoinGecko

---

## File Paths (Absolute)

- **Main Script**: `C:\Users\hanna\cryptfolio-v1\scripts.js`
- **API Documentation**: `C:\Users\hanna\cryptfolio-v1\mexcapidoc.md`
- **Project Documentation**: `C:\Users\hanna\cryptfolio-v1\CLAUDE.md`
