# WebSocket Code Snippets - Before & After

## Complete Code Changes for MEXC Migration

---

## 1. Global Variables

### BEFORE (Lines 32-34, 595-597):
```javascript
let socket;
let lastWebSocketUpdate = Date.now();
const twoMinutes = 2 * 60 * 1000;

let lbankSocket;
let isLbankWebSocketOpen = false;
let lastWebSocketUpdateForCrypto = {}; // To track WebSocket updates for each coin
```

### AFTER (Lines 32-34):
```javascript
let socket;
let lastWebSocketUpdate = Date.now();
const twoMinutes = 2 * 60 * 1000;

// LBank variables removed
```

---

## 2. setWebSocketCycle Function

### BEFORE (Lines 290-319 + duplicate at 716-745):
```javascript
function setWebSocketCycle() {
    let isWebSocketOpen = false;

    const openWebSocket = () => {
        if (!isWebSocketOpen) {
            initializeWebSocket();  // MEXC WebSocket
            initializeLBankWebSocket();  // LBank WebSocket
            isWebSocketOpen = true;
        }
    };

    const closeWebSocket = () => {
        if (isWebSocketOpen) {
            if (socket) {
                socket.close();
            }
            if (lbankSocket) {
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

### AFTER (Lines 290-317):
```javascript
function setWebSocketCycle() {
    let isWebSocketOpen = false;

    const openWebSocket = () => {
        if (!isWebSocketOpen) {
            initializeWebSocket();  // MEXC WebSocket only
            isWebSocketOpen = true;
        }
    };

    const closeWebSocket = () => {
        if (isWebSocketOpen) {
            if (socket) {
                socket.close();
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

// Duplicate function at line 716-745 DELETED
```

---

## 3. Main MEXC WebSocket Initialization

### BEFORE (Lines 2149-2217):
```javascript
function initializeWebSocket() {
    const wsEndpoint = 'wss://wbs.mexc.com/ws';  // OLD ENDPOINT
    socket = new WebSocket(wsEndpoint);
    lastWebSocketUpdate = Date.now();

    socket.onopen = function(event) {
        console.log('WebSocket connection opened');

        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos.forEach(crypto => {
                const subscriptionMessage = JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [`spot@public.deals.v3.api@${crypto.symbol.toUpperCase()}USDT`],  // OLD CHANNEL
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

            // OLD MESSAGE PARSING
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

### AFTER (Lines 2149-2217):
```javascript
function initializeWebSocket() {
    const wsEndpoint = 'wss://wbs-api.mexc.com/ws';  // NEW ENDPOINT
    socket = new WebSocket(wsEndpoint);
    lastWebSocketUpdate = Date.now();

    socket.onopen = function(event) {
        console.log('WebSocket connection opened');

        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos.forEach(crypto => {
                const subscriptionMessage = JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [`spot@public.aggre.deals.v3.api.pb@100ms@${crypto.symbol.toUpperCase()}USDT`],  // NEW CHANNEL
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

            // NEW MESSAGE PARSING
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

    socket.onclose = function(event) {
        console.log('WebSocket connection closed');
    };

    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
}
```

---

## 4. Per-Crypto Modal WebSocket

### BEFORE (Lines 3069-3109):
```javascript
function initializeWebSocketForCrypto(symbol) {
    const wsEndpoint = 'wss://wbs.mexc.com/ws'; // OLD ENDPOINT
    currentWebSocket = new WebSocket(wsEndpoint);

    currentWebSocket.onopen = function() {
        console.log(`WebSocket connection opened for ${symbol}`);

        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIPTION",
            "params": [`spot@public.deals.v3.api@${symbol.toUpperCase()}USDT`],  // OLD CHANNEL
            "id": 1
        });
        currentWebSocket.send(subscriptionMessage);
    };

    currentWebSocket.onmessage = function(event) {
        const message = JSON.parse(event.data);

        // OLD MESSAGE PARSING
        if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
            const deals = message.d.deals;
            const firstDeal = deals[0];
            if (firstDeal && firstDeal.p !== undefined) {
                const price = parseFloat(firstDeal.p);
                console.log(`Live price for ${symbol}: ${price} USDT`);

                if (isModalOpen && currentModalCryptoSymbol === symbol) {
                    updatePriceInChart(price);
                }
            }
        }
    };

    currentWebSocket.onclose = function() {
        console.log(`WebSocket connection closed for ${symbol}`);
    };

    currentWebSocket.onerror = function(error) {
        console.error(`WebSocket error for ${symbol}:`, error);
    };
}
```

### AFTER (Lines 3069-3109):
```javascript
function initializeWebSocketForCrypto(symbol) {
    const wsEndpoint = 'wss://wbs-api.mexc.com/ws';  // NEW ENDPOINT
    currentWebSocket = new WebSocket(wsEndpoint);

    currentWebSocket.onopen = function() {
        console.log(`WebSocket connection opened for ${symbol}`);

        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIPTION",
            "params": [`spot@public.aggre.deals.v3.api.pb@100ms@${symbol.toUpperCase()}USDT`],  // NEW CHANNEL
            "id": 1
        });
        currentWebSocket.send(subscriptionMessage);
    };

    currentWebSocket.onmessage = function(event) {
        const message = JSON.parse(event.data);

        // NEW MESSAGE PARSING
        if (message && message.channel && message.channel.includes('spot@public.aggre.deals')) {
            const trade = message.data;

            if (trade && trade.price !== undefined) {
                const price = parseFloat(trade.price);
                console.log(`[Modal WebSocket] Live price for ${symbol}: ${price} USDT`);

                if (isModalOpen && currentModalCryptoSymbol === symbol) {
                    updatePriceInChart(price);
                }
            }
        }
    };

    currentWebSocket.onclose = function() {
        console.log(`WebSocket connection closed for ${symbol}`);
    };

    currentWebSocket.onerror = function(error) {
        console.error(`WebSocket error for ${symbol}:`, error);
    };
}
```

---

## 5. Functions to DELETE Entirely

### DELETE Lines 599-669: LBank WebSocket
```javascript
// DELETE THIS ENTIRE SECTION:

let lbankSocket;
let isLbankWebSocketOpen = false;
let lastWebSocketUpdateForCrypto = {}; // To track WebSocket updates for each coin

function initializeLBankWebSocket() {
    const wsEndpoint = 'wss://www.lbkex.net/ws/V2/';
    lbankSocket = new WebSocket(wsEndpoint);

    lbankSocket.onopen = function() {
        console.log('LBank WebSocket connection opened');
        isLbankWebSocketOpen = true;

        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos.forEach(crypto => {
                const subscriptionMessage = JSON.stringify({
                    "action": "subscribe",
                    "subscribe": "tick",
                    "pair": `${crypto.symbol.toLowerCase()}_usdt`
                });

                lbankSocket.send(subscriptionMessage);
            });
        }
    };

    lbankSocket.onmessage = function(event) {
        const message = JSON.parse(event.data);
        if (message && message.tick && message.tick.latest) {
            const price = parseFloat(message.tick.latest);
            const symbol = message.pair.split('_')[0].toLowerCase();
            console.log(`Live price for ${symbol}: ${price} USDT`);

            lastWebSocketUpdateForCrypto[symbol] = Date.now();

            updatePriceFromWebSocket(symbol, price, 'LBank');
        }
    };

    lbankSocket.onclose = function() {
        console.log('LBank WebSocket connection closed');
        isLbankWebSocketOpen = false;
        reconnectLBankWebSocket();
    };

    lbankSocket.onerror = function(error) {
        console.error('LBank WebSocket error:', error);
        isLbankWebSocketOpen = false;
        reconnectLBankWebSocket();
    };
}

function reconnectLBankWebSocket() {
    if (!isLbankWebSocketOpen) {
        console.log('Reconnecting LBank WebSocket...');
        setTimeout(() => {
            initializeLBankWebSocket();
        }, 5000);
    }
}

function monitorLBankWebSocket() {
    if (!isLbankWebSocketOpen) {
        console.log('LBank WebSocket not open, reconnecting...');
        initializeLBankWebSocket();
    }
}

setInterval(monitorLBankWebSocket, 60000);
```

### DELETE Lines 716-745: Duplicate setWebSocketCycle
```javascript
// DELETE THIS ENTIRE DUPLICATE FUNCTION:

function setWebSocketCycle() {
    let isWebSocketOpen = false;

    const openWebSocket = () => {
        if (!isWebSocketOpen) {
            initializeWebSocket();  // MEXC WebSocket
            initializeLBankWebSocket();  // LBank WebSocket
            isWebSocketOpen = true;
        }
    };

    const closeWebSocket = () => {
        if (isWebSocketOpen) {
            if (socket) {
                socket.close();
            }
            if (lbankSocket) {
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

### DELETE Lines 2763-2820: Fallback WebSocket Functions
```javascript
// DELETE THIS ENTIRE SECTION:

function initializeWebSocketWithFallback(symbol) {
    initializeMexcWebSocket(symbol);

    setTimeout(() => {
        if (!isMexcWebSocketOpen) {
            console.log(`MEXC WebSocket failed. Switching to LBank WebSocket for ${symbol}`);
            initializeLBankWebSocket(symbol);
        }
    }, 5000);
}

function initializeMexcWebSocket(symbol) {
    const wsEndpoint = 'wss://wbs.mexc.com/ws';
    const socket = new WebSocket(wsEndpoint);

    socket.onopen = function () {
        console.log(`MEXC WebSocket connection opened for ${symbol}`);
        isMexcWebSocketOpen = true;

        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIPTION",
            "params": [`spot@public.deals.v3.api@${symbol.toUpperCase()}USDT`],
            "id": 1
        });
        socket.send(subscriptionMessage);
    };

    socket.onmessage = function (event) {
        const message = JSON.parse(event.data);
        if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
            const deals = message.d.deals;
            const firstDeal = deals[0];
            if (firstDeal && firstDeal.p !== undefined) {
                const price = parseFloat(firstDeal.p);
                console.log(`MEXC live price for ${symbol}: ${price} USDT`);
                updatePriceInChart(symbol, price);
            }
        }
    };

    socket.onclose = function () {
        console.log(`MEXC WebSocket connection closed for ${symbol}`);
        isMexcWebSocketOpen = false;
    };

    socket.onerror = function (error) {
        console.error(`MEXC WebSocket error for ${symbol}:`, error);
        isMexcWebSocketOpen = false;
    };
}
```

---

## Summary of Changes

### Deleted:
- **595-669** (75 lines): LBank WebSocket implementation
- **716-745** (30 lines): Duplicate setWebSocketCycle
- **2763-2820** (58 lines): Fallback WebSocket functions
- **Total deleted**: ~163 lines

### Modified:
- **Line 2150**: Changed endpoint URL
- **Line 2161**: Changed subscription channel format
- **Lines 2176-2207**: Rewrote message parsing logic
- **Line 3070**: Changed endpoint URL
- **Line 3079**: Changed subscription channel format
- **Lines 3085-3100**: Rewrote message parsing logic
- **Lines 290-319**: Removed LBank calls from setWebSocketCycle

### Result:
- Cleaner codebase
- Single WebSocket source (MEXC only)
- Faster updates (100ms trade-by-trade)
- No fallback complexity

---

## Key Differences in New Format

| Aspect | Old Format | New Format |
|--------|-----------|------------|
| **Endpoint** | `wss://wbs.mexc.com/ws` | `wss://wbs-api.mexc.com/ws` |
| **Channel** | `spot@public.deals.v3.api@BTCUSDT` | `spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT` |
| **Message Structure** | `{ s: "BTCUSDT", d: { deals: [...] } }` | `{ channel: "...", data: { price, volume, side, ts } }` |
| **Symbol Location** | `message.s` | Extracted from `message.channel` |
| **Price Location** | `message.d.deals[0].p` | `message.data.price` |
| **Update Speed** | Variable | 100ms aggregated trades |
| **Additional Data** | Deal array | Side (buy/sell), volume, timestamp |

---

## File Paths

- **Main Script**: `C:\Users\hanna\cryptfolio-v1\scripts.js`
- **Analysis**: `C:\Users\hanna\cryptfolio-v1\WEBSOCKET_ANALYSIS.md`
- **Checklist**: `C:\Users\hanna\cryptfolio-v1\WEBSOCKET_MIGRATION_CHECKLIST.md`
- **This Document**: `C:\Users\hanna\cryptfolio-v1\WEBSOCKET_CODE_SNIPPETS.md`
