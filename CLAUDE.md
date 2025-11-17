# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CryptFolio v1.6 is a client-side web application for tracking cryptocurrency holdings with real-time price updates, charts, and NiceHash EasyMining integration. The application is built with vanilla HTML/CSS/JavaScript and runs entirely in the browser using localStorage for data persistence.

## Architecture

### Single-Page Application Structure
- **index.html**: Contains all page structures (login, register, app) and modals as hidden divs
- **scripts.js**: ~4400 lines containing all application logic
- **styles.css**: Complete styling including dark/light mode support

### Key Architectural Patterns

**Modal System**: All modals follow a consistent pattern with `showXxxModal()` and `closeXxxModal()` functions. Modals are pre-rendered in HTML and toggled via display property.

**User Data Storage**: All user data is stored in localStorage with keys prefixed by username:
```javascript
`${loggedInUser}_easyMiningSettings`
`${loggedInUser}_${cryptoId}Holdings`
`${loggedInUser}_recordHigh`
```

**State Management**: Application state is managed through global variables and localStorage. No framework or state management library is used.

**API Integration Architecture**:
- CoinGecko API: Crypto prices, market data, charts (with API key rotation)
- MEXC/LBank WebSocket: Real-time price updates via WebSocket connections
- NiceHash EasyMining API: Framework prepared but currently uses mock data

## Development Commands

This is a static web application with no build process:

### Running Locally
```bash
# Simple HTTP server (Python)
python -m http.server 8000

# Or use any static file server
npx serve .
```

### Testing
Open `index.html` directly in browser or serve via HTTP server. Check browser console (F12) for debug output.

### Key Testing Points
- Autocomplete: Type 2+ characters in crypto ID input, verify CoinGecko API call in Network tab
- EasyMining: Settings → EasyMining button → Verify modal opens
- WebSocket: Check console for "WebSocket connected" messages
- Modals: Each modal has extensive console logging for debugging

## Critical Implementation Details

### NiceHash EasyMining Integration

The EasyMining feature is structured for API integration but currently uses simulated data:

**Location**: `scripts.js` lines ~3179-3960

**Current State**:
- Framework and UI complete
- Mock data generation in `generateMockPackages()`
- API functions prepared but not connected: `fetchNiceHashBalances()`, `fetchNiceHashOrders()`

**To Connect Live API**:
1. Add CryptoJS library to index.html: `<script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js"></script>`
2. Implement HMAC-SHA256 signature in `generateNiceHashAuthHeaders()`
3. Replace mock data in `fetchEasyMiningData()` with actual API calls
4. Use endpoints documented in CRYPTFOLIO_V1.6_MEMORY.md

### Auto-Update Crypto Holdings

**Critical Logic**: When a mining package finds a block, the system automatically updates the correct cryptocurrency based on package type:

- Gold packages → Bitcoin (BTC)
- Silver packages → Bitcoin Cash (BCH)
- Chromium packages → Ravencoin (RVN)
- Palladium DOGE → Dogecoin (DOGE)
- Palladium LTC → Litecoin (LTC)
- Titanium packages → Kaspa (KAS)

**Auto-Add Feature**: If the crypto doesn't exist in portfolio, `addCryptoById()` automatically adds it with the reward amount.

**Location**: `autoUpdateCryptoHoldings()` function in scripts.js

### Autocomplete System

Uses CoinGecko's complete cryptocurrency list (14,000+ items):

**Initialization**: `initializeAutocomplete()` called in `initializeApp()`

**Data Source**: `https://api.coingecko.com/api/v3/coins/list`

**Search Algorithm**: Fuzzy matching with prioritization:
1. Exact matches first
2. "Starts with" matches second
3. "Contains" matches third

**Minimum characters**: 2 (prevents performance issues)

### WebSocket Price Updates

Two WebSocket connections run concurrently:
- MEXC (primary)
- LBank (fallback)

**Connection cycle**: WebSocket connections are recreated every 2 minutes to prevent stale data

**Functions**: `setWebSocketCycle()`, `connectWebSocket(source)`

## Data Flow

### Initialization Flow
1. `initializeApp()` checks for logged-in user
2. Load user data from localStorage
3. Initialize autocomplete
4. Connect WebSockets
5. Start price polling
6. Load EasyMining if enabled

### Price Update Flow
1. WebSocket receives price update
2. Update in-memory price data
3. Update UI elements (crypto boxes, total holdings)
4. Check for milestones/records
5. Play sound alerts if enabled
6. Save updated records to localStorage

### EasyMining Polling Flow (30-second interval)
1. `fetchEasyMiningData()` called
2. Fetch balances and active packages (currently mock)
3. Check for new blocks found
4. Update recommendations based on criteria
5. Trigger auto-updates if enabled
6. Save state to localStorage

## Common Issues & Solutions

### EasyMining Modal Not Opening
- Was a known issue, fixed by removing conflicting `closeSettingsModal()` call
- Check `showEasyMiningSettingsModal()` function

### Autocomplete Not Working
- Verify 2+ characters typed
- Check browser console for "Loaded XXXX cryptocurrencies"
- Verify CoinGecko API not blocked by CORS/ad-blocker
- Clear browser cache and hard refresh

### BTC Holdings Not Auto-Updating
- Verify auto-update toggle enabled in EasyMining settings
- Check if blocks are actually being found (simulated data shows random blocks)
- Ensure Bitcoin is added to portfolio (auto-adds if missing)

### WebSocket Connection Drops
- Normal behavior: reconnects every 2 minutes
- Check console for "WebSocket connected" messages
- If repeated failures, check MEXC/LBank API status

## File Organization

```
cryptfolio-v1/
├── index.html              # Main HTML (login, register, app pages, all modals)
├── scripts.js              # All application logic (~4400 lines)
├── styles.css              # All styles including dark/light mode
├── sounds/                 # Audio notification files
│   ├── good-sound.mp3
│   ├── bad-sound.mp3
│   ├── level-up-sound.mp3
│   ├── warning-sound.mp3
│   ├── milestone-sound.mp3
│   └── record-high-sound.mp3
├── images/                 # Crypto icons and graphics
├── ausolpay-logo.png       # Dark mode logo
├── ausolpay-logo-light.png # Light mode logo
├── favicon.png             # App icon
├── CRYPTFOLIO_V1.6_MEMORY.md    # Comprehensive feature documentation
├── FIXES_APPLIED.md             # Recent fixes and enhancements
└── AUTOCOMPLETE_TEST_GUIDE.md   # Testing guide for autocomplete feature
```

## Security Notes

**Current Implementation is NOT production-ready**:
- Passwords stored in localStorage (plaintext)
- API keys stored in localStorage (plaintext)
- No backend authentication
- No input sanitization
- No rate limiting

**For Production**:
- Move authentication to secure backend
- Use JWT tokens for sessions
- Proxy all NiceHash API calls through backend (never expose API secrets in frontend)
- Encrypt sensitive data at rest
- Implement proper HTTPS
- Add input validation and sanitization
- Use secure WebSocket connections (wss://)

## API Key Management

### CoinGecko API Keys
**Location**: `scripts.js` lines 3-4

Three API keys with automatic rotation on rate limit (429 response):
```javascript
const apiKeys = ['CG-gjMFaaWvegooR4G5JtgXm6tt', 'CG-acHzUtSKiG7z37pdrTadUxJc', 'CG-5LeQPVdQKzrN7LPxGMB5fKbn'];
```

**Rotation Logic**: `fetchWithApiKeyRotation()` and `switchApiKey()` functions

### NiceHash API (Not Yet Connected)
Credentials entered by user in EasyMining settings modal:
- API Key
- API Secret
- Organization ID

Stored in localStorage as `${loggedInUser}_easyMiningSettings`

## Key Functions Reference

### Core Application
- `initializeApp()` - Main initialization entry point
- `addCrypto()` - Add cryptocurrency to portfolio
- `updateHoldings(cryptoId)` - Update holdings for a crypto
- `updateTotalHoldings()` - Recalculate total portfolio value
- `showCandlestickChart(id, symbol, crypto)` - Display price chart modal

### Autocomplete
- `initializeAutocomplete()` - Set up autocomplete functionality
- `fetchCryptoList()` - Load crypto list from CoinGecko

### EasyMining
- `showEasyMiningSettingsModal()` - Open EasyMining settings
- `saveEasyMiningSettings()` - Save user's EasyMining configuration
- `fetchEasyMiningData()` - Main polling function (currently mock data)
- `autoUpdateCryptoHoldings(newBlocks)` - Auto-add rewards to holdings
- `showPackageDetailModal(pkg)` - Display package details with animated blocks
- `showBuyPackagesModal()` - Open package purchase interface

### WebSocket
- `connectWebSocket(source)` - Connect to MEXC or LBank
- `setWebSocketCycle()` - Manage WebSocket reconnection cycle

### Storage
- `getStorageItem(key)` - Get from localStorage
- `setStorageItem(key, value)` - Save to localStorage
- `removeStorageItem(key)` - Remove from localStorage

## Browser Compatibility

Requires:
- ES6+ support
- localStorage
- WebSocket support
- Canvas (for charts)
- Audio API (for notifications)

Tested on: Chrome, Firefox, Edge, Safari (modern versions)

## Code Style Notes

- **No framework**: Pure vanilla JavaScript
- **Global state**: Extensive use of global variables
- **Inline handlers**: Some onclick handlers in HTML
- **Long functions**: Many functions exceed 100 lines (especially in EasyMining section)
- **Comments**: Inline comments mark TODO items for API integration
- **Console logging**: Extensive console.log for debugging (left in for diagnostics)

## Working with This Codebase

### Adding a New Modal
1. Add modal HTML structure to `index.html` (follow existing modal pattern)
2. Create `showXxxModal()` function in `scripts.js`
3. Create `closeXxxModal()` function in `scripts.js`
4. Add modal styles to `styles.css` (copy `.modal` and `.modal-content` patterns)
5. Add close button handler

### Adding a New Crypto Feature
1. Check if crypto exists: `users[loggedInUser].cryptos.find(c => c.id === cryptoId)`
2. Fetch data from CoinGecko: Use `fetchWithApiKeyRotation(url)`
3. Update UI: Create/update elements in `crypto-containers` div
4. Save to storage: `setStorageItem(\`${loggedInUser}_${cryptoId}Holdings\`, amount)`
5. Update totals: Call `updateTotalHoldings()`

### Modifying EasyMining
The EasyMining section is modular but tightly coupled. Changes require updating:
- Data structure in `easyMiningData` object
- UI update functions (`updateEasyMiningUI()`, `updateStats()`, etc.)
- localStorage keys in `saveEasyMiningData()`
- Polling logic in `fetchEasyMiningData()`

### Debugging Tips
- All major functions have console.log statements
- Network tab: Watch for CoinGecko API calls (rate limiting)
- Console tab: WebSocket connection status
- Application tab: Inspect localStorage for user data
- Autocomplete debug logs show search matches in real-time
