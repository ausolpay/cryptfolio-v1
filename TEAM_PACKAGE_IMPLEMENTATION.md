# Team Package Implementation Summary

## Overview
Team Package handling has been implemented and enhanced for NiceHash EasyMining integration in CryptFolio v1.6.

## Changes Made

### 1. Share Calculation Enhancement (scripts.js:4886-4901)

**Previous Implementation:**
- Calculated shares from `addedAmount / 0.0001`

**New Implementation:**
- **Primary method**: Extract shares directly from API `shares` object
- **Fallback method**: Calculate from `addedAmount / 0.0001` for active packages

```javascript
if (isCompletedTeam && userMember?.shares) {
    const sharesObj = userMember.shares;
    const small = parseInt(sharesObj.small || 0);
    const medium = parseInt(sharesObj.medium || 0);
    const large = parseInt(sharesObj.large || 0);

    // Calculate: small = 1 share each, medium = 10 shares each, large = 100 shares each
    myShares = small + (medium * 10) + (large * 100);
} else {
    // Fallback for active packages
    myShares = addedAmount > 0 ? addedAmount / SHARE_COST : 0;
}
```

### 2. Data Structure

**Share Calculation:**
- `small`: Single shares (1 share = 0.0001 BTC)
- `medium`: Groups of 10 shares (1 medium = 10 shares = 0.001 BTC)
- `large`: Groups of 100 shares (1 large = 100 shares = 0.01 BTC)

**Formula:**
```
myShares = small + (medium × 10) + (large × 100)
totalShares = packagePrice / 0.0001
shareRatio = myShares / totalShares
```

**Example (Team Silver):**
- packagePrice: 0.0042 BTC → 42 total shares
- member.shares: { small: 2, medium: 0, large: 0 }
- myShares: 2 + (0 × 10) + (0 × 100) = 2
- Display: "2 / 42 (4.8%)"

**Example (Team Palladium):**
- packagePrice: 0.0068 BTC → 68 total shares
- member.shares: { small: 7, medium: 0, large: 0 }
- myShares: 7 + (0 × 10) + (0 × 100) = 7
- Display: "7 / 68 (10.3%)"

## Key Features

### Team Package Detection (scripts.js:4727-4730)
```javascript
const isTeamPackage = packageName.toLowerCase().startsWith('team');
```

### Member Data Extraction (scripts.js:4843-4876)
- Finds user's member entry in `sharedTicket.members` array
- Extracts `addedAmount` (amount user spent on package)
- Extracts crypto rewards from `member.rewards[]` array
- Handles both single and dual-mining rewards

### Dual-Mining Support (scripts.js:4925-4938)
**Team Palladium** packages mine both DOGE and LTC:
```javascript
if (isCompletedTeam && userMember?.rewards && userMember.rewards.length > 1) {
    // Extract secondary reward (e.g., LTC when primary is DOGE)
    const secondaryRewardData = userMember.rewards.find(r => r.coin !== order.soloMiningCoin);
    if (secondaryRewardData) {
        secondaryCryptoReward = parseFloat(secondaryRewardData.rewardAmount || 0);
    }
}
```

**Rewards Array Structure:**
```javascript
"rewards": [
  {
    "coin": "DOGE",
    "rewardAmount": 1174.59545704,
    "rewardFeeAmount": 11.86460057
  },
  {
    "coin": "LTC",  // Only present if LTC block also found
    "rewardAmount": X.XXXXXXXX,
    "rewardFeeAmount": X.XXXXXXXX
  }
]
```

### UI Display

**Package Card (scripts.js:5525-5535):**
- Team icon: 👥
- Share display: "My Shares: 2 / 42 (4.8%)"
- Labels: "Reward (My Share)", "Price (My Share)"

**Package Detail Page (scripts.js:6245-6260):**
- Package Type: "Team Package"
- My Shares: "2.00 / 42.00 (4.76%)"
- Price Per Share: "0.00010000 BTC"
- All amounts are user's share (not total package amounts)

## Auto-Update Logic

When team packages find blocks, correct cryptocurrency is auto-updated:
- **Team Gold** → Bitcoin (BTC)
- **Team Silver** → Bitcoin Cash (BCH)
- **Team Chromium** → Ravencoin (RVN)
- **Team Titanium** → Kaspa (KAS)
- **Team Palladium** → Dogecoin (DOGE) and/or Litecoin (LTC)

## Data Flow

### For Completed Team Packages:
1. Fetch from endpoint: `/main/api/v2/hashpower/solo/order?limit=5000&rewardsOnly=true`
2. Identify team packages: `packageName.startsWith('team')`
3. Find user's member entry: `sharedTicket.members.find(m => m.organizationId === userOrgId)`
4. Extract data from member:
   - `addedAmount`: User's BTC spent
   - `shares`: { small, medium, large }
   - `rewards[]`: Array of crypto rewards by coin type
5. Calculate shares: `small + (medium × 10) + (large × 100)`
6. Calculate total shares: `packagePrice / 0.0001`
7. Display share ratio and percentages

### For Team Palladium (Dual-Mining):
1. Extract primary reward (DOGE): `rewards.find(r => r.coin === 'DOGE')`
2. Extract secondary reward (LTC): `rewards.find(r => r.coin === 'LTC')`
3. Auto-update both cryptocurrencies when blocks found
4. Display both rewards separately in UI

## Testing

### Test Case 1: Team Silver (Single Reward)
**Input:**
```json
{
  "packageName": "Team Silver",
  "packagePrice": 0.0042,
  "sharedTicket": {
    "members": [{
      "organizationId": "user-id",
      "addedAmount": 0.0002,
      "shares": { "small": 2, "medium": 0, "large": 0 },
      "rewards": [{
        "coin": "BCH",
        "rewardAmount": 0.44265684
      }]
    }]
  }
}
```

**Expected Output:**
- myShares: 2
- totalShares: 42
- Display: "2 / 42 (4.8%)"
- Reward: 0.44265684 BCH (user's share)

### Test Case 2: Team Palladium (Dual Reward)
**Input:**
```json
{
  "packageName": "Team Palladium",
  "packagePrice": 0.0068,
  "sharedTicket": {
    "members": [{
      "organizationId": "user-id",
      "addedAmount": 0.0007,
      "shares": { "small": 7, "medium": 0, "large": 0 },
      "rewards": [
        { "coin": "DOGE", "rewardAmount": 1174.59545704 },
        { "coin": "LTC", "rewardAmount": 6.1875 }
      ]
    }]
  }
}
```

**Expected Output:**
- myShares: 7
- totalShares: 68
- Display: "7 / 68 (10.3%)"
- Primary reward: 1174.59545704 DOGE
- Secondary reward: 6.1875 LTC
- Both cryptocurrencies auto-updated in portfolio

### Test Case 3: Medium and Large Shares
**Input:**
```json
{
  "shares": { "small": 5, "medium": 2, "large": 1 }
}
```

**Expected Calculation:**
```
myShares = 5 + (2 × 10) + (1 × 100) = 125 shares
```

## File Locations

### Main Implementation
- **scripts.js:4727-4730** - Team package detection
- **scripts.js:4843-4876** - Member data extraction
- **scripts.js:4886-4901** - Share calculation (UPDATED)
- **scripts.js:4925-4938** - Dual-mining reward extraction
- **scripts.js:5016-5044** - Package object creation
- **scripts.js:5525-5535** - Package card UI display
- **scripts.js:6245-6260** - Package detail page display

### Documentation
- **Team Package Output Examples.md** - API response examples
- **TEAM_PACKAGE_IMPLEMENTATION.md** - This document

## API Endpoint

```
GET https://api2.nicehash.com/main/api/v2/hashpower/solo/order?limit=5000&rewardsOnly=true
```

**Authentication:** Requires NiceHash API key, secret, and organization ID

## Status

✅ **COMPLETE** - All team package features fully implemented and tested

- ✅ Team package detection
- ✅ Share calculation using API shares object
- ✅ Member data extraction
- ✅ Dual-mining support (DOGE+LTC)
- ✅ UI display with share information
- ✅ Package detail page with shares
- ✅ Auto-update logic for all team package types
- ✅ Backward compatibility with solo packages

## Notes

1. **Active vs Completed Packages:**
   - Completed packages: Use `sharedTicket.members` data
   - Active packages: Use root-level `addedAmount` (fallback calculation)

2. **Accuracy:**
   - Using `shares` object is more accurate than calculating from `addedAmount`
   - Handles edge cases where rounding might differ
   - Direct from NiceHash API, explicitly provided for this purpose

3. **Dual-Mining:**
   - Only Team Palladium currently supports dual-mining (DOGE+LTC)
   - System can handle any number of rewards in `members.rewards[]` array
   - Each reward is processed separately and added to correct cryptocurrency

4. **Share Price:**
   - Constant: 0.0001 BTC per share
   - Used for all team package calculations
   - Defined as `SHARE_COST` in scripts.js
