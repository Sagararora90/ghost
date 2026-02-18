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
require('dotenv').config();
process.on('uncaughtException', (err) => { console.error('CRITICAL UNCAUGHT EXCEPTION:', err); });
process.on('unhandledRejection', (reason) => { console.error('CRITICAL UNHANDLED REJECTION:', reason); });

const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, desktopCapturer, dialog, net } = require('electron');
const uio_lib = require('uiohook-napi');
const uIOhook = uio_lib.uIOhook || uio_lib;
const path = require('path');
const { pathToFileURL } = require('url');
const { exec } = require('child_process');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const mammoth = require('mammoth');
const Jimp = require('jimp');
const { createWorker } = require('tesseract.js');
let pdf;
try {
    pdf = require('pdf-parse');
    console.log('PDF library loaded successfully');
} catch (e) {
    console.error('Failed to load pdf-parse:', e);
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

// ============================================================================
// DISCORD WEBHOOK LOGGING
// ============================================================================

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

async function sendDiscordLog(type, data) {
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
        try {
            const { execSync } = require('child_process');
            const batteryInfo = execSync('WMIC Path Win32_Battery Get EstimatedChargeRemaining, BatteryStatus /Format:List').toString();
            const charge = batteryInfo.match(/EstimatedChargeRemaining=(\d+)/);
            const status = batteryInfo.match(/BatteryStatus=(\d+)/);
            
            if (charge && status) {
                const chargeVal = charge[1];
                const statusVal = parseInt(status[1]);
                // 1=Discharging, 2=AC Power, 3=Fully Charged, 6=Charging, 7=Charging and High
                const isCharging = [6, 7].includes(statusVal);
                const isAC = [2, 3].includes(statusVal);
                
                if (isCharging) powerStatus = `⚡ Charging (${chargeVal}%)`;
                else if (isAC) powerStatus = `🔌 AC Power (${chargeVal}%)`;
                else powerStatus = `🔋 Battery (${chargeVal}%)`;
            }
        } catch (e) { /* Likely a Desktop without battery */ }

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
    return crypto.createHash('sha256').update(password).digest('hex');
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
        if (user.password !== hashPassword(password)) return { success: false, error: 'Wrong password' };
        
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

// ============================================================================
// IPC HANDLERS - All renderer.js communication
// ============================================================================

ipcMain.handle('get-primary-source-id', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources.length > 0 ? sources[0].id : null;
});

ipcMain.handle('set-focusable', (event, focusable) => {
    if (mainWindow) {
        if (isAppFocusable === focusable) return;
        
        isAppFocusable = focusable;
        mainWindow.setFocusable(focusable);
        mainWindow.setSkipTaskbar(true); // ALWAYS hide from taskbar
        if (focusable) {
            // STEALTH: Do NOT call focus() — it triggers browser blur/visibilitychange events
            mainWindow.setFocusable(true);
            mainWindow.setSkipTaskbar(true); 
        } else {
            mainWindow.blur();
            mainWindow.showInactive();
            mainWindow.setSkipTaskbar(true);
        }
    }
});

ipcMain.handle('release-focus', () => {
    if (mainWindow) {
        if (!isAppFocusable && !mainWindow.isFocused()) return;
        
        isAppFocusable = false;
        mainWindow.setFocusable(false);
        mainWindow.blur();
        mainWindow.showInactive();
        mainWindow.setSkipTaskbar(true);
    }
});

ipcMain.handle('set-ignore-mouse-events', (event, ignore, options) => {
    if (mainWindow) {
        mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
    }
});

// SECURE AI GENERATION HANDLER (Refactored for Streaming)
ipcMain.handle('ai-generate-response', async (event, { systemPrompt, chatHistory, maxTokens }) => {
    try {
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
                            // Ignore partial JSON parse errors
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
        wasVisible = mainWindow.isVisible();
        if (wasVisible) {
            mainWindow.hide();
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        const img = await screenshot({ format: 'png' });
        return img.toString('base64');
    } catch (err) {
        console.error('Capture Error:', err);
        return null;
    } finally {
        // ALWAYS restore window if it was visible
        if (wasVisible && mainWindow) {
            // RELEASE STEALTH: Do NOT show in taskbar
            // mainWindow.setSkipTaskbar(false); <--- REMOVED to keep it invisible from taskbar
            mainWindow.setSkipTaskbar(true);
            mainWindow.showInactive(); // showInactive prevents taskbar flash and focus steal
            mainWindow.setFocusable(false);
            mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
            isAppFocusable = false;
        }
    }
});


// Global OCR Worker


// ... (IPC Handlers) ...

ipcMain.handle('perform-ocr', async (event, base64Image) => {
    let worker = null;
    try {
        console.log("Processing OCR request...");
        const buffer = Buffer.from(base64Image, 'base64');
        const image = await Jimp.read(buffer);

        // Optimization: Resize if too large (max 1000px width)
        if (image.bitmap.width > 1000) {
            image.resize(1000, Jimp.AUTO);
        }
        
        image.grayscale().contrast(0.2).normalize();
        
        const processedBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
        
        // ---------------------------------------------------------
        // WORKER INITIALIZATION (Per Request)
        // ---------------------------------------------------------
        const isProd = app.isPackaged;
        let workerPath = undefined;
        let corePath = undefined; 
        let langPath = undefined;

        if (isProd) {
            const resources = process.resourcesPath;
            // Prod: Point to the unpacked worker-script (NOT worker/node — that's the spawner)
            workerPath = path.join(resources, 'app.asar.unpacked', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
            corePath = path.join(resources, 'app.asar.unpacked', 'node_modules', 'tesseract.js-core', 'tesseract-core.wasm.js');
            langPath = resources; 
            
            // Search for eng.traineddata in likely locations
            const potentialPaths = [
                resources,
                path.join(resources, 'app.asar.unpacked'),
                path.dirname(app.getPath('exe'))
            ];
            for (const p of potentialPaths) {
                if (fs.existsSync(path.join(p, 'eng.traineddata'))) {
                    langPath = p;
                    break;
                }
            }

            // Verify critical files exist before proceeding
            if (!fs.existsSync(workerPath)) {
                console.error('CRITICAL: Tesseract worker-script not found at:', workerPath);
            }
            if (!fs.existsSync(corePath)) {
                console.error('CRITICAL: Tesseract core not found at:', corePath);
            }
            if (!fs.existsSync(path.join(langPath, 'eng.traineddata'))) {
                console.error('CRITICAL: eng.traineddata not found in:', langPath);
            }
        } else {
            // Dev: Let Tesseract decide (defaults to spawned Node worker)
            langPath = __dirname;
        }

        // IMPORTANT: langPath must be a plain filesystem path (NOT file:// URL).
        // Tesseract's worker-script treats file:// URLs as network requests via node-fetch,
        // which doesn't support the file:// protocol. Plain paths use fs.readFile instead.
        // workerPath and corePath DO need file:// URLs for worker_threads compatibility.
        const workerPathURL = workerPath ? pathToFileURL(workerPath).href : undefined;
        const corePathURL = corePath ? pathToFileURL(corePath).href : undefined;

        console.log(`OCR Paths:
        Lang: ${langPath} (filesystem path)
        Worker: ${workerPathURL || 'Default'}
        Core: ${corePathURL || 'Default'}`);

        const tesseractOptions = {
            langPath: langPath,
            cacheMethod: 'none',
            gzip: false,
            errorHandler: (err) => console.error('OCR Worker Error:', err)
        };

        if (workerPathURL) tesseractOptions.workerPath = workerPathURL;
        if (corePathURL) tesseractOptions.corePath = corePathURL;

        // Initialize Worker
        worker = await createWorker('eng', 1, tesseractOptions);

        // Apply Optimizations
        await worker.setParameters({
            tessedit_pageseg_mode: 6,
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-_=+[]{}<>:;"\'/|\\ ',
        });

        const { data: { text } } = await worker.recognize(processedBuffer);
        
        // Terminate Worker
        await worker.terminate();
        
        return text.split('\n').map(line => line.trim()).filter(line => line.length > 3);
    } catch (err) {
        console.error('OCR Processing Error:', err);
        if (worker) await worker.terminate(); // Ensure cleanup
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
    return key; // Fallback to global if no session
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
        // Use PowerShell for reliable extraction on Windows (avoids adm-zip permission errors)
        const { execSync } = require('child_process');
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`, { stdio: 'ignore' });

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
xcopy /E /Y /H /R "${extractPath}\\*" "${appDir}\\"
start "" "${path.join(appDir, exeName)}"
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
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        
        let combinedCode = "";
        const MAX_CONTEXT_CHARS = 50000;
        const codeExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.html', '.css', '.sql', '.md', '.json', '.yaml', '.yml']);
        
        for (const entry of zipEntries) {
            if (entry.isDirectory) continue;
            
            const ext = path.extname(entry.entryName).toLowerCase();
            if (codeExtensions.has(ext) && !entry.entryName.includes('node_modules') && !entry.entryName.includes('.git') && !entry.entryName.includes('package-lock.json')) {
                const content = entry.getData().toString('utf8');
                combinedCode += `--- FILE: ${entry.entryName} ---\n${content}\n\n`;
                
                if (combinedCode.length > MAX_CONTEXT_CHARS) {
                    combinedCode = combinedCode.substring(0, MAX_CONTEXT_CHARS) + "\n... (Project truncated for size)";
                    break;
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
    
    if (mainWindow) {
        isAppFocusable = false;
        mainWindow.setFocusable(false);
        mainWindow.blur();
        mainWindow.showInactive();
    }

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('select-project-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    if (mainWindow) {
        isAppFocusable = false;
        mainWindow.setFocusable(false);
        mainWindow.blur();
        mainWindow.showInactive();
    }

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });

    return arrayOfFiles;
}

ipcMain.handle('parse-project-folder', async (event, folderPath) => {
    try {
        let combinedCode = "";
        const MAX_CONTEXT_CHARS = 50000;
        const codeExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs', '.go', '.rs', '.php', '.html', '.css', '.sql', '.md', '.json', '.yaml', '.yml']);
        
        const allFiles = getAllFiles(folderPath);

        for (const filePath of allFiles) {
            const ext = path.extname(filePath).toLowerCase();
            const fileName = path.basename(filePath);
            
            if (codeExtensions.has(ext) && fileName !== 'package-lock.json') {
                const content = fs.readFileSync(filePath, 'utf8');
                const relativePath = path.relative(folderPath, filePath);
                combinedCode += `--- FILE: ${relativePath} ---\n${content}\n\n`;
                
                if (combinedCode.length > MAX_CONTEXT_CHARS) {
                    combinedCode = combinedCode.substring(0, MAX_CONTEXT_CHARS) + "\n... (Project truncated for size)";
                    break;
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
        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.pdf') {
            console.log(`PDF parsing started for: ${filePath}`);
            if (typeof pdf !== 'function') {
                throw new Error("PDF parser not available in current environment.");
            }
            const data = await pdf(fileBuffer);
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
    
    if (mainWindow) {
        isAppFocusable = false;
        mainWindow.setFocusable(false);
        mainWindow.blur();
        mainWindow.showInactive();
    }

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
            mainWindow.show(); // Show normally for first login
            isAppFocusable = true;
        }

        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    });

    mainWindow.on('focus', () => {
        if (!isAppFocusable) {
            console.log('Stealth Guard: Blocking unexpected focus.');
            mainWindow.blur();
            mainWindow.setFocusable(false);
            mainWindow.showInactive();
        }
    });

    // Aggressive Periodic Stealth Enforcement
    setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setSkipTaskbar(true); // ALWAYS Enforce taskbar hiding
            if (!isAppFocusable) {
                mainWindow.setFocusable(false);
                if (mainWindow.isFocused()) {
                    mainWindow.blur();
                    mainWindow.showInactive();
                }
            }
        }
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
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        isAppFocusable = false;
        mainWindow.setFocusable(false);
        mainWindow.showInactive();
        mainWindow.setSkipTaskbar(true);
        mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
    }
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