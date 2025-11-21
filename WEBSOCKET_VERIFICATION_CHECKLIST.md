# WebSocket Fix Verification Checklist

**Date:** 2025-11-21
**Status:** Ready for Testing

---

## Pre-Flight Checks

Before testing, verify all code changes are in place:

### 1. Endpoint Updates
- [x] Main WebSocket uses `wss://wbs-api.mexc.com/ws` (line 2034)
- [x] Chart WebSocket uses `wss://wbs-api.mexc.com/ws` (line 3043)
- [x] No references to old endpoint `wss://wbs.mexc.com/ws`

### 2. Subscription Format Updates
- [x] Main WebSocket uses `aggre.deals` format (line 2065)
- [x] Chart WebSocket uses `aggre.deals` format (line 3054)
- [x] subscribeToSymbol() uses `aggre.deals` format (line 2233)
- [x] No references to old format `spot@public.deals.v3.api@`

### 3. Timing Fixes
- [x] Main WebSocket has 150ms delay before subscriptions (line 2051-2080)
- [x] Chart WebSocket has 150ms delay before subscriptions (line 3051-3065)
- [x] Both check `readyState === WebSocket.OPEN` before sending

### 4. Message Handlers
- [x] Main WebSocket handles new message format (line 2132)
- [x] Main WebSocket handles old format as fallback (line 2148)
- [x] Chart WebSocket handles new message format (line 3073)
- [x] Chart WebSocket handles old format as fallback (line 3083)

### 5. Logging Enhancements
- [x] Main WebSocket has visual separators (lines 2036-2040)
- [x] Main WebSocket logs readyState before/after delay (lines 2045, 2055)
- [x] Main WebSocket logs each subscription (line 2072)
- [x] Main WebSocket has raw message debugging (lines 2107-2117)
- [x] Chart WebSocket has specific prefixes (📊)

---

## Testing Checklist

### Test 1: Main Portfolio WebSocket

**Steps:**
1. Open browser (Chrome recommended)
2. Open Developer Tools (F12)
3. Go to Console tab
4. Clear console (clear icon)
5. Reload application
6. Login with test account
7. Observe console output

**Expected Results:**
```
✅ See initialization message with separator bars
✅ See "WebSocket readyState: 1 (OPEN)"
✅ See "WebSocket readyState after delay: 1"
✅ See subscription confirmation for each crypto
✅ See "All subscriptions sent"
✅ See raw message within 1-5 seconds
✅ See price updates with symbol, price, side, volume
❌ NO "Still in CONNECTING state" errors
❌ NO "WebSocket not ready" errors
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 2: Price Updates in UI

**Steps:**
1. With WebSocket connected (from Test 1)
2. Observe crypto price displays in portfolio
3. Watch for price changes
4. Check for green/red flashes
5. Verify triangle indicators update

**Expected Results:**
```
✅ Prices update in real-time (every few seconds)
✅ Green flash when price increases
✅ Red flash when price decreases
✅ Triangle points up on increase, down on decrease
✅ Total holdings value updates
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 3: Chart WebSocket

**Steps:**
1. Click on any crypto to open candlestick chart
2. Observe console output
3. Watch chart for real-time updates
4. Close modal
5. Repeat with different crypto

**Expected Results:**
```
✅ See "Chart WebSocket connection opened for [SYMBOL]"
✅ See "Chart subscribed to [SYMBOL]USDT (aggre.deals)"
✅ See "Chart price update for [SYMBOL]: $..."
✅ Chart price line updates in real-time
✅ On close, see "Chart WebSocket connection closed"
❌ NO errors in console
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 4: Network Tab Verification

**Steps:**
1. Open Developer Tools (F12)
2. Go to Network tab
3. Filter by WS (WebSocket)
4. Reload application
5. Click on WebSocket connection
6. Go to Messages tab
7. Observe frames

**Expected Results:**
```
✅ See WebSocket connection established
✅ See outgoing SUBSCRIPTION messages
✅ See incoming data messages
✅ See PING/PONG every 20 seconds
✅ Frames showing bidirectional communication
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 5: Adding New Crypto

**Steps:**
1. Add a new crypto to portfolio (e.g., ETH if not present)
2. Observe console for subscription
3. Verify price updates for new crypto

**Expected Results:**
```
✅ See new subscription confirmation in console
✅ Price updates appear for new crypto
✅ UI updates with new crypto data
❌ NO errors during subscription
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 6: Reconnection Test

**Steps:**
1. Open Network tab
2. Find WebSocket connection
3. Right-click → Close connection (or disconnect internet briefly)
4. Observe console
5. Wait for reconnection

**Expected Results:**
```
✅ See "WebSocket connection closed"
✅ See "Reconnection attempt 1/5 in 1000ms..."
✅ Connection re-established automatically
✅ Subscriptions re-sent
✅ Price updates resume
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 7: Long-Running Stability

**Steps:**
1. Leave application open for 5-10 minutes
2. Periodically check console
3. Verify continuous operation

**Expected Results:**
```
✅ Price updates continue consistently
✅ PING/PONG messages every 20 seconds
✅ No unexpected disconnections
✅ No memory leaks (check Task Manager)
❌ NO accumulating errors
```

**Pass/Fail:** _________

**Notes:** _________________________________________

---

### Test 8: Browser Compatibility

Repeat Test 1 and Test 2 in each browser:

#### Chrome/Edge
- **Version:** _________
- **Pass/Fail:** _________
- **Notes:** _________

#### Firefox
- **Version:** _________
- **Pass/Fail:** _________
- **Notes:** _________

#### Safari (if available)
- **Version:** _________
- **Pass/Fail:** _________
- **Notes:** _________

---

## Edge Case Testing

### Edge Case 1: Invalid Symbol

**Steps:**
1. Manually add a crypto that doesn't exist on MEXC
2. Observe console behavior

**Expected Results:**
```
✅ Subscription sent
✅ No error during subscription
⚠️ No price updates for invalid symbol (expected)
✅ Other valid symbols continue working
```

**Pass/Fail:** _________

---

### Edge Case 2: Slow Network

**Steps:**
1. Use browser DevTools to throttle network (Slow 3G)
2. Reload application
3. Observe connection behavior

**Expected Results:**
```
✅ WebSocket eventually connects (may take longer)
✅ Subscriptions sent after delay
✅ Price updates work (with higher latency)
```

**Pass/Fail:** _________

---

### Edge Case 3: Rapid Modal Open/Close

**Steps:**
1. Rapidly open and close chart modal 5 times
2. Check for errors or memory leaks

**Expected Results:**
```
✅ Chart opens/closes cleanly each time
✅ WebSocket opens/closes properly
❌ NO orphaned WebSocket connections
❌ NO errors in console
```

**Pass/Fail:** _________

---

## Performance Checks

### Metric 1: Connection Speed
- **Expected:** 50-200ms
- **Actual:** _________ ms
- **Pass/Fail:** _________

### Metric 2: First Price Update
- **Expected:** Within 1-5 seconds
- **Actual:** _________ seconds
- **Pass/Fail:** _________

### Metric 3: Update Frequency
- **Expected:** ~100ms between updates (when active trading)
- **Actual:** _________ ms average
- **Pass/Fail:** _________

### Metric 4: Memory Usage
- **Initial:** _________ MB
- **After 10 min:** _________ MB
- **Increase:** _________ MB
- **Pass/Fail (< 50MB increase):** _________

---

## Security Checks

### Check 1: HTTPS Endpoint
- [x] WebSocket uses `wss://` (secure)
- [ ] WebSocket uses `ws://` (insecure) ← Should NOT be checked

### Check 2: No Sensitive Data in Logs
- [ ] API keys logged to console
- [ ] User passwords logged
- [ ] Personal data exposed
- **All should be unchecked**

### Check 3: No CORS Errors
- [ ] CORS errors in console
- **Should be unchecked**

---

## Documentation Review

### Documentation Completeness
- [x] WEBSOCKET_FIXES.md created
- [x] WEBSOCKET_BEFORE_AFTER.md created
- [x] WEBSOCKET_DEBUG_GUIDE.md created
- [x] WEBSOCKET_FIX_SUMMARY.md created
- [x] WEBSOCKET_VERIFICATION_CHECKLIST.md (this file)

### Documentation Accuracy
- [ ] All file paths correct
- [ ] All line numbers accurate
- [ ] All code examples work
- [ ] All console examples match actual output

**Review Notes:** _________________________________________

---

## Final Sign-off

### All Tests Passed
- [ ] Test 1: Main Portfolio WebSocket
- [ ] Test 2: Price Updates in UI
- [ ] Test 3: Chart WebSocket
- [ ] Test 4: Network Tab Verification
- [ ] Test 5: Adding New Crypto
- [ ] Test 6: Reconnection Test
- [ ] Test 7: Long-Running Stability
- [ ] Test 8: Browser Compatibility

### All Edge Cases Handled
- [ ] Invalid symbols don't break app
- [ ] Slow network handled gracefully
- [ ] Rapid operations don't cause leaks

### Performance Acceptable
- [ ] Connection speed < 200ms
- [ ] First update < 5 seconds
- [ ] Memory usage stable

### Documentation Complete
- [ ] All guides created
- [ ] All examples accurate
- [ ] Troubleshooting comprehensive

---

## Issues Found

If any tests failed, document here:

**Issue 1:**
- Test: _________
- Description: _________
- Severity (High/Medium/Low): _________
- Action: _________

**Issue 2:**
- Test: _________
- Description: _________
- Severity (High/Medium/Low): _________
- Action: _________

---

## Tester Information

**Tester Name:** _________________________________________
**Date Tested:** _________________________________________
**Browser(s) Used:** _________________________________________
**Operating System:** _________________________________________
**Test Environment:** Development / Staging / Production

---

## Approval

**Developer Sign-off:** Claude Code (AI Assistant)
**Date:** 2025-11-21
**Status:** ✅ Code changes complete, ready for testing

**Tester Sign-off:** _________________________________________
**Date:** _________________________________________
**Status:** Pass / Fail / Conditional Pass

**Conditional Pass Notes:** _________________________________________

---

## Next Steps

After all tests pass:

1. [ ] Commit changes to git
2. [ ] Create pull request with WEBSOCKET_FIX_SUMMARY.md
3. [ ] Tag release as v1.6.1 (WebSocket fix)
4. [ ] Update CHANGELOG.md
5. [ ] Monitor production for 24 hours
6. [ ] Gather user feedback

**Completed by:** _________________________________________
**Date:** _________________________________________
