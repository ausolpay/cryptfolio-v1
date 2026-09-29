const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../easymining-model.js');
const catalogue=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'nicehash-catalogue-live.json'),'utf8').replace(/^\uFEFF/,''));
test('current live catalogue includes Bronze, USDT Solo and USDT Team with separate rule names',()=>{
 const active=catalogue.solo.filter(t=>t.available&&t.status==='A');
 assert.equal(active.filter(t=>t.currencyMarket==='USDT').length,6);
 assert.ok(active.some(t=>t.name==='Bronze S'));assert.ok(!active.some(t=>t.name==='Chromium S'));
 for(const raw of [...active,...catalogue.team]){
   const t=raw.currencyAlgoTicket||raw;
   const name=model.alertName(raw);
   if(t.currencyMarket==='BTC')assert.equal(name,t.name);else assert.match(name,/USDT/);
   const p=model.payment(raw,{BTC:100000,USDT:1.5});assert.ok(p.amount>0);
   if(raw.currencyAlgoTicket&&t.currencyMarket==='USDT')assert.equal(p.shareAmount,1);
 }
});
test('small package threshold selects the cheapest matching currency and reward family',()=>{
 const solos=[{name:'Gold S',mainCrypto:'BTC',priceBTC:.0001},{name:'Gold 20 USDT',mainCrypto:'BTC',paymentCurrency:'USDT',paymentAmount:20},{name:'Gold 5 USDT',mainCrypto:'BTC',paymentCurrency:'USDT',paymentAmount:5}];
 assert.equal(model.smallPackage({name:'Team Gold USDT',mainCrypto:'BTC',paymentCurrency:'USDT'},solos).name,'Gold 5 USDT');
 assert.equal(model.smallPackage({name:'Team Gold',mainCrypto:'BTC'},solos).name,'Gold S');
});
test('USDT automation requires explicit enablement, available ticket, cooldown and unbought pool',()=>{
 const raw=catalogue.team.find(p=>p.currencyAlgoTicket.currencyMarket==='USDT');const now=Date.now();
 assert.equal(model.automationReady(raw,{},now),false);
 assert.equal(model.automationReady(raw,{enabled:true},now),true);
 assert.equal(model.automationReady(raw,{enabled:true,lastPoolId:raw.id},now),false);
 assert.equal(model.automationReady(raw,{enabled:true,lastBuyTime:now-1000},now),false);
 assert.equal(model.automationReady({...raw,state:'CLOSED'},{enabled:true},now),false);
 assert.equal(model.automationReady(catalogue.team[0],{enabled:true},now),false);
});
test('withdrawal fees use wallet, network and USDT rules, rejecting unknown or invalid amounts',()=>{
 const address={currency:'USDT',network:'SOL',type:{code:'FIREBLOCKS_AG'}};
 const fees={withdrawal:{FIREBLOCKS_AG:{rules:{SOL:[{coin:'USDT',intervals:[{start:10,element:{value:0,type:'PERCENTAGE',sndValue:1,sndType:'ABSOLUTE'}}]}]}}}};
 assert.deepEqual(model.withdrawalQuote(fees,address,20),{fee:1,total:21});
 for(const value of [0,-1,9,Infinity,10.0000001]) assert.throws(()=>model.withdrawalQuote(fees,address,value));
 assert.throws(()=>model.withdrawalQuote(fees,{...address,network:'ETH'},20));
});
const source=fs.readFileSync(require('node:path').join(__dirname,'../scripts.js'),'utf8').replaceAll('\r\n','\n');
function load(name,ctx){let a=source.indexOf(`function ${name}(`);if(source.slice(a-6,a)==='async ')a-=6;const b=source.indexOf('\n}',a)+2;vm.runInContext(source.slice(a,b),ctx);}
test('averages never invent data on failed catalogues and still capture a successful team response',async()=>{
 let captured=[];const ctx=vm.createContext({console:{log(){},warn(){}},setTimeout:fn=>fn(),SNAPSHOT_QUEUE_DELAY_MS:0,fetchNiceHashSoloPackages:async()=>null,fetchNiceHashTeamPackages:async()=>[{name:'Team Gold USDT'}],capturePackageMetrics:p=>captured=p,updateAveragesDisplay(){}});
 load('fetchAndUpdateAverages',ctx);await ctx.fetchAndUpdateAverages();assert.equal(captured.length,1);assert.equal(captured[0].name,'Team Gold USDT');
 ctx.fetchNiceHashTeamPackages=async()=>null;captured=[];await ctx.fetchAndUpdateAverages();assert.equal(captured.length,0);
});
test('average probability and prices exclude missing observations instead of treating them as zero',()=>{
 const history={Gold:{snapshots:[{hashrateRaw:2,probabilityRaw:100,priceBTC:.001,priceAUD:100},{hashrateRaw:0,probabilityRaw:0,priceBTC:0,priceAUD:0}]}};
 const ctx=vm.createContext({getPackageMetricsHistory:()=>history,savePackageMetricsHistory(){}});load('updatePackageMetricsAverages',ctx);ctx.updatePackageMetricsAverages();
 assert.equal(history.Gold.averages.probability,100);assert.equal(history.Gold.averages.hashrate,2);assert.equal(history.Gold.averages.priceBTC,.001);
});
test('saving decimal Solo thresholds preserves unavailable-package rules',()=>{
 const records={u_soloPackageAlerts:JSON.stringify({'Chromium S':40,'Gold 5 USDT':25})};
 const ctx=vm.createContext({loggedInUser:'u',console:{log(){}},document:{querySelectorAll:()=>[{id:'alert-Gold-5-USDT',value:'24.5'}]},appStorage:{getItem:k=>records[k],setItem:(k,v)=>records[k]=v},alert(){},loadSoloAlerts(){},alertedSoloPackages:new Set(),updateRecommendations(){}});
 load('saveSoloAlerts',ctx);ctx.saveSoloAlerts();assert.deepEqual(JSON.parse(records.u_soloPackageAlerts),{'Chromium S':40,'Gold 5 USDT':24.5});
});
test('average hashrate reads current Team speed and supports Bronze solution units',()=>{
 const ctx=vm.createContext({});load('parseHashrate',ctx);load('formatHashrateForAverages',ctx);
 assert.equal(ctx.parseHashrate('2 / 100 TH/s'),2);
 assert.ok(Math.abs(ctx.parseHashrate('50 MSol/s')-.00005)<1e-12);
 assert.equal(ctx.formatHashrateForAverages(.00005,'EQUIHASH'),'50.00 MSol/s');
});
