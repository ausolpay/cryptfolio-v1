# NiceHash 401 Authentication Fix - FINAL SOLUTION

## The Real Problem

After analyzing the **official NiceHash Python client**, I found the critical error:

### WRONG Approach (Previous Fix)
```javascript
// ❌ INCORRECT: Parsing API secret as hex
const secretKeyHex = easyMiningSettings.apiSecret.replace(/-/g, '');
const secretKeyParsed = CryptoJS.enc.Hex.parse(secretKeyHex);
const signature = CryptoJS.HmacSHA256(message, secretKeyParsed).toString(CryptoJS.enc.Hex);
```

### CORRECT Approach (Official Method)
```javascript
// ✅ CORRECT: Use API secret as UTF-8 string (with dashes)
const signature = CryptoJS.HmacSHA256(message, easyMiningSettings.apiSecret).toString(CryptoJS.enc.Hex);
```

## What Changed

Based on the **official NiceHash Python implementation**:
```python
# From nicehash/rest-clients-demo/python/nicehash.py
digest = hmac.new(bytearray(self.secret, 'utf-8'), message, sha256).hexdigest()
```

The API secret must be:
- Used **as-is** (keep the dashes: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- Treated as a **UTF-8 string**, NOT hex bytes
- Passed directly to the HMAC function

## Files Changed

1. **scripts.js** (lines 3893-3896)
   - Removed hex parsing of API secret
   - Now uses API secret directly as UTF-8 string
   - Matches official NiceHash implementation

2. **scripts.js** (lines 3817-3863)
   - Enhanced time synchronization error handling
   - Added warnings for large time offsets
   - Better error messages

## Deploy Instructions

```bash
git add .
git commit -m "Fix NiceHash 401: Use API secret as UTF-8 string (not hex)

Based on official NiceHash Python client implementation
- API secret must be used as-is with dashes
- Treat as UTF-8 string, not hex bytes
- Matches nicehash/rest-clients-demo/python/nicehash.py"

git push origin main
```

## Testing Checklist

After Vercel deploys (1-2 minutes):

### 1. Verify Credentials Format
Your credentials should look like this (WITH dashes):
```
API Key:    4efc2f6e-7d98-4c6e-9c4b-8f3a5e9d7c2b
API Secret: 9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d
Org ID:     1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d
```

### 2. Get Fresh Credentials (Recommended)
Since you've been testing with the same credentials, they might be rate-limited or flagged:

1. Go to NiceHash.com → Settings → API Keys
2. **Create a NEW API key** with these permissions:
   - ✅ View Mining Data
   - ✅ View Wallet
   - ✅ Manage Mining (optional)
3. Copy the credentials immediately (you can't view API Secret later)

### 3. Test in Browser
1. Open your Vercel app
2. Login to CryptFolio
3. Go to Settings → EasyMining
4. **IMPORTANT**: Clear old credentials first (delete existing values)
5. Paste the new credentials
6. Enable EasyMining toggle
7. Click Save Settings

### 4. Check Console (F12)

**Look for SUCCESS indicators**:
```
⏰ Time sync complete
🔐 Auth Debug:
  API Key: 4efc2f6e...
  API Secret (first 8 chars): 9a8b7c6d...  <-- Should match your secret
  ...
📝 Message to sign (with \0 shown as |):
  4efc2f6e-...|1700000000|uuid|...     <-- API key WITH dashes

📡 Fetching balances from NiceHash...
Response status: 200                    <-- SUCCESS!
✅ Live data fetched successfully
Available BTC: 0.00012345
```

**Look for FAILURE indicators**:
```
Response status: 401                    <-- STILL FAILING
❌ API Error: 401 Unauthorized
```

## If Still Getting 401 Errors

### Double-Check Credentials

**Test 1: Verify credentials on NiceHash**
1. Log into NiceHash.com
2. Go to Settings → API Keys
3. Click your API key
4. Verify:
   - ✅ Status: Active (not Disabled/Revoked)
   - ✅ Permissions: Has required permissions
   - ✅ Created: Not too old (if old, create new)

**Test 2: Verify you copied correctly**
Common mistakes:
- ❌ Copied Organization ID instead of API Key
- ❌ Extra spaces at beginning/end
- ❌ Missing dashes in UUID format
- ❌ Mixed up API Key and API Secret

**Test 3: Check time synchronization**
```
// In browser console, look for:
⏰ Time sync complete:
  offset: 234ms        <-- Should be small (< 5000ms)

// If offset is > 5000ms:
⚠️ Large time offset detected
```

If time offset is large, check your system clock.

**Test 4: Verify message format**
In console, check the "Message to sign" line:
```
📝 Message to sign (with \0 shown as |):
4efc2f6e-...|1700000000|uuid||org-id||GET|/main/api/v2/accounting/accounts2|
```

Format should be:
```
APIKey|Timestamp|Nonce||OrgID||Method|Path|Query
```

- API Key should have dashes
- All three UUIDs (API Key, Nonce, Org ID) should have dashes
- Query can be empty (nothing after final |)

### Check Vercel Logs

If authentication is still failing:

1. Go to Vercel Dashboard
2. Your Project → Deployments
3. Click latest deployment
4. Click "View Function Logs"
5. Look for NiceHash proxy errors
6. Check what NiceHash is returning

## Technical Details

### Signature Generation (From Official Python Client)

```python
# Build message
message = bytearray(self.key, 'utf-8')                    # API Key
message += bytearray('\x00', 'utf-8')
message += bytearray(str(xtime), 'utf-8')                 # Timestamp
message += bytearray('\x00', 'utf-8')
message += bytearray(xnonce, 'utf-8')                     # Nonce
message += bytearray('\x00', 'utf-8')
message += bytearray('\x00', 'utf-8')                     # Empty
message += bytearray(self.organisation_id, 'utf-8')       # Org ID
message += bytearray('\x00', 'utf-8')
message += bytearray('\x00', 'utf-8')                     # Empty
message += bytearray(method, 'utf-8')                     # GET/POST
message += bytearray('\x00', 'utf-8')
message += bytearray(path, 'utf-8')                       # /main/api/v2/...
message += bytearray('\x00', 'utf-8')
message += bytearray(query, 'utf-8')                      # Query string (can be empty)

if body:
    body_json = json.dumps(body)
    message += bytearray('\x00', 'utf-8')
    message += bytearray(body_json, 'utf-8')

# Generate signature with API secret as UTF-8 bytes
digest = hmac.new(bytearray(self.secret, 'utf-8'), message, sha256).hexdigest()

# Create X-Auth header
xauth = self.key + ":" + digest
```

### JavaScript Equivalent (CryptFolio Implementation)

```javascript
// Build message (exact same format as Python)
let message = easyMiningSettings.apiKey + '\x00' +
              timestamp + '\x00' +
              nonce + '\x00' +
              '\x00' +
              easyMiningSettings.orgId + '\x00' +
              '\x00' +
              method + '\x00' +
              path + '\x00' +
              queryString;

if (bodyString) {
    message += '\x00' + bodyString;
}

// Generate signature (CryptoJS automatically handles UTF-8 encoding)
const signature = CryptoJS.HmacSHA256(message, easyMiningSettings.apiSecret).toString(CryptoJS.enc.Hex);

// Create X-Auth header
const authHeader = `${easyMiningSettings.apiKey}:${signature}`;
```

## Why Previous Fix Was Wrong

### The Confusion
NiceHash API credentials are in UUID format (hex with dashes):
```
9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d
```

This **looks like** a hex string, so I thought it needed to be parsed as hex bytes.

### The Reality
According to the official Python client, the API secret is:
1. Kept **as-is** (with dashes)
2. Converted to **UTF-8 bytes**
3. Used directly as the HMAC key

The UUID format is just for readability - NiceHash treats it as a regular string, not hex data.

## Expected Results

Once working, you should see:

1. **Console Log**:
   ```
   Response status: 200
   ✅ Live data fetched successfully from NiceHash API
   Available BTC: 0.00012345 (your actual balance)
   Pending BTC: 0.00005678 (your actual pending)
   Active Packages: 3 (your actual count)
   ```

2. **EasyMining Dashboard**:
   - Real BTC balance (not mock 0.00000000)
   - Your actual mining packages
   - Real-time updates every 30 seconds

3. **Auto-Update**:
   - When packages find blocks, your crypto holdings auto-update
   - BTC, BCH, RVN, DOGE, LTC, or KAS added automatically

## References

- **Official NiceHash Python Client**: https://github.com/nicehash/rest-clients-demo/blob/master/python/nicehash.py
- **NiceHash API Docs**: https://docs.nicehash.com/
- **Issue #23 (HMAC Signature)**: https://github.com/nicehash/rest-clients-demo/issues/23

---

**Fix Applied**: 2025-01-17
**Status**: ✅ VERIFIED AGAINST OFFICIAL CLIENT
**Confidence**: HIGH - Matches official NiceHash implementation exactly
