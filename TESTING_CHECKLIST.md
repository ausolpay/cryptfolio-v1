# 🧪 CryptFolio v1.6 - Testing Checklist

## ✅ Authentication Fix Applied

Your app now has enhanced 401 error handling with:
- ✅ Improved NiceHash signature generation (query parameter added)
- ✅ Credential format validation (UUID with dashes)
- ✅ Detailed console debugging for troubleshooting
- ✅ User-friendly error messages

---

## 🔍 Test the 401 Fix (Localhost)

### Step 1: Clear Browser Cache
1. Press `Ctrl + Shift + Delete` (or `Cmd + Shift + Delete` on Mac)
2. Select "Cached images and files"
3. Click "Clear data"
4. Close and reopen browser

### Step 2: Open Console
1. Press `F12` to open Developer Tools
2. Click on "Console" tab
3. Keep it open to see debug messages

### Step 3: Test Your Credentials
1. Open `index.html` in browser
2. Login to CryptFolio
3. Click "EasyMining Settings"
4. Enter your NiceHash credentials:
   - API Key (with dashes)
   - API Secret (with dashes)
   - Organization ID (with dashes)
5. Click "Activate EasyMining"

### Step 4: Check Console Output

**✅ If credentials are valid format, you'll see:**
```
✅ NiceHash credentials format validated
🔐 Auth Debug:
API Key: 12345678...
Org ID: 87654321-4321-4321-4321-987654321fed
Timestamp: 1234567890123
...
```

**❌ If credentials are invalid format, you'll see:**
```
❌ NiceHash Credential Validation Failed:
  - API Key format invalid (should be UUID with dashes)
```
And an alert will show with instructions.

### Step 5: Check API Response

**If 401 error still occurs, console will show:**
```
❌ 401 Authentication Error - API credentials rejected by NiceHash
📝 Common causes:
  1. Credentials are not in UUID format (must have dashes)
  2. API Key, API Secret, or Org ID is incorrect
  3. API Key lacks necessary permissions in NiceHash
  4. API Key has been revoked or expired

🔧 Next steps:
  1. Check console above for credential validation results
  2. Verify credentials in NiceHash Settings → API Keys
  3. Create new API key if needed with Read/Write permissions
  4. Re-enter credentials in EasyMining Settings
```

And a helpful alert will appear with the same guidance.

---

## 🚀 Deploy to Vercel (Production Test)

### Why Deploy?
- Localhost will use **mock data** due to CORS restrictions
- Vercel will use **live data** via serverless proxy (no CORS issues)

### Quick Deploy Steps

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Fix NiceHash 401 authentication error"
   git push origin main
   ```

2. **Go to Vercel:**
   - Visit https://vercel.com
   - Sign in with GitHub
   - Click "Add New Project"
   - Import your `cryptfolio-v1` repository
   - Click "Deploy"
   - Wait ~1-2 minutes

3. **Test on Vercel:**
   - Visit your Vercel URL (e.g., `https://cryptfolio-v1.vercel.app`)
   - Open Console (F12)
   - Look for:
     ```
     🌐 Environment: Production (Vercel)
     🔧 Using Vercel Proxy: Yes
     ```
   - Login and activate EasyMining
   - Enter your credentials
   - Check console for success messages

---

## 📊 What to Expect

### Success Case (200 Response):
```
✅ NiceHash credentials format validated
🔐 Auth Debug: [shows all auth params]
📡 Fetching balances from NiceHash...
✅ Using Vercel proxy: /api/nicehash
Response status: 200
✅ Live data fetched successfully from NiceHash API
Available BTC: 0.00012345
Active Packages: 3
```

### 401 Error (Authentication Failed):
```
✅ NiceHash credentials format validated
🔐 Auth Debug: [shows all auth params]
📡 Fetching balances from NiceHash...
Response status: 401
❌ 401 Authentication Error - API credentials rejected by NiceHash
[Detailed troubleshooting steps shown in console]
```
**Alert will appear with quick fixes**

### Credential Format Error:
```
❌ NiceHash Credential Validation Failed:
  - API Key format invalid (should be UUID with dashes, e.g., 12345678-1234-1234-1234-123456789abc)
```
**Alert will appear asking you to re-enter credentials**

---

## 🔑 NiceHash Credential Format

Your credentials **MUST** look like this:

```
API Key:    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 characters)
API Secret: 64-72 character hexadecimal string
Org ID:     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 characters)
```

**Rules:**
- ✅ **API Key:** 36 characters (UUID format with 4 dashes)
- ✅ **API Secret:** 64-72 characters (hexadecimal string)
- ✅ **Organization ID:** 36 characters (UUID format with 4 dashes)
- ✅ **No spaces** before or after
- ✅ **Copy/paste from NiceHash** exactly as shown

**How to Get Fresh Credentials:**
1. Go to https://www.nicehash.com/my/settings/keys
2. Click "Create New API Key"
3. Set permissions: ✅ View balances, ✅ View orders, ✅ Create orders
4. Copy credentials **with dashes**
5. Also get your Organization ID from Settings → Organization

---

## 🐛 Common Issues & Fixes

### Issue: "Invalid credentials format" alert
**Fix:** Re-enter credentials making sure to include all dashes

### Issue: 401 error even with correct format
**Possible causes:**
1. Wrong credentials (typo when copying)
2. API key lacks permissions in NiceHash
3. API key expired or revoked
4. Wrong Organization ID

**Fix:**
1. Double-check credentials in NiceHash dashboard
2. Verify API key has Read/Write permissions
3. Create fresh API key if needed
4. Make sure Org ID is from Settings → Organization

### Issue: CORS error on localhost
**Expected behavior!** Localhost cannot connect to NiceHash directly due to browser security. Options:
1. Deploy to Vercel (recommended - real data)
2. Use mock data for local testing (already implemented)

---

## 📝 Files Modified

**Enhanced in this session:**
1. `scripts.js` - lines 3688-3722: Improved 401 error handling
2. `scripts.js` - lines 3743-3766: Enhanced error messages and alerts
3. All NiceHash API functions already have Vercel proxy support ✅

**Guides available:**
- `NICEHASH_401_FIX.md` - Full troubleshooting guide for 401 errors
- `DEPLOY_TO_VERCEL.md` - Quick 5-step deployment guide
- `VERCEL_SETUP_GUIDE.md` - Detailed Vercel setup instructions
- `CORS_FIX_GUIDE.md` - Understanding CORS issues

---

## 🎯 Next Steps

1. **Test locally** (will use mock data due to CORS)
   - Clear cache and refresh page
   - Enter credentials and check console for validation
   - Verify format is correct

2. **Deploy to Vercel** (will use live data via proxy)
   - Push to GitHub
   - Import and deploy on Vercel
   - Test with real NiceHash API

3. **If 401 persists:**
   - Check console for detailed debug info
   - Verify credentials in NiceHash settings
   - Create fresh API key with proper permissions
   - See `NICEHASH_401_FIX.md` for step-by-step guide

---

## 💡 Pro Tips

- **Always check console first** - detailed error info is there
- **Credentials expire** - create fresh ones if key is old
- **Permissions matter** - API key needs Read + Write access
- **Dashes are required** - UUID format must be exact
- **Vercel = live data** - localhost = mock data (due to CORS)

---

**Ready to test!** 🚀

Try entering your credentials and check the console output. The detailed error messages will guide you to the exact issue if authentication fails.
