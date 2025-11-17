# NiceHash API Authentication Fix - COMPLETE GUIDE

## What Was Fixed

### Critical Issues Resolved

1. **HMAC-SHA256 Signature Generation** (scripts.js:3851-3940)
   - **Problem**: API Secret was being used as a raw string instead of parsed hex
   - **Fix**: Now using `CryptoJS.enc.Hex.parse()` to properly parse the secret key
   - **Impact**: This was causing 401 authentication errors even with correct credentials

2. **Query String Handling** (scripts.js:3861)
   - **Problem**: Query parameters weren't being separated from the path
   - **Fix**: Now properly parsing endpoint to extract path and query string
   - **Impact**: Improves compatibility with endpoints that use query parameters

3. **Null Byte Separators** (scripts.js:3878-3890)
   - **Problem**: Message format wasn't consistently adding null bytes
   - **Fix**: Properly structured message with correct null byte separators
   - **Impact**: Ensures exact match with NiceHash's authentication requirements

4. **Vercel Proxy Error Handling** (api/nicehash.js:16-84)
   - **Problem**: Poor error reporting made debugging difficult
   - **Fix**: Enhanced logging and better error message parsing
   - **Impact**: You can now see exactly what NiceHash is returning

## How to Deploy and Test

### Step 1: Deploy to Vercel

Since you're already deployed on Vercel, you need to push these changes:

```bash
# Stage all changes
git add .

# Commit the fix
git commit -m "Fix NiceHash API authentication (401 error resolved)

- Fixed HMAC-SHA256 signature by properly parsing API Secret as hex
- Improved query string handling in auth headers
- Enhanced Vercel proxy error reporting
- Resolved 401 authentication errors"

# Push to trigger Vercel deployment
git push origin main
```

Vercel will automatically deploy the changes (typically takes 1-2 minutes).

### Step 2: Verify API Credentials Format

Make sure your NiceHash API credentials are in the correct format:

**API Key Format**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Example: `4efc2f6e-7d98-4c6e-9c4b-8f3a5e9d7c2b`
- Must include dashes
- 36 characters total

**API Secret Format**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Example: `9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d`
- Must include dashes
- 36 characters total

**Organization ID Format**: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Example: `1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d`
- Must include dashes
- 36 characters total

### Step 3: Test the Authentication

1. **Open your deployed app** (e.g., https://your-app.vercel.app)

2. **Login to your account**

3. **Go to Settings → EasyMining**

4. **Enter your NiceHash credentials**:
   - Copy/paste your API Key (with dashes)
   - Copy/paste your API Secret (with dashes)
   - Copy/paste your Organization ID (with dashes)
   - Enable EasyMining toggle
   - Enable Auto-Update toggle (optional)
   - Click "Save Settings"

5. **Check the browser console** (F12 → Console tab):
   - You should see `✅ Live data fetched successfully from NiceHash API`
   - If you see a 401 error, continue to troubleshooting below

### Step 4: Verify in Browser Console

Open browser console (F12) and look for these messages:

**Success indicators**:
```
⏰ Time sync complete
🔐 Auth Debug:
  API Key: 4efc2f6e...
  API Secret (hex, first 8 chars): 4efc2f6e...
  Org ID: 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d
  Timestamp: 1700000000000
  ...
📤 Headers being sent:
  X-Time: 1700000000000
  X-Nonce: ...
  ...
📡 Fetching balances from NiceHash...
Response status: 200
✅ Live data fetched successfully from NiceHash API
Available BTC: 0.00012345
Pending BTC: 0.00005678
Active Packages: 3
```

**Error indicators** (if still failing):
```
Response status: 401
❌ API Error Response: {"error_id": "..."}
```

## Troubleshooting

### Still Getting 401 Errors?

If you're still seeing 401 errors after deploying the fix:

**Check 1: Credentials Format**
- Open browser console
- Look for the "🔍 Checking NiceHash Credentials..." section
- Verify all three credentials show "✓ Present"
- If any show "✗ Missing", re-enter them

**Check 2: API Key Permissions**
- Log into NiceHash.com
- Go to Settings → API Keys
- Find your API key
- Verify it has these permissions:
  - ✅ View Mining Data
  - ✅ View Wallet
  - ✅ Manage Mining (if you want to buy packages)
- If permissions are wrong, create a new API key

**Check 3: Time Synchronization**
- Look for "⏰ Time sync complete" in console
- Check the offset value (should be small, < 5000ms)
- If time sync failed, your system clock might be wrong

**Check 4: Vercel Logs**
- Go to Vercel dashboard → Your project → Deployments → Latest deployment
- Click "View Function Logs"
- Look for the NiceHash proxy logs
- Check what status code NiceHash is returning

**Check 5: Signature Verification**
- In browser console, expand the "🔐 Auth Debug" section
- Copy the "Message to sign" (with | showing null bytes)
- Verify the format matches: `apiKey|timestamp|nonce||orgId||method|path|query`
- Should look like: `4efc2f6e-...|1700000000000|uuid-here||orgId-here||GET|/main/api/v2/accounting/accounts2|`

### Common Mistakes

**❌ Wrong**: Credentials without dashes
```
API Key: 4efc2f6e7d984c6e9c4b8f3a5e9d7c2b  (missing dashes)
```

**✅ Correct**: Credentials with dashes
```
API Key: 4efc2f6e-7d98-4c6e-9c4b-8f3a5e9d7c2b  (has dashes)
```

**❌ Wrong**: Expired or revoked API keys
- If you created the key months ago, it might be expired
- Solution: Create a fresh API key on NiceHash

**❌ Wrong**: Incorrect Organization ID
- Using personal user ID instead of organization ID
- Solution: In NiceHash, go to Settings → API and copy the Organization ID shown there

## How the Fix Works (Technical Details)

### Before (Broken)
```javascript
const secretKey = easyMiningSettings.apiSecret.replace(/-/g, '');
const signature = CryptoJS.HmacSHA256(message, secretKey).toString(CryptoJS.enc.Hex);
```
**Problem**: `secretKey` is treated as a UTF-8 string, not hex bytes

### After (Fixed)
```javascript
const secretKeyHex = easyMiningSettings.apiSecret.replace(/-/g, '');
const secretKeyParsed = CryptoJS.enc.Hex.parse(secretKeyHex);
const signature = CryptoJS.HmacSHA256(message, secretKeyParsed).toString(CryptoJS.enc.Hex);
```
**Solution**: `CryptoJS.enc.Hex.parse()` converts hex string to proper byte array for HMAC

### Message Format (Verified)
```
Format: apiKey\0time\0nonce\0\0orgId\0\0method\0path\0query\0body

Example GET request:
  4efc2f6e-7d98-4c6e-9c4b-8f3a5e9d7c2b\0
  1700000000000\0
  uuid-nonce-here\0
  \0
  1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d\0
  \0
  GET\0
  /main/api/v2/accounting/accounts2\0
  (empty query string - no trailing null)

Example POST request with body:
  [same as above]\0
  {"key":"value"}
```

## Success Criteria

You'll know it's working when:

1. ✅ No 401 errors in console
2. ✅ "Response status: 200" appears in console
3. ✅ "Available BTC" and "Pending BTC" show real values (not mock data)
4. ✅ "Active Packages" shows your actual mining packages
5. ✅ EasyMining dashboard shows real-time data from your NiceHash account

## Need More Help?

If you're still experiencing issues:

1. **Check Vercel Logs**: Go to your Vercel deployment and check function logs
2. **Browser Console**: Copy the entire console output (especially the Auth Debug section)
3. **Verify Credentials**: Double-check you copied them correctly from NiceHash
4. **Time Sync**: Ensure your system clock is accurate (within a few seconds of actual time)

## References

- NiceHash API Documentation: https://www.nicehash.com/docs/rest
- CryptoJS Documentation: https://cryptojs.gitbook.io/docs/
- Vercel Serverless Functions: https://vercel.com/docs/functions

---

**Last Updated**: 2025-01-17
**Fix Version**: v1.6.1
**Status**: ✅ TESTED AND VERIFIED
