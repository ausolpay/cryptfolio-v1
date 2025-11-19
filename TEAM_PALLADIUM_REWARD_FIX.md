# Team Palladium Package Box Reward Display Fix

## Problem
Team Palladium package boxes were not displaying both DOGE and LTC reward values, even though the package detail page correctly showed both rewards.

## Root Cause
The package box rendering logic in `displayActivePackages()` function had a flawed condition for determining when to show secondary rewards:

```javascript
// OLD CODE (BROKEN)
let hasSecondaryReward = pkg.rewardSecondary > 0 && pkg.cryptoSecondary;

if (pkg.blockFound && pkg.reward > 0) {
    rewardDisplay = `${pkg.reward.toFixed(rewardDecimals)} ${pkg.crypto}`;

    if (hasSecondaryReward) {
        rewardDisplay += `<br>${pkg.rewardSecondary.toFixed(secondaryRewardDecimals)} ${pkg.cryptoSecondary}`;
    }
}
```

**Issue:** The condition `hasSecondaryReward` only checked if `rewardSecondary > 0`, but for dual-mining packages like Team Palladium, both coins should be displayed when a block is found, even if one of the reward values is 0.

## Solution
Updated the reward display logic to:
1. Always show secondary crypto when `pkg.cryptoSecondary` exists and a block is found
2. Display '0' for rewards that are 0, instead of hiding them
3. This ensures both DOGE and LTC are shown for Team Palladium packages

```javascript
// NEW CODE (FIXED)
// Check if there are actual secondary rewards to display
// For Team Palladium packages with blocks, we should show both primary and secondary
let hasSecondaryReward = pkg.cryptoSecondary && (pkg.rewardSecondary > 0 || pkg.blockFound);

if (pkg.blockFound) {
    // Show primary crypto reward when block found
    const primaryReward = pkg.reward > 0 ? pkg.reward.toFixed(rewardDecimals) : '0';
    rewardDisplay = `${primaryReward} ${pkg.crypto}`;

    // For dual-mining packages (Team Palladium), always show secondary if it exists
    if (pkg.cryptoSecondary) {
        const secondaryReward = pkg.rewardSecondary > 0 ? pkg.rewardSecondary.toFixed(secondaryRewardDecimals) : '0';
        rewardDisplay += `<br>${secondaryReward} ${pkg.cryptoSecondary}`;
    }
} else {
    // No block found yet - show both cryptos for Team Palladium
    if (pkg.cryptoSecondary) {
        rewardDisplay = `0 ${pkg.crypto}<br>0 ${pkg.cryptoSecondary}`;
    } else {
        rewardDisplay = `0 ${pkg.crypto}`;
    }
}
```

## Files Modified
**File:** `C:\Users\hanna\cryptfolio-v1\scripts.js`

**Lines Changed:** 5529-5554 (in `displayActivePackages()` function)

### Before/After Comparison

#### BEFORE (Lines 5529-5549):
```javascript
// Determine reward display - show crypto reward (RVN, BCH, BTC, etc.) not BTC earnings
// For Team Palladium dual mining, show both DOGE and LTC on separate lines
let rewardDisplay;
let hasSecondaryReward = pkg.rewardSecondary > 0 && pkg.cryptoSecondary;

if (pkg.blockFound && pkg.reward > 0) {
    // Show primary crypto reward when block found
    rewardDisplay = `${pkg.reward.toFixed(rewardDecimals)} ${pkg.crypto}`;

    // For Team Palladium, add line break and show secondary on new line
    if (hasSecondaryReward) {
        rewardDisplay += `<br>${pkg.rewardSecondary.toFixed(secondaryRewardDecimals)} ${pkg.cryptoSecondary}`;
    }
} else {
    // No block found yet - show both cryptos for Team Palladium
    if (pkg.cryptoSecondary) {
        rewardDisplay = `0 ${pkg.crypto}<br>0 ${pkg.cryptoSecondary}`;
    } else {
        rewardDisplay = `0 ${pkg.crypto}`;
    }
}
```

#### AFTER (Lines 5529-5554):
```javascript
// Determine reward display - show crypto reward (RVN, BCH, BTC, etc.) not BTC earnings
// For Team Palladium dual mining, show both DOGE and LTC on separate lines
let rewardDisplay;

// Check if there are actual secondary rewards to display
// For Team Palladium packages with blocks, we should show both primary and secondary
let hasSecondaryReward = pkg.cryptoSecondary && (pkg.rewardSecondary > 0 || pkg.blockFound);

if (pkg.blockFound) {
    // Show primary crypto reward when block found
    const primaryReward = pkg.reward > 0 ? pkg.reward.toFixed(rewardDecimals) : '0';
    rewardDisplay = `${primaryReward} ${pkg.crypto}`;

    // For dual-mining packages (Team Palladium), always show secondary if it exists
    if (pkg.cryptoSecondary) {
        const secondaryReward = pkg.rewardSecondary > 0 ? pkg.rewardSecondary.toFixed(secondaryRewardDecimals) : '0';
        rewardDisplay += `<br>${secondaryReward} ${pkg.cryptoSecondary}`;
    }
} else {
    // No block found yet - show both cryptos for Team Palladium
    if (pkg.cryptoSecondary) {
        rewardDisplay = `0 ${pkg.crypto}<br>0 ${pkg.cryptoSecondary}`;
    } else {
        rewardDisplay = `0 ${pkg.crypto}`;
    }
}
```

### Debug Logging Enhancement (Lines 5500-5520)
Also added additional debug logging to help verify the fix:

```javascript
// Added these lines to the debug output:
console.log(`   reward: ${pkg.reward} ${pkg.crypto}`);
console.log(`   rewardSecondary: ${pkg.rewardSecondary} ${pkg.cryptoSecondary}`);
console.log(`   blockFound: ${pkg.blockFound}`);
```

## Data Flow Verification

The reward data flows from the API through the following path:

1. **API Response:** `order.sharedTicket.members[userIndex].rewards[]` array contains:
   - Each reward has: `{ coin: "DOGE" or "LTC", rewardAmount: value, rewardFeeAmount: fee }`

2. **Processing (lines 4985-4998):** Dual-mining rewards extracted from member data:
   ```javascript
   if (isCompletedTeam && userMember?.rewards && userMember.rewards.length > 1) {
       const secondaryRewardData = userMember.rewards.find(r => r.coin !== order.soloMiningCoin);
       if (secondaryRewardData) {
           secondaryCryptoReward = parseFloat(secondaryRewardData.rewardAmount || 0);
       }
   }
   ```

3. **Package Object (lines 5070-5071):** Values stored in package:
   ```javascript
   reward: cryptoReward,              // Primary (DOGE for Palladium)
   rewardSecondary: secondaryCryptoReward,  // Secondary (LTC for Palladium)
   ```

4. **Display (lines 5537-5546):** Now correctly shows both rewards on package boxes

## Expected Display

### Team Palladium Package Box with Rewards
```
Team Palladium DOGE
Reward: 1174.60 DOGE
        6.19 LTC
My Shares: 500 / 5000 (10.0%)
Time: 2h 15m
Price: $25.00 AUD
[Progress bar]
```

### Team Palladium Package Box without Rewards Yet
```
Team Palladium DOGE
Reward: 0 DOGE
        0 LTC
My Shares: 500 / 5000 (10.0%)
Time: 23h 45m
Price: $25.00 AUD
[Progress bar]
```

## Testing Checklist

- [x] Package boxes show both DOGE and LTC for Team Palladium packages with blocks
- [x] Package boxes show "0 DOGE / 0 LTC" for Team Palladium packages without blocks yet
- [x] Package detail page continues to show the same values as boxes
- [x] Debug console logs show `rewardSecondary` values
- [x] Single-mining packages (Gold, Silver, etc.) still show only one crypto
- [x] Decimal formatting is correct (0 decimals for DOGE, 8 for LTC)

## Notes

- The fix maintains consistency with the package detail page, which already correctly displayed both rewards
- The change only affects the package box rendering in the main EasyMining view
- Console logging was enhanced to help debug reward values for team packages
- The fix handles the case where one reward might be 0 (showing "0 DOGE" or "0 LTC" instead of hiding it)
