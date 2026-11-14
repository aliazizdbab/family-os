import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PUBLIC_DIR = path.resolve('public');
const TOOLS_DIR = path.resolve('tools');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    let relPath = decodeURIComponent(reqUrl.pathname);
    if (relPath === '/') relPath = '/index.html';

    let resolved = null;
    if (relPath.startsWith('/tools/')) {
      const toolFile = path.join(TOOLS_DIR, relPath.slice('/tools/'.length));
      if (
        toolFile.startsWith(TOOLS_DIR) &&
        fs.existsSync(toolFile) &&
        fs.statSync(toolFile).isFile()
      ) {
        resolved = toolFile;
      }
    }
    if (!resolved) {
      const fullPath = path.join(PUBLIC_DIR, relPath);
      resolved =
        fullPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()
          ? fullPath
          : path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(resolved).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const hasChrome = fs.existsSync(CHROME_PATH);

test(
  'Phase 0 PWA shell works at 360px, escapes XSS share_target, imports offline, and reloads offline',
  { skip: !hasChrome },
  async (t) => {
    const { server, baseUrl } = await startStaticServer();
    const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

    t.after(async () => {
      await browser.close();
      server.close();
    });

    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
      locale: 'ar',
    });
    const page = await context.newPage();

    const errors = [];
    let offlinePhase = false;
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        if (offlinePhase && txt.includes('ERR_INTERNET_DISCONNECTED')) {
          return;
        }
        errors.push(`console.error: ${txt}`);
      }
    });

    // 1. Load share_target URL with XSS payload and verify RTL + 360px layout + escaping
    const xssPayload = '<img src=x onerror="window.__xss=1"> حليب وخبز';
    await page.goto(`${baseUrl}/?text=${encodeURIComponent(xssPayload)}`, { waitUntil: 'load' });

    const layout = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].filter(
        (b) => b.offsetParent !== null
      );
      const minTouchHeight = Math.min(...buttons.map((b) => b.getBoundingClientRect().height));
      return {
        dir: document.documentElement.dir,
        lang: document.documentElement.lang,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        minTouchHeight,
        xssTriggered: Boolean(window.__xss),
        intentText: document.getElementById('intent-banner')?.textContent || '',
      };
    });

    assert.equal(layout.dir, 'rtl');
    assert.equal(layout.lang, 'ar');
    assert.ok(
      layout.scrollWidth <= layout.innerWidth,
      `Horizontal overflow: ${layout.scrollWidth} > ${layout.innerWidth}`
    );
    assert.ok(layout.minTouchHeight >= 44, `Touch target too small: ${layout.minTouchHeight}`);
    assert.equal(layout.xssTriggered, false);
    assert.ok(layout.intentText.includes('حليب وخبز'));

    // 2. Wait for Service Worker to register and take control (clients.claim)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 3000);
        });
      }
    });

    // 2b. Verify Firebase connection probe button works in Home tab
    await page.click('#probe-firebase-btn');
    await page.waitForFunction(
      () => document.getElementById('fb-probe-badge')?.textContent !== 'بانتظار الفحص',
      { timeout: 10000 }
    );
    const probeBadge = await page.textContent('#fb-probe-badge');
    assert.ok(probeBadge === 'متصل وجاهز' || probeBadge === 'تنبيه اتصال');

    // 3. Open Import tab, run Dry-Run, then save to IndexedDB
    await page.click('button[data-tab="import"]');
    const sampleJson = JSON.stringify({
      t: 1794600000000,
      budget: 320,
      cats: [{ id: 'super', i: '🏪', n: 'السوبرماركت' }],
      members: [{ id: 'm1', name: 'الأب', icon: '🛡️', admin: true, salt: 's', hash: 'h' }],
      items: [
        { id: 'i1', n: 'حليب', q: '2', p: 10, c: 'super', u: true, by: 'الأب', dn: 0 },
        {
          id: 'i2',
          n: 'أرز',
          q: '5',
          p: 25,
          c: 'super',
          u: false,
          by: 'الأب',
          dn: 1,
          dnBy: 'الأب',
        },
        { id: 'i3', n: 'سكر', q: '1', p: 8, c: 'super', u: false, by: 'الأب', dn: 0 },
      ],
      log: [{ w: 'الأب', a: 'أضاف', n: 'حليب', t: 'الآن' }],
    });

    await page.fill('#legacy-json', sampleJson);
    await page.click('#dry-run-btn');
    const dryText = await page.textContent('#view-root');
    assert.ok(dryText.includes('الأغراض: 3 (جديد: 3 / متخطّى: 0)'));

    await page.click('#apply-import-btn');
    await page.waitForTimeout(200);

    // 4. Go offline and reload from Service Worker cache!
    offlinePhase = true;
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#view-root');

    const offlineState = await page.evaluate(() => ({
      netPill: document.getElementById('net-pill')?.textContent || '',
      bodyText: document.getElementById('view-root')?.textContent || '',
    }));

    assert.ok(offlineState.netPill.includes('دون إنترنت'));
    assert.ok(offlineState.bodyText.includes('الأغراض المحلية: 3'));
    assert.ok(offlineState.bodyText.includes('الميزانية: 320 د.ل'));

    // 5. Re-run Dry-Run offline -> must be idempotent (new = 0, skipped = 3)
    await page.click('button[data-tab="import"]');
    await page.fill('#legacy-json', sampleJson);
    await page.click('#dry-run-btn');
    const secondDryText = await page.textContent('#view-root');
    assert.ok(secondDryText.includes('الأغراض: 3 (جديد: 0 / متخطّى: 3)'));
    assert.equal(await page.isDisabled('#apply-import-btn'), true);

    assert.deepEqual(errors, []);
  }
);

test(
  'tools/export-legacy.html reads fl_shared and downloads sanitized JSON without PIN hashes or AI secrets',
  { skip: !hasChrome },
  async (t) => {
    const { server, baseUrl } = await startStaticServer();
    const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

    t.after(async () => {
      await browser.close();
      server.close();
    });

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${baseUrl}/tools/export-legacy.html`, { waitUntil: 'load' });
    await page.evaluate(() => {
      window.localStorage.setItem(
        'fl_shared',
        JSON.stringify({
          budget: 500,
          cats: [{ id: 'super', i: '🏪', n: 'السوبرماركت' }],
          members: [
            {
              id: 'm1',
              name: 'الأب',
              icon: '🛡️',
              admin: true,
              salt: 'SECRET_SALT',
              hash: 'SECRET_HASH',
            },
          ],
          items: [{ id: 'it1', n: 'خبز', q: '4', p: 3, c: 'super', u: false, by: 'الأب', dn: 0 }],
          log: [{ w: 'الأب', a: 'أضاف', n: 'خبز', t: 'الآن' }],
        })
      );
      window.localStorage.setItem(
        'fl_local',
        JSON.stringify({ ai: { ps: [{ key: 'AI_SECRET' }] } })
      );
    });

    await page.click('#btn-local');
    const previewText = await page.textContent('#preview');
    assert.ok(previewText.includes('الأغراض: 1'));

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl')]);
    const dlStream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of dlStream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    assert.equal(exported.JSON ? false : true, true);
    assert.equal(exported.budget, 500);
    assert.equal(exported.items.length, 1);
    assert.equal('salt' in exported.members[0], false);
    assert.equal('hash' in exported.members[0], false);
    assert.equal(JSON.stringify(exported).includes('SECRET_'), false);
    assert.equal(JSON.stringify(exported).includes('AI_SECRET'), false);
    assert.deepEqual(errors, []);
  }
);

test(
  'Phase 2 Shopping v2 E2E: add item, inline price edit without losing focus, mark done with Undo snackbar, and Store Mode defer',
  { skip: !hasChrome },
  async (t) => {
    const { server, baseUrl } = await startStaticServer();
    const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

    t.after(async () => {
      await browser.close();
      server.close();
    });

    const context = await browser.newContext({
      viewport: { width: 360, height: 780 },
      locale: 'ar',
    });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(`console.error: ${msg.text()}`);
      }
    });

    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await page.waitForSelector('#add-item-n');

    // 1. Add item "قهوة عربية" and verify visible labels
    await page.fill('#add-item-n', 'قهوة عربية');
    await page.fill('#add-item-q', '500 جم');
    await page.fill('#add-item-p', '35');
    await page.click('#add-item-btn');

    await page.waitForSelector('[data-item-row]');
    const listText = await page.textContent('#view-root');
    assert.ok(listText.includes('قهوة عربية'));
    assert.ok(listText.includes('📦 الكمية / العدد'));
    assert.ok(listText.includes('💰 السعر التقديري (د.ل)'));

    // 2. Inline price update preserves input focus and updates header totals
    const priceInput = page.locator('[data-inline-p]').first();
    await priceInput.focus();
    await priceInput.fill('45');
    const isStillFocused = await priceInput.evaluate((el) => document.activeElement === el);
    assert.equal(isStillFocused, true, 'Inline price input must keep focus while typing');
    const headerTotals = await page.textContent('#header-totals');
    assert.ok(headerTotals.includes('المقدر: 45 د.ل'));

    // 2b. Add a brand-new item not in the default catalog to test auto-learning into Store
    await page.fill('#add-item-n', 'شمع إشعال سيارة أصلي');
    await page.fill('#add-item-q', '4 حبات');
    await page.fill('#add-item-p', '65');
    await page.selectOption('#add-item-c', 'car');
    await page.click('#add-item-btn');
    await page.waitForFunction(() => document.body.textContent.includes('شمع إشعال سيارة أصلي'), {
      timeout: 5000,
    });

    // 3. Store Mode: catalog browsing, auto-learned badge, add from catalog, AI suggestions, and quick defer/undefer
    await page.click('button[data-tab="store"]');
    await page.waitForSelector('#store-catalog-header');
    const storeCatalogText = await page.textContent('#view-root');
    assert.ok(storeCatalogText.includes('تغيير زيت محرك السيارة'));
    assert.ok(storeCatalogText.includes('ملمع ومنظف الأثاث والأخشاب'));
    assert.ok(storeCatalogText.includes('شمع إشعال سيارة أصلي'));
    assert.ok(storeCatalogText.includes('مضاف تلقائياً'));

    // Check 360px layout + 44px touch targets in Store tab too
    const storeLayout = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].filter(
        (b) => b.offsetParent !== null
      );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        minTouchHeight: Math.min(...buttons.map((b) => b.getBoundingClientRect().height)),
      };
    });
    assert.ok(
      storeLayout.scrollWidth <= storeLayout.innerWidth,
      `Store tab overflow: ${storeLayout.scrollWidth} > ${storeLayout.innerWidth}`
    );
    assert.ok(
      storeLayout.minTouchHeight >= 44,
      `Store tab touch target too small: ${storeLayout.minTouchHeight}`
    );

    // Click AI suggestions toggle and verify AI suggestion appears
    await page.click('#ai-suggest-store-btn');
    await page.waitForSelector('#ai-store-suggestions-card');

    // Add an item from Store Catalog to Cart
    await page.click('[data-catalog-add="ملمع ومنظف الأثاث والأخشاب"]');
    await page.waitForSelector('[data-store-defer]');

    await page.click('[data-store-defer]');
    await page.waitForSelector('[data-store-undefer]');
    const storeTextAfterDefer = await page.textContent('#view-root');
    assert.ok(storeTextAfterDefer.includes('غير متوفر في المتجر حالياً'));
    await page.click('[data-store-undefer]');
    await page.waitForSelector('[data-store-check]');

    // 4. Back to Cart (home) tab: mark item done -> moves to collapsed completed section + shows Undo snackbar
    await page.click('button[data-tab="home"]');
    await page.waitForSelector('[data-item-toggle]');
    await page.click('[data-item-toggle]');
    await page.waitForSelector('#completed-items-card');
    const undoBtnVisible = await page.isVisible('#undo-snackbar-btn');
    assert.equal(undoBtnVisible, true, 'Undo snackbar button must appear after marking item done');
    const doneSectionText = await page.textContent('#completed-items-card');
    assert.ok(doneSectionText.includes('المنجزة (1)'));

    // Click Undo -> restores item to remaining list
    await page.click('#undo-snackbar-btn');
    await page.waitForSelector('[data-item-claim]');

    // Verify catalog-added item is in the Cart
    const finalCartText = await page.textContent('#view-root');
    assert.ok(finalCartText.includes('ملمع ومنظف الأثاث والأخشاب'));

    assert.deepEqual(errors, []);
  }
);
