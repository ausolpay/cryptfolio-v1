/* NiceHash wallet pages. Network choices, addresses and fees come from the live API. */
const MiningWallet = (() => {
    let page = null, revision = 0, submitting = false;
    const currency = () => appStorage.getItem(`${loggedInUser}_miningWalletCurrency`) === 'USDT' ? 'USDT' : 'BTC';
    const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    function select(value) {
        appStorage.setItem(`${loggedInUser}_miningWalletCurrency`, value === 'USDT' ? 'USDT' : 'BTC');
        renderBalance(); EasyMiningCurrency.render();
        fetchNiceHashBalances().then(renderBalance).catch(() => renderBalance());
    }
    function renderBalance() {
        if (typeof loggedInUser === 'undefined' || !loggedInUser) return;
        const coin = currency(), balance = window.niceHashCurrencyBalances?.[coin];
        const rate = getBuyPackagePrice(coin);
        const picker = document.getElementById('easymining-wallet-currency'); if (picker) picker.value = coin;
        for (const kind of ['available', 'pending']) {
            const amount = balance?.[kind];
            const value = document.getElementById(`easymining-${kind}-btc`);
            const local = document.getElementById(`easymining-${kind}-aud`);
            if (value) value.textContent = Number.isFinite(amount) ? `${amount.toFixed(coin === 'BTC' ? 8 : 6)} ${coin}` : `— ${coin}`;
            if (local) local.textContent = Number.isFinite(amount) && rate > 0 ? new Intl.NumberFormat(undefined, {style: 'currency', currency: getCoinGeckoCurrency().toUpperCase()}).format(amount * rate) : 'Unavailable';
            const buyItem = document.querySelector(`#buy-packages-balance-section .balance-card-item.${kind}`);
            if (buyItem) {
                buyItem.querySelector('.balance-card-btc').textContent = value?.textContent || `— ${coin}`;
                buyItem.querySelector('.balance-card-value').textContent = local?.textContent || 'Unavailable';
            }
        }
        const card = document.getElementById('easymining-balance-card');
        const color = !Number.isFinite(balance?.available) ? '#64748b' : balance.available >= (coin === 'BTC' ? .0001 : 1) ? '#4CAF50' : '#f44336';
        if (card) card.style.borderLeftColor = card.style.borderRightColor = color;
        const buyCard = document.querySelector('#buy-packages-balance-section .easymining-balance-card');
        if (buyCard) buyCard.style.borderLeftColor = buyCard.style.borderRightColor = color;
    }
    function close() { revision++; page?.remove(); page = null; }
    const field = (panel, title, control) => { const label=el('label',title); label.append(control); panel.append(label); return control; };
    async function open(action) {
        close(); const token = revision;
        page = el('div', null, 'container'); page.id = `usdt-${action}-page`;
        page.style.cssText='position:fixed;inset:0;z-index:9000;background:var(--bg-color,#141922);overflow:auto;width:100%;max-width:none;box-sizing:border-box;padding:35px 16px';
        const panel=el('section',null,'mining-wallet-panel'); page.append(panel); document.body.append(page);
        const back=el('button','← Back to EasyMining','settings-back-btn'); back.onclick=close; panel.append(back);
        panel.append(el('h1',action==='deposit'?'Deposit USDT':'Withdraw USDT'));
        const balanceLabel=el('p','Fetching your USDT balance…'); panel.append(balanceLabel);
        const status=el('p','Loading supported networks…'); status.setAttribute('role','status'); panel.append(status);
        const networks=field(panel,'Network',el('select')); networks.disabled=true;
        const contents=el('div'); panel.append(contents);
        const manage=el('a','Manage wallets and Travel Rule details on NiceHash'); manage.href='https://www.nicehash.com/my/wallets'; manage.target='_blank'; manage.rel='noopener noreferrer'; panel.append(manage);
        try {
            const [data] = await Promise.all([EasyMiningCurrency.request('/main/api/v2/public/currencies'), fetchNiceHashBalances()]);
            if (token!==revision) return;
            const available=window.niceHashCurrencyBalances?.USDT?.available;
            balanceLabel.textContent=Number.isFinite(available)?`Available: ${available.toFixed(6)} USDT`:'USDT balance unavailable';
            const config=data.currencies?.find(item=>item.symbol==='USDT'&&!item.delisted);
            networks.append(new Option('Choose a network…',''));
            for(const network of config?.networks||[]) networks.append(new Option(network.name || network.network,network.network));
            if(networks.options.length<2) throw new Error('No supported USDT networks are available.');
            networks.disabled=false; status.textContent='Use the same network at both ends of the transfer.';
            let networkRevision=0;
            networks.onchange=async()=>{
                const sequence=++networkRevision; contents.replaceChildren(); status.textContent='';
                if(!networks.value)return;
                const network=networks.value, current=()=>token===revision&&sequence===networkRevision;
                status.textContent='Loading wallet details…';
                try {
                    if(action==='deposit') {
                        const data=await EasyMiningCurrency.request(`/main/api/v2/accounting/depositAddresses?currency=USDT&network=${encodeURIComponent(network)}`);
                        if(!current())return;
                        const addresses=(data.list||[]).filter(a=>a.currency==='USDT'&&a.network===network&&a.address);
                        if(!addresses.length)throw new Error('No USDT deposit address returned for this network. Open NiceHash to activate it.');
                        for(const a of addresses){
                            const address=field(contents,`Your USDT address · ${networks.selectedOptions[0].text}`,el('textarea')); address.readOnly=true;address.value=a.address;
                            const copy=el('button','Copy address','settings-action-btn'); copy.onclick=()=>navigator.clipboard.writeText(a.address).then(()=>status.textContent='Address copied.').catch(()=>status.textContent='Select the address above to copy it.');contents.append(copy);
                            if(a.travelAddress){const travel=field(contents,'Travel address',el('textarea'));travel.readOnly=true;travel.value=a.travelAddress;}
                        }
                        status.textContent='Send USDT only, using the selected network. Complete any required Travel Rule details in NiceHash.';
                    } else {
                        const data=await EasyMiningCurrency.request(`/main/api/v2/accounting/withdrawalAddresses?currency=USDT&network=${encodeURIComponent(network)}&size=100`);
                        if(!current())return;
                        const addresses=(data.list||[]).filter(a=>a.currency==='USDT'&&a.network===network&&a.status?.code==='ACTIVE'&&!a.inMoratorium);
                        if(!addresses.length)throw new Error('No active USDT withdrawal addresses for this network. Add and verify one on NiceHash first.');
                        const address=field(contents,'Saved withdrawal address',el('select'));address.append(new Option('Choose an address…',''));
                        addresses.forEach(a=>address.append(new Option(`${a.name || 'Wallet'} · ${a.address}`,a.id)));
                        const amount=field(contents,'Amount (USDT)',el('input'));amount.type='number';amount.min='0.000001';amount.step='0.000001';
                        const note=field(contents,'Note (optional)',el('input'));note.maxLength=200;
                        const fee=el('p','Choose an address and amount to check the current fee.');contents.append(fee);
                        const submit=el('button','Review withdrawal','settings-action-btn');submit.disabled=true;contents.append(submit);
                        let quote=null, quoteRevision=0;
                        const preview=async()=>{
                            const q=++quoteRevision;quote=null;submit.disabled=true;
                            const a=addresses.find(a=>a.id===address.value),value=Number(amount.value);
                            if(!a||!(value>0)||!Number.isFinite(value))return;
                            try {
                                const fees=await EasyMiningCurrency.request('/main/api/v2/public/service/fee/info');
                                if(!current()||q!==quoteRevision)return;
                                quote=EasyMiningModel.withdrawalQuote(fees,a,value);
                                fee.textContent=`Fee: ${quote.fee} USDT · Total debited: ${quote.total} USDT`;
                                submit.disabled=false;
                            }catch(error){if(current()&&q===quoteRevision)fee.textContent=error.message;}
                        };
                        address.onchange=preview;amount.onchange=preview;amount.oninput=()=>{quoteRevision++;quote=null;submit.disabled=true;fee.textContent='Finish entering the amount to refresh the fee.';};
                        submit.onclick=async()=>{
                            if(submitting||!quote)return;
                            submitting=true;submit.disabled=true;networks.disabled=true;address.disabled=true;amount.disabled=true;note.disabled=true;
                            try {
                                await CloudAccount.runAutomation(async()=>{
                                    await syncNiceHashTime();
                                    const a=await EasyMiningCurrency.request(`/main/api/v2/accounting/withdrawalAddress/${encodeURIComponent(address.value)}`);
                                    if(a.id!==address.value||a.currency!=='USDT'||a.network!==network||a.status?.code!=='ACTIVE'||a.inMoratorium)throw new Error('The withdrawal address is no longer available.');
                                    const fees=await EasyMiningCurrency.request('/main/api/v2/public/service/fee/info');
                                    const checked=EasyMiningModel.withdrawalQuote(fees,a,Number(amount.value));
                                    await fetchNiceHashBalances();
                                    const balance=window.niceHashCurrencyBalances?.USDT?.available;
                                    if(!Number.isFinite(balance)||checked.total>balance)throw new Error('Insufficient USDT for the amount and fee.');
                                    if(!current())return;
                                    if(!confirm(`Withdraw ${amount.value} USDT\nNetwork: ${network}\nTo: ${a.address}\nFee: ${checked.fee} USDT\nTotal debit: ${checked.total} USDT\n\nConfirm withdrawal?`)){status.textContent='Withdrawal cancelled.';return;}
                                    const result=await EasyMiningCurrency.request('/main/api/v2/accounting/withdrawal','POST',{currency:'USDT',network,amount:Number(amount.value),withdrawalAddressId:a.id,walletType:a.type.code,userNote:note.value});
                                    if(!result.id)throw new Error('Withdrawal outcome unconfirmed. Check NiceHash before trying again.');
                                    appStorage.setItem(`${loggedInUser}_withdrawal_${result.id}`,JSON.stringify({id:result.id,currency:'USDT',amount:Number(amount.value),network,at:Date.now()}));
                                    await CloudAccount.flush();amount.value='';quote=null;
                                    status.textContent=`Withdrawal requested. Reference: ${result.id}`;
                                },true);
                            }catch(error){status.textContent=error.message;}
                            finally{submitting=false;networks.disabled=false;address.disabled=false;amount.disabled=false;note.disabled=false;submit.disabled=!quote;}
                        };
                        status.textContent='Choose a verified address. You will review the network, address, amount and fee before submitting.';
                    }
                }catch(error){if(current())status.textContent=error.message;}
            };
        } catch(error){if(token===revision)status.textContent=error.message;}
    }
    window.addEventListener('cloud-data-loaded',renderBalance);
    return { currency,select,renderBalance,open,close };
})();
