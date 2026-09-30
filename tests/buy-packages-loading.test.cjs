const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.CRYPTFOLIO_SOURCE || path.join(__dirname,'../scripts.js'),'utf8').replaceAll('\r\n','\n');
function load(name,ctx){let a=source.indexOf(`function ${name}(`);assert.ok(a>=0,name);if(source.slice(a-6,a)==='async ')a-=6;vm.runInContext(source.slice(a,source.indexOf('\n}',a)+2),ctx);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
 const solo=deferred(),team=deferred(),balance=deferred(),shares=deferred(),prices=deferred();
 const renders=[],states={},calls=[];
 const ctx=vm.createContext({console:{log(){},warn(){},error(){}},window:{},buyPackagesLoadPromise:null,lastValidSoloPackages:null,lastValidTeamPackages:null,
 fetchNiceHashSoloPackages:()=>{calls.push('solo');return solo.promise},fetchNiceHashTeamPackages:()=>{calls.push('team');return team.promise},
 fetchNiceHashBalances:()=>balance.promise,fetchAuthenticatedTeamShares:()=>shares.promise,fetchPackageCryptoPrices:()=>prices.promise,
 renderBuyPackageList:(kind,packages)=>renders.push({kind,packages}),setBuyPackageLoadState:(k,s)=>states[k]=s,
 EasyMiningCurrency:{render(){},metricPackages:()=>[]},checkPackageRecommendations:async()=>[],checkTeamRecommendations:async()=>[],setTimeout(){}});
 for(const n of ['renderBuyPackagesBalance','updateAllBuyButtonStates','capturePackageMetrics','updatePackageMetricsAverages','initMiniHashrateGraphs','startCountdownUpdates','initializeDragScrolling','validateAndFixAutoBuyRobotIcons'])ctx[n]=()=>{};
 load('loadBuyPackagesDataOnPage',ctx);load('refreshBuyPackagesDataOnPage',ctx);
 function extras(){balance.resolve({available:1});shares.resolve();prices.resolve({});}
 return {ctx,solo,team,balance,shares,prices,renders,states,calls,extras};
}
test('cold preload and repeated navigation share requests; team renders while solo/account/prices are pending',async()=>{
 const a=setup();const first=a.ctx.loadBuyPackagesDataOnPage();const second=a.ctx.loadBuyPackagesDataOnPage();assert.equal(first,second);
 assert.deepEqual(a.calls,['solo','team']);assert.equal(a.states.single,'loading');assert.equal(a.states.team,'loading');
 a.team.resolve([{id:'team'}]);await tick();assert.equal(a.renders[0].kind,'team');assert.equal(a.states.team,'ready');assert.equal(a.states.single,'loading');
 a.solo.resolve([{id:'solo'}]);await tick();assert.equal(a.states.single,'ready');assert.equal(a.renders.length,2);
 a.extras();await first;assert.equal(a.ctx.buyPackagesLoadPromise,null);
 await a.ctx.loadBuyPackagesDataOnPage();assert.deepEqual(a.calls,['solo','team','solo','team']);
});
test('failed solo response never suppresses a healthy team response; rejected optional services cannot hide cards',async()=>{
 const a=setup();const run=a.ctx.loadBuyPackagesDataOnPage();a.solo.resolve(null);a.team.resolve([{id:'team'}]);
 a.balance.reject(Error('offline'));a.shares.reject(Error('offline'));await tick();a.prices.reject(Error('offline'));await run;
 assert.equal(a.states.single,'error');assert.equal(a.states.team,'ready');assert.equal(a.renders.at(-1).packages[0].id,'team');
});
test('successful empty catalogues clear previous offers and differ from failures; retry recovers',async()=>{
 const a=setup();a.ctx.lastValidSoloPackages=[{id:'old'}];const run=a.ctx.loadBuyPackagesDataOnPage();
 a.solo.resolve([]);a.team.resolve(null);a.extras();await run;
 assert.equal(a.states.single,'empty');assert.equal(a.states.team,'error');assert.equal(a.ctx.lastValidSoloPackages.length,0);
 assert.ok(a.renders.every(r=>r.packages.length===0));
 a.ctx.fetchNiceHashSoloPackages=async()=>[{id:'recovered'}];a.ctx.fetchNiceHashTeamPackages=async()=>[];
 await a.ctx.loadBuyPackagesDataOnPage();assert.equal(a.states.single,'ready');assert.equal(a.states.team,'empty');
});
test('public retrieval distinguishes a failed team catalogue from a valid empty result and bounds requests',async()=>{
 const ctx=vm.createContext({console:{log(){},warn(){},error(){}},isAutoBuyInProgress:false,USE_VERCEL_PROXY:true,VERCEL_PROXY_ENDPOINT:'/api/nicehash',AbortSignal,
 CloudAccount:{proxyFetch:async(url,opts)=>{assert.ok(opts.signal);return {ok:false,status:503,text:async()=> 'offline'}}},
 document:{getElementById:()=>null},EasyMiningCurrency:{setCatalogue(){}}});
 load('fetchNiceHashSoloPackages',ctx);load('fetchNiceHashTeamPackages',ctx);
 assert.equal(await ctx.fetchNiceHashSoloPackages(),null);assert.equal(await ctx.fetchNiceHashTeamPackages(),null);
 ctx.CloudAccount.proxyFetch=async()=>({ok:true,json:async()=>({list:[]})});assert.equal((await ctx.fetchNiceHashTeamPackages()).length,0);
 ctx.CloudAccount.proxyFetch=async()=>({ok:true,json:async()=>({unexpected:true})});assert.equal(await ctx.fetchNiceHashTeamPackages(),null);
});


test('background polls keep existing BTC cards and authoritative empty results quiet',()=>{
 let cards=false,message=null,appends=0;
 const container={dataset:{},setAttribute(){},querySelector:selector=>selector==='[data-package-id]'?(cards?{}:null):message,
  appendChild:node=>{message=node;appends++}};
 const ctx=vm.createContext({EasyMiningCurrency:{setLoadState(){}},loadBuyPackagesDataOnPage(){},document:{getElementById:()=>container,
  createElement:()=>({dataset:{},setAttribute(){},appendChild(){},remove(){message=null}})}});
 load('setBuyPackageLoadState',ctx);
 ctx.setBuyPackageLoadState('single','loading');assert.equal(message.dataset.catalogueStatus,'loading');
 ctx.setBuyPackageLoadState('single','ready');cards=true;
 const before=appends;for(let n=0;n<5;n++)ctx.setBuyPackageLoadState('single','loading');
 assert.equal(appends,before);assert.equal(message,null);
 cards=false;ctx.setBuyPackageLoadState('single','empty');const empty=message;
 ctx.setBuyPackageLoadState('single','loading');assert.equal(message,empty);
 ctx.setBuyPackageLoadState('single','error');assert.equal(message.dataset.catalogueStatus,'error');
 ctx.setBuyPackageLoadState('single','loading');assert.equal(message.dataset.catalogueStatus,'loading');
});
