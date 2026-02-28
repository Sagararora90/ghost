const { contextBridge, ipcRenderer } = require('electron');

// Input validation helpers
const validators = {
    isString: (val) => typeof val === 'string',
    isBoolean: (val) => typeof val === 'boolean',
    isObject: (val) => val && typeof val === 'object' && !Array.isArray(val),
    isValidPath: (path) => {
        if (typeof path !== 'string') return false;
        // Prevent directory traversal
        const normalized = path.replace(/\\/g, '/');
        return !normalized.includes('../') && !normalized.includes('..\\');
    },
    maxLength: (str, max) => typeof str === 'string' && str.length <= max
};

// Safe wrapper for invoke
const safeInvoke = async (channel, ...args) => {
    try {
        return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
        console.error(`IPC Error [${channel}]:`, error);
        return { success: false, error: error.message };
    }
};

contextBridge.exposeInMainWorld('electronAPI', {
    // Screen Capture & OCR
    captureScreen: () => safeInvoke('capture-screen'),
    
    performOcr: (image) => {
        if (!validators.isString(image) || !validators.maxLength(image, 10 * 1024 * 1024)) {
            return Promise.reject(new Error('Invalid image data'));
        }
        return safeInvoke('perform-ocr', image);
    },
    
    aiGenerateResponse: (params) => {
        if (!validators.isObject(params)) {
            return Promise.reject(new Error('Invalid parameters'));
        }
        return safeInvoke('ai-generate-response', params);
    },
    
    transcribeAudio: (params) => {
        if (!validators.isObject(params)) {
            return Promise.reject(new Error('Invalid audio parameters'));
        }
        return safeInvoke('transcribe-audio', params);
    },
    
    // Focus Management
    setFocusable: (state, shouldFocus = false) => {
        if (!validators.isBoolean(state)) {
            return Promise.reject(new Error('State must be boolean'));
        }
        return safeInvoke('set-focusable', state, shouldFocus);
    },
    
    releaseFocus: () => safeInvoke('release-focus'),
    
    setIgnoreMouseEvents: (ignore, options = {}) => {
        if (!validators.isBoolean(ignore) || !validators.isObject(options)) {
            return Promise.reject(new Error('Invalid arguments'));
        }
        return safeInvoke('set-ignore-mouse-events', ignore, options);
    },
    
    // Audio Capture
    getPrimarySourceId: () => safeInvoke('get-primary-source-id'),
    
    // Event Listeners with cleanup
    onToggleMessages: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('toggle-messages', handler);
        return () => ipcRenderer.removeListener('toggle-messages', handler);
    },
    
    onTriggerCapture: (callback) => {
        const handler = (_, ...args) => callback(...args);
        ipcRenderer.on('trigger-capture', handler);
        return () => ipcRenderer.removeListener('trigger-capture', handler);
    },
    
    onAiStreamingChunk: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('ai-streaming-chunk', handler);
        return () => ipcRenderer.removeListener('ai-streaming-chunk', handler);
    },
    
    onAiStreamingComplete: (callback) => {
        const handler = () => callback();
        ipcRenderer.on('ai-streaming-complete', handler);
        return () => ipcRenderer.removeListener('ai-streaming-complete', handler);
    },
    
    onAiStreamingError: (callback) => {
        const handler = (_, data) => callback(data);
        ipcRenderer.on('ai-streaming-error', handler);
        return () => ipcRenderer.removeListener('ai-streaming-error', handler);
    },
    
    onStealthClick: (callback) => {
        const handler = (_, coords) => callback(coords);
        ipcRenderer.on('stealth-click', handler);
        return () => ipcRenderer.removeListener('stealth-click', handler);
    },
    
    // Settings Storage
    getSetting: (key) => {
        if (!validators.isString(key) || !validators.maxLength(key, 100)) {
            return Promise.reject(new Error('Invalid key'));
        }
        return safeInvoke('get-setting', key);
    },
    
    setSetting: (key, value) => {
        if (!validators.isString(key) || !validators.maxLength(key, 100)) {
            return Promise.reject(new Error('Invalid key'));
        }
        return safeInvoke('set-setting', key, value);
    },
    
    // File Upload & Parsing
    selectResumeFile: () => safeInvoke('select-resume-file'),
    
    parseResumeFile: (path) => {
        if (!validators.isValidPath(path)) {
            return Promise.reject(new Error('Invalid file path'));
        }
        return safeInvoke('parse-resume-file', path);
    },
    
    selectProjectFile: () => safeInvoke('select-project-file'),
    
    parseProjectZip: (path) => {
        if (!validators.isValidPath(path)) {
            return Promise.reject(new Error('Invalid file path'));
        }
        return safeInvoke('parse-project-zip', path);
    },
    
    selectProjectFolder: () => safeInvoke('select-project-folder'),
    
    parseProjectFolder: (path) => {
        if (!validators.isValidPath(path)) {
            return Promise.reject(new Error('Invalid folder path'));
        }
        return safeInvoke('parse-project-folder', path);
    },
    
    // Clipboard
    copyToClipboard: (text) => {
        if (!validators.isString(text) || !validators.maxLength(text, 1000000)) {
            return Promise.reject(new Error('Invalid clipboard data'));
        }
        return safeInvoke('copy-to-clipboard', text);
    },
    
    // Version & Updates - FIXED: No direct process access
    getVersion: () => safeInvoke('get-electron-version'),
    getAppVersion: () => safeInvoke('get-app-version'),
    checkForUpdates: () => safeInvoke('check-for-updates'),
    
    applyUpdate: (url) => {
        if (!validators.isString(url) || !url.startsWith('https://')) {
            return Promise.reject(new Error('Invalid update URL'));
        }
        return safeInvoke('apply-update', url);
    },
    
    openExternal: (url) => {
        if (!validators.isString(url) || !(url.startsWith('http://') || url.startsWith('https://'))) {
            return Promise.reject(new Error('Invalid URL'));
        }
        return safeInvoke('open-external', url);
    },

    // Auth System
    authLogin: (username, password) => {
        if (!validators.isString(username) || !validators.isString(password)) {
            return Promise.reject(new Error('Invalid credentials'));
        }
        if (!validators.maxLength(username, 50) || !validators.maxLength(password, 100)) {
            return Promise.reject(new Error('Credentials too long'));
        }
        return safeInvoke('auth-login', username, password);
    },
    
    authSignup: (username, password, apiKeys) => {
        if (!validators.isString(username) || !validators.isString(password) || !validators.isString(apiKeys)) {
            return Promise.reject(new Error('Invalid signup data'));
        }
        return safeInvoke('auth-signup', username, password, apiKeys);
    },
    
    authCheck: () => safeInvoke('auth-check'),
    authLogout: () => safeInvoke('auth-logout'),
    
    logToMain: (msg) => {
        if (validators.isString(msg) && validators.maxLength(msg, 1000)) {
            ipcRenderer.send('log-to-main', msg);
        }
    },

    // Window Controls
    hideWindow: () => ipcRenderer.send('hide-window'),
    quitApp: () => ipcRenderer.send('quit-app'),
    windowMove: (x, y) => ipcRenderer.send('window-move', { x, y })
});