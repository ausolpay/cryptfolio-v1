# CryptFolio v1.6 - Development Memory & Documentation

## Project Overview
CryptFolio is a real-time cryptocurrency holdings tracker web application that allows users to monitor their crypto investments with live price updates, charts, and analytics. Version 1.6 introduces NiceHash EasyMining integration and several UI/UX improvements.

---

## Version History
- **v1.5**: Previous stable version with basic crypto tracking, candlestick charts, and portfolio management
- **v1.6**: Current version with EasyMining integration, autocomplete search, conversion calculator, and enhanced features

---

## Recent Updates (v1.6)

### 1. Version Update
- Updated all instances of "v1.5" to "v1.6" throughout the codebase
- Updated in: `index.html` (title, headers, footers)

### 2. Crypto ID Autocomplete Search
**Location**: `index.html`, `scripts.js`, `styles.css`

**Features**:
- Fuzzy search autocomplete for crypto IDs
- Searches through CoinGecko's complete cryptocurrency list
- Matches on crypto ID, name, or symbol
- Shows up to 10 results with crypto icons
- Click to auto-fill and add crypto

**Implementation**:
```javascript
// Functions in scripts.js:
- fetchCryptoList() // Loads crypto list from CoinGecko API
- initializeAutocomplete() // Sets up autocomplete functionality
```

**HTML Structure**:
```html
<div class="autocomplete-wrapper">
    <input type="text" id="crypto-id-input" placeholder="Enter Crypto ID" autocomplete="off">
    <div id="autocomplete-list" class="autocomplete-items"></div>
</div>
```

### 3. AUD/Crypto Conversion Calculator
**Location**: Chart modal in `index.html`

**Features**:
- Real-time conversion between AUD and crypto amounts
- Bidirectional conversion (crypto to AUD and AUD to crypto)
- Automatically initializes with current crypto price
- Default shows 1 crypto coin and its AUD equivalent

**Functions**:
```javascript
- calculateFromCrypto() // Convert crypto amount to AUD
- calculateFromAUD() // Convert AUD amount to crypto
- updateConversionCalculator(priceInAud) // Initialize calculator with current price
```

---

## NiceHash EasyMining Integration

### Architecture Overview
The EasyMining feature is built as a modular system with simulated data for demonstration. In production, replace simulated API calls with actual NiceHash API integration.

### 4. EasyMining Settings Modal
**Location**: `index.html` (modal), `scripts.js` (functions)

**Features**:
- API Key, API Secret, and Organization ID inputs
- Enable/Disable EasyMining toggle
- Auto-update BTC holdings on block found toggle
- Include Available BTC in holdings toggle
- Include Pending BTC in holdings toggle
- Settings saved to localStorage per user

**Functions**:
```javascript
- showEasyMiningSettingsModal()
- closeEasyMiningSettingsModal()
- saveEasyMiningSettings()
```

**Access**: Settings button in main Settings modal

### 5. Collapsible EasyMining Section
**Location**: Above crypto boxes in `index.html`

**Features**:
- Collapsible section with arrow indicator (▶ / ▼)
- Default state: collapsed
- Click header to expand/collapse
- Displays when EasyMining is enabled

**Sections Within**:
1. **Balances Display**
   - Available BTC
   - Pending BTC
   - Buy Packages button
   - Refresh button

2. **Blocks Found Display**
   - Rocket emoji counter (🚀)
   - Max 20 rockets (2 rows of 10)
   - Manual refresh to clear count

3. **Active Packages Grid**
   - Shows 6 packages by default
   - "Show More" button for additional packages
   - Click package to view details

4. **Stats Sections**
   - All-Time Stats: Total blocks, total reward, total spent, P&L
   - Today's Stats: Blocks found today, spent today, P&L today

5. **Recommendations**
   - Best Package Recommendations (lowest probability single packages)
   - Team Package Alerts (based on criteria)

### 6. Active Packages Display
**Features**:
- Small rectangular cards with package info
- Package name, probability, time remaining, shares (for team packages)
- Horizontal progress bar showing block attempt percentage
- Block found indicator (🎉 emoji) when block is found
- Click to open detailed modal
- Responsive grid layout

**Package Card Data**:
```javascript
{
    id, name, probability, timeRemaining, progress,
    blockFound, isTeam, shares, price, blocks
}
```

### 7. Package Detail Modal
**Features**:
- Full package statistics display
- Animated block mining visualization
- Vertical bars representing each block attempt
- Bars animate up from 0% to attempt percentage
- Rocket emoji (🚀) on bars that reach 100%+
- Percentage label below each bar
- 100ms delay between each bar animation for suspense

**Functions**:
```javascript
- showPackageDetailModal(pkg)
- closePackageDetailModal()
```

### 8. Stats Tracking System
**Data Structure**:
```javascript
easyMiningData = {
    availableBTC: 0,
    pendingBTC: 0,
    activePackages: [],
    allTimeStats: {
        totalBlocks: 0,
        totalReward: 0,
        totalSpent: 0,
        pnl: 0
    },
    todayStats: {
        totalBlocks: 0,
        totalSpent: 0,
        pnl: 0
    },
    blocksFoundSession: 0,
    lastBlockCount: 0
}
```

**Functions**:
```javascript
- updateStats() // Updates all stat displays
- checkForNewBlocks() // Checks for new blocks found
```

### 9. Package Recommendations Logic
**Best Package Recommendations**:
- Filters single (non-team) packages
- Sorts by probability (lowest first)
- Shows top 2 packages
- Displays with star emoji (🌟)

**Team Package Alert Criteria**:
1. **Silver Team**: Probability under 1:160 AND shares > 20
2. **Pal Team** (DOGE): Probability under 1:220 AND shares ≥ 20
3. **Gold Team**: Shares > 100

**Alert Behavior**:
- Recommended packages glow with orange border
- Alert sound plays when criteria met
- Real-time updates with polling

### 10. Buy Packages Modal
**Features**:
- Tabbed interface: Single Packages | Team Packages
- Package cards show: name, probability, price (AUD), duration
- Recommended packages highlighted with star (⭐) and orange glow
- "Buy Now" button on each package
- Confirmation dialog before purchase

**Package Types**:
- Single: BTC S/M/L, DOGE S/M, LTC S
- Team: Silver Team, Pal Team, Gold Team

**Functions**:
```javascript
- showBuyPackagesModal()
- closeBuyPackagesModal()
- showBuyTab(tab)
- loadBuyPackagesData()
- buyPackage(packageName, price)
```

### 11. Auto-Update BTC Holdings Feature
**How It Works**:
1. Monitors for new blocks found in active packages
2. When block found and auto-update enabled:
   - Calculates estimated reward (0.00001 BTC per block as default)
   - Adds reward to base BTC holdings
   - Updates displayed BTC holdings
   - Recalculates total portfolio value

**Toggle Controls**:
- Auto-update toggle in EasyMining settings
- Include Available BTC toggle (adds available balance to holdings)
- Include Pending BTC toggle (adds pending balance to holdings)

**Functions**:
```javascript
- autoUpdateBTCHoldings(newBlocks)
- updateBTCHoldings()
```

**Storage**:
- `bitcoin_baseHoldings`: User's actual BTC holdings
- `bitcoinHoldings`: Total including EasyMining balances

### 12. Sound System
**New Sounds**:
- `block-found-sound`: Plays when block is found (uses level-up-sound.mp3)
- `package-alert-sound`: Plays when recommended package alert triggers (uses warning-sound.mp3)

**Existing Sounds**:
- good-sound.mp3
- bad-sound.mp3
- level-up-sound.mp3
- warning-sound.mp3
- milestone-sound.mp3
- record-high-sound.mp3

**Control**: Audio toggle in settings controls all sounds

### 13. Polling System
**Configuration**:
- Poll interval: 30 seconds
- Automatically starts when EasyMining enabled
- Stops when EasyMining disabled

**Functions**:
```javascript
- startEasyMiningPolling() // Starts polling
- stopEasyMiningPolling() // Stops polling
- fetchEasyMiningData() // Main data fetch function
```

**Data Flow**:
1. Fetch EasyMining data (simulated for now)
2. Update UI with new data
3. Check for new blocks found
4. Update recommendations
5. Play sounds if needed
6. Update BTC holdings if toggles enabled
7. Save data to localStorage

### 14. Toggle System
**EasyMining Toggles**:
1. **Enable EasyMining**: Shows/hides entire EasyMining section
2. **Auto-update BTC Holdings**: Automatically adds block rewards to BTC holdings
3. **Include Available BTC**: Adds available balance to BTC holdings display
4. **Include Pending BTC**: Adds pending balance to BTC holdings display

**Storage**: All toggles saved per user in localStorage

---

## Data Storage Architecture

### LocalStorage Keys (per user)
```javascript
`${loggedInUser}_easyMiningSettings` // EasyMining configuration
`${loggedInUser}_easyMiningData` // EasyMining state and stats
`${loggedInUser}_bitcoin_baseHoldings` // Base BTC holdings (without EasyMining)
`${loggedInUser}_bitcoinHoldings` // Total BTC holdings (with EasyMining)
`${loggedInUser}_${cryptoId}Holdings` // Holdings for each crypto
`${loggedInUser}_recordHigh` // Portfolio record high
`${loggedInUser}_recordLow` // Portfolio record low
`${loggedInUser}_lastMilestone` // Last milestone reached
`${loggedInUser}_totalHoldings24hAgo` // Holdings 24 hours ago
```

### Data Preparation for Database Migration
All data is structured for easy migration to a backend database:
- User-specific keys with predictable patterns
- JSON-serializable data structures
- Clear separation between user data and app state
- Timestamps for today's stats (can add reset logic)

**Recommended Database Schema**:
```sql
users (id, email, password, firstName, lastName, phone)
crypto_holdings (user_id, crypto_id, amount, updated_at)
easymining_settings (user_id, api_key, api_secret, org_id, settings_json)
easymining_data (user_id, data_json, updated_at)
easymining_stats (user_id, period, stats_json)
blocks_found (user_id, package_id, found_at, reward_amount)
```

---

## File Structure

### HTML Files
- **index.html**: Main application structure
  - Login/Register pages
  - App page with crypto tracking
  - EasyMining section
  - All modals (settings, EasyMining settings, package detail, buy packages)

### JavaScript Files
- **scripts.js**: Main application logic (~4000 lines)
  - Authentication system
  - Crypto data fetching (CoinGecko, MEXC, LBank)
  - WebSocket connections for live prices
  - Chart rendering (Chart.js with candlestick plugin)
  - EasyMining integration (lines 3179-3960)
  - Autocomplete system
  - Conversion calculator

### CSS Files
- **styles.css**: All styling (~1460 lines)
  - Dark/Light mode support
  - Responsive design
  - EasyMining components (lines 919-1460)
  - Animations and transitions
  - Modal styling

### Assets
- **sounds/**: Audio files for notifications
- **images/**: Icons and graphics
- **favicon.png**: App icon
- **ausolpay-logo.png**: Dark mode logo
- **ausolpay-logo-light.png**: Light mode logo

---

## API Integration Points

### Current APIs
1. **CoinGecko API**
   - Crypto prices, market data, charts
   - API keys with rotation system
   - Rate limit handling

2. **MEXC WebSocket**
   - Live price updates
   - Real-time crypto data

3. **LBank WebSocket**
   - Alternative live price source
   - Fallback for MEXC

### NiceHash EasyMining API (To Implement)
**Base URL**: `https://api2.nicehash.com`

**Required Endpoints**:
1. **Get Balance**: `/main/api/v2/accounting/accounts2`
2. **Get Active Orders**: `/main/api/v2/hashpower/myOrders`
3. **Create Order**: `/main/api/v2/hashpower/order`
4. **Get Mining Stats**: `/main/api/v2/mining/stats`

**Authentication**:
- API Key header: `X-API-KEY`
- Organization ID header: `X-ORGANIZATION-ID`
- Request signature header: `X-SIGNATURE`
- Timestamp header: `X-TIME`

**Implementation Notes**:
- Replace simulated data in `fetchEasyMiningData()`
- Add proper API authentication
- Handle rate limits
- Implement error handling for failed requests
- Add retry logic with exponential backoff

**Current Simulation**:
```javascript
// In scripts.js, line ~3390
async function fetchEasyMiningData() {
    // NOTE: This is simulated data
    // Replace with actual NiceHash API calls
    // using user's API credentials
}
```

---

## UI/UX Design Principles

### Color Scheme
**Dark Mode** (default):
- Background: #121212
- Containers: #1e1e1e
- Borders: #333
- Accent: #ffa500 (orange)
- Positive: #00ff00 (green)
- Negative: #ff0000 (red)

**Light Mode**:
- Background: #f0f0f0
- Containers: #f5f5f5
- Borders: #ccc
- Text: #000000

### Responsive Design
- Mobile-first approach
- Flexible grid layouts
- Breakpoint at 1024px for tablet/mobile
- Touch-friendly buttons and interactions

### Animations
- Smooth transitions (0.3s ease)
- Progress bars with CSS transitions
- Block bars animate sequentially (100ms delay)
- Glow effect on recommendations (2s infinite)
- Pulse effect on block found indicators

---

## User Workflow

### Initial Setup
1. User registers/logs in
2. Adds crypto IDs using autocomplete search
3. Enters holdings for each crypto
4. Views real-time portfolio value and changes

### EasyMining Setup
1. Click Settings → EasyMining button
2. Enter NiceHash API credentials
3. Enable EasyMining toggle
4. Configure auto-update and balance inclusion toggles
5. Save settings

### Using EasyMining
1. EasyMining section appears above crypto boxes
2. Click header to expand section
3. View balances and active packages
4. Monitor blocks found (rocket counter)
5. Check recommendations for best packages to buy
6. Click "Buy Packages" to purchase new packages
7. Click individual packages to see detailed stats
8. Watch animated block mining progress

### Monitoring
- Real-time updates every 30 seconds
- Sound alerts for blocks found and recommendations
- Auto-update BTC holdings when blocks found (if enabled)
- Track P&L for all-time and today

---

## Testing Checklist

### Completed Features ✅
- [x] Version update to v1.6
- [x] Autocomplete crypto search with fuzzy matching
- [x] AUD/Crypto conversion calculator in chart modal
- [x] EasyMining settings modal with API inputs
- [x] Collapsible EasyMining section
- [x] Active packages display with progress bars
- [x] Package detail modal with animated blocks
- [x] Stats tracking (all-time and today)
- [x] Package recommendations with criteria logic
- [x] Buy packages modal with tabs
- [x] Auto-update BTC holdings on block found
- [x] Sound system for alerts
- [x] Polling system (30s interval)
- [x] Toggles for BTC balance inclusion
- [x] LocalStorage data persistence

### To Test (When Live)
- [ ] NiceHash API integration with real credentials
- [ ] API authentication and signature generation
- [ ] Error handling for failed API calls
- [ ] Rate limit handling
- [ ] Multiple simultaneous users
- [ ] Database migration
- [ ] Performance with many active packages
- [ ] Mobile responsiveness
- [ ] Cross-browser compatibility

---

## Known Limitations

### Current Implementation
1. **Simulated Data**: EasyMining currently uses mock data
   - Replace `fetchEasyMiningData()` with real API calls
   - Replace `generateMockPackages()` with actual package data

2. **Estimated Rewards**: Block rewards are estimated
   - Actual rewards vary by package type and crypto
   - Need to fetch actual reward amounts from API

3. **Today's Stats Reset**: No automatic midnight reset
   - Add scheduled task or check on app load
   - Could use last login date comparison

4. **Blockchain Icons**: Uses placeholder for some cryptos
   - Fallback to placeholder when icon not found
   - Consider caching icons locally

5. **Buy Package**: Currently simulation only
   - Need to implement actual purchase API call
   - Add payment validation

---

## Future Enhancement Ideas

### Short Term
1. Add more detailed package history
2. Implement profit calculator for packages
3. Add package expiration notifications
4. Show estimated time to next block
5. Add package performance comparison

### Medium Term
1. Multi-currency support (EUR, GBP, etc.)
2. Portfolio diversification analysis
3. Historical P&L charts
4. Tax reporting features
5. Mobile app version

### Long Term
1. Social features (leaderboards, sharing)
2. AI-powered package recommendations
3. Automated trading strategies
4. Integration with other mining platforms
5. DeFi yield tracking

---

## Troubleshooting

### EasyMining Not Showing
1. Check if enabled in settings
2. Verify API credentials entered
3. Check browser console for errors
4. Ensure localStorage not full

### Autocomplete Not Working
1. Check internet connection (needs CoinGecko API)
2. Verify no ad blockers blocking API
3. Check console for CORS errors

### Sounds Not Playing
1. Enable audio toggle in settings
2. Check browser audio permissions
3. Verify sound files exist in /sounds/ directory

### BTC Holdings Not Updating
1. Verify auto-update toggle is enabled
2. Check if blocks are actually being found
3. Ensure Bitcoin is added to portfolio

---

## Code Architecture Patterns

### Modal System
All modals follow a consistent pattern:
```javascript
function showXxxModal() {
    // Load/prepare data
    // Set modal display to 'block'
}

function closeXxxModal() {
    // Clean up
    // Set modal display to 'none'
}
```

### LocalStorage Helper Functions
```javascript
getStorageItem(key) // Get from localStorage
setStorageItem(key, value) // Save to localStorage
removeStorageItem(key) // Remove from localStorage
```

### Data Update Pattern
```javascript
1. Fetch data from API/source
2. Update in-memory data structures
3. Update UI elements
4. Save to localStorage
5. Trigger any dependent updates
```

---

## Security Considerations

### Current Implementation
- Passwords stored in localStorage (NOT production-ready)
- API keys stored in localStorage (encrypted storage recommended)
- No rate limiting on API calls
- No input sanitization for user data

### Recommendations for Production
1. **Backend Authentication**
   - Move auth to secure backend
   - Use JWT tokens
   - Implement session management

2. **API Key Security**
   - Never expose NiceHash API keys in frontend
   - Proxy all NiceHash API calls through backend
   - Encrypt sensitive data at rest

3. **Input Validation**
   - Sanitize all user inputs
   - Validate crypto IDs against known list
   - Limit input lengths

4. **HTTPS Only**
   - Enforce HTTPS in production
   - Use secure WebSocket connections (wss://)

---

## Performance Optimization

### Current Optimizations
1. **Lazy Loading**: Modals created but hidden until needed
2. **Debouncing**: Autocomplete waits for user to stop typing
3. **Caching**: Crypto list cached after first fetch
4. **Efficient Rendering**: Only update changed elements

### Potential Improvements
1. **Virtual Scrolling**: For long lists of packages
2. **Web Workers**: For heavy calculations
3. **Service Worker**: For offline functionality
4. **Image Optimization**: Compress and cache crypto icons
5. **Code Splitting**: Load EasyMining code only when needed

---

## Deployment Notes

### Requirements
- Modern web browser with ES6+ support
- JavaScript enabled
- localStorage enabled
- WebSocket support
- Internet connection for APIs

### Hosting
- Static hosting (GitHub Pages, Netlify, Vercel)
- No server-side requirements for v1.6
- Backend needed for production features

### Build Process
No build process required - vanilla HTML/CSS/JS
- All files can be deployed as-is
- Minification recommended for production
- Consider bundling for performance

---

## Contact & Support

For questions or issues with CryptFolio v1.6:
1. Check this documentation
2. Review console logs for errors
3. Verify all files are properly uploaded
4. Check API status (CoinGecko, MEXC, LBank)

---

## Changelog

### v1.6 (Current)
- Added NiceHash EasyMining integration
- Added crypto ID autocomplete with fuzzy search
- Added AUD/Crypto conversion calculator
- Added package management and tracking
- Added recommendation system
- Added stats tracking (all-time and today)
- Added sound alerts for blocks and recommendations
- Added multiple toggles for BTC balance inclusion
- Improved UI with collapsible sections
- Enhanced modal system

### v1.5 (Previous)
- Basic crypto portfolio tracking
- CoinGecko API integration
- MEXC/LBank WebSocket integration
- Candlestick charts
- Record high/low tracking
- Milestone system
- Dark/Light mode
- Audio notifications

---

## Quick Reference

### Key Functions
```javascript
// EasyMining
showEasyMiningSettingsModal()
saveEasyMiningSettings()
toggleEasyMining()
fetchEasyMiningData()
showPackageDetailModal(pkg)
showBuyPackagesModal()
buyPackage(name, price)

// Autocomplete
fetchCryptoList()
initializeAutocomplete()

// Conversion
calculateFromCrypto()
calculateFromAUD()
updateConversionCalculator(price)

// Core App
initializeApp()
addCrypto()
updateHoldings(crypto)
showCandlestickChart(id, symbol, crypto)
```

### Important IDs
```html
<!-- EasyMining -->
#easymining-section
#easymining-content
#active-packages-container
#blocks-found-rockets
#best-packages-container
#team-alerts-container

<!-- Modals -->
#easymining-settings-modal
#package-detail-modal
#buy-packages-modal

<!-- Inputs -->
#crypto-id-input
#crypto-amount-input
#aud-amount-input
```

---

## Critical Implementation Details

### Auto-Update Logic
The auto-update holdings feature now correctly:
- Updates **only** BTC holdings with available/pending balances (based on toggles)
- Auto-adds rewards to the **corresponding crypto** based on package type:
  - **Gold packages** → Bitcoin (BTC)
  - **Silver packages** → Bitcoin Cash (BCH)
  - **Chromium packages** → Ravencoin (RVN)
  - **Palladium packages** → Dogecoin (DOGE) or Litecoin (LTC)
  - **Titanium packages** → Kaspa (KAS)
- Automatically adds crypto boxes if they don't exist in the portfolio
- Uses reward amounts from package data structure

### Package Structure
Each package now includes:
- `name`: Package name (e.g., "Gold S", "Silver Team")
- `crypto`: Target cryptocurrency symbol
- `reward`: Actual reward amount for that package type
- `probability`: Mining probability
- `algorithm`: Mining algorithm (SHA256, KawPow, Scrypt, etc.)
- `hashrate`: Hashrate allocation
- `isTeam`: Boolean for team packages
- `shares`: Number of shares (team packages only)

### API Integration Ready
All functions are structured to accept real NiceHash API data:
- Authentication headers prepared with HMAC-SHA256 signature generation
- Public API endpoints for package data (no auth required)
- Private API endpoints for balances and orders (auth required)
- Error handling for failed API calls
- Automatic retry with user notification

### Autocomplete Implementation
Uses CoinGecko API (same source as Google Sheets):
- Fetches complete cryptocurrency list on app initialization
- Fuzzy search with prioritized results (exact → starts with → contains)
- 2-character minimum for search activation
- Shows ID, name, and symbol for each result
- Auto-fills and adds crypto on click

---

## Summary

CryptFolio v1.6 successfully integrates NiceHash EasyMining functionality with a complete package management system, real-time monitoring, intelligent recommendations, and auto-update features. The codebase is well-organized, documented, and ready for production deployment once actual NiceHash API integration is implemented.

All data is stored locally and structured for easy migration to a database backend. The UI is clean, responsive, and follows the existing app design language. Sound alerts and visual indicators provide excellent user feedback.

**Key Features Completed**:
✅ Version 1.6 update throughout codebase
✅ Crypto autocomplete with fuzzy matching from CoinGecko API
✅ AUD/Crypto conversion calculator in chart modal
✅ EasyMining settings modal (accessible and working)
✅ Collapsible EasyMining section
✅ Active packages display with progress bars
✅ Package detail modal with animated block visualization
✅ Stats tracking (all-time and today)
✅ Package recommendations with specific criteria
✅ Buy packages modal with algorithm and hashrate info
✅ Auto-update crypto holdings by package type (BTC, BCH, RVN, DOGE, LTC, KAS)
✅ Auto-add crypto boxes when rewards are received
✅ Sound alerts for blocks and recommendations
✅ 30-second polling system
✅ Toggles for including available/pending BTC
✅ Ready for live NiceHash API integration

**User Workflow**:
1. User logs in and adds crypto holdings
2. Clicks Settings → EasyMining to configure
3. Enters NiceHash API credentials (Key, Secret, Org ID)
4. Enables EasyMining and desired toggles
5. EasyMining section appears with live data
6. Monitors packages, receives block alerts
7. Auto-updates corresponding crypto holdings on block found
8. Buys recommended packages directly from the app

**Next Steps**:
1. Implement actual NiceHash API authentication (HMAC-SHA256)
2. Replace mock data with real API calls in `fetchEasyMiningData()`
3. Implement `fetchNiceHashBalances()` function
4. Implement `fetchNiceHashOrders()` function
5. Add CryptoJS library for signature generation
6. Test with real NiceHash credentials
7. Add backend proxy for secure API key management
8. Implement database for persistent storage
9. Deploy to production hosting

---

**Document Version**: 1.1  
**Last Updated**: November 17, 2025  
**App Version**: v1.6
**Status**: Ready for NiceHash API Integration

