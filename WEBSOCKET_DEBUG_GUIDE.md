# WebSocket Debugging Quick Reference

## Quick Health Check

Open browser console (F12) and look for these indicators:

### Healthy WebSocket Connection
```
✅ Connection initialized with visual separator
✅ ReadyState: 1 (OPEN)
✅ All subscriptions sent successfully
✅ Price updates appearing every few seconds
✅ No error messages in console
```

### Unhealthy WebSocket Connection
```
❌ "Still in CONNECTING state" errors
❌ ReadyState stuck at 0 (CONNECTING)
❌ No subscription confirmations
❌ No price updates after 10+ seconds
❌ Red error messages in console
```

## Common Issues & Solutions

### 1. "Still in CONNECTING state" Error

**Symptom:**
```
Uncaught InvalidStateError: Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.
```

**Cause:** Trying to send messages before WebSocket is fully ready

**Solution:** ✅ FIXED - 150ms delay added before subscriptions

**Verify Fix:**
```javascript
// Should see this in console:
WebSocket readyState: 1 (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)
WebSocket readyState after delay: 1
```

---

### 2. No Price Updates Arriving

**Symptom:**
- WebSocket connects successfully
- Subscriptions sent
- But no price updates appear

**Possible Causes:**

#### A. Symbol doesn't exist on MEXC
```javascript
// Check if symbol is valid
// Visit: https://www.mexc.com/exchange/{SYMBOL}_USDT
// Example: https://www.mexc.com/exchange/BTC_USDT
```

**Solution:**
- Verify symbol exists on MEXC
- Must be traded against USDT (not BTC or other pairs)
- Check symbol spelling matches MEXC exactly

#### B. Wrong subscription format
```javascript
// OLD (doesn't work):
spot@public.deals.v3.api@BTCUSDT

// NEW (correct):
spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT
```

**Solution:** ✅ FIXED - Updated to aggre.deals format

#### C. Message format not recognized
```javascript
// Enable debug logging by checking console for:
📨 Raw message received: { ... }
⚠️ Unexpected message format: { ... }
```

**Solution:**
1. Check first 5 raw messages in console
2. Compare with expected format in WEBSOCKET_FIXES.md
3. Verify message handler is parsing correctly

---

### 3. WebSocket Disconnects Frequently

**Symptom:**
```
🔌 MEXC WebSocket connection closed
🔄 Reconnection attempt 1/5 in 1000ms...
```

**Possible Causes:**

#### A. Network instability
**Solution:** Wait for auto-reconnect (max 5 attempts)

#### B. MEXC server issues
**Solution:** Check MEXC status page or Twitter

#### C. Too many subscriptions
**Solution:** Limit portfolio to reasonable size (<50 cryptos)

---

### 4. Chart Modal WebSocket Issues

**Symptom:**
- Portfolio updates work fine
- But candlestick chart doesn't update

**Check For:**
```javascript
// Should see in console:
✅ Chart WebSocket connection opened for BTC
   ✓ Chart subscribed to BTCUSDT (aggre.deals)
📊 Chart price update for BTC: $45000.00 USDT
```

**If Missing:**
1. Check if chart modal is actually open
2. Verify `currentModalCryptoSymbol` matches subscription
3. Look for "Chart WebSocket not ready" errors

---

## Browser Developer Tools

### Console Tab
```
F12 → Console

Look for:
✅ Green checkmarks = Success
📊 Chart icon = Chart updates
💰 Money bag = Price updates
❌ Red X = Errors
⚠️ Warning triangle = Unexpected behavior
```

### Network Tab
```
F12 → Network → WS (filter)

1. Select WebSocket connection
2. Click "Messages" tab
3. Verify frames are being sent/received

Healthy pattern:
→ {"method":"SUBSCRIPTION","params":[...]}     ← Outgoing
← {"channel":"spot@public.aggre.deals...",..}  ← Incoming
→ {"method":"PING"}                            ← Outgoing (every 20s)
← {"msg":"PONG"}                               ← Incoming
```

### Application Tab
```
F12 → Application → Local Storage

Check user data:
- {username}_cryptos should list all portfolio items
- Each crypto should have valid symbol and ID
```

---

## Console Commands for Debugging

### Check WebSocket State
```javascript
// In browser console:
socket.readyState
// 0 = CONNECTING
// 1 = OPEN (good)
// 2 = CLOSING
// 3 = CLOSED
```

### Check Current User
```javascript
loggedInUser
// Should show your username
```

### Check Portfolio
```javascript
users[loggedInUser].cryptos
// Should show array of crypto objects
// Each should have: id, symbol, name
```

### Check Last WebSocket Update
```javascript
new Date(lastWebSocketUpdate).toLocaleString()
// Shows when last price update was received
```

### Manual WebSocket Test
```javascript
// Test MEXC WebSocket manually:
const testWs = new WebSocket('wss://wbs-api.mexc.com/ws');

testWs.onopen = () => {
    console.log('Test connection opened');
    setTimeout(() => {
        if (testWs.readyState === 1) {
            testWs.send(JSON.stringify({
                method: 'SUBSCRIPTION',
                params: ['spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT']
            }));
            console.log('Test subscription sent');
        }
    }, 150);
};

testWs.onmessage = (e) => {
    console.log('Test message:', JSON.parse(e.data));
};

// Close after 10 seconds:
setTimeout(() => testWs.close(), 10000);
```

---

## Performance Metrics

### Normal Behavior
```
Connection time:     50-200ms
Subscription time:   150ms delay + 50ms processing
First price update:  Within 1-5 seconds
Update frequency:    ~100ms (every trade)
Ping interval:       Every 20 seconds
```

### Abnormal Behavior
```
❌ Connection time:     >5 seconds
❌ Subscription time:   Errors or no confirmation
❌ First price update:  >30 seconds
❌ Update frequency:    No updates or very sparse
❌ Ping interval:       No pings sent
```

---

## Error Messages Reference

### InvalidStateError: Still in CONNECTING state
- **Status:** ✅ FIXED
- **Cause:** Sending before WebSocket ready
- **Solution:** 150ms delay implemented

### WebSocket not ready for subscriptions
- **Cause:** readyState ≠ OPEN after delay
- **Solution:** Check network, increase delay to 300ms if needed

### Unexpected message format
- **Cause:** MEXC changed API format
- **Solution:** Check raw messages, update message handler

### Max reconnection attempts reached
- **Cause:** WebSocket cannot connect after 5 tries
- **Solution:** Refresh page, check network, check MEXC status

---

## Reading Console Output

### Color-Coded Prefixes
```
🚀 Initialization
✅ Success
📬 Subscriptions
🎯 Waiting/Ready
📨 Messages received
💰 Price updates
📊 Chart updates
📡 Ping/Pong
🔌 Disconnections
🔄 Reconnections
❌ Errors
⚠️ Warnings
```

### Message Flow Example
```
[Normal connection sequence]

🚀 Initializing MEXC WebSocket connection...
   Endpoint: wss://wbs-api.mexc.com/ws
✅ MEXC WebSocket connection opened
   WebSocket readyState: 1
   WebSocket readyState after delay: 1
📬 Starting subscriptions for 3 cryptocurrencies...
   ✓ Subscribed to BTCUSDT (aggre.deals trade stream)
   ✓ Subscribed to ETHUSDT (aggre.deals trade stream)
   ✓ Subscribed to ADAUSDT (aggre.deals trade stream)
✅ All subscriptions sent
🎯 Waiting for price updates...
📨 Raw message received: { ... }
💰 Price update for BTC: $45000.00 USDT (buy trade, vol: 0.1)
💰 Price update for ETH: $3000.00 USDT (sell trade, vol: 1.5)
📡 Sending PING to keep connection alive
📡 Received PONG from server
```

---

## When to Contact Support

If you see:
- ❌ Persistent "CONNECTING state" errors AFTER fix applied
- ❌ WebSocket connects but ZERO price updates after 60+ seconds
- ❌ All symbols fail (not just obscure ones)
- ❌ Works in one browser but not another
- ❌ Console shows "undefined" for socket or users

Then:
1. **Take screenshot of console with errors**
2. **Export Network tab WebSocket frames**
3. **Check browser version**
4. **List cryptos in portfolio**
5. **Note when issue started**

---

## Quick Fixes Checklist

Before reporting issues, try:

- [ ] Hard refresh (Ctrl + Shift + R)
- [ ] Clear browser cache
- [ ] Disable browser extensions
- [ ] Try incognito/private mode
- [ ] Try different browser
- [ ] Check internet connection
- [ ] Verify MEXC.com is accessible
- [ ] Check if USDT pairs exist on MEXC
- [ ] Wait 30 seconds for auto-reconnect
- [ ] Check console for specific error messages

---

## Files Reference

- **Main Implementation:** `scripts.js` (lines 2033-2168, 3040-3106)
- **Fix Documentation:** `WEBSOCKET_FIXES.md`
- **API Documentation:** `mexcapidoc.md`
- **Before/After Comparison:** `WEBSOCKET_BEFORE_AFTER.md`
- **This Debug Guide:** `WEBSOCKET_DEBUG_GUIDE.md`
