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

        blockFoundSound.muted = !isEasyMiningAudioEnabled;
        noBlocksFoundSound.muted = !isEasyMiningAudioEnabled;
        blockFoundCompleteSound.muted = !isEasyMiningAudioEnabled;
        packageStartSound.muted = !isEasyMiningAudioEnabled;

        easyMiningAudioToggle.addEventListener('change', function () {
            if (this.checked) {
                blockFoundSound.muted = false;
                noBlocksFoundSound.muted = false;
                blockFoundCompleteSound.muted = false;
                packageStartSound.muted = false;
            } else {
                blockFoundSound.muted = true;
                noBlocksFoundSound.muted = true;
                blockFoundCompleteSound.muted = true;
                packageStartSound.muted = true;
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
}

function showRegisterPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'block';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
}

function showAppPage() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'block';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('coingecko-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';
}

function showEasyMiningSettingsPage() {
    console.log('Showing EasyMining Settings Page');

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';

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
}

function showBuyPackagesPage() {
    console.log('Showing Buy Packages Page');

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';

    // Show Buy Packages page
    document.getElementById('buy-packages-page').style.display = 'block';

    // Load packages data
    loadBuyPackagesDataOnPage();
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
    const resetHour = 6; // Set to 6 AM
    const resetMinute = 0; // Set to 00 minutes

    const now = new Date();
    const lastResetDate = getStorageItem(`${loggedInUser}_lastPercentageResetDate`);
    const todayDate = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    try {
        // Check if it's time to reset
        if (now.getHours() === resetHour && now.getMinutes() === resetMinute) {
            if (lastResetDate !== todayDate) {
                console.log("Resetting percentage at 06:00 AM");
                setStorageItem(`${loggedInUser}_lastPercentageResetDate`, todayDate);
                await resetPercentageDaily(); // Call the existing resetPercentage function
            }
        }

        // Check if the reset was missed and the app was opened after the reset time
        if (now.getHours() > resetHour && now.getMinutes() > resetMinute) {
            if (lastResetDate !== todayDate) {
                console.log("Resetting missed auto percentage reset");
                setStorageItem(`${loggedInUser}_lastPercentageResetDate`, todayDate);
                await resetPercentageDaily(); // Call the existing resetPercentage function
            }
        }
    } catch (error) {
        console.error("Error during auto reset percentage:", error);
    }

    console.log("Checking for 24hr Auto Reset Percentage");
}

// Call autoResetPercentage on app load to handle missed resets with a 3-second delay
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        autoResetPercentage();
    }, 1000);
});


// Set an interval to check every minute (only once)
if (!autoResetInterval) {
    autoResetInterval = setInterval(autoResetPercentage, 60000);
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
    const easyMiningSettingsModal = document.getElementById('easymining-settings-modal');
    
    if (event.target === popupModal || event.target === totalHoldingsModal || event.target === settingsModal || event.target === candlestickModal) {
        closeModal();
    }
    
    // Close EasyMining settings modal when clicking outside
    if (event.target === easyMiningSettingsModal) {
        closeEasyMiningSettingsModal();
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
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

                        // Update the live price and holdings amounts in the chart modal with flash and color change
                        const livePriceElement = document.getElementById('live-price');
                        livePriceElement.innerHTML = `
                            <span style="color: white; font-weight: normal;"></span>
                            <b id="live-price-amount" style="color: ${isPriceUp ? '#00FF00' : 'red'};">$${priceInAud.toFixed(8)}</b> 
                            <span style="color: white; font-weight: normal;">AUD</span>
                            (<b id="live-price-usd" style="color: ${isPriceUp ? '#00FF00' : 'red'};">$${priceInUsd.toFixed(8)}</b> <span style="color: white; font-weight: normal;">USD</span>)
                        `;

                        // Flash live price amounts only, not the holdings value in the chart modal
                        flashColor('live-price-amount', flashClass);
                        flashColor('live-price-usd', flashClass);
                        document.getElementById('holdings-value').style.color = isPriceUp ? '#00FF00' : 'red'; // Keep color after the flash for holdings value
                    }

                    updateTotalHoldings(); // Update total holdings on the main page
                    sortContainersByValue(); // Sort based on updated value

                    // Update candlestick chart with the new live price
                    if (currentCryptoId === coingeckoId) {
                        updateCandlestickChart(priceInAud); // Also update live price text
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





// Function to update the candlestick chart with live USD price and convert it to AUD
function updatePriceInChart(priceInUsd) {
    const conversionRate = 1.52; // Example conversion rate from USD to AUD
    const priceInAud = priceInUsd * conversionRate;

    if (candlestickChart) {
        const now = new Date();
        const lastCandle = candlestickChart.data.datasets[0].data[candlestickChart.data.datasets[0].data.length - 1];

        if (lastCandle && now - new Date(lastCandle.x) < 5 * 60 * 1000) {
            lastCandle.c = priceInAud;
            if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
            if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
            console.log(`Updated existing candle at ${lastCandle.x} with price: AUD $${priceInAud}`);
        } else {
            candlestickChart.data.datasets[0].data.push({
                x: now,
                o: priceInAud,
                h: priceInAud,
                l: priceInAud,
                c: priceInAud
            });
            console.log(`Created new candle at ${now} with price: AUD $${priceInAud}`);
        }

        // Update the chart
        candlestickChart.update();

        // Update live price in the modal header (show both AUD and USD)
        const livePriceElement = document.getElementById('live-price');
        if (livePriceElement) {
            livePriceElement.innerHTML = `<span style="font-weight: normal;"></span><b>$${priceInAud.toFixed(8)}</b> <span style="font-weight: normal;">AUD</span> (<b>$${priceInUsd.toFixed(8)}</b> <span style="font-weight: normal;">USD</span>)`;
            // Update live price
        }
    }
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






// Function to update the candlestick chart with live price data in AUD and USD
function updateCandlestickChart(priceInAud, priceInUsd) {
    if (!candlestickChart || !candlestickChart.data || !candlestickChart.data.datasets || candlestickChart.data.datasets.length === 0) {
        console.error('Candlestick chart not initialized or data is missing.');
        return;
    }

    const now = new Date();
    const lastCandle = candlestickChart.data.datasets[0].data[candlestickChart.data.datasets[0].data.length - 1];

    // Check if the current time is within the same 5-minute interval
    if (lastCandle && now - new Date(lastCandle.x) < 5 * 60 * 1000) { 
        // If within 5 minutes, update the last candle
        lastCandle.c = priceInAud;
        if (priceInAud > lastCandle.h) lastCandle.h = priceInAud;
        if (priceInAud < lastCandle.l) lastCandle.l = priceInAud;
        console.log(`Updated existing candle at ${lastCandle.x} with price: AUD $${priceInAud}`);
    } else { 
        // Otherwise, create a new candle
        candlestickChart.data.datasets[0].data.push({
            x: now,
            o: priceInAud,
            h: priceInAud,
            l: priceInAud,
            c: priceInAud
        });
        console.log(`Created new candle at ${now} with price: AUD $${priceInAud}`);
    }

    // Adjust the chart's x-axis time range to zoom out slightly and leave room on the right
    const paddingTime = 10 * 60 * 1000; // Add 10 minutes of padding to the right
    candlestickChart.options.scales.x.min = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago
    candlestickChart.options.scales.x.max = new Date(now.getTime() + paddingTime); // Add extra space to the right for padding

    candlestickChart.update(); // Update the chart to reflect the new data

    // Update live price in the modal header (show both AUD and USD)
    const livePriceElement = document.getElementById('live-price');
    if (livePriceElement) {
        livePriceElement.innerHTML = `<span style="font-weight: normal;">Live Price: </span><b>$${priceInAud.toFixed(8)}</b> <span style="font-weight: normal;">AUD</span> (<b>$${priceInUsd.toFixed(8)}</b> <span style="font-weight: normal;">USD</span>)`;
        // Update live price
    }
}



function saveCandlestickData(cryptoId, priceInAud) {
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
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=1`);
    if (!response.ok) {
        throw new Error('Failed to fetch historical data');
    }
    const data = await response.json();
    const conversionRate = 1.51; // Example conversion rate from USD to AUD

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

    const modal = document.getElementById('candlestick-modal');
    const ctx = document.getElementById('candlestick-chart').getContext('2d');

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
        holdingsElement.innerHTML = `
            <p><strong>${holdings.toFixed(3)}</strong> ${crypto.symbol.toUpperCase()} = <strong>$${holdingsValueAud.toFixed(2)}</strong> AUD</p>
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

        // Fetch historical data and render the chart
        const historicalData = await fetchHistoricalData(cryptoId);
        const savedData = JSON.parse(localStorage.getItem(`${cryptoId}_candlestickData`)) || [];
        const combinedData = [...historicalData, ...savedData];

        const chartData = formatCandlestickData(combinedData);
        document.getElementById('live-price').textContent = `Waiting for Live Price...`;

        if (candlestickChart) {
            candlestickChart.destroy();
        }

        // Get current date and 24 hours ago for x-axis limits
        const now = new Date();
        const past24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));

        candlestickChart = new Chart(ctx, {
            type: 'candlestick',
            data: chartData,
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute',
                            stepSize: 5,
                            displayFormats: {
                                minute: 'HH:mm'
                            },
                            minUnit: 'minute'
                        },
                        ticks: {
                            source: 'auto',
                            autoSkip: true,
                            maxRotation: 0,
                            major: {
                                enabled: true
                            }
                        },
                        grid: {
                            color: 'rgba(211,211,211,0.2)',
                            drawBorder: false
                        },
                        min: past24Hours, // Set minimum to 24 hours ago
                        max: now // Set maximum to current time
                    },
                    y: {
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(211,211,211,0.2)',
                            drawBorder: false
                        },
                        ticks: {
                            callback: function(value) {
                                return `$${value.toFixed(8)}`;
                            }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        position: 'nearest',
                        callbacks: {
                            label: function(context) {
                                let h = context.raw.h.toFixed(8);
                                let l = context.raw.l.toFixed(8);
                                return `H: $${h}, L: $${l}`;
                            },
                            title: function(context) {
                                const date = new Date(context[0].parsed.x);
                                return date.toLocaleString();
                            }
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x',
                            onPan: function({ chart }) {
                                chart.update('none');
                            }
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                                modifierKey: null
                            },
                            pinch: {
                                enabled: true
                            },
                            mode: 'x',
                            onZoom: function({ chart }) {
                                chart.update('none');
                            }
                        }
                    }
                },
                elements: {
                    candlestick: {
                        borderColor: '#26a69a',
                        borderWidth: 1,
                        barThickness: 5
                    }
                }
            }
        });

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

    } catch (error) {
        console.error('Error fetching or displaying candlestick data:', error);
    }
}




// New function to fetch and display live price with USD
async function fetchLivePrice(symbol) {
    const apiUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=aud,usd`; // Fetch both AUD and USD prices
    
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        // Retrieve both live prices for AUD and USD
        const audPrice = data[symbol].aud;  
        const usdPrice = data[symbol].usd;

        // Update the modal with the live price in AUD and the USD equivalent in brackets
        document.getElementById('live-price').textContent = `$${audPrice.toFixed(2)} (USD: $${usdPrice.toFixed(2)})`;
        
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
}








async function fetchCandlestickData(cryptoId) {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${cryptoId}/ohlc?vs_currency=usd&days=1`);
    if (!response.ok) {
        throw new Error('Failed to fetch candlestick data');
    }
    return await response.json();
}

function formatCandlestickData(data) {
    return {
        datasets: [{
            label: 'Candlestick Chart',
            data: data.map(d => ({
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
let showAllPackages = false;

// Error alert throttling (prevent spam during reconnection)
let lastEasyMiningErrorAlert = 0;
const EASYMINING_ERROR_ALERT_COOLDOWN = 60000; // 60 seconds between error alerts

// Helper function to check if we should show an error alert
function shouldShowEasyMiningErrorAlert() {
    const now = Date.now();
    const timeSinceLastAlert = now - lastEasyMiningErrorAlert;

    if (timeSinceLastAlert < EASYMINING_ERROR_ALERT_COOLDOWN) {
        console.log(`⏳ Suppressing EasyMining error alert (cooldown: ${Math.ceil((EASYMINING_ERROR_ALERT_COOLDOWN - timeSinceLastAlert) / 1000)}s remaining)`);
        return false;
    }

    lastEasyMiningErrorAlert = now;
    return true;
}

// =============================================================================
// EASYMINING SETTINGS MODAL FUNCTIONS
// =============================================================================

function showEasyMiningSettingsModal() {
    console.log('🔵 showEasyMiningSettingsModal called');

    // Close settings modal first
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        settingsModal.style.display = 'none';
    }

    // Check if modal exists
    const modal = document.getElementById('easymining-settings-modal');
    console.log('Modal element:', modal);

    if (!modal) {
        console.error('❌ Modal not found!');
        alert('ERROR: EasyMining modal not found in DOM!');
        return;
    }

    // Load saved settings
    const savedSettings = JSON.parse(localStorage.getItem(`${loggedInUser}_easyMiningSettings`)) || easyMiningSettings;

    // Load API credentials
    document.getElementById('nicehash-api-key').value = savedSettings.apiKey || '';
    document.getElementById('nicehash-api-secret').value = savedSettings.apiSecret || '';
    document.getElementById('nicehash-org-id').value = savedSettings.orgId || '';

    // Load toggle settings
    document.getElementById('auto-update-holdings-toggle').checked = savedSettings.autoUpdateHoldings || false;
    document.getElementById('include-available-btc-toggle').checked = savedSettings.includeAvailableBTC || false;
    document.getElementById('include-pending-btc-toggle').checked = savedSettings.includePendingBTC || false;

    // Show modal
    console.log('Setting modal display to block...');
    modal.style.display = 'block';
    console.log('✅ Modal display set to:', modal.style.display);
}

function closeEasyMiningSettingsModal() {
    const modal = document.getElementById('easymining-settings-modal');
    modal.style.display = 'none';
}

// Make functions globally accessible
window.showEasyMiningSettingsModal = showEasyMiningSettingsModal;
window.closeEasyMiningSettingsModal = closeEasyMiningSettingsModal;

function activateEasyMining() {
    // Get API credentials
    const apiKey = document.getElementById('nicehash-api-key').value.trim();
    const apiSecret = document.getElementById('nicehash-api-secret').value.trim();
    const orgId = document.getElementById('nicehash-org-id').value.trim();
    
    // Validate credentials
    if (!apiKey || !apiSecret || !orgId) {
        showModal('Please enter all API credentials to activate EasyMining.');
        return;
    }
    
    // Save API credentials
    easyMiningSettings.apiKey = apiKey;
    easyMiningSettings.apiSecret = apiSecret;
    easyMiningSettings.orgId = orgId;
    easyMiningSettings.enabled = true;
    
    // Save toggle settings
    easyMiningSettings.autoUpdateHoldings = document.getElementById('auto-update-holdings-toggle').checked;
    easyMiningSettings.includeAvailableBTC = document.getElementById('include-available-btc-toggle').checked;
    easyMiningSettings.includePendingBTC = document.getElementById('include-pending-btc-toggle').checked;

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_easyMiningSettings`, JSON.stringify(easyMiningSettings));

    console.log('EasyMining activated with credentials');

    // Reset first load flag to show loading bar on next data fetch
    isFirstEasyMiningLoad = true;

    // Update BTC holdings display with new settings
    updateBTCHoldingsDisplay();

    // Start polling (section will be shown automatically after loading bar completes)
    startEasyMiningPolling();

    closeEasyMiningSettingsModal();
    showModal('✅ EasyMining activated successfully!\n\nThe EasyMining section will appear after loading completes.');
}

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

    // Save to localStorage
    localStorage.setItem(`${loggedInUser}_easyMiningSettings`, JSON.stringify(easyMiningSettings));

    console.log('EasyMining activated with credentials (from page)');

    // Reset first load flag to show loading bar on next data fetch
    isFirstEasyMiningLoad = true;

    // Update BTC holdings display with new settings
    updateBTCHoldingsDisplay();

    // Start polling (section will be shown automatically after loading bar completes)
    startEasyMiningPolling();

    // Go back to app page
    showAppPage();
    alert('✅ EasyMining activated successfully!\n\nThe EasyMining section will appear after loading completes.');
}

function clearAPICredentials() {
    if (!confirm('Are you sure you want to clear all API credentials?\n\nThis will disable EasyMining and remove your API keys.')) {
        return;
    }
    
    // Clear input fields
    document.getElementById('nicehash-api-key').value = '';
    document.getElementById('nicehash-api-secret').value = '';
    document.getElementById('nicehash-org-id').value = '';
    
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
    document.getElementById('easymining-section').style.display = 'none';

    console.log('API credentials cleared');
    showModal('API credentials cleared successfully.\n\nEasyMining has been disabled.');
}

// Make functions globally accessible
window.activateEasyMining = activateEasyMining;
window.clearAPICredentials = clearAPICredentials;

// =============================================================================
// COINGECKO API SETTINGS PAGE FUNCTIONS
// =============================================================================

function showCoinGeckoApiSettingsPage() {
    console.log('Showing CoinGecko API Settings Page');

    // Hide all other pages
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('register-page').style.display = 'none';
    document.getElementById('app-page').style.display = 'none';
    document.getElementById('easymining-settings-page').style.display = 'none';
    document.getElementById('buy-packages-page').style.display = 'none';
    document.getElementById('package-detail-page').style.display = 'none';

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

function toggleShowMorePackages() {
    showAllPackages = !showAllPackages;
    displayActivePackages();
    document.getElementById('show-more-packages').textContent = showAllPackages ? 'Show Less' : 'Show More';
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
window.toggleShowMorePackages = toggleShowMorePackages;
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
                alert('❌ Please enter all NiceHash API credentials!\n\nMake sure you have filled in:\n- API Key\n- API Secret\n- Organization ID');
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
                    // CORS error - use mock data for testing
                    console.warn('⚠️ CORS error detected - using mock data for testing');
                    console.warn('📝 To fix: Deploy with backend proxy or use serverless functions');

                    // Use realistic mock data that simulates actual API responses
                    easyMiningData.availableBTC = (Math.random() * 0.001).toFixed(8);
                    easyMiningData.pendingBTC = (Math.random() * 0.0005).toFixed(8);
                    easyMiningData.activePackages = generateMockPackages();

                    console.log('🔧 Using mock data for testing:');
                    console.log(`Available BTC: ${easyMiningData.availableBTC}`);
                    console.log(`Pending BTC: ${easyMiningData.pendingBTC}`);
                    console.log(`Active Packages: ${easyMiningData.activePackages.length}`);
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

        // Update BTC holdings if toggles are enabled
        updateBTCHoldings();

        // Complete loading (only on first load)
        // Loading bar will automatically hide when it reaches 100%
        if (isFirstEasyMiningLoad) {
            setEasyMiningLoadingTarget(100);
        }

    } catch (error) {
        console.error('Error fetching EasyMining data:', error);

        // Hide loading bar on error (if first load)
        if (isFirstEasyMiningLoad) {
            hideEasyMiningLoadingBar();
        }

        // Don't alert for CORS errors as we're handling them gracefully
        // Also apply cooldown to prevent alert spam during reconnection
        if (!error.message.includes('fetch') && shouldShowEasyMiningErrorAlert()) {
            if (error.message.includes('401')) {
                // Specific message for authentication errors
                alert('❌ API Error 401 - Authentication Failed\n\n' +
                      'NiceHash rejected your API credentials.\n\n' +
                      '✅ Quick Fixes:\n' +
                      '1. Check credentials have dashes (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)\n' +
                      '2. Verify you copied them correctly from NiceHash\n' +
                      '3. Check API key has Read/Write permissions\n' +
                      '4. Create fresh API key if expired\n\n' +
                      '📝 Check browser console (F12) for detailed troubleshooting info.\n' +
                      '📖 See NICEHASH_401_FIX.md for full guide.');
            } else if (error.message.includes('Missing credentials')) {
                // This is already handled by the validation function alert
                // Don't show duplicate alert
            } else {
                // Generic error message for other issues
                alert(`Error fetching EasyMining data: ${error.message}\n\nPlease check your API credentials and network connection.`);
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

                    if (isConfirmed) {
                        confirmedBlockCount++;
                        console.log(`   ✅ Block #${idx + 1}: ${btcReward.toFixed(8)} BTC, ${cryptoRewardAmount} ${rewardCoin} (Confirmed)${reward.shared ? ' [SHARED]' : ''}`);
                    } else {
                        pendingBlockCount++;
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
                // Fallback to standard block reward
                const blockReward = getBlockReward(order.soloMiningCoin);
                cryptoReward = totalBlocks > 0 ? blockReward * totalBlocks : 0;
                console.log(`   💎 Using standard block reward: ${cryptoReward} ${order.soloMiningCoin}`);
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
                    // Fallback: Calculate my shares from addedAmount / 0.0001
                    myShares = addedAmount > 0 ? addedAmount / SHARE_COST : 0;
                    console.log(`      My shares (calculated): ${addedAmount.toFixed(8)} / ${SHARE_COST} = ${myShares.toFixed(2)}`);
                }

                // Calculate total shares: sharedTicket.addedAmount / 0.0001
                // Note: This is the TOTAL package cost, not the user's individual contribution
                const totalPackageCost = parseFloat(order.sharedTicket?.addedAmount || order.packagePrice || 0);
                totalShares = totalPackageCost > 0 ? totalPackageCost / SHARE_COST : 1;
                console.log(`      Total shares: ${totalPackageCost.toFixed(8)} / ${SHARE_COST} = ${totalShares.toFixed(2)}`);

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
                    // For team packages (both active and completed), check if secondary reward exists in member data
                    // This handles Team Palladium (DOGE/LTC) and other dual-mining packages
                    // ✅ FIXED: Changed from isCompletedTeam to isTeamPackage to work for active packages too
                    if (isTeamPackage && userMember?.rewards && userMember.rewards.length > 1) {
                        // Multiple rewards = dual mining, get secondary reward
                        console.log(`      🔍 DUAL-MINING DETECTED in member rewards (${userMember.rewards.length} rewards)`);
                        const secondaryRewardData = userMember.rewards.find(r => r.coin !== order.soloMiningCoin);
                        if (secondaryRewardData) {
                            secondaryCryptoReward = parseFloat(secondaryRewardData.rewardAmount || 0);
                            console.log(`      → SECONDARY CRYPTO REWARD (from members array): ${secondaryCryptoReward.toFixed(8)} ${secondaryRewardData.coin}`);
                        } else {
                            console.log(`      ⚠️ Multiple rewards but couldn't find secondary coin`);
                        }
                    } else if (totalPackageSecondaryCryptoReward > 0) {
                        const secondaryRewardPerShare = totalPackageSecondaryCryptoReward / totalShares;
                        secondaryCryptoReward = secondaryRewardPerShare * myShares;
                        console.log(`      → Secondary crypto reward calculation: (${totalPackageSecondaryCryptoReward} / ${totalShares.toFixed(2)}) × ${myShares.toFixed(2)} = ${secondaryCryptoReward.toFixed(8)} ${order.soloMiningMergeCoin}`);
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

    const packagesToShow = showAllPackages ? filteredPackages : filteredPackages.slice(0, 6);

    if (packagesToShow.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: #888; padding: 20px;">No ${currentPackageTab} packages</p>`;
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
            ${rocketHtml}
            <div class="package-card-name">${pkg.name}${blockBadge}</div>
            <div class="package-card-stat">
                <span>Reward:</span>
                <span style="color: ${pkg.blockFound ? '#00ff00' : '#888'};">${rewardDisplay}</span>
            </div>
            ${!pkg.active && pkg.blockFound && pkg.reward > 0 ? `
            <div class="package-card-stat">
                <span>Reward AUD:</span>
                <span style="color: #00ff00;">$${convertCryptoToAUD(pkg.reward, pkg.crypto).toFixed(2)} AUD${pkg.rewardSecondary > 0 && pkg.cryptoSecondary ? `<br>+ $${convertCryptoToAUD(pkg.rewardSecondary, pkg.cryptoSecondary).toFixed(2)} AUD` : ''}</span>
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
    
    // Show/hide "Show More" button
    const showMoreBtn = document.getElementById('show-more-packages');
    if (easyMiningData.activePackages.length > 6) {
        showMoreBtn.style.display = 'block';
    } else {
        showMoreBtn.style.display = 'none';
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

function updateRecommendations() {
    const bestPackagesContainer = document.getElementById('best-packages-container');
    const teamAlertsContainer = document.getElementById('team-alerts-container');
    
    bestPackagesContainer.innerHTML = '';
    teamAlertsContainer.innerHTML = '';
    
    // Find best single packages (sort by price/reward ratio)
    const singlePackages = easyMiningData.activePackages.filter(pkg => !pkg.isTeam && pkg.active);
    const bestSingle = singlePackages.sort((a, b) => {
        // Sort by best reward/price ratio (higher is better)
        const ratioA = (a.reward || 0) / (a.price || 1);
        const ratioB = (b.reward || 0) / (b.price || 1);
        return ratioB - ratioA;
    }).slice(0, 2);

    bestSingle.forEach(pkg => {
        const card = document.createElement('div');
        card.className = 'recommendation-card';
        card.innerHTML = `
            <h4>🌟 ${pkg.name}</h4>
            <p><strong>Reward:</strong> ${pkg.reward} ${pkg.crypto}</p>
            <p><strong>Price:</strong> $${(pkg.price || 0).toFixed(4)}</p>
            <p><strong>Time Remaining:</strong> ${pkg.timeRemaining}</p>
        `;
        bestPackagesContainer.appendChild(card);
    });

    if (bestSingle.length === 0) {
        bestPackagesContainer.innerHTML = '<p>No active packages at this time.</p>';
    }
    
    // Check team package criteria
    const teamPackages = easyMiningData.activePackages.filter(pkg => pkg.isTeam && pkg.active);

    teamPackages.forEach(pkg => {
        // Team packages recommendations (simplified for live API)
        // Real API doesn't provide probability/shares data in the same format
        let shouldAlert = false;

        // Alert for any active team packages with good reward/price ratio
        const ratio = (pkg.reward || 0) / (pkg.price || 1);
        if (ratio > 0.01) { // Decent reward ratio
            shouldAlert = true;
        }

        if (shouldAlert) {
            const card = document.createElement('div');
            card.className = 'recommendation-card';
            card.innerHTML = `
                <h4>🚀 ${pkg.name}</h4>
                <p><strong>Reward:</strong> ${pkg.reward} ${pkg.crypto}</p>
                <p><strong>Price:</strong> $${(pkg.price || 0).toFixed(4)}</p>
                <p><strong>Time Remaining:</strong> ${pkg.timeRemaining}</p>
            `;
            teamAlertsContainer.appendChild(card);

            // Play alert sound
            playSound('package-alert-sound');
        }
    });
    
    if (teamAlertsContainer.innerHTML === '') {
        teamAlertsContainer.innerHTML = '<p>No team package alerts at this time.</p>';
    }
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
        console.log('⚠️ Auto-update is DISABLED in settings');
        return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('🔄 AUTO-UPDATE CRYPTO HOLDINGS - Processing rewards');
    console.log(`${'='.repeat(80)}\n`);

    // Load tracked rewards to prevent double-adding
    const trackedKey = `${loggedInUser}_easyMiningAddedRewards`;
    let addedRewards = JSON.parse(getStorageItem(trackedKey)) || {};

    // Get ALL packages that found blocks (both active AND completed)
    // This ensures we process rewards from all packages, not just active ones
    const allPackages = easyMiningData.activePackages || [];
    const packagesWithBlocks = allPackages.filter(pkg => pkg.blockFound);

    console.log(`📦 Processing ${packagesWithBlocks.length} packages with blocks found (active + completed)`);

    for (const pkg of packagesWithBlocks) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`📦 Package: ${pkg.name} (${pkg.crypto})`);
        console.log(`   Order ID: ${pkg.id}`);
        console.log(`   Total blocks: ${pkg.totalBlocks}`);
        console.log(`   Package reward: ${pkg.reward} ${pkg.crypto}`);

        // Check if this package has already been processed
        const packageKey = `${pkg.id}_total`;
        if (addedRewards[packageKey]) {
            console.log(`   ℹ️ Package already processed on ${new Date(addedRewards[packageKey].timestamp).toLocaleString()}`);
            console.log(`   Previous amount: ${addedRewards[packageKey].amount} ${pkg.crypto}`);

            // Check if reward amount has changed (new blocks found)
            if (addedRewards[packageKey].amount === pkg.reward) {
                console.log(`   ✓ No new rewards since last check, skipping`);
                continue;
            } else {
                console.log(`   🎉 Reward increased from ${addedRewards[packageKey].amount} to ${pkg.reward}`);
                console.log(`   💰 Adding difference: ${pkg.reward - addedRewards[packageKey].amount} ${pkg.crypto}`);
            }
        }

        // Use the ALREADY CALCULATED reward from package data
        const crypto = pkg.crypto;
        const rewardAmount = parseFloat(pkg.reward) || 0;

        if (rewardAmount === 0 || isNaN(rewardAmount)) {
            console.log(`   ⚠️ No reward to add (amount: ${rewardAmount})`);
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

        console.log(`   💰 Adding ${rewardAmount} ${crypto} to holdings`);

        // Check if crypto already exists in portfolio
        let cryptoExists = users[loggedInUser].cryptos.find(c => c.id === cryptoId);

        if (!cryptoExists) {
            // Auto-add crypto to portfolio
            try {
                await addCryptoById(cryptoId);
                console.log(`   ✅ Auto-added ${cryptoId} to portfolio`);

                // Immediately fetch prices for the new crypto
                await fetchPrices();
                console.log(`   ✅ Fetched price for ${cryptoId}`);
            } catch (error) {
                console.error(`   ❌ Failed to auto-add ${cryptoId}:`, error);
                continue;
            }
        }

        // Calculate amount to add
        let amountToAdd = rewardAmount;
        if (addedRewards[packageKey]) {
            // Only add the difference if package was previously processed
            amountToAdd = rewardAmount - addedRewards[packageKey].amount;

            // ✅ FIX: Prevent negative amounts (API data inconsistency)
            if (amountToAdd < 0) {
                console.log(`   ⚠️ WARNING: Reward amount decreased! Preventing negative addition.`);
                console.log(`   Previous: ${addedRewards[packageKey].amount}, Current: ${rewardAmount}`);
                console.log(`   This package will be skipped to prevent subtracting from holdings.`);
                continue; // Skip this package entirely
            }
        }

        // ✅ SAFETY: Final check to ensure amountToAdd is valid and positive
        if (isNaN(amountToAdd) || amountToAdd <= 0) {
            console.log(`   ⚠️ Invalid or zero amount to add (${amountToAdd}), skipping`);
            continue;
        }

        // Update holdings for this crypto
        const currentHoldings = parseFloat(getStorageItem(`${loggedInUser}_${cryptoId}Holdings`)) || 0;
        const newHoldings = currentHoldings + amountToAdd;

        // Save to localStorage
        setStorageItem(`${loggedInUser}_${cryptoId}Holdings`, newHoldings);
        console.log(`   💾 Updated ${cryptoId} holdings: ${currentHoldings} + ${amountToAdd} = ${newHoldings}`);

        // For Bitcoin, use updateBTCHoldings() to include NiceHash balance (same as manual update)
        // For other cryptos, update display and AUD directly
        if (cryptoId === 'bitcoin' && typeof updateBTCHoldings === 'function') {
            console.log(`   🔄 Calling updateBTCHoldings() to add NiceHash balance`);
            updateBTCHoldings();
            sortContainersByValue();
        } else {
            // Update holdings display
            const holdingsElement = document.getElementById(`${cryptoId}-holdings`);
            if (holdingsElement) {
                holdingsElement.textContent = formatNumber(newHoldings.toFixed(8));
                console.log(`   📊 Updated holdings display`);
            }

            // Update the AUD value
            const priceElement = document.getElementById(`${cryptoId}-price-aud`);
            const valueElement = document.getElementById(`${cryptoId}-value-aud`);
            if (priceElement && valueElement) {
                const priceInAud = parseFloat(priceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
                const valueInAud = newHoldings * priceInAud;
                valueElement.textContent = formatNumber(valueInAud.toFixed(2));
                console.log(`   💰 Updated AUD value: $${valueInAud.toFixed(2)}`);

                sortContainersByValue();
            }
        }

        // Process secondary rewards (for dual mining packages like Palladium DOGE/LTC)
        if (pkg.cryptoSecondary && pkg.rewardSecondary > 0) {
            console.log(`\n   💎 SECONDARY REWARD DETECTED (Dual Mining)`);
            console.log(`   Secondary crypto: ${pkg.cryptoSecondary}`);
            console.log(`   Secondary reward: ${pkg.rewardSecondary}`);

            const secondaryCrypto = pkg.cryptoSecondary;
            const secondaryRewardAmount = parseFloat(pkg.rewardSecondary) || 0;

            if (secondaryRewardAmount > 0 && !isNaN(secondaryRewardAmount)) {
                // Map secondary crypto symbol to CoinGecko ID
                const secondaryCryptoId = cryptoMapping[secondaryCrypto] || secondaryCrypto.toLowerCase();

                console.log(`   💰 Adding ${secondaryRewardAmount} ${secondaryCrypto} to holdings`);

                // Check if this secondary reward was already added
                const secondaryPackageKey = `${pkg.id}_secondary`;
                let secondaryAmountToAdd = secondaryRewardAmount;

                if (addedRewards[secondaryPackageKey]) {
                    console.log(`   ℹ️ Secondary reward already processed`);
                    console.log(`   Previous amount: ${addedRewards[secondaryPackageKey].amount} ${secondaryCrypto}`);

                    // Check if secondary reward amount has changed
                    if (addedRewards[secondaryPackageKey].amount === secondaryRewardAmount) {
                        console.log(`   ✓ No new secondary rewards since last check, skipping`);
                        secondaryAmountToAdd = 0; // ✅ FIX: Set to 0 to prevent re-adding
                    } else {
                        console.log(`   🎉 Secondary reward increased from ${addedRewards[secondaryPackageKey].amount} to ${secondaryRewardAmount}`);
                        secondaryAmountToAdd = secondaryRewardAmount - addedRewards[secondaryPackageKey].amount;

                        // ✅ FIX: Prevent negative amounts (API data inconsistency)
                        if (secondaryAmountToAdd < 0) {
                            console.log(`   ⚠️ WARNING: Secondary reward decreased! Preventing negative addition.`);
                            console.log(`   Previous: ${addedRewards[secondaryPackageKey].amount}, Current: ${secondaryRewardAmount}`);
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
                        console.log(`   ✅ Auto-added ${secondaryCryptoId} to portfolio`);

                        // Immediately fetch prices for the new crypto
                        await fetchPrices();
                        console.log(`   ✅ Fetched price for ${secondaryCryptoId}`);
                    } catch (error) {
                        console.error(`   ❌ Failed to auto-add ${secondaryCryptoId}:`, error);
                    }
                }

                // ✅ SAFETY: Final check to ensure secondaryAmountToAdd is valid and positive
                if (secondaryAmountToAdd > 0 && !isNaN(secondaryAmountToAdd)) {
                    // Update holdings for secondary crypto
                    const currentSecondaryHoldings = parseFloat(getStorageItem(`${loggedInUser}_${secondaryCryptoId}Holdings`)) || 0;
                    const newSecondaryHoldings = currentSecondaryHoldings + secondaryAmountToAdd;

                    // Save to localStorage
                    setStorageItem(`${loggedInUser}_${secondaryCryptoId}Holdings`, newSecondaryHoldings);
                    console.log(`   💾 Updated ${secondaryCryptoId} holdings: ${currentSecondaryHoldings} + ${secondaryAmountToAdd} = ${newSecondaryHoldings}`);

                    // Update holdings display
                    const secondaryHoldingsElement = document.getElementById(`${secondaryCryptoId}-holdings`);
                    if (secondaryHoldingsElement) {
                        secondaryHoldingsElement.textContent = formatNumber(newSecondaryHoldings.toFixed(8));
                        console.log(`   📊 Updated secondary holdings display`);
                    }

                    // Update the AUD value
                    const secondaryPriceElement = document.getElementById(`${secondaryCryptoId}-price-aud`);
                    const secondaryValueElement = document.getElementById(`${secondaryCryptoId}-value-aud`);
                    if (secondaryPriceElement && secondaryValueElement) {
                        const secondaryPriceInAud = parseFloat(secondaryPriceElement.textContent.replace(/,/g, '').replace('$', '')) || 0;
                        const secondaryValueInAud = newSecondaryHoldings * secondaryPriceInAud;
                        secondaryValueElement.textContent = formatNumber(secondaryValueInAud.toFixed(2));
                        console.log(`   💰 Updated secondary AUD value: $${secondaryValueInAud.toFixed(2)}`);

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

function showBuyPackagesModal() {
    loadBuyPackagesData();
    document.getElementById('buy-packages-modal').style.display = 'block';
}

function closeBuyPackagesModal() {
    document.getElementById('buy-packages-modal').style.display = 'none';
}

function showBuyTab(tab) {
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    if (tab === 'single') {
        document.getElementById('buy-single-packages').style.display = 'grid';
        document.getElementById('buy-team-packages').style.display = 'none';
    } else {
        document.getElementById('buy-single-packages').style.display = 'none';
        document.getElementById('buy-team-packages').style.display = 'grid';
    }
}

// Make modal functions globally accessible
window.showPackageDetailModal = showPackageDetailModal;
window.closePackageDetailModal = closePackageDetailModal;
window.showBuyPackagesModal = showBuyPackagesModal;
window.closeBuyPackagesModal = closeBuyPackagesModal;
window.showBuyTab = showBuyTab;
window.buyPackage = buyPackage;

async function loadBuyPackagesData() {
    console.log('\n🛒 Loading available packages from NiceHash API...\n');

    const singleContainer = document.getElementById('buy-single-packages');
    const teamContainer = document.getElementById('buy-team-packages');

    // Show loading state
    singleContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ffa500;">Loading packages...</div>';
    teamContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ffa500;">Loading packages...</div>';

    try {
        // Fetch both solo and team packages in parallel
        const [soloPackages, teamPackages] = await Promise.all([
            fetchAvailableSoloPackages(),
            fetchAvailableTeamPackages()
        ]);

        console.log('📦 Solo packages loaded:', soloPackages.length);
        console.log('👥 Team packages loaded:', teamPackages.length);

        // Clear containers
        singleContainer.innerHTML = '';
        teamContainer.innerHTML = '';

        // Display solo packages
        if (soloPackages.length > 0) {
            soloPackages.forEach(pkg => {
                const card = createSoloPackageCard(pkg);
                singleContainer.appendChild(card);
            });
        } else {
            singleContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No solo packages available</div>';
        }

        // Display team packages
        if (teamPackages.length > 0) {
            teamPackages.forEach(pkg => {
                const card = createTeamPackageCard(pkg);
                teamContainer.appendChild(card);
            });
        } else {
            teamContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No team packages available</div>';
        }

    } catch (error) {
        console.error('❌ Error loading packages:', error);
        singleContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ff4444;">Error loading packages. Please check your API credentials.</div>';
        teamContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #ff4444;">Error loading packages. Please check your API credentials.</div>';
    }
}

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

// Create UI card for team package with share selector
function createTeamPackageCard(pkg) {
    const card = document.createElement('div');
    card.className = 'buy-package-card team-package-card';

    // Extract package details from API response
    // Team package structure: { id, currencyAlgoTicket: { name, price, probability, currencyAlgo: { currency, blockReward } }, numberOfParticipants, fullAmount, addedAmount }
    const ticket = pkg.currencyAlgoTicket || {};
    const packageName = ticket.name || 'Unknown Package';
    const crypto = ticket.currencyAlgo?.currency || 'Unknown';
    const packageId = pkg.id;
    const packagePrice = ticket.price || 0;
    const fullAmount = pkg.fullAmount || packagePrice;
    const addedAmount = pkg.addedAmount || 0;
    const availableAmount = fullAmount - addedAmount;
    const sharePrice = 0.0001; // Standard share price
    const totalShares = Math.floor(packagePrice / sharePrice);
    const availableShares = Math.floor(availableAmount / sharePrice);
    const probability = ticket.probability || 'N/A';
    const potentialReward = ticket.currencyAlgo?.blockReward || 'N/A';
    const participants = pkg.numberOfParticipants || 0;

    // Calculate price in AUD (assuming BTC price)
    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const pricePerShareAUD = (sharePrice * btcPrice).toFixed(2);

    // Generate unique ID for this card's share input
    const cardId = `team-${packageId}`;

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
                <span>Potential Reward:</span>
                <span>${potentialReward} ${crypto}</span>
            </div>
            <div class="buy-package-stat">
                <span>Total Shares:</span>
                <span>${totalShares}</span>
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
            <button class="share-button" onclick="adjustShares('${cardId}', -1)">-</button>
            <input
                type="number"
                id="${cardId}-shares"
                class="share-input"
                value="0"
                min="0"
                max="${availableShares}"
                onchange="validateShares('${cardId}', ${availableShares})"
            />
            <button class="share-button" onclick="adjustShares('${cardId}', 1)">+</button>
        </div>
        <div class="total-cost" id="${cardId}-cost" style="margin: 10px 0; color: #ffa500; font-weight: bold;">
            Total: 0 BTC ($0.00 AUD)
        </div>
        <button class="buy-package-button" onclick="buyTeamPackage('${packageId}', '${crypto}', ${sharePrice}, '${cardId}', ${availableShares})">
            Buy Shares
        </button>
    `;

    return card;
}

// Helper function to adjust share count (+ and - buttons)
function adjustShares(cardId, delta) {
    const input = document.getElementById(`${cardId}-shares`);
    const currentValue = parseInt(input.value) || 0;
    const max = parseInt(input.max) || 999999;
    const newValue = Math.max(0, Math.min(max, currentValue + delta));

    input.value = newValue;
    updateShareCost(cardId);
}

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
    const shares = parseInt(input.value) || 0;

    // Extract share price from the card (stored in the buy button's onclick)
    const card = input.closest('.buy-package-card');
    const buyButton = card.querySelector('.buy-package-button');
    const onclickAttr = buyButton.getAttribute('onclick');
    const sharePriceMatch = onclickAttr.match(/buyTeamPackage\('[^']+',\s*'[^']+',\s*([\d.]+)/);

    if (sharePriceMatch && shares > 0) {
        const sharePrice = parseFloat(sharePriceMatch[1]);
        const totalBTC = (sharePrice * shares).toFixed(8);
        const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
        const totalAUD = (sharePrice * shares * btcPrice).toFixed(2);

        costDisplay.textContent = `Total: ${totalBTC} BTC ($${totalAUD} AUD)`;
        costDisplay.style.color = '#4CAF50';
    } else {
        costDisplay.textContent = 'Total: 0 BTC ($0.00 AUD)';
        costDisplay.style.color = '#ffa500';
    }
}

// Make helper functions globally accessible
window.adjustShares = adjustShares;
window.validateShares = validateShares;
window.updateShareCost = updateShareCost;

// Buy solo package using POST /main/api/v2/hashpower/solo/order
async function buySoloPackage(ticketId, crypto, packagePrice) {
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        showModal('Please configure EasyMining API settings first!');
        closeBuyPackagesModal();
        showEasyMiningSettingsModal();
        return;
    }

    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const priceAUD = (packagePrice * btcPrice).toFixed(2);

    if (!confirm(`Purchase Solo Package for ${crypto}?\n\nCost: ${packagePrice.toFixed(8)} BTC ($${priceAUD} AUD)\n\nThis will create an order on NiceHash.`)) {
        return;
    }

    try {
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

        closeBuyPackagesModal();

    } catch (error) {
        console.error('❌ Error purchasing solo package:', error);
        showModal(`Failed to purchase package: ${error.message}\n\nPlease check your API credentials and balance.`);
    }
}

// Buy team package using POST /main/api/v2/hashpower/shared/ticket/{id}
async function buyTeamPackage(packageId, crypto, sharePrice, cardId, maxShares) {
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        showModal('Please configure EasyMining API settings first!');
        closeBuyPackagesModal();
        showEasyMiningSettingsModal();
        return;
    }

    const input = document.getElementById(`${cardId}-shares`);
    const shares = parseInt(input.value) || 0;

    if (shares <= 0) {
        showModal('Please select at least 1 share to purchase.');
        return;
    }

    if (shares > maxShares) {
        showModal(`Maximum available shares: ${maxShares}`);
        return;
    }

    const totalBTC = sharePrice * shares;
    const btcPrice = cryptoPrices['bitcoin']?.aud || 140000;
    const totalAUD = (totalBTC * btcPrice).toFixed(2);

    if (!confirm(`Purchase ${shares} share(s) for ${crypto}?\n\nCost per share: ${sharePrice.toFixed(8)} BTC\nTotal cost: ${totalBTC.toFixed(8)} BTC ($${totalAUD} AUD)\n\nThis will create an order on NiceHash.`)) {
        return;
    }

    try {
        console.log('🛒 Creating NiceHash team order...');
        console.log('   Package ID:', packageId);
        console.log('   Crypto:', crypto);
        console.log('   Shares:', shares);
        console.log('   Price per share:', sharePrice, 'BTC');
        console.log('   Total:', totalBTC, 'BTC');

        // POST /main/api/v2/hashpower/shared/ticket/{id} with shares in request body
        const endpoint = `/main/api/v2/hashpower/shared/ticket/${packageId}`;
        const bodyData = {
            shares: shares
        };
        const body = JSON.stringify(bodyData);
        const headers = generateNiceHashAuthHeaders('POST', endpoint, body);

        console.log('📡 Endpoint:', endpoint);
        console.log('📦 Body:', bodyData);

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
        console.log('✅ Team package purchased successfully:', result);

        showModal(`✅ Team Package purchased successfully!\n\nCrypto: ${crypto}\nShares: ${shares}\nOrder ID: ${result.id || result.orderId || 'N/A'}\n\nOrder is now active and mining.`);

        // Update stats
        easyMiningData.allTimeStats.totalSpent += totalBTC * btcPrice;
        easyMiningData.todayStats.totalSpent += totalBTC * btcPrice;

        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh package data
        await fetchEasyMiningData();

        closeBuyPackagesModal();

    } catch (error) {
        console.error('❌ Error purchasing team package:', error);
        showModal(`Failed to purchase package: ${error.message}\n\nPlease check your API credentials and balance.`);
    }
}

// Make buy functions globally accessible
window.buySoloPackage = buySoloPackage;
window.buyTeamPackage = buyTeamPackage;

async function buyPackage(pkg) {
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        showModal('Please configure EasyMining API settings first!');
        closeBuyPackagesModal();
        showEasyMiningSettingsModal();
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

        closeBuyPackagesModal();

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

    if (tab === 'single') {
        document.getElementById('buy-single-packages-page').style.display = 'grid';
        document.getElementById('buy-team-packages-page').style.display = 'none';
    } else {
        document.getElementById('buy-single-packages-page').style.display = 'none';
        document.getElementById('buy-team-packages-page').style.display = 'grid';
    }
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

function loadBuyPackagesDataOnPage() {
    console.log('📦 Loading packages on buy packages page...');

    // Package data matching NiceHash EasyMining structure (with block rewards)
    const singlePackages = [
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

    const teamPackages = [
        { name: 'Silver Team', crypto: 'BCH', probability: '1:160', priceBTC: 0.0914, priceAUD: '20.00', duration: '24h', algorithm: 'SHA256', totalShares: 914, boughtShares: 71, blockReward: 3.125, isTeam: true },
        { name: 'Pal Team', crypto: 'DOGE/LTC', probability: '1:220', priceBTC: 0.08, priceAUD: '18.00', duration: '24h', algorithm: 'Scrypt', totalShares: 800, boughtShares: 45, blockReward: 10000, isTeam: true },
        { name: 'Gold Team', crypto: 'BTC', probability: '1:80', priceBTC: 0.1037, priceAUD: '50.00', duration: '24h', algorithm: 'SHA256', totalShares: 1037, boughtShares: 200, blockReward: 3.125, isTeam: true }
    ];

    const recommended = getRecommendedPackages();

    // Populate single packages
    const singleContainer = document.getElementById('buy-single-packages-page');
    singleContainer.innerHTML = '';
    singlePackages.forEach(pkg => {
        const isRecommended = recommended.includes(pkg.name);
        const card = createBuyPackageCardForPage(pkg, isRecommended);
        singleContainer.appendChild(card);
    });

    // Populate team packages
    const teamContainer = document.getElementById('buy-team-packages-page');
    teamContainer.innerHTML = '';
    teamPackages.forEach(pkg => {
        const isRecommended = recommended.includes(pkg.name);
        const card = createBuyPackageCardForPage(pkg, isRecommended);
        teamContainer.appendChild(card);
    });
}

function createBuyPackageCardForPage(pkg, isRecommended) {
    const card = document.createElement('div');
    card.className = 'buy-package-card' + (isRecommended ? ' recommended' : '');

    // Calculate reward in AUD based on crypto prices
    let rewardAUD = 0;
    if (pkg.blockReward && pkg.crypto) {
        const cryptoKey = pkg.crypto.toLowerCase().split('/')[0]; // Handle DOGE/LTC
        const cryptoData = cryptoPrices[cryptoKey];
        if (cryptoData && cryptoData.aud) {
            rewardAUD = (pkg.blockReward * cryptoData.aud).toFixed(2);
        }
    }

    const hashrateInfo = pkg.hashrate ? `
        <div class="buy-package-stat">
            <span>Hashrate:</span>
            <span>${pkg.hashrate}</span>
        </div>
    ` : '';

    // For team packages: show shares as X/Y instead of min shares
    const sharesInfo = pkg.isTeam ? `
        <div class="buy-package-stat">
            <span>Shares Filled:</span>
            <span style="color: #ffa500;">${pkg.boughtShares}/${pkg.totalShares}</span>
        </div>
    ` : '';

    const probabilityInfo = pkg.probability ? `
        <div class="buy-package-stat">
            <span>Probability:</span>
            <span>${pkg.probability}</span>
        </div>
    ` : '';

    // Potential reward section
    const rewardInfo = pkg.blockReward ? `
        <div class="buy-package-stat">
            <span>Potential Reward:</span>
            <span style="color: #4CAF50;">${pkg.blockReward.toFixed(pkg.crypto === 'BTC' || pkg.crypto === 'BCH' ? 4 : 2)} ${pkg.crypto}</span>
        </div>
        <div class="buy-package-stat">
            <span>Reward Value:</span>
            <span style="color: #4CAF50;">$${rewardAUD} AUD</span>
        </div>
    ` : '';

    // For team packages: add share selector
    const teamShareSelector = pkg.isTeam ? `
        <div style="display: flex; align-items: center; gap: 10px; margin: 10px 0;">
            <button onclick="adjustShares('${pkg.name}', -1)" style="width: 30px; height: 30px; font-size: 18px; padding: 0;">-</button>
            <input type="number" id="shares-${pkg.name.replace(/\s+/g, '-')}" value="0" min="0" max="${pkg.totalShares - pkg.boughtShares}" style="width: 60px; text-align: center; padding: 5px;" readonly>
            <button onclick="adjustShares('${pkg.name}', 1)" style="width: 30px; height: 30px; font-size: 18px; padding: 0;">+</button>
            <span style="font-size: 12px; color: #999;">shares</span>
        </div>
    ` : '';

    card.innerHTML = `
        <h4>${pkg.name}${isRecommended ? ' ⭐' : ''}</h4>
        ${pkg.crypto ? `<p style="color: #ffa500; font-weight: bold;">${pkg.crypto}</p>` : ''}
        <div class="buy-package-stats">
            ${probabilityInfo}
            <div class="buy-package-stat">
                <span>Algorithm:</span>
                <span>${pkg.algorithm || 'SHA256'}</span>
            </div>
            ${hashrateInfo}
            ${sharesInfo}
            ${rewardInfo}
            <div class="buy-package-stat">
                <span>Price:</span>
                <span>$${pkg.priceAUD} AUD</span>
            </div>
        </div>
        ${teamShareSelector}
        <button class="buy-now-btn" onclick='buyPackageFromPage(${JSON.stringify(pkg)})'>
            Buy Now
        </button>
    `;

    return card;
}

// Function to adjust shares for team packages
function adjustShares(packageName, delta) {
    const inputId = `shares-${packageName.replace(/\s+/g, '-')}`;
    const input = document.getElementById(inputId);

    if (!input) return;

    const currentValue = parseInt(input.value) || 0;
    const max = parseInt(input.max) || 0;
    const newValue = Math.max(0, Math.min(max, currentValue + delta));

    input.value = newValue;
}

// Make adjustShares globally accessible
window.adjustShares = adjustShares;

async function buyPackageFromPage(pkg) {
    if (!easyMiningSettings.enabled || !easyMiningSettings.apiKey) {
        alert('Please configure EasyMining API settings first!');
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

        alert(`✅ Package "${pkg.name}" purchased successfully!\n\nOrder ID: ${result.id || 'N/A'}`);

        // Update stats
        easyMiningData.allTimeStats.totalSpent += parseFloat(pkg.price);
        easyMiningData.todayStats.totalSpent += parseFloat(pkg.price);

        // Calculate P&L
        easyMiningData.allTimeStats.pnl = easyMiningData.allTimeStats.totalReward - easyMiningData.allTimeStats.totalSpent;
        easyMiningData.todayStats.pnl = easyMiningData.todayStats.pnl - parseFloat(pkg.price);

        localStorage.setItem(`${loggedInUser}_easyMiningData`, JSON.stringify(easyMiningData));

        // Refresh package data immediately to show the new order
        await fetchEasyMiningData();

        // Go back to app page
        showAppPage();

    } catch (error) {
        console.error('Error purchasing package:', error);
        alert(`Failed to purchase package: ${error.message}\n\nPlease check your API credentials and balance. You may need to configure your mining pool in NiceHash first.`);
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
        console.log('EasyMining polling stopped');
    }

    // Stop watchdog
    if (pollingWatchdogInterval) {
        clearInterval(pollingWatchdogInterval);
        pollingWatchdogInterval = null;
    }
}

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
            console.log('✅ EasyMining enabled - starting polling (section will appear after loading)');
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
    console.log('🧹 Cleaning up resources...');

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

    // Close WebSocket connections
    if (socket && socket.readyState === WebSocket.OPEN) {
        intentionalClose = true;
        socket.close();
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

    console.log('✅ Resources cleaned up');
}

// Add cleanup on page unload/close
window.addEventListener('beforeunload', cleanupResources);

// Initialize the app
initializeApp();
