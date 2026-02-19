// Polyfill for pdf-parse compatibility in Node/Electron environment
global.DOMMatrix = class DOMMatrix {
  constructor() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
  }
};
global.ImageData = class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};
global.Path2D = class Path2D {};
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.on('uncaughtException', (err) => { console.error('CRITICAL UNCAUGHT EXCEPTION:', err); });
process.on('unhandledRejection', (reason) => { console.error('CRITICAL UNHANDLED REJECTION:', reason); });

const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, desktopCapturer, dialog, net, screen } = require('electron');
const uio_lib = require('uiohook-napi');
const uIOhook = uio_lib.uIOhook || uio_lib;
const { pathToFileURL } = require('url');
const { exec, fork } = require('child_process');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const mammoth = require('mammoth');
const Jimp = require('jimp');
// Tesseract moved to child process (ocr-worker.js)
let pdf;
try {
    pdf = require('pdf-parse');
    if (typeof pdf !== 'function') {
        console.warn('pdf-parse loaded but is not a function - checking exports');
        if (pdf.default && typeof pdf.default === 'function') {
            pdf = pdf.default;
        } else {
            throw new Error('Valid pdf-parse function not found');
        }
    }
    console.log('PDF library loaded successfully');
} catch (e) {
    console.error('Failed to load pdf-parse:', e);
    pdf = null;
}
const Store = require('electron-store');
const store = new Store();

// Set Stealth App Name for Process Masquerading
app.name = "RuntimeBroker";

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;
let tray = null;
let isAppFocusable = false;

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.setFocusable(false);
            mainWindow.showInactive();
            mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
        }
    });

    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
    app.commandLine.appendSwitch('disable-http-cache');

    app.whenReady().then(async () => {
        // Increment launch counter
        const launches = (store.get('app-launches') || 0) + 1;
        store.set('app-launches', launches);

        createWindow();
        createTray();
        registerGlobalHotkey();

        // Handle Permissions for Audio Capture
        const { session } = require('electron');
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            const allowedPermissions = ['media', 'display-capture', 'mediaKeySystem'];
            if (allowedPermissions.includes(permission)) {
                callback(true);
            } else {
                callback(false);
            }
        });

        // Hidden Edit menu — enables Ctrl+C/V/X in input fields
        const editMenu = Menu.buildFromTemplate([
            { label: 'Edit', submenu: [
                { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
                { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
            ]}
        ]);
        Menu.setApplicationMenu(editMenu);
        
        const appVersion = app.getVersion ? app.getVersion() : 'v1.0.4';
        sendDiscordLog('launch', { version: appVersion });
        
        console.log(`App Initialization Complete (Launch #${launches}) - Shortcut Ready.`);
    });

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
        uIOhook.stop();
    });

    app.on('window-all-closed', () => {});

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
}

const rateLimit = new Map();

function safeWindowOperation(operation) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            operation(mainWindow);
        } catch (err) {
            console.error('Window operation failed:', err);
        }
    }
}

// ============================================================================
// DISCORD WEBHOOK LOGGING
// ============================================================================

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

async function sendDiscordLog(type, data) {
    if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL === '') {
        console.log('[Audit] Discord Webhook URL not configured - skipping remote log.');
        return;
    }
    try {
        const os = require('os');
        const { screen } = require('electron');
        const colors = { signup: 0x22c55e, login: 0x3b82f6, launch: 0xf59e0b, close: 0xef4444, error: 0xff0000 };
        const emojis = { signup: '👤', login: '🔑', launch: '🚀', close: '🛑', error: '⚠️' };
        
        // Fetch Network & Geo Info (ip-api.com is free for non-commercial use)
        let netInfo = { query: 'Unknown', city: 'Unknown', country: 'Unknown', isp: 'Unknown', timezone: 'Unknown', regionName: 'Unknown', zip: 'Unknown', lat: 0, lon: 0, as: 'Unknown', mobile: false, proxy: false };
        try {
            const res = await net.fetch('http://ip-api.com/json/?fields=61439');
            if (res.ok) netInfo = await res.json();
        } catch (e) { console.warn('Net info skip:', e.message); }

        // Power Status (Windows Only)
        let powerStatus = "AC Power";
        if (process.platform === 'win32') {
            try {
                const { exec } = require('child_process');
                const batteryPromise = new Promise((resolve) => {
                    exec('WMIC Path Win32_Battery Get EstimatedChargeRemaining, BatteryStatus /Format:List', (error, stdout) => {
                        if (error || !stdout) return resolve(null);
                        const charge = stdout.match(/EstimatedChargeRemaining=(\d+)/);
                        const status = stdout.match(/BatteryStatus=(\d+)/);
                        if (charge && status) {
                            const chargeVal = charge[1];
                            const statusVal = parseInt(status[1]);
                            const isCharging = [6, 7].includes(statusVal);
                            const isAC = [2, 3].includes(statusVal);
                            if (isCharging) resolve(`⚡ Charging (${chargeVal}%)`);
                            else if (isAC) resolve(`🔌 AC Power (${chargeVal}%)`);
                            else resolve(`🔋 Battery (${chargeVal}%)`);
                        } else {
                            resolve(null);
                        }
                    });
                });
                const result = await Promise.race([
                    batteryPromise,
                    new Promise(r => setTimeout(() => r(null), 1000))
                ]);
                if (result) powerStatus = result;
            } catch (e) { /* Likely a Desktop without battery */ }
        }

        // Hardware Stats
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';
        const totalRam = Math.round(os.totalmem() / (1024 * 1024 * 1024)) + 'GB';
        const display = screen.getPrimaryDisplay();
        const resolution = `${display.size.width}x${display.size.height}`;
        
        // MAC Address Info
        const interfaces = os.networkInterfaces();
        let mac = 'Unknown';
        for (const name of Object.keys(interfaces)) {
            const iface = interfaces[name].find(i => !i.internal && i.mac !== '00:00:00:00:00:00');
            if (iface) { mac = iface.mac; break; }
        }

        const launches = store.get('app-launches') || 0;
        const apiKeysCount = (store.get(getUserSettingKey('groq-api-key')) || '').split('\n').filter(k => k.trim()).length;

        const mapsLink = netInfo.lat ? `[📍 View on Maps](https://www.google.com/maps?q=${netInfo.lat},${netInfo.lon})` : 'Location Unavailable';

        const embed = {
            title: `${emojis[type] || '📊'} SYSTEM AUDIT: ${type.toUpperCase()}`,
            color: colors[type] || 0x808080,
            fields: [
                { name: '👤 USER IDENTITY', value: `**User:** ${data.username || 'System'}\n**Visits:** ${launches}\n**Configs:** ${apiKeysCount} Keys`, inline: true },
                { name: '🌐 NETWORK', value: `**IP:** ${netInfo.query}\n**Loc:** ${netInfo.city}, ${netInfo.regionName} ${netInfo.zip}\n**Country:** ${netInfo.country}\n**ISP:** ${netInfo.isp}`, inline: true },
                { name: '🗺️ LOCATION', value: `**Lat/Lon:** ${netInfo.lat}, ${netInfo.lon}\n**TZ:** ${netInfo.timezone}\n${mapsLink}`, inline: true },
                { name: '💻 HARDWARE', value: `**CPU:** ${cpuModel}\n**RAM:** ${totalRam}\n**Res:** ${resolution}\n**Power:** ${powerStatus}`, inline: true },
                { name: '🛡️ SECURITY', value: `**Mobile:** ${netInfo.mobile ? '✅' : '❌'}\n**Proxy/VPN:** ${netInfo.proxy ? '⚠️ Detected' : '✅ Clear'}\n**MAC:** ${mac}`, inline: true },
                { name: '🛠️ SYSTEM', value: `**OS:** ${os.platform()} ${os.release()}\n**Host:** ${os.hostname()}\n**App:** ${data.version || 'v1.0.4'}`, inline: false }
            ],
            timestamp: new Date().toISOString(),
            footer: { text: `Ghost AI Developer Telemetry | IST: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` }
        };

        const payload = JSON.stringify({ embeds: [embed] });
        const request = net.request({ method: 'POST', url: DISCORD_WEBHOOK_URL });
        request.on('error', (err) => console.warn('Discord Log Failed:', err.message));
        request.setHeader('Content-Type', 'application/json');
        request.write(payload);
        request.end();
    } catch (e) {
        console.error('Discord webhook error:', e.message);
    }
}

// ============================================================================
// AUTH SYSTEM
// ============================================================================

const crypto = require('crypto');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
        // Fallback for legacy sha256 hashes if any
        const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
        return legacyHash === storedHash;
    }
    const [salt, hash] = storedHash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

ipcMain.handle('auth-signup', async (event, username, password, apiKeys) => {
    try {
        if (!username || !password) return { success: false, error: 'Username and password required' };
        if (username.length < 3) return { success: false, error: 'Username must be at least 3 characters' };
        if (password.length < 4) return { success: false, error: 'Password must be at least 4 characters' };
        
        const users = store.get('auth-users') || {};
        if (users[username.toLowerCase()]) return { success: false, error: 'Username already exists' };
        
        users[username.toLowerCase()] = {
            password: hashPassword(password),
            createdAt: Date.now()
        };
        store.set('auth-users', users);
        
        // IMPORTANT: Set session BEFORE storing keys so getUserSettingKey works
        store.set('auth-session', { username: username, loggedInAt: Date.now() });
        
        // Store API Keys if provided
        if (apiKeys) {
            store.set(getUserSettingKey('groq-api-key'), apiKeys);
        }
        
        const appVersion = app.getVersion ? app.getVersion() : 'dev';
        sendDiscordLog('signup', { username, version: appVersion });
        
        return { success: true, username };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('auth-login', async (event, username, password) => {
    try {
        if (!username || !password) return { success: false, error: 'Username and password required' };
        
        const users = store.get('auth-users') || {};
        const user = users[username.toLowerCase()];
        if (!user) return { success: false, error: 'User not found' };
        if (!verifyPassword(password, user.password)) return { success: false, error: 'Wrong password' };
        
        store.set('auth-session', { username: username, loggedInAt: Date.now() });
        
        const appVersion = app.getVersion ? app.getVersion() : 'dev';
        sendDiscordLog('login', { username, version: appVersion });
        
        return { success: true, username };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('auth-check', async () => {
    const session = store.get('auth-session');
    if (session && session.username) {
        return { loggedIn: true, username: session.username };
    }
    return { loggedIn: false };
});

ipcMain.handle('auth-logout', async () => {
    const session = store.get('auth-session');
    if (session) sendDiscordLog('close', { username: session.username, version: app.getVersion ? app.getVersion() : 'dev' });
    store.delete('auth-session');
    return { success: true };
});

ipcMain.on('log-to-main', (event, msg) => {
    console.log('[Renderer Log]', msg);
});

// ============================================================================
// IPC HANDLERS - All renderer.js communication
// ============================================================================

ipcMain.handle('get-primary-source-id', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length > 0 ? sources[0].id : null;
});

ipcMain.handle('set-focusable', (event, focusable, shouldFocus = false) => {
    console.log(`[IPC] set-focusable: ${focusable}, shouldFocus: ${shouldFocus}, Current Focusable: ${mainWindow.isFocusable()}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        isAppFocusable = focusable;
        mainWindow.setFocusable(focusable);
        if (focusable) {
            // Ensure interaction is possible
            mainWindow.setIgnoreMouseEvents(false);
            
            // CRITICAL: Only force focus if explicitly requested (e.g. for typing)
            if (shouldFocus) {
                mainWindow.focus();
                // STEALTH FIX: Re-apply skipTaskbar after focus to ensure it stays hidden
                safeWindowOperation(win => win.setSkipTaskbar(true));
            }
        } else {
            mainWindow.blur(); // Ensure blur when disabling focus
        }
    }
});

ipcMain.handle('release-focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        isAppFocusable = false;
        mainWindow.setFocusable(false);
        mainWindow.blur();
        mainWindow.showInactive();
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
});

ipcMain.handle('set-ignore-mouse-events', (event, ignore, options) => {
    console.log(`[IPC] set-ignore-mouse-events: ignore=${ignore}, options=`, options);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
    }
});

// SECURE AI GENERATION HANDLER (Refactored for Streaming)
ipcMain.handle('ai-generate-response', async (event, { systemPrompt, chatHistory, maxTokens }) => {
    try {
        const senderId = event.sender.id;
        const now = Date.now();
        const lastCall = rateLimit.get(senderId) || 0;
        
        if (now - lastCall < 1000) { // 1 request per second rate limit
            return { success: false, error: 'Rate limit exceeded' };
        }
        rateLimit.set(senderId, now);

        const groqApiKeys = store.get(getUserSettingKey('groq-api-key')) || '';
        const keysToTry = groqApiKeys.split(/[\n,\r]+/).map(k => k.trim()).filter(k => k.length > 0);

        if (keysToTry.length === 0) throw new Error('No API Keys configured.');

        const HF_MODELS = [
            'meta-llama/Meta-Llama-3-8B-Instruct',
            'mistralai/Mistral-7B-Instruct-v0.3',
            'microsoft/Phi-3-mini-4k-instruct'
        ];

        let lastError = null;
        for (let i = 0; i < keysToTry.length; i++) {
            const currentKey = keysToTry[i];
            let provider = 'groq';
            let apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
            let model = 'llama-3.3-70b-versatile';
            let isGemini = false;

            if (currentKey.startsWith('hf_')) {
                provider = 'huggingface';
                model = HF_MODELS[i % HF_MODELS.length];
                apiUrl = 'https://router.huggingface.co/v1/chat/completions';
            } else if (currentKey.startsWith('AIza')) {
                provider = 'gemini';
                isGemini = true;
                model = 'gemini-1.5-flash';
                apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${currentKey}`;
            }

            try {
                const payload = isGemini ? {
                    contents: [
                        { role: 'user', parts: [{ text: systemPrompt }] },
                        ...chatHistory.map(msg => ({
                            role: msg.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: msg.content }]
                        }))
                    ],
                    generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens || 800 }
                } : {
                    model: model,
                    messages: [{ role: 'system', content: systemPrompt }, ...chatHistory],
                    temperature: 0.7,
                    max_tokens: maxTokens || 800,
                    stream: true
                };

                const response = await net.fetch(apiUrl, {
                    method: 'POST',
                    headers: { 
                        'Authorization': isGemini ? undefined : `Bearer ${currentKey}`,
                        'Content-Type': 'application/json' 
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const status = response.status;
                    if (status === 429 || status === 401 || status === 503) continue;
                    throw new Error(`${provider} failed: ${status}`);
                }

                // Handle Streaming Response
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullContent = '';
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep partial line in buffer

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

                        try {
                            let content = '';
                            if (isGemini) {
                                // Gemini SSE format: data: {"candidates": [{"content": {"parts": [{"text": "..."}]}}]}
                                if (trimmedLine.startsWith('data: ')) {
                                    const json = JSON.parse(trimmedLine.substring(6));
                                    content = json.candidates[0]?.content?.parts[0]?.text || '';
                                }
                            } else {
                                // OpenAI/Groq SSE format: data: {"choices": [{"delta": {"content": "..."}}]}
                                if (trimmedLine.startsWith('data: ')) {
                                    const json = JSON.parse(trimmedLine.substring(6));
                                    content = json.choices[0]?.delta?.content || '';
                                }
                            }

                            if (content) {
                                fullContent += content;
                                event.sender.send('ai-streaming-chunk', { content });
                            }
                        } catch (e) {
                            console.warn('AI Stream: Partial JSON parse error (Normal for some chunks):', e.message);
                        }
                    }
                }

                event.sender.send('ai-streaming-complete');
                return { success: true, content: fullContent };

            } catch (err) {
                console.error(`AI Attempt ${i + 1} Error:`, err);
                lastError = err;
            }
        }
        throw lastError || new Error('All providers failed.');
    } catch (error) {
        console.error('Secure AI Error:', error);
        event.sender.send('ai-streaming-error', { error: error.message });
        return { success: false, error: error.message };
    }
});


// Window Controls
ipcMain.on('hide-window', () => {
    if (mainWindow && toggleWindow) toggleWindow();
});

ipcMain.on('quit-app', () => {
    app.isQuitting = true;
    app.quit();
});

// SECURE WHISPER TRANSCRIPTION HANDLER
ipcMain.handle('transcribe-audio', async (event, { audioBuffer, model }) => {
    try {
        const groqApiKeys = store.get(getUserSettingKey('groq-api-key')) || '';
        const keysToTry = groqApiKeys.split(/[\n,\r]+/).map(k => k.trim()).filter(k => k.length > 0);
        // Prioritize keys starting with gsk_ (Groq) for transcription
        let whisperKey = keysToTry.find(k => k.startsWith('gsk_'));
        // Fallback to first non-HF/Gemini key if no gsk_ prefix found
        if (!whisperKey) whisperKey = keysToTry.find(k => !k.startsWith('hf_') && !k.startsWith('AIza'));

        if (!whisperKey) {
            throw new Error('No Groq API Key available for transcription.');
        }

        // Create FormData-like body for net.fetch
        const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
        const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`;
        const footer = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n--${boundary}--\r\n`;

        const body = Buffer.concat([
            Buffer.from(header),
            Buffer.from(audioBuffer),
            Buffer.from(footer)
        ]);

        const response = await net.fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${whisperKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: body
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Whisper API Failed (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        return { success: true, text: data.text || "" };

    } catch (error) {
        console.error('Transcription Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('capture-screen', async () => {
    let wasVisible = false;
    try {
        if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'Main window not found' };
        wasVisible = mainWindow.isVisible();
        if (wasVisible) {
            mainWindow.hide();
            await new Promise(resolve => setTimeout(resolve, 200)); // Increased wait slightly for slow systems
        }
        
        console.log('[Main] Taking screenshot...');
        const img = await screenshot({ format: 'png' });
        
        if (!img) throw new Error('Screenshot library returned empty buffer');
        
        return { success: true, data: img.toString('base64') };
    } catch (err) {
        console.error('Capture Error:', err);
        return { success: false, error: err.message || 'Unknown capture error' };
    } finally {
        // ALWAYS restore window if it was visible
        if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setSkipTaskbar(true);
            mainWindow.showInactive(); 
            mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
        }
    }
});


// ============================================================================
// OCR CHILD PROCESS MANAGEMENT (Nuclear Solution)
// ============================================================================
let ocrProcess = null;

function initOCRProcess() {
    if (ocrProcess) return;

    const isProd = app.isPackaged;
    const tessPath = isProd 
        ? path.join(process.resourcesPath, 'tessdata')
        : path.join(__dirname, 'tessdata');

    if (!fs.existsSync(tessPath)) {
        console.error(`[Main] CRITICAL: tessdata path not found at ${tessPath}`);
        return;
    }

    // Fork the worker process
    // In Prod, __dirname inside ASAR points to app.asar/
    // fork() in Electron handles ASAR paths automatically for .js files.
    const workerScript = path.join(__dirname, 'ocr-worker.js');
    console.log(`[Main] Forking OCR Worker: ${workerScript}`);
    
    ocrProcess = fork(workerScript, [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    // Handle Output
    if (ocrProcess.stdout) ocrProcess.stdout.on('data', d => console.log(`[OCR-Worker] ${d.toString().trim()}`));
    if (ocrProcess.stderr) ocrProcess.stderr.on('data', d => console.error(`[OCR-Worker ERR] ${d.toString().trim()}`));

    ocrProcess.on('error', err => console.error('[Main] OCR Process Error:', err));
    ocrProcess.on('exit', (code) => {
        console.log(`[Main] OCR Process exited with code ${code}`);
        ocrProcess = null;
    });

    // Send Init Message
    ocrProcess.send({ type: 'INIT', payload: { tessPath } });

    // Recovery Logic
    ocrProcess.on('exit', (code) => {
        console.log(`[Main] OCR Process exited with code ${code}. Restarting in 5s...`);
        ocrProcess = null;
        setTimeout(() => initOCRProcess(), 5000);
    });
}

// Initialize on app ready
app.whenReady().then(() => {
    initOCRProcess();
});

// Handling App Quit
app.on('will-quit', () => {
    if (ocrProcess) {
        console.log('[Main] Killing OCR Worker...');
        ocrProcess.kill();
    }
});


// ... (IPC Handlers) ...

ipcMain.handle('perform-ocr', async (event, base64Image) => {
    try {
        // Validate size
        if (!base64Image || base64Image.length > 50 * 1024 * 1024) { // Increased to 50MB for 4K+
            throw new Error('Image too large or invalid');
        }
        
        console.log("Processing OCR request via Child Process...");
        
        if (!ocrProcess) {
            initOCRProcess();
            // Wait up to 1 second for the process to at least start
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (!ocrProcess) throw new Error('OCR worker failed to initialize');
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (ocrProcess) ocrProcess.off('message', listener);
                reject(new Error('OCR timeout'));
            }, 45000); // 45 second timeout
            
            const listener = (msg) => {
                if (msg.type === 'OCR_RESULT') {
                    clearTimeout(timeout);
                    if (ocrProcess) ocrProcess.off('message', listener);
                    resolve(msg.text.split('\n').map(l => l.trim()).filter(l => l.length > 3));
                } else if (msg.type === 'ERROR') {
                    clearTimeout(timeout);
                    if (ocrProcess) ocrProcess.off('message', listener);
                    resolve([`Error: ${msg.error}`]);
                }
            };
            
            ocrProcess.on('message', listener);
            
            // Strip data URI prefix if present
            const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            
            ocrProcess.send({ type: 'OCR', payload: { imageBuffer: buffer } });
        });

    } catch (err) {
        console.error('OCR Processing Error:', err);
        return [`Error: ${err.message}`];
    }
});

// ... (Other Handlers) ...


app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

function getUserSettingKey(key) {
    const session = store.get('auth-session');
    if (session && session.username) {
        // Isolate settings per user: users.alice.settings.groq-api-key
        return `users.${session.username.toLowerCase()}.settings.${key}`;
    }
    // SECURE FIX: Never fallback to global for sensitive keys
    console.error('CRITICAL: getUserSettingKey called without active session for key:', key);
    throw new Error('Unauthorized settings access');
}

ipcMain.handle('get-setting', (event, key) => {
    return store.get(getUserSettingKey(key));
});

ipcMain.handle('set-setting', (event, key, value) => {
    store.set(getUserSettingKey(key), value);
    return true;
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
});



ipcMain.handle('check-for-updates', async () => {
    try {
        const response = await net.fetch('https://ghostall.vercel.app/update.json');
        if (!response.ok) throw new Error('Failed to fetch version info');
        const remoteData = await response.json();
        const currentVersion = app.getVersion();
        console.log(`Update Check -> Local: ${currentVersion}, Remote: ${remoteData.version}`);
        return { success: true, ...remoteData };
    } catch (err) {
        console.error('Update Check Error:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('apply-update', async (event, url) => {
    try {
        const AdmZip = require('adm-zip');
        const os = require('os');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-update-'));
        const zipPath = path.join(tempDir, 'update.zip');

        console.log('Downloading update from:', url);
        const response = await net.fetch(url);
        if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(buffer));

        const extractPath = path.join(tempDir, 'extracted');
        
        console.log('Extracting update (Native)...');
        // Sanitize paths to prevent command injection
        const sanitizePath = (p) => p.replace(/['"]/g, '').replace(/[;&|]/g, '');
        const safeZipPath = sanitizePath(zipPath);
        const safeExtractPath = sanitizePath(extractPath);

        const { execSync } = require('child_process');
        execSync(`powershell -Command "Expand-Archive -LiteralPath '${safeZipPath}' -DestinationPath '${safeExtractPath}' -Force"`, { 
            stdio: 'ignore',
            timeout: 60000 
        });

        // Prepare the swap script (Windows Batch)
        const appDir = path.dirname(app.getPath('exe'));
        const exeName = path.basename(app.getPath('exe'));
        const scriptPath = path.join(tempDir, 'update.bat');

        // This script will:
        // 1. Wait 2 seconds for Ghost to close
        // 2. Clear out the app directory (carefully)
        // 3. Move extracted files to the app directory
        // 4. Start the new version
        // 5. Delete itself
        const scriptContent = `
@echo off
timeout /t 2 /nobreak > nul
xcopy /E /Y /H /R "${extractPath.replace(/["&]/g, '')}\\*" "${appDir.replace(/["&]/g, '')}\\"
start "" "${path.join(appDir, exeName).replace(/["&]/g, '')}"
del "%~f0"
`;
        fs.writeFileSync(scriptPath, scriptContent);

        console.log('Update ready. Closing for swap...');
        const { spawn } = require('child_process');
        spawn('cmd.exe', ['/c', scriptPath], {
            detached: true,
            stdio: 'ignore'
        }).unref();

        app.isQuitting = true;
        app.quit();
        return { success: true };
    } catch (error) {
        console.error('Update Application Error:', error);
        return { success: false, error: error.message };
    }
});

// ============================================================================
// FILE PARSING HANDLERS
// ============================================================================

ipcMain.handle('parse-project-zip', async (event, filePath) => {
    try {
        const AdmZip = require('adm-zip');
        // AdmZip constructor is still sync but usually fast for opening. 
        // We'll process the data asynchronously where possible.
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        
        let combinedCode = "";
        const MAX_CONTEXT_CHARS = 50000;
        const codeExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.html', '.css', '.sql', '.md', '.json', '.yaml', '.yml']);
        
        for (const entry of zipEntries) {
            if (entry.isDirectory) continue;
            
            const ext = path.extname(entry.entryName).toLowerCase();
            if (codeExtensions.has(ext) && !entry.entryName.includes('node_modules') && !entry.entryName.includes('.git') && !entry.entryName.includes('package-lock.json')) {
                // getData() is synchronous in AdmZip. To avoid blocking the event loop for too long,
                // we'll yield control between entries if needed or use a small timeout.
                const content = entry.getData().toString('utf8');
                combinedCode += `--- FILE: ${entry.entryName} ---\n${content}\n\n`;
                
                if (combinedCode.length > MAX_CONTEXT_CHARS) {
                    combinedCode = combinedCode.substring(0, MAX_CONTEXT_CHARS) + "\n... (Project truncated for size)";
                    break;
                }
                
                // Optional: yield to event loop if processing many files
                if (zipEntries.indexOf(entry) % 10 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        }
        
        if (!combinedCode) throw new Error("No supported code files found in ZIP.");
        return combinedCode;
    } catch (err) {
        console.error('ZIP Parsing IPC Error:', err);
        throw err;
    }
});

ipcMain.handle('select-project-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Project ZIP', extensions: ['zip'] }]
    });
    
    safeWindowOperation(win => {
        isAppFocusable = false;
        win.setFocusable(false);
        win.blur();
        win.showInactive();
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('select-project-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    safeWindowOperation(win => {
        isAppFocusable = false;
        win.setFocusable(false);
        win.blur();
        win.showInactive();
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

async function getAllFilesAsync(dirPath, arrayOfFiles) {
    const files = await fs.promises.readdir(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        if ((await fs.promises.stat(fullPath)).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
                arrayOfFiles = await getAllFilesAsync(fullPath, arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(fullPath);
        }
    }

    return arrayOfFiles;
}

ipcMain.handle('parse-project-folder', async (event, folderPath) => {
    try {
        let combinedCode = "";
        const MAX_CONTEXT_CHARS = 50000;
        const codeExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.html', '.css', '.sql', '.md', '.json', '.yaml', '.yml']);
        
        const allFiles = await getAllFilesAsync(folderPath);

        for (const filePath of allFiles) {
            const ext = path.extname(filePath).toLowerCase();
            const fileName = path.basename(filePath);
            
            if (codeExtensions.has(ext) && fileName !== 'package-lock.json') {
                const content = await fs.promises.readFile(filePath, 'utf8');
                const relativePath = path.relative(folderPath, filePath);
                combinedCode += `--- FILE: ${relativePath} ---\n${content}\n\n`;
                
                if (combinedCode.length > MAX_CONTEXT_CHARS) {
                    combinedCode = combinedCode.substring(0, MAX_CONTEXT_CHARS) + "\n... (Project truncated for size)";
                    break;
                }
                
                // Yield control to event loop if processing many files
                if (allFiles.indexOf(filePath) % 20 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        }
        
        if (!combinedCode) throw new Error("No supported code files found in folder.");
        return combinedCode;
    } catch (err) {
        console.error('Folder Parsing IPC Error:', err);
        throw err;
    }
});

ipcMain.handle('parse-resume-file', async (event, filePath) => {
    try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.pdf') {
            console.log(`PDF parsing started for: ${filePath}`);
            if (typeof pdf !== 'function') {
                throw new Error("PDF parser not available in current environment.");
            }
            // Suppress PDF.js internal warnings
            const originalWarn = console.warn;
            console.warn = (msg, ...args) => {
                if (typeof msg === 'string' && msg.includes('TT:')) return;
                originalWarn(msg, ...args);
            };

            let data;
            try {
                data = await pdf(fileBuffer);
            } finally {
                console.warn = originalWarn;
            }
                        console.log('PDF Raw Data received:', !!data);
            if (!data || !data.text || data.text.trim().length === 0) {
                console.warn('PDF Parsing warning: No text content found.');
                throw new Error("No text found in PDF. It might be an image-only (scanned) PDF. Please use OCR or a text-based version.");
            }
            console.log(`PDF Parsed successfully. Extracted ${data.text.length} characters.`);
            return data.text;
        } else if (ext === '.docx') {
            const data = await mammoth.extractRawText({ buffer: fileBuffer });
            return data.value;
        } else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
            const image = await Jimp.read(fileBuffer);
            image.grayscale().contrast(0.2).scale(2).normalize();
            const processedBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng');
            return text;
        }
        throw new Error(`Unsupported file format: ${ext}`);
    } catch (err) {
        console.error('File Parsing IPC Error:', err);
        throw err; // Propagate error to renderer
    }
});

ipcMain.handle('select-resume-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Resumes', extensions: ['pdf', 'docx', 'png', 'jpg', 'jpeg'] }]
    });
    
    safeWindowOperation(win => {
        isAppFocusable = false;
        win.setFocusable(false);
        win.blur();
        win.showInactive();
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// ============================================================================
// WINDOW CREATION & MANAGEMENT
// ============================================================================

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600, // Increased width for better readability
        height: 600,
        resizable: false,
        frame: false,
        transparent: true, 
        alwaysOnTop: true,
        skipTaskbar: true,
        autoHideMenuBar: true,
        show: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: false, // LOCKED: Proctoring can detect DevTools windows
            backgroundThrottling: false // IMPORTANT: Ensures audio/capture doesn't lag when hidden
        },
        focusable: true, // Start focusable so auth inputs work reliably
        showInactive: true,
        title: "Windows Runtime" // Stealth: Camouflage window title
    });

    mainWindow.loadFile('index.html');
    mainWindow.once('ready-to-show', () => {
        setUltimateStealth(mainWindow);
        
        const session = store.get('auth-session');
        if (session && session.username) {
            // Already logged in - Full Stealth
            mainWindow.setFocusable(false);
            mainWindow.showInactive();
            isAppFocusable = false;
            sendDiscordLog('launch', { username: session.username, version: app.getVersion ? app.getVersion() : 'dev' });
        } else {
            // Not logged in - Needs focus for login screen
            mainWindow.setFocusable(true);
            // Not logged in - Needs focus for login screen
            mainWindow.setFocusable(true);
            
            // STEALTH FIX: show() can trigger taskbar flash on Windows.
            // Use showInactive() + simultaneous setSkipTaskbar(true)
            mainWindow.showInactive(); 
            mainWindow.setSkipTaskbar(true); 
            
            // Bring to front without activating taskbar
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
            
            isAppFocusable = true;
        }

        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    });

    mainWindow.on('focus', () => {
        console.log('[Main] Window FOCUSED. IsFocusable:', mainWindow.isFocusable());
        // STEALTH FIX: Immediately re-apply skipTaskbar to prevent icon flash
        safeWindowOperation(win => win.setSkipTaskbar(true));
        safeWindowOperation(win => {
            win.setSkipTaskbar(true); 
        });

        if (!isAppFocusable) {
            console.log('Stealth Guard: Blocking unexpected focus.');
            safeWindowOperation(win => {
                win.blur();
                win.setFocusable(false);
                win.showInactive();
            });
        }
    });

    // Aggressive Periodic Stealth Enforcement
    setInterval(() => {
        safeWindowOperation(win => {
            win.setSkipTaskbar(true); // ALWAYS Enforce taskbar hiding
            if (!isAppFocusable) {
                win.setFocusable(false);
                if (win.isFocused()) {
                    win.blur();
                    win.showInactive();
                }
            }
        });
    }, 500);

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
            event.preventDefault();
        }
    });

    Menu.setApplicationMenu(null);
}

function createTray() {
    try {
        console.log("Creating System Tray...");
        const iconPath = path.join(__dirname, 'assets', 'icon.png');
        let trayIcon = nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) {
            console.log("Tray icon file not found, using fallback data URL.");
            trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGxSURBVFiF7ZY9TsNAEIW/WdtJnIIKiQJxBDpuwBG4AhUlJeIKnIGOEnEEjkBBBxIFJQVCij+b3aFwHDt2vN7NIsCT1nt+O/NmtCsBDECSpnkxwgGkIbLcbhIR0lbfOBHLJMKBQCBAAAFEgAACSCAu4TiB+j4OSMCMIJz5AaVE/gngVUQDQhIQkgCRBIgkQCQBKgkQV4BIglhAaFmBIKPVnPcBCAggm0IACC6rPwQ0AOTcAbDVj+Nb3v8GwPoEJC6g0vsH8L0f/wNArgA+hURWQLq4YgLhFpB1gNcNYH0C4lICUiMgvAdAYQLBBpD0gNQNIHEBbQ6gRYAIBMQFpC4g7wGQdIAEBlh5gLQH5G0gqQAJDLByAWkHSHhA1gMQGBCQF1CbAggMCMoLqE0BBAaE5AWknV8AvgPqEpDAAMu8gLz5BfA7oC4BCQywzAu4+wXgOwBS+wCCLqBeAuIjAHIekFwBqQuojQCIVoAkNACSGpBAAfkDoIDQBZQGgFQBIjEgcAFJGgCyHhBfAckmIG8D8RUQbwJSAxJYAVkXkDuArAeEC0jaQOwC/wLCNwm3zH0bfQAAAABJRU5ErkJggg==');
        }
        tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
        tray.setToolTip('Ghost AI');
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Ghost AI (Arrow Up + Down)', click: () => toggleWindow() },
            { type: 'separator' },
            { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
        ]);
        tray.setToolTip(`Invisible Notes (Arrow Up + Down)`);
        tray.setContextMenu(contextMenu);
        tray.on('click', () => toggleWindow());
        console.log("Tray created successfully.");
    } catch (err) {
        console.error("Failed to create tray:", err);
    }
}

function toggleWindow() {
    safeWindowOperation(win => {
        if (win.isVisible()) {
            win.hide();
        } else {
            isAppFocusable = false;
            win.setFocusable(false);
            win.showInactive();
            win.setSkipTaskbar(true);
            win.setAlwaysOnTop(true, "screen-saver", 1);
        }
    });
}

// ============================================================================
// HOTKEY REGISTRATION
// ============================================================================

function registerGlobalHotkey() {
    try {
        let isUpPressed = false;
        let isDownPressed = false;
        let isLeftPressed = false;
        let isRightPressed = false;

        uIOhook.on('keydown', (e) => {
            // uiohook keycodes: Up=57416, Down=57424, Left=57419, Right=57421
            if (e.keycode === 57416 || e.keycode === 72) isUpPressed = true;
            if (e.keycode === 57424 || e.keycode === 80) isDownPressed = true;
            if (e.keycode === 57419 || e.keycode === 75) isLeftPressed = true;
            if (e.keycode === 57421 || e.keycode === 77) isRightPressed = true;

            // Toggle Window (Up + Down)
            if (isUpPressed && isDownPressed) {
                toggleWindow();
                isUpPressed = false;
                isDownPressed = false;
            }

            // Trigger Capture (Left + Right)
            if (isLeftPressed && isRightPressed) {
                if (mainWindow && mainWindow.isVisible()) {
                    mainWindow.webContents.send('trigger-capture');
                }
                isLeftPressed = false;
                isRightPressed = false;
            }
        });

        // STEALTH CLICK HANDLER: Manually route clicks when window is not focusable
        uIOhook.on('mousedown', (e) => {
            try {
                if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
                // Only manual route if we are in stealth mode (not focusable)
                if (isAppFocusable) return; 

                const bounds = mainWindow.getBounds();
                // Start with raw screen coordinates
                const mouseX = e.x;
                const mouseY = e.y;

                // Get the display scale factor (DPI)
                const cursorPoint = { x: mouseX, y: mouseY };
                const display = screen.getDisplayNearestPoint(cursorPoint);
                const scaleFactor = display.scaleFactor;

                // Standard Electron approach:
                // Convert physical mouse to DIPs:
                const mouseDIPsX = mouseX / scaleFactor;
                const mouseDIPsY = mouseY / scaleFactor;

                if (mouseDIPsX >= bounds.x && mouseDIPsX <= bounds.x + bounds.width &&
                    mouseDIPsY >= bounds.y && mouseDIPsY <= bounds.y + bounds.height) {
                    
                    const clientX = Math.round(mouseDIPsX - bounds.x);
                    const clientY = Math.round(mouseDIPsY - bounds.y);
                    
                    // Send logical click to renderer
                    mainWindow.webContents.send('stealth-click', { x: clientX, y: clientY });
                }
            } catch (err) {
                console.error('[uIOhook] Error in stealth click handler:', err);
            }
        });

        uIOhook.on('keyup', (e) => {
            if (e.keycode === 57416 || e.keycode === 72) isUpPressed = false;
            if (e.keycode === 57424 || e.keycode === 80) isDownPressed = false;
            if (e.keycode === 57419 || e.keycode === 75) isLeftPressed = false;
            if (e.keycode === 57421 || e.keycode === 77) isRightPressed = false;
        });

        uIOhook.start();
        console.log("uIOhook started for Arrow Up + Down shortcut.");

        // Emergency Keys
        globalShortcut.register('CommandOrControl+.', () => {
            console.log('Toggle Messages Hotkey Triggered');
            if (mainWindow) mainWindow.webContents.send('toggle-messages');
        });

        globalShortcut.register('CommandOrControl+Shift+Alt+Q', () => {
            console.log('NUKE KEY TRIGGERED');
            app.isQuitting = true;
            app.quit();
        });
    } catch (err) {
        console.error('Error during shortcut registration:', err);
    }
}

// ============================================================================
// STEALTH FEATURES
// ============================================================================

function setUltimateStealth(window) {
    if (!window || process.platform !== 'win32') return;

    // Layer 1: Enforce stealth properties
    window.setSkipTaskbar(true);
    window.setAlwaysOnTop(true, 'screen-saver', 1);

    // Layer 2: WDA_EXCLUDEFROMCAPTURE via koffi FFI (same-process call — no ACCESS_DENIED)
    try {
        const koffi = require('koffi');
        const user32 = koffi.load('user32.dll');
        const SetWindowDisplayAffinity = user32.func('bool __stdcall SetWindowDisplayAffinity(intptr hWnd, uint32_t dwAffinity)');

        const handle = window.getNativeWindowHandle();
        // Read HWND as number (works for both 32-bit and 64-bit)
        const hwnd = handle.readUInt32LE();

        // Try WDA_EXCLUDEFROMCAPTURE (0x11) — TRUE invisibility
        const result = SetWindowDisplayAffinity(hwnd, 0x00000011);
        if (result) {
            console.log('🛡️ STEALTH: WDA_EXCLUDEFROMCAPTURE — Window is TRULY INVISIBLE to all screen capture');
            return;
        }

        // Fallback: WDA_MONITOR (0x01)
        const result2 = SetWindowDisplayAffinity(hwnd, 0x00000001);
        if (result2) {
            console.log('🛡️ STEALTH: WDA_MONITOR — Window hidden from screen capture');
            return;
        }

        console.warn('🛡️ WDA both modes failed — using setContentProtection fallback');
        window.setContentProtection(true);
    } catch (e) {
        console.warn('🛡️ koffi WDA failed:', e.message, '— using setContentProtection fallback');
        window.setContentProtection(true);
    }
}