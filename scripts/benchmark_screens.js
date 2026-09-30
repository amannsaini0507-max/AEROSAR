/**
 * AEROSAR Automated Playwright Benchmark and Screenshot Suite
 * Loads each scenario at each quality preset, measures FPS & frametime,
 * and saves screenshots to docs/screens/<scenario>_<preset>.png.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'frontend', 'dist');
const SCREENS_DIR = path.join(ROOT_DIR, 'docs', 'screens');
const BENCHMARK_FILE = path.join(ROOT_DIR, 'docs', 'BENCHMARK_FPS.txt');
const PORT = 4173;

const SCENARIOS = [
  { id: '1', name: 'scenario_1' },
  { id: '2', name: 'scenario_2' },
  { id: '3', name: 'scenario_3' },
  { id: '4', name: 'scenario_4' },
  { id: '5', name: 'scenario_5' },
  { id: 'combined', name: 'combined' }
];

const PRESETS = ['low', 'medium', 'high', 'ultra'];

// Simple static HTTP server for frontend/dist
function startServer() {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.hdr': 'application/octet-stream',
    '.svg': 'image/svg+xml'
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
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Static benchmark server listening at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

async function run() {
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
  const server = await startServer();

  console.log('Launching headless browser with WebGL hardware acceleration...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: [
      '--enable-webgl',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--window-size=1920,1080'
    ]
  });

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log(`Navigating to http://127.0.0.1:${PORT}...`);
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });

  // Wait for canvas
  await page.waitForSelector('canvas', { timeout: 15000 });
  console.log('Canvas ready. Waiting 2s for initial scene stabilization...');
  await page.waitForTimeout(2000);

  const results = {};

  for (const scen of SCENARIOS) {
    results[scen.name] = {};
    console.log(`\n======================================================`);
    console.log(`Switching to Scenario: ${scen.name} (${scen.id})`);
    console.log(`======================================================`);

    // Select scenario using explicit id
    await page.selectOption('#scenario-select', scen.id);
    await page.waitForTimeout(1000);

    for (const preset of PRESETS) {
      console.log(`  Applying preset: [${preset}]...`);

      // Click preset button
      const presetButtons = await page.$$('.dashboard__sim3d button.btn-tag');
      for (const btn of presetButtons) {
        const text = (await btn.innerText()).trim().toLowerCase();
        if (text === preset) {
          await btn.click();
          break;
        }
      }

      // Settle time for post-processing shaders and IBL PMREM
      await page.waitForTimeout(1200);

      // Measure 60 frames FPS in page
      const fpsData = await page.evaluate(async () => {
        return new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          function tick() {
            frames++;
            if (frames >= 60) {
              const elapsed = performance.now() - start;
              const fps = (frames / (elapsed / 1000));
              const ms = elapsed / frames;
              resolve({ fps: Math.round(fps * 10) / 10, ms: Math.round(ms * 10) / 10 });
            } else {
              requestAnimationFrame(tick);
            }
          }
          requestAnimationFrame(tick);
        });
      });

      results[scen.name][preset] = fpsData;
      console.log(`    Result: ${fpsData.fps} FPS (${fpsData.ms} ms/frame)`);

      // Capture screenshot of the 3D canvas or panel
      const screenPath = path.join(SCREENS_DIR, `${scen.name}_${preset}.png`);
      const simPanel = await page.$('.dashboard__sim3d');
      if (simPanel) {
        await simPanel.screenshot({ path: screenPath });
      } else {
        await page.screenshot({ path: screenPath });
      }
      console.log(`    Saved: ${path.relative(ROOT_DIR, screenPath)}`);
    }
  }

  // Thermal Channel Screenshot on Scenario 2
  console.log('\nCapturing Thermal Sensor View (Scenario 2)...');
  await page.selectOption('#scenario-select', '2');
  const zoneCBtn = await page.$('.dashboard__sim3d button.btn-tag:has-text("Zone C")');
  if (zoneCBtn) await zoneCBtn.click();
  await page.waitForTimeout(500);

  const thermalBtn = await page.$('.segmented__btn:has-text("Thermal")');
  if (thermalBtn) {
    await thermalBtn.click();
    await page.waitForTimeout(1000);
    const simPanel = await page.$('.dashboard__sim3d');
    if (simPanel) {
      await simPanel.screenshot({ path: path.join(SCREENS_DIR, 'scenario_2_thermal.png') });
      console.log('    Saved: docs/screens/scenario_2_thermal.png');
    }
    const rgbBtn = await page.$('.segmented__btn:has-text("RGB")');
    if (rgbBtn) await rgbBtn.click();
  }

  // Show Zones Overlay Screenshot on Scenario 3 (GPS-denied volume)
  console.log('\nCapturing GPS-Denied Zone Overlay (Scenario 3)...');
  await page.selectOption('#scenario-select', '3');
  const zoneABtn = await page.$('.dashboard__sim3d button.btn-tag:has-text("Zone A")');
  if (zoneABtn) await zoneABtn.click();
  await page.waitForTimeout(500);

  const zonesCheckbox = await page.$('input[type="checkbox"]:near(:text("Show Zones"))');
  if (zonesCheckbox) {
    await zonesCheckbox.check();
    await page.waitForTimeout(1000);
    const simPanel = await page.$('.dashboard__sim3d');
    if (simPanel) {
      await simPanel.screenshot({ path: path.join(SCREENS_DIR, 'scenario_3_zones.png') });
      console.log('    Saved: docs/screens/scenario_3_zones.png');
    }
  }

  // Format Results Table
  let table = '========================================================================================\n';
  table += '                 AEROSAR 3D WEBGL ENGINE: PERFORMANCE & FPS BENCHMARK                   \n';
  table += '========================================================================================\n';
  table += '| Scenario                 | Low Preset    | Medium Preset | High Preset   | Ultra Preset  |\n';
  table += '|--------------------------|---------------|---------------|---------------|---------------|\n';

  for (const scen of SCENARIOS) {
    const r = results[scen.name];
    const sName = scen.name.padEnd(24);
    const low = `${r.low.fps} fps (${r.low.ms}ms)`.padEnd(13);
    const med = `${r.medium.fps} fps (${r.medium.ms}ms)`.padEnd(13);
    const high = `${r.high.fps} fps (${r.high.ms}ms)`.padEnd(13);
    const ultra = `${r.ultra.fps} fps (${r.ultra.ms}ms)`.padEnd(13);
    table += `| ${sName} | ${low} | ${med} | ${high} | ${ultra} |\n`;
  }
  table += '========================================================================================\n';
  table += 'Target Budget: 60 FPS target at 1080p, 30 FPS minimum floor on Low preset.\n';
  table += 'Hardware Tested: Headless Microsoft Edge ANGLE Direct3D11 / WebGL 2.0 Pipeline.\n';

  console.log('\n' + table);
  fs.writeFileSync(BENCHMARK_FILE, table, 'utf-8');
  console.log(`Benchmark report written to ${BENCHMARK_FILE}`);

  await browser.close();
  server.close();
  console.log('Automated benchmark complete.');
}

run().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
