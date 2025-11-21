# MEXC WebSocket Protocol Buffers Implementation

## Overview

This document describes the implementation of Protocol Buffers decoding for MEXC WebSocket connections in CryptFolio v1.6.

## Implementation Summary

### 1. Added Protocol Buffers Library

**File:** `C:\Users\hanna\cryptfolio-v1\index.html`

Added protobuf.js library before scripts.js:

```html
<!-- Protocol Buffers library for MEXC WebSocket -->
<script src="https://cdn.jsdelivr.net/npm/protobufjs@7.2.5/dist/protobuf.min.js"></script>
```

### 2. Updated Chart WebSocket Message Handler

**File:** `C:\Users\hanna\cryptfolio-v1\scripts.js`

**Function:** `initializeWebSocketForCrypto(symbol)` - Lines 2998-3071

Updated the `onmessage` handler to:
- Detect binary (Blob) vs text (JSON) messages
- Convert Blob to ArrayBuffer and Uint8Array
- Try parsing as JSON first (for subscription confirmations)
- Fall back to Protocol Buffer decoding for binary data
- Log detailed debugging information

### 3. Added Helper Functions

**File:** `C:\Users\hanna\cryptfolio-v1\scripts.js`

#### `handleChartMessage(message, symbol)` - Lines 3073-3105

Handles parsed JSON messages:
- Subscription responses (with `id` or `code`)
- NEW aggre.deals format: `message.channel` + `message.data.price`
- OLD format: `message.d.deals[0].p`
- Updates chart price if modal is open for the correct symbol

#### `decodeChartProtobuf(uint8Array, symbol)` - Lines 3107-3222

Decodes Protocol Buffer binary data:
- Logs binary data analysis (length, bytes, readable strings)
- Implements manual Protocol Buffer wire format parsing
- Supports wire types:
  - **0**: Varint (integers)
  - **1**: 64-bit double (used for prices)
  - **2**: Length-delimited (strings, bytes)
  - **5**: 32-bit float (alternative price format)
- Extracts price from double/float fields
- Updates chart if price is successfully extracted

## Protocol Buffer Wire Format

MEXC uses standard Protocol Buffer encoding:

```
Tag = (field_number << 3) | wire_type

Wire Types:
  0 = Varint (int32, int64, uint32, uint64, sint32, sint64, bool, enum)
  1 = 64-bit (fixed64, sfixed64, double)
  2 = Length-delimited (string, bytes, embedded messages, packed repeated fields)
  5 = 32-bit (fixed32, sfixed32, float)
```

## WebSocket Connection Details

### Main Portfolio WebSocket
- **Endpoint:** `wss://stream.binance.com:9443/ws`
- **Protocol:** JSON (trade streams)
- **Format:** Trade events with price updates
- **Location:** `initializeWebSocket()` - Line 2033

### Chart Modal WebSocket
- **Endpoint:** `wss://wbs-api.mexc.com/ws`
- **Protocol:** Protocol Buffers (.pb)
- **Channel:** `spot@public.aggre.deals.v3.api.pb@100ms@{SYMBOL}USDT`
- **Format:** Binary Protocol Buffer messages
- **Location:** `initializeWebSocketForCrypto(symbol)` - Line 2998

## Subscription Format (MEXC)

```javascript
{
  "method": "SUBSCRIPTION",
  "params": ["spot@public.aggre.deals.v3.api.pb@100ms@BTCUSDT"],
  "id": 1
}
```

## Expected Message Flow

1. **Connect** to `wss://wbs-api.mexc.com/ws`
2. **Subscribe** with JSON message
3. **Receive** subscription confirmation (JSON)
4. **Receive** price updates (Binary Protocol Buffers)

## Binary Data Analysis

The decoder logs:
- Total byte length
- First 100 bytes as array
- Readable ASCII strings found in binary
- Decoded field numbers and values
- Extracted price (if found)

## Example Console Output

```
✅ Chart WebSocket connection opened for btc
   ✓ Chart subscribed to BTCUSDT (aggre.deals)
📦 Received Blob data for btc, converting...
📨 Binary data length: 45 bytes (first 50): [10, 28, 66, 84, 67, 85, 83, 68, 84, ...]
🔍 Protobuf data analysis for btc:
   Length: 45 bytes
   First 100 bytes: [10, 28, 66, 84, 67, ...]
   Readable strings found: ["BTCUSDT"]
   Field 1 (string): "BTCUSDT"
   Field 2 (double): 45234.56
💰 Extracted price from protobuf: $45234.56 USDT
📊 Chart price update for btc: $45234.56 USDT
```

## Error Handling

- **Blob conversion errors:** Logged with data type and content
- **JSON parse errors:** Falls back to protobuf decoding
- **Protobuf decode errors:** Logged with error details
- **Invalid prices:** Filtered (must be > 0 and < 1,000,000)

## Testing

1. Open the app: `http://localhost:8000` (or your server)
2. Add a cryptocurrency (e.g., Bitcoin)
3. Click on the crypto to open the chart modal
4. Open browser console (F12)
5. Observe:
   - WebSocket connection messages
   - Binary data being received
   - Protobuf decoding logs
   - Extracted prices
   - Chart updates

## Future Enhancements

If MEXC provides a .proto schema file, we could:
1. Load the schema using protobuf.js
2. Use `protobuf.load()` to parse the schema
3. Decode messages with `Message.decode(uint8Array)`
4. Access structured fields directly

Example:
```javascript
// With schema
protobuf.load("mexc-schema.proto", function(err, root) {
  const DealMessage = root.lookupType("mexc.DealMessage");
  const message = DealMessage.decode(uint8Array);
  const price = message.price;
});
```

## References

- **MEXC WebSocket API:** https://mexcdevelop.github.io/apidocs/spot_v3_en/#websocket-market-data
- **Protocol Buffers:** https://developers.google.com/protocol-buffers
- **protobuf.js:** https://github.com/protobufjs/protobuf.js

## Files Modified

1. `C:\Users\hanna\cryptfolio-v1\index.html` - Added protobuf.js library
2. `C:\Users\hanna\cryptfolio-v1\scripts.js` - Updated WebSocket handlers and added decoder functions

## Status

✅ **Implemented and ready for testing**

The MEXC WebSocket now:
- Detects binary vs JSON messages
- Attempts JSON parsing first
- Falls back to Protocol Buffer decoding
- Extracts prices from binary data
- Updates the chart with real-time prices
- Provides extensive debugging logs

The implementation will analyze incoming MEXC Protocol Buffer data and extract price information, even without a formal schema file.
