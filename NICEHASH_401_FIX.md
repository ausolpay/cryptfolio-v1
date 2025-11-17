# NiceHash 401 Error - Authentication Troubleshooting

## 🔴 Error: "API Error 401 - Check Credentials"

This means NiceHash rejected your authentication. Here's how to fix it:

---

## ✅ Step 1: Check Credential Format

NiceHash credentials are **UUIDs with dashes**. They should look like this:

```
API Key:    12345678-1234-1234-1234-123456789abc (36 characters)
API Secret: a1b2c3d4e5f6...64-72 character hexadecimal string
Org ID:     87654321-4321-4321-4321-987654321fed (36 characters)
```

**Format Rules:**
- ✅ **API Key:** 36 characters, UUID format with dashes (e.g., xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
- ✅ **API Secret:** 64-72 characters, hexadecimal string (may or may not have dashes)
- ✅ **Organization ID:** 36 characters, UUID format with dashes
- ❌ **NO spaces** before or after any credential
- ❌ **NO extra characters**

---

## ✅ Step 2: Get Fresh Credentials from NiceHash

### How to Create API Credentials:

1. **Login to NiceHash** → https://www.nicehash.com
2. **Go to Settings** → API Keys
3. **Click "Create New API Key"**
4. **Set Permissions** (required):
   - ✅ **View balances** (for fetching BTC balance)
   - ✅ **View orders** (for seeing active packages)
   - ✅ **Create orders** (for buying packages)
5. **Copy the credentials:**
   - API Key (copy with dashes)
   - API Secret (copy with dashes)
6. **Get Organization ID:**
   - Go to Settings → Organization
   - Copy your Organization ID (with dashes)

---

## ✅ Step 3: Enter Credentials Correctly

**In your CryptFolio app:**

1. Open EasyMining Settings
2. **Paste each credential exactly as copied** (with dashes)
3. Double-check:
   - No extra spaces
   - All dashes included
   - Correct length (36 characters each)
4. Click "Activate EasyMining"

---

## 🔍 Step 4: Check Console for Validation

After entering credentials, check your browser console (F12):

**Good output:**
```
✅ NiceHash credentials format validated
🔐 Auth Debug:
API Key: 12345678...
Org ID: 87654321-4321-4321-4321-987654321fed
Timestamp: 1234567890123
Method: GET
Endpoint: /main/api/v2/accounting/accounts2
```

**Bad output:**
```
❌ NiceHash Credential Validation Failed:
  - API Key format invalid (should be UUID with dashes)
```

---

## ✅ Step 5: Verify API Permissions

NiceHash API keys have permissions. Make sure your key has:

- ✅ **Read Permissions** → View account balances and orders
- ✅ **Write Permissions** → Create new orders (optional, for buying packages)

**To check:**
1. Go to NiceHash → Settings → API Keys
2. Click on your API key
3. Verify permissions are enabled

---

## 🐛 Common Issues

### Issue 1: Wrong Lengths
```
❌ Wrong: API Secret is 36 characters (should be 64-72)
✅ Right: API Key is 36 chars, API Secret is 64-72 chars, Org ID is 36 chars
```

### Issue 2: Extra Spaces
```
❌ Wrong: " 12345678-1234-1234-1234-123456789abc "
✅ Right: "12345678-1234-1234-1234-123456789abc"
```

### Issue 3: Wrong Credential Type
```
❌ Using "Read-Only" key for operations that need "Write" permissions
✅ Create a new key with proper permissions
```

### Issue 4: Expired or Revoked Key
```
❌ API key was deleted or expired in NiceHash settings
✅ Create a new API key
```

---

## 📊 Test Your Credentials

After fixing, you should see in console:

```
🌐 Environment: Local Development (or Production (Vercel))
🔧 Using Vercel Proxy: Yes
Attempting to fetch live data from NiceHash API...
✅ NiceHash credentials format validated
🔐 Auth Debug:
API Key: 12345678...
📡 Fetching balances from NiceHash...
✅ Using Vercel proxy: /api/nicehash
Response status: 200
✅ Live data fetched successfully from NiceHash API
Available BTC: 0.00012345
```

**If you see "Response status: 401"**, credentials are wrong.
**If you see "Response status: 200"**, it's working! 🎉

---

## 🔒 Security Note

**Never share your API Secret!**
- API Key: Can be public
- API Secret: **Keep private!** (like a password)
- Organization ID: Can be public

---

## 📝 Quick Checklist

- [ ] API Key is 36 characters (UUID format with dashes)
- [ ] API Secret is 64-72 characters (hexadecimal string)
- [ ] Organization ID is 36 characters (UUID format with dashes)
- [ ] No extra spaces before/after credentials
- [ ] API key has "Read" and "Write" permissions in NiceHash
- [ ] Organization ID is correct
- [ ] Credentials are fresh (not revoked/expired)
- [ ] Console shows "✅ NiceHash credentials format validated"
- [ ] Deployed on Vercel (or testing with mock data locally)

---

## 🚀 Still Not Working?

**Check these:**

1. **Are you on Vercel?** (localhost will use mock data due to CORS)
2. **Is the API key active?** (check NiceHash settings)
3. **Correct permissions?** (needs read + write access)
4. **Check Vercel logs** (if deployed) for serverless function errors

**Console should show:**
- Environment detection
- Credential validation
- Auth debug info
- API responses

If you see any errors, share the console output for more help!

---

**Need fresh credentials?** → https://www.nicehash.com/my/settings/keys

**After fixing, refresh the page and re-enter credentials!** 🎉
