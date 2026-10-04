const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function worker() {
  let listener;
  const storage = {};
  const events = () => ({addListener(){},removeListener(){}});
  const chrome = {
    runtime: {id:'test', getURL:p=>'chrome-extension://test/'+p, onMessage:{addListener:f=>listener=f}, sendMessage:async()=>{}},
    storage: {local:{get:async()=>storage,set:async data=>Object.assign(storage,data)}},
    tabs: {onUpdated:events(),onRemoved:events(),onCreated:events()},
  };
  const context = vm.createContext({chrome,console:{log(){}},setTimeout,clearTimeout,URL,AbortController});
  const run = code => vm.runInContext(code,context);
  run(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'));
  const message = (action,extra={}) => new Promise(resolve=>listener({action,...extra},{id:'test',url:'chrome-extension://test/popup.html'},resolve));
  return {run,message,chrome,storage};
}

test('Stop acknowledges idle controls before an outstanding operation settles', async()=>{
  const w=worker();
  w.run('doQuests = async run => { await new Promise(resolve => { globalThis.releaseOld = resolve; }); return false; }');
  await w.message('START_QUEST');
  const stopped=await w.message('STOP');
  assert.equal(stopped.state.isRunning,false);
  assert.equal(stopped.state.phase,'stopped');
  assert.equal(stopped.state.statusText,'Stopped');
  w.run('releaseOld()');
});

test('new run starts immediately and late old success cannot finish or mutate it', async()=>{
  const w=worker();
  w.run(`let attempts=0; doQuests=async run=>{
    if (++attempts===1) {await new Promise(resolve=>{globalThis.releaseOld=resolve;}); update({current:99,statusText:'stale'},run);return false;}
    update({phase:'quests',current:1,total:3,statusText:'New run'},run);
    await new Promise(resolve=>{globalThis.releaseNew=resolve;}); return false;
  }`);
  await w.message('START_QUEST');
  await w.message('STOP');
  assert.equal((await w.message('START_QUEST')).ok,true);
  w.run('releaseOld()');
  await new Promise(resolve=>setTimeout(resolve,5));
  const current=await w.message('GET_STATUS');
  assert.equal(current.isRunning,true);
  assert.equal(current.current,1);
  assert.equal(current.statusText,'New run');
  await w.message('STOP');
  w.run('releaseNew()');
});

test('late old rejection cannot replace a new run error/status', async()=>{
  const w=worker();
  w.run(`let attempts=0; doQuests=async run=>{
    if (++attempts===1) {await new Promise((resolve,reject)=>{globalThis.rejectOld=reject;});}
    update({statusText:'New run'},run);await new Promise(resolve=>{globalThis.releaseNew=resolve;});
  }`);
  await w.message('START_QUEST');await w.message('STOP');
  assert.equal((await w.message('START_QUEST')).ok,true);
  w.run("rejectOld(new Error('TAB_CLOSED'))");
  await new Promise(resolve=>setTimeout(resolve,5));
  const current=await w.message('GET_STATUS');
  assert.equal(current.isRunning,true);
  assert.equal(current.statusText,'New run');
  await w.message('STOP');w.run('releaseNew()');
});

test('Stop during a pending tab creation never navigates or closes that late tab', async()=>{
  const w=worker();
  let releaseCreate;
  let navigations=0, removals=0;
  w.chrome.tabs.create=()=>new Promise(resolve=>{releaseCreate=resolve;});
  w.chrome.tabs.update=async()=>{navigations++;};
  w.chrome.tabs.remove=async()=>{removals++;};
  const config={desktopSearches:2,minDelay:1,maxDelay:1};
  await w.message('START_DESKTOP',{config});
  await w.message('STOP');
  w.run("doQuests=async run=>{update({statusText:'Replacement'},run);await new Promise(resolve=>{globalThis.releaseNew=resolve;});}");
  await w.message('START_QUEST');
  releaseCreate({id:42});
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(navigations,0);
  assert.equal(removals,0);
  assert.equal((await w.message('GET_STATUS')).statusText,'Replacement');
  await w.message('STOP');w.run('releaseNew()');
});

test('Stop cancels long search delay immediately and never removes the old search tab', async()=>{
  const w=worker();
  let navigations=0,removals=0;
  w.chrome.tabs.create=async()=>({id:42});
  w.chrome.tabs.get=(id,cb)=>cb({status:'complete'});
  w.chrome.tabs.update=async()=>{navigations++;};
  w.chrome.tabs.remove=async()=>{removals++;};
  w.run("generateQuery=()=> 'ordinary query'");
  await w.message('START_DESKTOP',{config:{desktopSearches:2,minDelay:3600,maxDelay:3600}});
  for(let tries=0;tries<20 && navigations===0;tries++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(navigations,1);
  const oldRun=w.run('activeRun');
  assert.ok(oldRun.stopWaiters.size>0);
  await w.message('STOP');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(oldRun.stopWaiters.size,0);
  assert.equal(navigations,1);
  assert.equal(removals,0);
  assert.equal((await w.message('GET_STATUS')).isRunning,false);
});

test('an old click permit cannot be revived by starting a new run', async()=>{
  const w=worker();
  await w.run('stateReady');
  w.run(`resetState(); globalThis.oldRun=activeRun;
    questUiPermits.set('late',{tabId:7,documentId:'doc',expiresAt:Date.now()+10000,run:oldRun});`);
  await w.message('STOP');
  w.run('resetState()');
  const sender="({id:'test',tab:{id:7},documentId:'doc',url:'https://www.bing.com/rewards/panelflyout'})";
  assert.equal(w.run(`grantQuestUiPermit({nonce:'late'},${sender})`).ok,false);
  w.run(`questUiPermits.set('late',{tabId:7,documentId:'doc',expiresAt:Date.now()+10000,run:oldRun})`);
  assert.equal(w.run(`grantQuestUiPermit({nonce:'late'},${sender})`).error,'STOPPED');
  await w.message('STOP');
});

test('Stop acknowledgement does not wait for a blocked storage write', async()=>{
  const w=worker();
  await w.run('stateReady');
  w.run('resetState()');
  await new Promise(resolve=>setTimeout(resolve,1));
  let releaseStorage;
  w.chrome.storage.local.set=()=>new Promise(resolve=>{releaseStorage=resolve;});
  w.run("update({statusText:'Working'},activeRun)");
  await new Promise(resolve=>setTimeout(resolve,1));
  const response=await Promise.race([w.message('STOP'),new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
  assert.ok(response,'Stop must not wait for storage persistence');
  assert.equal(response.state.isRunning,false);
  w.chrome.storage.local.set=async data=>Object.assign(w.storage,data);
  releaseStorage();
  await w.run('persistenceQueue');
  assert.equal(w.storage.engineState.isRunning,false);
});

test('ordinary search uses the configured count and does not inject simulated reading or clicks', async()=>{
  const w=worker();
  const navigations=[];
  let injections=0;
  w.chrome.tabs.create=async()=>({id:42});
  w.chrome.tabs.get=(id,cb)=>cb({status:'complete'});
  w.chrome.tabs.update=async(id,update)=>{navigations.push(update.url);};
  w.chrome.tabs.remove=async()=>{};
  w.chrome.scripting={executeScript:async()=>{injections++;return [];}};
  w.run("generateQuery=()=> 'ordinary query'");
  await w.run("runEngine('START_DESKTOP',{desktopSearches:1,minDelay:1,maxDelay:1})");
  assert.equal(navigations.length,1);
  assert.equal(injections,0);
  assert.equal((await w.message('GET_STATUS')).phase,'complete');
});
