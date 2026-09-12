import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const root = resolve('public/vue-ad-editor');
const output = process.env.VUE_EDITOR_EVIDENCE_DIR || '/root/work/adstudio-vue-browser-20260912';
const scene = (height, text) => ({ version: '5.3.0', width: 1080, height, objects: [
  { type: 'rect', id: 'workspace', left: 0, top: 0, originX: 'left', originY: 'top', width: 1080, height, fill: '#fbf7ef', selectable: false, evented: false },
  { type: 'rect', id: 'shape', left: 80, top: 90, originX: 'left', originY: 'top', width: 920, height: 650, fill: '#244c43' },
  { type: 'textbox', id: 'headline', inputKey: 'headline', metadata: { inputKey: 'headline' }, text, left: 80, top: 800, originX: 'left', originY: 'top', width: 920, fontFamily: 'Arial', fontSize: 78, fill: '#244c43' },
  { type: 'textbox', id: 'bounded-copy', text: 'A long template description that must honor its single line limit', left: 80, top: 1050, width: 180, height: 90, fontFamily: 'Arial', fontSize: 32, lineHeight: 1, metadata: { templateTextBox: { width: 180, height: 90, maxLines: 1, overflowBehaviour: 'truncate' } } },
] });
const initial = { feed: scene(1350, 'Template headline'), story: scene(1920, 'Story headline') };
const parent = `<!doctype html><html><head><style>html,body{margin:0;height:100%;font-family:Arial}iframe{border:0;width:100%;height:100%}</style></head><body><iframe id="editor" title="Editor" src="/vue-ad-editor/index.html"></iframe><script>
window.messages=[]; window.initial=${JSON.stringify(initial)};
window.send=(type,payload,requestId)=>document.querySelector('iframe').contentWindow.postMessage({channel:'blockwise.vue-editor',version:1,type,payload,requestId},location.origin);
window.addEventListener('message',event=>{
if(event.origin!==location.origin||event.source!==document.querySelector('iframe').contentWindow)return;
window.messages.push(event.data);
if(event.data.type==='ready')window.send('initialize',{placements:{feed:{width:1080,height:1350,scene:initial.feed},story:{width:1080,height:1920,scene:initial.story}},activePlacement:'feed'});
});</script></body></html>`;
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(parent); return; }
  if (!pathname.startsWith('/vue-ad-editor/')) { res.writeHead(404).end(); return; }
  const path = resolve(root, pathname.slice('/vue-ad-editor/'.length));
  if (!path.startsWith(root + '/')) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Security-Policy', policy); res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.svg':'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const deployment = process.env.VUE_EDITOR_DEPLOYMENT_URL;
const origin = deployment ? new URL(deployment).origin : `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.ADSTUDIO_E2E_CHROMIUM || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], requests = [], blockedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => blockedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
page.on('request', request => { if (!request.url().startsWith(origin) && !/^(data|blob):/.test(request.url())) requests.push(request.url()); });
async function message(type, requestId) {
  await page.waitForFunction(({ type, requestId }) => window.messages.some(message => message.type === type && (!requestId || message.requestId === requestId)), { type, requestId }, { timeout: 30000 });
  return page.evaluate(({ type, requestId }) => window.messages.find(message => message.type === type && (!requestId || message.requestId === requestId)), { type, requestId });
}
try {
  await mkdir(output, { recursive: true });
  // Only the fixture parent is mocked in deployment mode. Editor HTML, JS,
  // CSS and response headers come from the deployed public bundle.
  if (deployment) await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: parent }));
  await page.goto(origin);
  await message('initialized');
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  await page.evaluate(() => window.send('snapshot', undefined, 'first'));
  const first = (await message('snapshot', 'first')).payload;
  for (const placement of ['feed', 'story']) {
    const bounded=first[placement].scene.objects.find(object=>object.id==='bounded-copy');
    assert.ok(bounded.text.endsWith('…'),'declared truncation fits the visible text');
    assert.ok(!bounded.metadata.templateTextBox,'saved user typography has no initial-fit marker');
    assert.equal(bounded.splitByGrapheme,false,'words are not broken into letters');
    assert.equal(first[placement].scene.width, 1080);
    assert.equal(first[placement].scene.height, placement === 'feed' ? 1350 : 1920);
    const png = Buffer.from(first[placement].pngDataUrl.split(',')[1], 'base64');
    const info = await sharp(png).metadata();
    assert.equal(info.width, 1080); assert.equal(info.height, placement === 'feed' ? 1350 : 1920);
    await writeFile(resolve(output, `${placement}.png`), png);
  }
  await page.evaluate(({ feed }) => {
    feed.objects.find(object => object.id === 'headline').text = 'Edited headline';
    feed.objects.find(object => object.id === 'shape').left = 155;
    window.send('load-scene', { placement: 'feed', scene: feed }, 'edit');
  }, { feed: first.feed.scene });
  await message('scene-loaded', 'edit');
  await page.evaluate(() => window.send('snapshot', undefined, 'edited'));
  const edited = (await message('snapshot', 'edited')).payload;
  assert.equal(edited.feed.scene.objects.find(object => object.id === 'headline').text, 'Edited headline');
  assert.equal(edited.feed.scene.objects.find(object => object.id === 'shape').left, 155);
  assert.notEqual(edited.feed.pngDataUrl, first.feed.pngDataUrl);
  assert.equal(edited.story.pngDataUrl, first.story.pngDataUrl);
  // Actual upstream UI interaction must notify the host.
  const frame = page.frameLocator('iframe');
  await frame.getByText('Elements', { exact: true }).click();
  await frame.locator('.tool-box > span').first().click();
  await message('changed');
  await page.evaluate(() => window.send('save', undefined, 'save'));
  await message('saved');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await message('initialized');
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  // The production edge may inject its existing Cloudflare analytics beacon.
  // It is not part of this editor and must remain blocked by the editor CSP.
  const forbidden = requests.filter(url => !(deployment
    && new URL(url).hostname === 'static.cloudflareinsights.com'
    && blockedRequests.some(request => request.url === url && /CSP|csp|blocked/i.test(request.reason || ''))));
  assert.deepEqual(forbidden, []);
  if (requests.length) console.log(JSON.stringify({ edgeScriptsBlocked: blockedRequests.filter(request => requests.includes(request.url)) }));
  console.log(JSON.stringify({ status: 'passed', checks: ['strict CSP', 'no upstream network calls', 'initialize', 'full-sized PNGs', 'scene edit/export roundtrip', 'placement isolation', 'native element insertion', 'host save action', 'desktop/mobile screenshots'], output }));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ errors, requests, blockedRequests, text: await page.locator('body').innerText(), messages: await page.evaluate(() => (window.messages || []).map(({ type, payload }) => ({ type, error: payload?.message }))) }));
  throw error;
} finally {
  await context.close(); await browser.close(); server.close();
}
