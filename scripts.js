// CryptFolio v2 - Main Application Script - Stable 6 (Alert System Complete)
const baseApiUrl = 'https://api.coingecko.com/api/v3/simple/price';
const coinDetailsUrl = 'https://api.coingecko.com/api/v3/coins/';
let apiKeys = []; // User must configure their own API keys
let currentApiKeyIndex = 0;

// =============================================================================
// VERCEL PROXY CONFIGURATION
// =============================================================================

// Detect if we're running on Vercel or localhost
const IS_PRODUCTION = window.location.hostname !== 'localhost' &&
                      window.location.hostname !== '127.0.0.1' &&
                      !window.location.hostname.includes('github.io');

const USE_VERCEL_PROXY = IS_PRODUCTION; // Use proxy in production, direct calls locally (with mock fallback)
const VERCEL_PROXY_ENDPOINT = '/api/nicehash';

console.log(`🌐 Environment: ${IS_PRODUCTION ? 'Production (Vercel)' : 'Local Development'}`);
console.log(`🔧 Using Vercel Proxy: ${USE_VERCEL_PROXY ? 'Yes' : 'No (mock data fallback)'}`);

// =============================================================================

let users = JSON.parse(getStorageItem('users')) || {};
let loggedInUser = getStorageItem('loggedInUser') || null;

let apiUrl = '';
let previousTotalHoldings = 0;
let totalHoldings24hAgo = null;
let recordHigh = 0;
let recordLow = Infinity;

let socket;
let lastWebSocketUpdate = Date.now();
const twoMinutes = 2 * 60 * 1000;

// WebSocket reconnection variables
let pingInterval;
let reconnectAttempts = 0;
let reconnectDelay = 1000; // Start with 1 second
const maxReconnectDelay = 30000; // Max 30 seconds
const maxReconnectAttempts = 10;
let intentionalClose = false;

// Polling intervals (store IDs for proper cleanup)
let mexcPricePollingInterval = null;
let autoResetInterval = null;
let conversionRateInterval = null;

let candlestickChart;
let currentCryptoId;
let lastValidChartPrice = null; // Store last valid price for chart

// TradingView widget management
let tradingViewWidget = null; // Store TradingView widget instance
let currentChartInterval = '5'; // Default 5 minutes (TradingView format)

// Build TradingView symbol from crypto ticker (MEXC exchange)
function getTradingViewSymbol(symbol) {
    // Convert symbol to uppercase for TradingView format
    const ticker = symbol.toUpperCase();

    // Use MEXC exchange (consistent with WebSocket integration)
    return `MEXC:${ticker}USDT`;
}

// Initialize TradingView widget
function initializeTradingViewChart(cryptoSymbol, interval) {
    console.log(`📊 Initializing TradingView chart for ${cryptoSymbol} with interval ${interval}`);

    // Destroy existing widget if present
    if (tradingViewWidget) {
        try {
            tradingViewWidget.remove();
        } catch (e) {
            console.warn('Error removing old widget:', e);
        }
        tradingViewWidget = null;
    }

    const tradingViewSymbol = getTradingViewSymbol(cryptoSymbol);
    const container = document.getElementById('tradingview-chart-container');

    // Clear container
    if (container) {
        container.innerHTML = '';
    }

    try {
        tradingViewWidget = new TradingView.widget({
            autosize: true,
            symbol: tradingViewSymbol,
            interval: interval,
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "en",
            toolbar_bg: "#1a1a1a",
            enable_publishing: false,
            allow_symbol_change: false,
            hide_side_toolbar: false,
            hide_top_toolbar: false,
            save_image: false,
            container_id: "tradingview-chart-container",
            studies: [
                "Volume@tv-basicstudies"
            ],
            backgroundColor: "#0f0f0f",
            gridColor: "rgba(242, 242, 242, 0.06)",
            hide_legend: false,
            hide_volume: false
        });

        console.log(`✅ TradingView widget initialized for ${tradingViewSymbol}`);
    } catch (error) {
        console.error('Error initializing TradingView widget:', error);
    }
}

function getApiKey() {
    return apiKeys[currentApiKeyIndex];
}

function switchApiKey() {
    currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
    console.log(`Switched to API key: ${getApiKey()}`);
}

async function fetchWithFallback(url) {
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = getApiKey();
        const urlWithApiKey = url.replace(/x_cg_demo_api_key=[^&]*/, `x_cg_demo_api_key=${apiKey}`);
        try {
            const response = await fetch(urlWithApiKey);
            if (!response.ok) {
                throw new Error('Failed to fetch data');
            }
            console.log(`Successfully fetched data with API key: ${apiKey}`);
            return await response.json();
        } catch (error) {
            console.error(`Error with API key ${apiKey}:`, error);
            switchApiKey();
        }
    }
    throw new Error('All API keys failed');
}

async function fetchWithApiKeyRotation(url) {
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = getApiKey();
        const urlWithApiKey = url.replace(/x_cg_demo_api_key=[^&]*/, `x_cg_demo_api_key=${apiKey}`);
        try {
            const response = await fetch(urlWithApiKey);

            if (response.status === 429) {
                // Rate limit hit, switch API key and retry
                console.warn(`Rate limit hit with API key: ${apiKey}. Switching to next key.`);
                switchApiKey();
                continue; // Try the next key
            }

            if (!response.ok) {
                // Handle other HTTP errors
                throw new Error(`Failed to fetch data: ${response.status}`);
            }

            console.log(`Successfully fetched data with API key: ${apiKey}`);
            return await response.json(); // Return the fetched data if successful

        } catch (error) {
            console.error(`Error fetching data with API key ${apiKey}:`, error);
            switchApiKey(); // Switch to the next API key on error
        }
    }

    // If all API keys fail, throw an error
    throw new Error('All API keys failed');
}


function initializeApp() {
    const notificationPermission = getStorageItem('notificationPermission');
    if (notificationPermission !== 'granted') {
        requestNotificationPermission();
    }

    checkAndRequestNotificationPermission();

    const message = getStorageItem('modalMessage');
    if (message) {
        showModal(message);
        removeStorageItem('modalMessage');
    }

    const tradeMessage = getStorageItem('tradeModalMessage');
    if (tradeMessage) {
        showTradeModal(tradeMessage);
        removeStorageItem('tradeModalMessage');
    }

    if (loggedInUser) {
        // Load user's CoinGecko API keys
        apiKeys = loadUserApiKeys();
        currentApiKeyIndex = 0;

        // If no API keys configured, show CoinGecko API settings page
        if (apiKeys.length === 0) {
            console.log('⚠️ No CoinGecko API keys configured - showing settings page');
            showCoinGeckoApiSettingsPage();
            alert('⚠️ Welcome back!\n\nPlease configure your CoinGecko API keys to use the app.\n\nAt least one API key is required to fetch cryptocurrency data.');
            return; // Don't proceed with initialization
        }

        showAppPage();
        clearCryptoContainers();
        loadUserData();

        updateApiUrl();

        setWebSocketCycle();
        fetchPrices();

        // Initialize autocomplete for crypto search
        initializeAutocomplete();


        // Initialize the holdings audio toggle
        const holdingsAudioToggle = document.getElementById('holdings-audio-toggle');
        const isHoldingsAudioEnabled = getStorageItem('isHoldingsAudioEnabled') === 'true';
        holdingsAudioToggle.checked = isHoldingsAudioEnabled;

        // Set initial mute state for holdings sounds
        const goodSound = document.getElementById('good-sound');
        const badSound = document.getElementById('bad-sound');
        const levelUpSound = document.getElementById('level-up-sound');
        const warningSound = document.getElementById('warning-sound');
        const milestoneSound = document.getElementById('milestone-sound');
        const recordHighSound = document.getElementById('record-high-sound');

        goodSound.muted = !isHoldingsAudioEnabled;
        badSound.muted = !isHoldingsAudioEnabled;
        levelUpSound.muted = !isHoldingsAudioEnabled;
        warningSound.muted = !isHoldingsAudioEnabled;
        milestoneSound.muted = !isHoldingsAudioEnabled;
        recordHighSound.muted = !isHoldingsAudioEnabled;

        holdingsAudioToggle.addEventListener('change', function () {
            if (this.checked) {
                goodSound.muted = false;
                badSound.muted = false;
                levelUpSound.muted = false;
                warningSound.muted = false;
                milestoneSound.muted = false;
                recordHighSound.muted = false;
            } else {
                goodSound.muted = true;
                badSound.muted = true;
                levelUpSound.muted = true;
                warningSound.muted = true;
                milestoneSound.muted = true;
                recordHighSound.muted = true;
            }
            setStorageItem('isHoldingsAudioEnabled', this.checked);
        });

        // Initialize the EasyMining audio toggle
        const easyMiningAudioToggle = document.getElementById('easymining-audio-toggle');
        const isEasyMiningAudioEnabled = getStorageItem('isEasyMiningAudioEnabled') === 'true';
        easyMiningAudioToggle.checked = isEasyMiningAudioEnabled;

        // Set initial mute state for EasyMining sounds
        const blockFoundSound = document.getElementById('block-found-sound');
        const noBlocksFoundSound = document.getElementById('no-blocks-found-sound');
        const blockFoundCompleteSound = document.getElementById('block-found-complete-sound');
        const packageStartSound = document.getElementById('package-start-sound');
        const soloPkgAlertSound = document.getElementById('solo-pkg-alert-sound');
        const teamPkgAlertSound = document.getElementById('team-pkg-alert-sound');

        blockFoundSound.muted = !isEasyMiningAudioEnabled;
        noBlocksFoundSound.muted = !isEasyMiningAudioEnabled;
        blockFoundCompleteSound.muted = !isEasyMiningAudioEnabled;
        packageStartSound.muted = !isEasyMiningAudioEnabled;
        soloPkgAlertSound.muted = !isEasyMiningAudioEnabled;
        teamPkgAlertSound.muted = !isEasyMiningAudioEnabled;

        easyMiningAudioToggle.addEventListener('change', function () {
            if (this.checked) {
                blockFoundSound.muted = false;
                noBlocksFoundSound.muted = false;
                blockFoundCompleteSound.muted = false;
                packageStartSound.muted = false;
                soloPkgAlertSound.muted = false;
                teamPkgAlertSound.muted = false;
            } else {
                blockFoundSound.muted = true;
                noBlocksFoundSound.muted = true;
                blockFoundCompleteSound.muted = true;
                packageStartSound.muted = true;
                soloPkgAlertSound.muted = true;
                teamPkgAlertSound.muted = true;
            }
            setStorageItem('isEasyMiningAudioEnabled', this.checked);
        });

        // Initialize the dark mode toggle
        const darkModeToggle = document.getElementById('dark-mode-toggle');
        darkModeToggle.addEventListener('change', function () {
            const logo = document.querySelector('.app-logo');
            if (this.checked) {
                document.body.classList.add('dark-mode');
                document.body.classList.remove('light-mode');
                logo.src = 'ausolpay-logo.png'; 
            } else {
                document.body.classList.add('light-mode');
                document.body.classList.remove('dark-mode');
                logo.src = 'ausolpay-logo-light.png'; 
            }
        });

        // Initialize record high and low display
        recordHigh = parseFloat(getStorageItem(`${loggedInUser}_recordHigh`)) || 0;
        recordLow = parseFloat(getStorageItem(`${loggedInUser}_recordLow`)) || Infinity;
        updateRecordDisplay();

        // Initialize milestone display
        const lastMilestone = parseInt(getStorageItem(`${loggedInUser}_lastMilestone`)) || 0;
        const milestoneElement = document.getElementById('daily-milestone');
        if (milestoneElement) {
            milestoneElement.textContent = `$${formatNumber(lastMilestone.toFixed(2))}`;
        } else {
            console.error("Milestone element not found during initialization.");
        }

        // Fetch initial 7-day percentage changes and apply border colors if needed
        users[loggedInUser].cryptos.forEach(crypto => {
            fetchInitialPercentageChanges(crypto.id);
        });

        totalHoldings24hAgo = parseFloat(getStorageItem(`${loggedInUser}_totalHoldings24hAgo`)) || null;

        updateTotalHoldings();
        updatePercentageChange(previousTotalHoldings);

        // Add event listeners for Enter key to update holdings
        document.querySelectorAll('[id$="-input"]').forEach(input => {
            input.addEventListener('keyup', function(event) {
                if (event.key === 'Enter') {
                    const cryptoId = this.id.replace('-input', '');
                    updateHoldings(cryptoId);
                }
            });
        });
    } else {
        showLoginPage();
    }
}



function getNotificationPermission() {
    return localStorage.getItem('notificationPermission');
}

// Function to check and request notification permission
function checkAndRequestNotificationPermission() {
    const notificationPermission = localStorage.getItem('notificationPermission');

    if (!notificationPermission) {
        requestNotificationPermission();
    } else if (notificationPermission === 'granted') {
        console.log('Notification permission already granted.');
    } else {
        console.log('Notification permission previously denied.');
    }
}

// Function to request notification permission and store it
function requestNotificationPermission() {
    Notification.requestPermission().then(permission => {
        localStorage.setItem('notificationPermission', permission);
        if (permission === 'granted') {
            console.log('Notification permission granted.');
        } else {
            console.log('Notification permission denied.');
        }
    });
}


function setWebSocketCycle() {
    // Initialize MEXC WebSocket (ping/pong handles keep-alive, no periodic reconnection needed)
    initializeWebSocket();
}


function closeWebSocket() {
    // Use intentional close to prevent reconnection attempts
    closeWebSocketIntentionally();
}

function clearCryptoContainers() {
    const cryptoContainers = document.getElementById('crypto-containers');
    while (cryptoContainers.firstChild) {
        cryptoContainers.removeChild(cryptoContainers.firstChild);
    }
}

function loadUserData() {
    const activeElement = document.activeElement;
    const activeElementId = activeElement ? activeElement.id : null;
    const activeSelectionStart = activeElement ? activeElement.selectionStart : null;
    const activeSelectionEnd = activeElement ? activeElement.selectionEnd : null;

    if (users[loggedInUser]) {
        if (!users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos = [];
        }

        users[loggedInUser].cryptos.forEach(crypto => {
            const container = document.getElementById(`${crypto.id}-container`);
            if (!container) {
                addCryptoContainer(crypto.id, crypto.symbol, crypto.name, crypto.thumb);
            }

            const holdingsElement = document.getElementById(`${crypto.id}-holdings`);
            if (holdingsElement) {
                // Load ONLY manual holdings from storage (not displayHoldings)
                // EasyMining will add NiceHash balance when it loads
                let holdings = parseFloat(localStorage.getItem(`${loggedInUser}_${crypto.id}Holdings`)) || 0;

                if (crypto.id === 'bitcoin') {
                    // No formatting for BTC - use raw number with 8 decimals
                    holdingsElement.textContent = holdings.toFixed(8);
                    console.log(`📖 Loaded Bitcoin manual holdings: ${holdings.toFixed(8)} (EasyMining balance will be added when it loads)`);

                    // Don't load stored AUD value - will be recalculated with current price
                } else {
                    holdingsElement.textContent = formatNumber(holdings.toFixed(3));
                }
            }
        });
    }

    // Restore focus and cursor position
    if (activeElementId) {
        const newActiveElement = document.getElementById(activeElementId);
        if (newActiveElement && newActiveElement.setSelectionRange) {
            newActiveElement.focus();
            newActiveElement.setSelectionRange(activeSelectionStart, activeSelectionEnd);
        }
    }
}




function showLoginPage() {
    document.getElementById('login-page').style.display = 'block';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
}

function showRegisterPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'block';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
}

function showAppPage() {
    // Stop buy packages polling when leaving the page
    stopBuyPackagesPolling();

    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'block';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('coingecko-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('withdrawal-addresses-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
    document.getElementById('travel-data-page').style.display = 'none';
    document.getElementById('deposits-page').style.display = 'none';
    document.getElementById('withdraw-page').style.display = 'none';

    // Start EasyMining alerts polling if enabled
    if (easyMiningSettings && easyMiningSettings.enabled) {
        startEasyMiningAlertsPolling();

        // Preload buy packages data in background for faster page loading
        console.log('📦 Preloading buy packages data...');
        loadBuyPackagesDataOnPage();
    }
}

function showEasyMiningSettingsPage() {
    console.log('Showing EasyMining Settings Page');

    // Stop buy packages and alerts polling when leaving the page
    stopBuyPackagesPolling();
    stopEasyMiningAlertsPolling();

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('withdrawal-addresses-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
    document.getElementById('travel-data-page').style.display = 'none';
    document.getElementById('deposits-page').style.display = 'none';
    document.getElementById('withdraw-page').style.display = 'none';

    // Show EasyMining settings page
    document.getElementById('easymining-settings-page').style.display = 'block';

    // Load saved settings
    const savedSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || easyMiningSettings;

    // Load API credentials
    document.getElementById('nicehash-api-key-page').value = savedSettings.apiKey || '';
    document.getElementById('nicehash-api-secret-page').value = savedSettings.apiSecret || '';
    document.getElementById('nicehash-org-id-page').value = savedSettings.orgId || '';

    // Load toggle settings
    document.getElementById('auto-update-holdings-toggle-page').checked = savedSettings.autoUpdateHoldings || false;
    document.getElementById('include-available-btc-toggle-page').checked = savedSettings.includeAvailableBTC || false;
    document.getElementById('include-pending-btc-toggle-page').checked = savedSettings.includePendingBTC || false;
    document.getElementById('auto-buy-cooldown-toggle-page').checked = savedSettings.autoBuyCooldown !== undefined ? savedSettings.autoBuyCooldown : true; // Default ON
    document.getElementById('auto-clear-team-shares-toggle-page').checked = savedSettings.autoClearTeamShares || false; // Default OFF
    document.getElementById('auto-buy-tg-safe-hold-toggle-page').checked = savedSettings.autoBuyTgSafeHold || false; // Default OFF
}

// =============================================================================
// WITHDRAWAL ADDRESSES MANAGEMENT
// =============================================================================

function showWithdrawalAddressesPage() {
    console.log('Showing Withdrawal Addresses Page');

    // Stop polling when leaving app page
    stopBuyPackagesPolling();
    stopEasyMiningAlertsPolling();

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';

    // Show withdrawal addresses page
    document.getElementById('withdrawal-addresses-page').style.display = 'block';

    // Load and populate addresses
    loadWithdrawalAddresses();
}

function loadWithdrawalAddresses() {
    console.log('Loading withdrawal addresses...');

    // Get saved addresses from localStorage
    const savedAddresses = JSON.parse(localStorage.getItem(`${loggedInUser}_withdrawalAddresses`)) || {};

    // List of all cryptos used in EasyMining
    const cryptos = [
        { symbol: 'BTC', name: 'Bitcoin', color: '#F7931A' },
        { symbol: 'BCH', name: 'Bitcoin Cash', color: '#8DC351' },
        { symbol: 'KAS', name: 'Kaspa', color: '#49C39E' },
        { symbol: 'RVN', name: 'Ravencoin', color: '#384182' },
        { symbol: 'DOGE', name: 'Dogecoin', color: '#C3A634' },
        { symbol: 'LTC', name: 'Litecoin', color: '#345D9D' }
    ];

    // Create input fields for each crypto
    const container = document.getElementById('withdrawal-addresses-list');
    container.innerHTML = '';

    cryptos.forEach(crypto => {
        const addressDiv = document.createElement('div');
        addressDiv.className = 'input-group';
        addressDiv.style.marginBottom = '20px';

        addressDiv.innerHTML = `
            <label for="wallet-${crypto.symbol}" style="color: ${crypto.color}; font-weight: bold;">
                ${crypto.symbol} - ${crypto.name}:
            </label>
            <input
                type="text"
                id="wallet-${crypto.symbol}"
                placeholder="Enter your ${crypto.symbol} wallet address"
                value="${savedAddresses[crypto.symbol] || ''}"
                style="font-family: monospace; font-size: 13px;"
            >
            <small style="color: #aaa; display: block; margin-top: 5px;">
                ${savedAddresses[crypto.symbol] ? '✅ Address saved' : '⚠️ No address set'}
            </small>
        `;

        container.appendChild(addressDiv);
    });

    console.log('Loaded withdrawal addresses:', savedAddresses);
}

function saveWithdrawalAddresses() {
    console.log('Saving withdrawal addresses...');

    const cryptos = ['BTC', 'BCH', 'KAS', 'RVN', 'DOGE', 'LTC'];
    const addresses = {};

    // Collect addresses from input fields
    cryptos.forEach(symbol => {
        const input = document.getElementById(`wallet-${symbol}`);
        if (input && input.value.trim() !== '') {
            addresses[symbol] = input.value.trim();
        }
    });

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_withdrawalAddresses`, JSON.stringify(addresses));

    console.log('Saved withdrawal addresses:', addresses);
    alert(`✅ Withdrawal addresses saved successfully!\n\n${Object.keys(addresses).length} addresses saved.`);

    // Reload to update status messages
    loadWithdrawalAddresses();
}

// ✅ NEW: Load withdrawal addresses from NiceHash saved addresses
async function loadNiceHashSavedAddresses() {
    console.log('🔄 Loading NiceHash saved withdrawal addresses...');

    // Check if we have API credentials
    if (!easyMiningSettings.apiKey || !easyMiningSettings.apiSecret || !easyMiningSettings.orgId) {
        alert('❌ Please enter your NiceHash API credentials first!\n\nGo to EasyMining Settings and add your API Key, Secret, and Organization ID.');
        return;
    }

    try {
        // Show loading feedback
        const button = event.target;
        const originalText = button.innerHTML;
        button.innerHTML = '⏳ Loading from NiceHash...';
        button.disabled = true;

        // Sync time with NiceHash server
        await syncNiceHashTime();

        // Prepare API request
        const endpoint = '/main/api/v2/hashpower/sharedTicketExternalAddress/list';
        const method = 'GET';

        // Generate auth headers
        const headers = generateNiceHashAuthHeaders(method, endpoint, null);

        console.log('📡 Fetching saved addresses from NiceHash API...');

        // Make request via proxy
        const response = await fetch(VERCEL_PROXY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: endpoint,
                method: method,
                headers: headers,
                body: null
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error ${response.status}: ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        console.log('✅ Received NiceHash saved addresses:', data);

        // Parse the addresses
        // Expected format: { list: [ { currency: 'BTC', address: '...' }, ... ] }
        if (!data.list || !Array.isArray(data.list)) {
            throw new Error('Invalid response format from NiceHash API');
        }

        // Map NiceHash currency codes to our symbols
        const currencyMapping = {
            'BTC': 'BTC',
            'BCH': 'BCH',
            'KAS': 'KAS',
            'RVN': 'RVN',
            'DOGE': 'DOGE',
            'LTC': 'LTC'
        };

        // Populate input fields with addresses
        let foundCount = 0;
        data.list.forEach(item => {
            const currency = item.currency;
            const address = item.address;

            console.log(`   📍 Found ${currency}: ${address}`);

            // Map to our crypto symbol
            const symbol = currencyMapping[currency];
            if (symbol) {
                const input = document.getElementById(`wallet-${symbol}`);
                if (input) {
                    input.value = address;
                    foundCount++;
                    console.log(`   ✅ Set ${symbol} address`);
                }
            }
        });

        // Auto-save the addresses
        saveWithdrawalAddresses();

        // Restore button
        button.innerHTML = originalText;
        button.disabled = false;

        if (foundCount === 0) {
            alert('ℹ️ No withdrawal addresses found in your NiceHash account.\n\nPlease add addresses in NiceHash first.');
        } else {
            console.log(`✅ Successfully loaded ${foundCount} addresses from NiceHash`);
        }

    } catch (error) {
        console.error('❌ Error loading NiceHash saved addresses:', error);

        // Restore button
        const button = document.querySelector('[onclick="loadNiceHashSavedAddresses()"]');
        if (button) {
            button.innerHTML = '📥 Use NH Saved Addresses';
            button.disabled = false;
        }

        alert(`❌ Failed to load addresses from NiceHash:\n\n${error.message}\n\nPlease check:\n1. Your API credentials are correct\n2. You have saved withdrawal addresses in NiceHash\n3. Your API key has proper permissions`);
    }
}

function clearWithdrawalAddresses() {
    if (!confirm('Are you sure you want to clear all withdrawal addresses?\n\nThis cannot be undone.')) {
        return;
    }

    // Clear from localStorage
    localStorage.removeItem(`${loggedInUser}_withdrawalAddresses`);

    console.log('Cleared all withdrawal addresses');
    alert('All withdrawal addresses have been cleared.');

    // Reload to show empty fields
    loadWithdrawalAddresses();
}

function getWithdrawalAddress(crypto) {
    // Get saved addresses
    const savedAddresses = JSON.parse(localStorage.getItem(`${loggedInUser}_withdrawalAddresses`)) || {};
    return savedAddresses[crypto] || null;
}

function saveWithdrawalAddress(crypto, address) {
    // Save individual withdrawal address
    const savedAddresses = JSON.parse(localStorage.getItem(`${loggedInUser}_withdrawalAddresses`)) || {};
    savedAddresses[crypto] = address;
    localStorage.setItem(`${loggedInUser}_withdrawalAddresses`, JSON.stringify(savedAddresses));
    console.log(`💾 Saved ${crypto} withdrawal address:`, address);
}

// ========================================
// TRAVEL DATA MANAGEMENT FUNCTIONS
// ========================================

// All 242 VASPs from VASP-ID.md
// VASP list will be dynamically fetched from NiceHash API
let VASP_LIST = [];

// Country codes for dropdown
const COUNTRY_LIST = [
    { code: "AU", name: "Australia" },
    { code: "US", name: "United States" },
    { code: "GB", name: "United Kingdom" },
    { code: "CA", name: "Canada" },
    { code: "NZ", name: "New Zealand" },
    { code: "SG", name: "Singapore" },
    { code: "HK", name: "Hong Kong" },
    { code: "JP", name: "Japan" },
    { code: "KR", name: "South Korea" },
    { code: "CN", name: "China" },
    { code: "IN", name: "India" },
    { code: "DE", name: "Germany" },
    { code: "FR", name: "France" },
    { code: "IT", name: "Italy" },
    { code: "ES", name: "Spain" },
    { code: "NL", name: "Netherlands" },
    { code: "BE", name: "Belgium" },
    { code: "CH", name: "Switzerland" },
    { code: "AT", name: "Austria" },
    { code: "SE", name: "Sweden" },
    { code: "NO", name: "Norway" },
    { code: "DK", name: "Denmark" },
    { code: "FI", name: "Finland" },
    { code: "PL", name: "Poland" },
    { code: "PT", name: "Portugal" },
    { code: "IE", name: "Ireland" },
    { code: "GR", name: "Greece" },
    { code: "CZ", name: "Czech Republic" },
    { code: "RO", name: "Romania" },
    { code: "HU", name: "Hungary" },
    { code: "BG", name: "Bulgaria" },
    { code: "HR", name: "Croatia" },
    { code: "SK", name: "Slovakia" },
    { code: "SI", name: "Slovenia" },
    { code: "LT", name: "Lithuania" },
    { code: "LV", name: "Latvia" },
    { code: "EE", name: "Estonia" },
    { code: "MT", name: "Malta" },
    { code: "CY", name: "Cyprus" },
    { code: "LU", name: "Luxembourg" },
    { code: "IS", name: "Iceland" },
    { code: "RU", name: "Russia" },
    { code: "UA", name: "Ukraine" },
    { code: "TR", name: "Turkey" },
    { code: "IL", name: "Israel" },
    { code: "AE", name: "United Arab Emirates" },
    { code: "SA", name: "Saudi Arabia" },
    { code: "ZA", name: "South Africa" },
    { code: "NG", name: "Nigeria" },
    { code: "KE", name: "Kenya" },
    { code: "EG", name: "Egypt" },
    { code: "BR", name: "Brazil" },
    { code: "AR", name: "Argentina" },
    { code: "MX", name: "Mexico" },
    { code: "CL", name: "Chile" },
    { code: "CO", name: "Colombia" },
    { code: "PE", name: "Peru" },
    { code: "VE", name: "Venezuela" },
    { code: "TH", name: "Thailand" },
    { code: "MY", name: "Malaysia" },
    { code: "ID", name: "Indonesia" },
    { code: "PH", name: "Philippines" },
    { code: "VN", name: "Vietnam" },
    { code: "TW", name: "Taiwan" },
    { code: "BD", name: "Bangladesh" },
    { code: "PK", name: "Pakistan" }
];

/**
 * Fetch VASPs from NiceHash API
 * Populates the VASP_LIST with correct IDs from NiceHash
 */
async function fetchNiceHashVasps() {
    try {
        console.log('🔄 Fetching VASPs from NiceHash API...');

        const endpoint = '/main/api/v2/accounting/travelrule/vasps';
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        let response;
        if (USE_VERCEL_PROXY) {
            // Use Vercel proxy in production
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, method: 'GET', headers })
            });
        } else {
            // Direct call in development
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers
            });
        }

        if (!response.ok) {
            throw new Error(`NiceHash API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        console.log('🔍 API Response structure:', data);

        // NiceHash API returns { vasps: [...] }
        if (!data.vasps || !Array.isArray(data.vasps)) {
            console.error('❌ Unexpected response structure:', data);
            throw new Error('Invalid response: expected { vasps: [...] }');
        }

        console.log(`🔍 Found ${data.vasps.length} VASPs in response`);

        // Transform API response to our format: { name, id }
        VASP_LIST = data.vasps.map(vasp => ({
            name: vasp.name,
            id: vasp.id
        }));

        console.log(`✅ Loaded ${VASP_LIST.length} VASPs from NiceHash API`);

    } catch (error) {
        console.error('❌ Error fetching VASPs:', error);
        alert('⚠️ Failed to load VASPs from NiceHash. Please check your API credentials and try again.');
    }
}

/**
 * Show the Travel Data management page
 */
async function showTravelDataPage() {
    console.log('📍 Showing Travel Data Management Page');

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
    document.getElementById('deposits-page').style.display = 'none';

    // Show travel data page
    document.getElementById('travel-data-page').style.display = 'block';

    // Fetch VASPs from NiceHash API before populating dropdown
    await fetchNiceHashVasps();

    // Populate dropdowns
    populateVaspDropdown();
    populateCountryDropdown();
    loadTravelDataDropdown();
}

/**
 * Populate VASP dropdown with VASPs fetched from NiceHash API
 */
function populateVaspDropdown() {
    const vaspSelect = document.getElementById('travel-vasp-select');

    // Clear existing options except first one
    vaspSelect.innerHTML = '<option value="">Select VASP...</option>';

    // Add all VASPs
    VASP_LIST.forEach(vasp => {
        const option = document.createElement('option');
        option.value = vasp.id; // Store UUID as value
        option.textContent = vasp.name;
        vaspSelect.appendChild(option);
    });

    console.log('✅ Populated VASP dropdown with', VASP_LIST.length, 'VASPs');
}

/**
 * Populate country dropdown with country codes
 */
function populateCountryDropdown() {
    const countrySelect = document.getElementById('travel-country-select');

    // Clear existing options except first one
    countrySelect.innerHTML = '<option value="">Select country...</option>';

    // Add all countries
    COUNTRY_LIST.forEach(country => {
        const option = document.createElement('option');
        option.value = country.code; // Store code as value (e.g., "AU")
        option.textContent = `${country.name} (${country.code})`;
        countrySelect.appendChild(option);
    });

    console.log('✅ Populated country dropdown with', COUNTRY_LIST.length, 'countries');
}

/**
 * Toggle the travel data form visibility
 */
function toggleTravelDataForm() {
    const form = document.getElementById('travel-data-form');
    const button = document.getElementById('add-travel-data-btn');

    if (form.style.display === 'none') {
        // Show form
        form.style.display = 'block';
        button.textContent = '❌ Cancel';
        button.style.backgroundColor = '#f44336';

        // Clear form fields
        clearTravelDataForm();
    } else {
        // Hide form
        form.style.display = 'none';
        button.textContent = '➕ Add New Address';
        button.style.backgroundColor = '#4CAF50';
    }
}

/**
 * Toggle between individual and legal entity name fields
 */
function toggleLegalEntityFields() {
    const isLegalEntity = document.getElementById('travel-legal-entity-checkbox').checked;
    const individualFields = document.getElementById('individual-name-fields');
    const legalEntityField = document.getElementById('legal-entity-name-field');

    if (isLegalEntity) {
        // Show legal entity field, hide individual fields
        individualFields.style.display = 'none';
        legalEntityField.style.display = 'block';

        // Clear individual name fields
        document.getElementById('travel-first-name').value = '';
        document.getElementById('travel-last-name').value = '';
    } else {
        // Show individual fields, hide legal entity field
        individualFields.style.display = 'block';
        legalEntityField.style.display = 'none';

        // Clear legal entity field
        document.getElementById('travel-legal-name').value = '';
    }
}

/**
 * Clear all travel data form fields
 */
function clearTravelDataForm() {
    document.getElementById('travel-vasp-select').value = '';
    document.getElementById('travel-legal-entity-checkbox').checked = false;
    document.getElementById('travel-first-name').value = '';
    document.getElementById('travel-last-name').value = '';
    document.getElementById('travel-legal-name').value = '';
    document.getElementById('travel-postal-code').value = '';
    document.getElementById('travel-town').value = '';
    document.getElementById('travel-country-select').value = '';
    document.getElementById('travel-saved-name').value = '';

    // Reset to individual name fields
    toggleLegalEntityFields();
}

/**
 * Save travel data to localStorage
 */
function saveTravelData() {
    console.log('💾 Saving travel data...');

    // Get form values
    const vaspId = document.getElementById('travel-vasp-select').value;
    const isLegalEntity = document.getElementById('travel-legal-entity-checkbox').checked;
    const firstName = document.getElementById('travel-first-name').value.trim();
    const lastName = document.getElementById('travel-last-name').value.trim();
    const legalName = document.getElementById('travel-legal-name').value.trim();
    const postalCode = document.getElementById('travel-postal-code').value.trim();
    const town = document.getElementById('travel-town').value.trim();
    const country = document.getElementById('travel-country-select').value;
    const savedName = document.getElementById('travel-saved-name').value.trim();

    // Validation
    if (!vaspId) {
        alert('Please select a VASP');
        return;
    }

    if (!isLegalEntity && (!firstName || !lastName)) {
        alert('Please enter first and last name');
        return;
    }

    if (isLegalEntity && !legalName) {
        alert('Please enter legal entity name');
        return;
    }

    if (!postalCode || !town || !country || !savedName) {
        alert('Please fill in all required fields');
        return;
    }

    // Get VASP name from ID
    const vasp = VASP_LIST.find(v => v.id === vaspId);
    const vaspName = vasp ? vasp.name : '';

    // Create travel data object with exact field names for API mapping
    const travelData = {
        vaspName: vaspName,          // VASP name (string)
        emailVASPId: vaspId,         // VASP UUID (string)
        firstName: isLegalEntity ? '' : firstName,    // First name (empty if legal entity)
        lastName: isLegalEntity ? '' : lastName,      // Last name (empty if legal entity)
        legalName: isLegalEntity ? legalName : '',    // Legal entity name (empty if individual)
        postalCode: postalCode,      // Post/zip code (string)
        town: town,                  // Town/city (string)
        country: country,            // Country code (e.g., "AU")
        savedName: savedName         // Nickname for this entry
    };

    // Get existing travel data
    const allTravelData = JSON.parse(localStorage.getItem(`${loggedInUser}_travelData`)) || [];

    // Add new entry
    allTravelData.push(travelData);

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_travelData`, JSON.stringify(allTravelData));

    console.log('✅ Travel data saved:', travelData);

    // Refresh dropdown and hide form
    loadTravelDataDropdown();
    toggleTravelDataForm();

    alert(`✅ Travel data "${savedName}" saved successfully!`);
}

/**
 * Load saved travel data into dropdown
 */
function loadTravelDataDropdown() {
    const dropdown = document.getElementById('saved-travel-data-select');

    // Clear existing options except first one
    dropdown.innerHTML = '<option value="">Select saved travel data...</option>';

    // Get saved travel data
    const allTravelData = JSON.parse(localStorage.getItem(`${loggedInUser}_travelData`)) || [];

    // Add each saved entry to dropdown
    allTravelData.forEach((data, index) => {
        const option = document.createElement('option');
        option.value = index; // Store index as value
        option.textContent = data.savedName;
        dropdown.appendChild(option);
    });

    console.log('✅ Loaded', allTravelData.length, 'saved travel data entries');
}

/**
 * Load selected travel data into form for viewing/editing
 */
function loadSelectedTravelData() {
    const dropdown = document.getElementById('saved-travel-data-select');
    const selectedIndex = dropdown.value;

    if (!selectedIndex) {
        // No selection, hide delete button
        document.getElementById('delete-travel-data-section').style.display = 'none';
        return;
    }

    // Show delete button
    document.getElementById('delete-travel-data-section').style.display = 'block';

    // Get saved travel data
    const allTravelData = JSON.parse(localStorage.getItem(`${loggedInUser}_travelData`)) || [];
    const data = allTravelData[selectedIndex];

    if (!data) {
        console.error('❌ Travel data not found at index:', selectedIndex);
        return;
    }

    console.log('📖 Loading travel data:', data);

    // Display data as read-only info (not editable)
    // Build alert message with all fields displayed separately
    let alertMessage = `✈️ Saved Travel Data: ${data.savedName}\n\n`;
    alertMessage += `VASP Name: ${data.vaspName}\n`;
    alertMessage += `VASP ID (UUID): ${data.emailVASPId}\n\n`;

    // Show individual OR legal entity fields
    if (data.legalName) {
        alertMessage += `Legal Entity Name: ${data.legalName}\n`;
    } else {
        alertMessage += `First Name: ${data.firstName}\n`;
        alertMessage += `Last Name: ${data.lastName}\n`;
    }

    alertMessage += `\nPost Code: ${data.postalCode}\n`;
    alertMessage += `Town/City: ${data.town}\n`;
    alertMessage += `Country: ${data.country}`;

    alert(alertMessage.trim());
}

/**
 * Delete selected travel data
 */
function deleteTravelData() {
    const dropdown = document.getElementById('saved-travel-data-select');
    const selectedIndex = dropdown.value;

    if (!selectedIndex) {
        alert('Please select a travel data entry to delete');
        return;
    }

    // Get saved travel data
    const allTravelData = JSON.parse(localStorage.getItem(`${loggedInUser}_travelData`)) || [];
    const data = allTravelData[selectedIndex];

    if (!data) {
        console.error('❌ Travel data not found at index:', selectedIndex);
        return;
    }

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${data.savedName}"?`)) {
        return;
    }

    // Remove from array
    allTravelData.splice(selectedIndex, 1);

    // Save back to localStorage
    localStorage.setItem(`${loggedInUser}_travelData`, JSON.stringify(allTravelData));

    console.log('🗑️ Deleted travel data:', data.savedName);

    // Refresh dropdown and hide delete button
    loadTravelDataDropdown();
    document.getElementById('delete-travel-data-section').style.display = 'none';

    alert(`✅ "${data.savedName}" deleted successfully!`);
}

// ========================================
// BTC LIGHTNING DEPOSITS FUNCTIONS
// ========================================

// QR Code API access tokens with fallback
const QR_CODE_TOKENS = [
    'nsn_vaCZZqkTcsunCUGEfwuAxf1fCHnYNiss9MssnU3FZjevECqIJuVqiYBCOkHE',
    'S6ZkdQDcroQGAQKQgsttFLf2JnSAt-7j2E9_ITE6DHwa9WKDr3BQWTusnOrJ0PVS'
];
let currentQrTokenIndex = 0;

/**
 * Show the Deposits page
 */
function showDepositsPage() {
    console.log('💰 Showing BTC Lightning Deposits Page');

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
    document.getElementById('travel-data-page').style.display = 'none';
    document.getElementById('deposits-page').style.display = 'none';
    document.getElementById('withdraw-page').style.display = 'none';

    // Show deposits page
    document.getElementById('deposits-page').style.display = 'block';

    // Initialize checkbox states (travel rule checked by default, self-custodial unchecked)
    document.getElementById('deposit-travel-rule-checkbox').checked = true;
    document.getElementById('deposit-self-custodial-checkbox').checked = false;

    // Set initial visibility based on default state
    document.getElementById('deposit-self-custodial-group').style.display = 'block';
    document.getElementById('deposit-travel-data-group').style.display = 'block';

    // Populate travel data dropdown
    loadDepositTravelDataDropdown();

    // Clear previous outputs
    document.getElementById('deposit-output-section').style.display = 'none';
    document.getElementById('deposit-address-output').value = '';
    document.getElementById('qr-code-container').innerHTML = '';
    document.getElementById('deposit-amount-btc').value = '';
    document.getElementById('deposit-amount-aud').value = '';
}

/**
 * Toggle visibility of travel rule options (VASP dropdown and self-custodial checkbox)
 */
function toggleTravelRuleOptions() {
    const travelRuleChecked = document.getElementById('deposit-travel-rule-checkbox').checked;
    const selfCustodialGroup = document.getElementById('deposit-self-custodial-group');
    const selfCustodialCheckbox = document.getElementById('deposit-self-custodial-checkbox');
    const travelDataGroup = document.getElementById('deposit-travel-data-group');

    console.log('🔄 Travel rule checkbox changed:', travelRuleChecked);

    if (travelRuleChecked) {
        // Show self-custodial checkbox and VASP dropdown
        selfCustodialGroup.style.display = 'block';
        travelDataGroup.style.display = 'block';
    } else {
        // Hide both self-custodial checkbox and VASP dropdown
        selfCustodialGroup.style.display = 'none';
        travelDataGroup.style.display = 'none';

        // Auto-uncheck self-custodial if travel rule is unchecked
        selfCustodialCheckbox.checked = false;
    }
}

/**
 * Toggle visibility of VASP dropdown when self-custodial is checked/unchecked
 */
function toggleSelfCustodialOptions() {
    const selfCustodialChecked = document.getElementById('deposit-self-custodial-checkbox').checked;
    const travelDataGroup = document.getElementById('deposit-travel-data-group');

    console.log('🔄 Self-custodial checkbox changed:', selfCustodialChecked);

    if (selfCustodialChecked) {
        // Hide VASP dropdown when using self-custodial wallet
        travelDataGroup.style.display = 'none';
    } else {
        // Show VASP dropdown when not using self-custodial wallet
        travelDataGroup.style.display = 'block';
    }
}

/**
 * Load travel data into deposits dropdown (with "Add New" option)
 */
function loadDepositTravelDataDropdown() {
    const dropdown = document.getElementById('deposit-travel-data-select');

    // Clear existing options
    dropdown.innerHTML = '<option value="">Select travel data...</option>';

    // Get saved travel data
    const allTravelData = JSON.parse(localStorage.getItem(`${loggedInUser}_travelData`)) || [];

    // Add each saved entry
    allTravelData.forEach((data, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = data.savedName;
        dropdown.appendChild(option);
    });

    // Add "Add New Travel Data" option at the end
    const addNewOption = document.createElement('option');
    addNewOption.value = 'add-new';
    addNewOption.textContent = '➕ Add New Travel Data';
    addNewOption.style.color = '#4CAF50';
    addNewOption.style.fontWeight = 'bold';
    dropdown.appendChild(addNewOption);

    // Listen for "Add New" selection
    dropdown.addEventListener('change', function() {
        if (this.value === 'add-new') {
            showTravelDataPage();
        }
    });

    console.log('✅ Loaded', allTravelData.length, 'travel data entries for deposits');
}

/**
 * Convert BTC amount to AUD (using current BTC price from DOM)
 */
function convertBtcToAud() {
    const btcInput = document.getElementById('deposit-amount-btc');
    const audInput = document.getElementById('deposit-amount-aud');

    const btcAmount = parseFloat(btcInput.value) || 0;

    // Get current BTC price in AUD from DOM element (same as fetchPrices function)
    const priceElement = document.getElementById('bitcoin-price-aud');
    const btcPriceAud = priceElement
        ? parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0
        : 0;

    if (btcPriceAud > 0) {
        const audAmount = btcAmount * btcPriceAud;
        audInput.value = audAmount.toFixed(2);
        console.log(`💱 Converted ${btcAmount} BTC to $${audAmount.toFixed(2)} AUD (price: $${btcPriceAud})`);
    } else {
        console.warn('⚠️ BTC price not available for conversion. Add Bitcoin to your portfolio first.');
    }
}

/**
 * Convert AUD amount to BTC (using current BTC price from DOM)
 */
function convertAudToBtc() {
    const btcInput = document.getElementById('deposit-amount-btc');
    const audInput = document.getElementById('deposit-amount-aud');

    const audAmount = parseFloat(audInput.value) || 0;

    // Get current BTC price in AUD from DOM element (same as fetchPrices function)
    const priceElement = document.getElementById('bitcoin-price-aud');
    const btcPriceAud = priceElement
        ? parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0
        : 0;

    if (btcPriceAud > 0) {
        const btcAmount = audAmount / btcPriceAud;
        btcInput.value = btcAmount.toFixed(8);
        console.log(`💱 Converted $${audAmount} AUD to ${btcAmount.toFixed(8)} BTC (price: $${btcPriceAud})`);
    } else {
        console.warn('⚠️ BTC price not available for conversion. Add Bitcoin to your portfolio first.');
    }
}

/**
 * Generate Lightning Network deposit address
 */
async function generateLightningAddress() {
    console.log('⚡ Generating Lightning deposit address...');

    // Get checkbox states
    const travelRuleChecked = document.getElementById('deposit-travel-rule-checkbox').checked;
    const selfCustodialChecked = document.getElementById('deposit-self-custodial-checkbox').checked;

    // Get form values
    const btcAmount = parseFloat(document.getElementById('deposit-amount-btc').value);

    // Validate BTC amount
    if (!btcAmount || btcAmount <= 0) {
        alert('Please enter a valid BTC amount');
        return;
    }

    // Determine which endpoint configuration to use
    let endpointConfig = {
        useTravel: false,
        useSelfCustodial: false,
        travelData: null
    };

    if (travelRuleChecked) {
        if (selfCustodialChecked) {
            // Self-custodial: isSelfHosted=true, empty travel data
            endpointConfig.useSelfCustodial = true;
            console.log('📋 Mode: Self-custodial wallet (isSelfHosted=true)');
        } else {
            // VASP travel data: isVasp=true, with travel data
            endpointConfig.useTravel = true;

            // Validate travel data selection
            const travelDataIndex = document.getElementById('deposit-travel-data-select').value;
            if (!travelDataIndex || travelDataIndex === 'add-new') {
                alert('Please select saved travel data');
                return;
            }

            // Get travel data
            const allTravelData = JSON.parse(localStorage.getItem(`${loggedInUser}_travelData`)) || [];
            const travelData = allTravelData[travelDataIndex];

            if (!travelData) {
                alert('Selected travel data not found');
                return;
            }

            endpointConfig.travelData = travelData;
            console.log('📋 Mode: VASP travel data (isVasp=true)');
        }
    } else {
        // Default: no travel data, no special params
        console.log('📋 Mode: Default (no travel data)');
    }

    // Get NiceHash API credentials
    const easyMiningSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || {};
    const apiKey = easyMiningSettings.apiKey;
    const apiSecret = easyMiningSettings.apiSecret;
    const orgId = easyMiningSettings.orgId;

    if (!apiKey || !apiSecret || !orgId) {
        alert('NiceHash API credentials not configured. Please set them in EasyMining Settings.');
        return;
    }

    // Disable generate button
    const generateBtn = document.getElementById('generate-deposit-btn');
    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ Generating...';

    try {
        // Step 1: Generate deposit address from NiceHash API
        const depositAddress = await fetchNiceHashDepositAddress(btcAmount, endpointConfig);

        if (!depositAddress) {
            throw new Error('Failed to generate deposit address');
        }

        console.log('✅ Deposit address generated:', depositAddress);

        // Step 2: Generate QR code
        const qrCodeSvg = await generateQrCode(depositAddress);

        if (!qrCodeSvg) {
            console.warn('⚠️ Failed to generate QR code, but address is valid');
        }

        // Display results
        displayDepositResults(depositAddress, qrCodeSvg);

    } catch (error) {
        console.error('❌ Error generating deposit address:', error);
        alert(`Error generating deposit address: ${error.message}`);
    } finally {
        // Re-enable generate button
        generateBtn.disabled = false;
        generateBtn.textContent = '⚡ Generate Deposit Address';
    }
}

/**
 * Fetch deposit address from NiceHash API (via Vercel proxy to avoid CORS)
 */
async function fetchNiceHashDepositAddress(amount, endpointConfig) {
    console.log('📡 Fetching deposit address from NiceHash API...');

    // Build request URL with query parameters based on configuration
    const path = '/main/api/v2/accounting/depositAddress/ln';
    const params = new URLSearchParams({
        amount: amount.toString()
    });

    // Add endpoint-specific parameters based on mode
    if (endpointConfig.useSelfCustodial) {
        // Self-custodial mode: isSelfHosted=true
        params.append('isSelfHosted', 'true');
    } else if (endpointConfig.useTravel) {
        // VASP travel data mode: isVasp=true
        params.append('isVasp', 'true');
    }
    // Default mode: no additional params

    const endpoint = `${path}?${params.toString()}`;

    // Build request body based on configuration
    // Initialize with empty fields (used for both-unchecked and self-custodial modes)
    let requestBody = {
        emailVASPId: '',
        firstName: '',
        lastName: '',
        legalName: '',
        postalCode: '',
        town: '',
        country: ''
    };

    if (endpointConfig.useTravel && endpointConfig.travelData) {
        // VASP travel data mode (DEFAULT - travel rule checked): include travel data from dropdown
        requestBody = {
            emailVASPId: endpointConfig.travelData.emailVASPId,
            firstName: endpointConfig.travelData.firstName,
            lastName: endpointConfig.travelData.lastName,
            legalName: endpointConfig.travelData.legalName,
            postalCode: endpointConfig.travelData.postalCode,
            town: endpointConfig.travelData.town,
            country: endpointConfig.travelData.country
        };
    }
    // Self-custodial mode or both unchecked: empty body fields (already initialized above)

    console.log('📤 POST request to NiceHash (via Vercel proxy)');
    console.log('📤 Endpoint:', endpoint);
    console.log('📤 Request body:', requestBody);

    // Generate NiceHash authentication headers using the standard function
    const headers = generateNiceHashAuthHeaders('POST', endpoint, requestBody);

    try {
        // Use Vercel proxy to avoid CORS issues
        const response = await fetch(VERCEL_PROXY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: endpoint,
                method: 'POST',
                headers: headers,
                body: requestBody
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ NiceHash API error:', errorText);
            throw new Error(`NiceHash API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ NiceHash API response:', data);

        // Extract address from response
        // Response format: { type: { code: "LIGHTNING" }, address: "lightning:lnbc...", currency: "BTC" }
        return data.address;

    } catch (error) {
        console.error('❌ Error fetching deposit address:', error);
        throw error;
    }
}

/**
 * Generate QR code from address (via Vercel proxy to avoid CORS)
 */
async function generateQrCode(lightningAddress) {
    console.log('📱 Generating QR code...');

    // Remove "lightning:" prefix for QR code (only use the address part)
    const addressOnly = lightningAddress.replace(/^lightning:/i, '');

    // Get current token
    const token = QR_CODE_TOKENS[currentQrTokenIndex];

    const requestBody = {
        frame_name: 'no-frame',
        qr_code_text: addressOnly,
        image_format: 'SVG',
        qr_code_logo: 'scan-me-square',
        download: 0  // Return data (not send to browser)
    };

    console.log('📤 QR code POST request (via Vercel proxy)');
    console.log('📤 QR code text:', addressOnly.substring(0, 50) + '...');
    console.log('📤 Using token index:', currentQrTokenIndex);
    console.log('📤 Request body:', requestBody);

    try {
        // Call QR code API via Vercel proxy to avoid CORS
        const fullUrl = `https://api.qr-code-generator.com/v1/create?access-token=${token}&download=0`;

        console.log('📤 Full URL:', fullUrl);
        console.log('📤 Calling QR API via /api/qrcode proxy');

        const response = await fetch('/api/qrcode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: fullUrl,
                body: requestBody
            })
        });

        console.log('📥 QR code proxy response status:', response.status);

        if (!response.ok) {
            // Try fallback token
            if (currentQrTokenIndex < QR_CODE_TOKENS.length - 1) {
                console.warn('⚠️ QR code API token failed, trying fallback...');
                currentQrTokenIndex++;
                return await generateQrCode(lightningAddress); // Retry with next token
            }
            const errorText = await response.text();
            console.error('❌ QR code API error response:', errorText);
            throw new Error(`QR code API error: ${response.status} ${response.statusText}`);
        }

        const svgText = await response.text();
        console.log('✅ QR code generated successfully, SVG length:', svgText.length);
        return svgText;

    } catch (error) {
        console.error('❌ Error generating QR code:', error.message);
        console.error('❌ Full error:', error);
        return null; // Return null if QR code generation fails (non-critical)
    }
}

/**
 * Display deposit results (address + QR code)
 */
function displayDepositResults(lightningAddress, qrCodeSvg) {
    console.log('📺 Displaying deposit results...');

    // Remove "lightning:" prefix from address for display
    const addressOnly = lightningAddress.replace(/^lightning:/i, '');

    // Show output section
    document.getElementById('deposit-output-section').style.display = 'block';

    // Display address (without "lightning:" prefix, it's shown as a label)
    document.getElementById('deposit-address-output').value = addressOnly;

    // Display QR code (if available)
    const qrContainer = document.getElementById('qr-code-container');
    if (qrCodeSvg) {
        qrContainer.innerHTML = qrCodeSvg;

        // Ensure SVG is properly sized
        const svgElement = qrContainer.querySelector('svg');
        if (svgElement) {
            svgElement.setAttribute('width', '300');
            svgElement.setAttribute('height', '300');
            svgElement.style.display = 'block';
            svgElement.style.maxWidth = '100%';
            svgElement.style.height = 'auto';
            console.log('📐 SVG sized to 300x300px');
        }
    } else {
        qrContainer.innerHTML = '<p style="color: #f44336;">QR code generation failed</p>';
    }

    console.log('✅ Deposit address displayed successfully');
}

/**
 * Copy deposit address to clipboard
 */
function copyDepositAddress() {
    const addressInput = document.getElementById('deposit-address-output');
    const address = addressInput.value;

    if (!address) {
        alert('No address to copy');
        return;
    }

    // Copy to clipboard
    navigator.clipboard.writeText(address).then(() => {
        console.log('📋 Address copied to clipboard');
        alert('✅ Address copied to clipboard!');
    }).catch(err => {
        console.error('❌ Failed to copy address:', err);
        alert('Failed to copy address');
    });
}

// Helper function to generate UUID v4 (for NiceHash API)
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ========================================
// BTC WITHDRAW FUNCTIONS
// ========================================

/**
 * Show the BTC Withdraw page
 */
function showWithdrawPage() {
    console.log('💸 Showing BTC Withdraw Page');

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';
    document.getElementById('travel-data-page').style.display = 'none';
    document.getElementById('deposits-page').style.display = 'none';

    // Show withdraw page
    document.getElementById('withdraw-page').style.display = 'block';

    // Load withdrawal addresses and update balance
    fetchWithdrawalAddresses();
    updateWithdrawBalance();

    // Clear previous outputs
    document.getElementById('withdraw-output-section').style.display = 'none';
    document.getElementById('withdraw-amount-btc').value = '';
    document.getElementById('withdraw-amount-aud').value = '';
    document.getElementById('withdraw-note').value = '';
    document.getElementById('withdraw-transaction-result').innerHTML = '';
}

/**
 * Fetch withdrawal addresses from NiceHash API and populate dropdown
 */
async function fetchWithdrawalAddresses() {
    console.log('🔄 Fetching withdrawal addresses from NiceHash...');

    const dropdown = document.getElementById('withdraw-address-select');

    // Clear existing options
    dropdown.innerHTML = '<option value="">Loading...</option>';

    try {
        const endpoint = '/main/api/v2/accounting/withdrawalAddresses?currency=BTC';
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        let response;
        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, method: 'GET', headers })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers
            });
        }

        if (!response.ok) {
            throw new Error(`NiceHash API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ Withdrawal addresses fetched:', data);

        // Populate dropdown
        populateWithdrawAddressDropdown(data.list || []);

    } catch (error) {
        console.error('❌ Error fetching withdrawal addresses:', error);
        dropdown.innerHTML = '<option value="">Error loading addresses</option>';
        alert('⚠️ Failed to load withdrawal addresses. Please check your API credentials.');
    }
}

/**
 * Populate withdrawal address dropdown
 */
function populateWithdrawAddressDropdown(addresses) {
    const dropdown = document.getElementById('withdraw-address-select');

    // Clear existing options
    dropdown.innerHTML = '<option value="">Select withdrawal address...</option>';

    if (addresses.length === 0) {
        const noAddressOption = document.createElement('option');
        noAddressOption.value = '';
        noAddressOption.textContent = 'No withdrawal addresses found';
        noAddressOption.disabled = true;
        dropdown.appendChild(noAddressOption);
        return;
    }

    // Add each address
    addresses.forEach(addr => {
        if (addr.status.code !== 'ACTIVE') {
            return; // Skip inactive addresses
        }

        const option = document.createElement('option');
        // Store full address data as JSON in value
        option.value = JSON.stringify({
            id: addr.id,
            address: addr.address,
            name: addr.name,
            walletType: addr.type.code
        });

        // Format display: Name on line 1, address preview on line 2
        const addressPreview = addr.address.substring(0, 4) + '...' + addr.address.substring(addr.address.length - 4);
        option.textContent = `${addr.name} (${addressPreview})`;

        dropdown.appendChild(option);
    });

    console.log(`✅ Populated dropdown with ${addresses.length} withdrawal addresses`);
}

/**
 * Update available BTC balance display
 */
function updateWithdrawBalance() {
    // Get available BTC from EasyMining balance
    const availableBtcElement = document.getElementById('easymining-available-btc');
    const availableBtc = availableBtcElement
        ? parseFloat(availableBtcElement.textContent) || 0
        : 0;

    // Display in withdraw page
    const balanceDisplay = document.getElementById('withdraw-available-balance');
    if (balanceDisplay) {
        balanceDisplay.textContent = availableBtc.toFixed(8);
    }

    console.log(`💰 Available BTC for withdrawal: ${availableBtc.toFixed(8)}`);
}

/**
 * Convert BTC input to AUD for withdraw
 */
function convertBtcToAudWithdraw() {
    const btcInput = document.getElementById('withdraw-amount-btc');
    const audInput = document.getElementById('withdraw-amount-aud');

    const btcAmount = parseFloat(btcInput.value) || 0;

    // Get current BTC price in AUD from DOM element
    const priceElement = document.getElementById('bitcoin-price-aud');
    const btcPriceAud = priceElement
        ? parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0
        : 0;

    if (btcPriceAud > 0) {
        const audAmount = btcAmount * btcPriceAud;
        audInput.value = audAmount.toFixed(2);
        console.log(`💱 Converted ${btcAmount} BTC to $${audAmount.toFixed(2)} AUD`);
    } else {
        console.warn('⚠️ BTC price not available. Add Bitcoin to portfolio first.');
    }
}

/**
 * Convert AUD input to BTC for withdraw
 */
function convertAudToBtcWithdraw() {
    const btcInput = document.getElementById('withdraw-amount-btc');
    const audInput = document.getElementById('withdraw-amount-aud');

    const audAmount = parseFloat(audInput.value) || 0;

    const priceElement = document.getElementById('bitcoin-price-aud');
    const btcPriceAud = priceElement
        ? parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0
        : 0;

    if (btcPriceAud > 0) {
        const btcAmount = audAmount / btcPriceAud;
        btcInput.value = btcAmount.toFixed(8);
        console.log(`💱 Converted $${audAmount} AUD to ${btcAmount.toFixed(8)} BTC`);
    } else {
        console.warn('⚠️ BTC price not available. Add Bitcoin to portfolio first.');
    }
}

/**
 * Add maximum BTC amount (minus transaction fee) to withdraw input
 */
function addMaxAmountWithdraw() {
    const TRANSACTION_FEE = 0.00001;

    // Get available BTC from EasyMining balance
    const availableBtcElement = document.getElementById('easymining-available-btc');
    const availableBtc = availableBtcElement
        ? parseFloat(availableBtcElement.textContent) || 0
        : 0;

    // Calculate max amount (available balance minus transaction fee)
    const maxAmount = Math.max(0, availableBtc - TRANSACTION_FEE);

    // Set BTC input to max amount
    const btcInput = document.getElementById('withdraw-amount-btc');
    btcInput.value = maxAmount.toFixed(8);

    // Trigger conversion to update AUD field
    convertBtcToAudWithdraw();

    console.log(`➕ Added max amount: ${maxAmount.toFixed(8)} BTC (${availableBtc.toFixed(8)} - ${TRANSACTION_FEE} fee)`);
}

/**
 * Execute BTC withdrawal
 */
async function executeWithdrawal() {
    console.log('💸 Initiating BTC withdrawal...');

    // Get form values
    const btcAmount = parseFloat(document.getElementById('withdraw-amount-btc').value);
    const selectedAddressJson = document.getElementById('withdraw-address-select').value;
    const note = document.getElementById('withdraw-note').value || '';

    // Validate amount
    if (!btcAmount || btcAmount <= 0) {
        alert('⚠️ Please enter a valid BTC amount');
        return;
    }

    // Validate address selection
    if (!selectedAddressJson) {
        alert('⚠️ Please select a withdrawal address');
        return;
    }

    // Parse selected address data
    let addressData;
    try {
        addressData = JSON.parse(selectedAddressJson);
    } catch (e) {
        console.error('❌ Error parsing address data:', e);
        alert('⚠️ Invalid address selection');
        return;
    }

    // Check available balance
    const availableBtcElement = document.getElementById('easymining-available-btc');
    const availableBtc = availableBtcElement
        ? parseFloat(availableBtcElement.textContent) || 0
        : 0;

    if (btcAmount > availableBtc) {
        alert(`⚠️ Insufficient balance. You have ${availableBtc.toFixed(8)} BTC available.`);
        return;
    }

    // Get NiceHash API credentials
    const easyMiningSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || {};
    const apiKey = easyMiningSettings.apiKey;
    const apiSecret = easyMiningSettings.apiSecret;
    const orgId = easyMiningSettings.orgId;

    if (!apiKey || !apiSecret || !orgId) {
        alert('⚠️ NiceHash API credentials not configured. Please set them in EasyMining Settings.');
        return;
    }

    // Confirm withdrawal
    const confirmed = confirm(
        `⚠️ CONFIRM WITHDRAWAL\n\n` +
        `Amount: ${btcAmount.toFixed(8)} BTC\n` +
        `Address: ${addressData.name}\n` +
        `Destination: ${addressData.address}\n` +
        `Note: ${note || '(none)'}\n\n` +
        `This action cannot be undone. Continue?`
    );

    if (!confirmed) {
        console.log('❌ Withdrawal cancelled by user');
        return;
    }

    // Disable withdraw button
    const withdrawBtn = document.getElementById('execute-withdraw-btn');
    withdrawBtn.disabled = true;
    withdrawBtn.textContent = '⏳ Processing...';

    try {
        // Execute withdrawal via NiceHash API
        const result = await callNiceHashWithdrawal(btcAmount, addressData, note);

        console.log('✅ Withdrawal successful:', result);

        // Display success message
        displayWithdrawSuccess(result, addressData);

        // Refresh EasyMining balances
        if (easyMiningActive) {
            fetchEasyMiningData();
        }

    } catch (error) {
        console.error('❌ Error processing withdrawal:', error);
        alert(`❌ Withdrawal failed: ${error.message}`);

        // Hide output section on error
        document.getElementById('withdraw-output-section').style.display = 'none';
    } finally {
        // Re-enable withdraw button
        withdrawBtn.disabled = false;
        withdrawBtn.textContent = '💸 Execute Withdrawal';
    }
}

/**
 * Call NiceHash withdrawal API
 */
async function callNiceHashWithdrawal(amount, addressData, note) {
    console.log('📡 Calling NiceHash withdrawal API...');

    const endpoint = '/main/api/v2/accounting/withdrawal';

    // Build request body
    const requestBody = {
        currency: 'BTC',
        amount: amount.toString(),
        withdrawalAddressId: addressData.id,
        userNote: note,
        walletType: addressData.walletType
    };

    console.log('📤 POST request to NiceHash (via Vercel proxy)');
    console.log('📤 Endpoint:', endpoint);
    console.log('📤 Request body:', requestBody);

    // Generate NiceHash authentication headers
    const headers = generateNiceHashAuthHeaders('POST', endpoint, requestBody);

    try {
        // Use Vercel proxy to avoid CORS issues
        const response = await fetch(VERCEL_PROXY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: endpoint,
                method: 'POST',
                headers: headers,
                body: requestBody
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ NiceHash API error:', errorText);
            throw new Error(`NiceHash API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ NiceHash API response:', data);

        return data;

    } catch (error) {
        console.error('❌ Error calling withdrawal API:', error);
        throw error;
    }
}

/**
 * Display withdrawal success message
 */
function displayWithdrawSuccess(result, addressData) {
    console.log('📺 Displaying withdrawal success...');

    // Show output section
    document.getElementById('withdraw-output-section').style.display = 'block';

    // Display transaction result
    const resultDiv = document.getElementById('withdraw-transaction-result');
    resultDiv.innerHTML = `
        <div style="text-align: center; padding: 20px; background-color: rgba(76, 175, 80, 0.1); border-radius: 5px; border-left: 4px solid #4CAF50;">
            <h3 style="color: #4CAF50; margin: 0 0 15px 0;">✅ Withdrawal Successful!</h3>
            <p style="margin: 5px 0;">Your withdrawal has been initiated.</p>
            <p style="margin: 5px 0;"><strong>Destination:</strong> ${addressData.name}</p>
            <p style="margin: 5px 0;"><strong>Address:</strong> ${addressData.address}</p>
            ${result.id ? `<p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${result.id}</p>` : ''}
            ${result.status ? `<p style="margin: 5px 0;"><strong>Status:</strong> ${result.status}</p>` : ''}
            <p style="color: #aaa; font-size: 14px; margin-top: 15px;">
                Please check your NiceHash account for transaction details.
            </p>
        </div>
    `;

    console.log('✅ Withdrawal success displayed');
}

// ========================================
// PACKAGE ALERTS FUNCTIONS
// ========================================

async function showPackageAlertsPage() {
    console.log('Showing Package Alerts Page');

    // Stop buy packages and alerts polling when leaving the page
    stopBuyPackagesPolling();
    stopEasyMiningAlertsPolling();

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('withdrawal-addresses-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';

    // Show Package Alerts page
    document.getElementById('package-alerts-page').style.display = 'block';

    // Load both solo and team alerts
    await loadSoloAlerts();
    await loadTeamAlerts();
}

function showAlertTab(tabName) {
    console.log('Switching to alert tab:', tabName);

    // Update tab buttons
    const tabs = document.querySelectorAll('.buy-packages-tabs .tab-button');
    tabs.forEach(tab => tab.classList.remove('active'));

    // Show selected tab content
    if (tabName === 'solo') {
        tabs[0].classList.add('active');
        document.getElementById('solo-alerts-tab').style.display = 'block';
        document.getElementById('team-alerts-tab').style.display = 'none';
    } else if (tabName === 'team') {
        tabs[1].classList.add('active');
        document.getElementById('solo-alerts-tab').style.display = 'none';
        document.getElementById('team-alerts-tab').style.display = 'block';
    }
}

async function loadSoloAlerts() {
    console.log('Loading solo package alerts...');

    // Fetch packages from API
    const packages = await fetchNiceHashSoloPackages();

    if (!packages || packages.length === 0) {
        console.error('No solo packages available to set alerts for');
        document.getElementById('solo-alerts-list').innerHTML = '<p style="color: #ff6b6b;">Could not load solo packages. Please try again.</p>';
        return;
    }

    // Get saved alerts and auto-buy settings
    const savedAlerts = JSON.parse(localStorage.getItem(`${loggedInUser}_soloPackageAlerts`)) || {};
    const savedAutoBuy = JSON.parse(localStorage.getItem(`${loggedInUser}_soloAutoBuy`)) || {};

    const alertsList = document.getElementById('solo-alerts-list');
    alertsList.innerHTML = '';

    // Create input for each package
    packages.forEach(pkg => {
        const alertDiv = document.createElement('div');
        alertDiv.style.cssText = 'margin-bottom: 15px; padding: 15px; background-color: #3a3a3a; border-radius: 8px; border: 1px solid #444;';

        // Check if this is a dual-crypto package (Palladium)
        const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCurrencyAlgo && pkg.mergeCurrencyAlgo.title);

        if (isDualCrypto) {
            // For dual-crypto packages (DOGE+LTC), show two separate inputs
            const mainCrypto = pkg.mainCrypto || pkg.currencyAlgo?.title || 'LTC';
            const mergeCrypto = pkg.mergeCrypto || pkg.mergeCurrencyAlgo?.title || 'DOGE';

            // Extract both probabilities
            let mainProbability = '';
            let mergeProbability = '';

            if (pkg.probability) {
                const match = pkg.probability.match(/1:(\d+)/);
                if (match) mainProbability = match[1];
            }
            if (pkg.mergeProbability) {
                const match = pkg.mergeProbability.match(/1:(\d+)/);
                if (match) mergeProbability = match[1];
            }

            const savedMainThreshold = savedAlerts[`${pkg.name}_${mainCrypto}`] || '';
            const savedMergeThreshold = savedAlerts[`${pkg.name}_${mergeCrypto}`] || '';
            const isMainActive = savedMainThreshold !== '';
            const isMergeActive = savedMergeThreshold !== '';
            const autoBuyEnabled = savedAutoBuy[pkg.name]?.enabled || false;

            alertDiv.innerHTML = `
                <div style="margin-bottom: 12px;">
                    <strong style="color: #ffa500; font-size: 16px;">${pkg.name}</strong>
                    <span style="color: #888; font-size: 13px; margin-left: 8px;">(Dual-Crypto Package)</span>
                </div>

                <!-- LTC Alert -->
                <div style="margin-bottom: 10px; padding-left: 10px; border-left: 3px solid #F7931A;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="color: #F7931A; font-weight: bold;">${mainCrypto}</span>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${mainProbability}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <label style="color: #aaa; font-size: 14px;">Alert when ≤ 1:</label>
                        <input type="number"
                               id="alert-${pkg.name.replace(/\s+/g, '-')}-${mainCrypto}"
                               value="${savedMainThreshold}"
                               placeholder="e.g., 130"
                               min="1"
                               style="width: 100px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                        ${isMainActive ? '<span style="color: #4CAF50; font-size: 12px;">✓ Active</span>' : '<span style="color: #888; font-size: 12px;">Not set</span>'}
                    </div>
                </div>

                <!-- DOGE Alert -->
                <div style="margin-bottom: 10px; padding-left: 10px; border-left: 3px solid #C3A634;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="color: #C3A634; font-weight: bold;">${mergeCrypto}</span>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${mergeProbability}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <label style="color: #aaa; font-size: 14px;">Alert when ≤ 1:</label>
                        <input type="number"
                               id="alert-${pkg.name.replace(/\s+/g, '-')}-${mergeCrypto}"
                               value="${savedMergeThreshold}"
                               placeholder="e.g., 150"
                               min="1"
                               style="width: 100px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                        ${isMergeActive ? '<span style="color: #4CAF50; font-size: 12px;">✓ Active</span>' : '<span style="color: #888; font-size: 12px;">Not set</span>'}
                    </div>
                </div>

                <!-- Auto-Buy Toggle -->
                <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background-color: #2a2a2a; border-radius: 4px; margin-top: 10px;">
                    <label style="color: #aaa; font-size: 14px; flex: 1;">🤖 Auto-Buy on Alert:</label>
                    <input type="checkbox"
                           id="autobuy-${pkg.name.replace(/\s+/g, '-')}"
                           data-package-name="${pkg.name}"
                           data-crypto="${mainCrypto}"
                           data-merge-crypto="${mergeCrypto}"
                           ${autoBuyEnabled ? 'checked' : ''}
                           style="width: 20px; height: 20px; cursor: pointer;">
                    <span style="color: ${autoBuyEnabled ? '#4CAF50' : '#888'}; font-size: 12px; min-width: 60px;">
                        ${autoBuyEnabled ? '✓ Enabled' : 'Disabled'}
                    </span>
                </div>
            `;
        } else {
            // Single crypto package - original logic
            let currentProbability = '';
            if (pkg.probability) {
                const match = pkg.probability.match(/1:(\d+)/);
                if (match) {
                    currentProbability = match[1];
                }
            }

            const savedThreshold = savedAlerts[pkg.name] || '';
            const isActive = savedThreshold !== '';
            const autoBuyEnabled = savedAutoBuy[pkg.name]?.enabled || false;

            alertDiv.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="color: #ffa500; font-size: 16px;">${pkg.name}</strong>
                    <span style="color: #4CAF50; font-size: 13px;">Current: 1:${currentProbability}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                    <label style="color: #aaa; font-size: 14px;">Alert when probability ≤ 1:</label>
                    <input type="number"
                           id="alert-${pkg.name.replace(/\s+/g, '-')}"
                           value="${savedThreshold}"
                           placeholder="e.g., 130"
                           min="1"
                           style="width: 100px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                    ${isActive ? '<span style="color: #4CAF50; font-size: 12px;">✓ Active</span>' : '<span style="color: #888; font-size: 12px;">Not set</span>'}
                </div>
                <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background-color: #2a2a2a; border-radius: 4px;">
                    <label style="color: #aaa; font-size: 14px; flex: 1;">🤖 Auto-Buy on Alert:</label>
                    <input type="checkbox"
                           id="autobuy-${pkg.name.replace(/\s+/g, '-')}"
                           data-package-name="${pkg.name}"
                           data-crypto="${pkg.crypto}"
                           ${autoBuyEnabled ? 'checked' : ''}
                           style="width: 20px; height: 20px; cursor: pointer;">
                    <span style="color: ${autoBuyEnabled ? '#4CAF50' : '#888'}; font-size: 12px; min-width: 60px;">
                        ${autoBuyEnabled ? '✓ Enabled' : 'Disabled'}
                    </span>
                </div>
            `;
        }

        alertsList.appendChild(alertDiv);
    });

    // Add event listeners to auto-buy checkboxes
    document.querySelectorAll('[id^="autobuy-"]').forEach(checkbox => {
        if (!checkbox.id.includes('shares')) { // Exclude share input fields
            checkbox.addEventListener('change', function() {
                const packageName = this.dataset.packageName;
                const crypto = this.dataset.crypto;
                const mergeCrypto = this.dataset.mergeCrypto || null;

                if (this.checked) {
                    // Auto-buy enabled (no confirmation needed)
                    console.log(`✅ Auto-Buy enabled for ${packageName} (solo package)`);

                    // Check/prompt for withdrawal addresses
                    const savedAddresses = JSON.parse(localStorage.getItem(`${loggedInUser}_withdrawalAddresses`)) || {};

                    let mainAddress = savedAddresses[crypto];
                    if (!mainAddress) {
                        mainAddress = prompt(`Enter ${crypto} withdrawal address for auto-buy:`);
                        if (!mainAddress || mainAddress.trim() === '') {
                            alert('Withdrawal address is required for auto-buy');
                            this.checked = false;
                            return;
                        }
                        savedAddresses[crypto] = mainAddress.trim();
                    }

                    let mergeAddress = null;
                    if (mergeCrypto) {
                        mergeAddress = savedAddresses[mergeCrypto];
                        if (!mergeAddress) {
                            mergeAddress = prompt(`Enter ${mergeCrypto} withdrawal address for auto-buy:`);
                            if (!mergeAddress || mergeAddress.trim() === '') {
                                alert('Withdrawal address is required for auto-buy');
                                this.checked = false;
                                return;
                            }
                            savedAddresses[mergeCrypto] = mergeAddress.trim();
                        }
                    }

                    // Save addresses
                    localStorage.setItem(`${loggedInUser}_withdrawalAddresses`, JSON.stringify(savedAddresses));

                    // Save auto-buy settings
                    const storageKey = `${loggedInUser}_soloAutoBuy`;
                    const autoBuySettings = JSON.parse(localStorage.getItem(storageKey)) || {};

                    autoBuySettings[packageName] = {
                        enabled: true,
                        crypto: crypto,
                        mergeCrypto: mergeCrypto || null,
                        mainAddress: mainAddress,
                        mergeAddress: mergeAddress,
                        shares: 1,
                        lastBuyTime: null
                    };

                    localStorage.setItem(storageKey, JSON.stringify(autoBuySettings));
                    console.log(`✅ Auto-buy enabled for ${packageName}`);

                    // Update status text
                    const statusSpan = this.nextElementSibling;
                    if (statusSpan) {
                        statusSpan.textContent = '✓ Enabled';
                        statusSpan.style.color = '#4CAF50';
                    }

                    alert(`Auto-buy enabled for ${packageName}!`);
                } else {
                    // Disable auto-buy
                    const storageKey = `${loggedInUser}_soloAutoBuy`;
                    const autoBuySettings = JSON.parse(localStorage.getItem(storageKey)) || {};

                    if (autoBuySettings[packageName]) {
                        autoBuySettings[packageName].enabled = false;
                        localStorage.setItem(storageKey, JSON.stringify(autoBuySettings));
                        console.log(`❌ Auto-buy disabled for ${packageName}`);

                        // Update status text
                        const statusSpan = this.nextElementSibling;
                        if (statusSpan) {
                            statusSpan.textContent = 'Disabled';
                            statusSpan.style.color = '#888';
                        }
                    }
                }
            });
        }
    });

    console.log(`✅ Loaded ${packages.length} solo package alert settings`);
}

async function loadTeamAlerts() {
    console.log('Loading team package alerts...');

    // Fetch team packages from API
    const packages = await fetchNiceHashTeamPackages();

    if (!packages || packages.length === 0) {
        console.error('No team packages available to set alerts for');
        document.getElementById('team-alerts-list').innerHTML = '<p style="color: #ff6b6b;">Could not load team packages. Please try again.</p>';
        return;
    }

    // Fetch solo packages to get current small package probabilities
    const soloPackages = await fetchNiceHashSoloPackages();
    console.log(`📦 Fetched ${soloPackages?.length || 0} solo packages for current probability display`);

    // Get saved team alerts
    const savedAlerts = JSON.parse(localStorage.getItem(`${loggedInUser}_teamPackageAlerts`)) || {};
    const savedAutoBuy = JSON.parse(localStorage.getItem(`${loggedInUser}_teamAutoBuy`)) || {};

    const alertsList = document.getElementById('team-alerts-list');
    alertsList.innerHTML = '';

    // Create input for each package with 3 thresholds: probability, shares%, participants
    packages.forEach(pkg => {
        const alertDiv = document.createElement('div');
        alertDiv.style.cssText = 'margin-bottom: 15px; padding: 15px; background-color: #3a3a3a; border-radius: 8px; border: 1px solid #444;';

        // Check if this is a dual-crypto package (Palladium)
        const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCrypto);

        // Get saved thresholds for this package
        const savedSettings = savedAlerts[pkg.name] || {};
        const savedProbability = savedSettings.probability || '';
        const savedShares = savedSettings.shares || '';
        const savedParticipants = savedSettings.participants || '';
        const savedTimeUntilStart = savedSettings.timeUntilStart || '';
        const savedSmallPackageProbability = savedSettings.smallPackageProbability || '';

        // For dual-crypto, get separate thresholds
        const savedMainProb = savedSettings[`probability_${pkg.mainCrypto}`] || '';
        const savedMergeProb = savedSettings[`probability_${pkg.mergeCrypto}`] || '';

        // Find corresponding small package(s) and get current probability
        let smallPackageCurrentProb = '';
        let smallPackageDOGEProb = '';
        let smallPackageLTCProb = '';
        const savedSmallPackageDOGEProbability = savedSettings.smallPackageProbability_DOGE || '';
        const savedSmallPackageLTCProbability = savedSettings.smallPackageProbability_LTC || '';

        if (isDualCrypto) {
            // For Palladium, find the small package (has both LTC and DOGE probabilities)
            const palladiumSmallPkg = soloPackages?.find(sp => sp.name === 'Palladium S' || sp.name === 'Palladium DOGE S' || sp.name === 'Palladium LTC S');

            if (palladiumSmallPkg) {
                // LTC probability comes from "probability" field
                if (palladiumSmallPkg.probability) {
                    const match = palladiumSmallPkg.probability.match(/1:(\d+)/);
                    if (match) smallPackageLTCProb = match[1];
                }
                // DOGE probability comes from "mergeProbability" field
                if (palladiumSmallPkg.mergeProbability) {
                    const match = palladiumSmallPkg.mergeProbability.match(/1:(\d+)/);
                    if (match) smallPackageDOGEProb = match[1];
                }
            }
        } else {
            // Single crypto package
            const smallPackageName = pkg.name.replace('Team ', '') + ' S';
            const smallPackage = soloPackages?.find(sp => sp.name === smallPackageName);
            if (smallPackage && smallPackage.probability) {
                const match = smallPackage.probability.match(/1:(\d+)/);
                if (match) smallPackageCurrentProb = match[1];
            }
        }

        const isAnyActive = savedProbability || savedShares || savedParticipants || savedMainProb || savedMergeProb || savedTimeUntilStart || savedSmallPackageProbability || savedSmallPackageDOGEProbability || savedSmallPackageLTCProbability;

        // Get auto-buy settings
        const autoBuySettings = savedAutoBuy[pkg.name] || {};
        const autoBuyEnabled = autoBuySettings.enabled || false;
        const autoBuyShares = autoBuySettings.shares || 1;

        let probabilityInputs = '';

        if (isDualCrypto) {
            // Show both probability inputs for dual-crypto packages
            const mainProbMatch = pkg.mainProbability?.match(/1:(\d+)/);
            const mergeProbMatch = pkg.mergeProbability?.match(/1:(\d+)/);
            const mainProbValue = mainProbMatch ? mainProbMatch[1] : '';
            const mergeProbValue = mergeProbMatch ? mergeProbMatch[1] : '';

            probabilityInputs = `
                <div style="margin-bottom: 10px; padding-left: 10px; border-left: 3px solid #F7931A;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="color: #F7931A; font-weight: bold;">${pkg.mainCrypto} Probability</span>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${mainProbValue}</span>
                    </div>
                    <input type="number"
                           id="team-alert-${pkg.name.replace(/\s+/g, '-')}-prob-${pkg.mainCrypto}"
                           value="${savedMainProb}"
                           placeholder="e.g., 130"
                           min="1"
                           style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                </div>

                <div style="margin-bottom: 10px; padding-left: 10px; border-left: 3px solid #C3A634;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="color: #C3A634; font-weight: bold;">${pkg.mergeCrypto} Probability</span>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${mergeProbValue}</span>
                    </div>
                    <input type="number"
                           id="team-alert-${pkg.name.replace(/\s+/g, '-')}-prob-${pkg.mergeCrypto}"
                           value="${savedMergeProb}"
                           placeholder="e.g., 150"
                           min="1"
                           style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                </div>
            `;
        } else {
            // Single crypto package
            const probMatch = pkg.probability?.match(/1:(\d+)/);
            const probValue = probMatch ? probMatch[1] : '';

            probabilityInputs = `
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="color: #aaa;">Probability Threshold</span>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${probValue}</span>
                    </div>
                    <input type="number"
                           id="team-alert-${pkg.name.replace(/\s+/g, '-')}-probability"
                           value="${savedProbability}"
                           placeholder="e.g., 130"
                           min="1"
                           style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                </div>
            `;
        }

        // Create small package probability inputs (dual for Palladium, single for others)
        let smallPackageProbabilityInputs = '';

        if (isDualCrypto) {
            // Show both small package probability inputs for Palladium (DOGE S + LTC S)
            smallPackageProbabilityInputs = `
                <div style="margin-bottom: 10px; padding-left: 10px; border-left: 3px solid #F7931A;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <label style="color: #aaa; font-size: 14px;">📦 DOGE Small Package Probability (Palladium DOGE S)</label>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${smallPackageDOGEProb || 'N/A'}</span>
                    </div>
                    <input type="number"
                           id="team-alert-${pkg.name.replace(/\s+/g, '-')}-smallPackageProbability-DOGE"
                           value="${savedSmallPackageDOGEProbability}"
                           placeholder="e.g., 130 (means 1:≤130)"
                           min="1"
                           style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                </div>

                <div style="margin-bottom: 10px; padding-left: 10px; border-left: 3px solid #C3A634;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <label style="color: #aaa; font-size: 14px;">📦 LTC Small Package Probability (Palladium LTC S)</label>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${smallPackageLTCProb || 'N/A'}</span>
                    </div>
                    <input type="number"
                           id="team-alert-${pkg.name.replace(/\s+/g, '-')}-smallPackageProbability-LTC"
                           value="${savedSmallPackageLTCProbability}"
                           placeholder="e.g., 150 (means 1:≤150)"
                           min="1"
                           style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                    <div style="color: #888; font-size: 12px; margin-top: 5px;">
                        ⚠️ If set, both small packages must meet their probability thresholds AND one of the other thresholds
                    </div>
                </div>
            `;
        } else {
            // Single crypto package - single small package probability input
            smallPackageProbabilityInputs = `
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <label style="color: #aaa; font-size: 14px;">📦 Small Package Probability Threshold (${pkg.name.replace('Team ', '')} S)</label>
                        <span style="color: #4CAF50; font-size: 13px;">Current: 1:${smallPackageCurrentProb || 'N/A'}</span>
                    </div>
                    <input type="number"
                           id="team-alert-${pkg.name.replace(/\s+/g, '-')}-smallPackageProbability"
                           value="${savedSmallPackageProbability}"
                           placeholder="e.g., 130 (means 1:≤130)"
                           min="1"
                           style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                    <div style="color: #888; font-size: 12px; margin-top: 5px;">
                        ⚠️ If set, corresponding small package must meet this probability AND one of the other thresholds
                    </div>
                </div>
            `;
        }

        alertDiv.innerHTML = `
            <div style="margin-bottom: 12px;">
                <strong style="color: #ffa500; font-size: 16px;">${pkg.name}</strong>
                ${isDualCrypto ? '<span style="color: #888; font-size: 13px; margin-left: 8px;">(Dual-Crypto)</span>' : ''}
                ${isAnyActive ? '<span style="color: #4CAF50; font-size: 12px; margin-left: 8px;">✓ Active</span>' : '<span style="color: #888; font-size: 12px; margin-left: 8px;">Not set</span>'}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="color: #888; font-size: 13px;">Current: ${pkg.numberOfParticipants || 0} participants | ${pkg.shares || '0'}% share</span>
            </div>

            ${probabilityInputs}

            <div style="margin-bottom: 10px;">
                <label style="color: #aaa; font-size: 14px; display: block; margin-bottom: 5px;">Minimum Share % Threshold</label>
                <input type="number"
                       id="team-alert-${pkg.name.replace(/\s+/g, '-')}-shares"
                       value="${savedShares}"
                       placeholder="e.g., 5 (means ≥5%)"
                       min="0"
                       max="100"
                       step="0.01"
                       style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="color: #aaa; font-size: 14px; display: block; margin-bottom: 5px;">Minimum Participants Threshold</label>
                <input type="number"
                       id="team-alert-${pkg.name.replace(/\s+/g, '-')}-participants"
                       value="${savedParticipants}"
                       placeholder="e.g., 10 (means ≥10)"
                       min="1"
                       style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="color: #aaa; font-size: 14px; display: block; margin-bottom: 5px;">⏰ Time Until Start Threshold (minutes)</label>
                <input type="number"
                       id="team-alert-${pkg.name.replace(/\s+/g, '-')}-timeUntilStart"
                       value="${savedTimeUntilStart}"
                       placeholder="e.g., 60 (within 60 minutes)"
                       min="1"
                       style="width: 150px; padding: 8px; background-color: #2a2a2a; border: 1px solid #555; color: white; border-radius: 4px;">
                <div style="color: #888; font-size: 12px; margin-top: 5px;">
                    ⚠️ If set, package must be within this many minutes of start AND meet one of the other thresholds
                </div>
            </div>

            ${smallPackageProbabilityInputs}

            <!-- Auto-Buy Section -->
            <div style="margin-top: 15px; padding: 15px; background-color: #2a2a2a; border-radius: 8px; border: 1px solid #444;">
                <div style="margin-bottom: 10px;">
                    <label style="color: #aaa; font-size: 14px; display: block; margin-bottom: 8px;">🤖 Auto-Buy Shares (when alert triggers):</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button onclick="adjustTeamAutoBuyShares('${pkg.name}', -1)"
                                style="width: 35px; height: 35px; background-color: #444; color: white; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 18px; font-weight: bold;">-</button>
                        <input type="number"
                               id="team-autobuy-shares-${pkg.name.replace(/\s+/g, '-')}"
                               value="${autoBuyShares}"
                               min="1"
                               max="9999"
                               style="width: 80px; padding: 8px; background-color: #1a1a1a; border: 1px solid #555; color: white; border-radius: 4px; text-align: center; font-size: 16px;">
                        <button onclick="adjustTeamAutoBuyShares('${pkg.name}', 1)"
                                style="width: 35px; height: 35px; background-color: #444; color: white; border: 1px solid #666; border-radius: 4px; cursor: pointer; font-size: 18px; font-weight: bold;">+</button>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background-color: #1a1a1a; border-radius: 4px;">
                    <label style="color: #aaa; font-size: 14px; flex: 1;">🤖 Auto-Buy on Alert:</label>
                    <input type="checkbox"
                           id="team-autobuy-${pkg.name.replace(/\s+/g, '-')}"
                           data-package-name="${pkg.name}"
                           data-crypto="${isDualCrypto ? pkg.mainCrypto : pkg.crypto}"
                           ${isDualCrypto ? `data-merge-crypto="${pkg.mergeCrypto}"` : ''}
                           data-is-dual-crypto="${isDualCrypto}"
                           ${autoBuyEnabled ? 'checked' : ''}
                           style="width: 20px; height: 20px; cursor: pointer;">
                    <span style="color: ${autoBuyEnabled ? '#4CAF50' : '#888'}; font-size: 12px; min-width: 60px;">
                        ${autoBuyEnabled ? '✓ Enabled' : 'Disabled'}
                    </span>
                </div>
            </div>
        `;

        alertsList.appendChild(alertDiv);
    });

    // Add event listeners to team auto-buy checkboxes
    document.querySelectorAll('[id^="team-autobuy-"]').forEach(checkbox => {
        if (!checkbox.id.includes('shares')) { // Exclude share input fields
            checkbox.addEventListener('change', function() {
                const packageName = this.dataset.packageName;
                const crypto = this.dataset.crypto;
                const mergeCrypto = this.dataset.mergeCrypto || null;
                const isDualCrypto = this.dataset.isDualCrypto === 'true';

                if (this.checked) {
                    // Get current shares value from input
                    const sharesInputId = `team-autobuy-shares-${packageName.replace(/\s+/g, '-')}`;
                    const sharesInput = document.getElementById(sharesInputId);
                    const shares = sharesInput ? parseInt(sharesInput.value) || 1 : 1;

                    // Auto-buy enabled (no confirmation needed)
                    console.log(`✅ Auto-Buy enabled for ${packageName} (team package, ${shares} shares)`);

                    // Check/prompt for withdrawal addresses
                    const savedAddresses = JSON.parse(localStorage.getItem(`${loggedInUser}_withdrawalAddresses`)) || {};

                    let mainAddress = savedAddresses[crypto];
                    if (!mainAddress) {
                        mainAddress = prompt(`Enter ${crypto} withdrawal address for auto-buy:`);
                        if (!mainAddress || mainAddress.trim() === '') {
                            alert('Withdrawal address is required for auto-buy');
                            this.checked = false;
                            return;
                        }
                        savedAddresses[crypto] = mainAddress.trim();
                    }

                    let mergeAddress = null;
                    if (mergeCrypto) {
                        mergeAddress = savedAddresses[mergeCrypto];
                        if (!mergeAddress) {
                            mergeAddress = prompt(`Enter ${mergeCrypto} withdrawal address for auto-buy:`);
                            if (!mergeAddress || mergeAddress.trim() === '') {
                                alert('Withdrawal address is required for auto-buy');
                                this.checked = false;
                                return;
                            }
                            savedAddresses[mergeCrypto] = mergeAddress.trim();
                        }
                    }

                    // Save addresses
                    localStorage.setItem(`${loggedInUser}_withdrawalAddresses`, JSON.stringify(savedAddresses));

                    // Save auto-buy settings
                    const storageKey = `${loggedInUser}_teamAutoBuy`;
                    const autoBuySettings = JSON.parse(localStorage.getItem(storageKey)) || {};

                    autoBuySettings[packageName] = {
                        enabled: true,
                        crypto: crypto,
                        mergeCrypto: mergeCrypto || null,
                        mainAddress: mainAddress,
                        mergeAddress: mergeAddress,
                        shares: shares,
                        lastBuyTime: null
                    };

                    localStorage.setItem(storageKey, JSON.stringify(autoBuySettings));
                    console.log(`✅ Auto-buy enabled for ${packageName} with ${shares} share(s)`);

                    // Update status text
                    const statusSpan = this.nextElementSibling;
                    if (statusSpan) {
                        statusSpan.textContent = '✓ Enabled';
                        statusSpan.style.color = '#4CAF50';
                    }

                    alert(`Auto-buy enabled for ${packageName} with ${shares} share(s)!`);
                } else {
                    // Disable auto-buy
                    const storageKey = `${loggedInUser}_teamAutoBuy`;
                    const autoBuySettings = JSON.parse(localStorage.getItem(storageKey)) || {};

                    if (autoBuySettings[packageName]) {
                        autoBuySettings[packageName].enabled = false;
                        localStorage.setItem(storageKey, JSON.stringify(autoBuySettings));
                        console.log(`❌ Auto-buy disabled for ${packageName}`);

                        // Update status text
                        const statusSpan = this.nextElementSibling;
                        if (statusSpan) {
                            statusSpan.textContent = 'Disabled';
                            statusSpan.style.color = '#888';
                        }
                    }
                }
            });
        }
    });

    console.log(`✅ Loaded ${packages.length} team package alert settings`);
}

function adjustTeamAutoBuyShares(packageName, delta) {
    const inputId = `team-autobuy-shares-${packageName.replace(/\s+/g, '-')}`;
    const input = document.getElementById(inputId);

    if (input) {
        let currentValue = parseInt(input.value) || 1;
        currentValue += delta;

        // Ensure value stays within bounds
        if (currentValue < 1) currentValue = 1;
        if (currentValue > 9999) currentValue = 9999;

        input.value = currentValue;
        console.log(`Adjusted ${packageName} auto-buy shares to ${currentValue}`);
    }
}

function saveSoloAlerts() {
    console.log('Saving solo package alerts...');

    const alerts = {};
    const inputs = document.querySelectorAll('[id^="alert-"]');

    inputs.forEach(input => {
        // Extract package name and crypto from ID
        // Format: "alert-Palladium-DOGE-LTC" or "alert-Silver-S"
        const idParts = input.id.replace('alert-', '').split('-');

        // Check if this is a dual-crypto input (last part is a crypto symbol like LTC/DOGE)
        const cryptoSymbols = ['LTC', 'DOGE', 'BTC', 'BCH', 'KAS', 'RVN'];
        const lastPart = idParts[idParts.length - 1];

        let alertKey;
        if (cryptoSymbols.includes(lastPart)) {
            // Dual-crypto: "Palladium DOGE_LTC" format
            const crypto = lastPart;
            const packageName = idParts.slice(0, -1).join(' ');
            alertKey = `${packageName}_${crypto}`;
        } else {
            // Single crypto: "Silver S" format
            alertKey = idParts.join(' ');
        }

        const threshold = input.value.trim();

        if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
            alerts[alertKey] = parseInt(threshold);
        }
    });

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_soloPackageAlerts`, JSON.stringify(alerts));

    console.log('✅ Saved solo package alerts:', alerts);
    alert(`Saved ${Object.keys(alerts).length} solo package alert(s)`);

    // Reload to show updated status
    loadSoloAlerts();
}

function saveTeamAlerts() {
    console.log('Saving team package alerts...');

    const alerts = {};
    const teamInputs = document.querySelectorAll('[id^="team-alert-"]');

    // Group inputs by package name
    const packageData = {};

    teamInputs.forEach(input => {
        const id = input.id.replace('team-alert-', '');
        const parts = id.split('-');

        // Determine what type of input this is
        if (id.includes('-prob-')) {
            // Probability input with crypto (e.g., "Team-Palladium-prob-LTC")
            const crypto = parts[parts.length - 1]; // LTC or DOGE
            const packageName = parts.slice(0, -2).join(' '); // Everything before "-prob-CRYPTO"

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
                packageData[packageName][`probability_${crypto}`] = parseInt(threshold);
            }
        } else if (id.endsWith('-probability')) {
            // Single crypto probability (e.g., "Team-Gold-probability")
            const packageName = parts.slice(0, -1).join(' ');

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
                packageData[packageName].probability = parseInt(threshold);
            }
        } else if (id.endsWith('-shares')) {
            // Shares threshold
            const packageName = parts.slice(0, -1).join(' ');

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseFloat(threshold) > 0) {
                packageData[packageName].shares = parseFloat(threshold);
            }
        } else if (id.endsWith('-participants')) {
            // Participants threshold
            const packageName = parts.slice(0, -1).join(' ');

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
                packageData[packageName].participants = parseInt(threshold);
            }
        } else if (id.endsWith('-timeUntilStart')) {
            // Time until start threshold (in minutes)
            const packageName = parts.slice(0, -1).join(' ');

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
                packageData[packageName].timeUntilStart = parseInt(threshold);
            }
        } else if (id.includes('-smallPackageProbability-')) {
            // Dual-crypto small package probability (e.g., "Team-Palladium-smallPackageProbability-LTC")
            const crypto = parts[parts.length - 1]; // LTC or DOGE
            const packageName = parts.slice(0, -2).join(' '); // Everything before "-smallPackageProbability-CRYPTO"

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
                packageData[packageName][`smallPackageProbability_${crypto}`] = parseInt(threshold);
            }
        } else if (id.endsWith('-smallPackageProbability')) {
            // Single crypto small package probability threshold
            const packageName = parts.slice(0, -1).join(' ');

            if (!packageData[packageName]) packageData[packageName] = {};

            const threshold = input.value.trim();
            if (threshold !== '' && !isNaN(threshold) && parseInt(threshold) > 0) {
                packageData[packageName].smallPackageProbability = parseInt(threshold);
            }
        }
    });

    // Only save packages that have at least one threshold set
    Object.keys(packageData).forEach(packageName => {
        if (Object.keys(packageData[packageName]).length > 0) {
            alerts[packageName] = packageData[packageName];
        }
    });

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_teamPackageAlerts`, JSON.stringify(alerts));

    console.log('✅ Saved team package alerts:', alerts);
    alert(`Saved alerts for ${Object.keys(alerts).length} team package(s)`);

    // Reload to show updated status
    loadTeamAlerts();
}

function clearSoloAlerts() {
    if (!confirm('Are you sure you want to clear all solo package alerts?')) {
        return;
    }

    localStorage.removeItem(`${loggedInUser}_soloPackageAlerts`);
    console.log('Cleared all solo package alerts');
    alert('All solo package alerts have been cleared.');

    // Reload to show empty fields
    loadSoloAlerts();
}

function clearTeamAlerts() {
    if (!confirm('Are you sure you want to clear all team package alerts?')) {
        return;
    }

    localStorage.removeItem(`${loggedInUser}_teamPackageAlerts`);
    console.log('Cleared all team package alerts');
    alert('All team package alerts have been cleared.');

    // Reload to show empty fields
    loadTeamAlerts();
}

async function checkPackageRecommendations() {
    console.log('🔔 Checking solo package recommendations based on probability alerts...');

    // Get saved alerts
    const savedAlerts = JSON.parse(localStorage.getItem(`${loggedInUser}_soloPackageAlerts`)) || {};

    if (Object.keys(savedAlerts).length === 0) {
        console.log('No package alerts configured');
        return [];
    }

    // Fetch current packages from API
    const packages = await fetchNiceHashSoloPackages();

    if (!packages || packages.length === 0) {
        console.log('No packages available');
        return [];
    }

    const recommendations = [];

    // Check each package against alert thresholds
    packages.forEach(pkg => {
        // Check if this is a dual-crypto package
        const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCurrencyAlgo && pkg.mergeCurrencyAlgo.title);

        if (isDualCrypto) {
            // For dual-crypto packages, check both LTC and DOGE thresholds
            const mainCrypto = pkg.mainCrypto || pkg.currencyAlgo?.title || 'LTC';
            const mergeCrypto = pkg.mergeCrypto || pkg.mergeCurrencyAlgo?.title || 'DOGE';

            const mainThreshold = savedAlerts[`${pkg.name}_${mainCrypto}`];
            const mergeThreshold = savedAlerts[`${pkg.name}_${mergeCrypto}`];

            // If neither threshold is set, skip this package
            if (!mainThreshold && !mergeThreshold) {
                return;
            }

            // Extract probabilities
            let mainProbabilityValue = null;
            let mergeProbabilityValue = null;

            if (pkg.probability) {
                const match = pkg.probability.match(/1:(\d+)/);
                if (match) mainProbabilityValue = parseInt(match[1]);
            }
            if (pkg.mergeProbability) {
                const match = pkg.mergeProbability.match(/1:(\d+)/);
                if (match) mergeProbabilityValue = parseInt(match[1]);
            }

            // Check if either crypto meets its threshold (OR logic)
            let mainMeetsThreshold = false;
            let mergeMeetsThreshold = false;

            if (mainThreshold && mainProbabilityValue !== null && mainProbabilityValue <= mainThreshold) {
                mainMeetsThreshold = true;
                console.log(`✅ ${pkg.name} (${mainCrypto}): Current 1:${mainProbabilityValue} ≤ Threshold 1:${mainThreshold}`);
            } else if (mainThreshold) {
                console.log(`❌ ${pkg.name} (${mainCrypto}): Current 1:${mainProbabilityValue} > Threshold 1:${mainThreshold}`);
            }

            if (mergeThreshold && mergeProbabilityValue !== null && mergeProbabilityValue <= mergeThreshold) {
                mergeMeetsThreshold = true;
                console.log(`✅ ${pkg.name} (${mergeCrypto}): Current 1:${mergeProbabilityValue} ≤ Threshold 1:${mergeThreshold}`);
            } else if (mergeThreshold) {
                console.log(`❌ ${pkg.name} (${mergeCrypto}): Current 1:${mergeProbabilityValue} > Threshold 1:${mergeThreshold}`);
            }

            // Recommend if EITHER threshold is met
            if (mainMeetsThreshold || mergeMeetsThreshold) {
                console.log(`✅ ${pkg.name}: RECOMMENDED (one or both cryptos meet threshold)`);
                recommendations.push(pkg);
            }
        } else {
            // Single crypto package - original logic
            const threshold = savedAlerts[pkg.name];

            if (!threshold) {
                return; // No alert set for this package
            }

            // Extract probability value from ratio (e.g., "1:150" → 150)
            let probabilityValue = null;
            if (pkg.probability) {
                const match = pkg.probability.match(/1:(\d+)/);
                if (match) {
                    probabilityValue = parseInt(match[1]);
                }
            }

            // Check if probability meets threshold (lower is better)
            if (probabilityValue !== null && probabilityValue <= threshold) {
                console.log(`✅ ${pkg.name}: Current 1:${probabilityValue} ≤ Threshold 1:${threshold} - RECOMMENDED`);
                recommendations.push(pkg);
            } else {
                console.log(`❌ ${pkg.name}: Current 1:${probabilityValue} > Threshold 1:${threshold} - Not recommended`);
            }
        }
    });

    console.log(`Found ${recommendations.length} recommended package(s)`);
    return recommendations;
}

async function checkTeamRecommendations() {
    console.log('🔔 Checking team package recommendations based on alert thresholds...');

    // Get saved team alerts
    const savedAlerts = JSON.parse(localStorage.getItem(`${loggedInUser}_teamPackageAlerts`)) || {};

    if (Object.keys(savedAlerts).length === 0) {
        console.log('No team package alerts configured');
        return [];
    }

    // Fetch current team packages from API
    const packages = await fetchNiceHashTeamPackages();

    if (!packages || packages.length === 0) {
        console.log('No team packages available');
        return [];
    }

    // Fetch solo/small packages (for checking small package probability thresholds)
    const soloPackages = await fetchNiceHashSoloPackages();
    console.log(`📦 Fetched ${soloPackages?.length || 0} solo/small packages for threshold checking`);

    const recommendations = [];

    // Check each package against alert thresholds
    packages.forEach(pkg => {
        const alert = savedAlerts[pkg.name];

        if (!alert) {
            return; // No alert set for this package
        }

        console.log(`Checking ${pkg.name} against thresholds:`, alert);

        // Track if any threshold is met (OR logic)
        let meetsAnyThreshold = false;
        const reasons = [];

        // Check if this is a dual-crypto package
        const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCurrencyAlgo && pkg.mergeCurrencyAlgo.title);

        // 1. Check PROBABILITY thresholds
        if (isDualCrypto) {
            // For dual-crypto packages, check both LTC and DOGE probabilities
            const mainCrypto = pkg.mainCrypto || 'LTC';
            const mergeCrypto = pkg.mergeCrypto || 'DOGE';

            const mainThreshold = alert[`probability_${mainCrypto}`];
            const mergeThreshold = alert[`probability_${mergeCrypto}`];

            // Extract probabilities
            let mainProbabilityValue = null;
            let mergeProbabilityValue = null;

            if (pkg.probability) {
                const match = pkg.probability.match(/1:(\d+)/);
                if (match) mainProbabilityValue = parseInt(match[1]);
            }
            if (pkg.mergeProbability) {
                const match = pkg.mergeProbability.match(/1:(\d+)/);
                if (match) mergeProbabilityValue = parseInt(match[1]);
            }

            // Check main crypto probability
            if (mainThreshold && mainProbabilityValue !== null && mainProbabilityValue <= mainThreshold) {
                meetsAnyThreshold = true;
                reasons.push(`${mainCrypto} probability 1:${mainProbabilityValue} ≤ 1:${mainThreshold}`);
                console.log(`✅ ${pkg.name} (${mainCrypto}): Current 1:${mainProbabilityValue} ≤ Threshold 1:${mainThreshold}`);
            }

            // Check merge crypto probability
            if (mergeThreshold && mergeProbabilityValue !== null && mergeProbabilityValue <= mergeThreshold) {
                meetsAnyThreshold = true;
                reasons.push(`${mergeCrypto} probability 1:${mergeProbabilityValue} ≤ 1:${mergeThreshold}`);
                console.log(`✅ ${pkg.name} (${mergeCrypto}): Current 1:${mergeProbabilityValue} ≤ Threshold 1:${mergeThreshold}`);
            }
        } else {
            // Single crypto package - check single probability
            const threshold = alert.probability;

            if (threshold) {
                let probabilityValue = null;
                if (pkg.probability) {
                    const match = pkg.probability.match(/1:(\d+)/);
                    if (match) probabilityValue = parseInt(match[1]);
                }

                if (probabilityValue !== null && probabilityValue <= threshold) {
                    meetsAnyThreshold = true;
                    reasons.push(`Probability 1:${probabilityValue} ≤ 1:${threshold}`);
                    console.log(`✅ ${pkg.name}: Current 1:${probabilityValue} ≤ Threshold 1:${threshold}`);
                }
            }
        }

        // 2. Check SHARES threshold
        if (alert.shares) {
            const currentShares = parseFloat(pkg.shares || 0);
            if (currentShares >= alert.shares) {
                meetsAnyThreshold = true;
                reasons.push(`Share ${currentShares.toFixed(2)}% ≥ ${alert.shares}%`);
                console.log(`✅ ${pkg.name}: Share ${currentShares.toFixed(2)}% ≥ Threshold ${alert.shares}%`);
            }
        }

        // 3. Check PARTICIPANTS threshold
        if (alert.participants) {
            const currentParticipants = pkg.numberOfParticipants || 0;
            if (currentParticipants >= alert.participants) {
                meetsAnyThreshold = true;
                reasons.push(`Participants ${currentParticipants} ≥ ${alert.participants}`);
                console.log(`✅ ${pkg.name}: Participants ${currentParticipants} ≥ Threshold ${alert.participants}`);
            }
        }

        // 4. Check TIME UNTIL START threshold (if set, this becomes a required AND condition)
        let shouldRecommend = false;

        if (alert.timeUntilStart) {
            // Time threshold is set - must be within time threshold AND meet at least one other threshold
            const startTime = pkg.startTs || pkg.startTime;

            if (startTime) {
                const now = Date.now();
                const timeUntilStartMs = startTime - now;
                const minutesUntilStart = Math.floor(timeUntilStartMs / (1000 * 60));

                console.log(`⏰ ${pkg.name}: Time until start = ${minutesUntilStart} minutes, Threshold = ${alert.timeUntilStart} minutes`);

                const meetsTimeThreshold = minutesUntilStart > 0 && minutesUntilStart <= alert.timeUntilStart;

                if (meetsTimeThreshold && meetsAnyThreshold) {
                    // Both conditions met: within time threshold AND meets at least one other threshold
                    shouldRecommend = true;
                    reasons.push(`⏰ Starts in ${minutesUntilStart} min (≤ ${alert.timeUntilStart} min)`);
                    console.log(`✅ ${pkg.name}: Within time threshold (${minutesUntilStart} ≤ ${alert.timeUntilStart}) AND meets other threshold(s)`);
                } else if (!meetsTimeThreshold && meetsAnyThreshold) {
                    console.log(`❌ ${pkg.name}: Meets other threshold(s) but NOT within time threshold (${minutesUntilStart} min > ${alert.timeUntilStart} min)`);
                } else if (meetsTimeThreshold && !meetsAnyThreshold) {
                    console.log(`❌ ${pkg.name}: Within time threshold but does NOT meet any other threshold`);
                } else {
                    console.log(`❌ ${pkg.name}: Does NOT meet time threshold AND does NOT meet any other threshold`);
                }
            } else {
                console.log(`⚠️ ${pkg.name}: Time threshold set but package has no startTime/startTs`);
            }
        } else {
            // No time threshold set - use normal OR logic (any threshold met = recommend)
            if (meetsAnyThreshold) {
                shouldRecommend = true;
                console.log(`✅ ${pkg.name}: Meets at least one threshold (no time restriction)`);
            } else {
                console.log(`❌ ${pkg.name}: Does not meet any threshold`);
            }
        }

        // 5. Check SMALL PACKAGE PROBABILITY threshold (if set, this becomes a required AND condition)
        // For dual-crypto packages (Palladium), check BOTH DOGE and LTC small packages
        const isDualCryptoPackage = pkg.name === 'Team Palladium';

        if (isDualCryptoPackage && (alert.smallPackageProbability_DOGE || alert.smallPackageProbability_LTC) && soloPackages && soloPackages.length > 0) {
            // Dual-crypto: Find Palladium S package (has both LTC and DOGE probabilities)
            const palladiumSmallPackage = soloPackages.find(sp => sp.name === 'Palladium S' || sp.name === 'Palladium DOGE S' || sp.name === 'Palladium LTC S');

            let meetsAllSmallPackageThresholds = true;

            if (palladiumSmallPackage) {
                // Check DOGE small package if threshold is set (from mergeProbability)
                if (alert.smallPackageProbability_DOGE) {
                    let dogeProb = null;
                    if (palladiumSmallPackage.mergeProbability) {
                        const match = palladiumSmallPackage.mergeProbability.match(/1:(\d+)/);
                        if (match) dogeProb = parseInt(match[1]);
                    }

                    console.log(`📦 ${pkg.name}: Checking DOGE small package probability (mergeProbability) = 1:${dogeProb}, Threshold = 1:${alert.smallPackageProbability_DOGE}`);

                    const meetsDOGEThreshold = dogeProb !== null && dogeProb <= alert.smallPackageProbability_DOGE;

                    if (meetsDOGEThreshold) {
                        reasons.push(`📦 DOGE 1:${dogeProb} (≤ 1:${alert.smallPackageProbability_DOGE})`);
                        console.log(`✅ ${pkg.name}: DOGE small package meets threshold`);
                    } else {
                        meetsAllSmallPackageThresholds = false;
                        console.log(`❌ ${pkg.name}: DOGE small package does NOT meet threshold (1:${dogeProb} > 1:${alert.smallPackageProbability_DOGE})`);
                    }
                }

                // Check LTC small package if threshold is set (from probability)
                if (alert.smallPackageProbability_LTC) {
                    let ltcProb = null;
                    if (palladiumSmallPackage.probability) {
                        const match = palladiumSmallPackage.probability.match(/1:(\d+)/);
                        if (match) ltcProb = parseInt(match[1]);
                    }

                    console.log(`📦 ${pkg.name}: Checking LTC small package probability (probability) = 1:${ltcProb}, Threshold = 1:${alert.smallPackageProbability_LTC}`);

                    const meetsLTCThreshold = ltcProb !== null && ltcProb <= alert.smallPackageProbability_LTC;

                    if (meetsLTCThreshold) {
                        reasons.push(`📦 LTC 1:${ltcProb} (≤ 1:${alert.smallPackageProbability_LTC})`);
                        console.log(`✅ ${pkg.name}: LTC small package meets threshold`);
                    } else {
                        meetsAllSmallPackageThresholds = false;
                        console.log(`❌ ${pkg.name}: LTC small package does NOT meet threshold (1:${ltcProb} > 1:${alert.smallPackageProbability_LTC})`);
                    }
                }
            } else {
                meetsAllSmallPackageThresholds = false;
                console.log(`⚠️ ${pkg.name}: Small package threshold set but Palladium S package not found`);
            }

            // Override shouldRecommend if small package thresholds not met
            if (!meetsAllSmallPackageThresholds && shouldRecommend) {
                shouldRecommend = false;
                console.log(`❌ ${pkg.name}: One or more small package thresholds NOT met`);
            } else if (meetsAllSmallPackageThresholds && shouldRecommend) {
                console.log(`✅ ${pkg.name}: All small package thresholds met AND other conditions met`);
            }
        } else if (!isDualCryptoPackage && alert.smallPackageProbability && soloPackages && soloPackages.length > 0) {
            // Single crypto package - check single small package
            const smallPackageName = pkg.name.replace('Team ', '') + ' S';

            // Find the corresponding small package
            const smallPackage = soloPackages.find(sp => sp.name === smallPackageName);

            if (smallPackage) {
                // Extract small package probability value
                let smallPackageProbability = null;
                if (smallPackage.probability) {
                    const match = smallPackage.probability.match(/1:(\d+)/);
                    if (match) smallPackageProbability = parseInt(match[1]);
                }

                console.log(`📦 ${pkg.name}: Checking small package "${smallPackageName}" probability = 1:${smallPackageProbability}, Threshold = 1:${alert.smallPackageProbability}`);

                const meetsSmallPackageThreshold = smallPackageProbability !== null && smallPackageProbability <= alert.smallPackageProbability;

                if (meetsSmallPackageThreshold && shouldRecommend) {
                    // Both conditions met: small package meets threshold AND other conditions passed
                    reasons.push(`📦 ${smallPackageName} 1:${smallPackageProbability} (≤ 1:${alert.smallPackageProbability})`);
                    console.log(`✅ ${pkg.name}: Small package "${smallPackageName}" meets threshold AND other conditions met`);
                } else if (!meetsSmallPackageThreshold && shouldRecommend) {
                    // Small package threshold not met - override shouldRecommend
                    shouldRecommend = false;
                    console.log(`❌ ${pkg.name}: Small package "${smallPackageName}" does NOT meet threshold (1:${smallPackageProbability} > 1:${alert.smallPackageProbability})`);
                } else if (meetsSmallPackageThreshold && !shouldRecommend) {
                    console.log(`❌ ${pkg.name}: Small package "${smallPackageName}" meets threshold but other conditions NOT met`);
                } else {
                    console.log(`❌ ${pkg.name}: Small package "${smallPackageName}" does NOT meet threshold AND other conditions NOT met`);
                }
            } else {
                console.log(`⚠️ ${pkg.name}: Small package threshold set but "${smallPackageName}" not found in solo packages`);
            }
        }

        // Add to recommendations if conditions are met
        if (shouldRecommend) {
            console.log(`✅ ${pkg.name}: RECOMMENDED (${reasons.join(', ')})`);
            pkg.recommendationReasons = reasons;
            recommendations.push(pkg);
        }
    });

    console.log(`Found ${recommendations.length} recommended team package(s)`);
    return recommendations;
}

function showBuyPackagesPage() {
    console.log('Showing Buy Packages Page');

    // Stop EasyMining alerts polling when leaving main app page
    stopEasyMiningAlertsPolling();

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';

    // Show Buy Packages page
    document.getElementById('buy-packages-page').style.display = 'block';

    // Start polling for package data (loads initially + refreshes every 5s)
    startBuyPackagesPolling();
}

function login() {
    const email = document.getElementById('email-login').value;
    const password = document.getElementById('password-login').value;

    if (users[email] && users[email].password === password) {
        loggedInUser = email;
        setStorageItem('loggedInUser', loggedInUser);

        // Load user's API keys
        const userKeys = loadUserApiKeys();

        // If no API keys configured, show CoinGecko API settings page
        if (userKeys.length === 0) {
            console.log('⚠️ No CoinGecko API keys configured - showing settings page');
            showCoinGeckoApiSettingsPage();
            alert('⚠️ Welcome!\n\nPlease configure your CoinGecko API keys to use the app.\n\nAt least one API key is required to fetch cryptocurrency data.');
            return;
        }

        // User has API keys - proceed to app
        setStorageItem('modalMessage', 'Successfully logged in!');
        showAppPage();
        updateAppContent(); // New function call
    } else {
        showModal('Invalid email or password. Please try again.');
    }
}


function register() {
    const firstName = document.getElementById('first-name').value.trim();
    const lastName = document.getElementById('last-name').value.trim();
    const email = document.getElementById('email-register').value.trim();
    const phone = formatPhoneNumber(document.getElementById('phone').value.trim());
    const password = document.getElementById('password-register').value.trim();
    const confirmPassword = document.getElementById('confirm-password').value.trim();
    const termsAccepted = document.getElementById('terms-conditions').checked;

    if (!firstName || !lastName || !email || !phone || !password || !confirmPassword || !termsAccepted) {
        showModal('Please fill out all fields and accept the terms and conditions.');
        return;
    }
    const phonePattern = /^\d{4}\s\d{3}\s\d{3}$/;
    if (!phonePattern.test(phone)) {
        showModal('Please enter a valid phone number in the format 0400 000 000.');
        return;
    }

    if (password !== confirmPassword) {
        showModal('Passwords do not match. Please try again.');
        return;
    }

    const passwordPattern = /^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{6,}$/;
    if (!passwordPattern.test(password)) {
        showModal('Password must be at least 6 characters long and contain at least one number and one special character.');
        return;
    }

    if (users[email]) {
        showModal('User already registered. Please log in.');
        showLoginPage();
        return;
    }

    users[email] = { firstName, lastName, email, phone, password, cryptos: [], percentageThresholds: {} };
    localStorage.setItem('users', JSON.stringify(users));

    showModal('User registered successfully. Please log in.');
    showLoginPage();
}

function formatPhoneNumber(phone) {
    return phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
}

function logout() {
    // Close WebSocket connection before logging out
    closeWebSocketIntentionally();

    loggedInUser = null;
    removeStorageItem('loggedInUser');
    setStorageItem('modalMessage', 'Successfully logged out!');
    showLoginPage();
    updateAppContent(); // New function call
}


function showTermsConditions() {
    document.getElementById('terms-conditions-modal').style.display = 'block';
}

function closeTermsConditions() {
    document.getElementById('terms-conditions-modal').style.display = 'none';
}

function updateRecordDisplay() {
    const recordHighElement = document.getElementById('record-high');
    const recordLowElement = document.getElementById('record-low');

    recordHighElement.innerHTML = `<span class="triangle triangle-up"></span><span class="positive">$${formatNumber(recordHigh.toFixed(2))}</span>`;
    recordLowElement.innerHTML = `<span class="triangle triangle-down"></span><span class="negative">$${recordLow === Infinity ? '0.00' : formatNumber(recordLow.toFixed(2))}</span>`;
}

function updateApiUrl() {
    const ids = users[loggedInUser].cryptos.map(crypto => crypto.id);
    apiUrl = `${baseApiUrl}?ids=${ids.join(',')}&vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;
    console.log('API URL updated:', apiUrl);
}

function updateHoldings(crypto) {
    const input = document.getElementById(`${crypto}-input`);
    const holdings = parseFloat(input.value);

    if (!isNaN(holdings)) {
        // Save the updated MANUAL holdings in storage
        setStorageItem(`${loggedInUser}_${crypto}Holdings`, holdings);

        // For Bitcoin, update display to include NiceHash balance
        if (crypto === 'bitcoin' && typeof updateBTCHoldings === 'function') {
            // Call updateBTCHoldings which will display manual + NiceHash
            updateBTCHoldings();
        } else {
            // For other cryptos, update normally
            document.getElementById(`${crypto}-holdings`).textContent = formatNumber(holdings.toFixed(3));

            // Get the current price in AUD
            const priceElement = document.getElementById(`${crypto}-price-aud`);
            const priceInAud = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

            // Update the value in AUD
            document.getElementById(`${crypto}-value-aud`).textContent = formatNumber((holdings * priceInAud).toFixed(2));
        }

        // Update the total holdings and re-sort containers by value
        updateTotalHoldings();
        sortContainersByValue();

        // Clear the input value and remove focus
        input.value = '';
        input.blur();
    }
}



// LBank WebSocket removed - using MEXC only 


async function fetchPricesFromCoinGecko(cryptoId) {
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;

    try {
        const data = await fetchWithApiKeyRotation(apiUrl);
        if (data[cryptoId]) {
            return parseFloat(data[cryptoId].aud);
        } else {
            throw new Error(`No data found for ${cryptoId} in CoinGecko response`);
        }
    } catch (error) {
        console.error(`Error fetching price from CoinGecko: ${error.message}`);
        return null;
    }
}




async function fetchPricesFromUniswap(symbol) {
    const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
    const uniswapUrl = `${proxyUrl}https://api.uniswap.org/v1/price/${symbol.toUpperCase()}USDT`;

    try {
        const response = await fetch(uniswapUrl, { mode: 'cors' });
        if (!response.ok) {
            throw new Error(`Failed to fetch Uniswap price for ${symbol}`);
        }
        const data = await response.json();
        const priceInUsd = parseFloat(data.price);
        if (!priceInUsd || isNaN(priceInUsd)) {
            throw new Error(`Invalid price data from Uniswap for ${symbol}`);
        }
        console.log(`Uniswap price for ${symbol}: $${priceInUsd} USD`);
        return priceInUsd;
    } catch (error) {
        console.error(`Error fetching Uniswap price for ${symbol}:`, error);
        return null;
    }
}



// Duplicate setWebSocketCycle removed - using the one above


async function fetchPrices() {
    if (!apiUrl.includes('?ids=')) {
        console.log("No cryptocurrencies to fetch prices for.");
        return;
    }

    console.log('Fetching prices from CoinGecko...');
    try {
        const data = await fetchWithFallback(apiUrl); // Primary fetch from CoinGecko
        console.log('Prices fetched:', data);

        let pricesChanged = false;

        for (let crypto of users[loggedInUser].cryptos) {
            let priceAud = data[crypto.id]?.aud;

            // Try MEXC WebSocket if CoinGecko price is not available
            if (priceAud === undefined) {
                console.log(`Falling back to MEXC for ${crypto.symbol}...`);
                const mexcPriceUsd = await fetchMexcPrice(crypto.symbol);
                if (mexcPriceUsd) {
                    priceAud = mexcPriceUsd * conversionRate; // Conversion from USD to AUD
                    console.log(`MEXC price for ${crypto.symbol}: ${priceAud} AUD`);
                }
            }

            // Try Uniswap as the last backup if CoinGecko and MEXC fail
            if (priceAud === undefined) {
                console.log(`Falling back to Uniswap for ${crypto.symbol}...`);
                const uniswapPriceUsd = await fetchPricesFromUniswap(crypto.symbol);
                if (uniswapPriceUsd) {
                    priceAud = uniswapPriceUsd * conversionRate; // Conversion from USD to AUD
                    console.log(`Uniswap price for ${crypto.symbol}: ${priceAud} AUD`);
                }
            }

            // If we still don't have a price, log an error and skip updating this crypto
            if (priceAud === undefined) {
                console.error(`Failed to fetch price for ${crypto.symbol}`);
                continue;
            }

            // Update the DOM and app state with the fetched price
            const previousPriceAud = parseFloat(document.getElementById(`${crypto.id}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;
            const priceElement = document.getElementById(`${crypto.id}-price-aud`);
            const triangleElement = document.getElementById(`${crypto.id}-triangle`);

            if (priceAud !== previousPriceAud) {
                pricesChanged = true;

                if (priceAud > previousPriceAud) {
                    priceElement.classList.remove('price-down', 'flash-red');
                    priceElement.classList.add('price-up');
                    flashColor(`${crypto.id}-price-aud`, 'flash-green');
                    triangleElement.classList.remove('triangle-down');
                    triangleElement.classList.add('triangle-up');
                } else if (priceAud < previousPriceAud) {
                    priceElement.classList.remove('price-up', 'flash-green');
                    priceElement.classList.add('price-down');
                    flashColor(`${crypto.id}-price-aud`, 'flash-red');
                    triangleElement.classList.remove('triangle-up');
                    triangleElement.classList.add('triangle-down');
                }

                priceElement.textContent = `$${formatNumber(priceAud.toFixed(8), true)}`;
            }

            // Always recalculate AUD value, even if price hasn't changed
            // This ensures holdings updates are reflected immediately
            // For Bitcoin, read from display element (includes NiceHash balance)
            // For other cryptos, read from localStorage
            let holdings = 0;
            if (crypto.id === 'bitcoin') {
                const holdingsElement = document.getElementById('bitcoin-holdings');
                holdings = holdingsElement ? parseFloat(holdingsElement.textContent.replace(/,/g, '')) || 0 : 0;
                console.log(`📖 fetchPrices reading ${crypto.id} from display: ${holdings} (includes NiceHash)`);
            } else {
                holdings = parseFloat(getStorageItem(`${loggedInUser}_${crypto.id}Holdings`)) || 0;
                console.log(`📖 fetchPrices reading ${crypto.id} from localStorage: ${holdings}`);
            }

            const audValue = holdings * priceAud;
            const valueElement = document.getElementById(`${crypto.id}-value-aud`);
            if (valueElement) {
                // For Bitcoin: only update display if price is valid (> 0)
                // This prevents showing $0.00 when price hasn't loaded yet
                if (crypto.id === 'bitcoin' && priceAud === 0) {
                    console.warn(`⚠️ fetchPrices BTC - NOT updating display because price is 0 (keeping stored value visible)`);
                } else {
                    valueElement.textContent = formatNumber(audValue.toFixed(2));

                    // SAVE Bitcoin AUD to localStorage when price is valid
                    if (crypto.id === 'bitcoin') {
                        setStorageItem(`${loggedInUser}_bitcoin_displayAUD`, audValue);
                        console.log(`🔄 fetchPrices BTC - Updated & saved AUD: ${audValue.toFixed(2)} (holdings: ${holdings}, price: ${priceAud})`);
                    }
                }
            }
            console.log(`🔄 fetchPrices updated ${crypto.id} AUD value: ${audValue.toFixed(2)} (holdings: ${holdings}, price: ${priceAud})`);
        }

        if (pricesChanged) {
            console.log('PRICES UPDATED');
            updateTotalHoldings();
            sortContainersByValue();
            users[loggedInUser].cryptos.forEach(crypto => {
                fetchPercentageChanges(crypto.id);
            });
        } else {
            console.log('NO PRICE UPDATES');
        }
    } catch (error) {
        console.error('All price fetching methods failed:', error);
    }
}


async function fetchPricesFromUniswap(symbol) {
    try {
        const uniswapUrl = `https://api.uniswap.org/v1/price/${symbol.toUpperCase()}USDT`; // Placeholder for the Uniswap API endpoint
        const response = await fetch(uniswapUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch Uniswap price for ${symbol}`);
        }
        const data = await response.json();
        const priceInUsd = parseFloat(data.price);
        if (!priceInUsd || isNaN(priceInUsd)) {
            throw new Error(`Invalid price data from Uniswap for ${symbol}`);
        }
        console.log(`Uniswap price for ${symbol}: $${priceInUsd} USD`);
        return priceInUsd;
    } catch (error) {
        console.error(`Error fetching Uniswap price for ${symbol}:`, error);
        return null;
    }
}


// Holdings vibrate toggle
const holdingsVibrateToggle = document.getElementById('holdings-vibrate-toggle');
const holdingsVibrateLabel = document.getElementById('holdings-vibrate-label');
let isHoldingsVibrateEnabled = getStorageItem('isHoldingsVibrateEnabled') === 'true';

holdingsVibrateToggle.checked = isHoldingsVibrateEnabled;
holdingsVibrateLabel.textContent = isHoldingsVibrateEnabled ? 'Holdings Vibe: On' : 'Holdings Vibe: Off';

holdingsVibrateToggle.addEventListener('change', function () {
    isHoldingsVibrateEnabled = this.checked;
    holdingsVibrateLabel.textContent = isHoldingsVibrateEnabled ? 'Holdings Vibe: On' : 'Holdings Vibe: Off';
    setStorageItem('isHoldingsVibrateEnabled', isHoldingsVibrateEnabled);
});

// EasyMining vibrate toggle
const easyMiningVibrateToggle = document.getElementById('easymining-vibrate-toggle');
const easyMiningVibrateLabel = document.getElementById('easymining-vibrate-label');
let isEasyMiningVibrateEnabled = getStorageItem('isEasyMiningVibrateEnabled') === 'true';

easyMiningVibrateToggle.checked = isEasyMiningVibrateEnabled;
easyMiningVibrateLabel.textContent = isEasyMiningVibrateEnabled ? 'EasyMining Vibe: On' : 'EasyMining Vibe: Off';

easyMiningVibrateToggle.addEventListener('change', function () {
    isEasyMiningVibrateEnabled = this.checked;
    easyMiningVibrateLabel.textContent = isEasyMiningVibrateEnabled ? 'EasyMining Vibe: On' : 'EasyMining Vibe: Off';
    setStorageItem('isEasyMiningVibrateEnabled', isEasyMiningVibrateEnabled);
});

function updateTotalHoldings() {
    let totalHoldings = 0;

    users[loggedInUser].cryptos.forEach(crypto => {
        // Read AUD value directly from the crypto box (already calculated and displayed)
        // For BTC, this includes NiceHash balance since updateBTCHoldings() sets it
        const valueElement = document.getElementById(`${crypto.id}-value-aud`);
        const valueAud = valueElement ? parseFloat(valueElement.textContent.replace(/,/g, '').replace('$', '')) || 0 : 0;

        totalHoldings += valueAud;
    });

    if (totalHoldings !== previousTotalHoldings) {
        if (totalHoldings > previousTotalHoldings) {
            playSound('good-sound');
            flashColor('total-holdings', 'flash-green');
            flashColor('modal-total-holdings', 'flash-green');
            if (isHoldingsVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate(100);
            }
        } else if (totalHoldings < previousTotalHoldings) {
            playSound('bad-sound');
            flashColor('total-holdings', 'flash-red');
            flashColor('modal-total-holdings', 'flash-red');
            if (isHoldingsVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate(300);
            }
        }

        document.getElementById('total-holdings').textContent = `$${formatNumber(totalHoldings.toFixed(2))}`;

        if (totalHoldings > recordHigh) {
            recordHigh = totalHoldings;
            setStorageItem(`${loggedInUser}_recordHigh`, recordHigh);
            notifyRecordHigh();
            playRecordHighSound();
        }

        if (totalHoldings < recordLow && totalHoldings > 0) {
            recordLow = totalHoldings;
            setStorageItem(`${loggedInUser}_recordLow`, recordLow);
            notifyRecordLow();
        }

        updateRecordDisplay();

        document.title = `CryptFolio v1.5 | $${formatNumber(totalHoldings.toFixed(2))} AUD | Real-time Holdings Tracker`;

        updatePercentageChange(totalHoldings);
        previousTotalHoldings = totalHoldings;

        updateTotalHoldingsModal();

        updateMilestone(totalHoldings);

        resetMilestone();
    }
}

function flashColor(elementId, className) {
    const element = document.getElementById(elementId);
    element.classList.add(className);
    setTimeout(() => {
        element.classList.remove(className);
    }, 1000);
}

function playRecordHighSound() {
    const sound = document.getElementById('record-high-sound');
    if (sound && !sound.muted) {
        sound.play().catch(error => {
            console.error('Sound play failed:', error);
        });
    }
}

function playSound(soundId) {
    const sound = document.getElementById(soundId);
    if (sound && !sound.muted) {
        sound.play().catch(error => {
            console.error('Sound play failed:', error);
        });
    }
}

let lastNotificationTimestamp = 0; // Tracks the last notification timestamp
const notificationCooldown = 5000; // 5-second cooldown

function notifyRecordHigh() {
    const now = Date.now();
    if (now - lastNotificationTimestamp < notificationCooldown) {
        console.log('Record High notification suppressed due to cooldown.');
        return; // Exit if cooldown period hasn't passed
    }

    const icon = 'images/record-high-icon.png';
    checkAndRequestNotificationPermission();
    sendNotification(
        'New Record High!',
        `Your portfolio reached a new record high of $${formatNumber(recordHigh.toFixed(2))}`,
        icon
    );
    lastNotificationTimestamp = now; // Update the last notification timestamp
}

function notifyRecordLow() {
    const now = Date.now();
    if (now - lastNotificationTimestamp < notificationCooldown) {
        console.log('Record Low notification suppressed due to cooldown.');
        return; // Exit if cooldown period hasn't passed
    }

    const icon = 'images/record-low-icon.png';
    checkAndRequestNotificationPermission();
    sendNotification(
        'New Record Low',
        `Your portfolio hit a new record low of $${formatNumber(recordLow.toFixed(2))}`,
        icon
    );
    lastNotificationTimestamp = now; // Update the last notification timestamp
}

function notifyPortfolioChange(change) {
    const icon = change > 0 ? 'images/positive-icon.png' : 'path/to/negative-icon.png';
    const changeText = change > 0 ? 'increased' : 'decreased';
    checkAndRequestNotificationPermission();
    sendNotification(
        'Portfolio Update',
        `Your portfolio has ${changeText} by ${Math.abs(change).toFixed(2)}% in the last 24 hours.`,
        icon
    );
}

function notifyMilestone(milestone) {
    const now = Date.now();
    if (now - lastNotificationTimestamp < notificationCooldown) {
        console.log('Record Low notification suppressed due to cooldown.');
        return; // Exit if cooldown period hasn't passed
    }

    const icon = 'images/milestone-icon.png';
    checkAndRequestNotificationPermission();
    sendNotification(
        'Milestone Achieved!',
        `You've reached a new milestone of $${formatNumber(milestone.toFixed(2))}`,
        icon
    );
    lastNotificationTimestamp = now; // Update the last notification timestamp
}


function notifyTradeModal(symbol, logo) {
    checkAndRequestNotificationPermission();
    sendNotification('Trade Alert', `It's a good time to trade ${symbol}`, logo);
}

function updateMilestone(totalHoldings) {
    const milestoneElement = document.getElementById('daily-milestone');
    if (!milestoneElement) {
        console.error("Milestone element not found.");
        return;
    }

    let lastMilestone = parseInt(localStorage.getItem(`${loggedInUser}_lastMilestone`)) || 0;

    // Check if a new milestone threshold is passed
    if (totalHoldings >= lastMilestone + 1000) {
        lastMilestone = Math.floor(totalHoldings / 1000) * 1000; // Calculate the new milestone
        localStorage.setItem(`${loggedInUser}_lastMilestone`, lastMilestone);
        notifyMilestone(lastMilestone); // Notify the user about the milestone
        playSound('milestone-sound'); // Play milestone sound
    }

    milestoneElement.textContent = `$${formatNumber(lastMilestone.toFixed(2))}`;
}

function confirmResetMilestone() {
    showModal('Are you sure you want to reset the milestone?', 'resetMilestone');
}

function resetMilestone() {
    const totalHoldings = parseFloat(document.getElementById('total-holdings').textContent.replace(/,/g, '').replace('$', '')) || 0;
    const lastMilestone = Math.floor(totalHoldings / 1000) * 1000;
    localStorage.setItem(`${loggedInUser}_lastMilestone`, lastMilestone);
    updateMilestone(totalHoldings);
}

function resetMilestoneEvery24Hours() {
    const lastReset = parseInt(getStorageItem(`${loggedInUser}_lastMilestoneReset`)) || Date.now();
    const now = Date.now();

    if (now - lastReset >= 86400000) {
        resetMilestone();
        setStorageItem(`${loggedInUser}_lastMilestoneReset`, now);
    }

    setTimeout(resetMilestoneEvery24Hours, 86400000 - (now - lastReset));
}

resetMilestoneEvery24Hours();

// Function to play the Lottie animation
function playMilestoneAnimation() {
    const lottieContainer = document.getElementById('lottie-container');
    const lottiePlayer = document.getElementById('milestone-animation');

    if (!lottieContainer || !lottiePlayer) {
        console.error("Lottie animation elements not found.");
        return;
    }

    console.log("Triggering milestone animation.");

    // Force display and ensure it's on top
    lottieContainer.style.display = 'block';
    lottieContainer.style.zIndex = '9999'; // Bring it to the top of the stack
    lottieContainer.style.position = 'absolute'; // Ensure it doesn't get hidden by other elements
   

    try {
        // Reset and play the animation
        if (typeof lottiePlayer.seek === 'function' && typeof lottiePlayer.play === 'function') {
            lottiePlayer.seek(0); // Reset to the beginning
            lottiePlayer.play();
            console.log("Lottie animation started.");
        } else {
            console.error("Lottie Player methods not available.");
        }
    } catch (error) {
        console.error("Error playing Lottie animation:", error);
    }

    // Hide the animation after 3 seconds
    setTimeout(() => {
        lottieContainer.style.display = 'none';
        console.log("Lottie animation hidden.");
    }, 1000); // Adjust duration to match animation
}

function hideMilestoneAnimation() {
    const lottieContainer = document.getElementById('lottie-container');
    const modalElement = document.getElementById('total-holdings-modal');

    // Ensure modalElement exists
    if (modalElement) {
        // Check if modalElement is visible
        const isModalVisible = modalElement.style.display === 'block'; // Inline style check
        if (isModalVisible) {
            lottieContainer.style.display = 'none';
        }
    }
}


const GA_MEASUREMENT_ID = 'G-C7DZD5J9D7'; // Your Google Tag ID
const IDLE_TIMEOUT = 30000; // 30 seconds for idle detection
let isIdle = false; // Tracks if the user is idle
let idleStartTime = null; // Tracks when the user became idle
let idleTimeout; // Timer for idle detection

// Generate or retrieve a persistent unique identifier for the user
const uniqueUserID = (() => {
    let id = localStorage.getItem('uniqueUserID');
    if (!id) {
        id = Math.random().toString(36).substr(2, 9); // Generate a new ID
        localStorage.setItem('uniqueUserID', id);
    }
    return id;
})();

// Function to send events to Google Analytics
function sendToAnalytics(eventName, data) {
    gtag('event', eventName, data);
    console.log(`Event sent to Analytics: ${eventName}`, data);
}

// Function to send a "unique visitor" event (only once per unique user)
function sendUniqueVisitorEvent() {
    if (!localStorage.getItem('uniqueVisitorRecorded')) {
        sendToAnalytics('unique_visitor', {
            event_category: 'users',
            event_label: 'unique_visitor',
            user_id: uniqueUserID, // Include unique user ID
        });
        localStorage.setItem('uniqueVisitorRecorded', 'true'); // Mark as recorded
        console.log(`Unique visitor recorded for user ID: ${uniqueUserID}`);
    }
}

// Function to send an "idle user" event with idle time in minutes
function sendIdleUserEvent() {
    if (!isIdle) {
        isIdle = true;
        idleStartTime = Date.now(); // Record the start time of idleness
    } else if (idleStartTime) {
        // Calculate idle duration in minutes
        const idleDurationMinutes = Math.floor((Date.now() - idleStartTime) / 60000); // Convert ms to minutes

        // Send idle user event
        sendToAnalytics('idle_user', {
            event_category: 'user_activity',
            event_label: 'idle',
            user_id: uniqueUserID, // Include unique user ID
            idle_time: `${idleDurationMinutes}m`, // Idle time in minutes
        });
        console.log(`Idle user event sent: ${idleDurationMinutes} minutes idle.`);
    }
}

// Reset idle timer
function resetIdleTimer() {
    if (isIdle) {
        isIdle = false; // Reset idle state
        idleStartTime = null; // Reset idle start time
    }
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
        sendIdleUserEvent(); // Send "idle user" event
    }, IDLE_TIMEOUT);
}

// Set up activity listeners
function setupActivityListeners() {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'touchmove'];
    events.forEach(event => document.addEventListener(event, resetIdleTimer));
}

// Initialize the script
document.addEventListener('DOMContentLoaded', () => {
    setupActivityListeners(); // Set up activity tracking
    resetIdleTimer(); // Start idle detection

    // Send the unique visitor event only once per user
    sendUniqueVisitorEvent();

    // Set current year in footer automatically
    const currentYear = new Date().getFullYear();
    document.querySelectorAll('.current-year').forEach(element => {
        element.textContent = currentYear;
    });
});




// Function to play the milestone modal animation
function playMilestoneModalAnimation() {
    const lottieContainer = document.getElementById('modal-lottie-container');
    const lottiePlayer = document.getElementById('modal-milestone-animation');

    if (!lottieContainer || !lottiePlayer) {
        console.error("Modal Lottie animation elements not found.");
        return;
    }
    
   

    console.log("Triggering modal milestone animation.");

    // Force display and ensure it's on top
    lottieContainer.style.display = 'block';
    lottieContainer.style.zIndex = '9999'; // Bring it to the top of the stack
    lottieContainer.style.position = 'absolute'; // Ensure it doesn't get hidden by other elements
    lottieContainer.style.height = '150vh'; // 150% of the viewport height
    lottieContainer.style.width = '150vw'; // 150% of the viewport width
    lottieContainer.style.position = 'fixed';
    lottieContainer.style.top = '50%'; // Start centering vertically
    lottieContainer.style.left = '50%'; // Start centering horizontally
    lottieContainer.style.transform = 'translate(-50%, -50%)'; // Adjust to true center
    lottieContainer.style.zIndex = '9999'; // Ensure it appears above other elements
    lottieContainer.style.overflow = 'hidden'; // Optional: prevent unwanted scrolling

    hideMilestoneAnimation();

    try {
        // Reset and play the animation
        if (typeof lottiePlayer.seek === 'function' && typeof lottiePlayer.play === 'function') {
            lottiePlayer.seek(0); // Reset to the beginning
            lottiePlayer.play();
            console.log("Modal Lottie animation started.");
        } else {
            console.error("Modal Lottie Player methods not available.");
        }
    } catch (error) {
        console.error("Error playing modal Lottie animation:", error);
    }

    // Hide the animation after 3 seconds
    setTimeout(() => {
        lottieContainer.style.display = 'none';
        console.log("Modal Lottie animation hidden.");
    }, 1000); // Adjust duration to match animation
}

// Function to play sound and handle Lottie animations
function playSound(soundId) {
    const sound = document.getElementById(soundId);

    if (sound) {
        if (!sound.muted) {
            sound.play().catch((error) => {
                console.error("Sound play failed:", error);
            });
        }

        // If the milestone sound is played, trigger animations and vibration
        if (soundId === 'milestone-sound') {
            console.log("Milestone sound detected, triggering animations and vibration.");
            playMilestoneAnimation();
            playMilestoneModalAnimation();

            if (isHoldingsVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate([100, 100, 100, 100, 100, 100]); // 6 vibrations of 100ms each
                console.log("Vibration triggered.");
            }
        }
    } else {
        console.error("Sound element not found:", soundId);
    }
}

// Ensure the DOM is ready before adding event listeners or running functions
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded. Ready to play animations.");
});



async function fetchInitialPercentageChanges(cryptoId) {
    const url = `${coinDetailsUrl}${cryptoId}?x_cg_demo_api_key=${getApiKey()}`;
    try {
        const data = await fetchWithFallback(url);
        const percentageChange7d = data.market_data.price_change_percentage_7d;

        if (!users[loggedInUser].percentageThresholds) {
            users[loggedInUser].percentageThresholds = {};
        }

        if (!users[loggedInUser].percentageThresholds[cryptoId]) {
            users[loggedInUser].percentageThresholds[cryptoId] = {
                levelUpThreshold: 20,
                warningThreshold: -20,
            };
        }

        const container = document.getElementById(`${cryptoId}-container`);

        if (percentageChange7d >= 20) {
            container.style.borderColor = '#00ff00';
        } else if (percentageChange7d <= -20) {
            container.style.borderColor = '#ff0000';
        } else {
            container.style.borderColor = ''; 
        }

        setStorageItem('users', JSON.stringify(users));
    } catch (error) {
        console.error('Error fetching initial percentage change data:', error);
    }
}

async function fetchPercentageChanges(cryptoId) {
    const url = `${coinDetailsUrl}${cryptoId}?x_cg_demo_api_key=${getApiKey()}`;
    try {
        const data = await fetchWithFallback(url);
        const percentageChange7d = data.market_data.price_change_percentage_7d;
        const percentageChange30d = data.market_data.price_change_percentage_30d;

        updatePercentageChangeUI(cryptoId, percentageChange7d, percentageChange30d);

           // Check for threshold cross and update storage if necessary
           const thresholdCrossed = checkThresholdCross(cryptoId, percentageChange7d);
           if (thresholdCrossed) {
               setStorageItem('users', JSON.stringify(users));
               updateAppContent(); // New function call
           }
       } catch (error) {
           console.error('Error fetching percentage change data:', error);
       }
}

function checkThresholdCross(cryptoId, percentageChange7d) {
       if (!users[loggedInUser].percentageThresholds) {
           users[loggedInUser].percentageThresholds = {};
       }

       if (!users[loggedInUser].percentageThresholds[cryptoId]) {
           users[loggedInUser].percentageThresholds[cryptoId] = {
               lastLevelUpThreshold: null,
               lastWarningThreshold: null,
           };
       }

       const { lastLevelUpThreshold, lastWarningThreshold } = users[loggedInUser].percentageThresholds[cryptoId];
       const container = document.getElementById(`${cryptoId}-container`);
       let thresholdCrossed = false;

       if (percentageChange7d >= 20 && (lastLevelUpThreshold === null || percentageChange7d >= lastLevelUpThreshold + 10)) {
           setStorageItem('tradeModalMessage', `Good time to sell your ${cryptoId}!`);
           playSound('level-up-sound');
           flashBorder(container, '#00ff00', '#00ff00');
           users[loggedInUser].percentageThresholds[cryptoId].lastLevelUpThreshold = Math.floor(percentageChange7d / 10) * 10;
           thresholdCrossed = true;
       }

       if (percentageChange7d <= -20 && (lastWarningThreshold === null || percentageChange7d <= lastWarningThreshold - 10)) {
           setStorageItem('tradeModalMessage', `Good time to buy more ${cryptoId}!`);
           playSound('warning-sound');
           flashBorder(container, '#ff0000', '#ff0000');
           users[loggedInUser].percentageThresholds[cryptoId].lastWarningThreshold = Math.floor(percentageChange7d / 10) * 10;
           thresholdCrossed = true;
       }

       return thresholdCrossed;
}

async function updateAppContent() {
    const activeElement = document.activeElement;
    const activeElementId = activeElement ? activeElement.id : null;

    clearCryptoContainers();
    loadUserData();

    // Initialize autocomplete for crypto search
    initializeAutocomplete();

    updateApiUrl();

    setWebSocketCycle();
    await fetchPrices();
    await Promise.all(users[loggedInUser].cryptos.map(crypto => fetchInitialPercentageChanges(crypto.id)));

    updateTotalHoldings();
    updatePercentageChange(previousTotalHoldings);

    // Add event listeners for Enter key to update holdings
    document.querySelectorAll('[id$="-input"]').forEach(input => {
        input.addEventListener('keyup', function(event) {
            if (event.key === 'Enter') {
                const cryptoId = this.id.replace('-input', '');
                updateHoldings(cryptoId);
            }
        });
    });

    // Initialize record high and low display
    updateRecordDisplay();



    // Initialize milestone display
    const lastMilestone = parseInt(localStorage.getItem(`${loggedInUser}_lastMilestone`)) || 0;
    const milestoneElement = document.getElementById('daily-milestone');
    if (milestoneElement) {
        milestoneElement.textContent = `$${formatNumber(lastMilestone.toFixed(2))}`;
    } else {
        console.error("Milestone element not found during initialization.");
    }

    // Restore focus to the previously active input element
    if (activeElementId) {
        const newActiveElement = document.getElementById(activeElementId);
        if (newActiveElement) {
            newActiveElement.focus();
            // Restore cursor position if the focused element was a text input
            if (newActiveElement.setSelectionRange && activeElement.selectionStart !== undefined) {
                newActiveElement.setSelectionRange(
                    activeElement.selectionStart,
                    activeElement.selectionEnd
                );
            }
        }
    }
}


function updatePercentageChangeUI(cryptoId, percentageChange7d, percentageChange30d) {
    const percentageChangeElement7d = document.getElementById(`${cryptoId}-percentage-change-7d`);
    const triangleElement7d = document.getElementById(`${cryptoId}-triangle-7d`);
    const percentageChangeElement30d = document.getElementById(`${cryptoId}-percentage-change-30d`);
    const triangleElement30d = document.getElementById(`${cryptoId}-triangle-30d`);

    if (percentageChange7d > 0) {
        percentageChangeElement7d.classList.remove('negative');
        percentageChangeElement7d.classList.add('positive');
        triangleElement7d.classList.remove('triangle-down');
        triangleElement7d.classList.add('triangle-up');
    } else if (percentageChange7d < 0) {
        percentageChangeElement7d.classList.remove('positive');
        percentageChangeElement7d.classList.add('negative');
        triangleElement7d.classList.remove('triangle-up');
        triangleElement7d.classList.add('triangle-down');
    } else {
        percentageChangeElement7d.classList.remove('positive', 'negative');
        triangleElement7d.classList.remove('triangle-up', 'triangle-down');
    }

    percentageChangeElement7d.textContent = `${percentageChange7d.toFixed(2)}%`;
    percentageChangeElement7d.prepend(triangleElement7d);

    if (percentageChange30d > 0) {
        percentageChangeElement30d.classList.remove('negative');
        percentageChangeElement30d.classList.add('positive');
        triangleElement30d.classList.remove('triangle-down');
        triangleElement30d.classList.add('triangle-up');
    } else if (percentageChange30d < 0) {
        percentageChangeElement30d.classList.remove('positive');
        percentageChangeElement30d.classList.add('negative');
        triangleElement30d.classList.remove('triangle-up');
        triangleElement30d.classList.add('triangle-down');
    } else {
        percentageChangeElement30d.classList.remove('positive', 'negative');
        triangleElement30d.classList.remove('triangle-up', 'triangle-down');
    }

    percentageChangeElement30d.textContent = `${percentageChange30d.toFixed(2)}%`;
    percentageChangeElement30d.prepend(triangleElement30d);
}


function flashBorder(container, flashColor, finalColor) {
    let flashes = 0;
    const interval = setInterval(() => {
        container.style.borderColor = flashes % 2 === 0 ? flashColor : '';
        flashes++;
        if (flashes === 6) {
            clearInterval(interval);
            container.style.borderColor = finalColor; // Set the final color after flashing
        }
    }, 250);
}

function getCaretPosition(input) {
    return input.selectionStart;
}

function setCaretPosition(input, position) {
    input.setSelectionRange(position, position);
}

function getStorageItem(key) {
    let value = localStorage.getItem(key);
    if (value === null) {
        value = sessionStorage.getItem(key);
    }
    return value;
}

function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('Local storage failed, using session storage', e);
        sessionStorage.setItem(key, value);
    }
}

function removeStorageItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
}


async function autoResetPercentage() {
    const resetHour = 0; // Set to 12:00 AM (midnight)
    const resetMinute = 0; // Set to 00 minutes

    const now = new Date();
    const lastResetDate = getStorageItem(`${loggedInUser}_lastPercentageResetDate`);
    const todayDate = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    try {
        // Check if it's time to reset
        if (now.getHours() === resetHour && now.getMinutes() === resetMinute) {
            if (lastResetDate !== todayDate) {
                console.log("🔄 Resetting percentage at 12:00 AM (midnight)");
                setStorageItem(`${loggedInUser}_lastPercentageResetDate`, todayDate);
                await resetPercentageDaily(); // Call the existing resetPercentage function
            }
        }

        // Check if the reset was missed and the app was opened after the reset time
        if (now.getHours() > resetHour || (now.getHours() === resetHour && now.getMinutes() > resetMinute)) {
            if (lastResetDate !== todayDate) {
                console.log("🔄 Performing missed percentage reset (after midnight)");
                setStorageItem(`${loggedInUser}_lastPercentageResetDate`, todayDate);
                await resetPercentageDaily(); // Call the existing resetPercentage function
            }
        }
    } catch (error) {
        console.error("Error during auto reset percentage:", error);
    }

    console.log("Checking for 24hr Auto Reset Percentage");
}

// Auto-reset EasyMining daily stats and rockets at midnight
async function autoResetEasyMiningDaily() {
    const resetHour = 0; // Set to 12:00 AM (midnight)
    const resetMinute = 0; // Set to 00 minutes

    const now = new Date();
    const lastResetDate = getStorageItem(`${loggedInUser}_lastEasyMiningResetDate`);
    const todayDate = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    try {
        // Check if it's time to reset
        if (now.getHours() === resetHour && now.getMinutes() === resetMinute) {
            if (lastResetDate !== todayDate) {
                console.log("🔄 Resetting EasyMining daily stats and rockets at 12:00 AM (midnight)");
                setStorageItem(`${loggedInUser}_lastEasyMiningResetDate`, todayDate);

                // Reset today's stats
                easyMiningData.todayStats = {
                    totalBlocks: 0,
                    totalReward: 0,
                    totalSpent: 0,
                    pnl: 0
                };

                // Clear rockets
                clearRockets();

                // Save to localStorage
                localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

                console.log("✅ EasyMining daily stats and rockets reset successfully at midnight");
            }
        }

        // Check if the reset was missed and the app was opened after the reset time
        if (now.getHours() > resetHour || (now.getHours() === resetHour && now.getMinutes() > resetMinute)) {
            if (lastResetDate !== todayDate) {
                console.log("🔄 Performing missed EasyMining daily reset (after midnight)");
                setStorageItem(`${loggedInUser}_lastEasyMiningResetDate`, todayDate);

                // Reset today's stats
                easyMiningData.todayStats = {
                    totalBlocks: 0,
                    totalReward: 0,
                    totalSpent: 0,
                    pnl: 0
                };

                // Clear rockets
                clearRockets();

                // Save to localStorage
                localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

                console.log("✅ Missed EasyMining daily reset completed (after midnight)");
            }
        }
    } catch (error) {
        console.error("❌ Error during EasyMining daily reset:", error);
    }

    console.log("🔍 Checking for 24hr EasyMining Daily Reset (midnight)");
}

// Call autoResetPercentage on app load to handle missed resets with a 3-second delay
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        autoResetPercentage();
        autoResetEasyMiningDaily(); // Also check EasyMining reset
    }, 1000);
});


// Set an interval to check every minute (only once)
if (!autoResetInterval) {
    autoResetInterval = setInterval(() => {
        autoResetPercentage();
        autoResetEasyMiningDaily(); // Check both resets every minute
    }, 60000);
}



// Function to update percentage change
function updatePercentageChange(currentTotalHoldings) {
    const percentageChangeElement = document.getElementById('percentage-change');
    const triangleElement = percentageChangeElement.querySelector('.triangle');
    const valueChangeElement = document.getElementById('value-change');

    if (totalHoldings24hAgo === null) {
        totalHoldings24hAgo = currentTotalHoldings;
        setStorageItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
        setStorageItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    }

    const percentageChange = ((currentTotalHoldings - totalHoldings24hAgo) / totalHoldings24hAgo) * 100;
    const valueChange = currentTotalHoldings - totalHoldings24hAgo;

    percentageChangeElement.textContent = `${percentageChange.toFixed(2)}%`;
    valueChangeElement.textContent = `${valueChange >= 0 ? '(+$' + formatNumber(valueChange.toFixed(2)) + ')' : '(-$' + formatNumber(Math.abs(valueChange).toFixed(2)) + ')'}`;
    percentageChangeElement.prepend(triangleElement);

    if (percentageChange > 0) {
        percentageChangeElement.classList.remove('negative');
        percentageChangeElement.classList.add('positive');
        triangleElement.classList.remove('triangle-down');
        triangleElement.classList.add('triangle-up');
        valueChangeElement.classList.remove('negative');
        valueChangeElement.classList.add('positive');
    } else if (percentageChange < 0) {
        percentageChangeElement.classList.remove('positive');
        percentageChangeElement.classList.add('negative');
        triangleElement.classList.remove('triangle-up');
        triangleElement.classList.add('triangle-down');
        valueChangeElement.classList.remove('positive');
        valueChangeElement.classList.add('negative');
    } else {
        percentageChangeElement.classList.remove('positive', 'negative');
        triangleElement.classList.remove('triangle-up', 'triangle-down');
        valueChangeElement.classList.remove('positive', 'negative');
    }

    if (!getStorageItem(`${loggedInUser}_lastUpdated`) || Date.now() - parseInt(getStorageItem(`${loggedInUser}_lastUpdated`)) >= 86400000) {
        totalHoldings24hAgo = currentTotalHoldings;
        setStorageItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
        setStorageItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    }

    updateTotalHoldingsModal();
}


function updateTotalHoldingsModal() {
    const totalHoldings = document.getElementById('total-holdings').textContent;
    const percentageChange = document.getElementById('percentage-change').outerHTML;
    const valueChange = document.getElementById('value-change').outerHTML;
    const recordHigh = document.getElementById('record-high').outerHTML;
    const recordLow = document.getElementById('record-low').outerHTML;

    const formattedTotalHoldings = `${totalHoldings}`;

    const modalMessage = document.getElementById('total-holdings-content');
    modalMessage.innerHTML = `
        <div class="total-holdings-modal-content">
            <div class="modal-percentage-change">
                ${percentageChange} ${valueChange}
            </div>
            <div id="modal-total-holdings" class="modal-total-holdings">
               ${formattedTotalHoldings}
            </div>
            <div class="modal-records">
                ${recordHigh} &nbsp; | &nbsp; ${recordLow}
            </div>
        </div>
    `;
    flashColor('modal-total-holdings', 'flash-green');
}

document.querySelector('.ui-holdings').addEventListener('click', showTotalHoldingsModal);

function resetPercentage() {
    const currentTotalHoldings = parseFloat(document.getElementById('total-holdings').textContent.replace(/,/g, '').replace('$', '').replace('AUD', '').trim());
    totalHoldings24hAgo = currentTotalHoldings;
    localStorage.setItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
    localStorage.setItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    updatePercentageChange(currentTotalHoldings);
    showModal('Percentage reset successfully.');
    closeModal(1000);
}

function resetPercentageDaily() {
    const currentTotalHoldings = parseFloat(document.getElementById('total-holdings').textContent.replace(/,/g, '').replace('$', '').replace('AUD', '').trim());
    totalHoldings24hAgo = currentTotalHoldings;
    localStorage.setItem(`${loggedInUser}_totalHoldings24hAgo`, totalHoldings24hAgo);
    localStorage.setItem(`${loggedInUser}_lastUpdated`, Date.now().toString());
    updatePercentageChange(currentTotalHoldings);
}

function resetHighLow() {
    recordHigh = 0;
    recordLow = Infinity;
    localStorage.setItem(`${loggedInUser}_recordHigh`, recordHigh);
    localStorage.setItem(`${loggedInUser}_recordLow`, recordLow);
    updateRecordDisplay();
    showModal('High/Low records reset successfully.');
    closeModal(1000);
}

// Function to send notification
function sendNotification(title, body, icon) {
    const notificationPermission = localStorage.getItem('notificationPermission');
    if (notificationPermission === 'granted') {
        Push.create(title, {
            body: body,
            icon: icon,
            timeout: 5000,
            onClick: function () {
                window.focus();
                this.close();
            }
        });
    } else {
        console.log('Notification permission not granted.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const fullscreenBtn = document.getElementById('fullscreenBtn');

    // Function to enter fullscreen mode
    const enterFullscreen = () => {
        const currentContent = document.documentElement; // Target the full HTML document
        if (currentContent.requestFullscreen) {
            currentContent.requestFullscreen()
                .then(() => {
                    document.body.classList.add('fullscreen-mode');
                })
                .catch(err => console.error(`Error entering fullscreen: ${err.message}`));
        } else if (currentContent.webkitRequestFullscreen) { // Safari
            currentContent.webkitRequestFullscreen();
            document.body.classList.add('fullscreen-mode');
        } else if (currentContent.msRequestFullscreen) { // IE/Edge
            currentContent.msRequestFullscreen();
            document.body.classList.add('fullscreen-mode');
        } else {
            alert("Fullscreen is not supported on this browser.");
        }
    };

    // Function to exit fullscreen mode
    const exitFullscreen = () => {
        if (document.exitFullscreen) {
            document.exitFullscreen()
                .then(() => {
                    document.body.classList.remove('fullscreen-mode');
                })
                .catch(err => console.error(`Error exiting fullscreen: ${err.message}`));
        } else if (document.webkitExitFullscreen) { // Safari
            document.webkitExitFullscreen();
            document.body.classList.remove('fullscreen-mode');
        } else if (document.msExitFullscreen) { // IE/Edge
            document.msExitFullscreen();
            document.body.classList.remove('fullscreen-mode');
        }
    };

    // Handle fullscreen button click
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            enterFullscreen();
        } else {
            exitFullscreen();
        }
    });

    // Reset styles when exiting fullscreen
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            document.body.classList.remove('fullscreen-mode');
        }
    });
});







function showModal(message, action = null, containerId = null, cryptoId = null) {
    const modal = document.getElementById('popup-modal');
    const modalMessage = document.getElementById('modal-message');
    modalMessage.innerHTML = message;
    if (action) {
        modalMessage.innerHTML += `
            <div style="display: flex; justify-content: center; margin-top: 20px; gap: 10px;">
                <button class="delete-button" onclick="confirmAction('${action}', '${containerId}', '${cryptoId}')">Confirm</button>
                <button class="cancel-button" onclick="closeModal()">Cancel</button>
            </div>
        `;
    }
    modal.style.display = 'block';
    modalMessage.classList.remove('total-holdings-modal-content');
}

function closeModal(delay = 0) {
    setTimeout(() => {
        document.getElementById('popup-modal').style.display = 'none';
        document.getElementById('total-holdings-modal').style.display = 'none';
    }, delay);
}

function showDeleteModal(containerId, cryptoId) {
    showModal('Are you sure you want to delete?', 'confirmDelete', containerId, cryptoId);
}

function confirmDelete(containerId, cryptoId) {
    deleteContainer(containerId, cryptoId);
    closeModal();
}

function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.style.display = 'block';
}

function confirmClearData() {
    showModal('Are you sure you want to clear all data?', 'clearData');
}

function confirmResetPercentage() {
    showModal('Are you sure you want to reset the percentage?', 'resetPercentage');
}

function confirmResetHighLow() {
    showModal('Are you sure you want to reset the high & low record?', 'resetHighLow');
}

function confirmLogout() {
    showModal('Are you sure you want to log out?', 'logout');
}

function confirmAction(action, containerId, cryptoId) {
    if (action === 'clearData') {
        clearData();
    } else if (action === 'resetPercentage') {
        resetPercentage();
    } else if (action === 'resetHighLow') {
        resetHighLow();
    } else if (action === 'resetMilestone') {
        resetMilestone();
    } else if (action === 'logout') {
        logout();
    } else if (action === 'confirmDelete') {
        confirmDelete(containerId, cryptoId);
    }
    closeSettingsModal();
}

function clearData() {
    const user = users[loggedInUser];
    user.cryptos.forEach(crypto => {
        localStorage.removeItem(`${loggedInUser}_${crypto.id}Holdings`);
    });

    user.cryptos = [];
    user.percentageThresholds = {};
    localStorage.setItem('users', JSON.stringify(users));

    document.getElementById('total-holdings').textContent = '0.00 AUD';
    document.getElementById('percentage-change').textContent = '0.00%';
    document.getElementById('value-change').textContent = '(+$0.00)';
    document.getElementById('record-high').innerHTML = `<span class="triangle triangle-up"></span><span class="positive">$0.00</span>`;
    document.getElementById('record-low').innerHTML = `<span class="triangle triangle-down"></span><span class="negative">$0.00</span>`;
    document.getElementById('percentage-change').className = 'neutral';
    document.getElementById('value-change').className = 'neutral';
    document.getElementById('daily-milestone').textContent = '$0.00';

    clearCryptoContainers();

    apiUrl = `${baseApiUrl}?vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;

    recordHigh = 0;
    recordLow = Infinity;
    localStorage.setItem(`${loggedInUser}_recordHigh`, recordHigh);
    localStorage.setItem(`${loggedInUser}_recordLow`, recordLow);

    showModal('All data cleared successfully.');
    closeModal(1500);

    initializeApp();
}

function closeSettingsModal() {
    const settingsModal = document.getElementById('settings-modal');
    settingsModal.style.display = 'none';
}

document.querySelector('#settings-modal .close').addEventListener('click', closeSettingsModal);

window.onclick = function(event) {
    const popupModal = document.getElementById('popup-modal');
    const totalHoldingsModal = document.getElementById('total-holdings-modal');
    const settingsModal = document.getElementById('settings-modal');
    const candlestickModal = document.getElementById('candlestick-modal');

    if (event.target === popupModal || event.target === totalHoldingsModal || event.target === settingsModal || event.target === candlestickModal) {
        closeModal();
    }
};

async function addCrypto() {
    const cryptoId = document.getElementById('crypto-id-input').value.trim().toLowerCase();
    if (!cryptoId) return;

    try {
        const data = await fetchWithFallback(`${coinDetailsUrl}${cryptoId}?x_cg_demo_api_key=${getApiKey()}`);
        const { id, symbol, name, image: { thumb } } = data;

        const cryptoExists = users[loggedInUser].cryptos.some(crypto => crypto.id === id);
        if (cryptoExists) {
            showModal('Cryptocurrency already added.');
            return;
        }

        const newCrypto = { id, symbol, name, thumb };
        if (!users[loggedInUser].cryptos) {
            users[loggedInUser].cryptos = [];
        }
        users[loggedInUser].cryptos.push(newCrypto);
        setStorageItem('users', JSON.stringify(users));

        addCryptoContainer(id, symbol, name, thumb);
        updateApiUrl();
        fetchPrices();

        // Subscribe to WebSocket price updates for the new crypto
        subscribeToSymbol(symbol);

        document.getElementById('crypto-id-input').value = '';
        showModal('Crypto successfully added!');
        closeModal(1500);
    } catch (error) {
        showModal(error.message);
        console.error('Error adding new cryptocurrency:', error);
    }
}

function addCryptoContainer(id, symbol, name, thumb) {
    const newContainer = document.createElement('div');
    newContainer.classList.add('crypto-container');
    newContainer.id = `${id}-container`;

    newContainer.innerHTML = `
        <div class="logo-container" id="${id}-logo" onclick="openCandlestickModal('${id}')">
            <img src="${thumb}" alt="${name} Logo">
        </div>
        <h2>${name} (${symbol.toUpperCase()})</h2>
        <p><span id="${id}-triangle" class="triangle"></span><span id="${id}-price-aud">$0.00000000</span></p>
        <p><span id="${id}-holdings">0.000</span> ${symbol.toUpperCase()}</p>
        <p>$<span id="${id}-value-aud">0.00</span> AUD</p>
        <input type="number" id="${id}-input" style="margin-top: 15px;" placeholder="Enter ${name} holdings">
        <button style="margin-bottom: 15px;" onclick="updateHoldings('${id}')">Update Holdings</button>
        <button style="margin-bottom: 15px;" class="delete-button" onclick="showDeleteModal('${id}-container', '${id}')">Delete</button>
        <p>7D: <span id="${id}-triangle-7d" class="triangle"></span><span id="${id}-percentage-change-7d">0.00%</span> 30D: <span id="${id}-triangle-30d" class="triangle"></span><span id="${id}-percentage-change-30d">0.00%</span></p>
    `;

    document.getElementById('crypto-containers').appendChild(newContainer);

    const input = document.getElementById(`${id}-input`);
    input.addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            updateHoldings(id);
        }
    });

    fetchPrices();
}


function deleteContainer(containerId, cryptoId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.remove();
    }

    users[loggedInUser].cryptos = users[loggedInUser].cryptos.filter(crypto => crypto.id !== cryptoId);
    setStorageItem('users', JSON.stringify(users));

    removeStorageItem(`${loggedInUser}_${cryptoId}Holdings`);

    updateApiUrl();

    fetchPrices();
    updateTotalHoldings();
    sortContainersByValue();
}

function formatNumber(number, isPrice = false) {
    if (isPrice) {
        if (parseFloat(number) < 1) {
            return number.replace(/(\d{1,3})(?=\d{4})/g, '$1');
        } else {
            const parts = number.split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            return parts.join('.');
        }
    }
    // ✅ FIX: Only add commas to integer part, not decimal part
    // This prevents showing numbers like 792.558,444,001 (incorrect)
    // Now shows: 792.558444001 (correct)
    const parts = number.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

function sortContainersByValue() {
    const containers = Array.from(document.getElementsByClassName('crypto-container'));
    const containerParent = document.getElementById('crypto-containers');

    containers.sort((a, b) => {
        const aValue = parseFloat(a.querySelector('[id$="-value-aud"]').textContent.replace(/,/g, '').replace('$', '')) || 0;
        const bValue = parseFloat(b.querySelector('[id$="-value-aud"]').textContent.replace(/,/g, '').replace('$', '')) || 0;
        return bValue - aValue;
    });

    containers.forEach(container => containerParent.appendChild(container));
}

function updateCryptoValue(cryptoId) {
    const priceAud = parseFloat(document.getElementById(`${cryptoId}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;

    // For Bitcoin, read from display element (includes NiceHash balance)
    // For other cryptos, read from localStorage
    let holdings = 0;
    if (cryptoId === 'bitcoin') {
        const holdingsElement = document.getElementById('bitcoin-holdings');
        holdings = holdingsElement ? parseFloat(holdingsElement.textContent.replace(/,/g, '')) || 0 : 0;
    } else {
        holdings = parseFloat(localStorage.getItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
    }

    const currentValue = holdings * priceAud;

    // For Bitcoin: only update display and save if price is valid (> 0)
    // This prevents showing/saving $0.00 when price hasn't loaded yet
    if (cryptoId === 'bitcoin' && priceAud === 0) {
        console.warn(`⚠️ updateCryptoValue BTC - NOT updating display because price is 0 (keeping stored value visible)`);
    } else {
        document.getElementById(`${cryptoId}-value-aud`).textContent = formatNumber(currentValue.toFixed(2));

        // SAVE Bitcoin AUD to localStorage when price is valid
        if (cryptoId === 'bitcoin') {
            setStorageItem(`${loggedInUser}_bitcoin_displayAUD`, currentValue);
        }
    }

    updateTotalHoldings();
    sortContainersByValue();
}

function showTradeModal(message) {
    const modalMessage = document.getElementById('modal-message');
    modalMessage.innerHTML = `
        <span class="close" onclick="closeModal()">&times;</span>
        <div style="display: flex; flex-direction: column; align-items: center;">
            <p>${message}</p>
            <div style="display: flex; justify-content: center; margin-top: 20px;">
                <a href="https://www.coinbase.com" target="_blank" class="trade-button">Coinbase</a>
                <a href="https://www.mexc.com" target="_blank" class="trade-button">MEXC</a>
                <a href="https://www.binance.com" target="_blank" class="trade-button">Binance</a>
            </div>
        </div>
    `;
    document.getElementById('popup-modal').style.display = 'block';
}

function showTotalHoldingsModal() {
    const totalHoldings = document.getElementById('total-holdings').outerHTML;
    const percentageChange = document.getElementById('percentage-change').outerHTML;
    const valueChange = document.getElementById('value-change').outerHTML;
    const recordHigh = document.getElementById('record-high').outerHTML;
    const recordLow = document.getElementById('record-low').outerHTML;

    const modalMessage = document.getElementById('total-holdings-content');
    modalMessage.innerHTML = `
        <br><div class="total-holdings-modal-content">
            <div class="modal-percentage-change">
                ${percentageChange} ${valueChange}
            </div>
            <div class="modal-total-holdings">
                ${totalHoldings}
            </div>
            <div class="modal-records">
                ${recordHigh} &nbsp; | &nbsp; ${recordLow}
            </div>
        </div>
    `;
    updateTotalHoldingsModal(); // Ensure the modal content is updated before showing the modal
    document.getElementById('total-holdings-modal').style.display = 'block';
}

document.querySelector('.ui-holdings').addEventListener('click', showTotalHoldingsModal);

document.getElementById('password-login').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        login();
    }
});

document.getElementById('crypto-id-input').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        addCrypto();
    }
});

document.querySelectorAll('[id$="-input"]').forEach(input => {
    input.addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            const cryptoId = this.id.replace('-input', '');
            updateHoldings(cryptoId);
        }
    });
});

document.getElementById('confirm-password').addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        register();
    }
});






// MEXC REST API polling for live prices (simple, reliable, JSON)
function startMEXCPricePolling() {
    console.log('🚀 Starting MEXC REST API price polling...');

    // Clear existing interval to prevent duplicates
    if (mexcPricePollingInterval) {
        clearInterval(mexcPricePollingInterval);
        mexcPricePollingInterval = null;
    }

    const updatePrices = async () => {
        if (!users[loggedInUser] || !users[loggedInUser].cryptos) return;

        for (const crypto of users[loggedInUser].cryptos) {
            try {
                const symbol = `${crypto.symbol.toUpperCase()}USDT`;

                // Use Vercel proxy in production, direct call in dev
                const url = USE_VERCEL_PROXY
                    ? `/api/mexc?endpoint=ticker/price&symbol=${symbol}`
                    : `https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`;

                const response = await fetch(url);
                const data = await response.json();

                if (data.price) {
                    const price = parseFloat(data.price);
                    // Only log price updates every 10th fetch to reduce console spam
                    if (Math.random() < 0.1) {
                        console.log(`💰 MEXC: ${crypto.symbol.toUpperCase()} $${price}`);
                    }
                    updatePriceFromWebSocket(crypto.symbol.toLowerCase(), price);
                }
            } catch (error) {
                console.error(`MEXC ${crypto.symbol}:`, error.message);
            }
        }
    };

    // Update immediately, then every 2 seconds
    updatePrices();
    mexcPricePollingInterval = setInterval(updatePrices, 2000);
}

function stopMEXCPricePolling() {
    if (mexcPricePollingInterval) {
        clearInterval(mexcPricePollingInterval);
        mexcPricePollingInterval = null;
        console.log('⏹️ MEXC polling stopped');
    }
}

function initializeWebSocket() {
    // Use REST API polling instead of WebSocket for now
    startMEXCPricePolling();
    return;

    const wsEndpoint = 'wss://wbs-api.mexc.com/ws';

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Initializing MEXC WebSocket connection...');
    console.log('   Endpoint:', wsEndpoint);
    console.log('   Protocol: Protocol Buffers (binary data)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    socket = new WebSocket(wsEndpoint);
    lastWebSocketUpdate = Date.now();

    socket.onopen = function(event) {
        console.log('✅ MEXC WebSocket connection opened');
        console.log('   Connection readyState:', this.readyState, '(should be 1 = OPEN)');

        // Reset reconnection tracking on successful connection
        reconnectAttempts = 0;
        reconnectDelay = 1000;
        intentionalClose = false;

        // Use 'this' to reference the actual WebSocket instance that fired this event
        const ws = this;

        // Subscribe immediately - onopen fires when connection is ready
        if (users[loggedInUser] && users[loggedInUser].cryptos) {
            console.log(`📬 Subscribing to ${users[loggedInUser].cryptos.length} cryptocurrencies...`);

            users[loggedInUser].cryptos.forEach(crypto => {
                // MEXC deals format (returns Protocol Buffer data)
                const channel = `spot@public.deals.v3.api@${crypto.symbol.toUpperCase()}USDT`;
                const subscriptionMessage = JSON.stringify({
                    "method": "SUBSCRIPTION",
                    "params": [channel]
                });

                ws.send(subscriptionMessage);
                console.log(`   ✓ Subscribed to ${crypto.symbol.toUpperCase()}USDT`);
            });

            console.log('✅ All subscriptions sent successfully');
        } else {
            console.warn('⚠️ No cryptocurrencies to subscribe to');
        }

        // MEXC requires ping/pong to keep connection alive
        if (pingInterval) {
            clearInterval(pingInterval);
        }

        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ method: "PING" }));
            }
        }, 20000); // 20 seconds
    };

    socket.onmessage = function(event) {
        try {
            // MEXC sends Protocol Buffer data as Blob (binary)
            if (event.data instanceof Blob) {
                // Convert Blob to ArrayBuffer, then decode
                event.data.arrayBuffer().then(arrayBuffer => {
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // Try UTF-8 decode first (some messages might be JSON in disguise)
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    const text = decoder.decode(uint8Array);

                    // Check if it's actually JSON
                    if (text.startsWith('{') || text.startsWith('[')) {
                        try {
                            const message = JSON.parse(text);
                            handlePortfolioMessage(message);
                        } catch (e) {
                            console.error('WS parse error:', e);
                        }
                    } else {
                        // It's real protobuf data
                        decodePortfolioProtobuf(uint8Array);
                    }
                }).catch(error => {
                    console.error('WS Blob error:', error);
                });
            }
            // Handle JSON string messages (subscription confirmations, PONG, etc.)
            else if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    handlePortfolioMessage(message);
                } catch (error) {
                    console.error('WS JSON error:', error);
                }
            }

        } catch (error) {
            console.error('WS message error:', error);
        }
    };

    socket.onclose = function(event) {
        console.log('🔌 MEXC WebSocket connection closed', event.code, event.reason);

        // Clear ping interval (if any was set)
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }

        // Attempt reconnection if not intentional close
        if (!intentionalClose && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            console.log(`🔄 Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${reconnectDelay}ms...`);

            setTimeout(() => {
                initializeWebSocket();
            }, reconnectDelay);

            // Exponential backoff: double the delay, up to max
            reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached. Please refresh the page.');
        }
    };

    socket.onerror = function(error) {
        console.error('❌ MEXC WebSocket error:', error);

        // Clear ping interval on error (if any was set)
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    };
}

// Helper function to handle parsed JSON messages from MEXC
function handlePortfolioMessage(message) {
    // Handle PONG (silent)
    if (message.msg === 'PONG') {
        return;
    }

    // Handle subscription confirmations (only log on first subscription)
    if (message.id || message.code !== undefined) {
        return;
    }

    // Handle JSON price updates (if MEXC sends them)
    if (message.d && message.d.deals && message.d.deals.length > 0 && message.s) {
        const deal = message.d.deals[0];
        const symbol = message.s.replace('USDT', '').toLowerCase();
        const price = parseFloat(deal.p);

        lastWebSocketUpdate = Date.now();
        updatePriceFromWebSocket(symbol, price);
    }
}

// Decode Protocol Buffer data from MEXC
function decodePortfolioProtobuf(uint8Array) {
    try {
        // Protocol Buffer wire format parser
        let pos = 0;
        const fields = {};

        while (pos < uint8Array.length) {
            // Read field tag (varint)
            const tagAndType = readVarint(uint8Array, pos);
            pos = tagAndType.pos;
            const tag = tagAndType.value >> 3;
            const wireType = tagAndType.value & 0x07;

            // Parse based on wire type
            if (wireType === 0) { // Varint
                const varint = readVarint(uint8Array, pos);
                pos = varint.pos;
                fields[tag] = varint.value;
            } else if (wireType === 1) { // 64-bit (double)
                const double = readDouble(uint8Array, pos);
                pos += 8;
                fields[tag] = double;
            } else if (wireType === 2) { // Length-delimited (string/bytes)
                const length = readVarint(uint8Array, pos);
                pos = length.pos;
                const data = uint8Array.slice(pos, pos + length.value);
                pos += length.value;

                // Try to decode as UTF-8 string
                const decoder = new TextDecoder('utf-8', { fatal: false });
                const str = decoder.decode(data);

                if (/^[A-Z]+USDT$/.test(str)) {
                    // This is likely the symbol
                    fields[tag] = str;
                } else {
                    fields[tag] = data;
                }
            } else if (wireType === 5) { // 32-bit (float)
                const float = readFloat(uint8Array, pos);
                pos += 4;
                fields[tag] = float;
            } else {
                break;
            }
        }

        // Extract symbol and price from decoded fields
        let symbol = null;
        let price = null;

        // Find symbol (string field matching pattern)
        for (const [tag, value] of Object.entries(fields)) {
            if (typeof value === 'string' && /^[A-Z]+USDT$/.test(value)) {
                symbol = value.replace('USDT', '').toLowerCase();
            }

            // Find price (double or float field with reasonable value)
            if (typeof value === 'number' && value > 0 && value < 1000000) {
                price = value;
            }
        }

        // Update price if both symbol and price found
        if (symbol && price) {
            lastWebSocketUpdate = Date.now();
            updatePriceFromWebSocket(symbol, price);
        }

    } catch (error) {
        console.error('Protobuf error:', error);
    }
}

// Read varint from buffer
function readVarint(buffer, pos) {
    let value = 0;
    let shift = 0;
    let byte;

    do {
        byte = buffer[pos++];
        value |= (byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);

    return { value, pos };
}

// Read double (64-bit float)
function readDouble(buffer, pos) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + pos, 8);
    return view.getFloat64(0, true); // true = little-endian
}

// Read float (32-bit float)
function readFloat(buffer, pos) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + pos, 4);
    return view.getFloat32(0, true); // true = little-endian
}

// Function to close WebSocket intentionally (e.g., on logout)
function closeWebSocketIntentionally() {
    intentionalClose = true;
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (socket) {
        socket.close();
    }
}

// Function to subscribe to a single crypto's price updates
function subscribeToSymbol(symbol) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // Binance trade stream format: symbol in lowercase + "usdt@trade"
        const channel = `${symbol.toLowerCase()}usdt@trade`;
        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIBE",
            "params": [channel],
            "id": Date.now()
        });

        console.log(`🔔 Subscribing to ${symbol.toUpperCase()}USDT price updates (trade stream)`);
        socket.send(subscriptionMessage);
    } else {
        console.log(`⚠️ WebSocket not ready (state: ${socket?.readyState}), subscription to ${symbol} will happen on next connection`);
    }
}

let lastPriceForCrypto = {}; // Store last price for each symbol
let lastWebSocketPriceUpdate = {}; 
let lastPriceUpdate = 0;  // Timestamp of the last update
const updateInterval = 1000;  // Minimum interval between updates (1 second)


let lastConversionRate = 1.52;  // Default fallback value
let lastRateTimestamp = 0;  // Timestamp of the last successful API call
const rateUpdateInterval = 15 * 60 * 1000;  // 15 minutes in milliseconds

// Function to get the USDT to AUD conversion rate with API rotation and caching
async function fetchUsdtToAudConversionRate() {
    const currentTime = Date.now();  // Get the current time

    // Check if 15 minutes have passed since the last API call
    if (currentTime - lastRateTimestamp < rateUpdateInterval) {
        console.log(`Using cached USDT to AUD conversion rate: ${lastConversionRate}`);
        return lastConversionRate;  // Return the cached rate
    }

    // If 15 minutes have passed, fetch a new rate
    let success = false;
    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        const apiKey = getApiKey();
        const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=aud&x_cg_demo_api_key=${apiKey}`;

        try {
            const response = await fetch(apiUrl);
            if (response.status === 429) {  // Too many requests, rotate API key
                console.warn(`API key ${apiKey} hit rate limit. Switching to the next key.`);
                switchApiKey();  // Rotate to the next key
                continue;  // Retry with the new key
            }
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

            const data = await response.json();
            lastConversionRate = data.tether.aud || 1.52;  // Update conversion rate or fallback to 1.52
            lastRateTimestamp = currentTime;  // Update the timestamp for the successful API call
            console.log(`New USDT to AUD Conversion Rate Retrieved: ${lastConversionRate}`);  // Log the new rate
            success = true;
            break;  // Exit the loop if successful
        } catch (error) {
            console.error(`Error with API key ${apiKey}:`, error);
            if (attempt === apiKeys.length - 1) {
                console.error('All API keys failed.');
            }
            switchApiKey();  // Rotate key if failed
        }
    }

    return lastConversionRate;  // Return the new or cached conversion rate
}

// Function to start the live check for the conversion rate every 15 minutes
function startConversionRateUpdate() {
    // Prevent duplicate intervals
    if (conversionRateInterval) {
        clearInterval(conversionRateInterval);
    }

    conversionRateInterval = setInterval(async () => {
        const conversionRate = await fetchUsdtToAudConversionRate();
        // Only log occasionally to reduce spam
        if (Math.random() < 0.2) {
            console.log(`Updated USDT/AUD: ${conversionRate}`);
        }
    }, rateUpdateInterval);  // 15 minutes in milliseconds
}

// Start the live check for the conversion rate (only once)
if (!conversionRateInterval) {
    startConversionRateUpdate();
}



let focusedElement = null;
let focusedElementSelectionStart = null;
let focusedElementSelectionEnd = null;

// Save focus details globally before DOM updates
function saveFocusDetails() {
    focusedElement = document.activeElement;
    if (focusedElement && focusedElement.tagName === 'INPUT') {
        focusedElementSelectionStart = focusedElement.selectionStart;
        focusedElementSelectionEnd = focusedElement.selectionEnd;
    } else {
        focusedElement = null;
    }
}

// Restore focus details after DOM updates
function restoreFocusDetails() {
    if (focusedElement && document.body.contains(focusedElement)) {
        focusedElement.focus();
        if (focusedElement.setSelectionRange && focusedElementSelectionStart !== null) {
            focusedElement.setSelectionRange(focusedElementSelectionStart, focusedElementSelectionEnd);
        }
    }
}

async function updatePriceFromWebSocket(symbol, priceInUsd, source = 'Binance') {
    const conversionRate = await fetchUsdtToAudConversionRate(); // Fetch the real-time USD to AUD rate
    const priceInAud = priceInUsd * conversionRate; // Convert USD to AUD

    // Check if this is a new price
    if (lastPriceForCrypto[symbol] && lastPriceForCrypto[symbol] === priceInAud) {
        console.log(`Price for ${symbol} has not changed. No update needed.`);
        return; // Exit if the price hasn't changed
    }

    // Store the new price as the last known price
    lastPriceForCrypto[symbol] = priceInAud;

    // Save current focus state
    saveFocusDetails();

    users[loggedInUser].cryptos.forEach(async crypto => {
        if (crypto.symbol.toLowerCase() === symbol) {
            const coingeckoId = crypto.id; // Use coingeckoId for DOM element lookup
            const priceElement = document.getElementById(`${coingeckoId}-price-aud`);

            if (priceElement) {
                const previousPrice = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

                // Update UI elements if the price has changed
                if (priceInAud !== previousPrice) {
                    const triangleElement = document.getElementById(`${coingeckoId}-triangle`);

                    // Determine if price went up or down
                    const isPriceUp = priceInAud > previousPrice;
                    const flashClass = isPriceUp ? 'flash-green' : 'flash-red';
                    const colorClass = isPriceUp ? 'price-up' : 'price-down';

                    // Update price without re-rendering the container
                    priceElement.classList.remove('price-down', 'flash-red', 'price-up', 'flash-green');
                    priceElement.classList.add(colorClass);
                    flashColor(`${coingeckoId}-price-aud`, flashClass); // Flash but remain white afterward
                    triangleElement.classList.toggle('triangle-up', isPriceUp);
                    triangleElement.classList.toggle('triangle-down', !isPriceUp);

                    priceElement.textContent = `$${formatNumber(priceInAud.toFixed(8), true)}`; // Update price

                    // Get current holdings from DOM (reflects real-time value including EasyMining)
                    // Don't read from localStorage to avoid showing stale NiceHash balance
                    const holdingsElement = document.getElementById(`${coingeckoId}-holdings`);
                    let holdings = 0;
                    if (holdingsElement) {
                        // Parse current displayed value (already includes EasyMining balance for Bitcoin)
                        holdings = parseFloat(holdingsElement.textContent.replace(/,/g, '')) || 0;
                    }

                    const holdingsValueAud = holdings * priceInAud;

                    // Update holdings value directly
                    const valueElement = document.getElementById(`${coingeckoId}-value-aud`);
                    valueElement.textContent = formatNumber(holdingsValueAud.toFixed(2));

                    // For Bitcoin, save the AUD value to localStorage so it persists
                    if (coingeckoId === 'bitcoin' && priceInAud > 0) {
                        setStorageItem(`${loggedInUser}_bitcoin_displayAUD`, holdingsValueAud);
                        console.log(`💰 Saved Bitcoin AUD from WebSocket update: $${holdingsValueAud.toFixed(2)}`);
                    }

                    // Now update the chart modal holdings and value if it's open
                    if (currentCryptoId === coingeckoId) {
                        const holdingsElement = document.getElementById('holdings-info');
                        holdingsElement.innerHTML = `
                            <p><strong>${holdings.toFixed(3)}</strong> ${crypto.symbol.toUpperCase()} = <strong id="holdings-value">$${holdingsValueAud.toFixed(2)}</strong> AUD</p>
                        `;

                        // ✅ FIX: Live price is now updated by syncModalLivePrice() interval only
                        // This prevents flashing between old and new formats

                        // Update holdings value color
                        document.getElementById('holdings-value').style.color = isPriceUp ? '#00FF00' : 'red';
                    }

                    updateTotalHoldings(); // Update total holdings on the main page
                    sortContainersByValue(); // Sort based on updated value

                    // Update candlestick chart with the new live price
                    if (currentCryptoId === coingeckoId) {
                        updateCandlestickChart(priceInAud, priceInUsd); // Also update live price text
                    }
                }
            }
        }
    });

    // Restore focus state after updates
    restoreFocusDetails();
}



// Flashing function to handle color changes for a specified element
function flashColor(elementId, className) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add(className);
        setTimeout(() => {
            element.classList.remove(className);
        }, 1000); // Flash duration 1 second
    }
}




// Global variable to track API requests in the last minute
let requestCount = 0;
const maxRequestsPerMinute = 60;  // Maximum of 60 requests per minute
const maxRequestsPerSecond = 3;   // Maximum of 3 requests per second

// Function to sleep for a specific time (used to throttle requests)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Updated fetchNewsArticles function with caching, rate-limiting, and right-aligned data
async function fetchNewsArticles(cryptoName, cryptoSymbol) {
    const newsApiKey = '75211ca24268436da2443ab960ce465b'; // Your NewsAPI key
    let totalArticles = 0;
    const cacheKey = `${cryptoName}_newsCache`; // Cache key for each crypto
    const cacheExpiryKey = `${cryptoName}_newsCacheExpiry`; // Cache expiry timestamp key
    const cacheExpiryDuration = 1 * 60 * 1000; // Cache duration (15 minutes)

    // Reset the articles count to 'Loading...' to indicate fetching process
    document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">Loading...</span>`;

    // Get the cached data and its expiry timestamp
    const cachedData = JSON.parse(localStorage.getItem(cacheKey));
    const cacheExpiry = localStorage.getItem(cacheExpiryKey);

    const currentTime = Date.now();

    // Use cached data if it exists and hasn't expired
    if (cachedData && cacheExpiry && currentTime < cacheExpiry) {
        console.log('Using cached data for news.');
        displayNews(cachedData); // Use cached data
        return;
    }

    const newsUrl = `https://newsapi.org/v2/everything?q=${cryptoName}+OR+${cryptoSymbol}&language=en&apiKey=${newsApiKey}`;

    // Throttle the API requests
    if (requestCount >= maxRequestsPerMinute) {
        console.warn('Rate limit reached, waiting...');
        await sleep(60 * 1000);  // Wait for 1 minute before trying again
        requestCount = 0;  // Reset request count after waiting
    }

    try {
        const response = await fetch(newsUrl);
        requestCount++;  // Increment request count after each request

        if (requestCount % maxRequestsPerSecond === 0) {
            // Sleep for 1 second after every 3 requests to avoid hitting per-second limit
            await sleep(1000);
        }

        if (response.status === 429) { // Too many requests (rate-limited)
            console.warn('Rate limit hit, using cached data.');
            if (cachedData) {
                displayNews(cachedData); // Use cached data
            } else {
                console.error('No cached data available.');
                document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">0</span>`;
            }
        } else if (!response.ok) {
            throw new Error('Failed to fetch data');
        } else {
            const newsData = await response.json();
            displayNews(newsData); // Display new data

            // Cache the new data and update the expiry timestamp
            localStorage.setItem(cacheKey, JSON.stringify(newsData));
            localStorage.setItem(cacheExpiryKey, currentTime + cacheExpiryDuration); // Cache for 15 minutes
        }
    } catch (error) {
        console.error('Error fetching from NewsAPI:', error);

        // Use cached data if there's an error fetching new data
        if (cachedData) {
            displayNews(cachedData); // Use cached data
        } else {
            document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">0</span>`;
        }
    }
}

// Function to display news articles and handle right alignment
function displayNews(newsData) {
    const totalArticles = newsData.totalResults || 0;
    document.getElementById('newsArticles').innerHTML = `<span class="info-data" style="text-align: right; display: block;">${totalArticles}</span>`;
    console.log(`Displaying ${totalArticles} articles`);
}



// Updated fetchRedditMentions function with right-aligned data
async function fetchRedditMentions(cryptoName) {
    const redditUrl = `https://www.reddit.com/r/CryptoCurrency/search.json?q=${cryptoName}&sort=relevance&t=all`;

    // Reset the Reddit mentions count before starting a new fetch
    document.getElementById('xMentions').innerHTML = `<span class="info-data" style="text-align: right; display: block;">Loading...</span>`;

    try {
        const response = await fetch(redditUrl);
        const data = await response.json();
        let mentionsCount = 0;

        // Ensure we filter posts that are actually related to the crypto name
        if (data.data && data.data.children) {
            data.data.children.forEach(post => {
                const postTitle = post.data.title.toLowerCase();
                const postBody = post.data.selftext.toLowerCase();
                const comments = post.data.num_comments || 0; // Count the comments

                // Count posts that include the crypto name in title or body
                if (postTitle.includes(cryptoName.toLowerCase()) || postBody.includes(cryptoName.toLowerCase())) {
                    mentionsCount++;
                    mentionsCount += comments; // Add comments count as mentions
                }
            });
        }

        // Update the Reddit mentions count in the modal with right alignment
        document.getElementById('xMentions').innerHTML = `<span class="info-data" style="text-align: right; display: block;">${mentionsCount}</span>`;
        console.log(`Reddit mentions for ${cryptoName}: ${mentionsCount}`);
    } catch (error) {
        console.error('Error fetching from Reddit:', error);
        document.getElementById('xMentions').innerHTML = `<span class="info-data" style="text-align: right; display: block;">0</span>`; // Default to 0 in case of error
    }
}

// Call both News and Reddit functions
async function fetchNewsAndRedditData(cryptoName, cryptoSymbol) {
    await fetchNewsArticles(cryptoName, cryptoSymbol);
    await fetchRedditMentions(cryptoName);
}




// Function to load data for the specific crypto when the modal is opened
async function loadCryptoDataForModal(coinId) {
    fetchCryptoInfo(coinId);   // Pulls detailed info like market cap, FDV, etc.
    updateSentimentBar(coinId);   // Updates the sentiment bar based on CoinGecko sentiment

    // Fetch and display the number of news articles
    const totalNewsArticles = await fetchNewsArticles(coinId);
    document.getElementById('newsArticles').innerHTML = `<span class="info-data">${totalNewsArticles}</span>`;
}


// Helper function to format large numbers (for both currency and supply amounts)
function formatLargeNumber(value) {
    if (value >= 1e9) { // Billion
        return `${(value / 1e9).toFixed(2)}B`;
    } else if (value >= 1e6) { // Million
        return `${(value / 1e6).toFixed(2)}M`;
    } else if (value >= 1e3) { // Thousand
        return `${(value / 1e3).toFixed(2)}K`;
    } else {
        return value.toFixed(2); // For numbers smaller than 1000
    }
}


// Function to apply right alignment to the data cells
function applyRightAlignment() {
    // Select all second column cells in the crypto-info-table
    const dataCells = document.querySelectorAll('.crypto-info-table td:last-child');
    
    // Loop through each cell and apply the right-aligned style
    dataCells.forEach(cell => {
        cell.style.textAlign = 'right'; // Right-align the text
    });
}

let cryptoInfoInterval = null; // Store the interval ID for refreshing
let modalLivePriceInterval = null; // Store interval for syncing modal live price with holdings box

// ✅ FIX: Function to sync modal live price with holdings box price
function syncModalLivePrice() {
    if (!currentCryptoId || !isModalOpen) return;

    const livePriceElement = document.getElementById('live-price');
    const holdingsPriceElement = document.getElementById(`${currentCryptoId}-price-aud`);

    if (livePriceElement && holdingsPriceElement) {
        const displayPriceAud = parseFloat(holdingsPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

        if (displayPriceAud > 0) {
            // Format with commas and 3 decimals: 131,142.123
            const formattedPrice = displayPriceAud.toLocaleString('en-US', {
                minimumFractionDigits: 3,
                maximumFractionDigits: 3
            });
            livePriceElement.innerHTML = `<span style="font-weight: normal;">Live Price: </span><b>$${formattedPrice} AUD</b>`;
        }
    }
}

// Function to update percentage changes in the chart modal
function updateModalPercentageChanges(percentageChange24h, percentageChange7d, percentageChange30d) {
    const modalPercentageChangesElement = document.getElementById('modal-percentage-changes');

    if (!modalPercentageChangesElement) return;

    // Helper function to format percentage with color
    const formatPercentage = (value, label) => {
        const isPositive = value >= 0;
        const color = isPositive ? '#00FF00' : '#FF0000';
        const sign = isPositive ? '+' : '';
        return `<span style="color: ${color}; font-weight: bold;">${label}: ${sign}${value.toFixed(2)}%</span>`;
    };

    // Create the HTML content
    const html = `
        ${formatPercentage(percentageChange24h, '24h')} |
        ${formatPercentage(percentageChange7d, '7d')} |
        ${formatPercentage(percentageChange30d, '30d')}
    `;

    modalPercentageChangesElement.innerHTML = html;
}

// Updated fetchCryptoInfo function to include liquidity data and properly right-align table data
async function fetchCryptoInfo(cryptoId) {
    try {
        let success = false;
        let coinData;

        // Try fetching CoinGecko data with API key rotation
        for (let attempt = 0; attempt < apiKeys.length; attempt++) {
            const apiKey = getApiKey();
            const apiUrl = `https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`;

            try {
                const response = await fetch(apiUrl);
                if (response.status === 429) { // Too many requests, rotate the API key
                    console.warn(`API key ${apiKey} hit rate limit. Switching to next key.`);
                    switchApiKey(); // Rotate to the next key
                    continue; // Retry with the new key
                } else if (!response.ok) {
                    throw new Error('Failed to fetch data');
                }

                coinData = await response.json(); // Success case
                success = true;
                break; // Exit loop if successful
            } catch (error) {
                console.error(`Error with API key ${apiKey}:`, error);
                if (attempt === apiKeys.length - 1) {
                    throw new Error('All API keys failed.');
                }
                switchApiKey(); // Rotate key if failed
            }
        }

        if (!success) throw new Error('Failed to fetch coin data after rotating all API keys.');

        // Log fetched data for debugging
        console.log('CoinGecko info data:', coinData);

        // Check and populate the relevant data if the elements exist
        const marketCapRankElement = document.getElementById('marketCapRank');
        if (marketCapRankElement) {
            marketCapRankElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_cap_rank || 'N/A'}</span>`;
        }

        const fdvElement = document.getElementById('fdv');
        if (fdvElement) {
            fdvElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.fully_diluted_valuation.aud ? formatLargeNumber(coinData.market_data.fully_diluted_valuation.aud) : 'N/A'}</span>`;
        }

        const liquidityElement = document.getElementById('liquidity');
        if (liquidityElement) {
            liquidityElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.total_volume.aud ? formatLargeNumber(coinData.market_data.total_volume.aud) : 'N/A'}</span>`;
        }

        const lowHighElement = document.getElementById('lowHigh');
        if (lowHighElement) {
            lowHighElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">$${coinData.market_data.low_24h.aud} / $${coinData.market_data.high_24h.aud}</span>`;
        }

        const circulatingSupplyElement = document.getElementById('circulatingSupply');
        if (circulatingSupplyElement) {
            circulatingSupplyElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.circulating_supply ? formatLargeNumber(coinData.market_data.circulating_supply) + ` ${coinData.symbol.toUpperCase()}` : 'N/A'}</span>`;
        }

        const totalSupplyElement = document.getElementById('totalSupply');
        if (totalSupplyElement) {
            totalSupplyElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.total_supply ? formatLargeNumber(coinData.market_data.total_supply) + ` ${coinData.symbol.toUpperCase()}` : 'N/A'}</span>`;
        }

        const maxSupplyElement = document.getElementById('maxSupply');
        if (maxSupplyElement) {
            maxSupplyElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">${coinData.market_data.max_supply ? formatLargeNumber(coinData.market_data.max_supply) + ` ${coinData.symbol.toUpperCase()}` : 'N/A'}</span>`;
        }

        const athAtlElement = document.getElementById('athAtl');
        if (athAtlElement) {
            athAtlElement.innerHTML = `<span class="info-data" style="text-align: right; display: block;">$${coinData.market_data.ath.aud} / $${coinData.market_data.atl.aud}</span>`;
        }

        // Extract and update percentage changes in modal
        const percentageChange24h = coinData.market_data?.price_change_percentage_24h || 0;
        const percentageChange7d = coinData.market_data?.price_change_percentage_7d || 0;
        const percentageChange30d = coinData.market_data?.price_change_percentage_30d || 0;

        updateModalPercentageChanges(percentageChange24h, percentageChange7d, percentageChange30d);

    } catch (error) {
        console.error('Error fetching detailed crypto info:', error);
    }
}

// Function to start auto-refresh every 30 seconds
function startAutoUpdateCryptoInfo(cryptoId) {
    // Clear any existing interval before starting a new one
    if (cryptoInfoInterval !== null) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }

    // Fetch and update immediately
    fetchCryptoInfo(cryptoId);

    // Set interval to fetch and update every 30 seconds
    cryptoInfoInterval = setInterval(() => {
        if (isModalOpen) {
            fetchCryptoInfo(cryptoId);
        } else {
            clearInterval(cryptoInfoInterval);
            cryptoInfoInterval = null;
        }
    }, 30000);  // 30 seconds = 30000 milliseconds
}


// Function to fetch sentiment data from CoinGecko with API key rotation
async function fetchCryptoSentiment(cryptoId) {
    let success = false;

    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        const apiKey = getApiKey();
        const apiUrl = `https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`;

        try {
            const response = await fetch(apiUrl);
            if (response.status === 429) { // Rate limit hit
                console.warn(`API key ${apiKey} hit rate limit. Switching to the next key.`);
                switchApiKey();
                continue; // Retry with the next key
            }
            if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

            const data = await response.json();
            const sentimentData = data.sentiment_votes_up_percentage || 50; // Default to 50% if no data
            const bullishPercent = sentimentData;
            const bearishPercent = 100 - bullishPercent;

            // Update the sentiment bar
            document.getElementById('bearish-bar').style.width = `${bearishPercent}%`;
            document.getElementById('bullish-bar').style.width = `${bullishPercent}%`;
            document.getElementById('bearish-label').innerText = `Bearish: ${Math.round(bearishPercent)}%`;
            document.getElementById('bullish-label').innerText = `Bullish: ${Math.round(bullishPercent)}%`;

            console.log(`Sentiment updated: Bullish ${bullishPercent}% | Bearish ${bearishPercent}%`);

            success = true;
            break; // Exit the loop on success
        } catch (error) {
            console.error(`Error fetching sentiment data with API key ${apiKey}:`, error);
            if (attempt === apiKeys.length - 1) {
                console.error('All API keys failed.');
                throw new Error('Unable to fetch sentiment data.');
            }
            switchApiKey(); // Rotate key if failed
        }
    }
}

// Function to update the sentiment bar every minute
async function updateSentimentBar(cryptoId) {
    await fetchCryptoSentiment(cryptoId); // Fetch and display sentiment

    // Update every minute
    setTimeout(() => updateSentimentBar(cryptoId), 30000);
}



// Old fallback functions removed - using single MEXC WebSocket with ping/pong



let updateTimeout;

function debounceUpdateUI(cryptoId, priceInAud) {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(() => {
        const priceElement = document.getElementById(`${cryptoId}-price-aud`);
        if (priceElement) {
            // Get holdings - for Bitcoin, include NiceHash balance if EasyMining is enabled
            let holdings;
            if (cryptoId === 'bitcoin' && easyMiningSettings && (easyMiningSettings.includeAvailableBTC || easyMiningSettings.includePendingBTC)) {
                // For Bitcoin with EasyMining, get the total from the display (which includes NiceHash balance)
                const btcHoldingsElement = document.getElementById('bitcoin-holdings');
                holdings = btcHoldingsElement ? parseFloat(btcHoldingsElement.textContent.replace(/,/g, '')) : 0;
            } else {
                // For other cryptos, get from localStorage
                holdings = parseFloat(localStorage.getItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
                console.log(`📖 debounceUpdateUI reading ${cryptoId} from localStorage: ${holdings}`);
            }

            const audValue = holdings * priceInAud;

            // For Bitcoin: only update display and save if price is valid (> 0)
            // This prevents showing/saving $0.00 when price hasn't loaded yet
            if (cryptoId === 'bitcoin' && priceInAud === 0) {
                console.warn(`⚠️ debounceUpdateUI BTC - NOT updating display because price is 0 (keeping stored value visible)`);
            } else {
                document.getElementById(`${cryptoId}-value-aud`).textContent = formatNumber(audValue.toFixed(2));

                // SAVE Bitcoin AUD to localStorage when price is valid
                if (cryptoId === 'bitcoin') {
                    setStorageItem(`${loggedInUser}_bitcoin_displayAUD`, audValue);
                }

                console.log(`🔄 debounceUpdateUI updated ${cryptoId} AUD value: ${audValue.toFixed(2)} (holdings: ${holdings}, price: ${priceInAud})`);
            }
        }

        updateTotalHoldings();
        sortContainersByValue();
    }, 500);  // Debounce to update after 500ms
}





// Function to update the candlestick chart with stable price from holdings box
function updatePriceInChart(priceInUsd) {
    if (!candlestickChart || !currentCryptoId) return;

    // ✅ FIX: Read stable price from holdings box instead of using WebSocket data
    const holdingsPriceElement = document.getElementById(`${currentCryptoId}-price-aud`);
    if (!holdingsPriceElement) return;

    const priceInAud = parseFloat(holdingsPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
    if (priceInAud <= 0) return;

    const now = new Date();
    const lastCandle = candlestickChart.data.datasets[0].data[candlestickChart.data.datasets[0].data.length - 1];

    // Update existing candle or create new one based on selected interval
    if (lastCandle && now - new Date(lastCandle.x) < currentIntervalMs) {
        lastCandle.c = priceInAud;
        if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
        if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
    } else {
        candlestickChart.data.datasets[0].data.push({
            x: now,
            o: priceInAud,
            h: priceInAud,
            l: priceInAud,
            c: priceInAud
        });
    }

    // ✅ FIX: Stabilize y-axis - only update if price moves outside current range
    const currentMin = candlestickChart.options.scales.y.min || 0;
    const currentMax = candlestickChart.options.scales.y.max || 0;
    const currentRange = currentMax - currentMin;
    const buffer = currentRange * 0.15; // 15% buffer

    // Only recalculate y-axis if price goes outside the buffered range
    if (priceInAud < (currentMin + buffer) || priceInAud > (currentMax - buffer) || currentRange === 0) {
        const allPrices = candlestickChart.data.datasets[0].data
            .flatMap(candle => [candle.h, candle.l])
            .filter(p => p > 0);

        if (allPrices.length > 0) {
            const minPrice = Math.min(...allPrices);
            const maxPrice = Math.max(...allPrices);
            const padding = (maxPrice - minPrice) * 0.1;

            candlestickChart.options.scales.y.min = Math.max(0, minPrice - padding);
            candlestickChart.options.scales.y.max = maxPrice + padding;
        }
    }

    // Update chart smoothly
    candlestickChart.update('none'); // 'none' mode = no animation, smoother updates
}





async function checkWebSocketUpdate() {
    const now = Date.now();

    // Loop through all cryptos
    for (let crypto of users[loggedInUser].cryptos) {
        const symbol = crypto.symbol.toLowerCase();

        // Check if no WebSocket update for over 2 minutes
        if (!lastWebSocketUpdateForCrypto[symbol] || now - lastWebSocketUpdateForCrypto[symbol] > twoMinutes) {
            console.log(`No WebSocket update for ${symbol} in 2 minutes. Fetching from CoinGecko...`);

            // Fallback to CoinGecko for this coin
            const geckoPrice = await fetchPricesFromCoinGecko(crypto.id);
            const priceElement = document.getElementById(`${crypto.id}-price-aud`);

            if (geckoPrice !== null) {
                // Update price from CoinGecko
                const priceInAud = geckoPrice;
                const previousPrice = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;

                if (priceInAud !== previousPrice) {
                    priceElement.textContent = `$${formatNumber(priceInAud.toFixed(8), true)}`;
                    updateCryptoValue(crypto.id);
                    updateTotalHoldings();
                    console.log(`Fetched CoinGecko price for ${crypto.symbol}: $${priceInAud} AUD`);
                }
            } else {
                console.error(`Failed to get CoinGecko price for ${crypto.symbol}`);
            }
        }
    }
}



let lastApiCall = 0;
const apiCooldown = 60000; // 1 minute cooldown

function canFetchFromApi() {
    const now = Date.now();
    if (now - lastApiCall > apiCooldown) {
        lastApiCall = now;
        return true;
    }
    return false;
}


let priceCache = {};
const cacheExpiryTime = 60000; // Cache for 1 minute

async function fetchWithCache(cryptoId) {
    const now = Date.now();
    if (priceCache[cryptoId] && (now - priceCache[cryptoId].timestamp < cacheExpiryTime)) {
        return priceCache[cryptoId].price;
    }

    if (canFetchFromApi()) {
        const price = await fetchPricesFromCoinGecko(cryptoId);
        if (price) {
            priceCache[cryptoId] = { price, timestamp: now };
        }
        return price;
    } else {
        console.log('API request throttled.');
        return null;
    }
}






// Function to update the candlestick chart with stable price from holdings box
function updateCandlestickChart(priceInAud, priceInUsd) {
    if (!candlestickChart || !currentCryptoId) return;

    // ✅ FIX: Read stable price from holdings box instead of using passed parameters
    const holdingsPriceElement = document.getElementById(`${currentCryptoId}-price-aud`);
    if (!holdingsPriceElement) return;

    const stablePriceAud = parseFloat(holdingsPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
    if (stablePriceAud <= 0) return;

    const now = new Date();
    const lastCandle = candlestickChart.data.datasets[0].data[candlestickChart.data.datasets[0].data.length - 1];

    // Update existing candle or create new one based on selected interval
    if (lastCandle && now - new Date(lastCandle.x) < currentIntervalMs) {
        lastCandle.c = stablePriceAud;
        if (stablePriceAud > lastCandle.h) lastCandle.h = stablePriceAud;
        if (stablePriceAud < lastCandle.l) lastCandle.l = stablePriceAud;
    } else {
        candlestickChart.data.datasets[0].data.push({
            x: now,
            o: stablePriceAud,
            h: stablePriceAud,
            l: stablePriceAud,
            c: stablePriceAud
        });
    }

    // ✅ FIX: Stabilize y-axis - only update if price moves outside current range
    const currentMin = candlestickChart.options.scales.y.min || 0;
    const currentMax = candlestickChart.options.scales.y.max || 0;
    const currentRange = currentMax - currentMin;
    const buffer = currentRange * 0.15; // 15% buffer

    // Only recalculate y-axis if price goes outside the buffered range
    if (stablePriceAud < (currentMin + buffer) || stablePriceAud > (currentMax - buffer) || currentRange === 0) {
        const allPrices = candlestickChart.data.datasets[0].data
            .flatMap(candle => [candle.h, candle.l])
            .filter(p => p > 0);

        if (allPrices.length > 0) {
            const minPrice = Math.min(...allPrices);
            const maxPrice = Math.max(...allPrices);
            const padding = (maxPrice - minPrice) * 0.1;

            candlestickChart.options.scales.y.min = Math.max(0, minPrice - padding);
            candlestickChart.options.scales.y.max = maxPrice + padding;
        }
    }

    // Update chart smoothly
    candlestickChart.update('none'); // 'none' mode = no animation, smoother updates
}



function saveCandlestickData(cryptoId, priceInAud) {
    // ✅ FIX: Don't save invalid prices
    if (!priceInAud || priceInAud <= 0 || isNaN(priceInAud)) {
        console.warn(`⚠️ Skipping save of invalid price: ${priceInAud}`);
        return;
    }

    const now = new Date();
    const candlestickData = JSON.parse(localStorage.getItem(`${cryptoId}_candlestickData`)) || [];

    const lastCandle = candlestickData[candlestickData.length - 1];
    if (lastCandle && now - new Date(lastCandle.x) < 5 * 60 * 1000) {
        lastCandle.c = priceInAud;
        if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
        if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
    } else {
        candlestickData.push({
            x: now,
            o: priceInAud,
            h: priceInAud,
            l: priceInAud,
            c: priceInAud
        });
    }

    localStorage.setItem(`${cryptoId}_candlestickData`, JSON.stringify(candlestickData));
}

async function fetchHistoricalData(cryptoId) {
    // Get days parameter based on selected interval
    const days = intervalConfigs[currentChartInterval].coingecko;

    console.log(`📊 Fetching ${days} days of historical data for interval: ${currentChartInterval}`);

    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=${days}`);
    if (!response.ok) {
        throw new Error('Failed to fetch historical data');
    }
    const data = await response.json();
    const conversionRate = 1.51; // Example conversion rate from USD to AUD

    console.log(`✅ Fetched ${data.length} candles for ${currentChartInterval} interval`);

    return data.map(d => ({
        x: new Date(d[0]),
        o: d[1] * conversionRate,
        h: d[2] * conversionRate,
        l: d[3] * conversionRate,
        c: d[4] * conversionRate
    }));
}

function initializeWebSocketForCrypto(symbol) {
    const wsEndpoint = 'wss://wbs-api.mexc.com/ws'; // Updated to new MEXC endpoint
    currentWebSocket = new WebSocket(wsEndpoint); // Track the WebSocket for the current modal

    currentWebSocket.onopen = function() {
        console.log(`✅ Chart WebSocket connection opened for ${symbol}`);
        console.log('   ReadyState:', this.readyState, '(should be 1 = OPEN)');

        // Use 'this' to reference the actual WebSocket instance that fired this event
        const ws = this;

        // No setTimeout needed - onopen guarantees the connection is ready
        // Use the new aggre.deals format for fastest updates
        const channel = `spot@public.aggre.deals.v3.api.pb@100ms@${symbol.toUpperCase()}USDT`;
        const subscriptionMessage = JSON.stringify({
            "method": "SUBSCRIPTION",
            "params": [channel],
            "id": 1
        });
        ws.send(subscriptionMessage);
        console.log(`   ✓ Chart subscribed to ${symbol.toUpperCase()}USDT (aggre.deals)`);
    };

    currentWebSocket.onmessage = function(event) {
        try {
            // MEXC sends binary Protocol Buffer data for .pb channels
            if (event.data instanceof Blob) {
                console.log(`📦 Received Blob data for ${symbol}, converting...`);

                // Convert Blob to ArrayBuffer
                const reader = new FileReader();
                reader.onload = function() {
                    const arrayBuffer = reader.result;
                    const uint8Array = new Uint8Array(arrayBuffer);

                    console.log(`📨 Binary data length: ${uint8Array.length} bytes (first 50):`, Array.from(uint8Array.slice(0, 50)));

                    // Try to decode as UTF-8 string first (some messages might be JSON)
                    const decoder = new TextDecoder('utf-8');
                    const text = decoder.decode(uint8Array);

                    // Try parsing as JSON first
                    try {
                        const message = JSON.parse(text);
                        console.log(`✅ Successfully parsed as JSON:`, message);
                        handleChartMessage(message, symbol);
                    } catch (jsonError) {
                        console.log(`⚠️ Not JSON, attempting protobuf decode...`);
                        // This is actual protobuf data - decode it
                        decodeChartProtobuf(uint8Array, symbol);
                    }
                };
                reader.readAsArrayBuffer(event.data);
            } else if (typeof event.data === 'string') {
                // Text message (subscription confirmations, etc.)
                console.log(`📨 Text message for ${symbol}:`, event.data);
                const message = JSON.parse(event.data);
                handleChartMessage(message, symbol);
            }
        } catch (error) {
            console.error(`❌ Chart WebSocket message error for ${symbol}:`, error);
            console.error('   Data type:', typeof event.data);
            console.error('   Data:', event.data);
        }
    };

    currentWebSocket.onclose = function() {
        console.log(`🔌 Chart WebSocket connection closed for ${symbol}`);
    };

    currentWebSocket.onerror = function(error) {
        console.error(`❌ Chart WebSocket error for ${symbol}:`, error);
    };
}

// Helper function to handle parsed chart messages
function handleChartMessage(message, symbol) {
    // Handle subscription responses
    if (message.id || message.code !== undefined) {
        console.log(`📋 Chart subscription response:`, message);
        return;
    }

    // Handle NEW aggre.deals format
    if (message.channel && message.channel.includes('aggre.deals') && message.data && message.data.price) {
        const price = parseFloat(message.data.price);
        console.log(`📊 Chart price update for ${symbol}: $${price} USDT`);

        // Update the price only if the current modal is open and matches the symbol
        if (isModalOpen && currentModalCryptoSymbol === symbol) {
            updatePriceInChart(price); // Update the candlestick chart with live price
        }
    }
    // Handle OLD format (fallback)
    else if (message && message.d && Array.isArray(message.d.deals) && message.d.deals.length > 0) {
        const deals = message.d.deals;
        const firstDeal = deals[0];
        if (firstDeal && firstDeal.p !== undefined) {
            const price = parseFloat(firstDeal.p);
            console.log(`📊 Chart price update for ${symbol}: $${price} USDT [OLD FORMAT]`);

            // Update the price only if the current modal is open and matches the symbol
            if (isModalOpen && currentModalCryptoSymbol === symbol) {
                updatePriceInChart(price); // Update the candlestick chart with live price
            }
        }
    }
}

// Protobuf decoder for MEXC binary data
function decodeChartProtobuf(uint8Array, symbol) {
    console.log(`🔍 Protobuf data analysis for ${symbol}:`);
    console.log(`   Length: ${uint8Array.length} bytes`);
    console.log(`   First 100 bytes:`, Array.from(uint8Array.slice(0, 100)));

    // Try to find readable strings in the binary data
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const partialDecode = decoder.decode(uint8Array);
    const readableChars = partialDecode.match(/[\x20-\x7E]+/g);
    if (readableChars) {
        console.log(`   Readable strings found:`, readableChars);
    }

    // Manual protobuf parsing - MEXC uses a simple structure
    // Protocol Buffer wire format: field_number << 3 | wire_type
    // wire_type: 0=varint, 1=64-bit, 2=length-delimited, 5=32-bit

    try {
        let offset = 0;
        let priceFound = null;

        while (offset < uint8Array.length) {
            // Read field tag
            if (offset >= uint8Array.length) break;

            const tag = uint8Array[offset];
            const fieldNumber = tag >> 3;
            const wireType = tag & 0x07;

            offset++;

            // Wire type 2 = length-delimited (strings, bytes)
            // Wire type 1 = 64-bit (doubles)
            // Wire type 5 = 32-bit (floats)

            if (wireType === 2) {
                // Read length
                let length = 0;
                let shift = 0;
                while (offset < uint8Array.length) {
                    const byte = uint8Array[offset++];
                    length |= (byte & 0x7F) << shift;
                    if ((byte & 0x80) === 0) break;
                    shift += 7;
                }

                // Skip the value bytes
                const value = uint8Array.slice(offset, offset + length);
                offset += length;

                // Try to decode as string
                const str = new TextDecoder('utf-8', { fatal: false }).decode(value);
                if (/^[\x20-\x7E]+$/.test(str)) {
                    console.log(`   Field ${fieldNumber} (string): "${str}"`);
                }
            } else if (wireType === 1) {
                // 64-bit double
                if (offset + 8 <= uint8Array.length) {
                    const view = new DataView(uint8Array.buffer, offset, 8);
                    const doubleValue = view.getFloat64(0, true); // little-endian
                    console.log(`   Field ${fieldNumber} (double): ${doubleValue}`);

                    // Price is likely a double value
                    if (doubleValue > 0 && doubleValue < 1000000 && !priceFound) {
                        priceFound = doubleValue;
                    }

                    offset += 8;
                }
            } else if (wireType === 5) {
                // 32-bit float
                if (offset + 4 <= uint8Array.length) {
                    const view = new DataView(uint8Array.buffer, offset, 4);
                    const floatValue = view.getFloat32(0, true); // little-endian
                    console.log(`   Field ${fieldNumber} (float): ${floatValue}`);

                    // Price might be a float
                    if (floatValue > 0 && floatValue < 1000000 && !priceFound) {
                        priceFound = floatValue;
                    }

                    offset += 4;
                }
            } else if (wireType === 0) {
                // Varint
                let value = 0;
                let shift = 0;
                while (offset < uint8Array.length) {
                    const byte = uint8Array[offset++];
                    value |= (byte & 0x7F) << shift;
                    if ((byte & 0x80) === 0) break;
                    shift += 7;
                }
                console.log(`   Field ${fieldNumber} (varint): ${value}`);
            } else {
                // Unknown wire type, try to skip
                break;
            }
        }

        // If we found a likely price, use it
        if (priceFound) {
            console.log(`💰 Extracted price from protobuf: $${priceFound} USDT`);

            if (isModalOpen && currentModalCryptoSymbol === symbol) {
                updatePriceInChart(priceFound);
            }
        } else {
            console.log(`⚠️ Could not extract price from protobuf data`);
        }

    } catch (error) {
        console.error(`❌ Error decoding protobuf:`, error);
    }
}

let isSpacebarPressed = false;

// Listen for keydown and keyup events to detect spacebar press
document.addEventListener('keydown', function (event) {
    if (event.code === 'Space') {
        isSpacebarPressed = true;
        document.body.style.cursor = 'grab';  // Change cursor to indicate panning mode
    }
});

document.addEventListener('keyup', function (event) {
    if (event.code === 'Space') {
        isSpacebarPressed = false;
        document.body.style.cursor = 'default';  // Reset cursor
    }
});

let currentModalCryptoSymbol = null; // Store the current symbol for the modal
let currentWebSocket = null; // Track the current WebSocket connection for the modal
let isModalOpen = false; // Track if modal is open



// Function to open the candlestick modal and load data for the specific crypto
async function openCandlestickModal(cryptoId) {
    currentCryptoId = cryptoId;
    isModalOpen = true;

    if (currentWebSocket) {
        currentWebSocket.close();
        currentWebSocket = null;
    }

    if (cryptoInfoInterval !== null) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }

    // ✅ FIX: Clear modal live price sync interval if exists
    if (modalLivePriceInterval !== null) {
        clearInterval(modalLivePriceInterval);
        modalLivePriceInterval = null;
    }

    const modal = document.getElementById('candlestick-modal');

    try {
        // Fetch the cryptocurrency from user data
        const crypto = users[loggedInUser].cryptos.find(crypto => crypto.id === cryptoId);
        if (!crypto) {
            throw new Error('Cryptocurrency not found for the provided ID.');
        }

        const symbol = crypto.symbol.toLowerCase();
        const cryptoName = crypto.name; // Pull crypto name dynamically for news/reddit
        currentModalCryptoSymbol = symbol;

        // Update the crypto icon and name
        const cryptoIconElement = document.getElementById('crypto-icon');
        const cryptoNameElement = document.getElementById('crypto-name');

        let coinData;
        let success = false;

        // Try fetching CoinGecko data with API key rotation
        for (let attempt = 0; attempt < apiKeys.length; attempt++) {
            const apiKey = getApiKey();
            const coinGeckoApi = `https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`;
            try {
                const response = await fetch(coinGeckoApi);
                if (response.status === 429) { // Too many requests, rotate the API key
                    console.warn(`API key ${apiKey} hit rate limit. Switching to the next key.`);
                    switchApiKey(); // Rotate to the next key
                    continue; // Retry with the new key
                } else if (!response.ok) {
                    throw new Error('Failed to fetch data');
                }
                coinData = await response.json(); // Success case
                success = true;
                break;
            } catch (error) {
                console.error('Error fetching data:', error);
                if (attempt === apiKeys.length - 1) {
                    throw new Error('All API keys failed.');
                }
                switchApiKey(); // Rotate key if failed
            }
        }

        if (!success) throw new Error('Failed to fetch coin data after rotating all API keys.');

        // Update icon and name in the modal
        cryptoIconElement.src = coinData.image.small;
        cryptoIconElement.alt = `${crypto.name} Icon`;
        cryptoNameElement.textContent = `${crypto.name} (${crypto.symbol.toUpperCase()})`;

        // Display holdings and holdings value
        const holdings = parseFloat(getStorageItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
        const priceInAud = parseFloat(document.getElementById(`${cryptoId}-price-aud`).textContent.replace(/,/g, '').replace('$', '')) || 0;
        const holdingsValueAud = holdings * priceInAud;
        const holdingsElement = document.getElementById('holdings-info');

        // Format holdings and AUD value with commas and 3 decimals
        const formattedHoldings = holdings.toLocaleString('en-US', {
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        });
        const formattedAudValue = holdingsValueAud.toLocaleString('en-US', {
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        });

        holdingsElement.innerHTML = `
            <p><strong>${formattedHoldings}</strong> ${crypto.symbol.toUpperCase()} = <strong>$${formattedAudValue}</strong> AUD</p>
        `;

        // Initialize conversion calculator with current price
        if (priceInAud > 0) {
            updateConversionCalculator(priceInAud);
        } else {
            // Fallback to CoinGecko API price if element price not available
            const currentPrice = coinData.market_data?.current_price?.aud || 0;
            if (currentPrice > 0) {
                updateConversionCalculator(currentPrice);
            }
        }

        // Initialize TradingView chart with current interval
        initializeTradingViewChart(symbol, currentChartInterval);
        modal.style.display = 'block';

        // Fetch and display detailed info and sentiment data
        await fetchCryptoInfo(cryptoId);  // Market data
        await fetchCryptoSentiment(cryptoId);  // Sentiment data
        await fetchNewsAndRedditData(cryptoName);  // Fetch news and Reddit mentions using crypto name
        
        startAutoUpdateCryptoInfo(cryptoId);
        
        // Initialize WebSocket for live price updates
        initializeWebSocketForCrypto(symbol);

        // Start refreshing the data every 30 seconds, but stop when modal is closed
        if (cryptoInfoInterval) clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = setInterval(async () => {
            if (isModalOpen && currentCryptoId === cryptoId) {
                await fetchCryptoInfo(cryptoId);
                await fetchCryptoSentiment(cryptoId);
                await fetchNewsAndRedditData(cryptoName);
            }
        }, 30000); // 30 seconds

        // ✅ FIX: Start syncing modal live price with holdings box every second
        if (modalLivePriceInterval) clearInterval(modalLivePriceInterval);
        modalLivePriceInterval = setInterval(() => {
            syncModalLivePrice();
        }, 1000); // Update every second to stay in sync

        // Initial sync
        syncModalLivePrice();

    } catch (error) {
        console.error('Error fetching or displaying candlestick data:', error);
    }
}




// ✅ DEPRECATED: Live price is now updated by syncModalLivePrice() interval only
// This function is no longer used but kept for reference
async function fetchLivePrice(symbol) {
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=aud,usd`;

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        // Retrieve both live prices for AUD and USD
        const audPrice = data[symbol].aud;
        const usdPrice = data[symbol].usd;

        // ✅ FIX: Removed live price update - now handled by syncModalLivePrice() interval
        // This prevents format inconsistencies and flashing

    } catch (error) {
        console.error('Error fetching live price:', error);
    }
}




function closeCandlestickModal() {
    isModalOpen = false; // Mark that the modal is closed
    currentModalCryptoSymbol = null; // Reset the current modal crypto symbol

    // Close the WebSocket if it's open
    if (currentWebSocket) {
        currentWebSocket.close();
        currentWebSocket = null; // Reset the WebSocket
    }

    // Close the modal display
    document.getElementById('candlestick-modal').style.display = 'none';

    // Clear the interval when the modal is closed
    if (cryptoInfoInterval !== null) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }

    // ✅ FIX: Clear modal live price sync interval
    if (modalLivePriceInterval !== null) {
        clearInterval(modalLivePriceInterval);
        modalLivePriceInterval = null;
    }
}









async function fetchCandlestickData(cryptoId) {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=1`);
    if (!response.ok) {
        throw new Error('Failed to fetch candlestick data');
    }
    return await response.json();
}

function formatCandlestickData(data) {
    // ✅ FIX: Filter out any candles with 0 or invalid values and sort by time
    const validData = data
        .filter(d => {
            const isValid = d && d.o > 0 && d.h > 0 && d.l > 0 && d.c > 0 &&
                           !isNaN(d.o) && !isNaN(d.h) && !isNaN(d.l) && !isNaN(d.c) &&
                           d.o !== null && d.h !== null && d.l !== null && d.c !== null;
            if (!isValid) {
                console.warn(`⚠️ Filtering out invalid candle:`, d);
            }
            return isValid;
        })
        .sort((a, b) => new Date(a.x) - new Date(b.x)); // Sort by time

    console.log(`📊 Chart data: ${data.length} total, ${validData.length} valid candles`);

    // If we have valid data, set the last price as the stored valid price
    if (validData.length > 0) {
        const lastCandle = validData[validData.length - 1];
        const lastPrice = lastCandle.c / 1.52; // Convert back to USD
        lastValidChartPrice = lastPrice;
        console.log(`💾 Stored last valid price: $${lastPrice}`);
    }

    return {
        datasets: [{
            label: 'Price',
            data: validData.map(d => ({
                x: new Date(d.x),
                o: d.o,
                h: d.h,
                l: d.l,
                c: d.c
            })),
            borderColor: '#26a69a',
            backgroundColor: 'rgba(38, 166, 154, 0.5)',
            borderWidth: 1,
            barThickness: 5 // Thinner candlesticks
        }]
    };
}

function closeCandlestickModal() {
    currentCryptoId = null;
    closeWebSocket();
    document.getElementById('candlestick-modal').style.display = 'none';
    const tooltipEl = document.getElementById('chartjs-tooltip');
    if (tooltipEl) {
        tooltipEl.style.opacity = 0;
    }
    initializeWebSocket(); // Reinitialize WebSocket for all cryptos
}

// =============================================================================
// CRYPTO AUTOCOMPLETE FUNCTIONALITY
// =============================================================================

let cryptoList = [];
let autocompleteInitialized = false;

// Fetch crypto list from CoinGecko (same source as the Google Sheets)
async function fetchCryptoList() {
    if (cryptoList.length > 0) {
        console.log('Crypto list already loaded');
        return;
    }
    
    try {
        console.log('Fetching crypto list from CoinGecko...');
        const response = await fetch('https://api.coingecko.com/api/v3/coins/list');
        if (!response.ok) {
            throw new Error('Failed to fetch crypto list');
        }
        cryptoList = await response.json();
        console.log(`✅ Loaded ${cryptoList.length} cryptocurrencies`);
    } catch (error) {
        console.error('❌ Error fetching crypto list:', error);
    }
}

// Initialize autocomplete
function initializeAutocomplete() {
    if (autocompleteInitialized) {
        console.log('Autocomplete already initialized');
        return;
    }
    
    console.log('Initializing autocomplete...');
    
    const input = document.getElementById('crypto-id-input');
    const autocompleteList = document.getElementById('autocomplete-list');
    
    if (!input || !autocompleteList) {
        console.error('❌ Autocomplete elements not found');
        return;
    }
    
    console.log('✅ Autocomplete elements found');
    autocompleteInitialized = true;
    
    // Fetch crypto list immediately
    fetchCryptoList();
    
    input.addEventListener('input', function() {
        const value = this.value.toLowerCase().trim();
        autocompleteList.innerHTML = '';
        
        console.log('Input value:', value);
        
        if (!value) {
            return;
        }
        
        if (cryptoList.length === 0) {
            autocompleteList.innerHTML = '<div style="padding: 10px; color: #888;">Loading cryptocurrencies...</div>';
            fetchCryptoList();
            return;
        }
        
        // Search for matches
        const matches = cryptoList.filter(crypto => {
            const id = crypto.id.toLowerCase();
            const name = crypto.name.toLowerCase();
            const symbol = crypto.symbol.toLowerCase();
            return id.includes(value) || name.includes(value) || symbol.includes(value);
        }).slice(0, 10);
        
        console.log(`Found ${matches.length} matches for "${value}"`);
        
        if (matches.length === 0) {
            autocompleteList.innerHTML = '<div style="padding: 10px; color: #888;">No matches found</div>';
            return;
        }
        
        // Display matches
        matches.forEach(crypto => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            
            // Create a clean letter circle icon (real icon loads when crypto is added)
            const firstLetter = crypto.symbol[0].toUpperCase();
            
            item.innerHTML = `
                <div class="autocomplete-icon">
                    ${firstLetter}
                </div>
                <div class="autocomplete-text">
                    ${crypto.name} (${crypto.symbol.toUpperCase()})
                </div>
            `;
            
            item.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Selected crypto:', crypto.id);
                input.value = crypto.id;
                autocompleteList.innerHTML = '';
                addCrypto();
            });
            
            autocompleteList.appendChild(item);
        });
    });
    
    // Close autocomplete when clicking outside
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !autocompleteList.contains(e.target)) {
            autocompleteList.innerHTML = '';
        }
    });
    
    console.log('✅ Autocomplete initialized successfully');
}

// =============================================================================
// CONVERSION CALCULATOR FUNCTIONALITY
// =============================================================================

let currentModalPrice = 0;

function calculateFromCrypto() {
    const cryptoAmount = parseFloat(document.getElementById('crypto-amount-input').value) || 0;
    const audAmount = cryptoAmount * currentModalPrice;
    document.getElementById('aud-amount-input').value = audAmount.toFixed(8);
}

function calculateFromAUD() {
    const audAmount = parseFloat(document.getElementById('aud-amount-input').value) || 0;
    const cryptoAmount = currentModalPrice > 0 ? audAmount / currentModalPrice : 0;
    document.getElementById('crypto-amount-input').value = cryptoAmount.toFixed(8);
}

// Update this function when opening the modal to set the current price
function updateConversionCalculator(priceInAud) {
    currentModalPrice = priceInAud;
    document.getElementById('crypto-amount-input').value = 1;
    document.getElementById('aud-amount-input').value = priceInAud.toFixed(8);
}

// =============================================================================
// EASYMINING DATA STRUCTURES & CONFIGURATION
// =============================================================================

let easyMiningSettings = {
    apiKey: '',
    apiSecret: '',
    orgId: '',
    enabled: false,
    autoUpdateHoldings: false,
    includeAvailableBTC: false,
    includePendingBTC: false
};

let easyMiningData = {
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
};

let easyMiningPollingInterval = null;
let easyMiningAlertsPollingInterval = null; // For solo/team alerts in main EasyMining section
let buyPackagesPollingInterval = null;
let buyPackagesPollingPaused = false;
let buyPackagesPauseTimer = null;
let showAllPackages = false;
let currentPackagePage = 1; // Arrow navigation pagination (Desktop: 6 per page, Mobile: 3 per page)
const packagesPerPage = 6; // Desktop/Tablet cards per page (mobile uses 3)
let missedRewardsCheckInterval = null; // For checking missed rewards every 30 seconds

// Error alert throttling with delayed alerts (prevent spam during reconnection)
let lastEasyMiningErrorAlert = 0;
let firstEasyMiningErrorTime = 0;
let easyMiningErrorPending = false;
let easyMiningErrorTimer = null;
const EASYMINING_ERROR_ALERT_COOLDOWN = 60000; // 60 seconds between error alerts
const EASYMINING_ERROR_DELAY = 20000; // 20 seconds delay before first alert

// Helper function to schedule a delayed error alert
function scheduleEasyMiningErrorAlert(errorMessage) {
    const now = Date.now();

    // If already in cooldown from a previous alert, don't schedule new one
    const timeSinceLastAlert = now - lastEasyMiningErrorAlert;
    if (timeSinceLastAlert < EASYMINING_ERROR_ALERT_COOLDOWN) {
        console.log(`⏳ Suppressing EasyMining error alert (cooldown: ${Math.ceil((EASYMINING_ERROR_ALERT_COOLDOWN - timeSinceLastAlert) / 1000)}s remaining)`);
        return;
    }

    // If this is the first error, start the delay timer
    if (!easyMiningErrorPending) {
        firstEasyMiningErrorTime = now;
        easyMiningErrorPending = true;

        console.log(`⏰ Error detected - waiting 20 seconds to see if connection recovers...`);

        // Clear any existing timer
        if (easyMiningErrorTimer) {
            clearTimeout(easyMiningErrorTimer);
        }

        // Schedule alert to show after 20 seconds if errors persist
        easyMiningErrorTimer = setTimeout(() => {
            // Check if we're still having errors (no successful fetch in last 20 seconds)
            const timeSinceFirstError = Date.now() - firstEasyMiningErrorTime;

            if (timeSinceFirstError >= EASYMINING_ERROR_DELAY) {
                console.error(`❌ EasyMining errors persisted for 20+ seconds: ${errorMessage}`);
                lastEasyMiningErrorAlert = Date.now();
            }

            // Reset pending state
            easyMiningErrorPending = false;
            easyMiningErrorTimer = null;
        }, EASYMINING_ERROR_DELAY);
    } else {
        console.log(`⏰ Error still pending - waiting for recovery (${Math.ceil((EASYMINING_ERROR_DELAY - (now - firstEasyMiningErrorTime)) / 1000)}s remaining)`);
    }
}

// Helper function to clear error alert if connection recovers
function clearEasyMiningErrorAlert() {
    if (easyMiningErrorPending) {
        console.log(`✅ Connection recovered - cancelling pending error alert`);
        if (easyMiningErrorTimer) {
            clearTimeout(easyMiningErrorTimer);
            easyMiningErrorTimer = null;
        }
        easyMiningErrorPending = false;
        firstEasyMiningErrorTime = 0;
    }
}

// =============================================================================
// EASYMINING SETTINGS MODAL FUNCTIONS
// =============================================================================

// Page-based version of activateEasyMining
function activateEasyMiningFromPage() {
    // Get API credentials from page inputs
    const apiKey = document.getElementById('nicehash-api-key-page').value.trim();
    const apiSecret = document.getElementById('nicehash-api-secret-page').value.trim();
    const orgId = document.getElementById('nicehash-org-id-page').value.trim();

    // Validate credentials
    if (!apiKey || !apiSecret || !orgId) {
        alert('Please enter all API credentials to activate EasyMining.');
        return;
    }

    // Save API credentials
    easyMiningSettings.apiKey = apiKey;
    easyMiningSettings.apiSecret = apiSecret;
    easyMiningSettings.orgId = orgId;
    easyMiningSettings.enabled = true;

    // Save toggle settings
    easyMiningSettings.autoUpdateHoldings = document.getElementById('auto-update-holdings-toggle-page').checked;
    easyMiningSettings.includeAvailableBTC = document.getElementById('include-available-btc-toggle-page').checked;
    easyMiningSettings.includePendingBTC = document.getElementById('include-pending-btc-toggle-page').checked;
    easyMiningSettings.autoBuyCooldown = document.getElementById('auto-buy-cooldown-toggle-page').checked;
    easyMiningSettings.autoClearTeamShares = document.getElementById('auto-clear-team-shares-toggle-page').checked;
    easyMiningSettings.autoBuyTgSafeHold = document.getElementById('auto-buy-tg-safe-hold-toggle-page').checked;

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_easyMiningSettings`, JSON.stringify(easyMiningSettings));

    console.log('EasyMining activated with credentials (from page)');

    // Reset first load flag to show loading bar on next data fetch
    isFirstEasyMiningLoad = true;

    // Update BTC holdings display with new settings
    updateBTCHoldings();

    // Start polling (section will be shown automatically after loading bar completes)
    startEasyMiningPolling();

    // Start missed rewards check
    startMissedRewardsCheck();

    // Go back to app page
    showAppPage();
    alert('✅ EasyMining activated successfully!\n\nThe EasyMining section will appear after loading completes.');
}

function clearAPICredentials() {
    if (!confirm('Are you sure you want to clear all API credentials?\n\nThis will disable EasyMining and remove your API keys.')) {
        return;
    }
    
    // Clear input fields (page version)
    document.getElementById('nicehash-api-key-page').value = '';
    document.getElementById('nicehash-api-secret-page').value = '';
    document.getElementById('nicehash-org-id-page').value = '';
    
    // Reset settings
    easyMiningSettings.apiKey = '';
    easyMiningSettings.apiSecret = '';
    easyMiningSettings.orgId = '';
    easyMiningSettings.enabled = false;
    
    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_easyMiningSettings`, JSON.stringify(easyMiningSettings));

    // Reset first load flag so loading bar shows if user re-activates
    isFirstEasyMiningLoad = true;

    // Stop polling and hide section
    stopEasyMiningPolling();
    stopMissedRewardsCheck();
    document.getElementById('easymining-section').style.display = 'none';

    console.log('API credentials cleared');
    showModal('API credentials cleared successfully.\n\nEasyMining has been disabled.');
}

// Make functions globally accessible
window.activateEasyMining = activateEasyMiningFromPage;  // Fixed: point to page version
window.clearAPICredentials = clearAPICredentials;

// =============================================================================
// COINGECKO API SETTINGS PAGE FUNCTIONS
// =============================================================================

function showCoinGeckoApiSettingsPage() {
    console.log('Showing CoinGecko API Settings Page');

    // Stop polling when leaving app page
    stopBuyPackagesPolling();
    stopEasyMiningAlertsPolling();

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';

    // Show CoinGecko API settings page
    document.getElementById('coingecko-settings-page').style.display = 'block';

    // Load saved API keys
    const savedKeys = loadUserApiKeys();

    // Populate form fields with saved keys (if any)
    document.getElementById('primary-api-key-page').value = savedKeys[0] || '';
    document.getElementById('fallback-api-key-1-page').value = savedKeys[1] || '';
    document.getElementById('fallback-api-key-2-page').value = savedKeys[2] || '';
}

function activateCoinGeckoApi() {
    // Get API keys from page inputs
    const primaryKey = document.getElementById('primary-api-key-page').value.trim();
    const fallbackKey1 = document.getElementById('fallback-api-key-1-page').value.trim();
    const fallbackKey2 = document.getElementById('fallback-api-key-2-page').value.trim();

    // Validate that at least primary key is entered
    if (!primaryKey) {
        alert('❌ Primary API key is required!\n\nPlease enter at least one CoinGecko API key to continue.');
        return;
    }

    // Build array of keys (only include non-empty keys)
    const userKeys = [primaryKey];
    if (fallbackKey1) userKeys.push(fallbackKey1);
    if (fallbackKey2) userKeys.push(fallbackKey2);

    // Save to localStorage
    try {
        localStorage.setItem(`${loggedInUser}_coinGeckoApiKeys`, JSON.stringify(userKeys));
        console.log('✅ Saved CoinGecko API keys:', userKeys.length, 'keys');

        // Set success message to show after reload
        setStorageItem('modalMessage', '✅ CoinGecko API keys activated successfully!\n\n' + userKeys.length + ' key(s) configured.');

        // Reload page to properly initialize app with new keys
        console.log('🔄 Reloading page to initialize app with new API keys...');
        location.reload();
    } catch (error) {
        console.error('❌ Error saving CoinGecko API keys:', error);
        alert('❌ Error saving API keys. Please try again.');
    }
}

function clearCoinGeckoApiKeys() {
    if (!confirm('Are you sure you want to clear all CoinGecko API keys?\n\nThis will prevent the app from fetching price data until you enter new keys.')) {
        return;
    }

    // Clear input fields
    document.getElementById('primary-api-key-page').value = '';
    document.getElementById('fallback-api-key-1-page').value = '';
    document.getElementById('fallback-api-key-2-page').value = '';

    // Remove from localStorage
    localStorage.removeItem(`${loggedInUser}_coinGeckoApiKeys`);

    // Clear global apiKeys array (app will not work without keys)
    apiKeys = [];
    currentApiKeyIndex = 0;

    console.log('✅ CoinGecko API keys cleared');
    alert('✅ CoinGecko API keys cleared successfully.\n\nYou must enter new keys to use the app.');
}

function loadUserApiKeys() {
    try {
        // Try to load user's custom API keys
        const savedKeys = localStorage.getItem(`${loggedInUser}_coinGeckoApiKeys`);

        if (savedKeys) {
            const userKeys = JSON.parse(savedKeys);
            if (Array.isArray(userKeys) && userKeys.length > 0) {
                console.log('✅ Loaded user CoinGecko API keys:', userKeys.length, 'keys');
                return userKeys;
            }
        }

        // If no user keys found, return empty array (user must configure)
        console.log('⚠️ No CoinGecko API keys configured');
        return [];
    } catch (error) {
        console.error('❌ Error loading CoinGecko API keys:', error);
        return [];
    }
}

// Make functions globally accessible
window.showCoinGeckoApiSettingsPage = showCoinGeckoApiSettingsPage;
window.activateCoinGeckoApi = activateCoinGeckoApi;
window.clearCoinGeckoApiKeys = clearCoinGeckoApiKeys;

// =============================================================================
// EASYMINING UI TOGGLE FUNCTIONS
// =============================================================================

function toggleEasyMining() {
    const content = document.getElementById('easymining-content');
    const arrow = document.getElementById('easymining-arrow');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        arrow.classList.add('rotated');
    } else {
        content.style.display = 'none';
        arrow.classList.remove('rotated');
    }
}

// DESKTOP: Navigate to next page of packages
function nextPackagePage() {
    const filtered = getFilteredPackages(); // Get current filtered packages
    const totalPages = Math.ceil(filtered.length / packagesPerPage);

    if (currentPackagePage < totalPages) {
        currentPackagePage++;
        displayActivePackages();
    }
}

// DESKTOP: Navigate to previous page of packages
function prevPackagePage() {
    if (currentPackagePage > 1) {
        currentPackagePage--;
        displayActivePackages();
    }
}

// Helper function to get currently filtered packages
function getFilteredPackages() {
    // Use the same data source as displayActivePackages()
    if (!easyMiningData || !easyMiningData.activePackages) {
        return [];
    }

    let filteredPackages = [];
    if (currentPackageTab === 'active') {
        filteredPackages = easyMiningData.activePackages.filter(pkg => pkg.active === true);
    } else if (currentPackageTab === 'completed') {
        filteredPackages = easyMiningData.activePackages.filter(pkg => pkg.active === false);
    } else if (currentPackageTab === 'rewards') {
        filteredPackages = easyMiningData.activePackages.filter(pkg => pkg.blockFound === true);
    }

    return filteredPackages;
}

function clearRockets() {
    easyMiningData.blocksFoundSession = 0;
    document.getElementById('blocks-found-rockets').textContent = '';
    localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));
}

function restoreRockets() {
    // Restore rocket display from localStorage
    if (easyMiningData.blocksFoundSession > 0) {
        // Create individual span elements for each rocket to enable proper flex-wrap
        const rocketsHtml = Array(easyMiningData.blocksFoundSession)
            .fill('🚀')
            .map(rocket => `<span>${rocket}</span>`)
            .join('');
        const rocketsElement = document.getElementById('blocks-found-rockets');
        if (rocketsElement) {
            rocketsElement.innerHTML = rocketsHtml;
        }
    }
}

// Make UI functions globally accessible
window.toggleEasyMining = toggleEasyMining;
window.nextPackagePage = nextPackagePage;
window.prevPackagePage = prevPackagePage;
window.clearRockets = clearRockets;

// =============================================================================
// EASYMINING DATA FETCHING
// =============================================================================

// =============================================================================
// EASYMINING LOADING BAR FUNCTIONS
// =============================================================================

// Track if this is the first data load
let isFirstEasyMiningLoad = true;
let loadingProgressInterval = null;
let currentProgress = 0;
let targetProgress = 0;
let isFetchingEasyMiningData = false; // Prevent overlapping fetches
let isProcessingRewards = false; // Prevent duplicate reward additions from concurrent calls

function showEasyMiningLoadingBar() {
    const loadingBar = document.getElementById('easymining-loading-bar');
    const section = document.getElementById('easymining-section');

    if (loadingBar && section) {
        loadingBar.style.display = 'block';
        section.style.display = 'none';
        currentProgress = 0;
        targetProgress = 0;
        console.log('🔄 Showing EasyMining loading bar');
    }
}

function hideEasyMiningLoadingBar() {
    const loadingBar = document.getElementById('easymining-loading-bar');
    const section = document.getElementById('easymining-section');

    // Stop progress animation
    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }

    if (loadingBar && section) {
        // Hide loading bar and show section FIRST (prevents visual glitch)
        loadingBar.style.display = 'none';
        section.style.display = 'block';

        // Mark as no longer first load
        isFirstEasyMiningLoad = false;

        // Reset progress variables to 0 (for next time it's shown)
        currentProgress = 0;
        targetProgress = 0;

        console.log('✅ Hiding EasyMining loading bar, showing section');
    }
}

function updateEasyMiningLoadingProgress(percentage) {
    const progressBar = document.getElementById('easymining-loading-progress');
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
        currentProgress = percentage;
    }
}

// Smooth progress animator - gradually fills bar instead of jumping
function setEasyMiningLoadingTarget(target) {
    targetProgress = target;

    // Start smooth animation if not already running
    if (!loadingProgressInterval && isFirstEasyMiningLoad) {
        loadingProgressInterval = setInterval(() => {
            // Check if we've reached 100% first (outside the progress condition)
            if (currentProgress >= 100) {
                console.log('📊 Loading reached 100%, hiding loading bar');
                hideEasyMiningLoadingBar();
                return; // Exit the interval callback
            }

            // If we haven't reached the target yet, increment progress
            if (currentProgress < targetProgress) {
                // Gradually increase progress (1% every 50ms = smooth fill)
                currentProgress += 1;
                if (currentProgress > targetProgress) {
                    currentProgress = targetProgress;
                }
                updateEasyMiningLoadingProgress(currentProgress);
            }
        }, 50); // Update every 50ms for smooth animation
    }
}

// =============================================================================
// EASYMINING DATA FETCHING
// =============================================================================

async function fetchEasyMiningData() {
    // Only log every 12th poll (once per minute at 5s intervals) to reduce console spam
    if (Math.random() < 0.08) {
        console.log(`⚡ EasyMining poll - Enabled: ${easyMiningSettings.enabled}`);
    }

    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        return;
    }

    // Clean up old auto-bought package entries (run occasionally, not every poll)
    if (Math.random() < 0.01) {  // ~1% chance per poll (~every 8 minutes at 5s intervals)
        cleanupAutoBoughtPackages();
    }

    // Prevent overlapping fetches (5-second polling vs longer API calls)
    if (isFetchingEasyMiningData) {
        console.log('⏭️ Skipping fetch - previous fetch still in progress');
        return;
    }

    // Mark fetch as in progress
    isFetchingEasyMiningData = true;

    // Show loading bar only on first load
    if (isFirstEasyMiningLoad) {
        showEasyMiningLoadingBar();
        setEasyMiningLoadingTarget(10); // Start with smooth progress to 10%
    }

    try {
        // Check if we have API credentials
        const hasCredentials = easyMiningSettings.apiKey &&
                              easyMiningSettings.apiSecret &&
                              easyMiningSettings.orgId;

        if (hasCredentials) {
            console.log('Attempting to fetch live data from NiceHash API...');

            // Validate credentials are present
            if (!validateNiceHashCredentials()) {
                console.error('❌ NiceHash API credentials missing');
                throw new Error('Missing credentials');
            }

            // Sync time with NiceHash server first
            if (isFirstEasyMiningLoad) setEasyMiningLoadingTarget(30); // Continue to 30%
            await syncNiceHashTime();
            if (isFirstEasyMiningLoad) setEasyMiningLoadingTarget(40); // Move to 40% after sync

            // Try to fetch real data, but use mock data as fallback if CORS fails
            let balances = { available: 0, pending: 0 };
            let orders = [];

            try {
                // Attempt real API calls
                if (isFirstEasyMiningLoad) setEasyMiningLoadingTarget(60); // Progress to 60%
                balances = await fetchNiceHashBalances();
                if (isFirstEasyMiningLoad) setEasyMiningLoadingTarget(75); // Move to 75% after balances

                orders = await fetchNiceHashOrders();
                if (isFirstEasyMiningLoad) setEasyMiningLoadingTarget(90); // Move to 90% after orders

                // If we got here, API calls succeeded
                easyMiningData.availableBTC = balances.available.toFixed(8);
                easyMiningData.pendingBTC = balances.pending.toFixed(8);
                easyMiningData.activePackages = orders;

                console.log('✅ Live data fetched successfully from NiceHash API');
                console.log(`Available BTC: ${easyMiningData.availableBTC}`);
                console.log(`Pending BTC: ${easyMiningData.pendingBTC}`);
                console.log(`Active Packages: ${easyMiningData.activePackages.length}`);

                // Log block detection data for each package
                console.log('\n📦 PACKAGE BLOCK DETECTION DATA:');
                easyMiningData.activePackages.forEach((pkg, index) => {
                    console.log(`  ${index + 1}. ${pkg.name}:`);
                    console.log(`     - blockFound: ${pkg.blockFound}`);
                    console.log(`     - totalBlocks: ${pkg.totalBlocks || 0} (confirmed: ${pkg.confirmedBlocks || 0}, pending: ${pkg.pendingBlocks || 0})`);
                    console.log(`     - btcEarnings: ${pkg.btcEarnings || 0} BTC`);
                    console.log(`     - active: ${pkg.active}`);
                });

            } catch (apiError) {
                // Handle different types of API errors
                if (apiError.message.includes('fetch')) {
                    // ✅ REMOVED MOCK DATA - No fallback, just log the error
                    console.error('❌ Network error - unable to fetch EasyMining data');
                    console.error('📝 This may be due to CORS, network issues, or API being down');
                    console.error('💡 Data will remain empty until connection is restored');

                    // Don't set any data - let it remain empty/previous values
                    // This prevents false balances from appearing during reconnects
                    throw apiError; // Re-throw to trigger error handling below
                } else if (apiError.message.includes('401')) {
                    // 401 Authentication Error - provide specific guidance
                    console.error('❌ 401 Authentication Error - API credentials rejected by NiceHash');
                    console.error('📝 Common causes:');
                    console.error('  1. Credentials are not in UUID format (must have dashes)');
                    console.error('  2. API Key, API Secret, or Org ID is incorrect');
                    console.error('  3. API Key lacks necessary permissions in NiceHash');
                    console.error('  4. API Key has been revoked or expired');
                    console.error('');
                    console.error('🔧 Next steps:');
                    console.error('  1. Check console above for credential validation results');
                    console.error('  2. Verify credentials in NiceHash Settings → API Keys');
                    console.error('  3. Create new API key if needed with Read/Write permissions');
                    console.error('  4. Re-enter credentials in EasyMining Settings');
                    throw apiError;
                } else {
                    // Other API errors
                    throw apiError;
                }
            }
        } else {
            console.warn('API credentials incomplete, using fallback data');
            // Load package holdings from storage (persist user's packages)
            // But do NOT load live balances - they should show 0 until real API data arrives
            const storedData = JSON.parse(getStorageItem(`${loggedInUser}_easyMiningData`)) || {};

            // Keep balances at 0 (no credentials = no live balance data)
            easyMiningData.availableBTC = '0.00000000';
            easyMiningData.pendingBTC = '0.00000000';

            // Preserve package holdings and stats from storage
            easyMiningData.activePackages = storedData.activePackages || [];
            easyMiningData.allTimeStats = storedData.allTimeStats || easyMiningData.allTimeStats;
            easyMiningData.todayStats = storedData.todayStats || easyMiningData.todayStats;
            easyMiningData.blocksFoundSession = storedData.blocksFoundSession || 0;
            easyMiningData.lastBlockCount = storedData.lastBlockCount || 0;

            console.log(`📦 Loaded stored package data (${easyMiningData.activePackages.length} packages). Live balances showing 0 until API connected.`);
        }

        // Save easyMiningData to localStorage to persist balances
        setStorageItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));
        console.log(`💾 Saved EasyMining data to localStorage`);

        // Fetch public package data from NiceHash
        await fetchPublicPackageData();

        // Update UI
        updateEasyMiningUI();

        // Check for new blocks found
        checkForNewBlocks();

        // Check for package status changes (start/complete)
        checkForPackageStatusChanges();

        // ✅ Auto-add crypto boxes for active packages (ensures live prices are used)
        await autoAddCryptoBoxesForActivePackages();

        // Update BTC holdings if toggles are enabled
        updateBTCHoldings();

        // Complete loading (only on first load)
        // Loading bar will automatically hide when it reaches 100%
        if (isFirstEasyMiningLoad) {
            setEasyMiningLoadingTarget(100);
        }

        // Clear any pending error alerts since fetch succeeded
        clearEasyMiningErrorAlert();

    } catch (error) {
        console.error('Error fetching EasyMining data:', error);

        // Hide loading bar on error (if first load)
        if (isFirstEasyMiningLoad) {
            hideEasyMiningLoadingBar();
        }

        // Don't alert for CORS errors as we're handling them gracefully
        // Schedule delayed error alert instead of immediate alert
        if (!error.message.includes('fetch')) {
            let errorMessage;

            if (error.message.includes('401')) {
                // Specific message for authentication errors
                errorMessage = '❌ API Error 401 - Authentication Failed\n\n' +
                      'NiceHash rejected your API credentials.\n\n' +
                      '✅ Quick Fixes:\n' +
                      '1. Check credentials have dashes (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)\n' +
                      '2. Verify you copied them correctly from NiceHash\n' +
                      '3. Check API key has Read/Write permissions\n' +
                      '4. Create fresh API key if expired\n\n' +
                      '📝 Check browser console (F12) for detailed troubleshooting info.\n' +
                      '📖 See NICEHASH_401_FIX.md for full guide.';
            } else if (error.message.includes('Missing credentials')) {
                // This is already handled by the validation function alert
                // Don't schedule delayed alert
                errorMessage = null;
            } else {
                // Generic error message for other issues
                errorMessage = `Error fetching EasyMining data: ${error.message}\n\nPlease check your API credentials and network connection.`;
            }

            // Schedule delayed alert (waits 20s to see if connection recovers)
            if (errorMessage) {
                scheduleEasyMiningErrorAlert(errorMessage);
            }
        }
    } finally {
        // Always mark fetch as complete (allows next polling cycle to run)
        isFetchingEasyMiningData = false;
        console.log('✅ Fetch cycle complete - ready for next poll');
    }
}

// Fetch public package information from NiceHash
async function fetchPublicPackageData() {
    try {
        // NiceHash public API endpoint for available packages
        // This data is publicly available and doesn't require authentication
        
        // TODO: Implement actual public API call
        // const response = await fetch('https://api2.nicehash.com/main/api/v2/public/simplemultialgo/info');
        // const data = await response.json();
        // Process and merge with user's active packages
        
        console.log('Public package data would be fetched here');
    } catch (error) {
        console.error('Error fetching public package data:', error);
    }
}

// Validate NiceHash API credentials format
function validateNiceHashCredentials() {
    console.log('🔍 Checking NiceHash Credentials...');
    console.log('API Key:', easyMiningSettings.apiKey ? `✓ Present (${easyMiningSettings.apiKey.length} chars)` : '✗ Missing');
    console.log('API Secret:', easyMiningSettings.apiSecret ? `✓ Present (${easyMiningSettings.apiSecret.length} chars)` : '✗ Missing');
    console.log('Org ID:', easyMiningSettings.orgId ? `✓ Present (${easyMiningSettings.orgId.length} chars)` : '✗ Missing');

    // Simple validation - just check that all fields are filled
    if (!easyMiningSettings.apiKey || !easyMiningSettings.apiSecret || !easyMiningSettings.orgId) {
        console.error('❌ One or more credentials are missing');
        console.error('Please enter all three credentials: API Key, API Secret, and Organization ID');
        return false;
    }

    // Check for common issues like extra whitespace (should be trimmed already, but double-check)
    if (easyMiningSettings.apiKey.trim() !== easyMiningSettings.apiKey ||
        easyMiningSettings.apiSecret.trim() !== easyMiningSettings.apiSecret ||
        easyMiningSettings.orgId.trim() !== easyMiningSettings.orgId) {
        console.warn('⚠️  Credentials contain extra whitespace - this should have been trimmed');
    }

    console.log('✅ All credentials present - will test with NiceHash API');
    return true;
}

// Cached server time offset
let nicehashTimeOffset = 0;

// Sync time with NiceHash server
async function syncNiceHashTime() {
    try {
        // NiceHash public time endpoint (no authentication required)
        const endpoint = '/api/v2/time';
        const url = USE_VERCEL_PROXY
            ? VERCEL_PROXY_ENDPOINT
            : `https://api2.nicehash.com${endpoint}`;

        const response = USE_VERCEL_PROXY
            ? await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint, method: 'GET', headers: {} })
              })
            : await fetch(url);

        if (!response.ok) {
            throw new Error(`Time sync failed: ${response.status}`);
        }

        const data = await response.json();
        console.log('⏰ Time sync response:', data);

        // Get server time from response (in milliseconds)
        const serverTime = data.serverTime || data.time || Date.now();
        const localTime = Date.now();
        nicehashTimeOffset = serverTime - localTime;

        console.log('⏰ Time sync complete:', {
            serverTime,
            localTime,
            offset: nicehashTimeOffset + 'ms',
            syncedTime: serverTime
        });

        // Warn if offset is too large (>5 seconds)
        if (Math.abs(nicehashTimeOffset) > 5000) {
            console.warn(`⚠️ Large time offset detected: ${nicehashTimeOffset}ms`);
            console.warn('⚠️ Your system clock may be incorrect. This could cause authentication failures.');
        }
    } catch (error) {
        console.warn('⚠️ Time sync failed, using local time:', error.message);
        console.warn('⚠️ Authentication may fail if your system clock is not accurate');
        nicehashTimeOffset = 0; // Use local time
    }
}

// Generate authentication headers for NiceHash API
function generateNiceHashAuthHeaders(method, endpoint, body = null) {
    // NiceHash requires specific authentication headers:
    // X-Auth, X-Time, X-Nonce, X-Request-Id, X-Organization-Id

    // Use server-synchronized time
    const timestamp = (Date.now() + nicehashTimeOffset).toString();
    const nonce = crypto.randomUUID();

    // Parse endpoint to separate path and query string
    const [path, queryString] = endpoint.includes('?') ? endpoint.split('?') : [endpoint, ''];

    // Prepare body string for signature
    // For GET requests: empty string
    // For POST requests: stringified JSON (if body is object) or the body as-is
    let bodyString = '';
    if (body) {
        bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    }

    // Create signature using HMAC-SHA256
    // NiceHash CORRECT format (from official docs):
    // APIKey\0XTime\0XNonce\0\0OrganizationID\0\0HTTPMethod\0Path\0QueryString\0Body
    // NOTE: API Key comes FIRST, then timestamp!

    // Build message in CORRECT order with proper null byte separators
    // Format: apiKey + \0 + time + \0 + nonce + \0 + \0 + orgId + \0 + \0 + method + \0 + path + \0 + query
    let message = easyMiningSettings.apiKey + '\x00' +
                  timestamp + '\x00' +
                  nonce + '\x00' +
                  '\x00' +
                  easyMiningSettings.orgId + '\x00' +
                  '\x00' +
                  method + '\x00' +
                  path + '\x00' +
                  queryString;

    // For POST/PUT requests with body, add body after another null separator
    if (bodyString) {
        message += '\x00' + bodyString;
    }

    // Generate HMAC-SHA256 signature
    // CRITICAL: API Secret must be used as UTF-8 string (as-is, with dashes)
    // Based on official NiceHash Python client: hmac.new(bytearray(self.secret, 'utf-8'), message, sha256)
    const signature = CryptoJS.HmacSHA256(message, easyMiningSettings.apiSecret).toString(CryptoJS.enc.Hex);

    console.log('🔐 Auth Debug:');
    console.log('API Key:', easyMiningSettings.apiKey.substring(0, 8) + '...');
    console.log('API Secret (first 8 chars):', easyMiningSettings.apiSecret.substring(0, 8) + '...');
    console.log('Org ID:', easyMiningSettings.orgId);
    console.log('Timestamp:', timestamp);
    console.log('Nonce:', nonce);
    console.log('Method:', method);
    console.log('Path:', path);
    console.log('Query:', queryString || '(empty)');
    console.log('Body:', bodyString || '(empty)');
    console.log('');
    console.log('📝 Message to sign (with \\0 shown as |):');
    console.log(message.replace(/\x00/g, '|'));
    console.log('');
    console.log('Signature:', signature.substring(0, 16) + '...');
    console.log('Signature (full):', signature);

    // NiceHash API v2 requires specific header names (case-sensitive)
    // X-Auth header format: "apiKey:signature"
    const authHeader = `${easyMiningSettings.apiKey}:${signature}`;

    console.log('📤 Headers being sent:');
    console.log('  X-Time:', timestamp);
    console.log('  X-Nonce:', nonce);
    console.log('  X-Request-Id:', nonce);
    console.log('  X-Organization-Id:', easyMiningSettings.orgId);
    console.log('  X-Auth:', authHeader.substring(0, 50) + '...');

    // According to official Python client: Content-Type is ALWAYS application/json
    return {
        'X-Time': timestamp,
        'X-Nonce': nonce,
        'X-Auth': authHeader,
        'X-Organization-Id': easyMiningSettings.orgId,
        'X-Request-Id': nonce,
        'Content-Type': 'application/json'
    };
}

// Fetch balances from NiceHash API
// Fetch mining payments/earnings for a currency (includes solo mining blocks)
async function fetchMiningPayments(currency) {
    try {
        const timestamp = Date.now();
        const endpoint = `/main/api/v2/accounting/hashpowerEarnings/${currency}?timestamp=${timestamp}&page=0&size=100`;
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        console.log(`⛏️ Fetching mining payments for ${currency}...`);

        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: headers
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers: headers
            });
        }

        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch ${currency} mining payments: ${response.status}`);
            return null;
        }

        const data = await response.json();
        console.log(`✅ ${currency} mining payments response:`, JSON.stringify(data, null, 2));

        return data;
    } catch (error) {
        console.error(`❌ Error fetching ${currency} mining payments:`, error);
        return null;
    }
}

// Fetch balance for specific currency with extended response for solo rewards
async function fetchCurrencyBalanceExtended(currency) {
    try {
        const endpoint = `/main/api/v2/accounting/account2/${currency}?extendedResponse=true`;
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        console.log(`💰 Fetching extended balance for ${currency}...`);

        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: headers
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers: headers
            });
        }

        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch ${currency} balance: ${response.status}`);
            return null;
        }

        const data = await response.json();
        console.log(`✅ ${currency} balance with extended response:`, JSON.stringify(data, null, 2));

        // Check for solo rewards in pendingDetails
        if (data.pendingDetails) {
            console.log(`🎁 ${currency} pendingDetails:`, {
                solo: data.pendingDetails.solo,
                soloRewards: data.pendingDetails.soloRewards
            });
        }

        return data;
    } catch (error) {
        console.error(`❌ Error fetching ${currency} balance:`, error);
        return null;
    }
}

async function fetchNiceHashBalances() {
    try {
        const endpoint = '/main/api/v2/accounting/accounts2';
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        console.log('📡 Fetching balances from NiceHash...');

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel serverless function as proxy
            console.log('✅ Using Vercel proxy:', VERCEL_PROXY_ENDPOINT);
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: headers
                })
            });
        } else {
            // Direct call to NiceHash (will fallback to mock data if CORS fails)
            console.log('Endpoint:', `https://api2.nicehash.com${endpoint}`);
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers: headers
            });
        }

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Balance API Response:', data);

        // Parse BTC balances from response
        // NiceHash API structure: { total: {...}, currencies: [{currency, available, pending, ...}] }
        let available = 0;
        let pending = 0;

        // Try to get from total first
        if (data && data.total && data.total.currency === 'BTC') {
            available = parseFloat(data.total.available || 0);
            pending = parseFloat(data.total.pending || 0);
            console.log('✅ Got balances from total:', { available, pending });
        }
        // Fallback to currencies array
        else if (data && data.currencies) {
            const btcAccount = data.currencies.find(c => c.currency === 'BTC');
            if (btcAccount) {
                available = parseFloat(btcAccount.available || 0);
                pending = parseFloat(btcAccount.pending || 0);
                console.log('✅ Got balances from currencies:', { available, pending });
            }
        }

        return { available, pending };
    } catch (error) {
        console.error('❌ Error fetching NiceHash balances:', error);
        // Re-throw the error so the parent function can handle CORS fallback
        throw error;
    }
}

// Convert BTC to AUD
function convertBTCtoAUD(btcAmount) {
    // Get current BTC price in AUD from the page
    const btcPriceElement = document.getElementById('bitcoin-price-aud');
    if (!btcPriceElement) return btcAmount * 100000; // Fallback estimate

    const btcPriceAUD = parseFloat(btcPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 100000;
    return btcAmount * btcPriceAUD;
}

// Convert any cryptocurrency amount to AUD
function convertCryptoToAUD(cryptoAmount, cryptoSymbol) {
    if (!cryptoAmount || cryptoAmount === 0) return 0;

    // Map common crypto symbols to their CoinGecko IDs
    const cryptoIdMap = {
        'BTC': 'bitcoin',
        'BCH': 'bitcoin-cash',
        'RVN': 'ravencoin',
        'DOGE': 'dogecoin',
        'LTC': 'litecoin',
        'KAS': 'kaspa',
        'ETH': 'ethereum',
        'ETC': 'ethereum-classic'
    };

    const cryptoId = cryptoIdMap[cryptoSymbol?.toUpperCase()] || cryptoSymbol?.toLowerCase();
    if (!cryptoId) return 0;

    // Get crypto price from the page (if it's in the user's portfolio)
    const priceElement = document.getElementById(`${cryptoId}-price-aud`);
    if (priceElement) {
        const priceAUD = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
        return cryptoAmount * priceAUD;
    }

    // Fallback: Use approximate prices if not in portfolio
    const fallbackPrices = {
        'bitcoin': 100000,
        'bitcoin-cash': 500,
        'ravencoin': 0.03,
        'dogecoin': 0.15,
        'litecoin': 100,
        'kaspa': 0.15
    };

    const fallbackPrice = fallbackPrices[cryptoId] || 0;
    return cryptoAmount * fallbackPrice;
}


// Get block reward for a cryptocurrency
function getBlockReward(crypto) {
    const blockRewards = {
        'BTC': 3.125,      // Bitcoin (after April 2024 halving)
        'BCH': 3.125,      // Bitcoin Cash (same halving schedule as BTC)
        'RVN': 2500,       // Ravencoin (after 2022 halving)
        'DOGE': 10000,     // Dogecoin (fixed)
        'LTC': 6.25,       // Litecoin (after August 2023 halving)
        'KAS': 3.8890873,  // Kaspa (current block reward)
        'ETH': 2,          // Ethereum (after merge, for reference)
        'ETC': 2.56        // Ethereum Classic
    };

    return blockRewards[crypto] || 0;
}

// Get algorithm information including crypto and name
function getAlgorithmInfo(algorithmId, pool) {
    // NiceHash uses string identifiers for algorithms
    const algoMap = {
        // SHA256 variants
        'SHA256ASICBOOST': { name: 'SHA256AsicBoost', crypto: 'BCH', cryptoSecondary: null }, // Bitcoin Cash (Silver packages)
        'SHA256': { name: 'SHA256', crypto: 'BTC', cryptoSecondary: null }, // Bitcoin (Gold packages)

        // Scrypt variants (Litecoin, Dogecoin)
        'SCRYPT': { name: 'Scrypt', crypto: 'LTC', cryptoSecondary: null },
        'SCRYPTNF': { name: 'Scrypt-N', crypto: 'LTC', cryptoSecondary: null },

        // Other algorithms
        'X11': { name: 'X11', crypto: 'DASH', cryptoSecondary: null },
        'X13': { name: 'X13', crypto: 'XVG', cryptoSecondary: null },
        'KECCAK': { name: 'Keccak', crypto: 'MONA', cryptoSecondary: null },
        'X15': { name: 'X15', crypto: 'HTML', cryptoSecondary: null },
        'NIST5': { name: 'Nist5', crypto: 'XMY', cryptoSecondary: null },
        'NEOSCRYPT': { name: 'NeoScrypt', crypto: 'FTC', cryptoSecondary: null },
        'LYRA2RE': { name: 'Lyra2RE', crypto: 'VTC', cryptoSecondary: null },
        'WHIRLPOOLX': { name: 'WhirlpoolX', crypto: 'VNL', cryptoSecondary: null },
        'QUBIT': { name: 'Qubit', crypto: 'DGB', cryptoSecondary: null },
        'QUARK': { name: 'Quark', crypto: 'QRK', cryptoSecondary: null },
        'AXIOM': { name: 'Axiom', crypto: 'AXIOM', cryptoSecondary: null },
        'LYRA2REV2': { name: 'Lyra2REv2', crypto: 'MONA', cryptoSecondary: null },
        'SCRYPTJANENF16': { name: 'ScryptJaneNF16', crypto: 'DIA', cryptoSecondary: null },
        'BLAKE256R8': { name: 'Blake256r8', crypto: 'BLC', cryptoSecondary: null },
        'BLAKE256R14': { name: 'Blake256r14', crypto: 'DCR', cryptoSecondary: null },
        'BLAKE256R8VNL': { name: 'Blake256r8vnl', crypto: 'VNL', cryptoSecondary: null },
        'HODL': { name: 'Hodl', crypto: 'HODL', cryptoSecondary: null },
        'DAGGERHASHIMOTO': { name: 'DaggerHashimoto', crypto: 'ETH', cryptoSecondary: null },
        'DECRED': { name: 'Decred', crypto: 'DCR', cryptoSecondary: null },
        'CRYPTONIGHT': { name: 'CryptoNight', crypto: 'XMR', cryptoSecondary: null },
        'LBRY': { name: 'Lbry', crypto: 'LBC', cryptoSecondary: null },
        'EQUIHASH': { name: 'Equihash', crypto: 'ZEC', cryptoSecondary: null },
        'PASCAL': { name: 'Pascal', crypto: 'PASC', cryptoSecondary: null },
        'X11GOST': { name: 'X11Gost', crypto: 'SIB', cryptoSecondary: null },
        'SIA': { name: 'Sia', crypto: 'SC', cryptoSecondary: null },
        'BLAKE2S': { name: 'Blake2s', crypto: 'NEVA', cryptoSecondary: null },
        'SKUNK': { name: 'Skunk', crypto: 'SIGT', cryptoSecondary: null },
        'CRYPTONIGHTV7': { name: 'CryptoNightV7', crypto: 'XMR', cryptoSecondary: null },
        'CRYPTONIGHTHEAVY': { name: 'CryptoNightHeavy', crypto: 'XHV', cryptoSecondary: null },
        'LYRA2Z': { name: 'Lyra2z', crypto: 'XZC', cryptoSecondary: null },
        'X16R': { name: 'X16R', crypto: 'RVN', cryptoSecondary: null },
        'CRYPTONIGHTV8': { name: 'CryptoNightV8', crypto: 'XMR', cryptoSecondary: null },
        // SHA256ASICBOOST moved to top (line 4099) with correct BCH mapping - duplicate removed
        'ZHASH': { name: 'Zhash', crypto: 'BTG', cryptoSecondary: null },
        'BEAM': { name: 'Beam', crypto: 'BEAM', cryptoSecondary: null },
        'GRINCUCKAROO29': { name: 'GrinCuckaroo29', crypto: 'GRIN', cryptoSecondary: null },
        'GRINCUCKATOO31': { name: 'GrinCuckatoo31', crypto: 'GRIN', cryptoSecondary: null },
        'LYRA2REV3': { name: 'Lyra2REv3', crypto: 'VTC', cryptoSecondary: null },
        'CRYPTONIGHTR': { name: 'CryptoNightR', crypto: 'XMR', cryptoSecondary: null },
        'CUCKOOCYCLE': { name: 'CuckooCycle', crypto: 'AE', cryptoSecondary: null },
        'GRINCUCKAROOD29': { name: 'GrinCuckarood29', crypto: 'GRIN', cryptoSecondary: null },
        'BEAMV2': { name: 'BeamV2', crypto: 'BEAM', cryptoSecondary: null },
        'X16RV2': { name: 'X16Rv2', crypto: 'RVN', cryptoSecondary: null },
        'RANDOMXMONERO': { name: 'RandomXmonero', crypto: 'XMR', cryptoSecondary: null },
        'EAGLESONG': { name: 'Eaglesong', crypto: 'CKB', cryptoSecondary: null },
        'CUCKATOO32': { name: 'Cuckatoo32', crypto: 'GRIN', cryptoSecondary: null },
        'HANDSHAKE': { name: 'Handshake', crypto: 'HNS', cryptoSecondary: null },
        'KAWPOW': { name: 'KawPow', crypto: 'RVN', cryptoSecondary: null },
        'CUCKAROO29BFC': { name: 'Cuckaroo29BFC', crypto: 'BFC', cryptoSecondary: null },
        'BEAMV3': { name: 'BeamV3', crypto: 'BEAM', cryptoSecondary: null },
        'CUCKAROOZ29': { name: 'Cuckarooz29', crypto: 'GRIN', cryptoSecondary: null },
        'OCTOPUS': { name: 'Octopus', crypto: 'CFX', cryptoSecondary: null },
        'AUTOLYKOS': { name: 'Autolykos', crypto: 'ERG', cryptoSecondary: null },
        'KHEAVYHASH': { name: 'kHeavyHash', crypto: 'KAS', cryptoSecondary: null }
    };

    // Convert to uppercase for matching
    // Handle algorithmId as object or string
    let algoKey;
    if (typeof algorithmId === 'object' && algorithmId !== null) {
        // If algorithmId is an object, try to get the algorithm property or title
        algoKey = (algorithmId.algorithm || algorithmId.title || algorithmId.name || '').toString().toUpperCase();
    } else {
        // Normal string conversion
        algoKey = (algorithmId || '').toString().toUpperCase();
    }

    const info = algoMap[algoKey] || { name: (typeof algorithmId === 'string' ? algorithmId : algoKey), crypto: 'BTC', cryptoSecondary: null };

    // Check pool info for dual mining (Palladium packages mine DOGE+LTC)
    // IMPORTANT: For Team Palladium, DOGE is primary, LTC is secondary
    if (pool && pool.name) {
        const poolName = pool.name.toLowerCase();
        if (poolName.includes('palladium') && poolName.includes('doge')) {
            info.crypto = 'DOGE';
            info.cryptoSecondary = 'LTC';
        } else if (poolName.includes('palladium') && poolName.includes('ltc')) {
            // Even for LTC-labeled pools, set DOGE as primary for Team Palladium
            info.crypto = 'DOGE';
            info.cryptoSecondary = 'LTC';
        }
    }

    return info;
}

// Determine package name from order data
function determinePackageName(order, algoInfo) {
    // NiceHash EasyMining Package Names:
    // Gold S/M/L = SHA256 BTC mining
    // Silver S/M/L = SHA256AsicBoost BCH mining
    // Chromium S/M/L = KawPow RVN mining
    // Palladium DOGE = Scrypt DOGE+LTC dual mining
    // Palladium LTC = Scrypt LTC mining
    // Titanium S/M/L = kHeavyHash KAS mining
    // Team packages = Team Gold, Team Silver, etc.

    // Try pool name first (active packages) - this often contains the full name
    if (order.pool && order.pool.name) {
        const poolName = order.pool.name;
        const poolLower = poolName.toLowerCase();

        // Check for Team packages first
        if (poolLower.includes('team')) {
            if (poolLower.includes('gold')) return 'Team Gold';
            if (poolLower.includes('silver')) return 'Team Silver';
            if (poolLower.includes('chromium')) return 'Team Chromium';
            if (poolLower.includes('titanium')) return 'Team Titanium';
            return poolName; // Return as-is if it's a team package
        }

        // Check for size variants (S, M, L)
        let size = '';
        if (poolLower.includes(' s ') || poolLower.endsWith(' s')) size = ' S';
        else if (poolLower.includes(' m ') || poolLower.endsWith(' m')) size = ' M';
        else if (poolLower.includes(' l ') || poolLower.endsWith(' l')) size = ' L';

        // Match package types with sizes
        if (poolLower.includes('gold')) return 'Gold' + size;
        if (poolLower.includes('silver')) return 'Silver' + size;
        if (poolLower.includes('chromium')) return 'Chromium' + size;
        if (poolLower.includes('titanium')) return 'Titanium' + size;
        if (poolLower.includes('palladium') && poolLower.includes('doge')) return 'Palladium DOGE' + size;
        if (poolLower.includes('palladium') && poolLower.includes('ltc')) return 'Palladium LTC' + size;
        if (poolLower.includes('palladium')) return 'Palladium' + size;

        // Return the actual pool name if it doesn't match patterns above
        return poolName;
    }

    // Fallback for completed packages (no pool info)
    // Determine package type from algorithm + market
    const algo = order.algorithm?.toString().toUpperCase() || '';
    const market = order.market?.toString().toUpperCase() || '';

    // Map based on algorithm and crypto
    if (algo.includes('SHA256')) {
        // Check if it's BTC or BCH based on market or other indicators
        if (market.includes('BCH') || algoInfo.crypto === 'BCH') {
            return 'Silver Package'; // SHA256 BCH
        }
        return 'Gold Package'; // SHA256 BTC (default)
    }

    if (algo.includes('KAWPOW')) {
        return 'Chromium Package'; // KawPow RVN
    }

    if (algo.includes('SCRYPT')) {
        // Check if DOGE or LTC
        if (market.includes('DOGE') || algoInfo.crypto === 'DOGE') {
            return 'Palladium DOGE'; // Scrypt DOGE+LTC
        }
        return 'Palladium LTC'; // Scrypt LTC
    }

    if (algo.includes('KHEAVYHASH') || algo.includes('HEAVYHASH')) {
        return 'Titanium Package'; // kHeavyHash KAS
    }

    // Generic fallback
    const typeStr = order.type === 'TEAM' ? ' Team' : '';
    return `${algoInfo.name}${typeStr}`;
}

// Fetch rewards for a specific order
async function fetchOrderRewards(orderId) {
    console.log(`\n${'*'.repeat(80)}`);
    console.log(`🚀🚀🚀 FETCHORDERREWARDS CALLED FOR ORDER: ${orderId} 🚀🚀🚀`);
    console.log(`${'*'.repeat(80)}\n`);

    try {
        const timestamp = Date.now() + nicehashTimeOffset;
        const endpoint = `/main/api/v2/hashpower/order/${orderId}/rewards`;
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        console.log(`💰 Fetching rewards for order ${orderId}...`);

        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: headers
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers: headers
            });
        }

        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch rewards for order ${orderId}: ${response.status}`);
            return null;
        }

        const data = await response.json();

        // ============================================================================
        // REWARDS RESPONSE FOR USER TO COPY
        // ============================================================================
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🎯 REWARDS ENDPOINT RESPONSE - ORDER ID: ${orderId}`);
        console.log(`   Endpoint: GET /main/api/v2/hashpower/order/${orderId}/rewards`);
        console.log(`   Response Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
        console.log(`   Array Length: ${Array.isArray(data) ? data.length : 'N/A'}`);
        console.log(`${'='.repeat(80)}`);

        // Log the COMPLETE raw response - easy to copy
        console.log(`📋 COMPLETE RAW RESPONSE (copy this):`);
        console.log(JSON.stringify(data, null, 2));
        console.log(`${'='.repeat(80)}\n`);

        // Additional detailed breakdown if data exists
        if (Array.isArray(data) && data.length > 0) {
            console.log(`✅ [${orderId}] Found ${data.length} reward entries!`);
            data.forEach((reward, index) => {
                console.log(`\n  📦 Reward Entry #${index + 1}:`);
                console.log(`     - id: ${reward.id}`);
                console.log(`     - orderId: ${reward.orderId}`);
                console.log(`     - coin: ${reward.coin}`);
                console.log(`     - blockHeight: ${reward.blockHeight}`);
                console.log(`     - blockHash: ${reward.blockHash}`);
                console.log(`     - payoutRewardBtc: ${reward.payoutRewardBtc}`);
                console.log(`     - payoutReward: ${reward.payoutReward}`);
                console.log(`     - depositComplete: ${reward.depositComplete}`);
                console.log(`     - confirmations: ${reward.confirmations}`);
                console.log(`     - minConfirmations: ${reward.minConfirmations}`);
                console.log(`     - createdTs: ${reward.createdTs}`);
                console.log(`     - time: ${reward.time}`);
            });
        } else if (Array.isArray(data) && data.length === 0) {
            console.log(`❌ [${orderId}] Empty rewards array (no blocks found yet)`);
        } else {
            console.log(`⚠️ [${orderId}] Unexpected response format!`);
            console.log(`   Data keys:`, Object.keys(data || {}));
            if (data?.list) console.log(`   - Has 'list' property: length ${data.list.length}`);
            if (data?.rewards) console.log(`   - Has 'rewards' property: length ${data.rewards.length}`);
        }

        return data;
    } catch (error) {
        console.error(`❌ Error fetching rewards for order ${orderId}:`, error);
        return null;
    }
}

// Fetch active orders from NiceHash API
/*
 * FETCHNICEHASHORDERS - Team Package Data Mapping
 *
 * This function correctly handles Team Packages from NiceHash EasyMining API.
 *
 * KEY CHANGES:
 * 1. User identification: Uses easyMiningSettings.orgId (logged-in user) instead of order.organizationId
 * 2. Share calculation: Uses shares object (small, medium, large) from sharedTicket.members[] array
 * 3. Total shares calculation: Uses sharedTicket.addedAmount (total package cost) / 0.0001
 * 4. User's shares calculation: Uses shares object from sharedTicket.members[].shares
 * 5. Dual mining: Handles Team Palladium (DOGE/LTC) by checking rewards[] array for multiple coins
 * 6. Amount spent: Uses addedAmount from user's entry in sharedTicket.members[] array
 * 7. Display format: Shows shares as "X/Y" (integers) not decimals
 *
 * TEAM PACKAGE SHARES CALCULATION:
 * - Total Package Cost: sharedTicket.addedAmount (e.g., 0.0014 BTC)
 * - Total Shares: sharedTicket.addedAmount / 0.0001 (e.g., 14 shares)
 * - User's Contribution: members[].addedAmount (e.g., 0.0002 BTC)
 * - User's Shares: members[].shares (small + medium*10 + large*100)
 * - Share Percentage: userShares / totalShares * 100
 *
 * TEAM PACKAGE DETECTION:
 * - Check if packageName starts with "team" (case-insensitive)
 * - Special case: "Team Palladium" mines both DOGE and LTC
 *
 * DATA SOURCES:
 * - Active packages: GET /main/api/v2/hashpower/solo/order?active=true
 * - Completed packages: GET /main/api/v2/hashpower/solo/order?status=COMPLETED
 * - Packages with rewards: GET /main/api/v2/hashpower/solo/order?rewardsOnly=true
 */
async function fetchNiceHashOrders() {
    console.log(`\n${'#'.repeat(80)}`);
    console.log(`📡📡📡 FETCHNICEHASHORDERS - Using Solo Mining Endpoint 📡📡📡`);
    console.log(`${'#'.repeat(80)}\n`);

    try {
        // Fetch from TWO endpoints to get complete picture:
        // 1. Packages with rewards (blocks found) - includes active AND completed
        // 2. Active packages (may not have found blocks yet)

        console.log('📡 Fetching solo mining data from 2 endpoints...');

        // ENDPOINT 1: Packages with rewards (any that found blocks)
        const endpoint1 = `/main/api/v2/hashpower/solo/order?rewardsOnly=true&limit=5000`;
        const headers1 = generateNiceHashAuthHeaders('GET', endpoint1);

        console.log('📋 Endpoint 1 (with rewards):', endpoint1);

        let response1;
        if (USE_VERCEL_PROXY) {
            response1 = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpoint1, method: 'GET', headers: headers1 })
            });
        } else {
            response1 = await fetch(`https://api2.nicehash.com${endpoint1}`, {
                method: 'GET',
                headers: headers1
            });
        }

        if (!response1.ok) {
            throw new Error(`API Error (rewards): ${response1.status}`);
        }

        const dataWithRewards = await response1.json();
        const packagesWithRewards = Array.isArray(dataWithRewards) ? dataWithRewards : (dataWithRewards.list || []);
        console.log(`✅ Found ${packagesWithRewards.length} packages with rewards`);

        // ENDPOINT 2: Active packages (including ones without blocks)
        const endpoint2 = `/main/api/v2/hashpower/solo/order?limit=5000&active=true`;
        const headers2 = generateNiceHashAuthHeaders('GET', endpoint2);

        console.log('📋 Endpoint 2 (active):', endpoint2);

        let response2;
        if (USE_VERCEL_PROXY) {
            response2 = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpoint2, method: 'GET', headers: headers2 })
            });
        } else {
            response2 = await fetch(`https://api2.nicehash.com${endpoint2}`, {
                method: 'GET',
                headers: headers2
            });
        }

        if (!response2.ok) {
            throw new Error(`API Error (active): ${response2.status}`);
        }

        const dataActive = await response2.json();
        const activePackages = Array.isArray(dataActive) ? dataActive : (dataActive.list || []);
        console.log(`✅ Found ${activePackages.length} active packages`);

        // ENDPOINT 3: Completed packages (including ones without blocks)
        const endpoint3 = `/main/api/v2/hashpower/solo/order?limit=5000&status=COMPLETED`;
        const headers3 = generateNiceHashAuthHeaders('GET', endpoint3);

        console.log('📋 Endpoint 3 (completed):', endpoint3);

        let response3;
        if (USE_VERCEL_PROXY) {
            response3 = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: endpoint3, method: 'GET', headers: headers3 })
            });
        } else {
            response3 = await fetch(`https://api2.nicehash.com${endpoint3}`, {
                method: 'GET',
                headers: headers3
            });
        }

        if (!response3.ok) {
            throw new Error(`API Error (completed): ${response3.status}`);
        }

        const dataCompleted = await response3.json();
        const completedPackages = Array.isArray(dataCompleted) ? dataCompleted : (dataCompleted.list || []);
        console.log(`✅ Found ${completedPackages.length} completed packages`);

        // Merge all three lists, avoiding duplicates (use order ID as key)
        const orderMap = new Map();

        // Add all packages to the map
        [...packagesWithRewards, ...activePackages, ...completedPackages].forEach(order => {
            orderMap.set(order.id, order);
        });

        const orders = Array.from(orderMap.values());

        console.log(`\n${'='.repeat(80)}`);
        console.log('📦 MERGED SOLO MINING DATA');
        console.log(`${'='.repeat(80)}`);
        console.log(`📋 Total unique packages: ${orders.length}`);

        if (orders.length > 0) {
            console.log('🔍 First package sample:', {
                id: orders[0].id,
                packageName: orders[0].packageName,
                soloMiningCoin: orders[0].soloMiningCoin,
                alive: orders[0].alive,
                soloRewardCount: orders[0].soloReward?.length || 0
            });
        }

        const packages = [];
        const ordersWithBlocks = orders.filter(o => o.soloReward && o.soloReward.length > 0);
        console.log(`🎁 Packages with blocks: ${ordersWithBlocks.length}/${orders.length}\n`);

        // Process each package
        for (const order of orders) {
            console.log(`\n${'─'.repeat(80)}`);
            console.log(`📦 Processing: ${order.packageName || 'Unknown'} (${order.id.substring(0, 8)}...)`);
            console.log(`   Coin: ${order.soloMiningCoin}, Active: ${order.alive}`);

            // Log team/share related fields for debugging
            console.log(`   📊 Team/Share Data:`);
            console.log(`      type: ${JSON.stringify(order.type)}`);
            console.log(`      packagePrice: ${order.packagePrice}`);
            console.log(`      addedAmount: ${order.addedAmount}`);
            console.log(`      packageShares: ${order.packageShares}`);
            console.log(`      ownedShares: ${order.ownedShares}`);
            console.log(`      sharePrice: ${order.sharePrice}`);
            console.log(`      numberOfShares: ${order.numberOfShares}`);
            console.log(`      myShares: ${order.myShares}`);

            // Check if this is a team package - detect by name starting with "team" (case-insensitive)
            const packageName = order.packageName || '';
            const isTeamPackage = packageName.toLowerCase().startsWith('team');
            console.log(`   🔍 Team detection: "${packageName}" → isTeam: ${isTeamPackage}`);

            // Calculate block rewards from soloReward array
            // For dual mining (e.g., Palladium DOGE/LTC), track rewards by coin type
            const soloRewards = order.soloReward || [];
            let totalPackageRewardBTC = 0; // Total reward for entire package
            let totalPackageCryptoReward = 0; // Total crypto reward for primary coin
            let totalPackageSecondaryCryptoReward = 0; // Total crypto reward for secondary coin (merged mining)
            let confirmedBlockCount = 0;
            let pendingBlockCount = 0;

            // Track rewards by coin type for dual mining packages
            const rewardsByCoin = {};
            // ✅ FIX: Track block counts PER COIN for Palladium dual-mining packages
            const blockCountByCoin = {}; // Separate block counts for each coin (DOGE, LTC, etc.)

            soloRewards.forEach((reward, idx) => {
                const btcReward = parseFloat(reward.payoutRewardBtc || 0);
                const rewardCoin = reward.coin; // Actual coin from the reward (DOGE, LTC, etc.)

                // Get crypto reward amount from payoutReward (actual payout)
                let cryptoRewardAmount = 0;
                if (rewardCoin === 'BTC' && reward.payoutRewardBtc) {
                    cryptoRewardAmount = parseFloat(reward.payoutRewardBtc);
                } else if (reward.payoutReward) {
                    // Convert from smallest unit (satoshis equivalent) to full coins
                    cryptoRewardAmount = parseFloat(reward.payoutReward) / 100000000;
                }

                const isConfirmed = reward.depositComplete === true;

                if (btcReward > 0) {
                    totalPackageRewardBTC += btcReward;

                    // Track rewards by coin type
                    if (!rewardsByCoin[rewardCoin]) {
                        rewardsByCoin[rewardCoin] = 0;
                    }
                    rewardsByCoin[rewardCoin] += cryptoRewardAmount;

                    // ✅ FIX: Track block counts separately for each coin
                    if (!blockCountByCoin[rewardCoin]) {
                        blockCountByCoin[rewardCoin] = { confirmed: 0, pending: 0 };
                    }

                    if (isConfirmed) {
                        confirmedBlockCount++;
                        blockCountByCoin[rewardCoin].confirmed++;
                        console.log(`   ✅ Block #${idx + 1}: ${btcReward.toFixed(8)} BTC, ${cryptoRewardAmount} ${rewardCoin} (Confirmed)${reward.shared ? ' [SHARED]' : ''}`);
                    } else {
                        pendingBlockCount++;
                        blockCountByCoin[rewardCoin].pending++;
                        console.log(`   ⏳ Block #${idx + 1}: ${btcReward.toFixed(8)} BTC, ${cryptoRewardAmount} ${rewardCoin} (Pending ${reward.confirmations || 0}/${reward.minConfirmations || 0})${reward.shared ? ' [SHARED]' : ''}`);
                    }
                }
            });

            // Separate primary and secondary rewards
            // For Palladium packages, primary is usually DOGE, secondary is LTC
            totalPackageCryptoReward = rewardsByCoin[order.soloMiningCoin] || 0;
            totalPackageSecondaryCryptoReward = rewardsByCoin[order.soloMiningMergeCoin] || 0;

            // DUAL-MINING DETECTION LOGIC
            // For Team Palladium and other dual-mining packages, we need to detect which coins were actually won
            // Team Palladium mines both DOGE and LTC simultaneously (merged mining)
            // Check which coins were actually won by inspecting soloReward array
            const soloRewardCoins = soloRewards.map(r => r.coin);
            const hasPrimaryReward = soloRewardCoins.includes(order.soloMiningCoin);
            const hasSecondaryReward = order.soloMiningMergeCoin && soloRewardCoins.includes(order.soloMiningMergeCoin);
            const isDualMining = hasPrimaryReward && hasSecondaryReward;

            console.log(`   🔍 DUAL-MINING DETECTION:`);
            console.log(`      Package: ${packageName}`);
            console.log(`      soloReward array length: ${soloRewards.length}`);
            console.log(`      Coins in soloReward: [${soloRewardCoins.join(', ')}]`);
            console.log(`      Primary coin (${order.soloMiningCoin}): ${hasPrimaryReward ? '✅ WON' : '❌ NOT WON'}`);
            console.log(`      Secondary coin (${order.soloMiningMergeCoin}): ${hasSecondaryReward ? '✅ WON' : '❌ NOT WON'}`);
            console.log(`      isDualMining: ${isDualMining}`);
            console.log(`   💎 Rewards by coin:`, rewardsByCoin);
            console.log(`   📊 Block counts by coin:`, blockCountByCoin); // ✅ FIX: Show individual block counts
            console.log(`   💎 Primary (${order.soloMiningCoin}): ${totalPackageCryptoReward}`);
            console.log(`   💎 Secondary (${order.soloMiningMergeCoin}): ${totalPackageSecondaryCryptoReward}`);

            const totalBlocks = confirmedBlockCount + pendingBlockCount;
            const blockFound = totalBlocks > 0;

            if (blockFound) {
                console.log(`   🎉 TOTAL: ${totalBlocks} blocks, ${totalPackageRewardBTC.toFixed(8)} BTC, ${totalPackageCryptoReward} ${order.soloMiningCoin} (package total)`);
            } else {
                console.log(`   ❌ No blocks found yet`);
            }

            // Calculate crypto reward using payoutReward if available, otherwise fallback to standard
            let cryptoReward = 0;
            if (totalPackageCryptoReward > 0) {
                // Use payoutReward from API
                cryptoReward = totalPackageCryptoReward;
                console.log(`   💎 Using payoutReward: ${cryptoReward} ${order.soloMiningCoin}`);
            } else {
                // ✅ FIX: Fallback to standard block reward using INDIVIDUAL coin's block count
                const blockReward = getBlockReward(order.soloMiningCoin);
                const primaryCoinBlocks = blockCountByCoin[order.soloMiningCoin];
                const primaryBlockCount = primaryCoinBlocks ? (primaryCoinBlocks.confirmed + primaryCoinBlocks.pending) : 0;
                cryptoReward = primaryBlockCount > 0 ? blockReward * primaryBlockCount : 0;
                console.log(`   💎 Using standard block reward: ${blockReward} × ${primaryBlockCount} blocks = ${cryptoReward} ${order.soloMiningCoin}`);
            }

            // For team packages, calculate user's share of costs and rewards
            let priceSpent = 0;
            let totalRewardBTC = 0;
            let userSharePercentage = 1.0; // Default to 100% for non-team packages
            let myShares = null;
            let totalShares = null;
            let secondaryCryptoReward = 0; // For dual mining (e.g., LTC in Palladium packages)
            const SHARE_COST = 0.0001; // Each share costs 0.0001 BTC

            if (isTeamPackage) {
                console.log(`   👥 TEAM PACKAGE - Calculating user's share:`);
                console.log(`      Share cost: ${SHARE_COST} BTC per share`);
                console.log(`      Status: ${order.status?.code || 'UNKNOWN'}`);
                console.log(`      isReward: ${order.isReward}`);

                // Determine if this is a COMPLETED package with sharedTicket.members data
                const isCompletedTeam = order.status?.code === 'COMPLETED' && order.sharedTicket?.members;
                let addedAmount = 0;
                let userMemberReward = null; // For completed packages, this is the user's crypto reward from API
                let userMember = null; // Store user's member entry for later reference

                if (isCompletedTeam) {
                    // COMPLETED TEAM PACKAGE - Parse sharedTicket.members array
                    console.log(`      🔍 COMPLETED TEAM PACKAGE - Parsing sharedTicket.members array:`);

                    // CRITICAL: Use easyMiningSettings.orgId (the logged-in user's org ID), NOT order.organizationId
                    const userOrgId = easyMiningSettings.orgId;
                    const members = order.sharedTicket.members || [];
                    console.log(`         User Org ID (from settings): ${userOrgId}`);
                    console.log(`         Order owner Org ID: ${order.organizationId}`);
                    console.log(`         Total members: ${members.length}`);

                    // Find user's member entry
                    userMember = members.find(m => m.organizationId === userOrgId);

                    if (userMember) {
                        console.log(`         ✅ Found user in members array`);
                        addedAmount = parseFloat(userMember.addedAmount || 0);

                        // Extract crypto rewards from the rewards array (not rewardAmount which is BTC)
                        const memberRewards = userMember.rewards || [];
                        console.log(`         User's addedAmount: ${addedAmount.toFixed(8)} BTC`);
                        console.log(`         User's member rewards array:`, JSON.stringify(memberRewards, null, 2));
                        console.log(`         Number of rewards: ${memberRewards.length}`);

                        // Log each reward coin
                        memberRewards.forEach((r, idx) => {
                            console.log(`         Reward #${idx + 1}: ${r.coin} = ${r.rewardAmount} (fee: ${r.rewardFeeAmount})`);
                        });

                        // Find primary coin reward
                        const primaryRewardData = memberRewards.find(r => r.coin === order.soloMiningCoin);
                        if (primaryRewardData) {
                            userMemberReward = parseFloat(primaryRewardData.rewardAmount || 0);
                            console.log(`         ✅ Primary (${order.soloMiningCoin}): ${userMemberReward}`);
                        } else {
                            userMemberReward = 0;
                            console.log(`         ⚠️ No primary reward for ${order.soloMiningCoin}`);
                        }
                    } else {
                        console.log(`         ⚠️ WARNING: User not found in members array!`);
                        addedAmount = parseFloat(order.addedAmount || 0);
                    }
                } else {
                    // ACTIVE TEAM PACKAGE - Check if members array exists
                    console.log(`      📊 ACTIVE TEAM PACKAGE - Checking for members array`);

                    if (order.sharedTicket?.members && Array.isArray(order.sharedTicket.members)) {
                        console.log(`      🔍 ACTIVE TEAM PACKAGE - Parsing sharedTicket.members array:`);
                        const members = order.sharedTicket.members;
                        const userOrgId = easyMiningSettings.orgId; // Use logged-in user's org ID

                        console.log(`         User Org ID (from settings): ${userOrgId}`);
                        console.log(`         Order owner Org ID: ${order.organizationId}`);
                        console.log(`         Total members: ${members.length}`);

                        // Find user's member entry
                        userMember = members.find(m => m.organizationId === userOrgId);

                        if (userMember) {
                            console.log(`         ✅ Found user in active team package members array`);
                            addedAmount = parseFloat(userMember.addedAmount || 0);
                            console.log(`         User's addedAmount: ${addedAmount.toFixed(8)} BTC`);

                            // Log shares if available
                            if (userMember.shares) {
                                console.log(`         ✅ Found shares object in active package:`, userMember.shares);
                            }

                            // ✅ FIX: Extract rewards from active team package if blocks found
                            if (userMember.rewards && userMember.rewards.length > 0) {
                                const memberRewards = userMember.rewards;
                                console.log(`         ✅ Found rewards in active team package:`, JSON.stringify(memberRewards, null, 2));
                                console.log(`         Number of rewards: ${memberRewards.length}`);

                                // Extract primary reward (same as completed packages)
                                const primaryRewardData = memberRewards.find(r => r.coin === order.soloMiningCoin);
                                if (primaryRewardData) {
                                    userMemberReward = parseFloat(primaryRewardData.rewardAmount || 0);
                                    console.log(`         ✅ Primary reward (${order.soloMiningCoin}): ${userMemberReward}`);
                                }
                            }
                        } else {
                            console.log(`         ⚠️ User not found in active package members, using root addedAmount`);
                            addedAmount = parseFloat(order.addedAmount || 0);
                        }
                    } else {
                        // Fallback if no members array
                        console.log(`      📊 ACTIVE TEAM PACKAGE - No members array, using root addedAmount`);
                        addedAmount = parseFloat(order.addedAmount || 0);
                    }
                }

                priceSpent = addedAmount;
                console.log(`      addedAmount (my price spent): ${addedAmount.toFixed(8)} BTC`);

                // Calculate my shares from shares object if available (more accurate than addedAmount calculation)
                // ✅ FIXED: Use isTeamPackage instead of isCompletedTeam to work for both active and completed team packages
                if (isTeamPackage && userMember?.shares) {
                    const sharesObj = userMember.shares;
                    const small = parseInt(sharesObj.small || 0);
                    const medium = parseInt(sharesObj.medium || 0);
                    const large = parseInt(sharesObj.large || 0);

                    // Calculate: small = 1 share each, medium = 10 shares each, large = 100 shares each
                    myShares = small + (medium * 10) + (large * 100);
                    console.log(`      My shares from API: small=${small}, medium=${medium}, large=${large}`);
                    console.log(`      Calculated shares: ${small} + (${medium}×10) + (${large}×100) = ${myShares}`);
                } else {
                    // Fallback: Calculate my shares from addedAmount * 10000
                    myShares = addedAmount > 0 ? Math.round(addedAmount * 10000) : 0;
                    console.log(`      My shares (calculated): ${addedAmount.toFixed(8)} * 10000 = ${myShares.toFixed(2)}`);
                }

                // Calculate total shares: sharedTicket.addedAmount * 10000
                // Note: This is the TOTAL package cost, not the user's individual contribution
                const totalPackageCost = parseFloat(order.sharedTicket?.addedAmount || order.packagePrice || 0);
                totalShares = totalPackageCost > 0 ? Math.round(totalPackageCost * 10000) : 1;
                console.log(`      Total shares: ${totalPackageCost.toFixed(8)} * 10000 = ${totalShares.toFixed(2)}`);

                // SHARES CALCULATION DEBUG
                console.log(`   📊 SHARES CALCULATION DEBUG:`);
                console.log(`      ownedShares (myShares): ${myShares} (type: ${typeof myShares})`);
                console.log(`      totalShares: ${totalShares} (type: ${typeof totalShares})`);
                console.log(`      Are values null? ownedShares=${myShares === null}, totalShares=${totalShares === null}`);
                console.log(`      Are values > 0? ownedShares=${myShares > 0}, totalShares=${totalShares > 0}`);

                if (totalShares > 0 && myShares > 0) {
                    userSharePercentage = myShares / totalShares;
                    console.log(`      User share percentage: ${myShares.toFixed(2)} / ${totalShares.toFixed(2)} = ${(userSharePercentage * 100).toFixed(2)}%`);

                    // Calculate user's share of BTC rewards
                    totalRewardBTC = totalPackageRewardBTC * userSharePercentage;
                    console.log(`      → BTC reward calculation: ${totalPackageRewardBTC.toFixed(8)} × ${userSharePercentage.toFixed(4)} = ${totalRewardBTC.toFixed(8)} BTC`);

                    // Calculate user's share of primary crypto rewards
                    // ✅ FIXED: Use userMemberReward for both active and completed team packages if available in members array
                    if (isTeamPackage && userMemberReward !== null) {
                        // TEAM PACKAGE: Use pre-calculated reward from members array (works for both active and completed)
                        cryptoReward = userMemberReward;
                        console.log(`      → PRIMARY CRYPTO REWARD (from members array): ${cryptoReward.toFixed(8)} ${order.soloMiningCoin}`);
                    } else if (totalPackageCryptoReward > 0) {
                        // ACTIVE: Calculate from total package reward
                        const rewardPerShare = totalPackageCryptoReward / totalShares;
                        cryptoReward = rewardPerShare * myShares;
                        console.log(`      → Primary crypto reward calculation: (${totalPackageCryptoReward} / ${totalShares.toFixed(2)}) × ${myShares.toFixed(2)} = ${cryptoReward.toFixed(8)} ${order.soloMiningCoin}`);
                    } else {
                        cryptoReward = cryptoReward * userSharePercentage;
                        console.log(`      → Primary crypto reward calculation (fallback): ${cryptoReward} × ${userSharePercentage.toFixed(4)}`);
                    }

                    // Calculate user's share of secondary crypto rewards (for dual mining)
                    // ✅ SEPARATED LOGIC: Active team packages vs Completed team packages
                    // This handles Team Palladium (DOGE/LTC) and other dual-mining packages

                    // ACTIVE TEAM PACKAGES: Check which coins actually won
                    if (isTeamPackage && order.status?.code !== 'COMPLETED' && userMember?.rewards) {
                        console.log(`      📋 ACTIVE TEAM PACKAGE: Checking for secondary crypto rewards...`);
                        // Look for the specific secondary coin in rewards array
                        const secondaryRewardData = userMember.rewards.find(r => r.coin === order.soloMiningMergeCoin);
                        if (secondaryRewardData) {
                            secondaryCryptoReward = parseFloat(secondaryRewardData.rewardAmount || 0);
                            console.log(`      → ACTIVE TEAM: Secondary crypto (${order.soloMiningMergeCoin}) WON - reward: ${secondaryCryptoReward.toFixed(8)}`);
                        } else {
                            secondaryCryptoReward = 0;
                            console.log(`      → ACTIVE TEAM: Secondary crypto (${order.soloMiningMergeCoin}) NOT won - reward: 0`);
                        }
                    }
                    // COMPLETED TEAM PACKAGES: Use original working logic
                    else if (isCompletedTeam && userMember?.rewards) {
                        console.log(`      📋 COMPLETED TEAM PACKAGE: Checking for secondary crypto rewards...`);
                        // Look for the specific secondary coin in rewards array
                        const secondaryRewardData = userMember.rewards.find(r => r.coin === order.soloMiningMergeCoin);
                        if (secondaryRewardData) {
                            secondaryCryptoReward = parseFloat(secondaryRewardData.rewardAmount || 0);
                            console.log(`      → COMPLETED TEAM: Secondary crypto (${order.soloMiningMergeCoin}) reward: ${secondaryCryptoReward.toFixed(8)}`);
                        } else {
                            secondaryCryptoReward = 0;
                            console.log(`      → COMPLETED TEAM: Secondary crypto (${order.soloMiningMergeCoin}) NOT won - reward: 0`);
                        }
                    }
                    // SOLO PACKAGES: Use package-level secondary rewards
                    else if (!isTeamPackage && totalPackageSecondaryCryptoReward > 0) {
                        const secondaryRewardPerShare = totalPackageSecondaryCryptoReward / totalShares;
                        secondaryCryptoReward = secondaryRewardPerShare * myShares;
                        console.log(`      → SOLO: Secondary crypto reward calculation: (${totalPackageSecondaryCryptoReward} / ${totalShares.toFixed(2)}) × ${myShares.toFixed(2)} = ${secondaryCryptoReward.toFixed(8)} ${order.soloMiningMergeCoin}`);
                    }
                    // TEAM PACKAGES WITH NO REWARDS YET
                    else if (isTeamPackage) {
                        console.log(`      📋 TEAM PACKAGE: No user rewards found yet, secondary reward = 0`);
                        secondaryCryptoReward = 0;
                    }
                } else {
                    console.log(`      ⚠️ WARNING: Unable to calculate shares (addedAmount or packagePrice missing)`);
                    priceSpent = parseFloat(order.packagePrice || order.amount || 0);
                    totalRewardBTC = totalPackageRewardBTC;
                }
            } else {
                // Standard (non-team) package - use full amounts
                priceSpent = parseFloat(order.packagePrice || order.amount || 0);
                totalRewardBTC = totalPackageRewardBTC;
                // For non-team dual mining packages, use full secondary rewards
                secondaryCryptoReward = totalPackageSecondaryCryptoReward;
            }

            console.log(`   💰 Financial Data:`);
            console.log(`      packagePrice: ${order.packagePrice} BTC`);
            console.log(`      amount: ${order.amount} BTC`);
            console.log(`      payedAmount: ${order.payedAmount} BTC (already spent on hashpower)`);
            console.log(`      availableAmount: ${order.availableAmount} BTC (remaining)`);
            console.log(`      → Using priceSpent: ${priceSpent} BTC`);
            console.log(`      → Total reward: ${totalRewardBTC.toFixed(8)} BTC`);
            console.log(`      → Profit: ${(totalRewardBTC - priceSpent).toFixed(8)} BTC`);

            console.log(`   ⏱️  Time Remaining Data:`);
            console.log(`      alive: ${order.alive}`);
            console.log(`      estimateDurationInSeconds: ${order.estimateDurationInSeconds}`);
            console.log(`      endTs: ${order.endTs}`);
            if (order.alive && order.estimateDurationInSeconds) {
                console.log(`      → Using estimateDurationInSeconds for active package`);
            } else {
                console.log(`      → Using endTs calculation`);
            }

            // Determine algorithm info
            const algorithmCode = order.algorithm?.algorithm || order.algorithm;
            const algoInfo = getAlgorithmInfo(algorithmCode, order.pool);

            // Determine if package is active based on estimateDurationInSeconds and status
            let isActive = true;

            console.log(`   🕐 Active Status Check for ${order.packageName || order.id}:`);
            console.log(`      alive flag: ${order.alive}`);
            console.log(`      estimateDurationInSeconds: ${order.estimateDurationInSeconds}`);
            console.log(`      status: ${order.status?.code || 'N/A'}`);

            // Package is NOT active if:
            // 1. estimateDurationInSeconds is 0 (time expired)
            // 2. Status indicates completion (COMPLETED, CANCELLED, DEAD, EXPIRED, etc.)
            // 3. alive flag is false

            if (order.estimateDurationInSeconds === 0) {
                console.log(`      → NOT ACTIVE: estimateDurationInSeconds is 0 (time expired)`);
                isActive = false;
            } else if (order.status?.code && ['COMPLETED', 'CANCELLED', 'DEAD', 'EXPIRED', 'ERROR'].includes(order.status.code)) {
                console.log(`      → NOT ACTIVE: status is ${order.status.code}`);
                isActive = false;
            } else if (order.alive === false) {
                console.log(`      → NOT ACTIVE: alive flag is false`);
                isActive = false;
            } else {
                console.log(`      → ACTIVE: estimateDurationInSeconds = ${order.estimateDurationInSeconds}, status = ${order.status?.code || 'N/A'}, alive = ${order.alive}`);
                isActive = true;
            }

            // Calculate potential rewards for active packages (based on blockReward)
            let potentialReward = 0; // Primary crypto potential reward
            let potentialRewardSecondary = 0; // Secondary crypto potential reward (for dual mining)

            if (isActive) {
                console.log(`   💎 POTENTIAL REWARD CALCULATION:`);

                // Extract blockReward from API structure
                let primaryBlockReward = order.sharedTicket?.currencyAlgoTicket?.currencyAlgo?.blockReward || 0;
                let secondaryBlockReward = order.sharedTicket?.currencyAlgoTicket?.mergeCurrencyAlgo?.blockReward || 0;

                // Fallback: Use getBlockReward() if API doesn't provide blockReward (for solo packages)
                if (primaryBlockReward === 0 && order.soloMiningCoin) {
                    primaryBlockReward = getBlockReward(order.soloMiningCoin);
                    console.log(`      → Using fallback blockReward for ${order.soloMiningCoin}: ${primaryBlockReward}`);
                }
                if (secondaryBlockReward === 0 && order.soloMiningMergeCoin) {
                    secondaryBlockReward = getBlockReward(order.soloMiningMergeCoin);
                    console.log(`      → Using fallback blockReward for ${order.soloMiningMergeCoin}: ${secondaryBlockReward}`);
                }

                console.log(`      Primary coin (${order.soloMiningCoin}) blockReward: ${primaryBlockReward}`);
                if (order.soloMiningMergeCoin) {
                    console.log(`      Secondary coin (${order.soloMiningMergeCoin}) blockReward: ${secondaryBlockReward}`);
                }

                if (isTeamPackage && totalShares > 0 && myShares > 0) {
                    // TEAM PACKAGE: Divide blockReward by total shares, multiply by my shares
                    potentialReward = (primaryBlockReward / totalShares) * myShares;
                    console.log(`      → TEAM: Primary potential = (${primaryBlockReward} / ${totalShares.toFixed(2)}) × ${myShares.toFixed(2)} = ${potentialReward.toFixed(8)} ${order.soloMiningCoin}`);

                    if (secondaryBlockReward > 0 && order.soloMiningMergeCoin) {
                        potentialRewardSecondary = (secondaryBlockReward / totalShares) * myShares;
                        console.log(`      → TEAM: Secondary potential = (${secondaryBlockReward} / ${totalShares.toFixed(2)}) × ${myShares.toFixed(2)} = ${potentialRewardSecondary.toFixed(8)} ${order.soloMiningMergeCoin}`);
                    }
                } else {
                    // SOLO PACKAGE: Use blockReward directly
                    potentialReward = primaryBlockReward;
                    console.log(`      → SOLO: Primary potential = ${potentialReward.toFixed(8)} ${order.soloMiningCoin}`);

                    if (secondaryBlockReward > 0 && order.soloMiningMergeCoin) {
                        potentialRewardSecondary = secondaryBlockReward;
                        console.log(`      → SOLO: Secondary potential = ${potentialRewardSecondary.toFixed(8)} ${order.soloMiningMergeCoin}`);
                    }
                }
            } else {
                console.log(`   💎 POTENTIAL REWARD: N/A (package not active)`);
            }

            // Create package object
            const pkg = {
                id: order.id,
                name: order.packageName || `${order.soloMiningCoin} Package`, // Use packageName from API!
                crypto: order.soloMiningCoin, // Direct from API (primary coin)
                cryptoSecondary: order.soloMiningMergeCoin, // For dual mining (secondary coin)
                miningType: order.soloMiningMergeCoin ? `${order.soloMiningCoin}+${order.soloMiningMergeCoin}` : `${order.soloMiningCoin} Mining`,
                reward: cryptoReward, // Primary crypto amount (user's share for team packages)
                rewardSecondary: secondaryCryptoReward, // Secondary crypto amount for dual mining (user's share for team packages)
                potentialReward: potentialReward, // Potential primary crypto reward (for active packages)
                potentialRewardSecondary: potentialRewardSecondary, // Potential secondary crypto reward (for active packages)
                btcEarnings: totalRewardBTC, // User's BTC earnings (share-adjusted for team packages)
                btcPending: 0, // Could calculate from pending blocks if needed
                confirmedBlocks: confirmedBlockCount,
                pendingBlocks: pendingBlockCount,
                totalBlocks: totalBlocks,
                algorithm: algorithmCode,
                algorithmName: algoInfo.name,
                hashrate: `${order.limit || '0'} ${order.displayMarketFactor || 'TH'}`,
                timeRemaining: calculateTimeRemaining(order), // Pass full order object to use estimateDurationInSeconds for active packages
                progress: calculateProgress(order), // Pass full order object to use estimateDurationInSeconds for active packages
                blockFound: blockFound,
                isTeam: isTeamPackage,
                price: priceSpent, // User's price spent (share-adjusted for team packages)
                // Team package share information
                ownedShares: isTeamPackage ? myShares : null,
                totalShares: isTeamPackage ? totalShares : null,
                sharePrice: isTeamPackage ? SHARE_COST : null,
                userSharePercentage: userSharePercentage,
                // Package metadata
                active: isActive,
                status: isActive ? 'active' : 'completed',
                startTime: order.startTs,
                endTime: order.endTs,
                marketFactor: order.displayMarketFactor,
                poolName: order.pool?.name || 'Solo Mining',
                packageSort: order.packageSort || 0, // For ordering packages
                packageDuration: order.packageDuration || 0,
                fullOrderData: order
            };

            console.log(`   ✅ Package created: ${pkg.name} - ${pkg.miningType}`);
            console.log(`      Blocks: ${pkg.totalBlocks}, Primary Reward: ${pkg.reward} ${pkg.crypto}, BTC: ${pkg.btcEarnings.toFixed(8)}`);
            if (pkg.rewardSecondary > 0 && pkg.cryptoSecondary) {
                console.log(`      Secondary Reward: ${pkg.rewardSecondary} ${pkg.cryptoSecondary}`);
            }
            if (pkg.isTeam) {
                console.log(`   👥 TEAM PACKAGE - Final values stored in pkg object:`);
                console.log(`      ownedShares: ${pkg.ownedShares}`);
                console.log(`      totalShares: ${pkg.totalShares}`);
                console.log(`      userSharePercentage: ${pkg.userSharePercentage}`);
            }

            packages.push(pkg);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 FINAL SUMMARY`);
        console.log(`   Total packages: ${packages.length}`);
        console.log(`   Active: ${packages.filter(p => p.active).length}`);
        console.log(`   Completed: ${packages.filter(p => !p.active).length}`);
        console.log(`   With blocks: ${packages.filter(p => p.blockFound).length}`);
        console.log(`   Total blocks found: ${packages.reduce((sum, p) => sum + p.totalBlocks, 0)}`);
        console.log(`${'='.repeat(80)}\n`);

        return packages;

    } catch (error) {
        console.error('❌ Error fetching NiceHash orders:', error);
        throw error;
    }
}

function formatDateTime(timestamp) {
    if (!timestamp) return 'Unknown';

    let date;
    if (typeof timestamp === 'string') {
        // ISO format
        date = new Date(timestamp);
    } else {
        // Milliseconds
        date = new Date(parseInt(timestamp));
    }

    // Format: "Jan 15, 2025 at 3:45 PM"
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };

    return date.toLocaleString('en-US', options);
}

// Helper function to calculate time remaining
// Can accept either a full order object or just an endTimestamp for backwards compatibility
function calculateTimeRemaining(orderOrTimestamp) {
    // Handle both order object and timestamp
    let order = null;
    let endTimestamp = null;

    if (typeof orderOrTimestamp === 'object' && orderOrTimestamp !== null) {
        // Full order object passed
        order = orderOrTimestamp;
        endTimestamp = order.endTs;
    } else {
        // Just timestamp passed (backwards compatibility)
        endTimestamp = orderOrTimestamp;
    }

    // For active packages, use estimateDurationInSeconds if available
    if (order && order.alive === true && order.estimateDurationInSeconds) {
        const remainingSeconds = parseInt(order.estimateDurationInSeconds);

        if (remainingSeconds <= 0) return 'Completed';

        const days = Math.floor(remainingSeconds / (60 * 60 * 24));
        const hours = Math.floor((remainingSeconds % (60 * 60 * 24)) / (60 * 60));
        const minutes = Math.floor((remainingSeconds % (60 * 60)) / 60);

        if (days > 0) {
            return `${days}d ${hours}h`;
        }
        return `${hours}h ${minutes}m`;
    }

    // Fallback to endTimestamp calculation for completed packages or if estimateDurationInSeconds is not available
    if (!endTimestamp) return 'Unknown';

    const now = Date.now();

    // NiceHash timestamps can be in ISO format (string) or milliseconds (number)
    let end;
    if (typeof endTimestamp === 'string') {
        // ISO format - parse as date
        end = new Date(endTimestamp).getTime();
    } else {
        // Assume it's in milliseconds already
        end = parseInt(endTimestamp);
    }

    const remaining = end - now;

    // If expired, show "Completed" instead of "Expired"
    if (remaining <= 0) return 'Completed';

    const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    return `${hours}h ${minutes}m`;
}

// Helper function to calculate progress percentage
function calculateProgress(orderOrStartTimestamp, endTimestamp) {
    // Handle both order object and timestamp parameters
    let order = null;
    let startTimestamp = null;

    if (typeof orderOrStartTimestamp === 'object' && orderOrStartTimestamp !== null) {
        // Full order object passed
        order = orderOrStartTimestamp;
        startTimestamp = order.startTs;
        endTimestamp = order.endTs;
    } else {
        // Just timestamps passed (backwards compatibility)
        startTimestamp = orderOrStartTimestamp;
    }

    if (!startTimestamp || !endTimestamp) return 0;

    const now = Date.now();

    // For active packages, use estimateDurationInSeconds if available
    if (order && order.alive === true && order.estimateDurationInSeconds) {
        // Parse start timestamp
        let start;
        if (typeof startTimestamp === 'string') {
            start = new Date(startTimestamp).getTime();
        } else {
            start = parseInt(startTimestamp);
        }

        // Calculate elapsed time since start
        const elapsed = now - start;

        // estimateDurationInSeconds is REMAINING time, not total duration
        const remainingMs = parseInt(order.estimateDurationInSeconds) * 1000;

        // Total duration = elapsed + remaining
        const totalDuration = elapsed + remainingMs;

        if (totalDuration <= 0) return 100;

        // Progress = elapsed / total
        const progress = (elapsed / totalDuration) * 100;
        return Math.min(Math.max(progress, 0), 100);
    }

    // Fallback to endTimestamp calculation for completed packages or if estimateDurationInSeconds is not available
    // NiceHash timestamps can be in ISO format (string) or milliseconds (number)
    let start, end;
    if (typeof startTimestamp === 'string') {
        start = new Date(startTimestamp).getTime();
    } else {
        start = parseInt(startTimestamp);
    }

    if (typeof endTimestamp === 'string') {
        end = new Date(endTimestamp).getTime();
    } else {
        end = parseInt(endTimestamp);
    }

    const total = end - start;
    const elapsed = now - start;

    if (total <= 0) return 0;

    const progress = (elapsed / total) * 100;
    return Math.min(Math.max(progress, 0), 100);
}

function generateMockPackages() {
    // Mock packages with realistic NiceHash EasyMining data structure
    const packageTypes = [
        { name: 'Gold S', crypto: 'BTC', reward: 0.00001 },
        { name: 'Gold M', crypto: 'BTC', reward: 0.00002 },
        { name: 'Gold L', crypto: 'BTC', reward: 0.00005 },
        { name: 'Silver S', crypto: 'BCH', reward: 0.01 },
        { name: 'Silver M', crypto: 'BCH', reward: 0.02 },
        { name: 'Chromium S', crypto: 'RVN', reward: 100 },
        { name: 'Chromium M', crypto: 'RVN', reward: 200 },
        { name: 'Pal DOGE S', crypto: 'DOGE', reward: 10 },
        { name: 'Pal LTC S', crypto: 'LTC', reward: 0.01 },
        { name: 'Titanium KAS S', crypto: 'KAS', reward: 10 }
    ];
    
    const teamTypes = [
        { name: 'Team Silver', crypto: 'BCH', reward: 0.05 },
        { name: 'Team Pal', crypto: 'DOGE', reward: 50 },
        { name: 'Team Gold', crypto: 'BTC', reward: 0.0001 }
    ];
    
    const packages = [];
    const numPackages = Math.floor(Math.random() * 10) + 5;
    
    for (let i = 0; i < numPackages; i++) {
        const shouldBeTeam = Math.random() > 0.7;
        const typeData = shouldBeTeam
            ? teamTypes[Math.floor(Math.random() * teamTypes.length)]
            : packageTypes[Math.floor(Math.random() * packageTypes.length)];

        // Detect team packages by name (case-insensitive "team" prefix)
        const isTeam = typeData.name.toLowerCase().startsWith('team');
        console.log(`   📦 Mock Package: "${typeData.name}" → isTeam: ${isTeam}`);

        // Calculate team package values using correct formula
        const SHARE_COST = 0.0001; // BTC per share
        let myShares = 1;
        let totalShares = 1;
        let userSharePercentage = 1.0;
        let priceSpent = 0;
        let packagePrice = 0;
        let calculatedReward = typeData.reward;

        if (isTeam) {
            // Generate realistic team package values
            const addedAmount = (Math.random() * 0.009 + 0.001); // 0.001 to 0.01 BTC
            packagePrice = (Math.random() * 0.45 + 0.05); // 0.05 to 0.5 BTC

            // Calculate shares using the formula
            myShares = addedAmount / SHARE_COST;
            totalShares = packagePrice / SHARE_COST;
            userSharePercentage = myShares / totalShares;
            priceSpent = addedAmount; // User's actual contribution

            // Calculate user's share of reward
            calculatedReward = typeData.reward * userSharePercentage;

            console.log(`      Team Package Calculations:`);
            console.log(`         addedAmount: ${addedAmount.toFixed(8)} BTC`);
            console.log(`         packagePrice: ${packagePrice.toFixed(8)} BTC`);
            console.log(`         myShares: ${myShares.toFixed(2)}`);
            console.log(`         totalShares: ${totalShares.toFixed(2)}`);
            console.log(`         sharePercentage: ${(userSharePercentage * 100).toFixed(2)}%`);
            console.log(`         myReward: ${calculatedReward.toFixed(8)} ${typeData.crypto}`);
        } else {
            // Solo package - full values
            priceSpent = Math.random() * 50 + 10;
            calculatedReward = typeData.reward;
        }

        packages.push({
            id: `pkg_${i}`,
            name: typeData.name,
            crypto: typeData.crypto,
            reward: calculatedReward, // User's proportional reward for team packages
            probability: `1:${Math.floor(Math.random() * 500) + 50}`,
            timeRemaining: Math.floor(Math.random() * 24) + 'h',
            progress: Math.floor(Math.random() * 100),
            blockFound: Math.random() > 0.95,
            isTeam: isTeam,
            ownedShares: isTeam ? myShares : null,
            totalShares: isTeam ? totalShares : null,
            sharePrice: isTeam ? SHARE_COST : null,
            userSharePercentage: userSharePercentage,
            price: priceSpent, // User's actual cost
            blocks: generateMockBlocks(),
            algorithm: 'SHA256', // Example algorithm
            hashrate: `${(Math.random() * 100).toFixed(2)} TH/s`
        });
    }

    const teamCount = packages.filter(pkg => pkg.isTeam).length;
    const soloCount = packages.length - teamCount;
    console.log(`   ✅ Generated ${packages.length} mock packages: ${teamCount} team, ${soloCount} solo`);

    return packages;
}

function generateMockBlocks() {
    const numBlocks = Math.floor(Math.random() * 20) + 5;
    const blocks = [];
    
    for (let i = 0; i < numBlocks; i++) {
        blocks.push({
            attempt: i + 1,
            percentage: Math.floor(Math.random() * 120)
        });
    }
    
    return blocks;
}

// =============================================================================
// EASYMINING UI UPDATE FUNCTIONS
// =============================================================================

function updateEasyMiningUI() {
    // Update balances (BTC)
    document.getElementById('easymining-available-btc').textContent = easyMiningData.availableBTC;
    document.getElementById('easymining-pending-btc').textContent = easyMiningData.pendingBTC;

    // Convert BTC balances to AUD and update
    const availableBTC = parseFloat(easyMiningData.availableBTC) || 0;
    const pendingBTC = parseFloat(easyMiningData.pendingBTC) || 0;
    const availableAUD = convertBTCtoAUD(availableBTC);
    const pendingAUD = convertBTCtoAUD(pendingBTC);

    document.getElementById('easymining-available-aud').textContent = `$${formatNumber(availableAUD.toFixed(2))}`;
    document.getElementById('easymining-pending-aud').textContent = `$${formatNumber(pendingAUD.toFixed(2))}`;

    // Display active packages
    displayActivePackages();

    // Update stats
    updateStats();

    // Update recommendations
    updateRecommendations();

    // Restore rockets after UI update (maintains persistence)
    restoreRockets();
}

// Current package filter tab
let currentPackageTab = 'active';

// Switch package tab
function switchPackageTab(tab) {
    currentPackageTab = tab;
    showAllPackages = false; // Reset to collapsed view when switching tabs

    // Reset pagination state
    currentPackagePage = 1; // Reset to first page

    // Update tab UI
    document.querySelectorAll('.package-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.closest('.package-tab').classList.add('active');

    // Refresh display
    displayActivePackages();
}

window.switchPackageTab = switchPackageTab;

function displayActivePackages() {
    const container = document.getElementById('active-packages-container');
    container.innerHTML = '';

    // Filter packages based on current tab
    let filteredPackages = [];
    if (currentPackageTab === 'active') {
        filteredPackages = easyMiningData.activePackages.filter(pkg => pkg.active === true);
    } else if (currentPackageTab === 'completed') {
        filteredPackages = easyMiningData.activePackages.filter(pkg => pkg.active === false);
        // Sort completed packages by end time (latest first)
        filteredPackages.sort((a, b) => {
            const getEndTime = (pkg) => {
                if (pkg.endTime) {
                    return typeof pkg.endTime === 'string' ? new Date(pkg.endTime).getTime() : pkg.endTime;
                }
                return 0;
            };
            return getEndTime(b) - getEndTime(a); // Descending order (latest first)
        });
    } else if (currentPackageTab === 'rewards') {
        // Rewards tab: show packages with blocks (both active and completed)
        // Don't show at top - just order by date like completed packages
        console.log('🎁 REWARDS TAB - Filtering packages with blockFound === true');
        const packagesWithBlocks = easyMiningData.activePackages.filter(pkg => pkg.blockFound === true);

        console.log(`📦 Found ${packagesWithBlocks.length} packages with confirmed rewards:`);
        packagesWithBlocks.forEach(pkg => {
            console.log(`  ✓ ${pkg.name} (${pkg.id}): btcEarnings=${pkg.btcEarnings}, blockFound=${pkg.blockFound}`);
        });

        filteredPackages = packagesWithBlocks;
    }

    // Update tab counts
    document.getElementById('active-count').textContent = easyMiningData.activePackages.filter(pkg => pkg.active === true).length;
    document.getElementById('completed-count').textContent = easyMiningData.activePackages.filter(pkg => pkg.active === false).length;
    document.getElementById('rewards-count').textContent = easyMiningData.activePackages.filter(pkg => pkg.blockFound === true).length;

    // Detect desktop/tablet vs mobile (600px breakpoint)
    const isDesktop = window.innerWidth > 600;

    // Set cards per page based on screen size
    // Desktop/Tablet: 6 cards per page, Mobile: 3 cards per page
    const cardsPerPage = isDesktop ? 6 : 3;

    // Paginate in groups (6 for desktop, 3 for mobile)
    const startIndex = (currentPackagePage - 1) * cardsPerPage;
    const endIndex = startIndex + cardsPerPage;
    const packagesToShow = filteredPackages.slice(startIndex, endIndex);

    if (packagesToShow.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: #888; padding: 20px;">No ${currentPackageTab} packages</p>`;

        // Hide Show More button when no packages to display
        const showMoreBtn = document.getElementById('show-more-packages');
        if (showMoreBtn) {
            showMoreBtn.style.display = 'none';
            console.log(`✗ Show More button hidden (0 packages in ${currentPackageTab} tab)`);
        }
        return;
    }

    packagesToShow.forEach(pkg => {
        // Debug team package data
        if (pkg.isTeam) {
            console.log(`\n🔍 TEAM PACKAGE UI DATA: ${pkg.name}`);
            console.log(`   isTeam: ${pkg.isTeam}`);
            console.log(`   ownedShares: ${pkg.ownedShares} (type: ${typeof pkg.ownedShares})`);
            console.log(`   totalShares: ${pkg.totalShares} (type: ${typeof pkg.totalShares})`);
            console.log(`   userSharePercentage: ${pkg.userSharePercentage}`);
            console.log(`   price: ${pkg.price}`);
            console.log(`   reward: ${pkg.reward} ${pkg.crypto}`);
            console.log(`   rewardSecondary: ${pkg.rewardSecondary} ${pkg.cryptoSecondary}`);
            console.log(`   blockFound: ${pkg.blockFound}`);

            // Check if shares will be displayed
            const willShowShares = pkg.ownedShares !== null && pkg.ownedShares !== undefined &&
                                   pkg.totalShares !== null && pkg.totalShares !== undefined &&
                                   pkg.ownedShares > 0 && pkg.totalShares > 0;
            console.log(`   📊 Shares will be displayed: ${willShowShares}`);
            if (!willShowShares) {
                console.log(`      ❌ Reason: ownedShares=${pkg.ownedShares}, totalShares=${pkg.totalShares}`);
            }
        }

        const card = document.createElement('div');
        // Add 'block-confirmed' class to packages that found blocks (for orange glow)
        card.className = pkg.blockFound ? 'package-card block-confirmed' : 'package-card';
        card.onclick = () => showPackageDetailModal(pkg);

        const rewardDecimals = (pkg.crypto === 'RVN' || pkg.crypto === 'DOGE') ? 0 : 8;
        const secondaryRewardDecimals = (pkg.cryptoSecondary === 'RVN' || pkg.cryptoSecondary === 'DOGE') ? 0 : 8;
        const priceAUD = convertBTCtoAUD(pkg.price || 0);

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

        // Robot icon for auto-bought packages (flashing, same style as rocket)
        const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};

        // Multi-level fallback matching for auto-bought packages
        let isAutoBought = null;
        let matchMethod = 'none';

        // Level 1: Direct ID match (pkg.id = order ID)
        isAutoBought = autoBoughtPackages[pkg.id];
        if (isAutoBought) matchMethod = 'direct-id';

        // Level 2: Check orderId/ticketId fields in stored entries
        if (!isAutoBought) {
            isAutoBought = Object.values(autoBoughtPackages).find(entry =>
                entry.orderId === pkg.id || entry.ticketId === pkg.id
            );
            if (isAutoBought) matchMethod = 'orderId-ticketId';
        }

        // Level 3: For team packages - match by package name + recent purchase (within 7 days)
        // This handles team packages that transition from countdown to active with different IDs
        if (!isAutoBought && pkg.isTeam) {
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            isAutoBought = Object.values(autoBoughtPackages).find(entry =>
                entry.type === 'team' &&
                entry.packageName === pkg.name &&
                entry.timestamp > sevenDaysAgo
            );
            if (isAutoBought) matchMethod = 'name-timestamp';
        }

        // Level 4: Check sharedTicket.id (team packages use shared ticket system)
        if (!isAutoBought && pkg.fullOrderData?.sharedTicket?.id) {
            const sharedTicketId = pkg.fullOrderData.sharedTicket.id;
            isAutoBought = Object.values(autoBoughtPackages).find(entry =>
                entry.ticketId === sharedTicketId
            );
            if (isAutoBought) matchMethod = 'sharedTicket-id';
        }

        // Enhanced debug logging for team packages
        if (Object.keys(autoBoughtPackages).length > 0 && (pkg.isTeam || isAutoBought)) {
            console.log('🤖 ROBOT ICON CHECK:', {
                pkgId: pkg.id,
                pkgName: pkg.name,
                pkgIsTeam: pkg.isTeam,
                pkgActive: pkg.active,
                foundInAutoBought: !!isAutoBought,
                matchMethod: matchMethod,
                autoBoughtKeys: Object.keys(autoBoughtPackages),
                autoBoughtEntries: Object.values(autoBoughtPackages).map(e => ({
                    name: e.packageName,
                    type: e.type,
                    orderId: e.orderId,
                    ticketId: e.ticketId
                })),
                sharedTicketId: pkg.fullOrderData?.sharedTicket?.id
            });
        }

        let robotHtml = '';
        if (isAutoBought && pkg.active) {
            // Active auto-bought package: flashing robot on top left (matches rocket style)
            robotHtml = '<div class="block-found-indicator flashing auto-buy-robot" title="Auto-bought by bot">🤖</div>';
        }

        // Rocket icon logic:
        // - Active packages: flashing rocket (mining in progress, regardless of blocks found)
        // - Completed packages: no rocket (removed to avoid clutter)
        let rocketHtml = '';
        if (pkg.active) {
            // Active package: always flashing rocket (shows it's currently mining)
            rocketHtml = '<div class="block-found-indicator flashing">🚀</div>';
        }
        // Completed packages: no rocket icon

        // Block count badge - show total blocks count
        let blockBadge = '';
        if (pkg.blockFound && pkg.totalBlocks > 0) {
            blockBadge = ` 🚀 x${pkg.totalBlocks}`;
        }

        card.innerHTML = `
            ${robotHtml}
            ${rocketHtml}
            <div class="package-card-name">${pkg.name}${blockBadge}</div>
            <div class="package-card-stat">
                <span>Reward:</span>
                <span style="color: ${pkg.blockFound ? '#00ff00' : '#888'};">${rewardDisplay}</span>
            </div>
            ${!pkg.active && pkg.blockFound && (pkg.reward > 0 || (pkg.rewardSecondary > 0 && pkg.cryptoSecondary)) ? `
            <div class="package-card-stat">
                <span>Reward AUD:</span>
                <span style="color: #00ff00;">${(() => {
                    let totalAUD = 0;
                    if (pkg.reward > 0) {
                        totalAUD += convertCryptoToAUD(pkg.reward, pkg.crypto);
                    }
                    if (pkg.rewardSecondary > 0 && pkg.cryptoSecondary) {
                        totalAUD += convertCryptoToAUD(pkg.rewardSecondary, pkg.cryptoSecondary);
                    }
                    return '$' + totalAUD.toFixed(2) + ' AUD';
                })()}</span>
            </div>
            ` : ''}
            ${pkg.isTeam && pkg.ownedShares !== null && pkg.ownedShares !== undefined && pkg.totalShares !== null && pkg.totalShares !== undefined && pkg.ownedShares > 0 && pkg.totalShares > 0 ? `
            <div class="package-card-stat">
                <span>My Shares:</span>
                <span>${Math.round(pkg.ownedShares)} / ${Math.round(pkg.totalShares)} (${(pkg.userSharePercentage * 100).toFixed(1)}%)</span>
            </div>
            ` : ''}
            ${pkg.active && pkg.potentialReward > 0 ? `
            <div class="package-card-stat">
                <span>Potential:</span>
                <span style="color: #ffa500;">$${convertCryptoToAUD(pkg.potentialReward, pkg.crypto).toFixed(2)} AUD${pkg.potentialRewardSecondary > 0 && pkg.cryptoSecondary ? `<br>+ $${convertCryptoToAUD(pkg.potentialRewardSecondary, pkg.cryptoSecondary).toFixed(2)} AUD` : ''}</span>
            </div>
            ` : ''}
            <div class="package-card-stat">
                <span>Time:</span>
                <span>${pkg.timeRemaining}</span>
            </div>
            <div class="package-card-stat">
                <span>Price:</span>
                <span>$${priceAUD.toFixed(2)} AUD</span>
            </div>
            <div class="package-progress-bar">
                <div class="package-progress-fill" style="width: ${pkg.progress}%"></div>
            </div>
        `;

        container.appendChild(card);
    });

    // Update arrow controls visibility and states (both desktop and mobile)
    const carouselControls = document.getElementById('package-carousel-controls');
    const totalPages = Math.ceil(filteredPackages.length / cardsPerPage);

    // Show controls if there are more packages than can fit on one page
    if (filteredPackages.length > cardsPerPage) {
        // Show carousel controls
        if (carouselControls) carouselControls.style.display = 'flex';

        // Update page counter
        const pageCounter = document.getElementById('package-page-count');
        if (pageCounter) {
            pageCounter.textContent = `${currentPackagePage} of ${totalPages}`;
        }

        // Update arrow button states
        const leftArrow = document.getElementById('package-arrow-left');
        const rightArrow = document.getElementById('package-arrow-right');

        if (leftArrow) {
            leftArrow.disabled = currentPackagePage === 1;
        }
        if (rightArrow) {
            rightArrow.disabled = currentPackagePage >= totalPages;
        }

        console.log(`✓ Arrow navigation: Page ${currentPackagePage} of ${totalPages} (${cardsPerPage} cards per page)`);
    } else {
        // Hide controls if all packages fit on one page
        if (carouselControls) carouselControls.style.display = 'none';
    }
}

function updateStats() {
    // Calculate stats from actual package data
    const packages = easyMiningData.activePackages || [];

    // Log detailed package breakdown for debugging
    console.log(`📊 Total packages: ${packages.length}`);
    const packagesWithEarnings = packages.filter(pkg => (pkg.btcEarnings || 0) > 0);
    const packagesWithBlockFound = packages.filter(pkg => pkg.blockFound === true);
    console.log(`💰 Packages with btcEarnings > 0: ${packagesWithEarnings.length}`);
    console.log(`🎯 Packages with blockFound=true: ${packagesWithBlockFound.length}`);

    // Sample a few packages to see their blockFound status
    if (packages.length > 0) {
        console.log('📦 Sample packages:', packages.slice(0, 3).map(pkg => ({
            id: pkg.id,
            name: pkg.name,
            btcEarnings: pkg.btcEarnings,
            blockFound: pkg.blockFound,
            price: pkg.price
        })));
    }

    // All time stats - sum up ALL blocks and rewards from ALL packages
    const packagesWithBlocks = packages.filter(pkg => pkg.blockFound === true);

    // Total blocks = sum of totalBlocks from each package (not just package count!)
    const totalBlocksAll = packages.reduce((sum, pkg) => sum + (pkg.totalBlocks || 0), 0);

    // Total spent = sum price from ALL packages (not just ones with blocks)
    const totalSpentBTC = packages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);

    // Total reward = sum btcEarnings from packages that found blocks
    const totalRewardBTC = packagesWithBlocks.reduce((sum, pkg) => sum + (pkg.btcEarnings || 0), 0);

    const pnlBTC = totalRewardBTC - totalSpentBTC;

    console.log(`\n💰 STATS CALCULATION:`);
    console.log(`   Total packages: ${packages.length}`);
    console.log(`   Packages with blocks: ${packagesWithBlocks.length}`);
    console.log(`   Total blocks found: ${totalBlocksAll}`);
    console.log(`   Total spent: ${totalSpentBTC.toFixed(8)} BTC`);
    console.log(`   Total rewards: ${totalRewardBTC.toFixed(8)} BTC`);
    console.log(`   PnL: ${pnlBTC.toFixed(8)} BTC`);

    // Convert BTC to AUD for display
    const totalSpentAUD = convertBTCtoAUD(totalSpentBTC);
    const totalRewardAUD = convertBTCtoAUD(totalRewardBTC);
    const pnlAUD = convertBTCtoAUD(pnlBTC);

    // Today stats - packages started today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const todayPackages = packages.filter(pkg => new Date(pkg.startTime).getTime() >= todayTimestamp);
    const todayPackagesWithBlocks = todayPackages.filter(pkg => pkg.blockFound === true);

    // Total blocks today = sum of totalBlocks from packages started today
    const totalBlocksToday = todayPackages.reduce((sum, pkg) => sum + (pkg.totalBlocks || 0), 0);

    // Total spent today = sum price from packages started today
    const totalSpentTodayBTC = todayPackages.reduce((sum, pkg) => sum + (pkg.price || 0), 0);

    // Total reward today = sum btcEarnings from packages started today that found blocks
    const totalRewardTodayBTC = todayPackagesWithBlocks.reduce((sum, pkg) => sum + (pkg.btcEarnings || 0), 0);

    const pnlTodayBTC = totalRewardTodayBTC - totalSpentTodayBTC;

    // Convert today's BTC to AUD
    const totalSpentTodayAUD = convertBTCtoAUD(totalSpentTodayBTC);
    const pnlTodayAUD = convertBTCtoAUD(pnlTodayBTC);

    console.log(`📈 Stats - Blocks: ${totalBlocksAll}, Spent: $${totalSpentAUD.toFixed(2)}, Reward: $${totalRewardAUD.toFixed(2)}, PNL: $${pnlAUD.toFixed(2)}`);

    // Update UI - All time stats (in AUD)
    document.getElementById('total-blocks-all').textContent = totalBlocksAll;
    document.getElementById('total-reward-all').textContent = `$${formatNumber(totalRewardAUD.toFixed(2))}`;
    document.getElementById('total-spent-all').textContent = `$${formatNumber(totalSpentAUD.toFixed(2))}`;
    document.getElementById('pnl-all').textContent = `$${formatNumber(pnlAUD.toFixed(2))}`;
    document.getElementById('pnl-all').className = pnlAUD >= 0 ? 'stat-value positive' : 'stat-value negative';

    // Update UI - Today stats (in AUD)
    const totalRewardTodayAUD = convertBTCtoAUD(totalRewardTodayBTC);
    const blocksElem = document.getElementById('total-blocks-today');
    const rewardsTodayElem = document.getElementById('rewards-today');
    const spentTodayElem = document.getElementById('total-spent-today');
    const pnlTodayElem = document.getElementById('pnl-today');

    if (blocksElem) blocksElem.textContent = totalBlocksToday;
    if (rewardsTodayElem) rewardsTodayElem.textContent = `$${formatNumber(totalRewardTodayAUD.toFixed(2))}`;
    if (spentTodayElem) spentTodayElem.textContent = `$${formatNumber(totalSpentTodayAUD.toFixed(2))}`;
    if (pnlTodayElem) {
        pnlTodayElem.textContent = `$${formatNumber(pnlTodayAUD.toFixed(2))}`;
        pnlTodayElem.className = pnlTodayAUD >= 0 ? 'stat-value positive' : 'stat-value negative';
    }

    // Update the easyMiningData stats for persistence (store in BTC)
    easyMiningData.allTimeStats = {
        totalBlocks: totalBlocksAll,
        totalReward: totalRewardBTC,
        totalSpent: totalSpentBTC,
        pnl: pnlBTC
    };

    easyMiningData.todayStats = {
        totalBlocks: totalBlocksToday,
        totalReward: totalRewardTodayBTC,
        totalSpent: totalSpentTodayBTC,
        pnl: pnlTodayBTC
    };
}

// Track current recommendations to prevent unnecessary re-renders
let currentRecommendations = [];
let currentTeamRecommendations = [];

// Track which alerts have played sounds (to play once per new alert)
let alertedSoloPackages = new Set();
let alertedTeamPackages = new Set();

/**
 * Check if auto-buy should be paused due to TG Safe Hold feature
 * @param {string} packageName - Name of the package to check
 * @returns {boolean} - True if auto-buy should be paused, false otherwise
 */
function shouldPauseAutoBuyForTgSafeHold(packageName) {
    // Get TG Safe Hold toggle state
    const easyMiningSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || {};
    const tgSafeHoldEnabled = easyMiningSettings.autoBuyTgSafeHold || false;

    // If toggle is OFF, allow all auto-buys (no pause)
    if (!tgSafeHoldEnabled) {
        return false;
    }

    // ALWAYS allow Team Gold auto-buy (never pause it)
    if (packageName === 'Team Gold') {
        return false;
    }

    // Get Team Gold auto-buy settings to calculate hold amount
    const teamAutoBuySettings = JSON.parse(localStorage.getItem(`${loggedInUser}_teamAutoBuy`)) || {};
    const teamGoldSettings = teamAutoBuySettings['Team Gold'];

    // If Team Gold auto-buy is not configured, no hold amount to protect
    if (!teamGoldSettings || !teamGoldSettings.enabled || !teamGoldSettings.shares) {
        console.log('🔓 TG Safe Hold: Team Gold auto-buy not configured, allowing all auto-buys');
        return false;
    }

    // Calculate hold amount: Team Gold shares × 0.0001 BTC
    const teamGoldShares = teamGoldSettings.shares;
    const sharePrice = 0.0001;
    const holdAmount = teamGoldShares * sharePrice;

    // Get available balance
    const availableBalance = window.niceHashBalance?.available || 0;

    // Check if available balance is at or below hold threshold
    // Using 4th decimal check as per user requirement
    // Example: 4 shares = 0.0004 hold, trigger when balance reaches 0.00049 (4th decimal is 4)
    const balanceRounded = parseFloat(availableBalance.toFixed(4));
    const holdRounded = parseFloat(holdAmount.toFixed(4));

    if (balanceRounded <= holdRounded) {
        console.log(`🔒 TG Safe Hold ACTIVE: Balance (${balanceRounded} BTC) at/below hold amount (${holdRounded} BTC for ${teamGoldShares} Team Gold shares)`);
        console.log(`   ⏸️ Pausing auto-buy for: ${packageName}`);
        console.log(`   ✅ Team Gold auto-buy still active`);
        return true; // Pause this auto-buy
    }

    // Balance is above hold threshold, allow auto-buy
    return false;
}

async function executeAutoBuySolo(recommendations) {
    console.log('🤖 Checking for solo auto-buy opportunities...');

    const autoBuySettings = JSON.parse(localStorage.getItem(`${loggedInUser}_soloAutoBuy`)) || {};

    // Check if smart cooldowns are enabled (default: true)
    const easyMiningSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || {};
    const smartCooldownsEnabled = easyMiningSettings.autoBuyCooldown !== undefined ? easyMiningSettings.autoBuyCooldown : true;

    for (const pkg of recommendations) {
        const autoBuy = autoBuySettings[pkg.name];

        if (!autoBuy || !autoBuy.enabled) {
            continue; // Auto-buy not enabled for this package
        }

        // 🔒 TG Safe Hold: Check if auto-buy should be paused to protect Team Gold balance
        if (shouldPauseAutoBuyForTgSafeHold(pkg.name)) {
            continue; // Skip this auto-buy (balance reserved for Team Gold)
        }

        // ✅ Smart Cooldown Toggle Logic
        let cooldownMs;
        if (smartCooldownsEnabled) {
            // When smart cooldowns are ON: Use package duration as cooldown
            const packageDurationMs = (pkg.packageDuration || 3600) * 1000; // Default to 1 hour if not available
            cooldownMs = packageDurationMs;
        } else {
            // When smart cooldowns are OFF: Use 10-minute cooldown
            cooldownMs = 10 * 60 * 1000; // 10 minutes
        }

        // Check cooldown
        if (autoBuy.lastBuyTime) {
            const timeSinceLastBuy = Date.now() - autoBuy.lastBuyTime;
            if (timeSinceLastBuy < cooldownMs) {
                const remainingMinutes = Math.ceil((cooldownMs - timeSinceLastBuy) / 60000);
                const cooldownHours = (cooldownMs / 3600000).toFixed(1);
                const cooldownType = smartCooldownsEnabled ? 'package duration' : '10min default';
                console.log(`⏳ ${pkg.name}: Cooldown active (${remainingMinutes} minutes remaining of ${cooldownHours}hr ${cooldownType} cooldown)`);
                continue;
            }
        }

        // Execute auto-buy
        console.log(`🤖 AUTO-BUY TRIGGERED: ${pkg.name}`);
        console.log(`   Package:`, pkg);
        console.log(`   Crypto: ${pkg.crypto}`);
        console.log(`   Price: ${pkg.price} BTC`);

        try {
            // Auto-buy: skip confirmation, call the purchase API directly
            if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
                console.error('❌ EasyMining not configured');
                continue;
            }

            // ✅ FIX: Sync time with NiceHash server before purchase (critical for authentication)
            console.log('⏰ Syncing time with NiceHash server...');
            await syncNiceHashTime();

            const ticketId = pkg.ticketId || pkg.id;
            console.log('🛒 Creating NiceHash solo order...');
            console.log('   Ticket ID:', ticketId);

            const endpoint = `/main/api/v2/hashpower/solo/order?ticketId=${ticketId}`;
            const body = JSON.stringify({});
            const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

            console.log('📡 Auto-buy endpoint:', endpoint);

            let response;
            if (USE_VERCEL_PROXY) {
                response = await fetch(VERCEL_PROXY_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: endpoint,
                        method: 'POST',
                        headers: headers,
                        body: {}
                    })
                });
            } else {
                response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                    method: 'POST',
                    headers: headers,
                    body: body
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `API Error: ${response.status}`);
            }

            const result = await response.json();
            console.log('📦 Solo auto-buy response:', result);

            // Validate response indicates success (check for order ID or success indicators)
            if (!result || (!result.id && !result.orderId && !result.success)) {
                throw new Error(`Purchase failed: Invalid response from NiceHash (no order ID returned)`);
            }

            console.log(`✅ Solo package auto-purchased successfully - Order ID: ${result.id || result.orderId || 'N/A'}`);

            // ✅ ONLY save data after confirming purchase was successful
            // Mark this package as auto-bought (use order ID from API response, not ticket ID)
            const packageId = result.id || result.orderId;
            const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};
            autoBoughtPackages[packageId] = {
                type: 'solo',
                timestamp: Date.now(),
                price: parseFloat(pkg.price) || 0,
                orderId: result.id || result.orderId
            };
            localStorage.setItem(`${loggedInUser}_autoBoughtPackages`, JSON.stringify(autoBoughtPackages));

            // Update lastBuyTime and save
            autoBuy.lastBuyTime = Date.now();
            localStorage.setItem(`${loggedInUser}_soloAutoBuy`, JSON.stringify(autoBuySettings));

            console.log(`✅ AUTO-BUY COMPLETED: ${pkg.name}`);
            console.log(`   Order ID: ${result.id || result.orderId || 'N/A'}`);
            console.log(`   Crypto: ${pkg.crypto}`);
            console.log(`   Price: ${pkg.price} BTC`);
            const cooldownHours = (cooldownMs / 3600000).toFixed(1);
            const cooldownType = smartCooldownsEnabled ? 'package duration' : '10min default';
            console.log(`   ⏳ Next auto-buy available in ${cooldownHours} hours (${cooldownType} cooldown)`);

            // ✅ Update stats (same as manual buy)
            const btcPrice = window.packageCryptoPrices?.['btc']?.aud || 140000;
            const packagePrice = parseFloat(pkg.price) || 0;

            easyMiningData.allTimeStats.totalSpent += packagePrice * btcPrice;
            easyMiningData.todayStats.totalSpent += packagePrice * btcPrice;
            localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

            // Refresh package data
            await fetchEasyMiningData();
        } catch (error) {
            console.error(`❌ Auto-buy failed for ${pkg.name}:`, error.message, error);
        }
    }
}

async function executeAutoBuyTeam(recommendations) {
    console.log('🤖 Checking for team auto-buy opportunities...');

    const autoBuySettings = JSON.parse(localStorage.getItem(`${loggedInUser}_teamAutoBuy`)) || {};

    // Check if smart cooldowns are enabled (default: true)
    const easyMiningSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || {};
    const smartCooldownsEnabled = easyMiningSettings.autoBuyCooldown !== undefined ? easyMiningSettings.autoBuyCooldown : true;

    for (const pkg of recommendations) {
        const autoBuy = autoBuySettings[pkg.name];

        if (!autoBuy || !autoBuy.enabled) {
            continue; // Auto-buy not enabled for this package
        }

        // 🔒 TG Safe Hold: Check if auto-buy should be paused to protect Team Gold balance
        if (shouldPauseAutoBuyForTgSafeHold(pkg.name)) {
            continue; // Skip this auto-buy (balance reserved for Team Gold)
        }

        // Get package ID for tracking
        const packageId = pkg.apiData?.id || pkg.currencyAlgoTicket?.id || pkg.id;

        // ✅ Smart Cooldown Toggle Logic
        if (!smartCooldownsEnabled) {
            // When smart cooldowns are OFF: Track by package ID (one buy per package ID)
            const boughtPackageIds = JSON.parse(localStorage.getItem(`${loggedInUser}_teamBoughtPackageIds`)) || {};

            if (boughtPackageIds[packageId]) {
                console.log(`⏸️ ${pkg.name}: Already bought this package ID (${packageId}), skipping (smart cooldowns OFF)`);
                continue;
            }
        } else {
            // When smart cooldowns are ON: Use duration + starting countdown logic
            // ✅ FIX: Team package cooldown = packageDuration + startingCountdown (or +1hr if no starting countdown)
            // packageDuration is in seconds, convert to milliseconds
            const packageDurationMs = (pkg.packageDuration || 3600) * 1000; // Default to 1 hour if not available

            // Calculate time until package starts (starting countdown)
            let startingCountdownMs = 0;
            if (pkg.lifeTimeTill) {
                const startTime = new Date(pkg.lifeTimeTill);
                const now = new Date();
                const timeUntilStart = startTime - now;

                if (timeUntilStart > 0) {
                    // Package hasn't started yet - use actual countdown time
                    startingCountdownMs = timeUntilStart;
                    console.log(`📅 ${pkg.name}: Starting in ${Math.ceil(timeUntilStart / 60000)} minutes`);
                } else {
                    // Package already started or no countdown - use 1hr fallback
                    startingCountdownMs = 60 * 60 * 1000; // 1 hour fallback
                    console.log(`📅 ${pkg.name}: Already started or no countdown, using 1hr fallback`);
                }
            } else {
                // No lifeTimeTill field - use 1hr fallback
                startingCountdownMs = 60 * 60 * 1000; // 1 hour fallback
                console.log(`📅 ${pkg.name}: No starting countdown available, using 1hr fallback`);
            }

            // Total cooldown = package duration + starting countdown (or fallback)
            const cooldownMs = packageDurationMs + startingCountdownMs;

            // Check cooldown
            if (autoBuy.lastBuyTime) {
                const timeSinceLastBuy = Date.now() - autoBuy.lastBuyTime;
                if (timeSinceLastBuy < cooldownMs) {
                    const remainingMinutes = Math.ceil((cooldownMs - timeSinceLastBuy) / 60000);
                    const cooldownHours = (cooldownMs / 3600000).toFixed(1);
                    const startingCountdownHours = (startingCountdownMs / 3600000).toFixed(1);
                    console.log(`⏳ ${pkg.name}: Cooldown active (${remainingMinutes} minutes remaining of ${cooldownHours}hr total cooldown = duration + ${startingCountdownHours}hr starting countdown)`);
                    continue;
                }
            }
        }

        // Execute auto-buy
        const shares = autoBuy.shares || 1;
        const sharePrice = 0.0001;
        const totalAmount = shares * sharePrice;

        console.log(`🤖 AUTO-BUY TRIGGERED: ${pkg.name} (${shares} shares = ${totalAmount} BTC)`);

        try {
            // Auto-buy: skip confirmation, call the purchase API directly
            if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
                console.error('❌ EasyMining not configured');
                continue;
            }

            // Sync time before purchase
            await syncNiceHashTime();

            // Get package ID - use CONSISTENT logic across all locations
            // This ensures auto-bought shares sync with manual purchases
            const packageId = pkg.apiData?.id || pkg.currencyAlgoTicket?.id || pkg.id;
            const endpoint = `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`;

            console.log(`📦 Auto-buy package ID:`, {
                'pkg.id': pkg.id,
                'pkg.apiData?.id': pkg.apiData?.id,
                'pkg.currencyAlgoTicket?.id': pkg.currencyAlgoTicket?.id,
                'Selected packageId': packageId
            });

            // Check if this is a dual-crypto package (Palladium DOGE+LTC)
            const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCrypto && pkg.mainCrypto);

            // Get withdrawal addresses for the crypto(s)
            let mainWalletAddress, mergeWalletAddress;
            let mainCrypto, mergeCrypto;

            if (isDualCrypto) {
                // Dual-crypto package: need BOTH addresses
                mainCrypto = pkg.mainCrypto || 'LTC';
                mergeCrypto = pkg.mergeCrypto || 'DOGE';
                mainWalletAddress = getWithdrawalAddress(mainCrypto);
                mergeWalletAddress = getWithdrawalAddress(mergeCrypto);

                if (!mainWalletAddress) {
                    console.error(`❌ No withdrawal address configured for ${mainCrypto}`);
                    continue;
                }
                if (!mergeWalletAddress) {
                    console.error(`❌ No withdrawal address configured for ${mergeCrypto}`);
                    continue;
                }
            } else {
                // Single crypto package: need ONE address
                mainCrypto = pkg.crypto || pkg.currencyAlgo?.title || 'Unknown';
                mainWalletAddress = getWithdrawalAddress(mainCrypto);

                if (!mainWalletAddress) {
                    console.error(`❌ No withdrawal address configured for ${mainCrypto}`);
                    continue;
                }
            }

            // Create order payload with wallet address(es), amount, and shares object
            const bodyData = {
                amount: totalAmount,
                shares: {
                    small: shares,
                    medium: 0,
                    large: 0,
                    couponSmall: 0,
                    couponMedium: 0,
                    couponLarge: 0,
                    massBuy: 0
                },
                soloMiningRewardAddr: mainWalletAddress.trim()
            };

            // Add merge address for dual-crypto packages
            if (isDualCrypto && mergeWalletAddress) {
                bodyData.mergeSoloMiningRewardAddr = mergeWalletAddress.trim();
            }

            const body = JSON.stringify(bodyData);
            const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

            console.log(`📡 Auto-buy request: ${shares} shares (${totalAmount} BTC)`, {
                isDualCrypto: isDualCrypto,
                mainCrypto: mainCrypto,
                mainWallet: mainWalletAddress.substring(0, 10) + '...',
                mergeCrypto: mergeCrypto || 'N/A',
                mergeWallet: mergeWalletAddress ? mergeWalletAddress.substring(0, 10) + '...' : 'N/A',
                bodyData: bodyData
            });

            let response;
            if (USE_VERCEL_PROXY) {
                response = await fetch(VERCEL_PROXY_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        endpoint: endpoint,
                        method: 'POST',
                        headers: headers,
                        body: bodyData
                    })
                });
            } else {
                response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                    method: 'POST',
                    headers: headers,
                    body: body
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `API Error: ${response.status}`);
            }

            const result = await response.json();
            console.log('📦 Team auto-buy response:', result);

            // Validate response indicates success (check for order ID or success indicators)
            if (!result || (!result.id && !result.orderId && !result.success)) {
                throw new Error(`Purchase failed: Invalid response from NiceHash (no order ID returned)`);
            }

            console.log(`✅ AUTO-BUY COMPLETED: ${pkg.name} with ${shares} share(s). Order ID: ${result.id || result.orderId || 'N/A'}`);

            // ✅ ONLY save data after confirming purchase was successful
            // Save bought shares (add to existing)
            const currentShares = getMyTeamShares(packageId) || 0;
            const newTotalShares = currentShares + shares;
            saveMyTeamShares(packageId, newTotalShares);
            console.log(`💾 Saved team shares: ${newTotalShares} (was ${currentShares}, added ${shares})`);

            // Mark this package as auto-bought (use order ID from API response, not ticket ID)
            const orderIdReturned = result.id || result.orderId;
            const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};
            autoBoughtPackages[orderIdReturned] = {
                type: 'team',
                packageName: pkg.name,  // Store package name for fallback matching when countdown → active
                timestamp: Date.now(),
                shares: shares,
                amount: totalAmount,
                orderId: orderIdReturned,
                ticketId: packageId  // Store ticket ID for reference but use order ID as key
            };
            localStorage.setItem(`${loggedInUser}_autoBoughtPackages`, JSON.stringify(autoBoughtPackages));

            // Log storage for debugging
            console.log(`🤖 TEAM AUTO-BUY STORED:`, {
                key: orderIdReturned,
                packageName: pkg.name,
                ticketId: packageId,
                shares: shares,
                timestamp: new Date().toISOString()
            });

            // Update lastBuyTime
            autoBuy.lastBuyTime = Date.now();
            localStorage.setItem(`${loggedInUser}_teamAutoBuy`, JSON.stringify(autoBuySettings));

            // ✅ If smart cooldowns are OFF, mark this package ID as bought
            if (!smartCooldownsEnabled) {
                const boughtPackageIds = JSON.parse(localStorage.getItem(`${loggedInUser}_teamBoughtPackageIds`)) || {};
                boughtPackageIds[packageId] = {
                    name: pkg.name,
                    timestamp: Date.now(),
                    shares: shares
                };
                localStorage.setItem(`${loggedInUser}_teamBoughtPackageIds`, JSON.stringify(boughtPackageIds));
                console.log(`   ✅ Marked package ID ${packageId} as bought (smart cooldowns OFF - one buy per package ID)`);
            }

            // Update stats
            const btcPrice = window.packageCryptoPrices?.['btc']?.aud || 140000;
            const totalPriceAUD = totalAmount * btcPrice;
            easyMiningData.allTimeStats.totalSpent += totalPriceAUD;
            easyMiningData.todayStats.totalSpent += totalPriceAUD;
            localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

            // Show cooldown message (only when smart cooldowns are ON)
            if (smartCooldownsEnabled) {
                const cooldownHours = (cooldownMs / 3600000).toFixed(1);
                const durationHours = (packageDurationMs / 3600000).toFixed(1);
                const startingCountdownHours = (startingCountdownMs / 3600000).toFixed(1);
                console.log(`   ⏳ Next auto-buy available in ${cooldownHours} hours (${durationHours}hr duration + ${startingCountdownHours}hr starting countdown)`);
            }

            // Refresh package data
            await fetchEasyMiningData();

            // Force UI refresh in both Buy Packages page and Team Alerts
            console.log('🔄 Forcing UI refresh after auto-buy...');

            // 1. Refresh Buy Packages modal if it's currently open
            const buyPackagesModal = document.getElementById('buy-packages-modal');
            if (buyPackagesModal && buyPackagesModal.style.display === 'block') {
                console.log('📦 Refreshing Buy Packages modal...');
                await loadBuyPackagesData();
            }

            // 2. Refresh Team Alerts in EasyMining section
            console.log('📊 Refreshing team alerts in EasyMining section...');
            await updateRecommendations();

            console.log('✅ UI refresh complete - share counts updated everywhere');
        } catch (error) {
            console.error(`❌ Auto-buy failed for ${pkg.name}:`, error.message, error);
        }
    }
}

async function updateRecommendations() {
    const bestPackagesContainer = document.getElementById('best-packages-container');
    const teamAlertsContainer = document.getElementById('team-alerts-container');

    console.log('🔄 Checking for recommendation updates...');

    // Fetch balance for buy button validation in EasyMining section
    try {
        const balanceData = await fetchNiceHashBalances();
        window.niceHashBalance = {
            available: balanceData.available || 0,
            pending: balanceData.pending || 0
        };
        console.log('✅ Balance fetched for EasyMining recommendations:', window.niceHashBalance);
    } catch (error) {
        console.error('❌ Failed to fetch balance for recommendations:', error);
        window.niceHashBalance = { available: 0, pending: 0 };
    }

    // Get recommended solo packages based on alert thresholds
    const recommendations = await checkPackageRecommendations();

    // Get recommended team packages based on alert thresholds
    const teamRecommendations = await checkTeamRecommendations();

    // Execute auto-buy for any new recommendations (with cooldown check)
    await executeAutoBuySolo(recommendations);
    await executeAutoBuyTeam(teamRecommendations);

    // Fetch crypto prices once for ALL packages (prevents race condition)
    const allPackages = [...recommendations, ...teamRecommendations];
    if (allPackages.length > 0) {
        window.packageCryptoPrices = await fetchPackageCryptoPrices(allPackages);
        console.log('✅ Fetched crypto prices for all alert packages:', Object.keys(window.packageCryptoPrices));
    }

    // Check if solo recommendations actually changed
    const recommendationNames = recommendations.map(pkg => pkg.name).sort().join(',');
    const currentNames = currentRecommendations.map(pkg => pkg.name).sort().join(',');

    // Check if team recommendations actually changed
    const teamRecommendationNames = teamRecommendations.map(pkg => pkg.name).sort().join(',');
    const currentTeamNames = currentTeamRecommendations.map(pkg => pkg.name).sort().join(',');

    const soloChanged = recommendationNames !== currentNames;
    const teamChanged = teamRecommendationNames !== currentTeamNames;

    if (!soloChanged && !teamChanged) {
        console.log('✅ Recommendations list unchanged, updating values only...');

        // Update probability and hashrate values without re-rendering cards
        recommendations.forEach(pkg => {
            if (!pkg.isTeam) { // Only solo packages
                updateSoloAlertCardValues(pkg);
            }
        });

        return; // Skip full re-render
    }

    console.log('🔄 Recommendations changed, updating display...');

    // Play alert sounds for NEW package alerts (once per new alert)
    if (soloChanged && recommendations.length > 0) {
        // Check for new solo package alerts
        const newSoloAlerts = recommendations.filter(pkg => !alertedSoloPackages.has(pkg.name));
        if (newSoloAlerts.length > 0) {
            console.log(`🔔 New solo package alert(s): ${newSoloAlerts.map(p => p.name).join(', ')}`);
            playSound('solo-pkg-alert-sound');
            if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate([100, 50, 100]); // Double vibrate for alert
            }
            // Mark these packages as alerted
            newSoloAlerts.forEach(pkg => alertedSoloPackages.add(pkg.name));
        }
    }

    if (teamChanged && teamRecommendations.length > 0) {
        // Check for new team package alerts
        const newTeamAlerts = teamRecommendations.filter(pkg => !alertedTeamPackages.has(pkg.name));
        if (newTeamAlerts.length > 0) {
            console.log(`🔔 New team package alert(s): ${newTeamAlerts.map(p => p.name).join(', ')}`);
            playSound('team-pkg-alert-sound');
            if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
                navigator.vibrate([100, 50, 100]); // Double vibrate for alert
            }
            // Mark these packages as alerted
            newTeamAlerts.forEach(pkg => alertedTeamPackages.add(pkg.name));
        }
    }

    // Clean up alerted packages that are no longer in recommendations
    if (recommendations.length === 0) {
        alertedSoloPackages.clear();
    } else {
        const currentSoloNames = new Set(recommendations.map(pkg => pkg.name));
        alertedSoloPackages.forEach(name => {
            if (!currentSoloNames.has(name)) {
                alertedSoloPackages.delete(name);
            }
        });
    }

    if (teamRecommendations.length === 0) {
        alertedTeamPackages.clear();
    } else {
        const currentTeamNames = new Set(teamRecommendations.map(pkg => pkg.name));
        alertedTeamPackages.forEach(name => {
            if (!currentTeamNames.has(name)) {
                alertedTeamPackages.delete(name);
            }
        });
    }

    // Update solo recommendations if changed OR if container is empty (first load)
    const isSoloContainerEmpty = bestPackagesContainer && bestPackagesContainer.innerHTML.trim() === '';
    console.log(`🔍 Solo update check: soloChanged=${soloChanged}, isSoloContainerEmpty=${isSoloContainerEmpty}, recommendations.length=${recommendations.length}`);

    if (soloChanged || isSoloContainerEmpty) {
        currentRecommendations = recommendations;
        if (bestPackagesContainer) {
            console.log(`🔍 Updating solo alerts container, recommendations: ${recommendations.length}`);
            bestPackagesContainer.innerHTML = '';

            if (recommendations.length === 0) {
                // Check if any alerts are configured
                const savedAlerts = JSON.parse(localStorage.getItem(`${loggedInUser}_soloPackageAlerts`)) || {};
                const hasAlerts = Object.keys(savedAlerts).length > 0;

                if (!hasAlerts) {
                    bestPackagesContainer.innerHTML = '<p style="color: #aaa; text-align: center;"><a href="#" onclick="showPackageAlertsPage(); return false;" style="color: #ffa500;">Configure solo alerts</a> to get package recommendations.</p>';
                } else {
                    bestPackagesContainer.innerHTML = '<p style="color: #aaa; text-align: center;">No solo packages currently meet your alert thresholds.</p>';
                }
            } else {
                // Crypto prices already fetched for all packages above (prevents race condition)
                console.log(`✅ Displaying ${recommendations.length} recommended solo package(s)`);

                // Display each recommended package using the same card format as buy packages
                recommendations.forEach(pkg => {
                    const card = createBuyPackageCardForPage(pkg, true); // true = isRecommended
                    bestPackagesContainer.appendChild(card);
                });
            }
        }
    }

    // Update team recommendations if changed OR if container is empty (first load)
    const isTeamContainerEmpty = teamAlertsContainer && teamAlertsContainer.innerHTML.trim() === '';
    console.log(`🔍 Team update check: teamChanged=${teamChanged}, isTeamContainerEmpty=${isTeamContainerEmpty}, teamRecommendations.length=${teamRecommendations.length}`);

    if (teamChanged || isTeamContainerEmpty) {
        currentTeamRecommendations = teamRecommendations;
        if (teamAlertsContainer) {
            console.log(`🔍 Updating team alerts container, recommendations: ${teamRecommendations.length}`);
            teamAlertsContainer.innerHTML = '';

            if (teamRecommendations.length === 0) {
                // Check if any team alerts are configured
                const savedTeamAlerts = JSON.parse(localStorage.getItem(`${loggedInUser}_teamPackageAlerts`)) || {};
                const hasTeamAlerts = Object.keys(savedTeamAlerts).length > 0;

                if (!hasTeamAlerts) {
                    teamAlertsContainer.innerHTML = '<p style="color: #aaa; text-align: center;"><a href="#" onclick="showPackageAlertsPage(); return false;" style="color: #ffa500;">Configure team alerts</a> to get package recommendations.</p>';
                } else {
                    teamAlertsContainer.innerHTML = '<p style="color: #aaa; text-align: center;">No team packages currently meet your alert thresholds.</p>';
                }
            } else {
                // Crypto prices already fetched for all packages above (prevents race condition)
                console.log(`✅ Displaying ${teamRecommendations.length} recommended team package(s)`, teamRecommendations);

                // Display each recommended team package using dedicated team alert card function
                // STABLE VERSION: Team alerts working correctly with createTeamPackageRecommendationCard
                teamRecommendations.forEach((pkg, index) => {
                    console.log(`🔍 Creating team alert card ${index + 1}/${teamRecommendations.length} for:`, pkg.name);
                    const card = createTeamPackageRecommendationCard(pkg);
                    if (card) {
                        teamAlertsContainer.appendChild(card);
                        console.log(`✅ Team alert card ${index + 1} added to container`);
                    } else {
                        console.error(`❌ Failed to create team alert card ${index + 1} for:`, pkg.name);
                    }
                });
            }
        } else {
            console.error('❌ teamAlertsContainer not found!');
        }
    } else {
        console.log(`⏭️ Skipping team update (no changes detected)`);
    }

    console.log('✅ Recommendations updated successfully');
}

/**
 * Update probability and hashrate values on solo alert cards without re-rendering the entire card
 * This prevents card flashing while keeping data fresh
 */
function updateSoloAlertCardValues(pkg) {
    const packageIdForElements = pkg.name.replace(/\s+/g, '-');

    // Update probability values
    if (pkg.isDualCrypto) {
        // Dual-crypto package: update both probabilities
        const mergeProbElement = document.getElementById(`merge-probability-${packageIdForElements}`);
        const mainProbElement = document.getElementById(`main-probability-${packageIdForElements}`);

        if (mergeProbElement) {
            mergeProbElement.textContent = `${pkg.mergeProbability} ${pkg.mergeCrypto}`;
        }
        if (mainProbElement) {
            mainProbElement.textContent = `${pkg.mainProbability} ${pkg.mainCrypto}`;
        }
    } else if (pkg.probability) {
        // Single crypto package: update one probability
        const probElement = document.getElementById(`probability-${packageIdForElements}`);
        if (probElement) {
            probElement.textContent = pkg.probability;
        }
    }

    // Update hashrate
    const hashrateElement = document.getElementById(`hashrate-${packageIdForElements}`);
    if (hashrateElement && pkg.hashrate) {
        hashrateElement.textContent = pkg.hashrate;
    }

    console.log(`✅ Updated values for ${pkg.name}: probability=${pkg.probability || `${pkg.mergeProbability}/${pkg.mainProbability}`}, hashrate=${pkg.hashrate}`);
}

function createTeamPackageRecommendationCard(pkg) {
    const card = document.createElement('div');
    card.className = 'buy-package-card recommended team-package';

    // Use package crypto prices (fetched specifically for buy packages page)
    const prices = window.packageCryptoPrices || {};

    // Calculate reward in AUD based on crypto prices
    let rewardAUD = 0;
    let mainRewardAUD = 0;
    let mergeRewardAUD = 0;

    if (pkg.isDualCrypto) {
        // Dual-crypto package (e.g., DOGE+LTC)
        try {
            // Calculate main crypto reward (LTC)
            const mainCryptoKey = pkg.mainCrypto.toLowerCase();
            if (prices[mainCryptoKey] && prices[mainCryptoKey].aud) {
                mainRewardAUD = parseFloat((pkg.blockReward * prices[mainCryptoKey].aud).toFixed(2));
            }

            // Calculate merge crypto reward (DOGE)
            const mergeCryptoKey = pkg.mergeCrypto.toLowerCase();
            if (prices[mergeCryptoKey] && prices[mergeCryptoKey].aud) {
                mergeRewardAUD = parseFloat((pkg.mergeBlockReward * prices[mergeCryptoKey].aud).toFixed(2));
            }

            // Total reward in AUD
            rewardAUD = (mainRewardAUD + mergeRewardAUD).toFixed(2);
        } catch (error) {
            console.log('Could not calculate dual crypto reward AUD:', error);
            rewardAUD = 0;
        }
    } else {
        // Single crypto package
        if (pkg.blockReward && pkg.crypto) {
            try {
                const cryptoKey = pkg.crypto.toLowerCase();
                if (prices[cryptoKey] && prices[cryptoKey].aud) {
                    rewardAUD = (pkg.blockReward * prices[cryptoKey].aud).toFixed(2);
                }
            } catch (error) {
                console.log('Could not calculate reward AUD:', error);
                rewardAUD = 0;
            }
        }
    }

    // Calculate package price in AUD from BTC price using live portfolio BTC price
    let priceAUD = 0;
    const sharePrice = 0.0001;
    try {
        // Get LIVE BTC price from portfolio page (same as buy packages page)
        priceAUD = convertBTCtoAUD(sharePrice).toFixed(2);
    } catch (error) {
        console.log('Could not calculate price AUD:', error);
        priceAUD = 0;
    }

    // For team packages: show shares, participants, and countdown
    let countdownInfo = '';
    const participants = pkg.numberOfParticipants || 0;

    if (pkg.lifeTimeTill) {
        // Calculate time until start
        const startTime = new Date(pkg.lifeTimeTill);
        const now = new Date();
        const timeUntilStart = startTime - now;

        if (timeUntilStart > 0) {
            // Package hasn't started yet
            // Countdown kicks in when numberOfParticipants reaches 2

            // Show "Mining Lobby" when package has < 2 participants (waiting for players)
            // Show "Starting Soon!" when countdown is ending (< 60 seconds)
            // Show timer when participants >= 2 and countdown is active (>= 60 seconds)
            if (participants < 2) {
                // Waiting in lobby - show "Mining Lobby"
                countdownInfo = `
                    <div class="buy-package-stat">
                        <span>Starting:</span>
                        <span id="countdown-${pkg.id}" class="mining-lobby-fade" style="color: #FFA500; font-weight: bold;">Mining Lobby</span>
                    </div>
                `;
                console.log(`📅 ${pkg.name} alert - Participants: ${participants} (< 2) → Mining Lobby`);
            } else if (timeUntilStart < 60000) {
                // Countdown ending (< 60 seconds) - show "Starting Soon!"
                countdownInfo = `
                    <div class="buy-package-stat">
                        <span>Starting:</span>
                        <span id="countdown-${pkg.id}" style="color: #4CAF50; font-weight: bold;">Starting Soon!</span>
                    </div>
                `;
                console.log(`📅 ${pkg.name} alert - Participants: ${participants}, Time: ${Math.floor(timeUntilStart/1000)}s → Starting Soon!`);
            } else {
                // Countdown is active - show timer
                const hours = Math.floor(timeUntilStart / (1000 * 60 * 60));
                const minutes = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeUntilStart % (1000 * 60)) / 1000);

                countdownInfo = `
                    <div class="buy-package-stat">
                        <span>Starting:</span>
                        <span id="countdown-${pkg.id}" style="color: #FFA500;">${hours}h ${minutes}m ${seconds}s</span>
                    </div>
                `;
                console.log(`📅 ${pkg.name} alert - Participants: ${participants} (>= 2) → Countdown: ${hours}h ${minutes}m ${seconds}s`);
            }
        } else {
            // Countdown has ended - show "Starting Soon!" until package goes active
            countdownInfo = `
                <div class="buy-package-stat">
                    <span>Starting:</span>
                    <span id="countdown-${pkg.id}" style="color: #4CAF50; font-weight: bold;">Starting Soon!</span>
                </div>
            `;
            console.log(`📅 ${pkg.name} alert - Countdown ended → Starting Soon!`);
        }
    } else if (participants < 2) {
        // No lifeTimeTill set yet, but show "Mining Lobby" if < 2 participants
        countdownInfo = `
            <div class="buy-package-stat">
                <span>Starting:</span>
                <span id="countdown-${pkg.id}" class="mining-lobby-fade" style="color: #FFA500; font-weight: bold;">Mining Lobby</span>
            </div>
        `;
        console.log(`📅 ${pkg.name} alert - No lifeTimeTill, Participants: ${participants} (< 2) → Mining Lobby`);
    }

    const sharesInfo = `
        <div class="buy-package-stat">
            <span>Participants:</span>
            <span style="color: #4CAF50;">${pkg.numberOfParticipants || 0}</span>
        </div>
        <div class="buy-package-stat">
            <span>Share Distribution:</span>
            <span style="color: #ffa500;">${(() => {
                const totalBoughtShares = pkg.addedAmount ? Math.round(pkg.addedAmount * 10000) : 0;
                const totalAvailableShares = pkg.fullAmount ? Math.round(pkg.fullAmount * 10000) : 0;
                // Use same ID logic as when saving shares
                const packageId = pkg.apiData?.id || pkg.id;
                const myBoughtShares = getMyTeamShares(packageId) || 0;
                return `(${myBoughtShares}/${totalBoughtShares}/${totalAvailableShares})`;
            })()}</span>
        </div>
        ${countdownInfo}
    `;

    // Probability section - handle dual-crypto packages
    let probabilityInfo = '';
    if (pkg.isDualCrypto) {
        // For team dual-crypto packages, show on separate lines
        probabilityInfo = `
            <div class="buy-package-stat">
                <span>Probability ${pkg.mergeCrypto}:</span>
                <span>${pkg.mergeProbability}</span>
            </div>
            <div class="buy-package-stat">
                <span>Probability ${pkg.mainCrypto}:</span>
                <span>${pkg.mainProbability}</span>
            </div>
        `;
    } else if (pkg.probability) {
        // Single crypto package
        probabilityInfo = `
            <div class="buy-package-stat">
                <span>Probability:</span>
                <span>${pkg.probability}</span>
            </div>
        `;
    }

    // Potential reward section - handle dual-crypto packages
    let rewardInfo = '';
    const packageId = pkg.name.replace(/\s+/g, '-');

    if (pkg.isDualCrypto) {
        // Calculate rewards for 1 share using division formula
        let myMergeReward = pkg.mergeBlockReward || 0;
        let myMainReward = pkg.blockReward || 0;
        let myRewardValueAUD = parseFloat(rewardAUD);

        if (pkg.addedAmount !== undefined) {
            const totalBoughtShares = Math.round((pkg.addedAmount || 0) * 10000); // Total bought by everyone
            // Use same ID logic as when saving shares
            const packageId = pkg.apiData?.id || pkg.id;
            const myBoughtShares = getMyTeamShares(packageId) || 0; // My previously bought shares
            const myShares = 1; // Initial display for 1 share

            // Correct formula: blockReward ÷ ((totalBought - myBought) + myShares) × myShares
            const othersBought = totalBoughtShares - myBoughtShares;
            const totalShares = othersBought + myShares;

            const mergeRewardPerShare = totalShares > 0 ? (pkg.mergeBlockReward || 0) / totalShares : 0;
            const mainRewardPerShare = totalShares > 0 ? (pkg.blockReward || 0) / totalShares : 0;
            const rewardValuePerShareAUD = totalShares > 0 ? parseFloat(rewardAUD) / totalShares : 0;

            myMergeReward = mergeRewardPerShare * myShares;
            myMainReward = mainRewardPerShare * myShares;
            myRewardValueAUD = rewardValuePerShareAUD * myShares;

            console.log(`💰 ${pkg.name} Dual-Crypto Reward (Alert):
            - Total Bought: ${totalBoughtShares}, My Bought: ${myBoughtShares}, Buying: ${myShares}
            - Others: ${othersBought}, Pool: ${totalShares}
            - ${pkg.mergeCrypto} Block: ${pkg.mergeBlockReward}, My Reward: ${myMergeReward.toFixed(2)}
            - ${pkg.mainCrypto} Block: ${pkg.blockReward}, My Reward: ${myMainReward.toFixed(4)}`);
        }

        // Show both rewards for dual-crypto packages (DOGE+LTC)
        const mergeDecimals = pkg.mergeCrypto === 'LTC' ? 2 : 0;
        rewardInfo = `
            <div class="buy-package-stat">
                <span>Reward ${pkg.mergeCrypto}:</span>
                <span id="merge-reward-${packageId}" style="color: #4CAF50;">${myMergeReward.toFixed(mergeDecimals)} ${pkg.mergeCrypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Reward ${pkg.mainCrypto}:</span>
                <span id="main-reward-${packageId}" style="color: #4CAF50;">${myMainReward.toFixed(4)} ${pkg.mainCrypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Reward Value:</span>
                <span id="reward-value-${packageId}" style="color: #4CAF50;">$${myRewardValueAUD.toFixed(2)} AUD</span>
            </div>
        `;
    } else if (pkg.blockReward) {
        // Single crypto package - calculate reward for 1 share using division formula
        let myMainReward = pkg.blockReward;
        let myRewardValueAUD = parseFloat(rewardAUD);

        if (pkg.addedAmount !== undefined) {
            const totalBoughtShares = Math.round((pkg.addedAmount || 0) * 10000); // Total bought by everyone
            // Use same ID logic as when saving shares
            const packageId = pkg.apiData?.id || pkg.id;
            const myBoughtShares = getMyTeamShares(packageId) || 0; // My previously bought shares
            const myShares = 1; // Initial display for 1 share

            // Correct formula: blockReward ÷ ((totalBought - myBought) + myShares) × myShares
            const othersBought = totalBoughtShares - myBoughtShares;
            const totalShares = othersBought + myShares;

            const mainRewardPerShare = totalShares > 0 ? pkg.blockReward / totalShares : 0;
            const rewardValuePerShareAUD = totalShares > 0 ? parseFloat(rewardAUD) / totalShares : 0;

            myMainReward = mainRewardPerShare * myShares;
            myRewardValueAUD = rewardValuePerShareAUD * myShares;

            console.log(`💰 ${pkg.name} Single-Crypto Reward (Alert):
            - Total Bought: ${totalBoughtShares}, My Bought: ${myBoughtShares}, Buying: ${myShares}
            - Others: ${othersBought}, Pool: ${totalShares}
            - Block Reward: ${pkg.blockReward}, My Reward: ${myMainReward.toFixed(8)}`);
        }

        rewardInfo = `
            <div class="buy-package-stat">
                <span>Reward:</span>
                <span id="main-reward-${packageId}" style="color: #4CAF50;">${myMainReward.toFixed(pkg.crypto === 'BTC' || pkg.crypto === 'BCH' ? 4 : 2)} ${pkg.crypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Reward Value:</span>
                <span id="reward-value-${packageId}" style="color: #4CAF50;">$${myRewardValueAUD.toFixed(2)} AUD</span>
            </div>
        `;
    }

    // Get available balance from fetched NiceHash balance
    const availableBalance = window.niceHashBalance?.available || 0;

    // Get user's current bought shares - use same ID logic as when saving
    const alertPackageId = pkg.apiData?.id || pkg.id;
    const myCurrentShares = getMyTeamShares(alertPackageId) || 0;
    const initialShareValue = myCurrentShares || 1; // Input starts at owned shares, or 1 if none owned
    console.log(`📊 Team alert "${pkg.name}" - ID: ${alertPackageId}, My shares: ${myCurrentShares}, Initial value: ${initialShareValue}`);

    // Calculate share data for team packages (matching buy packages page)
    const totalBoughtShares = pkg.addedAmount && pkg.addedAmount > 0 ? Math.round(pkg.addedAmount * 10000) : 0;
    const totalAvailableShares = pkg.fullAmount ? Math.round(pkg.fullAmount * 10000) : 9999;
    const blockReward = pkg.blockReward || 0;

    // Recalculate initial price to show cost of all shares in input (total, not new)
    priceAUD = convertBTCtoAUD(initialShareValue * sharePrice).toFixed(2);

    // For team packages: add share selector with buy button on same row
    // NO initial disabled states - let adjustShares() handle button states dynamically
    const teamShareSelector = `
        <div class="share-adjuster">
            <button onclick="adjustShares('${pkg.name}', -1, this)" class="share-adjuster-btn">-</button>
            <input
                type="number"
                id="shares-${pkg.name.replace(/\s+/g, '-')}"
                value="${initialShareValue}"
                min="${myCurrentShares || 1}"
                max="9999"
                class="share-adjuster-input"
                readonly
                data-block-reward="${blockReward}"
                data-total-bought="${totalBoughtShares}"
                data-my-bought="${myCurrentShares}"
                data-total-available="${totalAvailableShares}"
                data-crypto="${pkg.crypto}"
            >
            <button id="plus-${pkg.name.replace(/\s+/g, '-')}" onclick="adjustShares('${pkg.name}', 1, this)" class="share-adjuster-btn">+</button>
            <button class="buy-now-btn" style="margin-left: 10px;" onclick='buyPackageFromPage(${JSON.stringify(pkg)})'>Buy</button>
        </div>
        ${myCurrentShares > 0 ? `
        <button class="buy-now-btn" style="background-color: #d32f2f; margin-top: 10px; width: 100%;" onclick="clearTeamSharesManual('${alertPackageId}', '${pkg.name}')">Clear Shares</button>
        ` : ''}
    `;

    // Auto-buy robot icon logic
    const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};
    let isAutoBought = null;
    let matchMethod = 'none';

    // Level 1: Direct ID match (pkg.id = order ID)
    isAutoBought = autoBoughtPackages[pkg.id];
    if (isAutoBought) matchMethod = 'direct-id';

    // Level 2: Check orderId/ticketId fields in stored entries
    if (!isAutoBought) {
        isAutoBought = Object.values(autoBoughtPackages).find(entry =>
            entry.orderId === pkg.id || entry.ticketId === pkg.id
        );
        if (isAutoBought) matchMethod = 'orderId-ticketId';
    }

    // Level 3: For team packages - match by package name + recent purchase (within 7 days)
    if (!isAutoBought) {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        isAutoBought = Object.values(autoBoughtPackages).find(entry =>
            entry.type === 'team' &&
            entry.packageName === pkg.name &&
            entry.timestamp > sevenDaysAgo
        );
        if (isAutoBought) matchMethod = 'name-timestamp';
    }

    // Level 4: Check sharedTicket.id (team packages use shared ticket system)
    if (!isAutoBought && pkg.fullOrderData?.sharedTicket?.id) {
        const sharedTicketId = pkg.fullOrderData.sharedTicket.id;
        isAutoBought = Object.values(autoBoughtPackages).find(entry =>
            entry.ticketId === sharedTicketId
        );
        if (isAutoBought) matchMethod = 'sharedTicket-id';
    }

    // Countdown detection - reuse existing countdown detection logic
    const isCountdown = pkg.lifeTimeTill && (new Date(pkg.lifeTimeTill) - new Date() > 0);

    // Robot icon HTML
    let robotHtml = '';
    if (isAutoBought) {
        if (isCountdown) {
            robotHtml = '<div class="block-found-indicator auto-buy-robot countdown" title="Auto-bought by bot (starting soon)">🤖</div>';
            console.log(`🤖 Robot icon (countdown) added to ${pkg.name} alert - Match: ${matchMethod}`);
        } else {
            robotHtml = '<div class="block-found-indicator flashing auto-buy-robot" title="Auto-bought by bot">🤖</div>';
            console.log(`🤖 Robot icon (active) added to ${pkg.name} alert - Match: ${matchMethod}`);
        }
    }

    // Hashrate info - add if available
    const hashrateInfo = pkg.hashrate ? `
        <div class="buy-package-stat">
            <span>Hashrate:</span>
            <span>${pkg.hashrate}</span>
        </div>
    ` : '';

    card.innerHTML = `
        ${robotHtml}
        <h4>${pkg.name} ⭐</h4>
        <div class="buy-package-stats">
            ${probabilityInfo}
            ${hashrateInfo}
            <div class="buy-package-stat">
                <span>Duration:</span>
                <span>${pkg.duration}</span>
            </div>
            ${sharesInfo}
            ${rewardInfo}
            <div class="buy-package-stat">
                <span>Price:</span>
                <span id="price-${packageId}">$${priceAUD} AUD</span>
            </div>
        </div>
        ${teamShareSelector}
    `;

    // Store base values for team packages to enable dynamic updates
    if (!window.packageBaseValues) {
        window.packageBaseValues = {};
    }

    // Store total package rewards and calculate shares using addedAmount (total bought)
    // Price: 1 share = 0.0001 BTC - use convertBTCtoAUD for consistency
    const pricePerShareAUD = convertBTCtoAUD(sharePrice);

    // totalBoughtShares and myBoughtShares already calculated above - no need to redeclare

    // Store total block rewards
    const totalRewardAUD = parseFloat(rewardAUD) || 0;
    const totalMainReward = pkg.blockReward || 0;
    const totalMergeReward = pkg.mergeBlockReward || 0;

    console.log(`📊 ${pkg.name} alert package base values:`, {
        packageId: alertPackageId,
        addedAmount: pkg.addedAmount,
        fullAmount: pkg.fullAmount,
        totalBoughtShares: totalBoughtShares,
        myBoughtShares: myCurrentShares,
        totalRewardAUD: totalRewardAUD,
        totalMainReward: totalMainReward,
        totalMergeReward: totalMergeReward,
        pricePerShareAUD: pricePerShareAUD.toFixed(2)
    });

    window.packageBaseValues[pkg.name] = {
        packageId: alertPackageId,
        priceAUD: pricePerShareAUD,
        totalRewardAUD: totalRewardAUD,
        totalMainReward: totalMainReward,
        totalMergeReward: totalMergeReward,
        totalBoughtShares: totalBoughtShares,
        myBoughtShares: myCurrentShares,
        mainCrypto: pkg.mainCrypto || pkg.crypto,
        mergeCrypto: pkg.mergeCrypto,
        isDualCrypto: pkg.isDualCrypto
    };

    // Initialize share value to user's current shares (or 1 if none)
    if (!window.packageShareValues) {
        window.packageShareValues = {};
    }
    window.packageShareValues[pkg.name] = initialShareValue;

    console.log(`📦 Initialized team alert package base values for ${pkg.name}:`, window.packageBaseValues[pkg.name]);

    return card;
}

// NOTE: adjustShares() function is defined later in the file (line ~11379)
// It handles share adjustment for team packages on the buy packages page

// ✅ NEW: Buy team package directly from alert (wrapper for buyTeamPackage)
async function buyTeamPackageFromAlert(packageId, crypto, sharePrice, cardId, maxShares) {
    // This wraps the existing buyTeamPackage function
    // which already handles confirmation, API calls, and success/error handling
    await buyTeamPackage(packageId, crypto, sharePrice, cardId, maxShares);
}

function checkForNewBlocks() {
    console.log(`\n${'🔍'.repeat(40)}`);
    console.log(`🔍 CHECKFORNEWBLOCKS - Analyzing packages for block detection`);

    // Calculate total blocks found across ALL packages (confirmed + pending)
    const currentBlockCount = easyMiningData.activePackages.reduce((total, pkg) => {
        const blocks = pkg.totalBlocks || 0;
        if (blocks > 0) {
            console.log(`  📦 ${pkg.name}: ${blocks} block(s) (confirmed: ${pkg.confirmedBlocks || 0}, pending: ${pkg.pendingBlocks || 0})`);
        }
        return total + blocks;
    }, 0);

    console.log(`📊 Current total blocks: ${currentBlockCount}`);
    console.log(`📊 Previous total blocks: ${easyMiningData.lastBlockCount || 0}`);
    console.log(`${'🔍'.repeat(40)}\n`);

    if (currentBlockCount > (easyMiningData.lastBlockCount || 0)) {
        // New block(s) found!
        const newBlocks = currentBlockCount - (easyMiningData.lastBlockCount || 0);
        console.log(`🎉🎉🎉 NEW BLOCK(S) DETECTED! 🎉🎉🎉`);
        console.log(`   New blocks found: ${newBlocks}`);
        console.log(`   Total session blocks: ${easyMiningData.blocksFoundSession + newBlocks}`);

        easyMiningData.blocksFoundSession = Math.min(20, easyMiningData.blocksFoundSession + newBlocks);

        // Update display - create individual span elements for each rocket to enable proper flex-wrap
        const rocketsHtml = Array(easyMiningData.blocksFoundSession)
            .fill('🚀')
            .map(rocket => `<span>${rocket}</span>`)
            .join('');
        document.getElementById('blocks-found-rockets').innerHTML = rocketsHtml;

        // Play sound and vibrate for new block found
        playSound('block-found-sound');
        if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
            navigator.vibrate([100, 50, 100]); // Fast vibrate twice
        }

        // Auto-update crypto holdings if enabled
        if (easyMiningSettings.autoUpdateHoldings) {
            console.log(`💰 Auto-update enabled - adding ${newBlocks} block(s) to holdings`);
            autoUpdateCryptoHoldings(newBlocks);
        } else {
            console.log(`⚠️ Auto-update disabled - blocks found but not auto-adding to holdings`);
        }

        easyMiningData.lastBlockCount = currentBlockCount;
        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));
    } else if (currentBlockCount === easyMiningData.lastBlockCount) {
        console.log(`ℹ️ No new blocks detected (count unchanged)`);
    } else {
        console.log(`⚠️ Block count decreased? This might indicate a data sync issue`);
    }
}

function checkForPackageStatusChanges() {
    console.log(`\n${'📊'.repeat(40)}`);
    console.log(`📊 CHECKING PACKAGE STATUS CHANGES`);

    // Load previous package states
    const previousStatesKey = `${loggedInUser}_packageStates`;
    let previousStates = JSON.parse(getStorageItem(previousStatesKey)) || {};

    // Check if this is the first initialization (no previous states exist)
    const isFirstInitialization = Object.keys(previousStates).length === 0;

    const currentPackages = easyMiningData.activePackages || [];
    let newStates = {};

    currentPackages.forEach(pkg => {
        const pkgId = pkg.id;
        const currentState = {
            active: pkg.active,
            blockFound: pkg.blockFound || false,
            totalBlocks: pkg.totalBlocks || 0
        };

        const previousState = previousStates[pkgId];

        // Store current state for next check
        newStates[pkgId] = currentState;

        if (!previousState) {
            // First time seeing this package
            console.log(`  📦 New package detected: ${pkg.name}`);

            if (currentState.active) {
                // Check if package just started by looking at progress percentage
                const progress = pkg.progress || 0; // Progress percentage (0-100)
                console.log(`  📊 Package progress: ${progress}%`);

                // Only play sound if package just started (progress <= 1%)
                // This prevents sound on page load for already-running packages
                if (progress <= 1) {
                    console.log(`  🚀 PACKAGE STARTING: ${pkg.name} (progress ${progress}%, playing sound)`);
                    playSound('package-start-sound');
                    if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
                        navigator.vibrate(200); // Vibrate once for 200ms
                    }
                } else {
                    console.log(`  ℹ️ Package already running: ${pkg.name} (progress ${progress}%, no sound played)`);
                }
            }
        } else {
            // Check for status changes
            if (previousState.active && !currentState.active) {
                // Package just completed
                if (currentState.blockFound || currentState.totalBlocks > 0) {
                    // Package completed WITH blocks found
                    console.log(`  ✅ PACKAGE COMPLETED WITH REWARD: ${pkg.name} (${currentState.totalBlocks} blocks)`);
                    playSound('block-found-complete-sound');
                    if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
                        navigator.vibrate([200, 100, 200, 100, 200]); // Vibrate 3 times
                    }
                } else {
                    // Package completed WITHOUT blocks found
                    console.log(`  ❌ PACKAGE COMPLETED WITHOUT REWARD: ${pkg.name}`);
                    playSound('no-blocks-found-sound');
                    if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
                        navigator.vibrate([200, 100, 200, 100, 200]); // Vibrate 3 times
                    }
                }
            } else if (!previousState.active && currentState.active) {
                // Package became active
                console.log(`  🚀 PACKAGE BECAME ACTIVE: ${pkg.name}`);
                playSound('package-start-sound');
                if (isEasyMiningVibrateEnabled && "vibrate" in navigator) {
                    navigator.vibrate(200); // Vibrate once for 200ms
                }
            }
        }
    });

    // Save current states for next check
    setStorageItem(previousStatesKey, JSON.stringify(newStates));
    console.log(`📊 Package status check complete`);
    console.log(`${'📊'.repeat(40)}\n`);
}

function updateBTCHoldings() {
    // Find BTC in user's cryptos
    const btcCrypto = users[loggedInUser].cryptos.find(c => c.id === 'bitcoin');
    if (!btcCrypto) {
        return;
    }

    const btcHoldingsElement = document.getElementById('bitcoin-holdings');
    if (!btcHoldingsElement) return;

    // Get user's MANUAL holdings (stored in localStorage)
    let manualHoldings = parseFloat(getStorageItem(`${loggedInUser}_bitcoinHoldings`)) || 0;

    // Calculate NiceHash balance to add
    let niceHashBalance = 0;
    if (easyMiningSettings && easyMiningData) {
        if (easyMiningSettings.includeAvailableBTC) {
            niceHashBalance += parseFloat(easyMiningData.availableBTC) || 0;
        }
        if (easyMiningSettings.includePendingBTC) {
            niceHashBalance += parseFloat(easyMiningData.pendingBTC) || 0;
        }
    }

    // Total to display = manual + NiceHash (always use live values, never load from storage)
    // This prevents showing stale NiceHash balance from previous session
    const totalToDisplay = manualHoldings + niceHashBalance;

    console.log(`💰 BTC Holdings: Manual ${manualHoldings.toFixed(8)} + NiceHash ${niceHashBalance.toFixed(8)} = Total ${totalToDisplay.toFixed(8)}`);

    // Update display (NO COMMAS for BTC - use raw number)
    btcHoldingsElement.textContent = totalToDisplay.toFixed(8);

    // SAVE displayed amount to localStorage so it persists across page loads
    setStorageItem(`${loggedInUser}_bitcoin_displayHoldings`, totalToDisplay);

    // Update the AUD value for Bitcoin
    const btcPriceElement = document.getElementById('bitcoin-price-aud');
    const btcValueElement = document.getElementById('bitcoin-value-aud');

    if (btcPriceElement && btcValueElement) {
        const btcPriceAud = parseFloat(btcPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
        const btcValueAud = totalToDisplay * btcPriceAud;

        // Only update display and save if price is valid (> 0)
        // This prevents showing/saving $0.00 when price hasn't loaded yet
        if (btcPriceAud > 0) {
            btcValueElement.textContent = formatNumber(btcValueAud.toFixed(2));
            setStorageItem(`${loggedInUser}_bitcoin_displayAUD`, btcValueAud);
            console.log(`💰 BTC AUD updated & saved: ${btcValueAud.toFixed(2)} (holdings: ${totalToDisplay}, price: ${btcPriceAud})`);
        } else {
            console.warn(`⚠️ updateBTCHoldings - NOT updating display/saving AUD because price is 0 (keeping stored value visible)`);
        }
    }

    // Update total portfolio value
    updateTotalHoldings();
}

async function autoUpdateCryptoHoldings(newBlocks) {
    if (!easyMiningSettings.autoUpdateHoldings) {
        return;
    }

    // 🔒 MUTEX: Prevent concurrent calls from adding rewards twice
    if (isProcessingRewards) {
        return;
    }

    // Lock the function
    isProcessingRewards = true;

    try {
        // Load tracked rewards to prevent double-adding
        const trackedKey = `${loggedInUser}_easyMiningAddedRewards`;
        let addedRewards = JSON.parse(getStorageItem(trackedKey)) || {};

        // Get ALL packages that found blocks (both active AND completed)
        const allPackages = easyMiningData.activePackages || [];
        const packagesWithBlocks = allPackages.filter(pkg => pkg.blockFound);

        for (const pkg of packagesWithBlocks) {
    
            // Check if this package has already been processed
            const packageKey = `${pkg.id}_total`;
            if (addedRewards[packageKey]) {
                // Check if reward amount has changed (new blocks found)
                if (addedRewards[packageKey].amount === pkg.reward) {
                    continue;
                }
            }

            // Use the ALREADY CALCULATED reward from package data
            const crypto = pkg.crypto;
            const rewardAmount = parseFloat(pkg.reward) || 0;

            if (rewardAmount === 0 || isNaN(rewardAmount)) {
                continue;
            }

            // Map crypto symbol to CoinGecko ID
            const cryptoMapping = {
                'BTC': 'bitcoin',
                'BCH': 'bitcoin-cash',
                'RVN': 'ravencoin',
                'DOGE': 'dogecoin',
                'LTC': 'litecoin',
                'KAS': 'kaspa'
            };
            const cryptoId = cryptoMapping[crypto] || crypto.toLowerCase();
    
            // Check if crypto already exists in portfolio
            let cryptoExists = users[loggedInUser].cryptos.find(c => c.id === cryptoId);

            if (!cryptoExists) {
                // Auto-add crypto to portfolio
                try {
                    await addCryptoById(cryptoId);
                    await fetchPrices();
                    console.log(`✅ Auto-added ${cryptoId} to portfolio`);
                } catch (error) {
                    console.error(`❌ Failed to auto-add ${cryptoId}:`, error);
                    continue;
                }
            }

            // Calculate amount to add
            let amountToAdd = rewardAmount;
            if (addedRewards[packageKey]) {
                // Only add the difference if package was previously processed
                amountToAdd = rewardAmount - addedRewards[packageKey].amount;

                // Prevent negative amounts (API data inconsistency)
                if (amountToAdd < 0) {
                    continue;
                }
            }

            // Final check to ensure amountToAdd is valid and positive
            if (isNaN(amountToAdd) || amountToAdd <= 0) {
                continue;
            }

            // Update holdings for this crypto
            const currentHoldings = parseFloat(getStorageItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
            const newHoldings = currentHoldings + amountToAdd;

            // Save to localStorage
            setStorageItem(`${loggedInUser}_${cryptoId}Holdings`, newHoldings);
            console.log(`💰 Added ${amountToAdd} ${crypto} reward (${pkg.name})`);

            // For Bitcoin, use updateBTCHoldings() to include NiceHash balance
            if (cryptoId === 'bitcoin' && typeof updateBTCHoldings === 'function') {
                updateBTCHoldings();
                sortContainersByValue();
            } else {
                // Update holdings display
                const holdingsElement = document.getElementById(`${cryptoId}-holdings`);
                if (holdingsElement) {
                    holdingsElement.textContent = formatNumber(newHoldings.toFixed(8));
                }

                // Update the AUD value
                const priceElement = document.getElementById(`${cryptoId}-price-aud`);
                const valueElement = document.getElementById(`${cryptoId}-value-aud`);
                if (priceElement && valueElement) {
                    const priceInAud = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
                    const valueInAud = newHoldings * priceInAud;
                    valueElement.textContent = formatNumber(valueInAud.toFixed(2));

                    sortContainersByValue();
                }
            }
    
            // Process secondary rewards (for dual mining packages like Palladium DOGE/LTC)
            if (pkg.cryptoSecondary && pkg.rewardSecondary > 0) {
                const secondaryCrypto = pkg.cryptoSecondary;
                const secondaryRewardAmount = parseFloat(pkg.rewardSecondary) || 0;

                if (secondaryRewardAmount > 0 && !isNaN(secondaryRewardAmount)) {
                    // Map secondary crypto symbol to CoinGecko ID
                    const secondaryCryptoId = cryptoMapping[secondaryCrypto] || secondaryCrypto.toLowerCase();

                    // Check if this secondary reward was already added
                    const secondaryPackageKey = `${pkg.id}_secondary`;
                    let secondaryAmountToAdd = secondaryRewardAmount;

                    if (addedRewards[secondaryPackageKey]) {
                        // Check if secondary reward amount has changed
                        if (addedRewards[secondaryPackageKey].amount === secondaryRewardAmount) {
                            secondaryAmountToAdd = 0;
                        } else {
                            secondaryAmountToAdd = secondaryRewardAmount - addedRewards[secondaryPackageKey].amount;

                            // Prevent negative amounts (API data inconsistency)
                            if (secondaryAmountToAdd < 0) {
                                secondaryAmountToAdd = 0;
                            }
                        }
                    }

                    // Check if secondary crypto already exists in portfolio
                    let secondaryCryptoExists = users[loggedInUser].cryptos.find(c => c.id === secondaryCryptoId);

                    if (!secondaryCryptoExists) {
                        // Auto-add secondary crypto to portfolio
                        try {
                            await addCryptoById(secondaryCryptoId);
                            await fetchPrices();
                            console.log(`✅ Auto-added ${secondaryCryptoId} to portfolio`);
                        } catch (error) {
                            console.error(`❌ Failed to auto-add ${secondaryCryptoId}:`, error);
                        }
                    }

                    // Final check to ensure secondaryAmountToAdd is valid and positive
                    if (secondaryAmountToAdd > 0 && !isNaN(secondaryAmountToAdd)) {
                        // Update holdings for secondary crypto
                        const currentSecondaryHoldings = parseFloat(getStorageItem(`${loggedInUser}_${secondaryCryptoId}Holdings`)) || 0;
                        const newSecondaryHoldings = currentSecondaryHoldings + secondaryAmountToAdd;

                        // Save to localStorage
                        setStorageItem(`${loggedInUser}_${secondaryCryptoId}Holdings`, newSecondaryHoldings);
                        console.log(`💰 Added ${secondaryAmountToAdd} ${secondaryCrypto} reward (${pkg.name})`);

                        // Update holdings display
                        const secondaryHoldingsElement = document.getElementById(`${secondaryCryptoId}-holdings`);
                        if (secondaryHoldingsElement) {
                            secondaryHoldingsElement.textContent = formatNumber(newSecondaryHoldings.toFixed(8));
                        }

                        // Update the AUD value
                        const secondaryPriceElement = document.getElementById(`${secondaryCryptoId}-price-aud`);
                        const secondaryValueElement = document.getElementById(`${secondaryCryptoId}-value-aud`);
                        if (secondaryPriceElement && secondaryValueElement) {
                            const secondaryPriceInAud = parseFloat(secondaryPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
                            const secondaryValueInAud = newSecondaryHoldings * secondaryPriceInAud;
                            secondaryValueElement.textContent = formatNumber(secondaryValueInAud.toFixed(2));

                            sortContainersByValue();
                        }
    
                        // Mark secondary reward as processed
                        addedRewards[secondaryPackageKey] = {
                            orderId: pkg.id,
                            packageName: pkg.name,
                            crypto: secondaryCrypto,
                            amount: secondaryRewardAmount,
                            timestamp: Date.now(),
                            totalBlocks: pkg.totalBlocks
                        };
                        setStorageItem(trackedKey, JSON.stringify(addedRewards));
                        console.log(`   ✓ Marked secondary reward as processed (total: ${secondaryRewardAmount} ${secondaryCrypto})`);
    
                        console.log(`   ✅ Successfully added ${secondaryAmountToAdd} ${secondaryCrypto} to holdings`);
                    }
                }
            }
    
            // Mark this package as processed with current reward amount
            addedRewards[packageKey] = {
                orderId: pkg.id,
                packageName: pkg.name,
                crypto: crypto,
                amount: rewardAmount, // Store total reward amount
                timestamp: Date.now(),
                totalBlocks: pkg.totalBlocks
            };
            setStorageItem(trackedKey, JSON.stringify(addedRewards));
            console.log(`   ✓ Marked package as processed (total reward: ${rewardAmount} ${crypto})`);
    
            console.log(`   ✅ Successfully added ${amountToAdd} ${crypto} to holdings`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ AUTO-UPDATE COMPLETE');
        console.log(`${'='.repeat(80)}\n`);

        // Update total portfolio value
        updateTotalHoldings();
    } finally {
        // 🔓 Always unlock, even if there was an error
        isProcessingRewards = false;
    }
}

// ✅ Check for missed rewards (runs on load and every 30 seconds)
// This ensures that rewards found while the app was closed get added to holdings
async function checkMissedRewards() {
    // Only check if EasyMining is enabled and auto-update is on
    if (!easyMiningSettings.enabled || !easyMiningSettings.autoUpdateHoldings) {
        return;
    }

    // Only check if we have active packages loaded
    if (!easyMiningData.activePackages || easyMiningData.activePackages.length === 0) {
        return;
    }

    // Call the existing auto-update function which already has duplicate prevention
    // It will check all packages with blocks and only add rewards that haven't been added yet
    await autoUpdateCryptoHoldings();
}

// Start the missed rewards check interval (every 30 seconds)
function startMissedRewardsCheck() {
    // Clear any existing interval
    if (missedRewardsCheckInterval) {
        clearInterval(missedRewardsCheckInterval);
    }

    // Initial check after 10 seconds (give time for data to load)
    setTimeout(() => {
        checkMissedRewards();
    }, 10000);

    // Then check every 30 seconds
    missedRewardsCheckInterval = setInterval(() => {
        checkMissedRewards();
    }, 30000);
}

// Stop the missed rewards check interval
function stopMissedRewardsCheck() {
    if (missedRewardsCheckInterval) {
        clearInterval(missedRewardsCheckInterval);
        missedRewardsCheckInterval = null;
    }
}

// ✅ NEW: Auto-add crypto boxes when packages become ACTIVE
// This ensures live prices are used in calculations even if the package hasn't found rewards yet
async function autoAddCryptoBoxesForActivePackages() {
    console.log('\n📦 Checking for missing crypto boxes in active packages...');

    if (!easyMiningData.activePackages || easyMiningData.activePackages.length === 0) {
        console.log('   No active packages to check');
        return;
    }

    // Crypto symbol to CoinGecko ID mapping
    const cryptoMapping = {
        'BTC': 'bitcoin',
        'BCH': 'bitcoin-cash',
        'RVN': 'ravencoin',
        'DOGE': 'dogecoin',
        'LTC': 'litecoin',
        'KAS': 'kaspa'
    };

    // Track which cryptos we've already checked this run to avoid duplicates
    const checkedCryptos = new Set();

    for (const pkg of easyMiningData.activePackages) {
        // Only check ACTIVE packages (not completed or pending)
        if (pkg.status?.code !== 'ACTIVE') {
            continue;
        }

        console.log(`\n   📦 Active Package: ${pkg.name}`);

        // Check primary crypto
        if (pkg.crypto) {
            const cryptoId = cryptoMapping[pkg.crypto] || pkg.crypto.toLowerCase();

            if (!checkedCryptos.has(cryptoId)) {
                checkedCryptos.add(cryptoId);

                // Check if crypto exists in portfolio
                const cryptoExists = users[loggedInUser].cryptos.find(c => c.id === cryptoId);

                if (!cryptoExists) {
                    console.log(`   🆕 Adding missing crypto box: ${pkg.crypto} (${cryptoId})`);
                    try {
                        await addCryptoById(cryptoId);
                        console.log(`   ✅ Successfully added ${pkg.crypto} to portfolio`);

                        // Fetch prices for the new crypto
                        await fetchPrices();
                    } catch (error) {
                        console.error(`   ❌ Failed to add ${pkg.crypto}:`, error);
                    }
                } else {
                    console.log(`   ✓ ${pkg.crypto} already exists in portfolio`);
                }
            }
        }

        // Check secondary crypto (for dual-mining packages like Palladium)
        if (pkg.cryptoSecondary) {
            const secondaryCryptoId = cryptoMapping[pkg.cryptoSecondary] || pkg.cryptoSecondary.toLowerCase();

            if (!checkedCryptos.has(secondaryCryptoId)) {
                checkedCryptos.add(secondaryCryptoId);

                // Check if secondary crypto exists in portfolio
                const secondaryCryptoExists = users[loggedInUser].cryptos.find(c => c.id === secondaryCryptoId);

                if (!secondaryCryptoExists) {
                    console.log(`   🆕 Adding missing secondary crypto box: ${pkg.cryptoSecondary} (${secondaryCryptoId})`);
                    try {
                        await addCryptoById(secondaryCryptoId);
                        console.log(`   ✅ Successfully added ${pkg.cryptoSecondary} to portfolio`);

                        // Fetch prices for the new crypto
                        await fetchPrices();
                    } catch (error) {
                        console.error(`   ❌ Failed to add ${pkg.cryptoSecondary}:`, error);
                    }
                } else {
                    console.log(`   ✓ ${pkg.cryptoSecondary} already exists in portfolio`);
                }
            }
        }
    }

    console.log('\n✅ Finished checking for missing crypto boxes\n');
}

// Manual trigger for testing auto-update (can be called from browser console)
window.manualTriggerAutoUpdate = async function() {
    console.log('\n🔧 MANUAL TRIGGER - Forcing auto-update crypto holdings');
    console.log('Current settings:', {
        autoUpdateEnabled: easyMiningSettings.autoUpdateHoldings,
        packagesCount: easyMiningData.activePackages?.length || 0,
        packagesWithBlocks: easyMiningData.activePackages?.filter(p => p.blockFound).length || 0
    });

    if (!easyMiningSettings.autoUpdateHoldings) {
        console.error('❌ Auto-update is disabled! Enable it in EasyMining settings first.');
        alert('Auto-update is disabled! Enable it in EasyMining settings first.');
        return;
    }

    // Force call the auto-update function
    await autoUpdateCryptoHoldings(0);
    console.log('✅ Manual trigger complete - check logs above for details');
};

// Helper function to add crypto by ID programmatically
async function addCryptoById(cryptoId) {
    try {
        // Fetch crypto details from CoinGecko
        const apiKey = getApiKey();
        const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}?x_cg_demo_api_key=${apiKey}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch crypto data');
        }
        
        const data = await response.json();

        const crypto = {
            id: data.id,
            symbol: data.symbol,
            name: data.name,
            thumb: data.image.thumb
        };

        // Add to user's cryptos if not already there
        if (!users[loggedInUser].cryptos.find(c => c.id === crypto.id)) {
            users[loggedInUser].cryptos.push(crypto);
            setStorageItem('users', JSON.stringify(users));

            // Add crypto container to UI
            addCryptoContainer(crypto.id, crypto.symbol, crypto.name, crypto.thumb);

            // Initialize holdings
            setStorageItem(`${loggedInUser}_${crypto.id}Holdings`, 0);

            // Update API URL
            updateApiUrl();

            // Subscribe to WebSocket price updates for the new crypto
            subscribeToSymbol(crypto.symbol);

            // Set the initial price from CoinGecko data (prevents 0 price issue)
            console.log(`🔍 Checking for market_data in API response for ${crypto.id}...`);
            if (data.market_data && data.market_data.current_price && data.market_data.current_price.aud) {
                const priceAud = data.market_data.current_price.aud;
                const priceElement = document.getElementById(`${crypto.id}-price-aud`);
                if (priceElement) {
                    priceElement.textContent = `$${formatNumber(priceAud.toFixed(8), true)}`;
                    console.log(`✅ Set initial price for ${crypto.id}: ${priceAud} AUD`);
                    console.log(`✅ Price element now shows: "${priceElement.textContent}"`);
                } else {
                    console.error(`❌ Could not find price element for ${crypto.id}`);
                }
            } else {
                console.warn(`⚠️ No market_data in API response for ${crypto.id}`);
                console.log('API response keys:', Object.keys(data));
            }
        }

        return crypto;
    } catch (error) {
        console.error('Error adding crypto:', error);
        throw error;
    }
}

// =============================================================================
// PACKAGE DETAIL MODAL
// =============================================================================

// Show package detail page (replaces modal)
function showPackageDetailPage(pkg) {
    console.log('Showing Package Detail Page for:', pkg.name);

    // Stop polling when leaving app page
    stopBuyPackagesPolling();
    stopEasyMiningAlertsPolling();

    // Debug team package data
    if (pkg.isTeam) {
        console.log(`\n🔍 TEAM PACKAGE DETAIL DATA: ${pkg.name}`);
        console.log(`   isTeam: ${pkg.isTeam}`);
        console.log(`   ownedShares: ${pkg.ownedShares}`);
        console.log(`   totalShares: ${pkg.totalShares}`);
        console.log(`   userSharePercentage: ${pkg.userSharePercentage}`);
        console.log(`   price: ${pkg.price}`);
        console.log(`   reward: ${pkg.reward}`);
        console.log(`   btcEarnings: ${pkg.btcEarnings}`);
    }

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-alerts-page').style.display = 'none';

    // Show package detail page
    document.getElementById('package-detail-page').style.display = 'block';

    // Set package name and subtitle
    document.getElementById('package-detail-page-name').textContent = pkg.name;
    // Add order number under the package name
    const subtitle = pkg.miningType || `${pkg.crypto} Mining`;
    const orderNumber = pkg.id ? `Order #${pkg.id.substring(0, 8)}` : '';
    document.getElementById('package-detail-page-subtitle').textContent = orderNumber ? `${orderNumber} • ${subtitle}` : subtitle;

    // Populate package info
    const infoGrid = document.getElementById('package-detail-page-info');
    infoGrid.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Mining Type:</span>
            <span class="stat-value" style="color: #ffa500;">${pkg.miningType || `${pkg.crypto} Mining`}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Cryptocurrencies:</span>
            <span class="stat-value" style="color: #00ff00;">${pkg.cryptoSecondary ? `${pkg.crypto}+${pkg.cryptoSecondary}` : pkg.crypto}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Hashrate:</span>
            <span class="stat-value">${pkg.hashrate}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Purchased On:</span>
            <span class="stat-value">${formatDateTime(pkg.startTime)}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Time Remaining:</span>
            <span class="stat-value">${pkg.timeRemaining}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Progress:</span>
            <span class="stat-value">${pkg.progress.toFixed(2)}%</span>
        </div>
        ${pkg.isTeam ? `
        <div class="stat-item">
            <span class="stat-label">Package Type:</span>
            <span class="stat-value">Team Package</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">My Shares:</span>
            <span class="stat-value">${pkg.ownedShares !== null ? Math.round(pkg.ownedShares) : 'N/A'} / ${pkg.totalShares !== null ? Math.round(pkg.totalShares) : 'N/A'} (${(pkg.userSharePercentage * 100).toFixed(2)}%)</span>
        </div>
        ${pkg.sharePrice ? `
        <div class="stat-item">
            <span class="stat-label">Price Per Share:</span>
            <span class="stat-value">${pkg.sharePrice.toFixed(8)} BTC</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Total Package Price:</span>
            <span class="stat-value">${pkg.fullOrderData?.sharedTicket?.addedAmount ? pkg.fullOrderData.sharedTicket.addedAmount.toFixed(8) + ' BTC' : (pkg.fullOrderData?.packagePrice ? pkg.fullOrderData.packagePrice.toFixed(8) + ' BTC' : 'N/A')}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Total Participants:</span>
            <span class="stat-value">${pkg.fullOrderData?.sharedTicket?.numberOfParticipants || 'N/A'}</span>
        </div>
        ` : ''}
        ` : ''}
        <div class="stat-item">
            <span class="stat-label">${pkg.isTeam ? 'Amount Spent:' : 'Price Spent:'}</span>
            <span class="stat-value">$${convertBTCtoAUD(pkg.price).toFixed(2)} AUD</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">${pkg.isTeam ? 'BTC Spent:' : 'BTC Cost:'}</span>
            <span class="stat-value">${pkg.price.toFixed(8)} BTC</span>
        </div>
        ${pkg.blockFound && pkg.confirmedBlocks > 0 ? `
        <div class="stat-item">
            <span class="stat-label">Blocks Found:</span>
            <span class="stat-value" style="color: #00ff00;">🚀 ${pkg.confirmedBlocks} Block${pkg.confirmedBlocks > 1 ? 's' : ''}</span>
        </div>
        ` : ''}
        ${(() => {
            // Calculate total crypto rewards from payoutReward (by coin type for dual mining)
            const soloRewards = pkg.fullOrderData?.soloReward || [];
            const rewardsByCoin = {};

            soloRewards.forEach(reward => {
                const coin = reward.coin;
                if (!rewardsByCoin[coin]) {
                    rewardsByCoin[coin] = 0;
                }
                // Use payoutReward from API (actual payout)
                if (coin === 'BTC' && reward.payoutRewardBtc) {
                    rewardsByCoin[coin] += parseFloat(reward.payoutRewardBtc);
                } else if (reward.payoutReward) {
                    rewardsByCoin[coin] += parseFloat(reward.payoutReward) / 100000000;
                }
            });

            const totalCryptoReward = rewardsByCoin[pkg.crypto] || 0;
            const totalSecondaryCryptoReward = pkg.cryptoSecondary ? (rewardsByCoin[pkg.cryptoSecondary] || 0) : 0;
            const hasCryptoReward = totalCryptoReward > 0 || totalSecondaryCryptoReward > 0;
            const displayReward = pkg.isTeam ? pkg.reward : totalCryptoReward || pkg.reward;
            const displaySecondaryReward = pkg.isTeam ? pkg.rewardSecondary : totalSecondaryCryptoReward || pkg.rewardSecondary;

            return hasCryptoReward || pkg.reward > 0 ? `
        <div class="stat-item">
            <span class="stat-label">Primary Reward:</span>
            <span class="stat-value" style="color: #00ff00;">${displayReward.toFixed(8)} ${pkg.crypto}</span>
        </div>
        ${displaySecondaryReward > 0 && pkg.cryptoSecondary ? `
        <div class="stat-item">
            <span class="stat-label">Secondary Reward:</span>
            <span class="stat-value" style="color: #00ff00;">${displaySecondaryReward.toFixed(8)} ${pkg.cryptoSecondary}</span>
        </div>
        ` : ''}
        ${pkg.isTeam && totalCryptoReward > 0 ? `
        <div class="stat-item">
            <span class="stat-label">Pool Primary Total:</span>
            <span class="stat-value" style="color: #ffa500;">${totalCryptoReward.toFixed(8)} ${pkg.crypto}</span>
        </div>
        ` : ''}
        ${pkg.isTeam && totalSecondaryCryptoReward > 0 && pkg.cryptoSecondary ? `
        <div class="stat-item">
            <span class="stat-label">Pool Secondary Total:</span>
            <span class="stat-value" style="color: #ffa500;">${totalSecondaryCryptoReward.toFixed(8)} ${pkg.cryptoSecondary}</span>
        </div>
        ` : ''}
            ` : '';
        })()}
        ${pkg.btcEarnings > 0 ? `
        <div class="stat-item">
            <span class="stat-label">BTC Earnings:</span>
            <span class="stat-value" style="color: #00ff00;">${pkg.btcEarnings.toFixed(8)} BTC</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">BTC in AUD:</span>
            <span class="stat-value" style="color: #00ff00;">$${convertBTCtoAUD(pkg.btcEarnings).toFixed(2)} AUD</span>
        </div>
        ` : `
        <div class="stat-item">
            <span class="stat-label">BTC Earnings:</span>
            <span class="stat-value" style="color: #888;">No blocks found yet</span>
        </div>
        `}
        ${pkg.active && pkg.potentialReward > 0 ? `
        <div class="stat-item">
            <span class="stat-label">Potential Reward:</span>
            <span class="stat-value" style="color: #ffa500;">$${convertCryptoToAUD(pkg.potentialReward, pkg.crypto).toFixed(2)} AUD (${pkg.potentialReward.toFixed(8)} ${pkg.crypto})</span>
        </div>
        ${pkg.potentialRewardSecondary > 0 && pkg.cryptoSecondary ? `
        <div class="stat-item">
            <span class="stat-label">Potential Secondary:</span>
            <span class="stat-value" style="color: #ffa500;">$${convertCryptoToAUD(pkg.potentialRewardSecondary, pkg.cryptoSecondary).toFixed(2)} AUD (${pkg.potentialRewardSecondary.toFixed(8)} ${pkg.cryptoSecondary})</span>
        </div>
        ` : ''}
        ` : ''}
        <div class="stat-item">
            <span class="stat-label">Status:</span>
            <span class="stat-value" style="color: ${pkg.active ? '#00ff00' : '#888'};">${pkg.active ? 'Active' : 'Completed'}</span>
        </div>
    `;

    // Animate block bars
    const barsContainer = document.getElementById('package-detail-page-blocks');
    barsContainer.innerHTML = '';

    // Generate mock blocks if not present (for testing)
    if (!pkg.blocks || pkg.blocks.length === 0) {
        pkg.blocks = [];
        for (let i = 0; i < 10; i++) {
            pkg.blocks.push({
                percentage: Math.floor(Math.random() * 100),
                timestamp: Date.now() - (i * 60000)
            });
        }
    }

    pkg.blocks.forEach((block, index) => {
        setTimeout(() => {
            const bar = document.createElement('div');
            bar.className = 'block-bar';
            bar.style.height = `${Math.min(block.percentage, 100) * 1.5}px`;

            if (block.percentage >= 100) {
                bar.innerHTML = `<div class="block-bar-rocket">🚀</div>`;
            }

            bar.innerHTML += `<div class="block-bar-percentage">${block.percentage}%</div>`;
            barsContainer.appendChild(bar);
        }, index * 100);
    });
}

// Legacy modal functions (kept for compatibility)
function showPackageDetailModal(pkg) {
    // Redirect to page instead
    showPackageDetailPage(pkg);
}

function closePackageDetailModal() {
    // Redirect to app page
    showAppPage();
}

// =============================================================================
// BUY PACKAGES MODAL
// =============================================================================

// Make modal functions globally accessible
window.showPackageDetailModal = showPackageDetailModal;
window.closePackageDetailModal = closePackageDetailModal;
window.buyPackage = buyPackage;

// Fetch available solo packages from NiceHash API
async function fetchAvailableSoloPackages() {
    try {
        const endpoint = '/main/api/v2/public/solo/package';

        console.log('📡 Fetching solo packages from:', endpoint);

        // Public endpoint - no auth headers needed
        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: {},
                    isPublic: true
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ Solo packages response:', data);

        // Solo packages API returns a direct array
        return Array.isArray(data) ? data : [];

    } catch (error) {
        console.error('❌ Error fetching solo packages:', error);
        console.log('📦 Using mock solo packages data');

        // Return mock data when API fails
        return [
            {
                id: 'gold-s-mock',
                name: 'Gold S',
                price: 0.00015,
                probability: '1:150',
                duration: 86400,
                currencyAlgo: {
                    currency: 'BTC',
                    blockReward: 6.25
                }
            },
            {
                id: 'gold-m-mock',
                name: 'Gold M',
                price: 0.0003,
                probability: '1:75',
                duration: 86400,
                currencyAlgo: {
                    currency: 'BTC',
                    blockReward: 6.25
                }
            },
            {
                id: 'silver-s-mock',
                name: 'Silver S',
                price: 0.00012,
                probability: '1:180',
                duration: 86400,
                currencyAlgo: {
                    currency: 'BCH',
                    blockReward: 6.25
                }
            },
            {
                id: 'titanium-s-mock',
                name: 'Titanium KAS S',
                price: 0.00013,
                probability: '1:160',
                duration: 86400,
                currencyAlgo: {
                    currency: 'KAS',
                    blockReward: 150000
                }
            }
        ];
    }
}

// Fetch available team packages from NiceHash API
async function fetchAvailableTeamPackages() {
    try {
        const endpoint = '/main/api/v2/public/solo/shared/order';

        console.log('📡 Fetching team packages from:', endpoint);

        // Public endpoint - no auth headers needed
        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: {},
                    isPublic: true
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ Team packages response:', data);

        // Team packages API returns { list: [...] }
        return data.list || [];

    } catch (error) {
        console.error('❌ Error fetching team packages:', error);
        console.log('📦 Using mock team packages data');

        // Return mock data when API fails
        return [
            {
                id: 'team-gold-mock',
                numberOfParticipants: 5,
                fullAmount: 0.0005,
                addedAmount: 0.0002,
                currencyAlgoTicket: {
                    name: 'Gold Team',
                    price: 0.0005,
                    probability: '1:80',
                    currencyAlgo: {
                        currency: 'BTC',
                        blockReward: 6.25
                    }
                }
            },
            {
                id: 'team-silver-mock',
                numberOfParticipants: 8,
                fullAmount: 0.0004,
                addedAmount: 0.00015,
                currencyAlgoTicket: {
                    name: 'Silver Team',
                    price: 0.0004,
                    probability: '1:160',
                    currencyAlgo: {
                        currency: 'BCH',
                        blockReward: 6.25
                    }
                }
            },
            {
                id: 'team-titanium-mock',
                numberOfParticipants: 6,
                fullAmount: 0.00035,
                addedAmount: 0.0001,
                currencyAlgoTicket: {
                    name: 'Titanium Team',
                    price: 0.00035,
                    probability: '1:140',
                    currencyAlgo: {
                        currency: 'KAS',
                        blockReward: 150000
                    }
                }
            }
        ];
    }
}

function getRecommendedPackageNames() {
    const recommended = [];

    // Simplified recommendations for live API
    // Real API doesn't provide probability/shares in the same format
    easyMiningData.activePackages.forEach(pkg => {
        if (pkg.active && pkg.isTeam) {
            // Recommend team packages with good reward/price ratio
            const ratio = (pkg.reward || 0) / (pkg.price || 1);
            if (ratio > 0.01) {
                recommended.push(pkg.name);
            }
        }
    });

    return recommended;
}

// Create UI card for solo package
function createSoloPackageCard(pkg) {
    const card = document.createElement('div');
    card.className = 'buy-package-card';

    // Extract package details from API response
    // Solo package structure: { id, name, price, probability, currencyAlgo: { currency, blockReward }, duration }
    const packageName = pkg.name || 'Unknown Package';
    const crypto = pkg.currencyAlgo?.currency || 'Unknown';
    const ticketId = pkg.id;
    const packagePrice = pkg.price || 0;
    const probability = pkg.probability || 'N/A';
    const potentialReward = pkg.currencyAlgo?.blockReward || 'N/A';
    const duration = pkg.duration || 0;

    // Calculate price in AUD (assuming BTC price)
    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const priceAUD = (packagePrice * btcPrice).toFixed(2);

    card.innerHTML = `
        <h4>${packageName}</h4>
        <p style="color: #ffa500; font-weight: bold; font-size: 18px;">${crypto}</p>
        <div class="buy-package-stats">
            <div class="buy-package-stat">
                <span>Probability:</span>
                <span>${probability}</span>
            </div>
            <div class="buy-package-stat">
                <span>Cost (BTC):</span>
                <span>${packagePrice.toFixed(8)} BTC</span>
            </div>
            <div class="buy-package-stat">
                <span>Cost (AUD):</span>
                <span>$${priceAUD} AUD</span>
            </div>
            <div class="buy-package-stat">
                <span>Potential Reward:</span>
                <span>${potentialReward} ${crypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Duration:</span>
                <span>${duration}s</span>
            </div>
        </div>
        <button class="buy-package-button" onclick="buySoloPackage('${ticketId}', '${crypto}', ${packagePrice})">
            Buy Package
        </button>
    `;

    return card;
}

// Helper function to get user's bought shares for a team package
function getMyTeamShares(packageId) {
    const storageKey = `${loggedInUser}_teamPackageShares`;
    const sharesData = getStorageItem(storageKey);
    if (!sharesData) return 0;

    try {
        const shares = JSON.parse(sharesData);
        return shares[packageId] || 0;
    } catch (e) {
        console.error('Error parsing team shares data:', e);
        return 0;
    }
}

// Helper function to save user's bought shares for a team package
function saveMyTeamShares(packageId, shares) {
    const storageKey = `${loggedInUser}_teamPackageShares`;
    let sharesData = getStorageItem(storageKey);

    let sharesObj = {};
    if (sharesData) {
        try {
            sharesObj = JSON.parse(sharesData);
        } catch (e) {
            console.error('Error parsing existing shares data:', e);
        }
    }

    sharesObj[packageId] = shares;
    setStorageItem(storageKey, JSON.stringify(sharesObj));
}

/**
 * Clean up old auto-bought package entries (older than 30 days)
 * Prevents localStorage from growing indefinitely
 */
function cleanupAutoBoughtPackages() {
    if (!loggedInUser) return;

    const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let cleaned = false;

    // Remove entries older than 30 days
    Object.keys(autoBoughtPackages).forEach(packageId => {
        const entry = autoBoughtPackages[packageId];
        if (entry.timestamp < thirtyDaysAgo) {
            delete autoBoughtPackages[packageId];
            cleaned = true;
        }
    });

    if (cleaned) {
        localStorage.setItem(`${loggedInUser}_autoBoughtPackages`, JSON.stringify(autoBoughtPackages));
        console.log('🧹 Cleaned up old auto-bought package entries');
    }
}

// Helper function to calculate team reward based on participation
function calculateTeamReward(blockReward, totalBoughtShares, myBoughtShares, myShares) {
    if (myShares === 0) return 0;

    // Formula: blockReward ÷ ((totalBoughtShares - myBoughtShares) + myShares) × myShares
    // totalBoughtShares from API includes MY already bought shares, so we subtract them first
    // Then add the new total shares I want to buy
    // Example: Total bought=4 (incl. my 2), I want 3 total: 3.125 ÷ ((4-2)+3) × 3 = 3.125 ÷ 5 × 3
    const othersBought = totalBoughtShares - myBoughtShares;
    const totalShares = othersBought + myShares;
    const reward = (blockReward / totalShares) * myShares;

    console.log(`💰 Team Reward Calculation:
    - Block Reward: ${blockReward}
    - Total Bought (from API): ${totalBoughtShares}
    - My Previously Bought: ${myBoughtShares}
    - My Desired Shares: ${myShares}
    - Others Bought: ${othersBought}
    - Total Pool: ${totalShares}
    - My Reward: ${reward}`);

    return reward;
}

// Create UI card for team package with share selector
function createTeamPackageCard(pkg) {
    const card = document.createElement('div');
    card.className = 'buy-package-card team-package-card';

    // Extract package details from API response
    // Team package structure: { id, currencyAlgoTicket: { name, price, probability, currencyAlgo: { currency, blockReward } }, numberOfParticipants, fullAmount, addedAmount }
    const ticket = pkg.currencyAlgoTicket || {};
    const packageName = ticket.name || 'Unknown Package';
    const crypto = ticket.currencyAlgo?.currency || 'Unknown';

    // ✅ Use CONSISTENT package ID logic across all locations (buy packages, alerts, auto-buy)
    // This ensures shares sync correctly between buy packages page and team alerts
    const packageId = pkg.apiData?.id || ticket.id || pkg.id;

    // Debug: Log ID extraction
    console.log('🔍 ID Extraction:', {
        'pkg.id (package ID)': pkg.id,
        'pkg.apiData?.id': pkg.apiData?.id,
        'ticket.id (currencyAlgoTicket.id)': ticket.id,
        'Selected packageId for API': packageId,
        'Package name': packageName
    });
    const packagePrice = ticket.price || 0;
    const fullAmount = pkg.fullAmount || packagePrice;
    const addedAmount = pkg.addedAmount || 0;
    const availableAmount = fullAmount - addedAmount;
    const sharePrice = 0.0001; // Standard share price
    const totalAvailableShares = Math.round(fullAmount * 10000);
    const totalBoughtShares = Math.round(addedAmount * 10000);
    const availableShares = Math.round(availableAmount * 10000);
    const probability = ticket.probability || 'N/A';
    const blockReward = ticket.currencyAlgo?.blockRewardWithNhFee || ticket.currencyAlgo?.blockReward || 0;
    const participants = pkg.numberOfParticipants || 0;

    // Get user's bought shares for this package
    const myBoughtShares = getMyTeamShares(packageId);

    console.log(`📦 Team Package Card: ${packageName}
    - Package ID: ${packageId}
    - Full Amount: ${fullAmount} BTC
    - Added Amount: ${addedAmount} BTC
    - Total Available Shares: ${totalAvailableShares}
    - Total Bought Shares: ${totalBoughtShares}
    - Available Shares: ${availableShares}
    - Block Reward: ${blockReward} ${crypto}
    - My Bought Shares: ${myBoughtShares}`);

    // Calculate price in AUD (assuming BTC price)
    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const pricePerShareAUD = (sharePrice * btcPrice).toFixed(2);

    // Generate unique ID for this card's share input
    const cardId = `team-${packageId}`;

    // Calculate initial reward display based on user's bought shares
    // If user has no shares, show 0 reward (they can see it update when they adjust the input)
    const initialReward = myBoughtShares > 0 ? calculateTeamReward(blockReward, totalBoughtShares, myBoughtShares, myBoughtShares) : 0;

    card.innerHTML = `
        <h4>👥 ${packageName}</h4>
        <p style="color: #ffa500; font-weight: bold; font-size: 18px;">${crypto}</p>
        <div class="buy-package-stats">
            <div class="buy-package-stat">
                <span>Probability:</span>
                <span>${probability}</span>
            </div>
            <div class="buy-package-stat">
                <span>Share Price (BTC):</span>
                <span>${sharePrice.toFixed(8)} BTC</span>
            </div>
            <div class="buy-package-stat">
                <span>Share Price (AUD):</span>
                <span>$${pricePerShareAUD} AUD</span>
            </div>
            <div class="buy-package-stat">
                <span>Block Reward:</span>
                <span>${blockReward} ${crypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Share Distribution:</span>
                <span style="color: #4CAF50;" id="${cardId}-share-dist">(${myBoughtShares}/${totalBoughtShares}/${totalAvailableShares})</span>
            </div>
            <div class="buy-package-stat">
                <span>Your Potential Reward:</span>
                <span style="color: #FFD700; font-weight: bold;" id="${cardId}-reward">${initialReward.toFixed(8)} ${crypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Available Shares:</span>
                <span style="color: #4CAF50;">${availableShares}</span>
            </div>
            <div class="buy-package-stat">
                <span>Participants:</span>
                <span>${participants}</span>
            </div>
        </div>
        <div class="share-selector">
            <button class="share-button" onclick="adjustShares('${cardId}', -1, this)">-</button>
            <input
                type="number"
                id="${cardId}-shares"
                class="share-input"
                value="${myBoughtShares}"
                min="${myBoughtShares}"
                max="${myBoughtShares + availableShares}"
                oninput="updateShareCost('${cardId}')"
                onchange="validateShares('${cardId}', ${myBoughtShares + availableShares})"
                data-block-reward="${blockReward}"
                data-total-bought="${totalBoughtShares}"
                data-my-bought="${myBoughtShares}"
                data-total-available="${totalAvailableShares}"
                data-crypto="${crypto}"
            />
            <button class="share-button" onclick="adjustShares('${cardId}', 1, this)">+</button>
        </div>
        <div class="total-cost" id="${cardId}-cost" style="margin: 10px 0; color: #ffa500; font-weight: bold;">
            Total: 0 BTC ($0.00 AUD)
        </div>
        <button class="buy-package-button" onclick="buyTeamPackageUpdated('${packageId}', '${crypto}', '${cardId}')">
            Buy Shares
        </button>
        ${myBoughtShares > 0 ? `
        <button class="buy-package-button" style="background-color: #d32f2f; margin-top: 10px;" onclick="clearTeamSharesManual('${packageId}', '${packageName}')">
            Clear Shares
        </button>
        ` : ''}
    `;

    // Trigger initial cost/reward update
    setTimeout(() => {
        updateShareCost(cardId);
    }, 0);

    return card;
}

// NOTE: adjustShares() function is now defined earlier in the file (line ~8418)
// with comprehensive support for all ID formats (alert cards, highlighted packages, and non-highlighted packages)

// Helper function to validate share input
function validateShares(cardId, maxShares) {
    const input = document.getElementById(`${cardId}-shares`);
    let value = parseInt(input.value) || 0;

    if (value < 0) value = 0;
    if (value > maxShares) value = maxShares;

    input.value = value;
    updateShareCost(cardId);
}

// Update the total cost display when shares change
function updateShareCost(cardId) {
    const input = document.getElementById(`${cardId}-shares`);
    const costDisplay = document.getElementById(`${cardId}-cost`);
    const rewardDisplay = document.getElementById(`${cardId}-reward`);
    const shareDistDisplay = document.getElementById(`${cardId}-share-dist`);
    const shares = parseInt(input.value) || 0;

    // Extract data attributes from input
    const blockReward = parseFloat(input.dataset.blockReward) || 0;
    const totalBoughtShares = parseInt(input.dataset.totalBought) || 0;
    const myBoughtShares = parseInt(input.dataset.myBought) || 0;
    const totalAvailableShares = parseInt(input.dataset.totalAvailable) || 0;
    const crypto = input.dataset.crypto || '';

    // Extract share price from the card (stored in the buy button's onclick)
    const card = input.closest('.buy-package-card');
    const buyButton = card.querySelector('.buy-package-button');
    const onclickAttr = buyButton.getAttribute('onclick');
    const sharePriceMatch = onclickAttr.match(/buyTeamPackage\('[^']+',\s*'[^']+',\s*([\d.]+)/);

    // Calculate NEW shares to buy (input shows TOTAL shares I'll own)
    const newShares = shares - myBoughtShares;

    if (sharePriceMatch && shares > 0) {
        const sharePrice = parseFloat(sharePriceMatch[1]);
        // Price display shows TOTAL cost of ALL shares in input (not just new shares)
        const totalBTC = (sharePrice * shares).toFixed(8);
        const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
        const totalAUD = (sharePrice * shares * btcPrice).toFixed(2);

        costDisplay.textContent = `Total: ${totalBTC} BTC ($${totalAUD} AUD)`;
        costDisplay.style.color = '#4CAF50';

        // Calculate and update reward display
        const potentialReward = calculateTeamReward(blockReward, totalBoughtShares, myBoughtShares, shares);
        if (rewardDisplay) {
            rewardDisplay.textContent = `${potentialReward.toFixed(8)} ${crypto}`;
        }

        // Update share distribution display (mySharesAfter/totalBoughtAfter/totalAvailable)
        if (shareDistDisplay) {
            const newTotalBought = totalBoughtShares + newShares; // Total bought by everyone after my purchase
            shareDistDisplay.textContent = `(${shares}/${newTotalBought}/${totalAvailableShares})`;
        }
    } else {
        costDisplay.textContent = 'Total: 0 BTC ($0.00 AUD)';
        costDisplay.style.color = '#ffa500';

        // Show current reward when no new shares being bought
        const currentReward = myBoughtShares > 0 ? calculateTeamReward(blockReward, totalBoughtShares, myBoughtShares, myBoughtShares) : 0;
        if (rewardDisplay) {
            rewardDisplay.textContent = `${currentReward.toFixed(8)} ${crypto}`;
        }

        // Keep share distribution display (current state when no new shares)
        if (shareDistDisplay) {
            shareDistDisplay.textContent = `(${myBoughtShares}/${totalBoughtShares}/${totalAvailableShares})`;
        }
    }
}

// Make helper functions globally accessible
window.adjustShares = adjustShares;
window.validateShares = validateShares;
window.updateShareCost = updateShareCost;
window.getMyTeamShares = getMyTeamShares;
window.saveMyTeamShares = saveMyTeamShares;
window.calculateTeamReward = calculateTeamReward;

// Buy solo package using POST /main/api/v2/hashpower/solo/order
async function buySoloPackage(ticketId, crypto, packagePrice) {
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        showModal('Please configure EasyMining API settings first!');
        showEasyMiningSettingsPage();
        return;
    }

    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const priceAUD = (packagePrice * btcPrice).toFixed(2);

    if (!confirm(`Purchase Solo Package for ${crypto}?\n\nCost: ${packagePrice.toFixed(8)} BTC ($${priceAUD} AUD)\n\nThis will create an order on NiceHash.`)) {
        return;
    }

    try {
        // Sync time with NiceHash server before purchase
        console.log('⏰ Syncing time with NiceHash server...');
        await syncNiceHashTime();

        console.log('🛒 Creating NiceHash solo order...');
        console.log('   Ticket ID:', ticketId);
        console.log('   Crypto:', crypto);
        console.log('   Price:', packagePrice, 'BTC');

        // POST /main/api/v2/hashpower/solo/order with ticketId as URL parameter
        const endpoint = `/main/api/v2/hashpower/solo/order?ticketId=${ticketId}`;
        const body = JSON.stringify({});
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        console.log('📡 Endpoint:', endpoint);

        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'POST',
                    headers: headers,
                    body: {}
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `API Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('✅ Solo package purchased successfully:', result);

        showModal(`✅ Solo Package purchased successfully!\n\nCrypto: ${crypto}\nOrder ID: ${result.id || result.orderId || 'N/A'}\n\nOrder is now active and mining.`);

        // Update stats
        easyMiningData.allTimeStats.totalSpent += packagePrice * btcPrice;
        easyMiningData.todayStats.totalSpent += packagePrice * btcPrice;

        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh package data
        await fetchEasyMiningData();

    } catch (error) {
        console.error('❌ Error purchasing solo package:', error);
        showModal(`Failed to purchase package: ${error.message}\n\nPlease check your API credentials and balance.`);
    }
}

// Buy team package using POST /hashpower/api/v2/hashpower/shared/ticket/{id}
// New consolidated team package buy function using updated NiceHash API endpoint
async function buyTeamPackageUpdated(packageId, crypto, cardId) {
    // 1. Validate API settings
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        showModal('Please configure EasyMining API settings first!');
        showEasyMiningSettingsPage();
        return;
    }

    // 2. Get share count from input
    const input = document.getElementById(`${cardId}-shares`);
    const shares = parseInt(input.value) || 0;

    if (shares <= 0) {
        showModal('Please select at least 1 share to purchase.');
        return;
    }

    // 3. Calculate total amount (shares × 0.0001 BTC)
    const sharePrice = 0.0001;
    const totalAmount = shares * sharePrice;
    const totalCostBTC = totalAmount.toFixed(8);

    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const totalAUD = (totalAmount * btcPrice).toFixed(2);

    // 4. Get wallet address from localStorage
    let mainWalletAddress = getWithdrawalAddress(crypto);

    if (!mainWalletAddress) {
        mainWalletAddress = prompt(`Enter your ${crypto} withdrawal address for rewards:`);
        if (!mainWalletAddress) {
            showModal('Withdrawal address required to purchase team shares.');
            return;
        }
        saveWithdrawalAddress(crypto, mainWalletAddress);
    }

    // 5. Confirm purchase
    const confirmed = confirm(
        `Purchase ${shares} share(s) for ${crypto}?\n\n` +
        `Total Cost: ${totalCostBTC} BTC ($${totalAUD} AUD)\n` +
        `Withdrawal Address: ${mainWalletAddress}\n\n` +
        `Click OK to proceed with purchase.`
    );

    if (!confirmed) return;

    try {
        console.log('🛒 Creating NiceHash team order...');
        console.log('   Package ID:', packageId);
        console.log('   Crypto:', crypto);
        console.log('   Shares:', shares);
        console.log('   Total Amount:', totalAmount, 'BTC');

        // 6. Sync NiceHash time
        await syncNiceHashTime();

        // 7. Make single POST request for all shares (same as auto-buy)
        console.log(`🛒 Purchasing ${shares} share(s) via single POST request...`);

        const endpoint = `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`;

        // Request body with address, amount, and shares object
        const orderData = {
            amount: totalAmount, // Total BTC for all shares
            shares: {
                small: shares,
                medium: 0,
                large: 0,
                couponSmall: 0,
                couponMedium: 0,
                couponLarge: 0,
                massBuy: 0
            },
            soloMiningRewardAddr: mainWalletAddress.trim()
        };

        const body = JSON.stringify(orderData);
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        console.log(`📦 Manual Buy Request Details:`, {
            endpoint: endpoint,
            packageId: packageId,
            method: 'POST',
            body: orderData,
            headers: headers,
            fullURL: USE_VERCEL_PROXY ? VERCEL_PROXY_ENDPOINT : `https://api2.nicehash.com${endpoint}`
        });

        let response;
        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'POST',
                    headers: headers,
                    body: orderData
                })
            });
        } else {
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });
        }

        console.log(`📥 Response Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `API Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('✅ Team package purchased successfully:', result);

        // Validate response indicates success
        if (!result || (!result.id && !result.orderId && !result.success)) {
            throw new Error(`Purchase failed: Invalid response from NiceHash (no order ID returned)`);
        }

        // 8. Update tracking and show results
        const currentShares = getMyTeamShares(packageId) || 0;
        const newTotalShares = currentShares + shares;
        saveMyTeamShares(packageId, newTotalShares);
        console.log(`💾 Saved team shares for package ${packageId}: ${newTotalShares} shares (was ${currentShares})`);

        showModal(
            `✅ Purchase Complete!\n\n` +
            `Purchased: ${shares} share(s)\n` +
            `Cost: ${totalCostBTC} BTC ($${totalAUD} AUD)\n` +
            `Total Shares Owned: ${newTotalShares}\n` +
            `Order ID: ${result.id || result.orderId || 'N/A'}\n\n` +
            `Order is now active and mining.`
        );

        // Update stats
        easyMiningData.allTimeStats.totalSpent += parseFloat(totalAUD);
        easyMiningData.todayStats.totalSpent += parseFloat(totalAUD);
        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh data
        await fetchEasyMiningData();

    } catch (error) {
        console.error('❌ Error purchasing team package:', error);
        showModal(`Failed to purchase package: ${error.message}\n\nPlease check your API credentials and balance.`);
    }
}

// Make buy functions globally accessible
window.buySoloPackage = buySoloPackage;
window.buyTeamPackageUpdated = buyTeamPackageUpdated;

async function buyPackage(pkg) {
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        showModal('Please configure EasyMining API settings first!');
        showEasyMiningSettingsPage();
        return;
    }

    if (!confirm(`Purchase ${pkg.name} for $${pkg.price} AUD?\n\nThis will create an order on NiceHash.`)) {
        return;
    }

    try {
        console.log('Creating NiceHash order for:', pkg.name);

        // Map algorithm name to NiceHash algorithm ID
        const algorithmMap = {
            'SHA256': '20',
            'KawPow': '23',
            'Scrypt': '7',
            'kHeavyHash': '25'
        };

        const algorithmId = algorithmMap[pkg.algorithm] || '20';

        // Parse hashrate to amount (convert to basic units)
        let hashrateAmount = 0;
        if (pkg.hashrate) {
            const hashrateMatch = pkg.hashrate.match(/([\d.]+)\s*([A-Za-z]+)/);
            if (hashrateMatch) {
                const value = parseFloat(hashrateMatch[1]);
                const unit = hashrateMatch[2].toUpperCase();

                // Convert to H/s (base unit)
                const multipliers = {
                    'H/S': 1,
                    'KH/S': 1000,
                    'MH/S': 1000000,
                    'GH/S': 1000000000,
                    'TH/S': 1000000000000
                };

                hashrateAmount = value * (multipliers[unit] || 1);
            }
        }

        // Create order payload
        const orderData = {
            algorithm: algorithmId,
            amount: hashrateAmount.toString(),
            price: (parseFloat(pkg.price) * 0.01).toFixed(8), // Convert AUD to BTC price (estimate)
            limit: '0', // Standard order
            poolId: '', // User's pool
            market: 'USA' // Default market
        };

        // Call NiceHash API to create order
        const endpoint = '/main/api/v2/hashpower/order';
        const body = JSON.stringify(orderData);
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel serverless function as proxy
            console.log('✅ Using Vercel proxy to create order');
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'POST',
                    headers: headers,
                    body: orderData
                })
            });
        } else {
            // Direct call to NiceHash
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `API Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('Order created successfully:', result);

        showModal(`✅ Package "${pkg.name}" purchased successfully!\n\nOrder ID: ${result.id || 'N/A'}\n\nOrder is now active and mining.`);

        // Update stats
        easyMiningData.allTimeStats.totalSpent += parseFloat(pkg.price);
        easyMiningData.todayStats.totalSpent += parseFloat(pkg.price);

        // Calculate P&L
        easyMiningData.allTimeStats.pnl = easyMiningData.allTimeStats.totalReward - easyMiningData.allTimeStats.totalSpent;
        easyMiningData.todayStats.pnl = easyMiningData.todayStats.pnl - parseFloat(pkg.price);

        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh package data immediately to show the new order
        await fetchEasyMiningData();

    } catch (error) {
        console.error('Error purchasing package:', error);
        showModal(`Failed to purchase package: ${error.message}\n\nPlease check your API credentials and balance. You may need to configure your mining pool in NiceHash first.`);
    }
}

// Helper function to convert AUD to BTC (simplified)
function convertAUDtoBTC(audAmount) {
    // TODO: Fetch actual BTC/AUD rate
    // For now, use approximate rate
    const btcAudRate = 100000; // Example: 1 BTC = $100,000 AUD
    return (audAmount / btcAudRate).toFixed(8);
}

// =============================================================================
// PAGE-BASED BUY PACKAGES FUNCTIONS
// =============================================================================

function showBuyTabOnPage(tab) {
    const buttons = document.querySelectorAll('#buy-packages-page .tab-button');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    const singleContainer = document.getElementById('buy-single-packages-page');
    const teamContainer = document.getElementById('buy-team-packages-page');

    if (tab === 'single') {
        // Remove inline display style to let CSS media queries control the layout
        singleContainer.style.display = '';
        teamContainer.style.display = 'none';
    } else {
        // Remove inline display style to let CSS media queries control the layout
        singleContainer.style.display = 'none';
        teamContainer.style.display = '';
    }
}

// Initialize click-and-drag scrolling for horizontal sliders on tablet/mobile
function initializeDragScrolling() {
    const containers = [
        document.getElementById('buy-single-packages-page'),
        document.getElementById('buy-team-packages-page')
    ];

    containers.forEach(container => {
        if (!container) return;

        let isDown = false;
        let startX;
        let scrollLeft;

        container.addEventListener('mousedown', (e) => {
            // Only enable drag scrolling on tablet/mobile (when flex layout is active)
            const isFlexLayout = window.getComputedStyle(container).display === 'flex';
            if (!isFlexLayout) return;

            isDown = true;
            container.classList.add('active');
            startX = e.pageX - container.offsetLeft;
            scrollLeft = container.scrollLeft;
            container.style.cursor = 'grabbing';
        });

        container.addEventListener('mouseleave', () => {
            isDown = false;
            container.style.cursor = 'grab';
        });

        container.addEventListener('mouseup', () => {
            isDown = false;
            container.style.cursor = 'grab';
        });

        container.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - container.offsetLeft;
            const walk = (x - startX) * 2; // Scroll speed multiplier
            container.scrollLeft = scrollLeft - walk;
        });

        // Add mouse wheel horizontal scrolling
        container.addEventListener('wheel', (e) => {
            // Only enable wheel scrolling on tablet/mobile (when flex layout is active)
            const isFlexLayout = window.getComputedStyle(container).display === 'flex';
            if (!isFlexLayout) return;

            e.preventDefault();
            container.scrollLeft += e.deltaY; // Convert vertical scroll to horizontal
        });
    });

    console.log('✅ Drag scrolling and wheel scrolling initialized for buy packages containers');
}

function getRecommendedPackages() {
    // Return recommended package names from the buy packages page
    // These are the best value packages based on probability, reward, and price
    const recommended = [
        'Gold M',          // Best BTC solo package - good probability and price
        'Silver Team',     // Best BCH team package - low entry, good shares
        'Titanium KAS S'   // Best KAS solo package - fastest block times
    ];

    return recommended;
}

// Fetch solo packages from NiceHash public API
async function fetchNiceHashSoloPackages() {
    console.log('🔄 Fetching solo packages from NiceHash API...');

    try {
        const endpoint = '/main/api/v2/public/solo/package';

        console.log('📡 Using Vercel Proxy:', USE_VERCEL_PROXY);

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel proxy with POST method
            console.log('📡 Making POST request to Vercel proxy:', VERCEL_PROXY_ENDPOINT);
            console.log('📡 Endpoint:', endpoint);

            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    body: null
                })
            });
        } else {
            // Direct call to NiceHash API in development
            const url = `https://api2.nicehash.com${endpoint}`;
            console.log('📡 Making direct GET request to:', url);

            response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
        }

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error Response:', errorText);
            throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
        }

        const packages = await response.json();
        console.log(`✅ Fetched ${packages.length} solo packages from API`);
        console.log('📦 Raw API data (first 2):', packages.slice(0, 2));

        // Get current BTC price in AUD for price conversion
        let btcPriceAUD = 100000; // Default fallback
        const btcPriceElement = document.getElementById('bitcoin-price-aud');
        if (btcPriceElement) {
            const parsedBtcPrice = parseFloat(btcPriceElement.textContent.replace(/,/g, '').replace('$', ''));
            if (parsedBtcPrice > 0) {
                btcPriceAUD = parsedBtcPrice;
                console.log(`💰 Current BTC price in AUD: $${btcPriceAUD.toLocaleString()}`);
            }
        }

        // Transform API data to our package format
        const transformedPackages = packages
            .filter(pkg => pkg.available && pkg.status === 'A') // Only available packages
            .map(pkg => {
                // Calculate probability display (e.g., "1:150" from probability: 150)
                const probabilityRatio = pkg.probabilityPrecision >= 1
                    ? `1:${Math.round(pkg.probabilityPrecision)}`
                    : `${Math.round(1/pkg.probabilityPrecision)}:1`;

                // Convert duration from seconds to hours for display
                // e.g., 7200 seconds = 2 hours
                const durationHours = pkg.duration ? (pkg.duration / 3600).toFixed(0) : '0';

                // Check for dual-crypto packages (merge mining like DOGE+LTC)
                const hasMergeCurrency = !!pkg.mergeCurrencyAlgo;
                const mainCrypto = pkg.currencyAlgo.currency;
                const mergeCrypto = hasMergeCurrency ? pkg.mergeCurrencyAlgo.currency : null;
                const cryptoDisplay = hasMergeCurrency ? `${mergeCrypto}+${mainCrypto}` : mainCrypto;

                // Get block rewards from currencyAlgo and mergeCurrencyAlgo
                // For Palladium (DOGE+LTC): LTC is in currencyAlgo, DOGE is in mergeCurrencyAlgo
                // Use blockReward (not blockRewardWithNhFee) as per user requirement
                const mainBlockReward = pkg.currencyAlgo.blockReward;
                const mergeBlockReward = hasMergeCurrency
                    ? pkg.mergeCurrencyAlgo.blockReward
                    : null;

                // Calculate AUD price from BTC price
                const calculatedPriceAUD = pkg.price * btcPriceAUD;

                // Log raw API data for Palladium packages to verify extraction
                if (pkg.name.includes('Palladium')) {
                    console.log(`🔍 PALLADIUM PACKAGE RAW DATA for ${pkg.name}:`, {
                        currencyAlgo: pkg.currencyAlgo,
                        mergeCurrencyAlgo: pkg.mergeCurrencyAlgo,
                        extracted_mainBlockReward: mainBlockReward,
                        extracted_mergeBlockReward: mergeBlockReward
                    });
                }

                // Get probabilities for dual-crypto packages
                let mainProbability = probabilityRatio;
                let mergeProbability = null;

                if (hasMergeCurrency) {
                    // Main crypto probability (LTC) from probabilityPrecision
                    mainProbability = pkg.probabilityPrecision >= 1
                        ? `1:${Math.round(pkg.probabilityPrecision)}`
                        : `${Math.round(1/pkg.probabilityPrecision)}:1`;

                    // Merge crypto probability (DOGE) from mergeProbabilityPrecision
                    mergeProbability = pkg.mergeProbabilityPrecision >= 1
                        ? `1:${Math.round(pkg.mergeProbabilityPrecision)}`
                        : `${Math.round(1/pkg.mergeProbabilityPrecision)}:1`;
                }

                console.log(`📦 Mapping package ${pkg.name}:`, {
                    price_from_api: pkg.price,
                    duration_from_api: pkg.duration,
                    duration_in_hours: durationHours,
                    mainCurrency: mainCrypto,
                    mainBlockReward: mainBlockReward,
                    mainProbability: mainProbability,
                    mergeCurrency: mergeCrypto,
                    mergeBlockReward: mergeBlockReward,
                    mergeProbability: mergeProbability
                });

                return {
                    name: pkg.name,
                    crypto: cryptoDisplay,
                    mainCrypto: mainCrypto,
                    mergeCrypto: mergeCrypto,
                    probability: hasMergeCurrency ? mainProbability : probabilityRatio,
                    mainProbability: mainProbability,
                    mergeProbability: mergeProbability,
                    priceBTC: pkg.price,
                    priceAUD: calculatedPriceAUD.toFixed(2), // Calculated from BTC price
                    duration: `${durationHours}h`,
                    algorithm: pkg.currencyAlgo.miningAlgorithm,
                    hashrate: `${pkg.projectedSpeed.toFixed(4)} TH/s`, // From projectedSpeed
                    blockReward: mainBlockReward, // From currencyAlgo.blockReward
                    mergeBlockReward: mergeBlockReward,
                    isDualCrypto: hasMergeCurrency,
                    apiData: pkg // Store original API data for reference
                };
            });

        console.log(`✅ Transformed ${transformedPackages.length} packages`);
        console.log('✅ API DATA IS BEING USED!');
        return transformedPackages;

    } catch (error) {
        console.error('❌ Error fetching solo packages from API:', error);
        console.error('❌ Error details:', error.message);
        console.log('📦 Falling back to mock data');
        return null; // Return null to signal fallback to mock data
    }
}

// Fetch team packages from NiceHash API
async function fetchNiceHashTeamPackages() {
    console.log('🔄 Fetching team packages from NiceHash API...');

    try {
        const endpoint = '/main/api/v2/public/solo/shared/order?onlyGold=false';

        console.log('📡 Using Vercel Proxy:', USE_VERCEL_PROXY);

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel proxy with POST method
            console.log('📡 Making POST request to Vercel proxy:', VERCEL_PROXY_ENDPOINT);
            console.log('📡 Endpoint:', endpoint);

            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    body: null
                })
            });
        } else {
            // Direct call to NiceHash API in development
            const url = `https://api2.nicehash.com${endpoint}`;
            console.log('📡 Making direct GET request to:', url);

            response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
        }

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error Response:', errorText);
            throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const packages = data.list || []; // Team packages are in 'list' array
        console.log(`✅ Fetched ${packages.length} team packages from API`);
        console.log('📦 Raw team API data (first 2):', packages.slice(0, 2));

        // Get current BTC price in AUD for price conversion
        let btcPriceAUD = 100000; // Default fallback
        const btcPriceElement = document.getElementById('bitcoin-price-aud');
        if (btcPriceElement) {
            const parsedBtcPrice = parseFloat(btcPriceElement.textContent.replace(/,/g, '').replace('$', ''));
            if (parsedBtcPrice > 0) {
                btcPriceAUD = parsedBtcPrice;
                console.log(`💰 Current BTC price in AUD for team packages: $${btcPriceAUD.toLocaleString()}`);
            }
        }

        // Transform API data to our package format
        const transformedPackages = packages
            .filter(pkg => pkg.currencyAlgoTicket && pkg.currencyAlgoTicket.available && pkg.currencyAlgoTicket.status === 'A') // Only available packages
            .map(pkg => {
                const ticket = pkg.currencyAlgoTicket;

                // Calculate probability display from the outer probability (user's current share probability)
                const probabilityRatio = pkg.probabilityPrecision >= 1
                    ? `1:${Math.round(pkg.probabilityPrecision)}`
                    : `${Math.round(1/pkg.probabilityPrecision)}:1`;

                // Convert duration from seconds to hours
                const durationHours = pkg.duration ? (pkg.duration / 3600).toFixed(0) : '0';

                // Check for dual-crypto packages (merge mining like DOGE+LTC)
                const hasMergeCurrency = !!ticket.mergeCurrencyAlgo;
                const mainCrypto = ticket.currencyAlgo.currency;
                const mergeCrypto = hasMergeCurrency ? ticket.mergeCurrencyAlgo.currency : null;
                const cryptoDisplay = hasMergeCurrency ? `${mergeCrypto}+${mainCrypto}` : mainCrypto;

                // Get block rewards
                const mainBlockReward = ticket.currencyAlgo.blockReward;
                const mergeBlockReward = hasMergeCurrency
                    ? ticket.mergeCurrencyAlgo.blockReward
                    : null;

                // Get probabilities for dual-crypto packages
                let mainProbability = probabilityRatio;
                let mergeProbability = null;

                if (hasMergeCurrency) {
                    // Main crypto probability (LTC) from probabilityPrecision
                    mainProbability = pkg.probabilityPrecision >= 1
                        ? `1:${Math.round(pkg.probabilityPrecision)}`
                        : `${Math.round(1/pkg.probabilityPrecision)}:1`;

                    // Merge crypto probability (DOGE) from mergeProbabilityPrecision
                    mergeProbability = pkg.mergeProbabilityPrecision >= 1
                        ? `1:${Math.round(pkg.mergeProbabilityPrecision)}`
                        : `${Math.round(1/pkg.mergeProbabilityPrecision)}:1`;
                }

                // Calculate AUD price from BTC price
                const calculatedPriceAUD = ticket.price * btcPriceAUD;

                console.log(`📦 Mapping team package ${ticket.name}:`, {
                    ticket_id: ticket.id, // ← Correct ID for POST endpoint
                    package_id: pkg.id, // ← Wrong ID (not used)
                    participants: pkg.numberOfParticipants,
                    fullAmount: pkg.fullAmount,
                    addedAmount: pkg.addedAmount,
                    price_from_ticket: ticket.price,
                    price_in_aud: calculatedPriceAUD.toFixed(2),
                    duration_in_hours: durationHours,
                    mainCurrency: mainCrypto,
                    mainBlockReward: mainBlockReward,
                    mainProbability: mainProbability,
                    mergeCurrency: mergeCrypto,
                    mergeBlockReward: mergeBlockReward,
                    mergeProbability: mergeProbability
                });

                return {
                    id: ticket.id, // Use currencyAlgoTicket.id for the POST endpoint
                    name: ticket.name,
                    crypto: cryptoDisplay,
                    mainCrypto: mainCrypto,
                    mergeCrypto: mergeCrypto,
                    probability: hasMergeCurrency ? mainProbability : probabilityRatio,
                    mainProbability: mainProbability,
                    mergeProbability: mergeProbability,
                    priceBTC: ticket.price,
                    priceAUD: calculatedPriceAUD.toFixed(2), // Calculated from BTC price
                    duration: `${durationHours}h`,
                    algorithm: ticket.currencyAlgo.miningAlgorithm,
                    hashrate: `${pkg.projectedSpeed.toFixed(4)} TH/s`, // From projectedSpeed
                    blockReward: mainBlockReward, // From currencyAlgo.blockReward
                    mergeBlockReward: mergeBlockReward,
                    isDualCrypto: hasMergeCurrency,
                    numberOfParticipants: pkg.numberOfParticipants, // TEAM SPECIFIC
                    fullAmount: pkg.fullAmount, // TEAM SPECIFIC - Total BTC in pool
                    addedAmount: pkg.addedAmount, // TEAM SPECIFIC - User's contribution
                    shares: pkg.addedAmount && pkg.fullAmount ? ((pkg.addedAmount / pkg.fullAmount) * 100).toFixed(2) : '0', // Calculate user's share percentage
                    lifeTimeTill: pkg.lifeTimeTill, // TEAM SPECIFIC - Timestamp when package starts
                    isTeam: true, // Mark as team package
                    apiData: pkg // Store original API data
                };
            });

        console.log(`✅ Transformed ${transformedPackages.length} team packages`);
        return transformedPackages;

    } catch (error) {
        console.error('❌ Error fetching team packages from API:', error);
        console.error('❌ Error details:', error.message);
        return [];
    }
}

// Fetch prices for package cryptocurrencies
async function fetchPackageCryptoPrices(packages) {
    console.log('💰 Fetching prices for package cryptocurrencies...');

    // Map crypto symbols to CoinGecko IDs
    const cryptoIdMap = {
        'BTC': 'bitcoin',
        'BCH': 'bitcoin-cash',
        'KAS': 'kaspa',
        'RVN': 'ravencoin',
        'DOGE': 'dogecoin',
        'LTC': 'litecoin'
    };

    const prices = {};

    // Extract all cryptos needed (including both from dual-crypto packages)
    const cryptosToFetch = new Set(['bitcoin']); // Always include BTC for price calculations

    packages.forEach(pkg => {
        if (pkg.isDualCrypto) {
            // For dual-crypto packages, add both cryptos
            cryptosToFetch.add(pkg.mainCrypto);
            cryptosToFetch.add(pkg.mergeCrypto);
        } else if (pkg.crypto) {
            // For single-crypto packages, add the crypto
            cryptosToFetch.add(pkg.crypto);
        }
    });

    console.log('💰 Cryptos to fetch:', Array.from(cryptosToFetch));

    // Convert symbols to CoinGecko IDs
    const idsToFetch = Array.from(cryptosToFetch).map(symbol => cryptoIdMap[symbol]).filter(Boolean);
    const uniqueIds = [...new Set(idsToFetch)];

    console.log('💰 CoinGecko IDs to fetch:', uniqueIds);

    try {
        // Fetch all prices in one API call
        const ids = uniqueIds.join(',');
        const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=aud&x_cg_demo_api_key=${getApiKey()}`;

        const data = await fetchWithApiKeyRotation(apiUrl);
        console.log('💰 Fetched price data:', data);

        // Store prices with both symbol and ID as keys for easy lookup
        for (const [id, priceData] of Object.entries(data)) {
            prices[id] = priceData;
            // Also store by symbol (lowercase)
            for (const [symbol, coinGeckoId] of Object.entries(cryptoIdMap)) {
                if (coinGeckoId === id) {
                    prices[symbol.toLowerCase()] = priceData;
                }
            }
        }

        // Store BTC with 'btc' key as well
        if (data['bitcoin']) {
            prices['btc'] = data['bitcoin'];
        }

        console.log('✅ Package crypto prices loaded:', prices);
        console.log('💰 Price check - DOGE:', prices['doge'], 'LTC:', prices['ltc']);
        return prices;

    } catch (error) {
        console.error('❌ Error fetching package crypto prices:', error);
        return {};
    }
}

async function loadBuyPackagesDataOnPage() {
    console.log('📦 Loading packages on buy packages page...');

    // Initialize share values storage if not exists
    if (!window.packageShareValues) {
        window.packageShareValues = {};
    }

    // Fetch balance from NiceHash API
    try {
        console.log('💰 Fetching balance from NiceHash API...');
        const balanceData = await fetchNiceHashBalances();
        window.niceHashBalance = {
            available: balanceData.available || 0,
            pending: balanceData.pending || 0
        };
        console.log('✅ Balance fetched:', window.niceHashBalance);
    } catch (error) {
        console.warn('⚠️ Failed to fetch balance, using fallback:', error);
        // Fallback to easyMiningData or zero
        window.niceHashBalance = {
            available: easyMiningData?.balanceBTC || 0,
            pending: easyMiningData?.pendingBTC || 0
        };
    }

    // Try to fetch from API, fall back to mock data
    let singlePackages = await fetchNiceHashSoloPackages();

    // If API fails, use mock data
    if (!singlePackages || singlePackages.length === 0) {
        console.log('📦 Using mock solo package data');
        singlePackages = [
            { name: 'Gold S', crypto: 'BTC', probability: '1:150', priceBTC: 0.0001, priceAUD: '15.00', duration: '24h', algorithm: 'SHA256', hashrate: '1 TH/s', blockReward: 3.125 },
            { name: 'Gold M', crypto: 'BTC', probability: '1:75', priceBTC: 0.001, priceAUD: '30.00', duration: '24h', algorithm: 'SHA256', hashrate: '2 TH/s', blockReward: 3.125 },
            { name: 'Gold L', crypto: 'BTC', probability: '1:35', priceBTC: 0.01, priceAUD: '60.00', duration: '24h', algorithm: 'SHA256', hashrate: '5 TH/s', blockReward: 3.125 },
            { name: 'Silver S', crypto: 'BCH', probability: '1:180', priceBTC: 0.0001, priceAUD: '12.00', duration: '24h', algorithm: 'SHA256', hashrate: '1 TH/s', blockReward: 3.125 },
            { name: 'Silver M', crypto: 'BCH', probability: '1:90', priceBTC: 0.001, priceAUD: '24.00', duration: '24h', algorithm: 'SHA256', hashrate: '2 TH/s', blockReward: 3.125 },
            { name: 'Chromium S', crypto: 'RVN', probability: '1:200', priceBTC: 0.0001, priceAUD: '10.00', duration: '24h', algorithm: 'KawPow', hashrate: '100 MH/s', blockReward: 2500 },
            { name: 'Palladium DOGE S', crypto: 'DOGE', probability: '1:220', priceBTC: 0.0001, priceAUD: '11.00', duration: '24h', algorithm: 'Scrypt', hashrate: '500 MH/s', blockReward: 10000 },
            { name: 'Palladium LTC S', crypto: 'LTC', probability: '1:210', priceBTC: 0.0001, priceAUD: '12.00', duration: '24h', algorithm: 'Scrypt', hashrate: '500 MH/s', blockReward: 6.25 },
            { name: 'Titanium KAS S', crypto: 'KAS', probability: '1:160', priceBTC: 0.0001, priceAUD: '13.00', duration: '24h', algorithm: 'kHeavyHash', hashrate: '1 TH/s', blockReward: 3.8890873 }
        ];
    }

    // Fetch team packages from API
    let teamPackages = await fetchNiceHashTeamPackages();
    console.log(`✅ Fetched ${teamPackages.length} team packages from API`);

    // Fetch prices for all package cryptocurrencies before displaying
    const allPackages = [...singlePackages, ...teamPackages];
    window.packageCryptoPrices = await fetchPackageCryptoPrices(allPackages);

    // Load solo recommendations to highlight packages
    console.log('🔔 Loading solo recommendations for package highlighting...');
    const soloRecommendations = await checkPackageRecommendations();
    const soloRecommendedNames = soloRecommendations.map(pkg => pkg.name);
    console.log(`✅ Found ${soloRecommendedNames.length} recommended solo package(s) for highlighting`);

    // Load team recommendations to highlight packages
    console.log('🔔 Loading team recommendations for package highlighting...');
    const teamRecommendations = await checkTeamRecommendations();
    const teamRecommendedNames = teamRecommendations.map(pkg => pkg.name);
    console.log(`✅ Found ${teamRecommendedNames.length} recommended team package(s) for highlighting`);

    // Recommendations section container is hidden in HTML - we only use recommendedNames for highlighting
    // Recommendations display only shows in EasyMining section

    // Populate balance section at the top
    const balanceSection = document.getElementById('buy-packages-balance-section');
    if (!balanceSection) {
        console.error('❌ Could not find buy-packages-balance-section container!');
        return;
    }

    const availableBalance = window.niceHashBalance?.available || 0;
    const pendingBalance = window.niceHashBalance?.pending || 0;
    const availableAUD = window.packageCryptoPrices?.['btc']?.aud
        ? (availableBalance * window.packageCryptoPrices['btc'].aud).toFixed(2)
        : '0.00';
    const pendingAUD = window.packageCryptoPrices?.['btc']?.aud
        ? (pendingBalance * window.packageCryptoPrices['btc'].aud).toFixed(2)
        : '0.00';

    balanceSection.innerHTML = `
        <div style="padding: 20px; background-color: #2a2a2a; border-radius: 8px; border-left: 4px solid #4CAF50;">
            <div style="display: flex; justify-content: space-around; align-items: center; gap: 40px;">
                <div style="flex: 1; text-align: center;">
                    <div style="color: #aaa; font-size: 14px; margin-bottom: 8px;">💰 Available Balance</div>
                    <div style="color: #4CAF50; font-size: 20px; font-weight: bold;">${availableBalance.toFixed(8)} BTC</div>
                    <div style="color: #888; font-size: 13px;">≈ $${availableAUD} AUD</div>
                </div>
                <div style="flex: 1; text-align: center;">
                    <div style="color: #aaa; font-size: 14px; margin-bottom: 8px;">⏳ Pending Balance</div>
                    <div style="color: #FFA500; font-size: 20px; font-weight: bold;">${pendingBalance.toFixed(8)} BTC</div>
                    <div style="color: #888; font-size: 13px;">≈ $${pendingAUD} AUD</div>
                </div>
            </div>
        </div>
    `;
    console.log('✅ Balance section populated');

    // Populate single packages
    const singleContainer = document.getElementById('buy-single-packages-page');
    if (!singleContainer) {
        console.error('❌ Could not find buy-single-packages-page container!');
        return;
    }

    console.log(`📦 Populating ${singlePackages.length} single packages...`);
    singleContainer.innerHTML = '';

    singlePackages.forEach(pkg => {
        try {
            const isRecommended = soloRecommendedNames.includes(pkg.name);
            const card = createBuyPackageCardForPage(pkg, isRecommended);
            singleContainer.appendChild(card);
        } catch (error) {
            console.error('❌ Error creating card for package:', pkg.name, error);
        }
    });
    console.log('✅ Single packages populated');

    // Populate team packages
    const teamContainer = document.getElementById('buy-team-packages-page');
    if (!teamContainer) {
        console.error('❌ Could not find buy-team-packages-page container!');
        return;
    }

    console.log(`👥 Populating ${teamPackages.length} team packages...`);
    teamContainer.innerHTML = '';

    teamPackages.forEach(pkg => {
        try {
            const isRecommended = teamRecommendedNames.includes(pkg.name);
            const card = createBuyPackageCardForPage(pkg, isRecommended);
            teamContainer.appendChild(card);
        } catch (error) {
            console.error('❌ Error creating card for package:', pkg.name, error);
        }
    });
    console.log('✅ Team packages populated');

    // Store team packages for countdown updates
    window.currentTeamPackages = teamPackages;

    // Start countdown updates for team packages
    startCountdownUpdates();

    // Initialize drag scrolling for horizontal sliders on tablet/mobile
    initializeDragScrolling();

    // Restore saved share values after packages are populated
    if (window.packageShareValues && Object.keys(window.packageShareValues).length > 0) {
        console.log('🔄 Restoring share values:', window.packageShareValues);
        for (const [packageName, value] of Object.entries(window.packageShareValues)) {
            if (value > 0) {
                const inputId = `shares-${packageName.replace(/\s+/g, '-')}`;

                // CRITICAL FIX: Find elements within Buy Packages page containers only (not EasyMining alerts)
                // Try team container first, then single container
                let input = teamContainer.querySelector(`#${inputId}`);
                if (!input) {
                    input = singleContainer.querySelector(`#${inputId}`);
                }

                if (input) {
                    input.value = value;
                    console.log(`✅ Restored ${packageName} = ${value}`);

                    // Update reward and price displays based on restored value
                    const packageId = packageName.replace(/\s+/g, '-');

                    // CRITICAL: Find elements in the same container as the input
                    const container = input.closest('.buy-package-card');
                    const rewardValueElement = container ? container.querySelector(`#reward-value-${packageId}`) : null;
                    const priceElement = container ? container.querySelector(`#price-${packageId}`) : null;
                    const mainRewardElement = container ? container.querySelector(`#main-reward-${packageId}`) : null;
                    const mergeRewardElement = container ? container.querySelector(`#merge-reward-${packageId}`) : null;

                    if (window.packageBaseValues && window.packageBaseValues[packageName]) {
                        const baseValues = window.packageBaseValues[packageName];

                        // Price increases linearly
                        const newPriceAUD = (baseValues.priceAUD * value).toFixed(2);

                        // CORRECT FORMULA: blockReward ÷ ((totalBought - myBought) + myShares) × myShares
                        const totalBoughtShares = baseValues.totalBoughtShares || 0;
                        const myBoughtShares = baseValues.myBoughtShares || 0;
                        const myShares = value;
                        const othersBought = totalBoughtShares - myBoughtShares;
                        const totalShares = othersBought + myShares;

                        const totalRewardAUD = baseValues.totalRewardAUD || 0;
                        const totalMainReward = baseValues.totalMainReward || 0;
                        const totalMergeReward = baseValues.totalMergeReward || 0;

                        const rewardPerShareAUD = totalShares > 0 ? totalRewardAUD / totalShares : 0;
                        const myRewardAUD = (rewardPerShareAUD * myShares).toFixed(2);

                        if (rewardValueElement) {
                            rewardValueElement.textContent = `$${myRewardAUD} AUD`;
                        }
                        if (priceElement) {
                            priceElement.textContent = `$${newPriceAUD} AUD`;
                        }

                        // Update crypto reward amounts with CORRECT formula
                        if (mainRewardElement && totalMainReward) {
                            const rewardPerShare = totalShares > 0 ? totalMainReward / totalShares : 0;
                            const myMainReward = rewardPerShare * myShares;
                            const decimals = baseValues.mainCrypto === 'BTC' || baseValues.mainCrypto === 'BCH' ? 4 : 0;
                            mainRewardElement.textContent = `${myMainReward.toFixed(decimals)} ${baseValues.mainCrypto}`;
                        }

                        if (mergeRewardElement && totalMergeReward && baseValues.isDualCrypto) {
                            const rewardPerShare = totalShares > 0 ? totalMergeReward / totalShares : 0;
                            const myMergeReward = rewardPerShare * myShares;
                            const mergeDecimals = baseValues.mergeCrypto === 'LTC' ? 2 : 0;
                            mergeRewardElement.textContent = `${myMergeReward.toFixed(mergeDecimals)} ${baseValues.mergeCrypto}`;
                        }
                    }

                    // Update + button state based on restored value
                    const availableBalance = window.niceHashBalance?.available || 0;
                    const sharePrice = 0.0001;
                    const nextShareCost = (value + 1) * sharePrice;
                    const plusButtonId = `plus-${packageName.replace(/\s+/g, '-')}`;
                    const plusButton = document.getElementById(plusButtonId);

                    if (plusButton) {
                        if (availableBalance < nextShareCost) {
                            plusButton.disabled = true;
                            plusButton.style.opacity = '0.5';
                            plusButton.style.cursor = 'not-allowed';
                        } else {
                            plusButton.disabled = false;
                            plusButton.style.opacity = '1';
                            plusButton.style.cursor = 'pointer';
                        }
                    }
                }
            }
        }
    }
}

// Update countdown timers for team packages
function updateTeamPackageCountdowns() {
    // Get all team packages from the current display
    if (!window.currentTeamPackages || window.currentTeamPackages.length === 0) {
        return;
    }

    // Check if auto-clear is enabled
    const autoClearEnabled = easyMiningSettings.autoClearTeamShares || false;

    // Get current team recommendations to check if package still meets thresholds
    const currentRecommendations = currentTeamRecommendations || [];
    const recommendedPackageIds = currentRecommendations.map(rec => rec.apiData?.id || rec.id);

    window.currentTeamPackages.forEach(pkg => {
        if (pkg.lifeTimeTill) {
            const countdownElement = document.getElementById(`countdown-${pkg.id}`);
            if (countdownElement) {
                const startTime = new Date(pkg.lifeTimeTill);
                const now = new Date();
                const timeUntilStart = startTime - now;

                if (timeUntilStart > 0) {
                    const hours = Math.floor(timeUntilStart / (1000 * 60 * 60));
                    const minutes = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((timeUntilStart % (1000 * 60)) / 1000);

                    countdownElement.textContent = `${hours}h ${minutes}m ${seconds}s`;
                    countdownElement.style.color = '#FFA500';

                    // AUTO-CLEAR LOGIC: Check if countdown <= 2 minutes AND auto-clear is enabled
                    if (autoClearEnabled && timeUntilStart <= 120000) { // 120000ms = 2 minutes
                        const packageId = pkg.apiData?.id || pkg.id;
                        const myShares = getMyTeamShares(packageId) || 0;

                        // Only clear if package has shares AND is NOT in recommendations (no longer meets thresholds)
                        const isStillRecommended = recommendedPackageIds.includes(packageId);

                        if (myShares > 0 && !isStillRecommended) {
                            // Check if we haven't already cleared this package (to avoid duplicate clears)
                            const clearedKey = `${loggedInUser}_autoClearedPackage_${packageId}`;
                            const alreadyCleared = localStorage.getItem(clearedKey);

                            if (!alreadyCleared) {
                                console.log(`🤖 Auto-clear triggered for ${pkg.name}:`, {
                                    timeUntilStart: `${minutes}m ${seconds}s`,
                                    myShares: myShares,
                                    isStillRecommended: isStillRecommended
                                });

                                // Mark as cleared to prevent duplicate clears
                                localStorage.setItem(clearedKey, 'true');

                                // Call auto-clear function (async, no await to avoid blocking countdown updates)
                                autoClearTeamShares(packageId, pkg.name).catch(err => {
                                    console.error('Auto-clear failed:', err);
                                    // Remove cleared flag if failed, so it can retry
                                    localStorage.removeItem(clearedKey);
                                });
                            }
                        }
                    }
                } else {
                    // Countdown ended - show "Starting Soon!" until package goes active
                    countdownElement.textContent = 'Starting Soon!';
                    countdownElement.style.color = '#4CAF50';
                    countdownElement.style.fontWeight = 'bold';
                }
            }
        }
    });
}

// Start countdown update interval
let countdownInterval = null;
function startCountdownUpdates() {
    // Clear existing interval if any
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    // Update every second
    countdownInterval = setInterval(updateTeamPackageCountdowns, 1000);
}

function stopCountdownUpdates() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

function createBuyPackageCardForPage(pkg, isRecommended) {
    const card = document.createElement('div');
    card.className = 'buy-package-card' + (isRecommended ? ' recommended' : '') + (pkg.isTeam ? ' team-package' : '');

    // Use package crypto prices (fetched specifically for buy packages page)
    const prices = window.packageCryptoPrices || {};

    // Calculate reward in AUD based on crypto prices
    let rewardAUD = 0;
    let mainRewardAUD = 0;
    let mergeRewardAUD = 0;

    if (pkg.isDualCrypto) {
        // Dual-crypto package (e.g., DOGE+LTC)
        try {
            // Calculate main crypto reward (LTC)
            const mainCryptoKey = pkg.mainCrypto.toLowerCase();
            if (prices[mainCryptoKey] && prices[mainCryptoKey].aud) {
                mainRewardAUD = parseFloat((pkg.blockReward * prices[mainCryptoKey].aud).toFixed(2));
            }

            // Calculate merge crypto reward (DOGE)
            const mergeCryptoKey = pkg.mergeCrypto.toLowerCase();
            if (prices[mergeCryptoKey] && prices[mergeCryptoKey].aud) {
                mergeRewardAUD = parseFloat((pkg.mergeBlockReward * prices[mergeCryptoKey].aud).toFixed(2));
            }

            // Total reward in AUD
            rewardAUD = (mainRewardAUD + mergeRewardAUD).toFixed(2);

            console.log(`💰 ${pkg.name} Dual Reward Calc:`, {
                mainCrypto: pkg.mainCrypto,
                mainBlockReward: pkg.blockReward,
                mainRewardAUD: mainRewardAUD,
                mergeCrypto: pkg.mergeCrypto,
                mergeBlockReward: pkg.mergeBlockReward,
                mergeRewardAUD: mergeRewardAUD,
                totalRewardAUD: rewardAUD
            });
        } catch (error) {
            console.log('Could not calculate dual crypto reward AUD:', error);
            rewardAUD = 0;
        }
    } else {
        // Single crypto package
        if (pkg.blockReward && pkg.crypto) {
            try {
                const cryptoKey = pkg.crypto.toLowerCase();
                if (prices[cryptoKey] && prices[cryptoKey].aud) {
                    rewardAUD = (pkg.blockReward * prices[cryptoKey].aud).toFixed(2);
                    console.log(`💰 ${pkg.name} Reward Calc:`, {
                        blockReward: pkg.blockReward,
                        crypto: pkg.crypto,
                        cryptoPrice_AUD: prices[cryptoKey].aud,
                        rewardAUD: rewardAUD
                    });
                } else {
                    console.log(`⚠️ ${pkg.name} - Missing price data for ${cryptoKey}. Available prices:`, Object.keys(prices));
                }
            } catch (error) {
                console.log('Could not calculate reward AUD:', error);
                rewardAUD = 0;
            }
        }
    }

    // Calculate package price in AUD from BTC price using live portfolio BTC price
    let priceAUD = 0;
    if (pkg.priceBTC) {
        try {
            // Get LIVE BTC price from portfolio page (same as buy packages page)
            priceAUD = convertBTCtoAUD(pkg.priceBTC).toFixed(2);
            console.log(`💵 ${pkg.name} Price Calc (LIVE):`, {
                priceBTC: pkg.priceBTC,
                priceAUD: priceAUD
            });
        } catch (error) {
            console.log('Could not calculate price AUD:', error);
            priceAUD = 0;
        }
    } else {
        console.log(`⚠️ ${pkg.name} - No priceBTC field`);
    }

    // Generate package ID for element IDs (used for value updates)
    const packageIdForElements = pkg.name.replace(/\s+/g, '-');

    const hashrateInfo = pkg.hashrate ? `
        <div class="buy-package-stat">
            <span>Hashrate:</span>
            <span id="hashrate-${packageIdForElements}">${pkg.hashrate}</span>
        </div>
    ` : '';

    // For team packages: show shares, participants, and countdown
    let countdownInfo = '';
    if (pkg.isTeam) {
        const participants = pkg.numberOfParticipants || 0;

        if (pkg.lifeTimeTill) {
            // Calculate time until start
            const startTime = new Date(pkg.lifeTimeTill);
            const now = new Date();
            const timeUntilStart = startTime - now;

            if (timeUntilStart > 0) {
                // Package hasn't started yet
                // Countdown kicks in when numberOfParticipants reaches 2

                // Show "Mining Lobby" when package has < 2 participants (waiting for players)
                // Show "Starting Soon!" when countdown is ending (< 60 seconds)
                // Show timer when participants >= 2 and countdown is active (>= 60 seconds)
                if (participants < 2) {
                    // Waiting in lobby - show "Mining Lobby"
                    countdownInfo = `
                        <div class="buy-package-stat">
                            <span>Starting:</span>
                            <span id="countdown-${pkg.id}" class="mining-lobby-fade" style="color: #FFA500; font-weight: bold;">Mining Lobby</span>
                        </div>
                    `;
                    console.log(`📅 ${pkg.name} - Participants: ${participants} (< 2) → Mining Lobby`);
                } else if (timeUntilStart < 60000) {
                    // Countdown ending (< 60 seconds) - show "Starting Soon!"
                    countdownInfo = `
                        <div class="buy-package-stat">
                            <span>Starting:</span>
                            <span id="countdown-${pkg.id}" style="color: #4CAF50; font-weight: bold;">Starting Soon!</span>
                        </div>
                    `;
                    console.log(`📅 ${pkg.name} - Participants: ${participants}, Time: ${Math.floor(timeUntilStart/1000)}s → Starting Soon!`);
                } else {
                    // Countdown is active - show timer
                    const hours = Math.floor(timeUntilStart / (1000 * 60 * 60));
                    const minutes = Math.floor((timeUntilStart % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((timeUntilStart % (1000 * 60)) / 1000);

                    countdownInfo = `
                        <div class="buy-package-stat">
                            <span>Starting:</span>
                            <span id="countdown-${pkg.id}" style="color: #FFA500;">${hours}h ${minutes}m ${seconds}s</span>
                        </div>
                    `;
                    console.log(`📅 ${pkg.name} - Participants: ${participants} (>= 2) → Countdown: ${hours}h ${minutes}m ${seconds}s`);
                }
            } else {
                // Countdown has ended - show "Starting Soon!" until package goes active
                countdownInfo = `
                    <div class="buy-package-stat">
                        <span>Starting:</span>
                        <span id="countdown-${pkg.id}" style="color: #4CAF50; font-weight: bold;">Starting Soon!</span>
                    </div>
                `;
                console.log(`📅 ${pkg.name} - Countdown ended → Starting Soon!`);
            }
        } else if (participants < 2) {
            // No lifeTimeTill set yet, but show "Mining Lobby" if < 2 participants
            countdownInfo = `
                <div class="buy-package-stat">
                    <span>Starting:</span>
                    <span id="countdown-${pkg.id}" class="mining-lobby-fade" style="color: #FFA500; font-weight: bold;">Mining Lobby</span>
                </div>
            `;
            console.log(`📅 ${pkg.name} - No lifeTimeTill, Participants: ${participants} (< 2) → Mining Lobby`);
        }
    }

    const sharesInfo = pkg.isTeam ? `
        <div class="buy-package-stat">
            <span>Participants:</span>
            <span style="color: #4CAF50;">${pkg.numberOfParticipants || 0}</span>
        </div>
        <div class="buy-package-stat">
            <span>Share Distribution:</span>
            <span style="color: #ffa500;">${(() => {
                const sharePrice = 0.0001;
                const totalBoughtShares = pkg.addedAmount ? Math.round(pkg.addedAmount * 10000) : 0;
                const totalAvailableShares = pkg.fullAmount ? Math.round(pkg.fullAmount * 10000) : 0;
                // Use same ID logic as when saving shares
                const packageId = pkg.apiData?.id || pkg.id;
                const myBoughtShares = getMyTeamShares(packageId) || 0;
                return `(${myBoughtShares}/${totalBoughtShares}/${totalAvailableShares})`;
            })()}</span>
        </div>
        ${countdownInfo}
    ` : '';

    // Probability section - handle dual-crypto packages
    let probabilityInfo = '';
    if (pkg.isDualCrypto) {
        // For solo dual-crypto packages (Palladium), show both probabilities on one line with separate spans for updates
        if (!pkg.isTeam) {
            probabilityInfo = `
                <div class="buy-package-stat">
                    <span>Probability:</span>
                    <span id="merge-probability-${packageIdForElements}">${pkg.mergeProbability} ${pkg.mergeCrypto}</span>
                    <span id="main-probability-${packageIdForElements}">${pkg.mainProbability} ${pkg.mainCrypto}</span>
                </div>
            `;
        } else {
            // For team dual-crypto packages, show on separate lines
            probabilityInfo = `
                <div class="buy-package-stat">
                    <span>Probability ${pkg.mergeCrypto}:</span>
                    <span id="merge-probability-${packageIdForElements}">${pkg.mergeProbability}</span>
                </div>
                <div class="buy-package-stat">
                    <span>Probability ${pkg.mainCrypto}:</span>
                    <span id="main-probability-${packageIdForElements}">${pkg.mainProbability}</span>
                </div>
            `;
        }
    } else if (pkg.probability) {
        // Single crypto package
        probabilityInfo = `
            <div class="buy-package-stat">
                <span>Probability:</span>
                <span id="probability-${packageIdForElements}">${pkg.probability}</span>
            </div>
        `;
    }

    // Potential reward section - handle dual-crypto packages
    let rewardInfo = '';
    const packageId = pkg.name.replace(/\s+/g, '-');

    if (pkg.isDualCrypto) {
        // Calculate rewards for 1 share using division formula
        let myMergeReward = pkg.mergeBlockReward || 0;
        let myMainReward = pkg.blockReward || 0;
        let myRewardValueAUD = parseFloat(rewardAUD);

        if (pkg.isTeam && pkg.addedAmount !== undefined) {
            const sharePrice = 0.0001;
            const totalBoughtShares = Math.round((pkg.addedAmount || 0) * 10000); // Total bought by everyone
            const myBoughtShares = getMyTeamShares(pkg.id) || 0; // My previously bought shares
            const myShares = 1; // Initial display for 1 share

            // Correct formula: blockReward ÷ ((totalBought - myBought) + myShares) × myShares
            const othersBought = totalBoughtShares - myBoughtShares;
            const totalShares = othersBought + myShares;

            const mergeRewardPerShare = totalShares > 0 ? (pkg.mergeBlockReward || 0) / totalShares : 0;
            const mainRewardPerShare = totalShares > 0 ? (pkg.blockReward || 0) / totalShares : 0;
            const rewardValuePerShareAUD = totalShares > 0 ? parseFloat(rewardAUD) / totalShares : 0;

            myMergeReward = mergeRewardPerShare * myShares;
            myMainReward = mainRewardPerShare * myShares;
            myRewardValueAUD = rewardValuePerShareAUD * myShares;

            console.log(`💰 ${pkg.name} Dual-Crypto Reward (Page):
            - Total Bought: ${totalBoughtShares}, My Bought: ${myBoughtShares}, Buying: ${myShares}
            - Others: ${othersBought}, Pool: ${totalShares}
            - ${pkg.mergeCrypto} Block: ${pkg.mergeBlockReward}, My Reward: ${myMergeReward.toFixed(2)}
            - ${pkg.mainCrypto} Block: ${pkg.blockReward}, My Reward: ${myMainReward.toFixed(4)}`);
        }

        // Show both rewards for dual-crypto packages (DOGE+LTC)
        const mergeDecimals = pkg.mergeCrypto === 'LTC' ? 2 : 0;
        rewardInfo = `
            <div class="buy-package-stat">
                <span>Reward ${pkg.mergeCrypto}:</span>
                <span id="merge-reward-${packageId}" style="color: #4CAF50;">${myMergeReward.toFixed(mergeDecimals)} ${pkg.mergeCrypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Reward ${pkg.mainCrypto}:</span>
                <span id="main-reward-${packageId}" style="color: #4CAF50;">${myMainReward.toFixed(4)} ${pkg.mainCrypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Reward Value:</span>
                <span id="reward-value-${packageId}" style="color: #4CAF50;">$${myRewardValueAUD.toFixed(2)} AUD</span>
            </div>
        `;
    } else if (pkg.blockReward) {
        // Single crypto package - calculate reward for 1 share using division formula
        let myMainReward = pkg.blockReward;
        let myRewardValueAUD = parseFloat(rewardAUD);

        if (pkg.isTeam && pkg.addedAmount !== undefined) {
            const sharePrice = 0.0001;
            const totalBoughtShares = Math.round((pkg.addedAmount || 0) * 10000); // Total bought by everyone
            const myBoughtShares = getMyTeamShares(pkg.id) || 0; // My previously bought shares
            const myShares = 1; // Initial display for 1 share

            // Correct formula: blockReward ÷ ((totalBought - myBought) + myShares) × myShares
            const othersBought = totalBoughtShares - myBoughtShares;
            const totalShares = othersBought + myShares;

            const mainRewardPerShare = totalShares > 0 ? pkg.blockReward / totalShares : 0;
            const rewardValuePerShareAUD = totalShares > 0 ? parseFloat(rewardAUD) / totalShares : 0;

            myMainReward = mainRewardPerShare * myShares;
            myRewardValueAUD = rewardValuePerShareAUD * myShares;

            console.log(`💰 ${pkg.name} Single-Crypto Reward (Page):
            - Total Bought: ${totalBoughtShares}, My Bought: ${myBoughtShares}, Buying: ${myShares}
            - Others: ${othersBought}, Pool: ${totalShares}
            - Block Reward: ${pkg.blockReward}, My Reward: ${myMainReward.toFixed(8)}`);
        }

        rewardInfo = `
            <div class="buy-package-stat">
                <span>Reward:</span>
                <span id="main-reward-${packageId}" style="color: #4CAF50;">${myMainReward.toFixed(pkg.crypto === 'BTC' || pkg.crypto === 'BCH' ? 4 : 2)} ${pkg.crypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Reward Value:</span>
                <span id="reward-value-${packageId}" style="color: #4CAF50;">$${myRewardValueAUD.toFixed(2)} AUD</span>
            </div>
        `;
    }

    // Get available balance from fetched NiceHash balance
    const availableBalance = window.niceHashBalance?.available || 0;

    // Calculate affordability
    let canAfford = false;
    let sharePrice = 0.0001; // Team packages: 0.0001 BTC per share
    let buyButtonDisabled = '';
    let buyButtonStyle = '';

    if (pkg.isTeam) {
        // Team package: check if user can afford at least 1 share
        canAfford = availableBalance >= sharePrice;
        buyButtonDisabled = canAfford ? '' : 'disabled';
        buyButtonStyle = canAfford ? '' : 'opacity: 0.5; cursor: not-allowed;';
    } else {
        // Solo package: check if user can afford full package price
        canAfford = availableBalance >= (pkg.priceBTC || 0);
        buyButtonDisabled = canAfford ? '' : 'disabled';
        buyButtonStyle = canAfford ? '' : 'opacity: 0.5; cursor: not-allowed;';
    }

    // For team packages: get user's current bought shares
    let myBoughtShares = 0;
    let initialShareValue = 1;
    let totalBoughtShares = 0;
    let totalAvailableShares = 9999;
    let blockReward = 0;
    if (pkg.isTeam) {
        // Use same ID logic as when saving shares
        const packageId = pkg.apiData?.id || pkg.id;
        myBoughtShares = getMyTeamShares(packageId) || 0;
        console.log(`📊 Team package "${pkg.name}" - ID: ${packageId}, My shares: ${myBoughtShares}`);
        // Input starts at owned shares, or 1 if none owned
        initialShareValue = myBoughtShares || 1;

        // Calculate share data for team packages (matching buy packages page)
        totalBoughtShares = pkg.addedAmount && pkg.addedAmount > 0 ? Math.round(pkg.addedAmount * 10000) : 0;
        totalAvailableShares = pkg.fullAmount ? Math.round(pkg.fullAmount * 10000) : 9999;
        blockReward = pkg.blockReward || 0;

        // Recalculate initial price to show cost of all shares in input (total, not new)
        priceAUD = convertBTCtoAUD(initialShareValue * sharePrice).toFixed(2);
    }

    // For team packages: add share selector with buy button on same row
    // NO initial disabled states - let adjustShares() handle button states dynamically
    const teamShareSelector = pkg.isTeam ? `
        <div class="share-adjuster">
            <button onclick="adjustShares('${pkg.name}', -1, this)" class="share-adjuster-btn">-</button>
            <input
                type="number"
                id="shares-${pkg.name.replace(/\s+/g, '-')}"
                value="${initialShareValue}"
                min="${myBoughtShares || 1}"
                max="9999"
                class="share-adjuster-input"
                readonly
                data-block-reward="${blockReward}"
                data-total-bought="${totalBoughtShares}"
                data-my-bought="${myBoughtShares}"
                data-total-available="${totalAvailableShares}"
                data-crypto="${pkg.crypto}"
            >
            <button id="plus-${pkg.name.replace(/\s+/g, '-')}" onclick="adjustShares('${pkg.name}', 1, this)" class="share-adjuster-btn">+</button>
            <button class="buy-now-btn" style="margin-left: 10px;" onclick='buyPackageFromPage(${JSON.stringify(pkg)})'>Buy</button>
        </div>
    ` : '';

    // For solo packages: separate buy button
    const soloBuyButton = !pkg.isTeam ? `
        <button class="buy-now-btn" ${buyButtonDisabled} style="${buyButtonStyle}" onclick='buyPackageFromPage(${JSON.stringify(pkg)})'>
            Buy
        </button>
    ` : '';

    // Auto-buy robot icon logic - ONLY for team packages (solo packages become active immediately)
    let robotHtml = '';
    if (pkg.isTeam) {
        const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};
        let isAutoBought = null;
        let matchMethod = 'none';

        // Level 1: Direct ID match (pkg.id = order ID)
        isAutoBought = autoBoughtPackages[pkg.id];
        if (isAutoBought) matchMethod = 'direct-id';

        // Level 2: Check orderId/ticketId fields in stored entries
        if (!isAutoBought) {
            isAutoBought = Object.values(autoBoughtPackages).find(entry =>
                entry.orderId === pkg.id || entry.ticketId === pkg.id
            );
            if (isAutoBought) matchMethod = 'orderId-ticketId';
        }

        // Level 3: For team packages - match by package name + recent purchase (within 7 days)
        if (!isAutoBought) {
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            isAutoBought = Object.values(autoBoughtPackages).find(entry =>
                entry.type === 'team' &&
                entry.packageName === pkg.name &&
                entry.timestamp > sevenDaysAgo
            );
            if (isAutoBought) matchMethod = 'name-timestamp';
        }

        // Level 4: Check sharedTicket.id (team packages use shared ticket system)
        if (!isAutoBought && pkg.fullOrderData?.sharedTicket?.id) {
            const sharedTicketId = pkg.fullOrderData.sharedTicket.id;
            isAutoBought = Object.values(autoBoughtPackages).find(entry =>
                entry.ticketId === sharedTicketId
            );
            if (isAutoBought) matchMethod = 'sharedTicket-id';
        }

        // Countdown detection - reuse existing countdown detection logic
        const isCountdown = pkg.lifeTimeTill && (new Date(pkg.lifeTimeTill) - new Date() > 0);

        // Robot icon HTML - only for auto-bought team packages
        if (isAutoBought) {
            if (isCountdown) {
                robotHtml = '<div class="block-found-indicator auto-buy-robot countdown" title="Auto-bought by bot (starting soon)">🤖</div>';
                console.log(`🤖 Robot icon (countdown) added to ${pkg.name} - Match: ${matchMethod}`);
            } else {
                robotHtml = '<div class="block-found-indicator flashing auto-buy-robot" title="Auto-bought by bot">🤖</div>';
                console.log(`🤖 Robot icon (active) added to ${pkg.name} - Match: ${matchMethod}`);
            }
        }
    }

    card.innerHTML = `
        ${robotHtml}
        <h4>${pkg.name}${isRecommended ? ' ⭐' : ''}</h4>
        <div class="buy-package-stats">
            ${probabilityInfo}
            <div class="buy-package-stat">
                <span>Duration:</span>
                <span>${pkg.duration}</span>
            </div>
            ${hashrateInfo}
            ${sharesInfo}
            ${rewardInfo}
            <div class="buy-package-stat">
                <span>Price:</span>
                <span id="price-${packageId}">$${priceAUD} AUD</span>
            </div>
        </div>
        ${teamShareSelector}
        ${soloBuyButton}
    `;

    // Store base values for team packages to enable dynamic updates
    if (pkg.isTeam) {
        if (!window.packageBaseValues) {
            window.packageBaseValues = {};
        }

        // Store total package rewards and calculate shares using addedAmount (total bought)
        // Price: 1 share = 0.0001 BTC - use convertBTCtoAUD for consistency
        const sharePrice = 0.0001;
        const pricePerShareAUD = convertBTCtoAUD(sharePrice);

        // totalBoughtShares and myBoughtShares already calculated above - no need to redeclare

        // Store total block rewards
        const totalRewardAUD = parseFloat(rewardAUD) || 0;
        const totalMainReward = pkg.blockReward || 0;
        const totalMergeReward = pkg.mergeBlockReward || 0;

        console.log(`📊 ${pkg.name} package base values:`, {
            packageId: pkg.id,
            addedAmount: pkg.addedAmount,
            fullAmount: pkg.fullAmount,
            totalBoughtShares: totalBoughtShares,
            myBoughtShares: myBoughtShares,
            totalRewardAUD: totalRewardAUD,
            totalMainReward: totalMainReward,
            totalMergeReward: totalMergeReward,
            pricePerShareAUD: pricePerShareAUD.toFixed(2)
        });

        window.packageBaseValues[pkg.name] = {
            packageId: pkg.id,
            priceAUD: pricePerShareAUD,
            totalRewardAUD: totalRewardAUD,
            totalMainReward: totalMainReward,
            totalMergeReward: totalMergeReward,
            totalBoughtShares: totalBoughtShares,  // Changed from existingShares
            myBoughtShares: myBoughtShares,        // NEW: track user's bought shares
            mainCrypto: pkg.mainCrypto || pkg.crypto,
            mergeCrypto: pkg.mergeCrypto,
            isDualCrypto: pkg.isDualCrypto
        };

        // Initialize share value to 1
        if (!window.packageShareValues) {
            window.packageShareValues = {};
        }
        window.packageShareValues[pkg.name] = 1;
    }

    return card;
}

// Function to adjust shares for team packages
function adjustShares(packageName, delta, buttonElement) {
    console.log(`🎯 adjustShares CALLED: packageName="${packageName}", delta=${delta}`);

    // CRITICAL FIX: Support both ID formats:
    // - Alert format: shares-Package-Name
    // - Buy packages format: team-UUID-shares or cardId-shares
    const normalizedName = packageName.replace(/\s+/g, '-');
    const alertFormatId = `shares-${normalizedName}`;
    const buyPackageFormatId = `${normalizedName}-shares`;

    console.log(`🔍 Looking for input with IDs: "${alertFormatId}" OR "${buyPackageFormatId}"`);

    // CRITICAL FIX: Find input in the same container as the button to avoid conflicts
    // between EasyMining alerts and Buy Packages page (both have same IDs!)
    let input;
    if (buttonElement && typeof buttonElement === 'object') {
        // Find the input in the same parent container as the button
        const container = buttonElement.closest('.share-adjuster, .easymining-alert-card, .buy-package-card');
        if (container) {
            // Try buy package format first (team-UUID-shares)
            input = container.querySelector(`#${buyPackageFormatId}`);
            if (!input) {
                // Fallback to alert format (shares-Package-Name)
                input = container.querySelector(`#${alertFormatId}`);
            }
            console.log(`🔍 Found input via button's container:`, !!input, input?.id);
        }
    }

    // Fallback to getElementById if button element not provided
    if (!input) {
        // Try buy package format first
        input = document.getElementById(buyPackageFormatId);
        if (!input) {
            // Fallback to alert format
            input = document.getElementById(alertFormatId);
        }
        console.log(`🔍 Found input via getElementById:`, !!input, input?.id);
    }

    const plusButtonId = `plus-${packageName.replace(/\s+/g, '-')}`;
    const plusButton = document.getElementById(plusButtonId);

    if (!input) {
        console.error(`❌ Input element NOT FOUND for IDs: "${alertFormatId}" or "${buyPackageFormatId}"`);
        console.log(`📋 All elements with 'shares' in ID:`);
        document.querySelectorAll('[id*="shares"]').forEach(el => {
            console.log(`  - ${el.id}`);
        });
        return;
    }
    console.log(`✅ Input element FOUND! Current value: ${input.value}`);

    const currentValue = parseInt(input.value) || 0;
    const min = parseInt(input.min) || 0;
    const max = parseInt(input.max) || 9999;
    const newValue = Math.max(min, Math.min(max, currentValue + delta)); // Respect min attribute (0 for new shares)

    console.log(`📝 Setting input.value from ${currentValue} to ${newValue}`);
    console.log(`🔍 Input element details:`, {
        id: input.id,
        value: input.value,
        readonly: input.hasAttribute('readonly'),
        disabled: input.disabled,
        parentClass: input.parentElement?.className,
        cardClass: input.closest('.buy-package-card')?.className
    });

    // Temporarily remove readonly to allow value change to be visually reflected
    const wasReadonly = input.hasAttribute('readonly');
    if (wasReadonly) {
        input.removeAttribute('readonly');
        console.log(`🔓 Removed readonly attribute temporarily`);
    }

    // Set value using BOTH methods to force visual update
    input.value = newValue;
    input.setAttribute('value', newValue); // Force attribute update for visual rendering

    console.log(`📝 Verifying: input.value is now ${input.value}`);
    console.log(`👀 Visual check: input.value = "${input.value}", displayed value should be ${newValue}`);

    // Force browser repaint by temporarily hiding/showing
    const originalDisplay = input.style.display;
    input.style.display = 'none';
    input.offsetHeight; // Force reflow
    input.style.display = originalDisplay;

    // Restore readonly attribute AFTER forcing repaint
    if (wasReadonly) {
        input.setAttribute('readonly', true);
        console.log(`🔒 Restored readonly attribute`);
    }

    // Force a visual update by triggering change event
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Immediately save to persistent storage - use separate storage for EasyMining alerts
    const isEasyMiningContext = input.closest('.easymining-section') !== null ||
                                input.closest('#easymining-alerts-container') !== null;

    if (isEasyMiningContext) {
        // Store EasyMining alert shares separately
        if (!window.easyMiningAlertShares) {
            window.easyMiningAlertShares = {};
        }
        window.easyMiningAlertShares[packageName] = newValue;
        console.log(`💾 Saved EasyMining alert ${packageName} = ${newValue}`);
    } else {
        // Store Buy Packages page shares
        if (!window.packageShareValues) {
            window.packageShareValues = {};
        }
        window.packageShareValues[packageName] = newValue;
        console.log(`💾 Saved Buy Package ${packageName} = ${newValue}`);
    }

    // Pause polling for 10 seconds when adjusting shares
    pauseBuyPackagesPolling();

    // CRITICAL: Detect if we're on the buy packages page vs EasyMining alerts
    // MUST check for .buy-package-card FIRST to get the correct container with recommended class
    const container = input.closest('.buy-package-card, .easymining-alert-card') ||
                      input.closest('.share-adjuster') ||
                      document;
    const isBuyPackagePage = container.classList?.contains('buy-package-card');
    const isRecommended = container.classList?.contains('recommended');

    // Check if this is an EasyMining alert (in the easymining-section)
    const isEasyMiningAlert = container.closest('.easymining-section') !== null ||
                              container.closest('#easymining-alerts-container') !== null;

    console.log(`📦 Package detection for "${packageName}":`, {
        containerFound: !!container,
        containerClass: container?.className,
        isBuyPackagePage: isBuyPackagePage,
        isRecommended: isRecommended,
        isEasyMiningAlert: isEasyMiningAlert
    });

    // Update reward value and price based on shares (works for both highlighted and non-highlighted packages)
    const packageId = packageName.replace(/\s+/g, '-');
    const rewardValueElement = container.querySelector(`#reward-value-${packageId}`) || document.getElementById(`reward-value-${packageId}`);
    const priceElement = container.querySelector(`#price-${packageId}`) || document.getElementById(`price-${packageId}`);
    const mainRewardElement = container.querySelector(`#main-reward-${packageId}`) || document.getElementById(`main-reward-${packageId}`);
    const mergeRewardElement = container.querySelector(`#merge-reward-${packageId}`) || document.getElementById(`merge-reward-${packageId}`);

    console.log(`🔍 Element lookup for packageId "${packageId}":`, {
        rewardValueFound: !!rewardValueElement,
        priceFound: !!priceElement,
        mainRewardFound: !!mainRewardElement,
        mergeRewardFound: !!mergeRewardElement,
        priceText: priceElement?.textContent,
        rewardText: rewardValueElement?.textContent
    });

    // Debug: Check if packageBaseValues exists
    console.log(`💾 Package base values check:`, {
        exists: !!(window.packageBaseValues && window.packageBaseValues[packageName]),
        availablePackages: window.packageBaseValues ? Object.keys(window.packageBaseValues) : [],
        packageData: window.packageBaseValues?.[packageName]
    });

    if (window.packageBaseValues && window.packageBaseValues[packageName]) {
        const baseValues = window.packageBaseValues[packageName];

        console.log(`💰 Price calculation for ${packageName}:`, {
            pricePerShareAUD: baseValues.priceAUD,
            numberOfShares: newValue,
            calculatedPrice: baseValues.priceAUD * newValue,
            formattedPrice: (baseValues.priceAUD * newValue).toFixed(2)
        });

        // Price increases linearly with shares (you pay for each share)
        const newPriceAUD = (baseValues.priceAUD * newValue).toFixed(2);

        // CORRECT FORMULA: blockReward ÷ ((totalBought - myBought) + myShares) × myShares
        // totalBoughtShares from API includes MY bought shares, so subtract them first
        const totalBoughtShares = baseValues.totalBoughtShares || 0;
        const myBoughtShares = baseValues.myBoughtShares || 0;
        const myShares = newValue;  // Current input value
        const othersBought = totalBoughtShares - myBoughtShares;  // Others' shares
        const totalShares = othersBought + myShares;  // Total pool after my purchase

        const totalRewardAUD = baseValues.totalRewardAUD || 0;
        const totalMainReward = baseValues.totalMainReward || 0;
        const totalMergeReward = baseValues.totalMergeReward || 0;

        // Divide total reward by correct total shares, then multiply by my shares
        const rewardPerShareAUD = totalShares > 0 ? totalRewardAUD / totalShares : 0;
        const myRewardAUD = (rewardPerShareAUD * myShares).toFixed(2);

        // Update AUD displays
        if (rewardValueElement) {
            const oldReward = rewardValueElement.textContent;
            rewardValueElement.textContent = `$${myRewardAUD} AUD`;
            console.log(`✅ Updated reward value: ${oldReward} → $${myRewardAUD} AUD`);
            // Verify the update actually happened
            console.log(`✔️ Verification - reward element now shows: "${rewardValueElement.textContent}"`);
        } else {
            console.error(`❌ REWARD ELEMENT NOT FOUND for package: ${packageName}`);
        }

        if (priceElement) {
            const oldPrice = priceElement.textContent;
            priceElement.textContent = `$${newPriceAUD} AUD`;
            console.log(`✅ Updated price: ${oldPrice} → $${newPriceAUD} AUD`);
            // Verify the update actually happened
            console.log(`✔️ Verification - price element now shows: "${priceElement.textContent}"`);
        } else {
            console.error(`❌ PRICE ELEMENT NOT FOUND for package: ${packageName}`);
        }

        // Update crypto reward amounts with CORRECT formula
        if (mainRewardElement && totalMainReward) {
            const rewardPerShare = totalShares > 0 ? totalMainReward / totalShares : 0;
            const myMainReward = rewardPerShare * myShares;
            const decimals = baseValues.mainCrypto === 'BTC' || baseValues.mainCrypto === 'BCH' ? 4 : 0;
            mainRewardElement.textContent = `${myMainReward.toFixed(decimals)} ${baseValues.mainCrypto}`;
        }

        if (mergeRewardElement && totalMergeReward && baseValues.isDualCrypto) {
            const rewardPerShare = totalShares > 0 ? totalMergeReward / totalShares : 0;
            const myMergeReward = rewardPerShare * myShares;
            const mergeDecimals = baseValues.mergeCrypto === 'LTC' ? 2 : 0;
            mergeRewardElement.textContent = `${myMergeReward.toFixed(mergeDecimals)} ${baseValues.mergeCrypto}`;
        }

        console.log(`📊 adjustShares Updated ${packageName}:`, {
            totalBoughtShares: totalBoughtShares,
            myBoughtShares: myBoughtShares,
            myShares: myShares,
            othersBought: othersBought,
            totalShares: totalShares,
            rewardPerShareAUD: rewardPerShareAUD.toFixed(2),
            myRewardAUD: myRewardAUD,
            priceAUD: newPriceAUD
        });
    } else {
        // EASYMINING ALERTS: Simple price calculation when packageBaseValues not available
        console.log(`📋 EasyMining alert mode: Using simple price calculation`);

        const sharePrice = 0.0001; // Each share = 0.0001 BTC
        const totalBTC = newValue * sharePrice;
        const priceAUD = convertBTCtoAUD(totalBTC);

        if (priceElement) {
            const oldPrice = priceElement.textContent;
            priceElement.textContent = `$${priceAUD.toFixed(2)} AUD`;
            console.log(`✅ Alert price updated: ${oldPrice} → $${priceAUD.toFixed(2)} AUD`);
        } else {
            console.warn(`⚠️ Price element not found for alert: ${packageName}`);
        }
    }

    // Check balance and update + button and Buy button state for team packages
    const availableBalance = window.niceHashBalance?.available || 0;
    const sharePrice = 0.0001; // Team packages: 0.0001 BTC per share

    // Get myBoughtShares from input data attribute (newValue is TOTAL shares I'll own)
    const myBoughtShares = parseInt(input.dataset?.myBought) || 0;
    const newShares = newValue - myBoughtShares; // NEW shares to buy
    const nextNewShares = (newValue + 1) - myBoughtShares; // NEW shares if I increase by 1

    const currentShareCost = newShares * sharePrice; // Cost for NEW shares
    const nextShareCost = nextNewShares * sharePrice; // Cost if I add 1 more share

    // Update + button state
    if (plusButton) {
        if (availableBalance < nextShareCost) {
            // Disable + button if can't afford next share
            plusButton.disabled = true;
            plusButton.style.opacity = '0.5';
            plusButton.style.cursor = 'not-allowed';
            console.log(`➕ Plus button DISABLED - balance: ${availableBalance}, next share cost: ${nextShareCost}`);
        } else {
            // Enable + button if can afford next share
            plusButton.disabled = false;
            plusButton.style.opacity = '1';
            plusButton.style.cursor = 'pointer';
            console.log(`➕ Plus button ENABLED - balance: ${availableBalance}, next share cost: ${nextShareCost}`);
        }
    }

    // ✅ FIX: Update Buy button state for highlighted team packages (EasyMining alerts)
    // Find Buy button in the same container
    const buyButton = container?.querySelector('.buy-now-btn');
    if (buyButton) {
        // Buy button only disables if balance < 0.0001 (minimum 1 share)
        if (availableBalance < sharePrice) {
            buyButton.disabled = true;
            buyButton.style.opacity = '0.5';
            buyButton.style.cursor = 'not-allowed';
            console.log(`🛒 Buy button DISABLED - balance: ${availableBalance} < ${sharePrice} (min 1 share)`);
        } else {
            buyButton.disabled = false;
            buyButton.style.opacity = '1';
            buyButton.style.cursor = 'pointer';
            console.log(`🛒 Buy button ENABLED - balance: ${availableBalance} >= ${sharePrice}`);
        }
    }
}

// Make adjustShares globally accessible
window.adjustShares = adjustShares;

async function buyTeamPackage(pkg, packageId) {
    console.log('🛒 Purchasing team package:', pkg.name);

    // Get desired total shares from input field
    const inputId = `shares-${pkg.name.replace(/\s+/g, '-')}`;
    const sharesInput = document.getElementById(inputId);
    const desiredTotalShares = sharesInput ? parseInt(sharesInput.value) || 0 : 0;

    if (desiredTotalShares <= 0) {
        alert('Please select number of shares to purchase (use +/- buttons)');
        return;
    }

    // Calculate how many NEW shares to purchase (not total)
    const currentShares = getMyTeamShares(packageId) || 0;
    const sharesToPurchase = desiredTotalShares - currentShares;

    console.log(`📊 Share calculation:`, {
        currentShares: currentShares,
        desiredTotal: desiredTotalShares,
        willPurchase: sharesToPurchase
    });

    if (sharesToPurchase <= 0) {
        alert(`You already own ${currentShares} share(s) in this package.\n\nIncrease the number in the input to buy more shares.`);
        return;
    }

    // Use sharesToPurchase for the actual purchase
    const shares = sharesToPurchase;

    // Standard share price for team packages
    const sharePrice = 0.0001; // 1 share = 0.0001 BTC

    // Calculate total price
    const prices = window.packageCryptoPrices || {};
    let priceAUD = 0;
    if (pkg.priceBTC && prices['btc']?.aud) {
        priceAUD = (pkg.priceBTC * prices['btc'].aud).toFixed(2);
    }

    // Check for saved withdrawal addresses
    const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCurrencyAlgo && pkg.mergeCurrencyAlgo.title);

    let mainWalletAddress = isDualCrypto ? getWithdrawalAddress(pkg.mainCrypto) : getWithdrawalAddress(pkg.crypto);
    let mergeWalletAddress = isDualCrypto ? getWithdrawalAddress(pkg.mergeCrypto) : null;

    const usingSavedMainAddress = !!mainWalletAddress;
    const usingSavedMergeAddress = isDualCrypto ? !!mergeWalletAddress : null;

    // Build confirmation message
    let confirmMessage = `
🛒 Purchase Team Mining Package?

Package: ${pkg.name}
Shares: ${shares}
${isDualCrypto
    ? `Main Crypto: ${pkg.mainCrypto}\nMerge Crypto: ${pkg.mergeCrypto}`
    : `Crypto: ${pkg.crypto}`}
Probability: ${pkg.probability}
Duration: ${pkg.duration}
Price: $${priceAUD} AUD (${pkg.priceBTC} BTC)
Participants: ${pkg.numberOfParticipants || 0}

${usingSavedMainAddress
    ? `✅ Using saved ${isDualCrypto ? pkg.mainCrypto : pkg.crypto} wallet address:\n${mainWalletAddress.substring(0, 20)}...${mainWalletAddress.substring(mainWalletAddress.length - 10)}`
    : `⚠️ No saved ${isDualCrypto ? pkg.mainCrypto : pkg.crypto} wallet address - you will be prompted`}

${isDualCrypto
    ? (usingSavedMergeAddress
        ? `✅ Using saved ${pkg.mergeCrypto} wallet address:\n${mergeWalletAddress.substring(0, 20)}...${mergeWalletAddress.substring(mergeWalletAddress.length - 10)}`
        : `⚠️ No saved ${pkg.mergeCrypto} wallet address - you will be prompted`)
    : ''}

This will create a team order on NiceHash.
Do you want to continue?
    `.trim();

    if (!confirm(confirmMessage)) {
        return;
    }

    // Prompt for missing wallet addresses
    if (!usingSavedMainAddress) {
        const cryptoName = isDualCrypto ? pkg.mainCrypto : pkg.crypto;
        mainWalletAddress = prompt(
            `Enter your ${cryptoName} wallet address to receive mining rewards:\n\n` +
            `(This is where block rewards will be sent if you find a block)\n\n` +
            `Tip: You can save addresses in EasyMining Settings → Manage Withdrawal Addresses`
        );

        if (!mainWalletAddress || mainWalletAddress.trim() === '') {
            alert(`${cryptoName} wallet address is required to purchase a team mining package.`);
            return;
        }

        mainWalletAddress = mainWalletAddress.trim();
    }

    if (isDualCrypto && !usingSavedMergeAddress) {
        mergeWalletAddress = prompt(
            `Enter your ${pkg.mergeCrypto} wallet address to receive mining rewards:\n\n` +
            `(This is where ${pkg.mergeCrypto} block rewards will be sent)\n\n` +
            `Tip: You can save addresses in EasyMining Settings → Manage Withdrawal Addresses`
        );

        if (!mergeWalletAddress || mergeWalletAddress.trim() === '') {
            alert(`${pkg.mergeCrypto} wallet address is required for this dual-crypto package.`);
            return;
        }

        mergeWalletAddress = mergeWalletAddress.trim();
    }

    try {
        // Sync time with NiceHash server before purchase
        console.log('⏰ Syncing time with NiceHash server...');
        await syncNiceHashTime();

        // Determine which crypto(s) for logging
        const mainCryptoSymbol = isDualCrypto ? pkg.mainCrypto : pkg.crypto;
        const mergeCryptoSymbol = isDualCrypto ? pkg.mergeCrypto : null;

        console.log('🛒 Creating NiceHash team order:', {
            packageId: packageId,
            packageName: pkg.name,
            shares: shares,
            isDualCrypto: isDualCrypto,
            mainCrypto: mainCryptoSymbol,
            mergeCrypto: mergeCryptoSymbol,
            mainWallet: mainWalletAddress,
            mergeWallet: mergeWalletAddress
        });

        // Create order payload for team mining package
        // Calculate total amount (shares × 0.0001 BTC per share)
        const totalAmount = shares * sharePrice;

        // ✅ FIX: Use same POST structure as buy packages page (buyTeamPackageUpdated)
        // Include shares object breakdown for NiceHash API
        const orderData = {
            amount: totalAmount,
            shares: {
                small: shares,
                medium: 0,
                large: 0,
                couponSmall: 0,
                couponMedium: 0,
                couponLarge: 0,
                massBuy: 0
            },
            soloMiningRewardAddr: mainWalletAddress.trim() // Main crypto address
        };

        // Add merge address for dual-crypto packages (Palladium DOGE)
        if (isDualCrypto && mergeWalletAddress) {
            orderData.mergeSoloMiningRewardAddr = mergeWalletAddress.trim();
        }

        console.log('📦 Team package purchase:', {
            endpoint: `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`,
            method: 'POST',
            totalShares: shares,
            totalAmount: totalAmount + ' BTC',
            sharePrice: sharePrice + ' BTC per share',
            soloMiningRewardAddr: orderData.soloMiningRewardAddr.substring(0, 10) + '...',
            mergeSoloMiningRewardAddr: orderData.mergeSoloMiningRewardAddr || '(not set)',
            isDualCrypto: isDualCrypto,
            packageId: packageId
        });

        // Log the actual JSON that will be sent
        console.log('📄 Request body:', JSON.stringify(orderData, null, 2));

        // Single POST request with total amount
        // Endpoint: POST /hashpower/api/v2/hashpower/shared/ticket/{id}
        const endpoint = `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`;

        console.log(`📡 Purchasing ${shares} share(s) with single POST request...`);

        // Generate auth headers
        const body = JSON.stringify(orderData);
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel serverless function as proxy
            console.log('✅ Using Vercel proxy');

            const proxyPayload = {
                endpoint: endpoint,
                method: 'POST',
                headers: headers,
                body: orderData
            };

            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(proxyPayload)
            });
        } else {
            // Direct call to NiceHash
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });
        }

        console.log(`📡 Response status:`, response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Purchase failed:`, errorText);

            let errorMessage = `API Error: ${response.status}`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.message || errorData.error_message || errorData.error || errorData.details || errorMessage;
            } catch (e) {
                errorMessage = errorText || errorMessage;
            }

            throw new Error(`Failed to purchase ${shares} share(s): ${errorMessage}`);
        }

        const result = await response.json();
        console.log(`✅ Purchase successful:`, result);

        // Save the new total shares (input value = desired total)
        saveMyTeamShares(packageId, desiredTotalShares);
        console.log(`💾 Saved team shares for package ${packageId}: ${desiredTotalShares} shares (was ${currentShares}, purchased ${shares})`);

        // Build success message
        let successMessage = `✅ Team package "${pkg.name}" purchase complete!\n\n`;
        successMessage += `✅ Purchased: ${shares} ${shares === 1 ? 'share' : 'shares'}\n`;
        successMessage += `📊 Your total shares: ${desiredTotalShares}\n`;
        successMessage += `💰 Amount paid: ${totalAmount} BTC\n`;
        successMessage += `\n${isDualCrypto ? `${pkg.mainCrypto} Wallet: ${mainWalletAddress.substring(0, 20)}...${mainWalletAddress.substring(mainWalletAddress.length - 10)}\n${pkg.mergeCrypto} Wallet: ${mergeWalletAddress.substring(0, 20)}...${mergeWalletAddress.substring(mergeWalletAddress.length - 10)}` : `Wallet: ${mainWalletAddress.substring(0, 20)}...${mainWalletAddress.substring(mainWalletAddress.length - 10)}`}`;

        if (!usingSavedMainAddress || (isDualCrypto && !usingSavedMergeAddress)) {
            successMessage += '\n\n💡 Tip: Save these addresses in EasyMining Settings → Manage Withdrawal Addresses for faster purchases!';
        }

        alert(successMessage);

        // Update stats based on successful purchase
        const sharesPurchased = shares;
        const totalPricePaid = sharesPurchased * sharePrice; // sharePrice is per share in BTC
        const btcPrice = window.packageCryptoPrices?.['btc']?.aud || 140000;
        const totalPriceAUD = totalPricePaid * btcPrice;

        easyMiningData.allTimeStats.totalSpent += totalPriceAUD;
        easyMiningData.todayStats.totalSpent += totalPriceAUD;

        // Calculate P&L
        easyMiningData.allTimeStats.pnl = easyMiningData.allTimeStats.totalReward - easyMiningData.allTimeStats.totalSpent;
        easyMiningData.todayStats.pnl = easyMiningData.todayStats.pnl - totalPriceAUD;

        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh package data immediately to show the new order
        await fetchEasyMiningData();

        // Go back to app page
        showAppPage();

    } catch (error) {
        console.error('❌ Error purchasing team package:', error);
        alert(`Failed to purchase team package: ${error.message}\n\nPlease check:\n- Your API credentials are correct\n- You have sufficient BTC balance\n- The wallet addresses are valid`);
    }
}

// Auto-clear team shares for packages that no longer meet alert thresholds
async function autoClearTeamShares(packageId, packageName) {
    console.log(`🤖 Auto-clearing shares for package: ${packageName} (ID: ${packageId})`);

    try {
        // Sync time with NiceHash server
        await syncNiceHashTime();

        // Create clear request payload
        const clearData = {
            clear: true
        };

        const endpoint = `/hashpower/api/v2/hashpower/shared/ticket/${packageId}`;

        console.log('📦 Auto-clear team package:', {
            endpoint: endpoint,
            method: 'POST',
            packageId: packageId,
            packageName: packageName
        });

        // Generate auth headers
        const body = JSON.stringify(clearData);
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel serverless function as proxy
            console.log('✅ Using Vercel proxy for auto-clear');

            const proxyPayload = {
                endpoint: endpoint,
                method: 'POST',
                headers: headers,
                body: clearData
            };

            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(proxyPayload)
            });
        } else {
            // Direct call to NiceHash
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ Auto-clear successful:', result);

        // Clear shares from stored data
        const storageKey = `${loggedInUser}_teamShares_${packageId}`;
        localStorage.removeItem(storageKey);
        console.log(`🗑️ Removed stored shares for package ${packageId}`);

        // Update UI - reset input value and share distribution display
        const inputId = `shares-${packageName.replace(/\s+/g, '-')}`;
        const sharesInput = document.getElementById(inputId);
        if (sharesInput) {
            sharesInput.value = '';
            console.log(`✅ Reset input value for ${packageName}`);
        }

        // Refresh package data to update UI
        await fetchEasyMiningData();

        console.log(`✅ Auto-cleared shares for ${packageName}`);

    } catch (error) {
        console.error('❌ Error auto-clearing team shares:', error);
        // Don't show alert for auto-clear errors (silent failure)
    }
}

// Manual clear shares function with confirmation
async function clearTeamSharesManual(packageId, packageName) {
    // Check if user has shares to clear
    const myBoughtShares = getMyTeamShares(packageId);

    if (myBoughtShares === 0) {
        alert('You have no shares to clear for this package.');
        return;
    }

    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to clear all ${myBoughtShares} shares from ${packageName}?\n\nThis action cannot be undone.`);

    if (!confirmed) {
        console.log('❌ User cancelled clear shares');
        return;
    }

    console.log(`🗑️ Manually clearing ${myBoughtShares} shares for ${packageName}`);

    try {
        // Call the same auto-clear function
        await autoClearTeamShares(packageId, packageName);

        // Clear auto-buy tracking to remove robot icon
        const autoBoughtPackages = JSON.parse(localStorage.getItem(`${loggedInUser}_autoBoughtPackages`)) || {};
        let removedEntries = 0;

        // Remove all matching entries for this package
        Object.keys(autoBoughtPackages).forEach(key => {
            const entry = autoBoughtPackages[key];

            // Match by direct ID
            if (key === packageId) {
                delete autoBoughtPackages[key];
                removedEntries++;
                console.log(`🗑️ Removed auto-buy entry (direct ID): ${key}`);
            }
            // Match by orderId or ticketId
            else if (entry.orderId === packageId || entry.ticketId === packageId) {
                delete autoBoughtPackages[key];
                removedEntries++;
                console.log(`🗑️ Removed auto-buy entry (orderId/ticketId match): ${key}`);
            }
            // Match by package name for team packages (within 7 days)
            else if (entry.type === 'team' && entry.packageName === packageName) {
                delete autoBoughtPackages[key];
                removedEntries++;
                console.log(`🗑️ Removed auto-buy entry (name match): ${key}`);
            }
        });

        // Save updated auto-buy tracking
        if (removedEntries > 0) {
            localStorage.setItem(`${loggedInUser}_autoBoughtPackages`, JSON.stringify(autoBoughtPackages));
            console.log(`✅ Removed ${removedEntries} auto-buy tracking entries for ${packageName}`);
        } else {
            console.log(`ℹ️ No auto-buy tracking entries found for ${packageName}`);
        }

        // Show success message
        alert(`Successfully cleared ${myBoughtShares} shares from ${packageName}!`);

        console.log(`✅ Manual clear successful for ${packageName}`);
    } catch (error) {
        console.error('❌ Error manually clearing shares:', error);
        alert(`Failed to clear shares: ${error.message}`);
    }
}

async function buyPackageFromPage(pkg) {
    // Check if EasyMining API is configured
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        alert('Please configure EasyMining API settings first!');
        showEasyMiningSettingsPage();
        return;
    }

    // Get package ID from API data
    const packageId = pkg.apiData?.id || pkg.id;
    if (!packageId) {
        alert('Error: Package ID not found. Cannot create order.');
        console.error('Missing package ID:', pkg);
        return;
    }

    // Handle team packages differently
    if (pkg.isTeam) {
        return buyTeamPackage(pkg, packageId);
    }

    // Solo package logic (existing code)
    // Calculate price in AUD for confirmation
    const prices = window.packageCryptoPrices || {};
    let priceAUD = 0;
    if (pkg.priceBTC && prices['btc']?.aud) {
        priceAUD = (pkg.priceBTC * prices['btc'].aud).toFixed(2);
    }

    // Check for dual-crypto packages (Palladium DOGE+LTC)
    const isDualCrypto = pkg.isDualCrypto || (pkg.mergeCrypto && pkg.mainCrypto);

    let mainWalletAddress = isDualCrypto ? getWithdrawalAddress(pkg.mainCrypto) : getWithdrawalAddress(pkg.crypto);
    let mergeWalletAddress = isDualCrypto ? getWithdrawalAddress(pkg.mergeCrypto) : null;

    const usingSavedMainAddress = !!mainWalletAddress;
    const usingSavedMergeAddress = isDualCrypto ? !!mergeWalletAddress : null;

    // Show confirmation dialog with package details
    const confirmMessage = `
🛒 Purchase Solo Mining Package?

Package: ${pkg.name}
${isDualCrypto
    ? `Main Crypto: ${pkg.mainCrypto}\nMerge Crypto: ${pkg.mergeCrypto}`
    : `Crypto: ${pkg.crypto}`}
Probability: ${pkg.probability}
Duration: ${pkg.duration}
Price: $${priceAUD} AUD (${pkg.priceBTC} BTC)

${usingSavedMainAddress
    ? `✅ Using saved ${isDualCrypto ? pkg.mainCrypto : pkg.crypto} wallet address:\n${mainWalletAddress.substring(0, 20)}...${mainWalletAddress.substring(mainWalletAddress.length - 10)}`
    : `⚠️ No saved ${isDualCrypto ? pkg.mainCrypto : pkg.crypto} wallet address - you will be prompted`}

${isDualCrypto
    ? (usingSavedMergeAddress
        ? `✅ Using saved ${pkg.mergeCrypto} wallet address:\n${mergeWalletAddress.substring(0, 20)}...${mergeWalletAddress.substring(mergeWalletAddress.length - 10)}`
        : `⚠️ No saved ${pkg.mergeCrypto} wallet address - you will be prompted`)
    : ''}

This will create an order on NiceHash.
Do you want to continue?
    `.trim();

    if (!confirm(confirmMessage)) {
        return;
    }

    // Prompt for missing wallet addresses
    if (!usingSavedMainAddress) {
        const cryptoName = isDualCrypto ? pkg.mainCrypto : pkg.crypto;
        mainWalletAddress = prompt(
            `Enter your ${cryptoName} wallet address to receive mining rewards:\n\n` +
            `(This is where block rewards will be sent if you find a block)\n\n` +
            `Tip: You can save addresses in EasyMining Settings → Manage Withdrawal Addresses`
        );

        if (!mainWalletAddress || mainWalletAddress.trim() === '') {
            alert(`${cryptoName} wallet address is required to purchase a solo mining package.`);
            return;
        }

        mainWalletAddress = mainWalletAddress.trim();
    }

    if (isDualCrypto && !usingSavedMergeAddress) {
        mergeWalletAddress = prompt(
            `Enter your ${pkg.mergeCrypto} wallet address to receive mining rewards:\n\n` +
            `(This is where ${pkg.mergeCrypto} block rewards will be sent)\n\n` +
            `Tip: You can save addresses in EasyMining Settings → Manage Withdrawal Addresses`
        );

        if (!mergeWalletAddress || mergeWalletAddress.trim() === '') {
            alert(`${pkg.mergeCrypto} wallet address is required for this dual-crypto package.`);
            return;
        }

        mergeWalletAddress = mergeWalletAddress.trim();
    }

    try {
        const mainCryptoSymbol = isDualCrypto ? pkg.mainCrypto : pkg.crypto;
        const mergeCryptoSymbol = isDualCrypto ? pkg.mergeCrypto : null;

        console.log('🛒 Creating NiceHash solo order:', {
            packageId: packageId,
            packageName: pkg.name,
            isDualCrypto: isDualCrypto,
            mainCrypto: mainCryptoSymbol,
            mergeCrypto: mergeCryptoSymbol,
            mainWalletAddress: mainWalletAddress,
            mergeWalletAddress: mergeWalletAddress,
            usingSavedMainAddress: usingSavedMainAddress,
            usingSavedMergeAddress: usingSavedMergeAddress
        });

        // Create order payload for solo mining package
        // For regular packages: only soloMiningRewardAddr
        // For Palladium: soloMiningRewardAddr = LTC address, mergeSoloMiningRewardAddr = DOGE address
        const orderData = {
            ticketId: packageId,
            soloMiningRewardAddr: mainWalletAddress.trim()
        };

        // Add merge address for dual-crypto packages
        if (isDualCrypto && mergeWalletAddress) {
            orderData.mergeSoloMiningRewardAddr = mergeWalletAddress.trim();
        }

        console.log('📦 Solo order payload:', {
            ticketId: orderData.ticketId,
            soloMiningRewardAddr: orderData.soloMiningRewardAddr.substring(0, 10) + '...',
            mergeSoloMiningRewardAddr: orderData.mergeSoloMiningRewardAddr ? orderData.mergeSoloMiningRewardAddr.substring(0, 10) + '...' : '(not set)'
        });

        // Call NiceHash API to create solo order
        const endpoint = '/main/api/v2/hashpower/solo/order';
        const body = JSON.stringify(orderData);
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        let response;

        if (USE_VERCEL_PROXY) {
            // Use Vercel serverless function as proxy
            console.log('✅ Using Vercel proxy to create solo order');
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    endpoint: endpoint,
                    method: 'POST',
                    headers: headers,
                    body: orderData
                })
            });
        } else {
            // Direct call to NiceHash
            console.log('📡 Direct call to NiceHash API');
            response = await fetch(`https://api2.nicehash.com${endpoint}`, {
                method: 'POST',
                headers: headers,
                body: body
            });
        }

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error Response:', errorText);
            let errorMessage = `API Error: ${response.status}`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.message || errorData.error_message || errorMessage;
            } catch (e) {
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();
        console.log('✅ Solo order created successfully:', result);

        const successMessage = `✅ Package "${pkg.name}" purchased successfully!\n\nOrder ID: ${result.id || 'N/A'}\n${isDualCrypto ? `${pkg.mainCrypto} Wallet: ${mainWalletAddress.substring(0, 20)}...${mainWalletAddress.substring(mainWalletAddress.length - 10)}\n${pkg.mergeCrypto} Wallet: ${mergeWalletAddress.substring(0, 20)}...${mergeWalletAddress.substring(mergeWalletAddress.length - 10)}` : `Crypto: ${pkg.crypto}\nWallet: ${mainWalletAddress.substring(0, 20)}...${mainWalletAddress.substring(mainWalletAddress.length - 10)}`}${!usingSavedMainAddress || (isDualCrypto && !usingSavedMergeAddress) ? '\n\n💡 Tip: Save these addresses in EasyMining Settings → Manage Withdrawal Addresses for faster purchases!' : ''}`;

        alert(successMessage);

        // Update stats
        const pricePaid = parseFloat(priceAUD) || 0;
        easyMiningData.allTimeStats.totalSpent += pricePaid;
        easyMiningData.todayStats.totalSpent += pricePaid;

        // Calculate P&L
        easyMiningData.allTimeStats.pnl = easyMiningData.allTimeStats.totalReward - easyMiningData.allTimeStats.totalSpent;
        easyMiningData.todayStats.pnl = easyMiningData.todayStats.pnl - pricePaid;

        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh package data immediately to show the new order
        await fetchEasyMiningData();

        // Go back to app page
        showAppPage();

    } catch (error) {
        console.error('❌ Error purchasing package:', error);
        alert(`Failed to purchase package: ${error.message}\n\nPlease check:\n- Your API credentials are correct\n- You have sufficient BTC balance\n- The wallet address is valid for ${pkg.crypto}`);
    }
}

// =============================================================================
// EASYMINING POLLING
// =============================================================================

let lastEasyMiningPollTime = 0;
let pollingWatchdogInterval = null;
let visibilityChangeListenerAdded = false;

function startEasyMiningPolling() {
    // Stop any existing polling
    stopEasyMiningPolling();

    // Initial fetch
    fetchEasyMiningData();
    lastEasyMiningPollTime = Date.now();

    // Poll every 5 seconds (NiceHash rate limit: 300 calls/min, we use ~48 calls/min)
    easyMiningPollingInterval = setInterval(() => {
        fetchEasyMiningData();
        lastEasyMiningPollTime = Date.now();
    }, 5000);

    // Start watchdog to ensure polling stays alive
    startPollingWatchdog();

    console.log('✅ EasyMining polling started with watchdog');
}

function stopEasyMiningPolling() {
    if (easyMiningPollingInterval) {
        clearInterval(easyMiningPollingInterval);
        easyMiningPollingInterval = null;
    }

    // Stop watchdog
    if (pollingWatchdogInterval) {
        clearInterval(pollingWatchdogInterval);
        pollingWatchdogInterval = null;
    }
}

// =============================================================================
// BUY PACKAGES POLLING
// =============================================================================

function startBuyPackagesPolling() {
    console.log('🔄 Starting buy packages polling...');

    // Stop any existing polling
    stopBuyPackagesPolling();

    // Initial load
    loadBuyPackagesDataOnPage();

    // Poll every 5 seconds
    buyPackagesPollingInterval = setInterval(() => {
        if (!buyPackagesPollingPaused) {
            console.log('🔄 Refreshing buy packages data...');
            loadBuyPackagesDataOnPage();
        } else {
            console.log('⏸️ Polling paused - skipping refresh');
        }
    }, 5000);

    console.log('✅ Buy packages polling started (5s interval)');
}

function stopBuyPackagesPolling() {
    if (buyPackagesPollingInterval) {
        clearInterval(buyPackagesPollingInterval);
        buyPackagesPollingInterval = null;
        console.log('⏹️ Buy packages polling stopped');
    }
}

function pauseBuyPackagesPolling() {
    // Clear any existing pause timer
    if (buyPackagesPauseTimer) {
        clearTimeout(buyPackagesPauseTimer);
    }

    // Set paused flag
    buyPackagesPollingPaused = true;
    console.log('⏸️ Pausing buy packages polling for 10 seconds...');

    // Resume after 10 seconds
    buyPackagesPauseTimer = setTimeout(() => {
        buyPackagesPollingPaused = false;
        buyPackagesPauseTimer = null;
        console.log('▶️ Resuming buy packages polling');
    }, 10000);
}

// =============================================================================
// EASYMINING ALERTS POLLING (Solo/Team Alerts in Main Section)
// =============================================================================

function startEasyMiningAlertsPolling() {
    console.log('🔄 Starting EasyMining alerts polling...');

    // Stop any existing polling
    stopEasyMiningAlertsPolling();

    // Initial load
    updateRecommendations();

    // Poll every 5 seconds
    easyMiningAlertsPollingInterval = setInterval(() => {
        console.log('🔄 Refreshing EasyMining alerts...');
        updateRecommendations();
    }, 5000);

    console.log('✅ EasyMining alerts polling started (5s interval)');
}

function stopEasyMiningAlertsPolling() {
    if (easyMiningAlertsPollingInterval) {
        clearInterval(easyMiningAlertsPollingInterval);
        easyMiningAlertsPollingInterval = null;
        console.log('⏹️ EasyMining alerts polling stopped');
    }
}

// =============================================================================
// EASYMINING POLLING WATCHDOG
// =============================================================================

// Watchdog to detect and restart polling if it stops
function startPollingWatchdog() {
    // Stop existing watchdog
    if (pollingWatchdogInterval) {
        clearInterval(pollingWatchdogInterval);
    }

    // Check every 30 seconds if polling is still running
    pollingWatchdogInterval = setInterval(() => {
        const timeSinceLastPoll = Date.now() - lastEasyMiningPollTime;

        // If more than 15 seconds since last poll, restart
        if (timeSinceLastPoll > 15000 && easyMiningSettings.enabled) {
            console.warn(`⚠️ Polling watchdog detected stalled polling (${Math.round(timeSinceLastPoll / 1000)}s since last poll)`);
            console.log('🔄 Restarting EasyMining polling...');
            startEasyMiningPolling();
        }
    }, 30000);

    console.log('🐕 Polling watchdog started (checks every 30s)');
}

// Resume polling when page becomes visible (after being hidden/minimized)
// Add listener only once to prevent duplicates
if (!visibilityChangeListenerAdded) {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && easyMiningSettings.enabled && easyMiningPollingInterval) {
            const timeSinceLastPoll = Date.now() - lastEasyMiningPollTime;

            // If more than 10 seconds since last poll, fetch immediately
            if (timeSinceLastPoll > 10000) {
                console.log(`👁️ Page visible again - fetching fresh data...`);
                fetchEasyMiningData();
                lastEasyMiningPollTime = Date.now();
            }
        }
    });
    visibilityChangeListenerAdded = true;
}

// =============================================================================
// INITIALIZE EASYMINING ON APP LOAD
// =============================================================================

function initializeEasyMining() {
    // Load saved settings
    const savedSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`));
    if (savedSettings) {
        easyMiningSettings = savedSettings;
    }

    // Load saved data
    const savedData = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningData`));
    if (savedData) {
        // ✅ FIX: Don't load availableBTC and pendingBTC from localStorage
        // These should only come from fresh API data to prevent showing incorrect amounts on page load
        // Old stored balance values would be added to manual holdings before fresh data loads
        const { availableBTC, pendingBTC, ...dataToLoad } = savedData;
        easyMiningData = { ...easyMiningData, ...dataToLoad };
        console.log(`📦 EasyMining data loaded from localStorage:`, {
            availableBTC: easyMiningData.availableBTC, // Will be 0 (from initial state)
            pendingBTC: easyMiningData.pendingBTC, // Will be 0 (from initial state)
            packages: easyMiningData.activePackages?.length || 0
        });
        console.log(`   ℹ️ Note: availableBTC and pendingBTC NOT loaded from storage (will fetch fresh)`);
    }

    // CRITICAL: Update Bitcoin holdings to include NiceHash balance
    // This ensures manual + NiceHash is displayed and AUD is calculated correctly
    if (typeof updateBTCHoldings === 'function') {
        console.log(`🔄 Calling updateBTCHoldings() to recalculate BTC total (manual + NiceHash)`);
        updateBTCHoldings();
    }

    // Restore rocket display from saved data
    restoreRockets();

    // ✅ FIX: Only show section if EasyMining is enabled (hide by default until activated)
    const section = document.getElementById('easymining-section');
    if (section) {
        if (easyMiningSettings.enabled) {
            // Hide section initially - it will be shown after loading bar completes
            section.style.display = 'none';
            // Start polling if EasyMining is enabled (section will be shown after loading bar completes)
            startEasyMiningPolling();
            // Start missed rewards check (checks on load and every 30 seconds)
            startMissedRewardsCheck();
            console.log('✅ EasyMining enabled - starting polling and missed rewards check (section will appear after loading)');
        } else {
            // Hide section if not enabled
            section.style.display = 'none';
            console.log('🔒 EasyMining section hidden (not enabled)');
        }
    }
}

// =============================================================================
// UPDATE EXISTING FUNCTIONS
// =============================================================================

// Modify initializeApp to include EasyMining initialization
const originalInitializeApp = initializeApp;
if (typeof originalInitializeApp === 'function') {
    initializeApp = function() {
        originalInitializeApp();
        
        if (loggedInUser) {
            initializeEasyMining();
        }
    };
}
 

// =============================================================================
// CLEANUP ON PAGE UNLOAD
// =============================================================================

// Cleanup function to prevent memory leaks
function cleanupResources() {
    // Stop all polling intervals
    if (mexcPricePollingInterval) {
        clearInterval(mexcPricePollingInterval);
        mexcPricePollingInterval = null;
    }

    if (autoResetInterval) {
        clearInterval(autoResetInterval);
        autoResetInterval = null;
    }

    if (conversionRateInterval) {
        clearInterval(conversionRateInterval);
        conversionRateInterval = null;
    }

    // Stop EasyMining polling
    stopEasyMiningPolling();
    stopBuyPackagesPolling();
    stopEasyMiningAlertsPolling();

    // Stop missed rewards check
    stopMissedRewardsCheck();

    // Clear modal intervals
    if (modalLivePriceInterval) {
        clearInterval(modalLivePriceInterval);
        modalLivePriceInterval = null;
    }

    if (loadingProgressInterval) {
        clearInterval(loadingProgressInterval);
        loadingProgressInterval = null;
    }

    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    // Close WebSocket connections
    if (socket && socket.readyState === WebSocket.OPEN) {
        intentionalClose = true;
        socket.close();
    }

    // Close modal WebSocket if open
    if (currentWebSocket && currentWebSocket.readyState === WebSocket.OPEN) {
        currentWebSocket.close();
        currentWebSocket = null;
    }

    // Clear ping interval
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }

    // Clear crypto info interval
    if (cryptoInfoInterval) {
        clearInterval(cryptoInfoInterval);
        cryptoInfoInterval = null;
    }
}

// Add cleanup on page unload/close
window.addEventListener('beforeunload', cleanupResources);

// Initialize the app
initializeApp();
