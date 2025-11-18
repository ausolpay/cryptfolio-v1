Signing requests
All non-public REST API endpoints require requests to be signed.

A signed request needs to contain the following HTTP headers:

X-Time: (current UTC timestamp in ms, if timestamp is more than five minutes apart from server's time, the request will be rejected, example: 1543597115712)
X-Nonce: (random upto 36 char string, each nonce can be used only once, example: 4ebd366d-76f4-4400-a3b6-e51515d054d6)
X-Organization-Id: (organization id, example: da41b3bc-3d0b-4226-b7ea-aee73f94a518)
X-Request-Id: (required, unique identifier of specific request, client should have local awareness that some app action should be done only once on server, if for some reason request is processed by server and client does not know anything about it (request failed). This ID will provide server information that it will not repeat action if it was already processed)
X-Auth: (API Key + ":" + HMAC signature, example: 4ebd366d-76f4-4400-a3b6-e51515d054d6:fb8484df7941a4d0c337939a73cc8fc09f50bd3309af5e1926baaee4d5059dfc)

HMAC Signature: hmacSHA256 (input, api_secret)
Input is a byte array composed of ordered fields using zero byte (0x00) as a separator. There is no separator before the first field or after the last field. Some fields are always empty in which case the separators immediately follow one another. If converting HTTP header values, and url parts from string to byte representation you should use ISO-8859-1 encoding. For request body you should use the raw bytes as they are sent to the server. For JSON messages the character encoding should always be UTF-8.

Input structure is the following:
API Key
X-Time request header value
X-Nonce request header value
Empty field
X-Organization-Id request header value
Empty field
Request method (example: GET, POST, DELETE, PUT, be careful to use upper case)
Request path (example: /main/api/v2/hashpower/orderBook)
Request query string (example: algorithm=X16R&page=0&size=100, The query string should be the same as passed to the server - without the leading question mark)
Additionally, if REST endpoint requires a body it has to be included in input as an extra field prefixed by a delimiter:
Request body (example: {"test":true} )
You can use https://api2.nicehash.com/api/v2/time endpoint to get current server time in order to account for any difference with your local system clock.

Example
Signing a request to get a hashrate order book
URL: https://api2.nicehash.com/main/api/v2/hashpower/orderBook?algorithm=X16R&page=0&size=100
HTTP method: GET
API Key: 4ebd366d-76f4-4400-a3b6-e51515d054d6 (received when API Key is generated at API Keys)
API Secret: fd8a1652-728b-42fe-82b8-f623e56da8850750f5bf-ce66-4ca7-8b84-93651abc723b (received when API Key is generated at API Keys)
X-Time: 1543597115712 (current UTC time in ms)
X-Organization-ID: da41b3bc-3d0b-4226-b7ea-aee73f94a518 (organization ID)
X-Nonce: 9675d0f8-1325-484b-9594-c9d6d3268890 (generate some random string, for example: UUID.randomUUID().toString(), must be different each time you sign a request)

Input for signing:
4ebd366d-76f4-4400-a3b6-e51515d054d6⊠1543597115712⊠9675d0f8-1325-484b-9594-c9d6d3268890⊠⊠da41b3bc-3d0b-4226-b7ea-aee73f94a518⊠⊠GET⊠/main/api/v2/hashpower/orderBook⊠algorithm=X16R&page=0&size=100

Signature is generated via HMAC-SHA256 (input, API_SECRET): 21e6a16f6eb34ac476d59f969f548b47fffe3fea318d9c99e77fc710d2fed798

Add header: X-Auth: API_KEY:SIGNATURE -> 4ebd366d-76f4-4400-a3b6-e51515d054d6:21e6a16f6eb34ac476d59f969f548b47fffe3fea318d9c99e77fc710d2fed798

Do NOT include a plain text API Secret in any of the headers of your request. A novice software developer might mistakenly put an API Secret into the second part of X-Auth header value.

Permissions
VBTD - Wallet / View balances transactions and deposit addresses (VBTD)
WIFU - Withdraw funds (WIFU)
EXOR - Exchange / View exchange orders (EXOR)
VHOR - Hashpower orders / View hashpower orders (VHOR)
WNWA - Wallet / Whitelist new withdrawal address (WNWA)
PRCO - Marketplace / Place, refill and cancel hashpower orders (PRCO)
ELCO - Marketplace / Edit price limit and cancel hashpower orders (ELCO)
VMDS - Mining / View mining data and statistics (VMDS)
MARI - Mining / Manage rigs (MARI)
MAPO - Marketplace / Manage pools (MAPO)

Error format
Response Schema   |   Example
500 (application/json)
{
error_id : string - error id
errors : [
{
code : number - error code
message : string - error message
}
]
}


ENDPOINTS TO USE:

Accounting
Accounting REST API methods

GET/main/api/v2/accounting/account2/{currency}BALANCE 
Get balance for selected currency. When setting extendedResponse to true pending details are added to the response.
Try it out 
Permissions required
VBTD - Wallet / View balances transactions and deposit addresses (VBTD)
Parameters
name	type	description	in	default	options
currency *	string	Currency
path		[ "BTC", "ETH", "XRP", "..." ] example: BTC
extendedResponse	boolean	User will receive extended response if set to true (optional)
query	false	example: true
* - required
Response Schema   |   Example
200 OK (application/json)
{
active : boolean - Active
currency : string - Currency - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
totalBalance : object
available : object
individual : object
debt : object
pending : object
pendingDetails : {
deposit : object
withdrawal : object
exchange : object
hashpowerOrders : object
solo : object
soloRewards : object
couponReservedAmount : object
massBuyReservedAmount : object
}
enabled : boolean - Enabled
btcRate : number - Rate between currency and btc
fiatRate : number - Rate between currency and fiat
status : string - Currency wallet status - ACTIVE, INACTIVE, DELISTED
}

GET/main/api/v2/accounting/hashpowerEarnings/{currency}MINING PAYMENTS 
Get list of mining payments
Try it out 
Permissions required
VBTD - Wallet / View balances transactions and deposit addresses (VBTD)
Parameters
name	type	description	in	default	options
currency *	string	Currency
path		[ "BTC", "ETH", "XRP", "..." ] example: BTC
timestamp	integer	Timestamp in milliseconds since 1.1.1970 (default value is now)
query		example: 255135600000000
page	integer	Page
query	0	example: 0
size	integer	Size (optional, default value is 100, maximum is 100)
query	100	example: 10
* - required
Response Schema   |   Example
200 OK (application/json)
{
list : [
{
id : string - Id of the transaction
created : integer - Transaction creation timestamp in milliseconds since 1.1.1970
currency : {
enumName : string - Name - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
description : string - Translated description
}
amount : number - Transaction amount
metadata : string - Transation metadata
accountType : {
enumName : string - Name - USER, USER_EXCHANGE_PENDING, USER_WITHDRAWAL_PENDING, USER_DEBT, EXCHANGE_FEE, HASHPOWER_ORDERS, HASHPOWER_PAYOUTS, HASHPOWER_ORDER_FEE, HASHPOWER_PAYOUT_FEE, WALLET_BITGO_BLOCKCHAIN, WALLET_BITGO_DEPOSIT_PENDING, WALLET_BITGO_DEPOSIT_CONFIRMED, WALLET_BITGO_DEPOSITS_FEES, WALLET_BITGO_DEPOSIT_CONFISCATED, WALLET_BITGO_DEPOSIT_UNASSIGNED, WALLET_BITGO_WITHDRAWAL_PENDING, WALLET_BITGO_WITHDRAWAL_CONFIRMED, WALLET_BITGO_WITHDRAWALS_FEES, WALLET_COINBASE_BLOCKCHAIN, WALLET_COINBASE_WITHDRAWAL_PENDING, WALLET_COINBASE_WITHDRAWALS_FEES, WALLET_COINBASE_DEPOSIT_PENDING, WALLET_COINBASE_DEPOSIT_CONFIRMED, WALLET_COINBASE_DEPOSIT_UNASSIGNED, WALLET_PAYEER_WITHDRAWAL_PENDING, WALLET_PAYEER_WITHDRAWALS_FEES, TESTING, WALLET_BITGO_WITHDRAWAL_UNASSIGNED, WALLET_KRIPTOMAT_DEPOSIT_UNASSIGNED, WALLET_KRIPTOMAT_DEPOSIT_FEES, WALLET_KRIPTOMAT_WITHDRAWAL_PENDING, WALLET_KRIPTOMAT_WITHDRAWAL_FEES, WALLET_BLOCKCHAIN_DEPOSIT_PENDING, WALLET_BLOCKCHAIN_DEPOSITS_FEES, WALLET_BLOCKCHAIN_DEPOSIT_UNASSIGNED, WALLET_BLOCKCHAIN_WITHDRAWAL_PENDING, WALLET_BLOCKCHAIN_WITHDRAWALS_FEES, WALLET_LIGHTNING_DEPOSIT_UNASSIGNED, WALLET_LIGHTNING_WITHDRAWAL_PENDING, WALLET_LIGHTNING_WITHDRAWALS_FEES, WALLET_LIGHTNING_DEPOSITS_FEES, WALLET_MULTISIG_DEPOSIT_UNASSIGNED, WALLET_MULTISIG_DEPOSITS_FEES, WALLET_MULTISIG_WITHDRAWALS_FEES, TOKEN_WITHDRAWAL_FEE_PENDING, WALLET_MULTISIG_DEPOSIT_FEES, CHARITY, HASHPOWER_ORDERS_PENDING, USER_FEE, USER_MNG_FEE, USER_EX_FEE, WALLET_BITGO_REFUND_UNASSIGNED, WALLET_BLOCKCHAIN_REFUND_UNASSIGNED, WALLET_MULTISIG_REFUND_UNASSIGNED, ADMIN_SERVICE_FEE, MINING_AFFILIATE_FEE, WALLET_FIREBLOCKS_DEPOSITS_FEES, WALLET_FIREBLOCKS_DEPOSIT_UNASSIGNED, WALLET_FIREBLOCKS_WITHDRAWALS_FEES, WALLET_FIREBLOCKS_WITHDRAWAL_UNASSIGNED, WITHHELD, SOLO_REWARD, WALLET_WITHDRAWALS_FEES, WALLET_DEPOSITS_FEES, SOLO_REWARD_FEE, SOLO_REWARD_FEE_GEO, WALLET_FIREBLOCKS_REFUND_UNASSIGNED, EXCHANGE_FEE_UAB, WALLET_DEPOSITS_DEPRECATED_FEES, SOLO_SHARED_RESERVED, COUPON_RESERVED, MERCHANT_FEE, WALLET_NEXPAY_DEPOSIT_UNASSIGNED, WALLET_NEXPAY_DEPOSIT_FEES, WALLET_NEXPAY_WITHDRAWAL_PENDING, WALLET_NEXPAY_WITHDRAWAL_FEES, MASS_BUY_RESERVED, WALLET_MAERKIBAUMAN_DEPOSIT_UNASSIGNED, WALLET_MAERKIBAUMAN_DEPOSIT_FEES, WALLET_MAERKIBAUMAN_WITHDRAWAL_PENDING, WALLET_MAERKIBAUMAN_WITHDRAWAL_FEES, WALLET_NEXPAY_CORPORATE_DEPOSIT_UNASSIGNED, WALLET_NEXPAY_CORPORATE_DEPOSIT_FEES, WALLET_NEXPAY_CORPORATE_WITHDRAWAL_PENDING, WALLET_NEXPAY_CORPORATE_WITHDRAWAL_FEES, INACTIVITY_FEE, INDIVIDUAL_USER, WALLET_LIGHTNING_LTD_WITHDRAWALS_FEES, ENGINE_AIRDROP_RESERVED, BITSTAMP_USER_DEBIT, BITSTAMP_USER_CREDIT
description : string - Translated description
}
feeAmount : number - Fee amount
feeMetadata : string - Fee metadata
}
]
pagination : {
size : integer - Page size
page : integer - Page number (first page is 0)
totalPageCount : integer - Total page count
}
}

Public
Public REST API methods

GET/main/api/v2/mining/algorithmsMINING ALGORITHMS
List the mining algorithms and detailed algorithm information.
Try it out 
Response Schema   |   Example
200 OK (application/json)
{
miningAlgorithms : [
{
algorithm : string - Algorithm - SCRYPT, SHA256, SCRYPTNF, X11, X13, KECCAK, X15, NIST5, NEOSCRYPT, LYRA2RE, WHIRLPOOLX, QUBIT, QUARK, AXIOM, LYRA2REV2, SCRYPTJANENF16, BLAKE256R8, BLAKE256R14, BLAKE256R8VNL, HODL, DAGGERHASHIMOTO, DECRED, CRYPTONIGHT, LBRY, EQUIHASH, PASCAL, X11GOST, SIA, BLAKE2S, SKUNK, CRYPTONIGHTV7, CRYPTONIGHTHEAVY, LYRA2Z, X16R, CRYPTONIGHTV8, SHA256ASICBOOST, ZHASH, BEAM, GRINCUCKAROO29, GRINCUCKATOO31, LYRA2REV3, CRYPTONIGHTR, CUCKOOCYCLE, GRINCUCKAROOD29, BEAMV2, X16RV2, RANDOMXMONERO, EAGLESONG, CUCKAROOM, GRINCUCKATOO32, HANDSHAKE, KAWPOW, CUCKAROO29BFC, BEAMV3, CUCKAROOZ29, OCTOPUS, AUTOLYKOS, ZELHASH, KADENA, ETCHASH, VERUSHASH, KHEAVYHASH, NEXAPOW, IRONFISH, KARLSENHASH, ALEPHIUM, FISHHASH, PYRINHASH, XELISHASHV2, ZKSNARK, FOMA_SHA256ASICBOOST
title : string - Title of the algorithm
enabled : boolean - Is the algorithm Enabled
order : integer - Algorithm order number
displayMiningFactor : string - Unit for mining factor
miningFactor : number - Mining factor
displayMarketFactor : string - Unit for market factor
marketFactor : number - Market factor
minimalOrderAmount : number - Minimal amount in BTC to create order
minSpeedLimit : number - Minimal allowed speed limit
maxSpeedLimit : number - Maximal allowed speed limit
priceDownStep : number - Maximal hashpower order down step
minimalPoolDifficulty : number - Minimal required pool difficulty
port : integer - TCP port for algorithm
color : string - Color in charts for algorithm
ordersEnabled : boolean - Are hashpower orders enabled
enabledMarkets : string - What hashpower markets are available
displayPriceFactor : string - Unit for price factor
priceFactor : number - Price factor
}
]
}
GET/main/api/v2/mining/marketsMINING MARKETS
List all hashpower mining markets.
Try it out 
Response Schema   |   Example
200 OK (application/json)
[
string - EU, USA, EU_N, USA_E, SA, ASIA
]
GET/main/api/v2/public/currenciesCURRENCIES
Get currency list and details for each currency.
Try it out 
Response Schema   |   Example
200 OK (application/json)
{
currencies : [
{
symbol : string - Symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
name : string - Name
transactionInfoUrl : string - Url for transactions
addressInfoUrl : string - Url for addresses
blockInfoUrl : string - Url for block height
wallets : [
string - List of wallet types - BITGO, COINBASE, PAYEER, EXTERNAL, FEES, KRIPTOMAT, BLOCKCHAIN, LIGHTNING, INTERNAL, MULTISIG, FIREBLOCKS, FIREBLOCKS_AG, MINING, NEXPAY, NEXPAY_CORPORATE, MAERKIBAUMAN, LIGHTNING_LTD, FIREBLOCKS_AG_EM
]
order : integer - Currency order number
delisted : boolean - Is Currency delisted
base : string - Base currency - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
params : [
{
key : string
required : boolean
maxLength : integer
startWithZero : boolean
type : string
}
]
subunits : integer - Subunit decimal size
}
]
}
GET/main/api/v2/public/service/fee/infoFEE RULES
Fee rules for whole platforms. Response contains all possible fee rules on the platform.
Try it out 
Response Schema   |   Example
200 OK (*/*)
{
deposit : {
{
rules : {
{
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
}
}
}
withdrawal : {
{
rules : {
{
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
}
}
}
closing_withdrawal : {
{
rules : {
{
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
}
}
}
lightning_address_use_max : {
{
rules : {
{
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
}
}
}
exchangeTaker : {
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
exchangeMaker : {
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
buyingNonRefundableFee : {
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
buyingSpentFee : {
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
sellFee : {
coin : string - Currency symbol - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
intervals : [
{
dynamic : boolean
start : number - Start of the interval
end : number - End of the interval
element : {
value : number - Base fee value
type : string - Base fee type - U, %
sndValue : number - Second fee value
sndType : string - Second fee type - U, %
}
}
]
}
adminServiceFee : {
fees : [
{
task : string
description : string
pricePercent : integer
minPriceUSD : number
useOriginCurrency : boolean
}
]
}
}
GET/api/v2/enum/countriesCOUNTRIES
Get countries info
Try it out 
Response Schema   |   Example
200 OK (application/json)
{
countries : [
{
code : string
name : string
flag : string
dialCode : string
continent : string
}
]
continents : [
{
code : string
name : string
}
]
statesPerCountry : [
{
country : string
states : [
{
code : string
name : string
}
]
}
]
}
GET/api/v2/enum/permissionsPERMISSIONS
Get all possible organization permissions.
Try it out 
Response Schema   |   Example
200 OK (application/json)
{
permissionSettings : [
{
permission : {
type : string - Code - VBTD, WIFU, WNWA, VHOR, PRCO, ELCO, MAPO, EXOR, VITR, VMDS, MARI, VIUS, MAUS, VIPA, MAPA, VPOS, MPOS, VCHE, MCHE, MASE, VISE, UPOS, MPLG, MKPA
title : string - Title
description : string - Description
order : integer - Order (inside group)
group : {
type : string - Permission group type - WALLET_PERMISSION, MARKETPLACE_PERMISSION, EXCHANGE_PERMISSION, MINING_PERMISSION, USER_MANAGEMENT_SECURITY_PERMISSION, PAYMENT_ORDERS_PERMISSION
title : string - Group title
order : integer - Group order number
}
}
enabled : boolean
}
]
}
GET/api/v2/enum/xchCountriesXCH_COUNTRIES
Get all allowed exchange countries
Try it out 
Response Schema   |   Example
200 OK (application/json)
[
string
]
GET/api/v2/system/flagsAPI FLAGS
A list of all API flags and their values. Flag type designates API feature of the platform. Possible values are:
IS_MAINTENANCE - is true when maintenance is in progress
SYSTEM_UNAVAILABLE - is true when whole REST API is not available
DISABLE_REGISTRATION - is true when new registrations are not allowed
IS_KM_MAINTENANCE - is true when EUR/BTC exchange is not available
Try it out 
Response Schema   |   Example
200 OK (application/json)
{
list : [
{
flagName : string - IS_MAINTENANCE, SYSTEM_UNAVAILABLE, DISABLE_REGISTRATION, IS_KM_MAINTENANCE, IS_PERSONAL_KYC_AVAILABLE, IS_BANXA_DISABLED, IS_21ANALYTICS_DISABLED, TEST
flagValue : boolean
}
]
}
GET/api/v2/timeSERVER TIME
Get server time. Can be used for authentication purposes, please check General section with authentication description.
Try it out 
Response Schema   |   Example
200 OK (application/json)
{
serverTime : integer - Time in millis since 1.1.1970 00:00:00 UTC
}

GET/main/api/v2/hashpower/myOrdersMY ORDERS 
Get a list of my hashpower orders matching the filtering criteria as specified by parameters included in the request.
Try it out 
Permissions required
VHOR - Hashpower orders / View hashpower orders (VHOR)
Parameters
name	type	description	in	default	options
algorithm	string	Mining algorithm (optional, if not supplied all algorithms are returned)
query		[ "SCRYPT", "SHA256", "SCRYPTNF", "X11", "X13", "KECCAK", "X15", "NIST5", "NEOSCRYPT", "LYRA2RE", "WHIRLPOOLX", "QUBIT", "QUARK", "AXIOM", "LYRA2REV2", "SCRYPTJANENF16", "BLAKE256R8", "BLAKE256R14", "BLAKE256R8VNL", "HODL", "DAGGERHASHIMOTO", "DECRED", "CRYPTONIGHT", "LBRY", "EQUIHASH", "PASCAL", "X11GOST", "SIA", "BLAKE2S", "SKUNK", "CRYPTONIGHTV7", "CRYPTONIGHTHEAVY", "LYRA2Z", "X16R", "CRYPTONIGHTV8", "SHA256ASICBOOST", "ZHASH", "BEAM", "GRINCUCKAROO29", "GRINCUCKATOO31", "LYRA2REV3", "CRYPTONIGHTR", "CUCKOOCYCLE", "GRINCUCKAROOD29", "BEAMV2", "X16RV2", "RANDOMXMONERO", "EAGLESONG", "CUCKAROOM", "GRINCUCKATOO32", "HANDSHAKE", "KAWPOW", "CUCKAROO29BFC", "BEAMV3", "CUCKAROOZ29", "OCTOPUS", "AUTOLYKOS", "ZELHASH", "KADENA", "ETCHASH", "VERUSHASH", "KHEAVYHASH", "NEXAPOW", "IRONFISH", "KARLSENHASH", "ALEPHIUM", "FISHHASH", "PYRINHASH", "XELISHASHV2", "ZKSNARK", "FOMA_SHA256ASICBOOST" ] example: SHA256
status	string	Order status (optional, if not supplied, all order statuses are returned)
query		[ "PENDING", "ACTIVE", "PENDING_CANCELLATION", "CANCELLED", "DEAD", "EXPIRED", "ERROR", "ERROR_ON_CREATION", "ERROR_ON_CREATION_ON_REVERTING_TRANSACTIONS", "COMPLETED", "ERROR_MISSING" ] example: ACTIVE
active	boolean	Show only active or not active orders (optional, active orders: PENDING, ACTIVE, PENDING_CANCELLATION)
query		example: true
market	string	Filter by market place (optional)
query		[ "EU", "USA", "EU_N", "USA_E", "SA", "ASIA" ] example: EU
type	string	Filter by type (options)
query		[ "STANDARD", "FIXED", "BUSINESS" ] example: STANDARD
ts *	integer	Timestamp to compare
query		example: 255135600000000
op *	string	The order operator to compare timestamp
query		[ "GT", "GE", "LT", "LE" ] example: GT
limit *	integer	Max limit results. Maximum is 1000
query		example: 100
* - required
Response Schema   |   Example
200 OK (application/json)
{
list : [
{
id : string - Order ID
availableAmount : number - Available total amount
payedAmount : number - Amount payed for hashpower
endTs : string - End timestamp in ISO format
updatedTs : string - Order last updated timestamp in ISO format
estimateDurationInSeconds : integer - Estimated duration in seconds
type : {
code : string - Enum code - STANDARD, FIXED, BUSINESS
description : string - Translated enum
}
market : string - Market - EU, USA, EU_N, USA_E, SA, ASIA
algorithm : {
algorithm : string - Algorithm - SCRYPT, SHA256, SCRYPTNF, X11, X13, KECCAK, X15, NIST5, NEOSCRYPT, LYRA2RE, WHIRLPOOLX, QUBIT, QUARK, AXIOM, LYRA2REV2, SCRYPTJANENF16, BLAKE256R8, BLAKE256R14, BLAKE256R8VNL, HODL, DAGGERHASHIMOTO, DECRED, CRYPTONIGHT, LBRY, EQUIHASH, PASCAL, X11GOST, SIA, BLAKE2S, SKUNK, CRYPTONIGHTV7, CRYPTONIGHTHEAVY, LYRA2Z, X16R, CRYPTONIGHTV8, SHA256ASICBOOST, ZHASH, BEAM, GRINCUCKAROO29, GRINCUCKATOO31, LYRA2REV3, CRYPTONIGHTR, CUCKOOCYCLE, GRINCUCKAROOD29, BEAMV2, X16RV2, RANDOMXMONERO, EAGLESONG, CUCKAROOM, GRINCUCKATOO32, HANDSHAKE, KAWPOW, CUCKAROO29BFC, BEAMV3, CUCKAROOZ29, OCTOPUS, AUTOLYKOS, ZELHASH, KADENA, ETCHASH, VERUSHASH, KHEAVYHASH, NEXAPOW, IRONFISH, KARLSENHASH, ALEPHIUM, FISHHASH, PYRINHASH, XELISHASHV2, ZKSNARK, FOMA_SHA256ASICBOOST
title : string - Title of the algorithm
enabled : boolean - Is the algorithm Enabled
order : integer - Algorithm order number
}
status : {
code : string - Order status code - PENDING, ACTIVE, PENDING_CANCELLATION, CANCELLED, DEAD, EXPIRED, ERROR, ERROR_ON_CREATION, ERROR_ON_CREATION_ON_REVERTING_TRANSACTIONS, COMPLETED, ERROR_MISSING
description : string - Translated description of status
}
liquidation : string - Order liquidation
meta : string - Order meta
price : number - Order price in BTC/factor[TH/Sol/G]/day
limit : number - Speed limit [TH/Sol/G]/s
bottomLimit : number - Bottom Speed limit [TH/Sol/G]/s
amount : number - Amount
displayMarketFactor : string - Unit of market factor
marketFactor : number - Market factor
priceFactor : number - Market factor for the algorithm
displayPriceFactor : string - Market unit for the algorithm
alive : boolean - Order is alive
startTs : string - Start timestamp in ISO format
pool : {
id : string - Pool id (When creating new pool this value should not be set.)
name : string - Pool custom name
algorithm : string - Pool algorithm - SCRYPT, SHA256, SCRYPTNF, X11, X13, KECCAK, X15, NIST5, NEOSCRYPT, LYRA2RE, WHIRLPOOLX, QUBIT, QUARK, AXIOM, LYRA2REV2, SCRYPTJANENF16, BLAKE256R8, BLAKE256R14, BLAKE256R8VNL, HODL, DAGGERHASHIMOTO, DECRED, CRYPTONIGHT, LBRY, EQUIHASH, PASCAL, X11GOST, SIA, BLAKE2S, SKUNK, CRYPTONIGHTV7, CRYPTONIGHTHEAVY, LYRA2Z, X16R, CRYPTONIGHTV8, SHA256ASICBOOST, ZHASH, BEAM, GRINCUCKAROO29, GRINCUCKATOO31, LYRA2REV3, CRYPTONIGHTR, CUCKOOCYCLE, GRINCUCKAROOD29, BEAMV2, X16RV2, RANDOMXMONERO, EAGLESONG, CUCKAROOM, GRINCUCKATOO32, HANDSHAKE, KAWPOW, CUCKAROO29BFC, BEAMV3, CUCKAROOZ29, OCTOPUS, AUTOLYKOS, ZELHASH, KADENA, ETCHASH, VERUSHASH, KHEAVYHASH, NEXAPOW, IRONFISH, KARLSENHASH, ALEPHIUM, FISHHASH, PYRINHASH, XELISHASHV2, ZKSNARK, FOMA_SHA256ASICBOOST
stratumHostname : string - Hostname or ip of the pool
stratumPort : integer - Port of the pool
username : string - Username
password : string - Password (Set password to # when using ethproxy pool.)
status : string - Verification status - VERIFIED, NOT_VERIFIED
updatedTs : string
inMoratorium : boolean
}
acceptedCurrentSpeed : number - Current accepted speed [TH/Sol/G]/s
rigsCount : integer - Rigs count
organizationId : string - Organization Id
creatorUserId : string - Creator Id
soloMiningCoin : string - Solo mining coin - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
soloMiningMergeCoin : string - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
soloMiningRewardAddr : string - Solo mining reward address
soloReward : [
{
id : string
orderId : string
coin : string - BTC, EUR, ETH, XRP, BCH, LTC, ZEC, DASH, XLM, EOS, USDT, BSV, LINK, BAT, PAX, ZRX, HOT, OMG, REP, NEXO, BTG, EURKM, ENJ, MATIC, ELF, SNT, BNT, KNC, MTL, POLY, POWR, GTO, LOOM, CVC, AST, PPT, LRC, KEY, STORJ, STORM, TNT, DATA, AOA, RDN, USDC, FET, ANT, AERGO, LBA, XMR, MITH, BAND, SXP, EURS, WBTC, RVN, UNI, AAVE, FTM, YFI, DOGE, ONEINCH, SUSHI, OCEAN, MKR, CRV, CHZ, GRT, GNO, HBAR, ADA, ALGO, XTZ, SAND, SHIB, STX, GALA, SOL, DOT, ETC, TRX, KSM, KAS, USD, TBTC, TEUR, TETH, TXRP, TBCH, TLTC, TZEC, TDASH, TXLM, TEOS, TERC, TBSV, TBTG, TEURKM, TXMR, TRVN, TDOGE, THBAR, TADA, TALGO, TXTZ, TSTX, TTTT, TSOL, TDOT, TETC, TTRX, TMARC, TKAS, TUSD
blockHeight : integer
blockHash : string
tx : string
payoutAddress : string
payoutReward : integer
payoutRewardBtc : number
feeAddress : string
feeReward : integer
time : integer
createdTs : string
depositComplete : boolean
confirmations : integer
minConfirmations : integer
packageId : string
packageName : string
secondsEta : integer
shared : boolean
depositDonated : boolean
}
]
}
]
}

WebSocket Channels
Public, unsigned connections for real-time per algorithm candlesticks.

ws Public Candlestick Streams
Provides public, real-time updates on candlesticks for a specific algorithm and timeframe.
Channel: /tradingview/candlesticks/{algorithm}/{timeframe}
Parameters
name	type	description	in	default	options
algorithm *	string	The mining algorithm (e.g., `KHEAVYHASH`).
path		example:
timeframe *	string	The candlestick resolution (e.g., `15m`, `1h`, `1D`).
path		example:
* - required
Response Schema   |   Example
A stream of `Candlestick` objects.
{
time : integer - Unix timestamp of the candlestick's start time.
open : number - The open price for the period.
high : number - The highest price reached in the period.
low : number - The lowest price reached in the period.
close : number - The last traded price in the period.
totalSpeed : number - The total hashpower speed for the period.
activeOrders : integer - The number of active orders at the end of the period.
payingPrice : number - The paying price at the end of the period.
numberOfRigs : integer - The number of mining rigs connected at the end of the period.
}
ws Public Order Change Streams
Provides public, real-time updates on order events such as creation, cancellations, and speed changes.
Channel: /tradingview/order-changes/{algorithm}/{market}
Parameters
name	type	description	in	default	options
market *	string	The market (e.g., `EU`, `USA`).
path		example:
algorithm *	string	The mining algorithm (e.g., `KHEAVYHASH`).
path		example:
* - required
Response Schema   |   Example
A stream of `OrderEvent` objects, varying based on the event type.
A polymorphic schema representing different types of order events.
Example:
orderCreated: {
  "type": "OrderCreated",
  "orderId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "price": 0.12345678
}
orderCancelled: {
  "type": "OrderCancelled",
  "orderId": "b2c3d4e5-f6a7-8901-2345-67890abcdef1"
}
orderAmountUpdated: {
  "type": "OrderAmountUpdated",
  "orderId": "c3d4e5f6-a7b8-9012-3456-7890abcdef12",
  "newAmount": 500000000000000000
}
orderLimitUpdated: {
  "type": "OrderLimitUpdated",
  "orderId": "d4e5f6a7-b8c9-0123-4567-890abcdef123",
  "newLimit": 0.5
}
orderSpeedUpdated: {
  "type": "OrderSpeedUpdated",
  "list": [
    {
      "orderId": "e5f6a7b8-c9d0-1234-5678-90abcdef1234",
      "price": 0.12345,
      "payingSpeed": 123.456
    }
  ]
}
ws Private Order Change Streams
Provides private, real-time updates on order events for a specific organization via a WebSocket connection.
Channel: /ws-front/websocket
Parameters
name	type	description	in	default	options
o *	string	The unique ID for the organization.
query		example:
* - required
Response Schema   |   Example
A stream of `OrderEvent` objects, varying based on the event type.
A polymorphic schema representing different types of order events.
Example:
orderCreated: {
  "type": "OrderCreated",
  "orderId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "price": 0.12345678
}
orderCancelled: {
  "type": "OrderCancelled",
  "orderId": "b2c3d4e5-f6a7-8901-2345-67890abcdef1"
}
orderAmountUpdated: {
  "type": "OrderAmountUpdated",
  "orderId": "c3d4e5f6-a7b8-9012-3456-7890abcdef12",
  "newAmount": 500000000000000000
}
orderLimitUpdated: {
  "type": "OrderLimitUpdated",
  "orderId": "d4e5f6a7-b8c9-0123-4567-890abcdef123",
  "newLimit": 0.5
}
orderSpeedUpdated: {
  "type": "OrderSpeedUpdated",
  "list": [
    {
      "orderId": "e5f6a7b8-c9d0-1234-5678-90abcdef1234",
      "price": 0.12345,
      "payingSpeed": 123.456
    }
  ]
}

Web Socket Streams for NiceHash

Client
Stomp JS

PRODUCTION environment
wss://ws.nicehash.com/ws-front-public/websocket