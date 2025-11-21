# WebSocket Migration Checklist - MEXC Update & LBank Removal

## Quick Reference: All WebSocket Code Locations in scripts.js

### Global Variables
```
Line 32-34:   let socket; let lastWebSocketUpdate; const twoMinutes;
Line 595-597: let lbankSocket; let isLbankWebSocketOpen; let lastWebSocketUpdateForCrypto;
```

### WebSocket Cycle Management
```
Line 290-319: setWebSocketCycle() - FIRST INSTANCE (KEEP THIS ONE)
Line 716-745: setWebSocketCycle() - DUPLICATE (DELETE THIS ONE)
```

### Main MEXC WebSocket (Primary Implementation)
```
Line 2149-2217: initializeWebSocket() - Main MEXC connection for all user cryptos
```

### LBank WebSocket (TO BE REMOVED)
```
Line 599-647:  initializeLBankWebSocket()
Line 650-657:  reconnectLBankWebSocket()
Line 661-666:  monitorLBankWebSocket()
Line 669:      setInterval(monitorLBankWebSocket, 60000)
```

### Fallback WebSocket (TO BE REMOVED)
```
Line 2763-2774: initializeWebSocketWithFallback(symbol)
Line 2777-2820: initializeMexcWebSocket(symbol) - Per-crypto MEXC connection
```

### Per-Crypto Modal WebSocket (Chart/Detail View)
```
Line 3069-3109: initializeWebSocketForCrypto(symbol) - Used in candlestick chart modal
```

### Price Update Handler
```
Line 2310-2410: updatePriceFromWebSocket(symbol, priceInUsd, source = 'MEXC')
```

---

## Migration Steps

### STEP 1: Remove LBank Code

#### 1.1 Delete Global Variables (Lines 595-597)
```javascript
// DELETE THESE LINES:
let lbankSocket;
let isLbankWebSocketOpen = false;
let lastWebSocketUpdateForCrypto = {}; // To track WebSocket updates for each coin
```

#### 1.2 Delete LBank Functions (Lines 599-669)
```javascript
// DELETE ENTIRE SECTION (71 lines):
function initializeLBankWebSocket() { ... }
lbankSocket.onmessage = function(event) { ... }
lbankSocket.onclose = function() { ... }
lbankSocket.onerror = function(error) { ... }
function reconnectLBankWebSocket() { ... }
function monitorLBankWebSocket() { ... }
setInterval(monitorLBankWebSocket, 60000);
```

#### 1.3 Remove LBank from setWebSocketCycle (Lines 290-319)
```javascript
// Line 296 - DELETE THIS LINE:
initializeLBankWebSocket();  // LBank WebSocket

// Lines 306-308 - DELETE THESE LINES:
if (lbankSocket) {
    lbankSocket.close();
}
```

#### 1.4 Delete Duplicate setWebSocketCycle (Lines 716-745)
```javascript
// DELETE ENTIRE FUNCTION (30 lines)
// This is an exact duplicate of the function at line 290
```

#### 1.5 Delete Fallback Functions (Lines 2763-2820)
```javascript
// DELETE ENTIRE SECTION:
function initializeWebSocketWithFallback(symbol) { ... }
function initializeMexcWebSocket(symbol) { ... }
```

---

### STEP 2: Update MEXC WebSocket (Lines 2149-2217)

#### 2.1 Update Endpoint (Line 2150)
```javascript
// OLD:
const wsEndpoint = 'wss://wbs.mexc.com/ws';

// NEW:
const wsEndpoint = 'wss://wbs-api.mexc.com/ws';
```

#### 2.2 Update Subscription Channel (Line 2161)
```javascript
// OLD:
"params": [`spot@public.deals.v3.api@${crypto.symbol.toUpperCase()}USDT`],

// NEW:
"params": [`spot@public.aggre.deals.v3.api.pb@100ms@${crypto.symbol.toUpperCase()}USDT`]
```

#### 2.3 Update Message Parsing (Lines 2176-2207)
```javascript
// OLD CODE:
socket.onmessage = function(event) {
    try {
        const message = JSON.parse(event.data);

        if (message.msg === 'PONG') {
            return;
        }

        console.log('Message received:', message);

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

// NEW CODE:
socket.onmessage = function(event) {
    try {
        const message = JSON.parse(event.data);

        if (message.msg === 'PONG') {
            return;
        }

        console.log('Message received:', message);

        // New message format: { channel: "spot@public.aggre.deals...", data: { price, volume, side, ts } }
        if (message && message.channel && message.channel.includes('spot@public.aggre.deals')) {
            const trade = message.data;

            if (trade && trade.price !== undefined) {
                const price = parseFloat(trade.price);

                // Extract symbol from channel name
                // Channel format: spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT
                const channelParts = message.channel.split('@');
                const symbolPart = channelParts[channelParts.length - 1]; // Gets "BTCUSDT"
                const symbol = symbolPart.replace('USDT', '').toLowerCase(); // Gets "btc"

                console.log(`[MEXC Trade] ${symbol.toUpperCase()}: $${price} USDT (Volume: ${trade.volume}, Side: ${trade.side})`);

                lastWebSocketUpdate = Date.now();

                updatePriceFromWebSocket(symbol, price);
            } else {
                console.log('Trade data missing price:', trade);
            }
        } else {
            console.log('Unexpected message format or empty data:', message);
        }
    } catch (error) {
        console.error('Error processing WebSocket message:', error);
    }
};
```

---

### STEP 3: Update Per-Crypto Modal WebSocket (Lines 3069-3109)

#### 3.1 Update Endpoint (Line 3070)
```javascript
// OLD:
const wsEndpoint = 'wss://wbs.mexc.com/ws';

// NEW:
const wsEndpoint = 'wss://wbs-api.mexc.com/ws';
```

#### 3.2 Update Subscription Channel (Line 3079)
```javascript
// OLD:
"params": [`spot@public.deals.v3.api@${symbol.toUpperCase()}USDT`],

// NEW:
"params": [`spot@public.aggre.deals.v3.api.pb@100ms@${symbol.toUpperCase()}USDT`]
```

#### 3.3 Update Message Parsing (Lines 3085-3100)
```javascript
// OLD CODE:
currentWebSocket.onmessage = function(event) {
    const message = JSON.parse(event.data);
    if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
        const deals = message.d.deals;
        const firstDeal = deals[0];
        if (firstDeal && firstDeal.p !== undefined) {
            const price = parseFloat(firstDeal.p);
            console.log(`Live price for ${symbol}: ${price} USDT`);

            // Update the price only if the current modal is open and matches the symbol
            if (isModalOpen && currentModalCryptoSymbol === symbol) {
                updatePriceInChart(price); // Update the candlestick chart with live price
            }
        }
    }
};

// NEW CODE:
currentWebSocket.onmessage = function(event) {
    const message = JSON.parse(event.data);

    // New message format
    if (message && message.channel && message.channel.includes('spot@public.aggre.deals')) {
        const trade = message.data;

        if (trade && trade.price !== undefined) {
            const price = parseFloat(trade.price);
            console.log(`[Modal WebSocket] Live price for ${symbol}: ${price} USDT`);

            // Update the price only if the current modal is open and matches the symbol
            if (isModalOpen && currentModalCryptoSymbol === symbol) {
                updatePriceInChart(price); // Update the candlestick chart with live price
            }
        }
    }
};
```

---

## Testing Checklist

### Phase 1: Code Cleanup (No Functionality Yet)
- [ ] Delete lines 595-669 (LBank code)
- [ ] Delete lines 716-745 (duplicate setWebSocketCycle)
- [ ] Delete lines 2763-2820 (fallback functions)
- [ ] Remove LBank calls from setWebSocketCycle (lines 296, 306-308)
- [ ] Verify no syntax errors
- [ ] Verify no references to `lbankSocket` remain

### Phase 2: MEXC Update
- [ ] Update endpoint in initializeWebSocket (line 2150)
- [ ] Update subscription channel (line 2161)
- [ ] Update message parsing (lines 2176-2207)
- [ ] Update endpoint in initializeWebSocketForCrypto (line 3070)
- [ ] Update subscription channel (line 3079)
- [ ] Update message parsing (lines 3085-3100)

### Phase 3: Testing
- [ ] Test with Bitcoin (most common)
- [ ] Test with Ethereum
- [ ] Test with low-cap coin (e.g., Mintlayer - ML)
- [ ] Verify console shows "Message received:" logs
- [ ] Verify prices update in UI
- [ ] Verify flash animations work (green/red)
- [ ] Verify total holdings calculate correctly
- [ ] Test reconnection after 10 minutes
- [ ] Test candlestick chart modal WebSocket
- [ ] Test with multiple cryptos in portfolio (5+)
- [ ] Verify no errors in console
- [ ] Verify symbol extraction works correctly
- [ ] Test edge cases (special symbols, stablecoins)

### Phase 4: Performance Verification
- [ ] Check WebSocket connection status in browser DevTools
- [ ] Verify messages arrive within 100-200ms
- [ ] Verify no memory leaks after extended use
- [ ] Verify CPU usage is reasonable
- [ ] Test with browser tab in background
- [ ] Test after computer sleep/wake

---

## Message Format Comparison

### Old Format (current)
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

**Parsing**:
- Symbol: `message.s` → "BTCUSDT"
- Price: `message.d.deals[0].p` → "45000.00"

### New Format (target)
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

**Parsing**:
- Channel: `message.channel` → "spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT"
- Symbol: Extract from channel → "BTC"
- Price: `message.data.price` → "45000.00"
- Side: `message.data.side` → "buy" or "sell"

---

## Rollback Plan

If issues arise, revert by:

1. Use Git to restore `scripts.js`:
   ```bash
   git checkout scripts.js
   ```

2. Or manually restore these sections from backup:
   - Lines 595-669 (LBank code)
   - Lines 2150, 2161, 2176-2207 (MEXC old format)

---

## Expected Console Output (After Migration)

### On Connection:
```
WebSocket connection opened
[MEXC Trade] BTC: $45231.50 USDT (Volume: 0.5, Side: buy)
[MEXC Trade] ETH: $2341.20 USDT (Volume: 1.2, Side: sell)
Extracted price for btc: 45231.50
Extracted price for eth: 2341.20
```

### Should NOT See:
```
LBank WebSocket connection opened
Reconnecting LBank WebSocket...
LBank WebSocket not open, reconnecting...
MEXC WebSocket failed. Switching to LBank WebSocket
```

---

## File Paths

- **Main Script**: `C:\Users\hanna\cryptfolio-v1\scripts.js`
- **Analysis Doc**: `C:\Users\hanna\cryptfolio-v1\WEBSOCKET_ANALYSIS.md`
- **This Checklist**: `C:\Users\hanna\cryptfolio-v1\WEBSOCKET_MIGRATION_CHECKLIST.md`
- **API Doc**: `C:\Users\hanna\cryptfolio-v1\mexcapidoc.md`

---

## Notes

1. **No API Key Required**: The new MEXC public WebSocket does not require authentication
2. **100ms Update Interval**: Faster than old implementation (was variable)
3. **Trade-by-Trade**: Every trade is sent, giving most accurate price
4. **Symbol Format**: Still uppercase + USDT (e.g., "BTCUSDT")
5. **Reconnection**: Keep existing 10-minute cycle
6. **Error Handling**: Keep existing try/catch blocks
