// Real toolbar-popup sizing regression. A tab with a preset viewport hides
// Chromium's intrinsic popup sizing loop, so open the action popup itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'quest-popup-layout-')), {
    executablePath: process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, ignoreDefaultArgs: ['--disable-extensions'],
    viewport: {width: 1280, height: 900},
    args: ['--window-size=1280,1000', `--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const browserSession = await context.browser().newBrowserCDPSession();
    const output = path.join(root, '.qa');
    fs.mkdirSync(output, { recursive: true });
    let sequence = 0;
    const call = (sessionId, method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const onMessage = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== id) return;
        clearTimeout(timer);
        browserSession.off('Target.receivedMessageFromTarget', onMessage);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      const timer = setTimeout(() => {
        browserSession.off('Target.receivedMessageFromTarget', onMessage);
        reject(new Error('Popup CDP reply timeout'));
      }, 10000);
      browserSession.on('Target.receivedMessageFromTarget', onMessage);
      browserSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        .catch(error => { clearTimeout(timer); browserSession.off('Target.receivedMessageFromTarget', onMessage); reject(error); });
    });
    for (const scenario of [
      { name: 'en-light', lang: 'en', theme: 'light', settings: false },
      { name: 'vi-light', lang: 'vi', theme: 'light', settings: false },
      { name: 'vi-light-idle', lang: 'vi', theme: 'light', settings: false, idle: true },
      { name: 'vi-light-auto-all', lang: 'vi', theme: 'light', settings: false, autoAllSkipped: true },
      { name: 'vi-dark', lang: 'vi', theme: 'dark', settings: false },
      { name: 'vi-dark-settings', lang: 'vi', theme: 'dark', settings: true }
    ]) {
      await worker.evaluate(async ({ lang, theme, idle, autoAllSkipped }) => {
        await stateReady;
        await chrome.storage.local.set({ lang, theme });
        update(idle ? { phase:'idle',isRunning:false,manualQuestCount:0,skippedQuestCount:0,current:0,total:0,statusText:'Ready' }
          : { phase: 'complete', isRunning: false, manualQuestCount: 0, skippedQuestCount: autoAllSkipped ? 3 : 1, current: 2, total: 2,
          statusText: 'Run finished; some Quest activities were skipped, not credited.' });
        await chrome.action.openPopup();
      }, scenario);
      const targets = (await browserSession.send('Target.getTargets')).targetInfos;
      const target = targets.find(item => item.type === 'page' && item.url === worker.url().replace('/background.js', '/popup.html'));
      assert.ok(target, 'The real action popup must exist');
      const { sessionId } = await browserSession.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
      const evaluate = async expression => {
        const reply = await call(sessionId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
        return reply.result.value;
      };
      // Wait for hydration and layout to settle, rather than assuming openPopup
      // includes asynchronous storage/language rendering.
      const ready = scenario.idle ? `document.querySelector('#statusBadge')?.textContent==='SẴN SÀNG'` : `document.querySelector('#manualQuestNotice')?.textContent`;
      await evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+5000;function check(){if(${ready} && document.documentElement.lang==='${scenario.lang}') requestAnimationFrame(()=>requestAnimationFrame(resolve));else if(Date.now()>end)reject(new Error('Popup hydration timed out'));else setTimeout(check,25);}check();})`);
      if (scenario.settings) await evaluate(`document.querySelector('#btnSettings').click(); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const metrics = await evaluate(`(() => {
        const rect = id => { const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}; };
        const lum = color => { const rgb=color.match(/\\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722; };
        const contrast = (id, background) => {const s=getComputedStyle(document.getElementById(id));const a=lum(s.color), b=lum(background||s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
        const card=getComputedStyle(document.querySelector('.card')).backgroundColor;
        return { viewport:innerWidth, html:document.documentElement.getBoundingClientRect().width,
          body:document.body.getBoundingClientRect().width, scroll:document.documentElement.scrollWidth,
          height:innerHeight, title:document.querySelector('h1').getBoundingClientRect().height,
          badge:rect('statusBadge'), count:rect('progressText'), settings:rect('btnSettings'),
          inputs:['desktopSearches','minDelay','maxDelay'].map(rect), footer:document.querySelector('footer').getBoundingClientRect().bottom,
          contrast:{ action:contrast('btnAll'), secondary:contrast('btnQuest'), notice:contrast('manualQuestNotice'), label:contrast('lblDesktopCount',card), badge:contrast('statusBadge',card) } };
      })()`);
      assert.equal(metrics.body, 420, `Real popup width collapsed: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.viewport >= 420 && metrics.viewport <= 435, 'Viewport includes at most the native scrollbar gutter');
      assert.ok(metrics.scroll <= metrics.viewport, 'No horizontal overflow');
      assert.ok(metrics.title <= 27, 'Brand must fit on one line');
      assert.ok(metrics.count.height <= 24, 'Progress count must not wrap');
      assert.ok(metrics.badge.right < metrics.count.left, 'Status/count must not overlap');
      assert.ok(metrics.inputs.every(input => input.width >= 90), 'Search inputs must remain usable');
      assert.ok(Object.values(metrics.contrast).every(ratio=>ratio>=4.5), 'Enabled text must retain 4.5:1 contrast in both themes');
      assert.ok(metrics.height <= 600, 'Native popup must fit browser height limit');
      if (!scenario.settings) assert.ok(metrics.footer <= metrics.height, `All controls and footer must fit the real viewport: ${JSON.stringify(metrics)}`);
      const screenshot = await call(sessionId, 'Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(output, `native-popup-${scenario.name}.png`), Buffer.from(screenshot.data, 'base64'));
      if (scenario.settings) {
        assert.ok(await evaluate(`(() => { document.querySelector('footer').scrollIntoView({block:'end'});const r=document.querySelector('footer').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight; })()`), 'Expanded settings must allow scrolling to the footer');
        await evaluate(`document.querySelector('#btnCloseSettings').click(); window.scrollTo(0,0)`);
        assert.equal(await evaluate(`document.querySelector('#btnSettings').getAttribute('aria-expanded')`), 'false');
      }
      // Long diagnostic text must wrap and remain reachable, rather than being
      // hidden by the handoff notice or widening the native popup.
      await evaluate(`document.querySelector('#statusTextRow').classList.remove('hidden');document.querySelector('#statusText').textContent='QUEST_CARD_NOT_READY: '+ 'DiagnosticToken'.repeat(12);`);
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), 'Long error tokens must not cause horizontal overflow');
      assert.ok(await evaluate(`(() => { document.querySelector('#statusText').scrollIntoView({block:'center'});const r=document.querySelector('#statusText').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight; })()`), 'Error text must remain readable by scrolling');
      console.log('PASS real popup ' + scenario.name + ': ' + JSON.stringify(metrics));
      await evaluate('window.close()');
    }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
