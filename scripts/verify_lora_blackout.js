#!/usr/bin/env node
/**
 * AEROSAR LoRa Blackout Headless Verification Runner
 * SIH 2026 - Problem Statement 26177
 *
 * Runs the headless scenario assertions via tsx:
 * 1. Drone enters noNetworkZones -> link mode transitions NETWORK -> LORA_ONLY after 2s.
 * 2. Hover-verify confirms victim_3 -> VICTIM LoRa frame delivered within 15s of sim time.
 * 3. Zero duplicate victims in queue.
 * 4. Drone leaves zone -> link returns to NETWORK and outbox flushes to 0.
 * 5. Ruins obstruction second variant -> RF obstruction loss detected, clear LoS delivery verified.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const scriptTs = path.join(rootDir, 'scripts', 'verify_lora_blackout.ts');
const localTsxCli = path.join(frontendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const frontendNodeModules = path.join(frontendDir, 'node_modules');

const env = {
  ...process.env,
  NODE_PATH: process.env.NODE_PATH
    ? `${frontendNodeModules}${path.delimiter}${process.env.NODE_PATH}`
    : frontendNodeModules,
};

let res;
if (fs.existsSync(localTsxCli)) {
  res = spawnSync(process.execPath, [localTsxCli, scriptTs], {
    cwd: rootDir,
    stdio: 'inherit',
    env,
  });
} else {
  const isWin = process.platform === 'win32';
  const npx = isWin ? 'npx.cmd' : 'npx';
  res = spawnSync(npx, ['tsx', scriptTs], {
    cwd: frontendDir,
    stdio: 'inherit',
    env,
  });
}

process.exit(res.status ?? 0);
