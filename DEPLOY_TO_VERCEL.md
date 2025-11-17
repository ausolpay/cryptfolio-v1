# 🚀 Deploy CryptFolio to Vercel - Quick Guide

## ✅ What's Ready

Your app is now fully configured for Vercel deployment with:
- ✅ Serverless function created (`api/nicehash.js`)
- ✅ Frontend updated to use proxy in production
- ✅ Mock data fallback for local testing
- ✅ Environment detection (auto-switches between local/production)

---

## 📦 Files Added/Modified

**New Files:**
- `api/nicehash.js` - Vercel serverless function (NiceHash API proxy)
- `VERCEL_SETUP_GUIDE.md` - Detailed setup guide
- `DEPLOY_TO_VERCEL.md` - This quick start guide

**Modified Files:**
- `scripts.js` - Added Vercel proxy support and environment detection

---

## 🎯 Deploy in 5 Steps

### Step 1: Push to GitHub

```bash
git add .
git commit -m "Add Vercel serverless function for NiceHash API"
git push origin main
```

### Step 2: Sign Up on Vercel

1. Go to https://vercel.com
2. Click "Sign Up"
3. Choose "Continue with GitHub"
4. Authorize Vercel to access your repositories

### Step 3: Import Your Project

1. Click "Add New Project"
2. Find and select your `cryptfolio-v1` repository
3. Click "Import"

### Step 4: Configure & Deploy

**Vercel will auto-detect:**
- ✅ It's a static site
- ✅ You have serverless functions in `/api`
- ✅ Everything is configured correctly

**Just click "Deploy"!**

⏱️ Deployment takes ~1-2 minutes

### Step 5: Test Your Live Site

1. Vercel gives you a URL: `https://cryptfolio-v1.vercel.app` (or similar)
2. Visit the URL
3. Open browser console (F12)
4. Look for:
   ```
   🌐 Environment: Production (Vercel)
   🔧 Using Vercel Proxy: Yes
   ```
5. Login and activate EasyMining with your NiceHash credentials
6. Check console for:
   ```
   ✅ Using Vercel proxy: /api/nicehash
   ✅ Live data fetched successfully from NiceHash API
   Available BTC: 0.00012345
   Active Packages: 3
   ```

🎉 **You're live!**

---

## 🔍 What Happens

**On Localhost:**
- Uses direct API calls → CORS error → Falls back to mock data
- Console shows: `Using Vercel Proxy: No (mock data fallback)`

**On Vercel:**
- Uses serverless function proxy → No CORS error → Real data!
- Console shows: `Using Vercel Proxy: Yes`

---

## 🐛 Troubleshooting

### "Function Not Found" Error

**Check:**
1. File exists at `api/nicehash.js`
2. File has `export default` statement
3. Redeploy from Vercel dashboard

### CORS Error on Vercel

**Check:**
1. Console shows `Using Vercel Proxy: Yes`
2. If it says "No", check URL - must be on vercel.app domain
3. Clear browser cache and try again

### API Returns Error

**Check:**
1. NiceHash API credentials are correct
2. API has necessary permissions (read balances, create orders)
3. Serverless function logs in Vercel dashboard (Settings → Functions → Logs)

---

## 🎨 Custom Domain (Optional)

After deploying:
1. Go to Project Settings → Domains
2. Add your custom domain (e.g., `cryptfolio.ausolpay.com.au`)
3. Follow DNS configuration instructions
4. Vercel automatically handles HTTPS!

---

## 🔄 Auto-Deploy

**Every time you push to GitHub:**
- ✅ Vercel automatically detects changes
- ✅ Runs build and deploys
- ✅ Updates live site in ~1 minute
- ✅ No manual steps needed!

**To deploy:**
```bash
git add .
git commit -m "Your changes"
git push
```

Done! 🎉

---

## 📊 What You Get with Vercel

- ✅ **Free tier** (100GB bandwidth, unlimited sites)
- ✅ **Automatic HTTPS**
- ✅ **Global CDN** (fast loading worldwide)
- ✅ **Serverless Functions** (100,000 requests/month free)
- ✅ **Auto-deploy** from GitHub
- ✅ **Preview deployments** for each pull request
- ✅ **Analytics** (optional)
- ✅ **Custom domains**

---

## ⚡ Quick Commands

```bash
# Deploy (after setting up)
git push

# View logs
vercel logs [deployment-url]

# Redeploy
vercel --prod

# View deployment info
vercel inspect [deployment-url]
```

---

## 🎯 Next Steps After Deployment

1. ✅ Test with real NiceHash API credentials
2. ✅ Buy a package and verify it appears
3. ✅ Check balances update correctly
4. ✅ Test all EasyMining features
5. 🎨 (Optional) Add custom domain
6. 📢 Share your app with users!

---

## 📞 Support Links

- [Vercel Documentation](https://vercel.com/docs)
- [Serverless Functions Guide](https://vercel.com/docs/concepts/functions/serverless-functions)
- [GitHub Integration](https://vercel.com/docs/concepts/git/vercel-for-github)

---

**Ready to deploy?** Just push to GitHub and import on Vercel! 🚀

Your app is **production-ready**!
