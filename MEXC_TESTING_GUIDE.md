# MEXC Protocol Buffers Testing Guide

## Quick Start

### 1. Start the Server

```bash
# Python
python -m http.server 8000

# OR Node.js
npx serve .
```

### 2. Open the App

Navigate to: `http://localhost:8000`

### 3. Login/Register

- Create an account or login
- Add a cryptocurrency (e.g., "bitcoin" or "btc")

### 4. Open Chart Modal

- Click on any cryptocurrency box to open the price chart modal
- This triggers the MEXC WebSocket connection

### 5. Open Browser Console

Press **F12** to open Developer Tools and view:
- Console tab: WebSocket logs
- Network tab: WebSocket connections (filter by WS)

## What to Look For

### ✅ Successful Connection

```
✅ Chart WebSocket connection opened for btc
   ReadyState: 1 (should be 1 = OPEN)
   ✓ Chart subscribed to BTCUSDT (aggre.deals)
```

### ✅ Receiving Data

You'll see one of these scenarios:

#### Scenario A: JSON Format (Subscription Confirmation)
```
📨 Text message for btc: {"id":1,"code":0}
📋 Chart subscription response: {id: 1, code: 0}
```

#### Scenario B: Binary Protocol Buffers (Price Data)
```
📦 Received Blob data for btc, converting...
📨 Binary data length: 45 bytes (first 50): [10, 28, 66, 84, ...]
⚠️ Not JSON, attempting protobuf decode...
🔍 Protobuf data analysis for btc:
   Length: 45 bytes
   First 100 bytes: [10, 28, 66, 84, 67, 85, 83, 68, 84, ...]
   Readable strings found: ["BTCUSDT"]
   Field 1 (string): "BTCUSDT"
   Field 2 (double): 95234.56
💰 Extracted price from protobuf: $95234.56 USDT
📊 Chart price update for btc: $95234.56 USDT
```

#### Scenario C: JSON Format (New API)
```
📨 Text message for btc: {"channel":"spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT","data":{"price":"95234.56"}}
✅ Successfully parsed as JSON: {channel: "spot@public.aggre.deals...", data: {price: "95234.56"}}
📊 Chart price update for btc: $95234.56 USDT
```

### ❌ Errors to Watch For

#### Connection Failed
```
❌ Chart WebSocket error for btc: Error: ...
```
**Solution:** Check internet connection, verify MEXC endpoint is accessible

#### No Price Extracted
```
⚠️ Could not extract price from protobuf data
```
**Solution:** The binary format may have changed. Check the logged bytes and contact MEXC support for schema.

#### Subscription Failed
```
📋 Chart subscription response: {code: 500, msg: "Invalid channel"}
```
**Solution:** Verify the channel name format is correct for MEXC API

## Network Tab Inspection

### WebSocket Connection Details

1. Open **Network** tab
2. Filter by **WS** (WebSocket)
3. Click on `wbs-api.mexc.com`
4. View:
   - **Headers:** Connection details
   - **Messages:** Raw message flow

### Expected Messages

#### Outgoing (Client → Server)
```json
{
  "method": "SUBSCRIPTION",
  "params": ["spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT"],
  "id": 1
}
```

#### Incoming (Server → Client)
```
Binary frame (45 bytes) - This is the Protocol Buffer data
```

## Debugging Tips

### Enable Verbose Logging

The implementation already includes extensive logging. Look for:
- 📦 Blob data indicators
- 🔍 Protobuf analysis
- 💰 Extracted prices
- 📊 Price updates

### Analyze Binary Data

If prices aren't being extracted, analyze the logged byte arrays:

```javascript
// Example logged data:
// First 100 bytes: [10, 28, 66, 84, 67, 85, 83, 68, 84, ...]

// Manually inspect:
// 10 = tag (field 1, wire type 2 = length-delimited)
// 28 = length (40 bytes)
// 66, 84, 67, 85, 83, 68, 84 = "BTCUSDT" in ASCII
```

### Test Different Cryptocurrencies

Try various symbols to see if decoding works consistently:
- BTC (Bitcoin)
- ETH (Ethereum)
- BNB (Binance Coin)
- SOL (Solana)

Each will create a new WebSocket connection when you open their chart.

## Common Issues

### Issue 1: No Binary Data Received

**Symptoms:**
- Only seeing subscription confirmations
- No price updates

**Solutions:**
- Wait a few seconds (MEXC sends updates every 100ms)
- Check if the symbol is valid on MEXC
- Verify the channel format is correct

### Issue 2: Binary Data But No Price

**Symptoms:**
```
🔍 Protobuf data analysis for btc:
   ...
⚠️ Could not extract price from protobuf data
```

**Solutions:**
- Check the logged field values
- Price might be in a different field number
- MEXC may have changed their schema

### Issue 3: WebSocket Closes Immediately

**Symptoms:**
```
✅ Chart WebSocket connection opened for btc
🔌 Chart WebSocket connection closed for btc
```

**Solutions:**
- MEXC may be rejecting the connection
- Check console for error messages
- Verify the endpoint URL is correct
- Test with MEXC's official WebSocket test tool

## Manual Testing Steps

### Test 1: Basic Connection
1. Open chart for Bitcoin
2. Verify connection opens
3. Verify subscription sent
4. Close chart
5. Verify connection closes

### Test 2: Multiple Cryptocurrencies
1. Add 3-5 different cryptocurrencies
2. Open each chart one at a time
3. Verify each gets its own WebSocket
4. Verify prices update correctly

### Test 3: Rapid Open/Close
1. Open chart
2. Immediately close
3. Open again
4. Verify no duplicate connections

### Test 4: Long-Running Connection
1. Open chart
2. Leave open for 5 minutes
3. Verify price continues updating
4. Check for any error messages

## Expected Behavior

### Price Updates
- Should receive updates every 100ms (10 per second)
- Console may throttle log output
- Chart should update smoothly

### Connection Lifecycle
- Opens when chart modal opens
- Stays open while modal is visible
- Closes when modal closes
- No memory leaks or orphaned connections

## Success Criteria

✅ WebSocket connects successfully
✅ Subscription confirmation received
✅ Binary data received (if Protocol Buffers)
✅ Price extracted from binary data
✅ Chart updates with real-time price
✅ Connection closes cleanly on modal close

## Alternative: Switch to JSON Channel

If Protocol Buffers prove difficult, you can switch to JSON format by changing the channel:

**Current (Protocol Buffers):**
```javascript
const channel = `spot@public.aggre.deals.v3.api.pb@100ms@${symbol.toUpperCase()}USDT`;
```

**Alternative (JSON):**
```javascript
const channel = `spot@public.aggre.deals.v3.api@100ms@${symbol.toUpperCase()}USDT`;
// Remove the .pb suffix
```

This would eliminate Protocol Buffer decoding entirely, as MEXC would send JSON instead.

## Contact Support

If you encounter persistent issues:

1. **MEXC API Support:** https://www.mexc.com/support
2. **MEXC Developer Docs:** https://mexcdevelop.github.io/apidocs/spot_v3_en/#websocket-market-data
3. **GitHub Issue:** Create issue with:
   - Console logs
   - Binary data samples
   - Error messages
   - Network tab screenshots

## Next Steps

After confirming the Protocol Buffer decoding works:

1. **Optimize:** Reduce console logging for production
2. **Error Handling:** Add retry logic for failed extractions
3. **Performance:** Test with 10+ simultaneous connections
4. **Schema:** Request official .proto file from MEXC for proper decoding
5. **Validation:** Add price validation (sanity checks)

## Files to Monitor

- `C:\Users\hanna\cryptfolio-v1\scripts.js` - WebSocket logic
- `C:\Users\hanna\cryptfolio-v1\index.html` - Protobuf library
- Browser console - Real-time logs
- Network tab - WebSocket messages
