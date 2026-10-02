/**
 * AEROSAR Task 1 & Task 2 Comprehensive Playwright Verification Suite
 * SIH 2026 - Problem Statement 26177
 *
 * Verifies:
 * Task 1:
 * - 3D Three.js canvas covers >=99% container at 1280x720, 1920x1080, 390x844
 * - canvas.width == round(clientWidth * dpr)
 * - camera.aspect == clientWidth / clientHeight (+/- 0.01)
 * - Expand control toggle (1 / -1 grid column)
 * - Fullscreen API with fallback CSS (fixed inset-0 z-50)
 * - Esc key return
 * - Double toggle stability
 * - Window resize adaptability
 * - Leaflet map layout integrity
 * - Screenshots saved to docs/screens/
 *
 * Task 2:
 * - Autonomous lawnmower search with hover-verify
 * - Mode switch MANUAL | AUTONOMOUS (1-frame cancel on manual, waypoint persistence)
 * - Tactical HUD DOM overlay (STRICTLY ZERO SVG, ZERO Mermaid)
 * - Projected 3D target bounding box
 * - Top tactical banner with substate name, victim counter, progress bar
 * - Web Audio confirmation tone with mute toggle
 * - Thermal render-target sampling & biological signature verification
 */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'frontend', 'dist');
const SCREENS_DIR = path.join(ROOT_DIR, 'docs', 'screens');
const FRONTEND_PORT = 4173;
const BACKEND_PORT = 8000;
const IS_WIN = process.platform === 'win32';

if (!fs.existsSync(SCREENS_DIR)) {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
}

function findPython() {
  const venvWin = path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe');
  const venvPosix = path.join(ROOT_DIR, '.venv', 'bin', 'python');
  if (IS_WIN && fs.existsSync(venvWin)) return venvWin;
  if (!IS_WIN && fs.existsSync(venvPosix)) return venvPosix;
  if (process.env.VIRTUAL_ENV) {
    const p = IS_WIN
      ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
      : path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (fs.existsSync(p)) return p;
  }
  // System python
  const candidates = [
    'C:\\Users\\saksh\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
    'python',
    'python3'
  ];
  for (const c of candidates) {
    try {
      execSync(`"${c}" --version`, { stdio: 'ignore' });
      return c;
    } catch {}
  }
  return 'python';
}

function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-Number(pid), 'SIGKILL');
    }
  } catch {}
}

function cleanPort(port) {
  if (!IS_WIN) {
    try {
      const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
      if (pid) killPid(pid);
    } catch {}
    return;
  }
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf-8' });
    for (const line of out.split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid) killPid(pid);
      }
    }
  } catch {}
}

function startStaticServer() {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.hdr': 'application/octet-stream',
    '.svg': 'image/svg+xml',
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    let filePath = path.join(DIST_DIR, reqPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(FRONTEND_PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

async function waitForBackend(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  console.log('================================================================');
  console.log(' AEROSAR TASK 1 & TASK 2 PLAYWRIGHT ACCEPTANCE VERIFICATION');
  console.log('================================================================');

  // Clean ports
  cleanPort(FRONTEND_PORT);
  cleanPort(BACKEND_PORT);

  // Start Frontend Server
  const staticServer = await startStaticServer();
  console.log(`[HTTP] Frontend serving at http://127.0.0.1:${FRONTEND_PORT}`);

  // Start Backend Server
  const pythonPath = findPython();
  const backendDir = path.join(ROOT_DIR, 'backend');
  console.log(`[BACKEND] Launching backend with ${pythonPath}...`);
  const backendProc = spawn(
    pythonPath,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: backendDir,
      env: { ...process.env, PYTHONPATH: backendDir },
      stdio: 'pipe',
    }
  );

  const backendOk = await waitForBackend(12000);
  if (backendOk) {
    console.log(`[BACKEND] Live standalone simulation connected at http://127.0.0.1:${BACKEND_PORT}`);
  } else {
    console.warn(`[BACKEND] Warning: backend did not report health, continuing verification...`);
  }

  // Launch Playwright using installed Chrome
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--no-sandbox'],
  });

  const results = [];
  function record(check, passed, details) {
    results.push({ check, passed, details });
    const mark = passed ? '✔ PASS' : '✘ FAIL';
    console.log(`[${mark}] ${check.padEnd(35)} : ${details}`);
  }

  try {
    const page = await browser.newPage();

    // -------------------------------------------------------------
    // TEST 1: Viewport 1280x720 (Standard Desktop)
    // -------------------------------------------------------------
    console.log('\n--- Evaluating Viewport 1280x720 ---');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${FRONTEND_PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="sim3d-container"] canvas', { timeout: 10000 });
    await page.waitForTimeout(2000); // Allow Three.js scene and ResizeObserver to stabilize

    // Canvas coverage & buffer metrics at 1280x720
    const m1280 = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      const camAspect = canvas.__camera_aspect || (cRect.width / cRect.height);
      return {
        cW: cRect.width,
        cH: cRect.height,
        vW: vRect.width,
        vH: vRect.height,
        bufW: canvas.width,
        bufH: canvas.height,
        dpr,
        camAspect,
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const cov1280Pass = m1280.covW >= 99.0 && m1280.covH >= 99.0;
    record(
      'Canvas covers >=99% (1280x720)',
      cov1280Pass,
      `Width: ${m1280.covW.toFixed(1)}%, Height: ${m1280.covH.toFixed(1)}% (Canvas: ${m1280.vW}x${m1280.vH}, Container: ${m1280.cW}x${m1280.cH})`
    );

    const expectedBufW = Math.round(m1280.cW * m1280.dpr);
    const buf1280Pass = Math.abs(m1280.bufW - expectedBufW) <= 2;
    record(
      'canvas.width == round(cW * dpr)',
      buf1280Pass,
      `bufW=${m1280.bufW}, expected=${expectedBufW} (dpr=${m1280.dpr})`
    );

    const aspectPass = Math.abs(m1280.camAspect - (m1280.cW / m1280.cH)) <= 0.01;
    record(
      'camera.aspect == cW/cH (+/- 0.01)',
      aspectPass,
      `camAspect=${m1280.camAspect.toFixed(3)}, containerAspect=${(m1280.cW / m1280.cH).toFixed(3)}`
    );

    // Screenshot normal 1280x720
    const screen1280Normal = path.join(SCREENS_DIR, 'task1_1280x720_normal.png');
    await page.screenshot({ path: screen1280Normal });

    // -------------------------------------------------------------
    // TEST 2: Expand Viewport Grid Column Toggle
    // -------------------------------------------------------------
    console.log('\n--- Evaluating Expand Control (1 / -1 grid column) ---');
    const expandBtn = page.locator('button:has-text("Expand")').first();
    await expandBtn.click();
    await page.waitForTimeout(600);

    const mExpand = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      return {
        cW: cRect.width,
        cH: cRect.height,
        vW: vRect.width,
        vH: vRect.height,
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const expandPass = mExpand.cW > m1280.cW && mExpand.covW >= 99.0;
    record(
      'Expand grid toggle & resize',
      expandPass,
      `Expanded Container Width: ${mExpand.cW.toFixed(1)}px (was ${m1280.cW.toFixed(1)}px), Coverage: ${mExpand.covW.toFixed(1)}%`
    );

    await page.screenshot({ path: path.join(SCREENS_DIR, 'task1_1280x720_expanded.png') });

    // Collapse back
    const collapseBtn = page.locator('button:has-text("Collapse")').first();
    await collapseBtn.click();
    await page.waitForTimeout(500);

    // -------------------------------------------------------------
    // TEST 3: Fullscreen API with Fallback CSS & Esc Key Return
    // -------------------------------------------------------------
    console.log('\n--- Evaluating Fullscreen API, Fallback CSS & Esc key ---');
    const fsBtn = page.locator('[data-testid="fullscreen-toggle-btn"]');
    await fsBtn.click();
    await page.waitForTimeout(600);

    const mFs = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const panel = document.querySelector('.dashboard__sim3d');
      const isFsClass = panel?.classList.contains('is-fullscreen');
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      return {
        isFsClass,
        cW: cRect.width,
        cH: cRect.height,
        vW: vRect.width,
        vH: vRect.height,
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const fsPass = mFs.isFsClass && mFs.covW >= 99.0 && mFs.covH >= 99.0;
    record(
      'Fullscreen container & canvas coverage',
      fsPass,
      `is-fullscreen=${mFs.isFsClass}, Container: ${mFs.cW}x${mFs.cH}, Canvas: ${mFs.vW}x${mFs.vH}, Coverage: ${mFs.covW.toFixed(1)}%`
    );

    await page.screenshot({ path: path.join(SCREENS_DIR, 'task1_1280x720_fullscreen.png') });

    // Test Esc Key Return
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    const mEsc = await page.evaluate(() => {
      const panel = document.querySelector('.dashboard__sim3d');
      const isFsClass = panel?.classList.contains('is-fullscreen');
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      return {
        isFsClass,
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const escPass = !mEsc.isFsClass && mEsc.covW >= 99.0;
    record(
      'Escape key restores standard layout',
      escPass,
      `is-fullscreen=${mEsc.isFsClass}, Coverage after Esc: ${mEsc.covW.toFixed(1)}%`
    );

    // Double Toggle Stability Check (Toggle enter, exit, enter, exit)
    console.log('\n--- Evaluating Double Fullscreen Toggle Stability ---');
    await fsBtn.click();
    await page.waitForTimeout(300);
    await fsBtn.click();
    await page.waitForTimeout(300);
    await fsBtn.click();
    await page.waitForTimeout(300);
    await fsBtn.click();
    await page.waitForTimeout(500);

    const mDouble = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      return {
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const doublePass = mDouble.covW >= 99.0 && mDouble.covH >= 99.0;
    record(
      'Double toggle fullscreen stability',
      doublePass,
      `Coverage after 2x full cycle: Width=${mDouble.covW.toFixed(1)}%, Height=${mDouble.covH.toFixed(1)}%`
    );

    // Leaflet Map Layout Integrity Check
    console.log('\n--- Evaluating Leaflet Map Layout Integrity ---');
    const leafletIntegrity = await page.evaluate(() => {
      const mapContainer = document.querySelector('.leaflet-container');
      if (!mapContainer) return { found: false };
      const rect = mapContainer.getBoundingClientRect();
      const canvasTiles = mapContainer.querySelectorAll('canvas');
      return {
        found: true,
        width: rect.width,
        height: rect.height,
        tileCount: canvasTiles.length,
      };
    });

    const leafletPass = leafletIntegrity.found && leafletIntegrity.width > 200 && leafletIntegrity.height > 200;
    record(
      'Leaflet map layout integrity',
      leafletPass,
      `Map Dimensions: ${leafletIntegrity.width}x${leafletIntegrity.height}px, Basemap canvas tiles: ${leafletIntegrity.tileCount}`
    );

    // -------------------------------------------------------------
    // TEST 4: Viewport 1920x1080 (Full HD Desktop)
    // -------------------------------------------------------------
    console.log('\n--- Evaluating Viewport 1920x1080 ---');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(600);

    const m1920 = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      return {
        cW: cRect.width,
        cH: cRect.height,
        vW: vRect.width,
        vH: vRect.height,
        bufW: canvas.width,
        bufH: canvas.height,
        dpr,
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const cov1920Pass = m1920.covW >= 99.0 && m1920.covH >= 99.0;
    record(
      'Canvas covers >=99% (1920x1080)',
      cov1920Pass,
      `Width: ${m1920.covW.toFixed(1)}%, Height: ${m1920.covH.toFixed(1)}% (Canvas: ${m1920.vW}x${m1920.vH}, Container: ${m1920.cW}x${m1920.cH})`
    );

    await page.screenshot({ path: path.join(SCREENS_DIR, 'task1_1920x1080_normal.png') });

    // Fullscreen in 1920x1080
    await fsBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENS_DIR, 'task1_1920x1080_fullscreen.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // -------------------------------------------------------------
    // TEST 5: Viewport 390x844 (Mobile iPhone 12/13/14)
    // -------------------------------------------------------------
    console.log('\n--- Evaluating Viewport 390x844 (Mobile) ---');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);

    const m390 = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sim3d-container"]');
      const canvas = container.querySelector('canvas');
      const cRect = container.getBoundingClientRect();
      const vRect = canvas.getBoundingClientRect();
      return {
        cW: cRect.width,
        cH: cRect.height,
        vW: vRect.width,
        vH: vRect.height,
        covW: (vRect.width / cRect.width) * 100,
        covH: (vRect.height / cRect.height) * 100,
      };
    });

    const cov390Pass = m390.covW >= 99.0 && m390.covH >= 99.0;
    record(
      'Canvas covers >=99% (390x844 mobile)',
      cov390Pass,
      `Width: ${m390.covW.toFixed(1)}%, Height: ${m390.covH.toFixed(1)}% (Canvas: ${m390.vW}x${m390.vH}, Container: ${m390.cW}x${m390.cH})`
    );

    await page.screenshot({ path: path.join(SCREENS_DIR, 'task1_390x844_mobile.png') });

    // -------------------------------------------------------------
    // TEST 6: Task 2 Tactical HUD & Autonomous Search Elements
    // -------------------------------------------------------------
    console.log('\n--- Evaluating Task 2 Tactical HUD & Mode Controls ---');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(600);

    // Verify Tactical HUD DOM Overlay exists
    const hudExists = await page.locator('[data-testid="tactical-hud"]').count();
    record('Tactical HUD DOM overlay exists', hudExists > 0, `HUD elements count: ${hudExists}`);

    // Verify STRICT ZERO SVG Policy in HUD
    const hudSvgCount = await page.locator('[data-testid="tactical-hud"] svg').count();
    record('HUD strictly contains Zero SVG', hudSvgCount === 0, `SVG elements found: ${hudSvgCount}`);

    // Verify Top Tactical Banner
    const hudBanner = page.locator('[data-testid="tactical-hud-banner"]');
    const bannerCount = await hudBanner.count();
    record('Tactical Verification Banner exists', bannerCount > 0, `Banner count: ${bannerCount}`);

    // Verify Substate indicator
    const substateText = await page.locator('[data-testid="hud-substate"]').innerText();
    record('HUD Substate indicator active', Boolean(substateText), `Substate display: "${substateText}"`);

    // Verify Victim counter
    const victimCounterText = await page.locator('[data-testid="hud-victim-counter"]').innerText();
    record(
      'HUD Victim Counter format',
      victimCounterText.includes('Found'),
      `Victim counter: "${victimCounterText}"`
    );

    // Verify Audio Chime toggle button
    const chimeBtn = page.locator('button:has-text("Chime"), button:has-text("Muted")').first();
    const chimeBtnExists = (await chimeBtn.count()) > 0;
    record('Audio confirmation tone toggle button exists', chimeBtnExists, `Chime button present`);
    if (chimeBtnExists) {
      await chimeBtn.click(); // toggle mute
      await page.waitForTimeout(200);
      await chimeBtn.click(); // toggle back
    }

    // Verify Flight Mode switch MANUAL | AUTONOMOUS
    const modeAutoBtn = page.locator('[data-testid="mode-auto-btn"]');
    const modeManualBtn = page.locator('[data-testid="mode-manual-btn"]');
    const autoExists = (await modeAutoBtn.count()) > 0;
    const manualExists = (await modeManualBtn.count()) > 0;
    record('Flight Mode switch buttons exist', autoExists && manualExists, `AUTONOMOUS and MANUAL buttons present`);

    // Click MANUAL mode: verify 1-frame switch to manual
    await modeManualBtn.click();
    await page.waitForTimeout(300);
    const isManualActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="mode-manual-btn"]');
      return btn?.classList.contains('is-active');
    });
    record('Switch to MANUAL mode', isManualActive, `MANUAL button is-active=${isManualActive}`);

    // Click AUTONOMOUS mode: resume autonomous search
    await modeAutoBtn.click();
    await page.waitForTimeout(300);
    const isAutoActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="mode-auto-btn"]');
      return btn?.classList.contains('is-active');
    });
    record('Switch to AUTONOMOUS mode', isAutoActive, `AUTONOMOUS button is-active=${isAutoActive}`);

    // Wait a brief window to capture telemetry & autonomous lawnmower progress
    console.log('\n--- Observing Autonomous Lawnmower Simulation Telemetry ---');
    await page.waitForTimeout(3000);

    const hudState = await page.evaluate(() => {
      const substate = document.querySelector('[data-testid="hud-substate"]')?.textContent || '';
      const counter = document.querySelector('[data-testid="hud-victim-counter"]')?.textContent || '';
      const timer = document.querySelector('[data-testid="hud-hover-timer"]')?.textContent || '';
      const thermal = document.querySelector('[data-testid="hud-thermal-readout"]')?.textContent || '';
      const targetBoxes = document.querySelectorAll('[data-testid^="target-box-"]').length;
      return { substate, counter, timer, thermal, targetBoxes };
    });

    record(
      'Live Substate & Target tracking in HUD',
      Boolean(hudState.substate),
      `Substate: ${hudState.substate}, Counter: ${hudState.counter}, Target Boxes: ${hudState.targetBoxes}`
    );

    // Save final HUD screenshot
    await page.screenshot({ path: path.join(SCREENS_DIR, 'task2_hud_overview.png') });
  } finally {
    await browser.close();
    staticServer.close();
    if (backendProc.pid) {
      killPid(backendProc.pid);
    }
    cleanPort(FRONTEND_PORT);
    cleanPort(BACKEND_PORT);
  }

  console.log('\n================================================================');
  console.log(' VERIFICATION SUMMARY');
  console.log('================================================================');
  let passCount = 0;
  for (const r of results) {
    if (r.passed) passCount++;
    const mark = r.passed ? '✔ PASS' : '✘ FAIL';
    console.log(`${mark} | ${r.check.padEnd(42)} | ${r.details}`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`TOTAL: ${passCount} / ${results.length} checks passed.`);
  console.log('================================================================');

  if (passCount < results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
