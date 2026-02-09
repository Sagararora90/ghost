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
process.on('uncaughtException', (err) => { console.error('CRITICAL UNCAUGHT EXCEPTION:', err); });
process.on('unhandledRejection', (reason) => { console.error('CRITICAL UNHANDLED REJECTION:', reason); });

const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, desktopCapturer, dialog, net } = require('electron');
const uio_lib = require('uiohook-napi');
const uIOhook = uio_lib.uIOhook || uio_lib;
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const mammoth = require('mammoth');
const Jimp = require('jimp');
const Tesseract = require('tesseract.js');
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
// app.name = "RuntimeBroker";

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

    app.whenReady().then(() => {
        createWindow();
        createTray();
        registerGlobalHotkey();
        console.log("App Initialization Complete - Shortcut Ready.");
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
        if (focusable) {
            mainWindow.focus();
        } else {
            mainWindow.blur();
            mainWindow.showInactive();
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
    }
});

ipcMain.handle('set-ignore-mouse-events', (event, ignore, options) => {
    if (mainWindow) {
        mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
    }
});

// SECURE AI GENERATION HANDLER (Moved from Renderer)
ipcMain.handle('ai-generate-response', async (event, { systemPrompt, chatHistory, maxTokens }) => {
    try {
        const groqApiKeys = store.get('groq-api-key') || '';
        // Support both newline (\n, \r\n) and comma separated keys
        const keysToTry = groqApiKeys.split(/[\n,\r]+/).map(k => k.trim()).filter(k => k.length > 0);

        if (keysToTry.length === 0) {
            throw new Error('No API Keys configured in backend.');
        }

        const HF_MODELS = [
            'meta-llama/Meta-Llama-3-8B-Instruct',
            'mistralai/Mistral-7B-Instruct-v0.3',
            'microsoft/Phi-3-mini-4k-instruct',
            'tiiuae/falcon-7b-instruct'
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
                apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;
            }

            try {
                let response;
                if (isGemini) {
                    const geminiHistory = [
                        { role: 'user', parts: [{ text: systemPrompt }] },
                        ...chatHistory.map(msg => ({
                            role: msg.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: msg.content }]
                        }))
                    ];

                    response = await net.fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: geminiHistory,
                            generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
                        })
                    });
                } else {
                    response = await net.fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${currentKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [{ role: 'system', content: systemPrompt }, ...chatHistory],
                            temperature: 0.7,
                            max_tokens: maxTokens || 800
                        })
                    });
                }

                if (!response.ok) {
                    const status = response.status;
                    if (status === 429 || status === 401 || status === 503 || status === 500) {
                        console.warn(`Key #${i + 1} (${provider}) failed (${status}). Switching...`);
                        lastError = new Error(`${provider} failed: ${status}`);
                        continue;
                    }
                    const errorText = await response.text();
                    throw new Error(`${provider} Failed (${status}): ${errorText}`);
                }

                const data = await response.json();
                if (isGemini) {
                    return { success: true, content: data.candidates[0].content.parts[0].text };
                } else {
                    return { success: true, content: data.choices[0].message.content };
                }
            } catch (err) {
                console.error(`Fetch Attempt ${i + 1} Error:`, err);
                lastError = err;
            }
        }
        throw lastError || new Error('All providers failed.');
    } catch (error) {
        console.error('Secure AI Error:', error);
        return { success: false, error: error.message };
    }
});

// SECURE WHISPER TRANSCRIPTION HANDLER
ipcMain.handle('transcribe-audio', async (event, { audioBuffer, model }) => {
    try {
        const groqApiKeys = store.get('groq-api-key') || '';
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
    try {
        const wasVisible = mainWindow.isVisible();
        if (wasVisible) {
            mainWindow.hide();
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        const img = await screenshot({ format: 'png' });
        if (wasVisible) {
            isAppFocusable = false;
            mainWindow.setFocusable(false);
            mainWindow.showInactive();
            mainWindow.setSkipTaskbar(true);
            mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
            mainWindow.blur();
        }
        return img.toString('base64');
    } catch (err) {
        console.error('Capture Error:', err);
        return null;
    }
});

ipcMain.handle('perform-ocr', async (event, base64Image) => {
    try {
        console.log("Processing OCR...");
        const buffer = Buffer.from(base64Image, 'base64');
        const image = await Jimp.read(buffer);
        image.grayscale().contrast(0.2).scale(2).normalize();
        const processedBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
        const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng');
        return text.split('\n').map(line => line.trim()).filter(line => line.length > 3);
    } catch (err) {
        console.error('OCR Error:', err);
        return [];
    }
});

ipcMain.handle('get-setting', (event, key) => {
    return store.get(key);
});

ipcMain.handle('set-setting', (event, key, value) => {
    store.set(key, value);
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
        const response = await net.fetch('https://ghostall.netlify.app/version.json');
        if (!response.ok) throw new Error('Failed to fetch version info');
        const remoteData = await response.json();
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
        if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(buffer));

        console.log('Extracting update...');
        const zip = new AdmZip(zipPath);
        const extractPath = path.join(tempDir, 'extracted');
        zip.extractAllTo(extractPath, true);

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
        
        return combinedCode || "No supported code files found in ZIP.";
    } catch (err) {
        console.error('ZIP Parsing Error:', err);
        return "Failed to parse ZIP: " + err.message;
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
        
        return combinedCode || "No supported code files found in folder.";
    } catch (err) {
        console.error('Folder Parsing Error:', err);
        return "Failed to parse folder: " + err.message;
    }
});

ipcMain.handle('parse-resume-file', async (event, filePath) => {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.pdf') {
            console.log('PDF parsing started...');
            if (typeof pdf !== 'function') {
                throw new Error("PDF parser not available.");
            }
            const data = await pdf(fileBuffer);
            if (!data || !data.text || data.text.trim().length === 0) {
                throw new Error("No text found in PDF. It might be an image-only (scanned) PDF.");
            }
            console.log('PDF Parsed! Text length:', data.text.length);
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
        return "Unsupported file format.";
    } catch (err) {
        console.error('File Parsing Error:', err);
        return "Failed to parse file: " + err.message;
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
        width: 400,
        height: 600,
        resizable: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        autoHideMenuBar: true,
        show: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: false // Set to false for production
        },
        focusable: false,
        showInactive: true,
        title: ""
    });

    mainWindow.loadFile('index.html');
    mainWindow.once('ready-to-show', () => {
        setUltimateStealth(mainWindow);
        mainWindow.setFocusable(false);
        mainWindow.showInactive();
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        isAppFocusable = false;
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
        if (mainWindow && !isAppFocusable) {
            mainWindow.setFocusable(false);
            // On Windows, showInactive helps maintain the non-focused state
            if (mainWindow.isFocused()) {
                mainWindow.blur();
                mainWindow.showInactive();
            }
        }
    }, 1000);

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

    try {
        const handle = window.getNativeWindowHandle();
        const hwnd = handle.readBigInt64LE().toString();

        const psCommand = `
            $code = @"
            using System;
            using System.Runtime.InteropServices;
            public class Stealth {
                [DllImport("user32.dll")]
                public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
            }
"@
            Add-Type -TypeDefinition $code
            [Stealth]::SetWindowDisplayAffinity([IntPtr]${hwnd}, 0x00000011)
        `;

        exec(`powershell -Command "${psCommand.replace(/\n/g, '').replace(/"/g, '\\"')}"`, (err) => {
            if (err) {
                window.setContentProtection(true);
            }
        });
    } catch (e) {
        window.setContentProtection(true);
    }
}