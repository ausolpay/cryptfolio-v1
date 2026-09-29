const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const model=require('../easymining-model.js');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'nicehash-catalogue-live.json'),'utf8').replace(/^\uFEFF/,''));
function harness(kind='single',balance=1000){
 const raw=structuredClone((kind==='single'?fixture.solo:fixture.team).find(x=>(x.currencyAlgoTicket||x).currencyMarket==='USDT'));
 if(kind==='team'){raw.members=[{organizationId:'org',addedAmount:2}];raw.addedAmount=20;raw.fullAmount=100;}
 const name=model.alertName(raw),key=`u_${kind==='single'?'solo':'team'}AutoBuy`;
 const records={[key]:JSON.stringify({[name]:{enabled:true,shares:3}})},calls=[];
 const ctx={EasyMiningModel:model,loggedInUser:'u',easyMiningSettings:{enabled:true,apiKey:'test',orgId:'org'},
 appStorage:{getItem:k=>records[k]??null,setItem:(k,v)=>records[k]=v},document:{getElementById:()=>null},window:{addEventListener(){},niceHashCurrencyBalances:{USDT:{available:balance,fetchedAt:Date.now()},BTC:{available:100000,fetchedAt:Date.now()}}},
 TeamProbability:{setCatalogue(){}},getBuyPackagePrice:c=>c==='BTC'?100000:1.5,getPackageDisplayUnit:()=> 'TH',formatProbability:p=>'1:'+p,
 canUserAccess:()=>true,checkPackageRecommendations:async p=>p,checkTeamRecommendations:async p=>p,
 syncNiceHashTime:async()=>{},generateNiceHashAuthHeaders:()=>({}),VERCEL_PROXY_ENDPOINT:'/api/nicehash',
 getWithdrawalAddress:()=> 'address',fetchNiceHashBalances:async()=>{},setPendingShares(){},saveMyTeamShares(){},
 console:{log(){},error(){}},CloudAccount:{flush:async()=>{},runAutomation:async fn=>fn(),proxyFetch:async(url,options)=>{
 const p=JSON.parse(options.body);calls.push(p);return{ok:true,json:async()=>p.method==='POST'?{id:'order'}:kind==='single'?[raw]:{list:[raw]}};
 }}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../easymining-currency.js'),'utf8')+'\nglobalThis.currency=EasyMiningCurrency;',ctx);
 ctx.currency.setCatalogue(kind,[raw]);return{ctx,raw,records,key,name,calls};
}
test('USDT Solo sends explicit payment currency and persists cooldown before a repeat poll',async()=>{
 const h=harness();await h.ctx.currency.runAlerts();await h.ctx.currency.runAlerts();const posts=h.calls.filter(x=>x.method==='POST');
 assert.equal(posts.length,1);assert.equal(posts[0].body.buyWithCurrency,'USDT');assert.ok(JSON.parse(h.records[h.key])[h.name].lastBuyTime);
});
test('USDT Team adds configured shares to authenticated membership using native share units',async()=>{
 const h=harness('team');await h.ctx.currency.runAlerts();await h.ctx.currency.runAlerts();const posts=h.calls.filter(x=>x.method==='POST');
 assert.equal(posts.length,1);assert.equal(posts[0].body.amount,5);assert.equal(posts[0].body.shares.small,5);assert.ok(posts[0].endpoint.endsWith(h.raw.id));
});
test('large BTC balance never funds a USDT auto-buy',async()=>{
 const h=harness('single',0);await h.ctx.currency.runAlerts();assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('live unavailable ticket and disabled rule prevent automatic purchasing',async()=>{
 for(const reason of ['unavailable','disabled']){const h=harness();if(reason==='unavailable')h.raw.available=false;else h.records[h.key]=JSON.stringify({[h.name]:{enabled:false}});await h.ctx.currency.runAlerts();assert.equal(h.calls.filter(x=>x.method==='POST').length,0);}
});
test('missing authenticated team membership cannot authorize a buy',async()=>{
 const h=harness('team');delete h.raw.members;await h.ctx.currency.runAlerts();assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('alert rules changing during the fresh request stop the purchase',async()=>{
 const h=harness();let checks=0;h.ctx.checkPackageRecommendations=async p=>++checks===1?p:[];await h.ctx.currency.runAlerts();assert.equal(h.calls.filter(x=>x.method==='POST').length,0);
});
test('the existing auto-shares queue purchases USDT shares in native units and waits for verification',async()=>{
 const raw=structuredClone(fixture.team.find(p=>p.currencyAlgoTicket.currencyMarket==='USDT'));
 raw.members=[{organizationId:'org',addedAmount:2}];raw.addedAmount=20;raw.fullAmount=100;raw.numberOfParticipants=6;
 const name=model.alertName(raw),records={u_teamAutoShares:JSON.stringify({[name]:{enabled:true,percentage:50,primaryShares:2,secondaryShares:1}}),u_easyMiningSettings:JSON.stringify({enabled:true,apiKey:'test',orgId:'org'})};const calls=[];
 const ctx={EasyMiningModel:model,loggedInUser:'u',authenticatedTeamShares:{[raw.id]:2},autoSharesQueue:[],autoSharesCurrentPackage:null,isAutoSharesInProgress:false,
 appStorage:{getItem:k=>records[k]??null,setItem:(k,v)=>records[k]=v},console:{log(){},warn(){},error(...args){throw Error(args.join(' '));}},
 syncNiceHashTime:async()=>{},EasyMiningCurrency:{request:async()=>({list:[raw]})},getWithdrawalAddress:()=> 'address',
 fetchNiceHashBalances:async()=>{},window:{niceHashCurrencyBalances:{USDT:{available:50}}},shouldPauseAutoBuyForTgSafeHold:()=>{throw Error('BTC hold checked for USDT');},
 generateNiceHashAuthHeaders:()=>({}),USE_VERCEL_PROXY:true,VERCEL_PROXY_ENDPOINT:'/api/nicehash',CloudAccount:{proxyFetch:async(url,options)=>{calls.push(JSON.parse(options.body));return{ok:true,json:async()=>({id:'order'})};}},
 setPendingShares(){},saveMyTeamShares(){},syncTeamShareInputs(){},cleanupOnAlertAutoShares(){},AppNotifications:{add:async()=>{}}};
 vm.createContext(ctx);const source=fs.readFileSync(path.join(__dirname,'../scripts.js'),'utf8').replaceAll('\r\n','\n');const a=source.indexOf('async function executeAutoSharesTeam(');vm.runInContext(source.slice(a,source.indexOf('\n}',a)+2),ctx);
 const packages=[{name,paymentCurrency:'USDT',crypto:'BCH',mainCrypto:'BCH',numberOfParticipants:6,addedAmount:20,fullAmount:100,apiData:raw}];
 await ctx.executeAutoSharesTeam(packages);await ctx.executeAutoSharesTeam(packages);
 assert.equal(calls.length,1);assert.equal(calls[0].body.amount,4);assert.equal(calls[0].body.shares.small,4);
 assert.equal(JSON.parse(records.u_teamAutoShares)[name].trackedPackageIds[raw.id].pendingVerification,true);
});
