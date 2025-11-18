// NEW SIMPLIFIED fetchNiceHashOrders using the solo/order endpoint
// This function replaces the complex old version

async function fetchNiceHashOrders() {
    console.log(`\n${'#'.repeat(80)}`);
    console.log(`📡📡📡 FETCHNICEHASHORDERS - Using Solo Mining Endpoint 📡📡📡`);
    console.log(`${'#'.repeat(80)}\n`);

    try {
        // Use the solo/order endpoint which gives us packages with proper names and rewards
        const timestamp = Date.now() + nicehashTimeOffset;
        const endpoint = `/main/api/v2/hashpower/solo/order?rewardsOnly=true&limit=1000`;
        const headers = generateNiceHashAuthHeaders('GET', endpoint);

        console.log('📡 Fetching solo mining packages from NiceHash...');
        console.log('📋 Endpoint:', endpoint);

        let response;

        if (USE_VERCEL_PROXY) {
            response = await fetch(VERCEL_PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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

        console.log('Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`\n${'='.repeat(80)}`);
        console.log('📦 SOLO MINING API RESPONSE');
        console.log(`${'='.repeat(80)}`);

        // The solo/order endpoint returns an array directly
        const orders = Array.isArray(data) ? data : (data.list || []);
        console.log(`📋 Found ${orders.length} solo mining packages`);

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

            // Calculate block rewards from soloReward array
            const soloRewards = order.soloReward || [];
            let totalRewardBTC = 0;
            let confirmedBlockCount = 0;
            let pendingBlockCount = 0;

            soloRewards.forEach((reward, idx) => {
                const btcReward = parseFloat(reward.payoutRewardBtc || 0);
                const isConfirmed = reward.depositComplete === true;

                if (btcReward > 0) {
                    totalRewardBTC += btcReward;
                    if (isConfirmed) {
                        confirmedBlockCount++;
                        console.log(`   ✅ Block #${idx + 1}: ${btcReward.toFixed(8)} BTC (Confirmed)`);
                    } else {
                        pendingBlockCount++;
                        console.log(`   ⏳ Block #${idx + 1}: ${btcReward.toFixed(8)} BTC (Pending ${reward.confirmations || 0}/${reward.minConfirmations || 0})`);
                    }
                }
            });

            const totalBlocks = confirmedBlockCount + pendingBlockCount;
            const blockFound = totalBlocks > 0;

            if (blockFound) {
                console.log(`   🎉 TOTAL: ${totalBlocks} blocks, ${totalRewardBTC.toFixed(8)} BTC`);
            } else {
                console.log(`   ❌ No blocks found yet`);
            }

            // Get block reward for this coin
            const blockReward = getBlockReward(order.soloMiningCoin);

            // Calculate crypto reward (blocks × block reward)
            const cryptoReward = totalBlocks > 0 ? blockReward * totalBlocks : 0;

            // Calculate price spent (use packagePrice or amount field)
            const priceSpent = parseFloat(order.packagePrice || order.amount || 0);

            // Determine algorithm info
            const algorithmCode = order.algorithm?.algorithm || order.algorithm;
            const algoInfo = getAlgorithmInfo(algorithmCode, order.pool);

            // Create package object
            const pkg = {
                id: order.id,
                name: order.packageName || `${order.soloMiningCoin} Package`, // Use packageName from API!
                crypto: order.soloMiningCoin, // Direct from API
                cryptoSecondary: order.soloMiningMergeCoin, // For dual mining
                miningType: `${order.soloMiningCoin} Mining`,
                reward: cryptoReward, // Crypto amount (e.g., 2500 RVN, 3.125 BTC)
                btcEarnings: totalRewardBTC, // Total BTC from all blocks
                btcPending: 0, // Could calculate from pending blocks if needed
                confirmedBlocks: confirmedBlockCount,
                pendingBlocks: pendingBlockCount,
                totalBlocks: totalBlocks,
                algorithm: algorithmCode,
                algorithmName: algoInfo.name,
                hashrate: `${order.limit || '0'} ${order.displayMarketFactor || 'TH'}`,
                timeRemaining: calculateTimeRemaining(order.endTs),
                progress: calculateProgress(order.startTs, order.endTs),
                blockFound: blockFound,
                isTeam: order.type?.code === 'TEAM',
                price: priceSpent,
                active: order.alive,
                status: order.alive ? 'active' : 'completed',
                startTime: order.startTs,
                endTime: order.endTs,
                marketFactor: order.displayMarketFactor,
                poolName: order.pool?.name || 'Solo Mining',
                packageSort: order.packageSort || 0, // For ordering packages
                packageDuration: order.packageDuration || 0,
                fullOrderData: order
            };

            console.log(`   ✅ Package created: ${pkg.name} - ${pkg.miningType}`);
            console.log(`      Blocks: ${pkg.totalBlocks}, Reward: ${pkg.reward} ${pkg.crypto}, BTC: ${pkg.btcEarnings.toFixed(8)}`);

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
