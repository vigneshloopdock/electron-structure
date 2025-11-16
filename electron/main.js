const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

let nextProcess;
let n8nProcess;
let mainWindow;

// Helper to get your local IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function createWindow() {
  const iconPath = path.join(__dirname, 'logo_ico.ico');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const targetUrl = 'http://localhost:3000';
  function waitForServer(attempt = 0) {
    const http = require('http');
    const req = http.request(targetUrl, (res) => {
      mainWindow.loadURL(targetUrl);
    });
    req.on('error', () => {
      const nextAttempt = Math.min(attempt + 1, 30);
      setTimeout(() => waitForServer(nextAttempt), 1000);
    });
    req.end();
  }
  waitForServer();

  const ip = getLocalIP();
  console.log(`\n🌐 Frontend local: http://localhost:3000`);
  console.log(`🌐 Frontend LAN:   http://${ip}:3000`);
  console.log(`⚙️  n8n LAN:        http://${ip}:5678\n`);
}

// ✅ FIX: Find n8n binary from root-level node_modules or global
function getN8NBinary() {
  // 1) Dev: root-level node_modules
  const devLocal = path.join(__dirname, '../node_modules/.bin/n8n.cmd');
  if (fs.existsSync(devLocal)) return devLocal;

  // 2) Packaged: resources extraResources
  const packagedCmd = path.join(process.resourcesPath || __dirname, 'n8n', 'n8n.cmd');
  if (fs.existsSync(packagedCmd)) return packagedCmd;

  // 3) Fallback: global install
  return 'n8n';
}

function startNext() {
  console.log('🔨 Building Next.js frontend...');
  const frontendDir = path.join(__dirname, '../frontend');
  // Ensure env.local exists so build picks up correct keys
  try {
    const envLocal = path.join(frontendDir, '.env.local');
    const envTemplate = path.join(frontendDir, 'env.template');
    if (!fs.existsSync(envLocal) && fs.existsSync(envTemplate)) {
      fs.copyFileSync(envTemplate, envLocal);
      console.log('🧩 Created .env.local from env.template');
    }
  } catch (e) {
    console.warn('⚠️ Failed to ensure .env.local:', e.message);
  }

  const build = spawn('npm', ['run', 'build'], {
    cwd: frontendDir,
    shell: true,
    stdio: 'inherit',
  });

  build.on('exit', (code) => {
    if (code !== 0) {
      console.error('❌ Next.js build failed with code', code);
      return;
    }
    console.log('🚀 Starting Next.js frontend...');
    nextProcess = spawn('npm', ['run', 'start', '--', '-H', '0.0.0.0'], {
      cwd: frontendDir,
      shell: true,
      stdio: 'inherit',
    });
  });
}

function startN8N() {
  console.log('⚙️ Starting n8n background service...');
  const n8nBinary = getN8NBinary();
  console.log('📦 Using n8n binary at:', n8nBinary);

  const userData = app.getPath('userData');
  const lanIP = getLocalIP();
  
  // Allow overriding n8n auth via userData config or environment
  function loadN8NAuthConfig() {
    const defaultConfig = {
      basicAuthActive: true,
      basicAuthUser: 'admin',
      basicAuthPassword: 'TempReset#2025!',
      userManagementDisabled: true,
      secureCookie: false,
    };

    const configPath = path.join(userData, 'n8n-auth.json');
    let fileConfig = {};
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        fileConfig = JSON.parse(raw);
        console.log(`🔧 Loaded n8n auth from: ${configPath}`);
      }
    } catch (e) {
      console.warn('⚠️ Failed to read n8n-auth.json, falling back to defaults/env:', e.message);
    }

    return {
      basicAuthActive:
        process.env.N8N_BASIC_AUTH_ACTIVE ?? fileConfig.basicAuthActive ?? defaultConfig.basicAuthActive,
      basicAuthUser:
        process.env.N8N_BASIC_AUTH_USER ?? fileConfig.basicAuthUser ?? defaultConfig.basicAuthUser,
      basicAuthPassword:
        process.env.N8N_BASIC_AUTH_PASSWORD ?? fileConfig.basicAuthPassword ?? defaultConfig.basicAuthPassword,
      userManagementDisabled:
        process.env.N8N_USER_MANAGEMENT_DISABLED ?? fileConfig.userManagementDisabled ?? defaultConfig.userManagementDisabled,
      secureCookie:
        process.env.N8N_SECURE_COOKIE ?? fileConfig.secureCookie ?? defaultConfig.secureCookie,
    };
  }

  const auth = loadN8NAuthConfig();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    // Listen on all interfaces so LAN clients can access
    N8N_HOST: '0.0.0.0',
    // Use LAN IP for the UI to avoid browser CORS/connection issues
    N8N_EXTERNAL_URL: `http://${lanIP}:5678`,
    N8N_PORT: '5678',
    N8N_USER_FOLDER: path.join(userData, 'n8n-data'),
    N8N_SECURE_COOKIE: String(auth.secureCookie),
    N8N_BASIC_AUTH_ACTIVE: String(auth.basicAuthActive),
    N8N_BASIC_AUTH_USER: String(auth.basicAuthUser),
    N8N_BASIC_AUTH_PASSWORD: String(auth.basicAuthPassword),
    N8N_USER_MANAGEMENT_DISABLED: 'true',
    N8N_DISABLE_UI: 'false',
    // Disable email signup/login form
    N8N_AUTH_LOGIN_ENABLED: 'false',
  };

  n8nProcess = spawn(n8nBinary, ['start', '--host', '0.0.0.0', '--port', '5678'], {
    shell: true,
    stdio: 'inherit',
    env,
  });

  console.log(`\n✅ n8n accessible at:`);
  console.log(`   Local:  http://localhost:5678`);
  console.log(`   LAN:    http://${lanIP}:5678`);
  console.log(`   Login:  ${auth.basicAuthUser} / ${auth.basicAuthPassword}\n`);

  n8nProcess.on('error', (err) => console.error('❌ Failed to start n8n:', err));
  n8nProcess.on('exit', (code) => console.log(`ℹ️ n8n exited with code ${code}`));
}

app.whenReady().then(() => {
  startN8N();
  startNext();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  if (nextProcess) nextProcess.kill();
  if (n8nProcess) n8nProcess.kill();
});
