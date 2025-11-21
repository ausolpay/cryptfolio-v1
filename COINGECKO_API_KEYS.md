# CoinGecko API Keys - Original App Keys

These are the original CoinGecko API keys that were hardcoded in the CryptFolio app before implementing user-configurable keys.

## Original Keys (in order of usage)

1. **Primary Key**: `CG-gjMFaaWvegooR4G5JtgXm6tt`
2. **Fallback Key 1**: `CG-acHzUtSKiG7z37pdrTadUxJc`
3. **Fallback Key 2**: `CG-5LeQPVdQKzrN7LPxGMB5fKbn`

## Usage Pattern

The app used automatic key rotation:
- Start with Primary Key
- If rate limited (429 response), switch to next key
- Cycle through all 3 keys on rate limit errors

## Location in Original Code

- File: `scripts.js`
- Lines: 1-4
- Variable: `apiKeys` array
- Current key index: `currentApiKeyIndex`

## Migration Date

These keys were replaced with user-configurable settings on: 2025-01-21

## Notes

- These keys are now deprecated and should not be used
- Users must provide their own CoinGecko API keys
- Free tier keys can be obtained from: https://www.coingecko.com/en/api
