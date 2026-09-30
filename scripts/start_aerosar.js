#!/usr/bin/env node
/**
 * AEROSAR Primary Unified Launcher (Windows Native / POSIX)
 * SIH 2026 - Problem Statement 26177
 *
 * Capabilities:
 * - Checks Node.js (>=18) and Python (>=3.10) runtimes
 * - Detects / manages virtual environment or system Python
 * - Probes ports (8000 backend, 5173 frontend) and resolves conflicts
 * - Spawns backend (FastAPI/uvicorn) and frontend (Vite)
 * - Polls /api/health until HTTP 200, then launches browser
 * - Graceful process tree termination via taskkill on Windows
 * - Flags:
 *     --check       : Verify environment only, do not launch, exit 0/1
 *     --low-power   : Run in low power mode (telemetry 15 Hz)
 *     --no-browser  : Do not launch default browser
 *     --force       : Automatically free conflicting ports
 */

const { spawn, execSync, execFileSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');

const IS_WIN = process.platform === 'win32';
const ARGS = process.argv.slice(2);
const IS_CHECK_ONLY = ARGS.includes('--check');
const IS_LOW_POWER = ARGS.includes('--low-power');
const NO_BROWSER = ARGS.includes('--no-browser');
const FORCE_PORTS = ARGS.includes('--force');

const BACKEND_PORT = 8000;
const FRONTEND_PORT = 5173;

let backendProcess = null;
let frontendProcess = null;
let isShuttingDown = false;

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(tag, msg, color = colors.cyan) {
  console.log(`${color}${colors.bold}[${tag}]${colors.reset} ${msg}`);
}

function err(tag, msg) {
  console.error(`${colors.red}${colors.bold}[${tag} ERROR]${colors.reset} ${msg}`);
}

// 1. Runtime Version Validation
function checkNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    err('RUNTIME', `Node.js version >= 18 is required. Current: ${process.versions.node}`);
    return false;
  }
  return true;
}

function findPython() {
  // Check virtual environment first
  const venvPythonWin = path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe');
  const venvPythonPosix = path.join(ROOT_DIR, '.venv', 'bin', 'python');
  if (IS_WIN && fs.existsSync(venvPythonWin)) return venvPythonWin;
  if (!IS_WIN && fs.existsSync(venvPythonPosix)) return venvPythonPosix;

  if (process.env.VIRTUAL_ENV) {
    const p = IS_WIN
      ? path.join(process.env.VIRTUAL_ENV, 'Scripts', 'python.exe')
      : path.join(process.env.VIRTUAL_ENV, 'bin', 'python');
    if (fs.existsSync(p)) return p;
  }

  // System candidates
  const candidates = IS_WIN ? ['python', 'py -3', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });
      if (out && out.includes('Python')) return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

function checkPythonVersion(pythonCmd) {
  if (!pythonCmd) {
    err('RUNTIME', 'Python interpreter not found on system PATH or .venv');
    return false;
  }
  try {
    const out = execSync(`${pythonCmd} --version`, { encoding: 'utf-8' }).trim();
    const match = out.match(/Python\s+(\d+)\.(\d+)/i);
    if (!match) {
      err('RUNTIME', `Unable to parse Python version string: "${out}"`);
      return false;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major < 3 || (major === 3 && minor < 10)) {
      err('RUNTIME', `Python >= 3.10 is required. Current: ${out}`);
      return false;
    }
    return true;
  } catch (e) {
    err('RUNTIME', `Failed checking python version: ${e.message}`);
    return false;
  }
}

function runPythonCode(pythonCmd, code) {
  const parts = pythonCmd.split(' ');
  const prog = parts[0];
  const args = parts.slice(1).concat(['-c', code]);
  return execFileSync(prog, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function checkPythonPackages(pythonCmd) {
  const testScript = 'import fastapi, uvicorn, pydantic, numpy, cv2; print("OK")';
  try {
    const res = runPythonCode(pythonCmd, testScript);
    return res === 'OK';
  } catch (e) {
    return false;
  }
}

// 2. Port Testing and Conflict Handling
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(false);
      else resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function getProcessOnPort(port) {
  if (!IS_WIN) {
    try {
      const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
      return pid ? pid.split('\n')[0] : null;
    } catch {
      return null;
    }
  }
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf-8' });
    const lines = out.split('\n');
    for (const line of lines) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        return parts[parts.length - 1]; // PID is last token
      }
    }
  } catch {
    // Ignore error
  }
  return null;
}

function killPid(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-Number(pid), 'SIGKILL');
    }
    log('CLEANUP', `Terminated conflicting process PID ${pid}`, colors.yellow);
  } catch (e) {
    // Ignore error if already dead
  }
}

async function ensurePortAvailable(port, name) {
  const free = await isPortAvailable(port);
  if (free) return true;

  const pid = getProcessOnPort(port);
  log('PORT', `Port ${port} (${name}) is currently occupied by PID: ${pid || 'Unknown'}`, colors.yellow);

  if (FORCE_PORTS || process.env.AEROSAR_FORCE_PORTS === '1') {
    if (pid) {
      killPid(pid);
      await new Promise((r) => setTimeout(r, 800));
      return await isPortAvailable(port);
    }
  }
  return false;
}

// 3. Health Check Poller
function pollBackendHealth(timeoutMs = 30000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          let body = '';
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(data);
            } catch {
              resolve({ status: 'ok' });
            }
          });
        } else {
          retry();
        }
      });

      req.on('error', () => {
        retry();
      });
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timed out waiting for backend health check after ${timeoutMs / 1000}s`));
      } else {
        setTimeout(check, 300);
      }
    };

    check();
  });
}

function openBrowser(url) {
  try {
    if (IS_WIN) {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  } catch (e) {
    log('BROWSER', `Could not auto-open browser: ${e.message}`, colors.yellow);
  }
}

// 4. Process Cleanup
function cleanup() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n');
  log('SHUTDOWN', 'Shutting down AEROSAR services cleanly...', colors.yellow);

  if (backendProcess && backendProcess.pid) {
    killPid(backendProcess.pid);
  }
  if (frontendProcess && frontendProcess.pid) {
    killPid(frontendProcess.pid);
  }

  log('SHUTDOWN', 'All services stopped.', colors.green);
  process.exit(0);
}

// 5. Main Execution Flow
async function main() {
  console.log(`${colors.cyan}${colors.bold}======================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}    AEROSAR Command Center Launcher (SIH 2026)        ${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}======================================================${colors.reset}`);

  // Step 1: Runtime checks
  const nodeOk = checkNodeVersion();
  const pythonCmd = findPython();
  const pythonOk = checkPythonVersion(pythonCmd);
  const packagesOk = pythonOk ? checkPythonPackages(pythonCmd) : false;
  const nodeModulesOk = fs.existsSync(path.join(FRONTEND_DIR, 'node_modules'));

  const port8000Free = await isPortAvailable(BACKEND_PORT);
  const port5173Free = await isPortAvailable(FRONTEND_PORT);

  if (IS_CHECK_ONLY) {
    console.log('\nEnvironment Verification Report:');
    console.log(`- Node.js (>=18)       : ${nodeOk ? colors.green + 'PASS' : colors.red + 'FAIL'} (${process.versions.node})${colors.reset}`);
    console.log(`- Python (>=3.10)      : ${pythonOk ? colors.green + 'PASS' : colors.red + 'FAIL'} (${pythonCmd || 'NOT FOUND'})${colors.reset}`);
    console.log(`- Python Dependencies  : ${packagesOk ? colors.green + 'PASS' : colors.red + 'FAIL'} (fastapi, uvicorn, pydantic, numpy, cv2)${colors.reset}`);
    console.log(`- Frontend node_modules: ${nodeModulesOk ? colors.green + 'PASS' : colors.yellow + 'MISSING (will run npm install)'}${colors.reset}`);
    console.log(`- Port ${BACKEND_PORT} (Backend)  : ${port8000Free ? colors.green + 'AVAILABLE' : colors.yellow + 'OCCUPIED'}${colors.reset}`);
    console.log(`- Port ${FRONTEND_PORT} (Frontend) : ${port5173Free ? colors.green + 'AVAILABLE' : colors.yellow + 'OCCUPIED'}${colors.reset}`);

    const allPass = nodeOk && pythonOk && packagesOk;
    process.exit(allPass ? 0 : 1);
  }

  if (!nodeOk || !pythonOk) {
    err('FATAL', 'Prerequisites not met. Run `node scripts/start_aerosar.js --check` for details.');
    process.exit(1);
  }

  // Step 2: Resolve port conflicts
  const bPortOk = await ensurePortAvailable(BACKEND_PORT, 'Backend');
  if (!bPortOk) {
    err('PORT', `Port ${BACKEND_PORT} is in use. Use --force or close the occupying program.`);
    process.exit(1);
  }

  const fPortOk = await ensurePortAvailable(FRONTEND_PORT, 'Frontend');
  if (!fPortOk) {
    err('PORT', `Port ${FRONTEND_PORT} is in use. Use --force or close the occupying program.`);
    process.exit(1);
  }

  // Step 3: Ensure frontend dependencies
  if (!nodeModulesOk) {
    log('INSTALL', 'frontend/node_modules missing, running npm install...', colors.yellow);
    const npmCmd = IS_WIN ? 'npm.cmd' : 'npm';
    execSync(`${npmCmd} install`, { cwd: FRONTEND_DIR, stdio: 'inherit' });
  }

  // Register signal listeners
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  if (IS_WIN) {
    process.on('SIGHUP', cleanup);
  }

  // Step 4: Launch Backend
  log('LAUNCH', `Starting Backend on http://127.0.0.1:${BACKEND_PORT} (${IS_LOW_POWER ? 'LOW_POWER (15Hz)' : 'NORMAL (30Hz)'})...`);
  const backendEnv = {
    ...process.env,
    PYTHONPATH: ROOT_DIR,
    PYTHONUNBUFFERED: '1',
    AEROSAR_LOW_POWER: IS_LOW_POWER ? '1' : '0',
  };

  backendProcess = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: BACKEND_DIR,
      env: backendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    }
  );

  backendProcess.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log(`${colors.cyan}[backend]${colors.reset} ${text}`);
  });

  backendProcess.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.error(`${colors.cyan}[backend]${colors.reset} ${text}`);
  });

  backendProcess.on('exit', (code) => {
    if (!isShuttingDown) {
      err('BACKEND', `Backend process exited unexpectedly with code ${code}`);
      cleanup();
    }
  });

  // Step 5: Wait for Backend Health
  log('HEALTH', 'Waiting for backend readiness probe...');
  try {
    const health = await pollBackendHealth(20000);
    log('HEALTH', `Backend is HEALTHY! Mode: ${health.mode || 'standalone'}, DB: ${health.database || 'active'}`, colors.green);
  } catch (e) {
    err('HEALTH', `Backend failed to start: ${e.message}`);
    cleanup();
    process.exit(1);
  }

  // Step 6: Launch Frontend
  const npmCmd = IS_WIN ? 'npm.cmd' : 'npm';
  log('LAUNCH', `Starting Frontend on http://localhost:${FRONTEND_PORT}...`);
  frontendProcess = spawn(npmCmd, ['run', 'dev', '--', '--port', String(FRONTEND_PORT)], {
    cwd: FRONTEND_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  frontendProcess.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log(`${colors.green}[frontend]${colors.reset} ${text}`);
  });

  frontendProcess.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.error(`${colors.green}[frontend]${colors.reset} ${text}`);
  });

  frontendProcess.on('exit', (code) => {
    if (!isShuttingDown) {
      err('FRONTEND', `Frontend process exited unexpectedly with code ${code}`);
      cleanup();
    }
  });

  // Step 7: Open browser
  const appUrl = `http://localhost:${FRONTEND_PORT}`;
  if (!NO_BROWSER) {
    setTimeout(() => {
      log('BROWSER', `Opening dashboard at ${appUrl}...`, colors.green);
      openBrowser(appUrl);
    }, 1500);
  } else {
    log('INFO', `Dashboard running at ${appUrl}`, colors.green);
  }

  log('RUNNING', 'System is live! Press Ctrl+C to terminate all services.', colors.green);
}

main().catch((e) => {
  err('FATAL', e.message);
  cleanup();
});
