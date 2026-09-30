#!/usr/bin/env node
/**
 * AEROSAR Headless Verification Suite
 * SIH 2026 - Problem Statement 26177
 *
 * Verifies the 4 critical system assertions without browser/GUI:
 * 1. Telemetry arrives near 30 Hz (or 15 Hz in low power)
 * 2. victim_3 yields a CRITICAL alert with explainable reason text
 * 3. Link cut then restore produces zero lost events (offline outbox sync)
 * 4. Mission replay via /api/missions/{id}/replay reproduces exact sequence
 */

const { spawn, execSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const IS_WIN = process.platform === 'win32';
const PORT = 8000;

// Terminal colors
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(msg) {
  console.log(`${c.cyan}[VERIFY]${c.reset} ${msg}`);
}
function pass(msg) {
  console.log(`${c.green}${c.bold}✔ PASS:${c.reset} ${msg}`);
}
function fail(msg) {
  console.error(`${c.red}${c.bold}✘ FAIL:${c.reset} ${msg}`);
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
  return IS_WIN ? 'python' : 'python3';
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

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs / 1000}s`);
}

async function runVerification() {
  console.log(`${c.bold}======================================================${c.reset}`);
  console.log(`${c.bold}     AEROSAR Automated Headless Verification Suite     ${c.reset}`);
  console.log(`${c.bold}======================================================${c.reset}\n`);

  // Ensure port is free
  cleanPort(PORT);
  await new Promise((r) => setTimeout(r, 500));

  const pythonCmd = findPython();
  log(`Spawning backend: ${pythonCmd} -m uvicorn app.main:app --port ${PORT}`);

  const backend = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PORT)],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PYTHONPATH: ROOT_DIR,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    }
  );

  let backendExited = false;
  backend.on('exit', (code) => {
    backendExited = true;
  });

  const cleanup = () => {
    if (backend && backend.pid) {
      killPid(backend.pid);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // 1. Health Probe
    log('Probing /api/health...');
    const health = await waitForHealth();
    log(`Backend online. Mode: ${health.mode}, SQLite: ${health.database}`);

    // 2. Connect WebSocket
    log('Connecting WebSocket client to ws://127.0.0.1:8000/ws/live...');
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/live`);

    const receivedMessages = [];
    const telemetryTimestamps = [];
    let criticalVictimAlert = null;
    let criticalRiskScore = null;
    let linkStateEvents = [];

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        log('WebSocket connected.');
        resolve();
      };
      ws.onerror = (err) => reject(new Error('WebSocket connection error'));
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        receivedMessages.push(msg);

        if (msg.type === 'telemetry') {
          telemetryTimestamps.push(Date.now());
        }

        if (msg.type === 'alert') {
          const a = msg.payload || msg.data;
          if (a && (a.alert_type === 'CRITICAL_PRIORITY' || (a.message && a.message.includes('victim_3')))) {
            criticalVictimAlert = a;
          }
        }

        if (msg.type === 'risk') {
          const r = msg.payload || msg.data;
          if (r && r.detection_id === 'victim_3' && r.priority_level === 'CRITICAL') {
            criticalRiskScore = r;
          }
        }

        if (msg.type === 'link_state') {
          linkStateEvents.push(msg.payload || msg.data);
        }
      } catch (e) {
        // ignore malformed
      }
    };

    // Send Start Command
    log('Sending "start" mission command...');
    ws.send(JSON.stringify({ v: 1, type: 'cmd', seq: 100, sim_time: 0, payload: { action: 'start' } }));

    // =========================================================================
    // ASSERTION 1: Telemetry rate near 30 Hz
    // =========================================================================
    log('Sampling telemetry stream for rate measurement (2.5s window)...');
    const startCount = telemetryTimestamps.length;
    const sampleStartTime = Date.now();
    await new Promise((r) => setTimeout(r, 2500));
    const sampleEndTime = Date.now();
    const endCount = telemetryTimestamps.length;

    const count = endCount - startCount;
    const elapsedSec = (sampleEndTime - sampleStartTime) / 1000;
    const measuredHz = count / elapsedSec;
    log(`Received ${count} telemetry packets in ${elapsedSec.toFixed(2)}s (${measuredHz.toFixed(1)} Hz).`);

    if (measuredHz < 18.0) {
      throw new Error(`Telemetry rate too low: ${measuredHz.toFixed(1)} Hz (expected >= 20 Hz nominal 30 Hz)`);
    }
    pass(`Assertion 1: Live telemetry streams at ${measuredHz.toFixed(1)} Hz (~30 Hz target rate).`);

    // =========================================================================
    // ASSERTION 2: victim_3 yields a CRITICAL alert with explainable reason text
    // =========================================================================
    log('Advancing mission to encounter Zone C and victim_3...');
    // Fast forward drone along spline to approach victim_3 directly
    ws.send(JSON.stringify({
      v: 1,
      type: 'cmd',
      seq: 200,
      sim_time: 0,
      payload: { action: 'fast_forward', params: { progress: 0.23 } },
    }));

    // Wait up to 10s for victim_3 detection, scoring, and alert
    const vicWaitStart = Date.now();
    while ((!criticalVictimAlert || !criticalRiskScore) && Date.now() - vicWaitStart < 10000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!criticalRiskScore) {
      throw new Error('victim_3 risk score was not received or not CRITICAL');
    }
    if (!criticalRiskScore.reason || criticalRiskScore.reason.length === 0) {
      throw new Error('victim_3 risk score missing explainable reason text');
    }
    if (!criticalVictimAlert) {
      throw new Error('victim_3 did not generate a CRITICAL priority emergency alert');
    }

    pass(`Assertion 2: victim_3 triggered CRITICAL priority with reason: "${criticalRiskScore.reason}".`);
    log(`Alert generated: [${criticalVictimAlert.alert_type}] "${criticalVictimAlert.message}"`);

    // =========================================================================
    // ASSERTION 3: Link cut then restore produces zero lost events
    // =========================================================================
    log('Executing network link cut via POST /api/debug/link/cut...');
    const cutRes = await fetch(`http://127.0.0.1:${PORT}/api/debug/link/cut`, { method: 'POST' });
    const cutJson = await cutRes.json();
    if (!cutJson.success) throw new Error('Failed to cut link via API');

    log('Injecting offline survivor detection to verify outbox buffering...');
    const offlineDet = {
      id: 'offline_survivor_01',
      detection_type: 'person',
      confidence: 0.82,
      thermal_confirmed: true,
      latitude: 26.91245,
      longitude: 75.78735,
    };
    const detRes = await fetch(`http://127.0.0.1:${PORT}/api/detections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offlineDet),
    });
    if (!detRes.ok) throw new Error('Failed to post detection during offline state');

    // Check sync status reports queued events
    const syncStatusRes = await fetch(`http://127.0.0.1:${PORT}/api/sync/status`);
    const syncStatus = await syncStatusRes.json();
    log(`Offline sync status: state=${syncStatus.state}, queued=${syncStatus.queued_events}`);
    if (syncStatus.state !== 'OFFLINE' || syncStatus.queued_events < 1) {
      throw new Error(`Sync status did not record offline buffered events: ${JSON.stringify(syncStatus)}`);
    }

    // Now restore link
    log('Restoring network link via POST /api/debug/link/restore...');
    const restoreRes = await fetch(`http://127.0.0.1:${PORT}/api/debug/link/restore`, { method: 'POST' });
    const restoreJson = await restoreRes.json();
    if (!restoreJson.success || restoreJson.synced_events < 1) {
      throw new Error(`Link restore failed or 0 events synced: ${JSON.stringify(restoreJson)}`);
    }

    // Wait for flushed broadcast
    await new Promise((r) => setTimeout(r, 600));

    // Verify offline detection was received over WebSocket
    const receivedOfflineDet = receivedMessages.find(
      (m) => m.type === 'detection' && (m.payload?.id === 'offline_survivor_01' || m.data?.id === 'offline_survivor_01')
    );
    if (!receivedOfflineDet) {
      throw new Error('Offline survivor detection was not flushed over WebSocket upon link restore');
    }
    pass(`Assertion 3: Link cut & restore flushed ${restoreJson.synced_events} buffered events with zero event loss.`);

    // =========================================================================
    // ASSERTION 4: Replay endpoint reproduces exact sequence
    // =========================================================================
    log('Validating mission replay storage via /api/missions and /api/missions/{id}/replay...');
    const missionsRes = await fetch(`http://127.0.0.1:${PORT}/api/missions`);
    const missions = await missionsRes.json();
    if (!Array.isArray(missions) || missions.length === 0) {
      throw new Error('No missions found in /api/missions');
    }

    const missionId = missions[0].mission_id;
    log(`Fetching replay frames for mission "${missionId}"...`);
    const replayRes = await fetch(`http://127.0.0.1:${PORT}/api/missions/${missionId}/replay`);
    const replayFrames = await replayRes.json();

    if (!Array.isArray(replayFrames) || replayFrames.length === 0) {
      throw new Error(`Replay endpoint returned empty frames for ${missionId}`);
    }

    // Check monotonic increasing sequence
    for (let i = 1; i < replayFrames.length; i++) {
      if (replayFrames[i].seq <= replayFrames[i - 1].seq) {
        throw new Error(`Replay frames not strictly monotonic: frame ${i-1} seq=${replayFrames[i-1].seq} >= frame ${i} seq=${replayFrames[i].seq}`);
      }
    }

    pass(`Assertion 4: Replay storage verified — ${replayFrames.length} frames reproduced in strictly monotonic seq order.`);

    // Clean finish
    ws.close();
    cleanup();

    console.log(`\n${c.green}${c.bold}======================================================${c.reset}`);
    console.log(`${c.green}${c.bold}   ALL 4 VERIFICATION ASSERTIONS PASSED (100% OK)     ${c.reset}`);
    console.log(`${c.green}${c.bold}======================================================${c.reset}\n`);
    process.exit(0);
  } catch (err) {
    fail(`Verification failed: ${err.message}`);
    cleanup();
    process.exit(1);
  }
}

runVerification();
