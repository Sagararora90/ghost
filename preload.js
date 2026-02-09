const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Screen Capture & OCR
    captureScreen: () => ipcRenderer.invoke('capture-screen'),
    performOcr: (image) => ipcRenderer.invoke('perform-ocr', image),
    aiGenerateResponse: (params) => ipcRenderer.invoke('ai-generate-response', params),
    transcribeAudio: (params) => ipcRenderer.invoke('transcribe-audio', params),
    
    // Focus Management (Ghost Mode)
    setFocusable: (state) => ipcRenderer.invoke('set-focusable', state),
    releaseFocus: () => ipcRenderer.invoke('release-focus'),
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke('set-ignore-mouse-events', ignore, options),
    
    // Audio Capture for Meeting Mode
    getPrimarySourceId: () => ipcRenderer.invoke('get-primary-source-id'),
    
    // Event Listeners (Hotkeys from Main Process)
    onToggleMessages: (callback) => ipcRenderer.on('toggle-messages', () => callback()),
    onTriggerCapture: (callback) => ipcRenderer.on('trigger-capture', (event, ...args) => callback(...args)),
    
    // Settings Storage
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    
    // File Upload & Parsing
    selectResumeFile: () => ipcRenderer.invoke('select-resume-file'),
    parseResumeFile: (path) => ipcRenderer.invoke('parse-resume-file', path),
    selectProjectFile: () => ipcRenderer.invoke('select-project-file'),
    parseProjectZip: (path) => ipcRenderer.invoke('parse-project-zip', path),
    selectProjectFolder: () => ipcRenderer.invoke('select-project-folder'),
    parseProjectFolder: (path) => ipcRenderer.invoke('parse-project-folder', path),
    
    // Clipboard (Stealth Copy)
    copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
    
    // Version Info
    getVersion: () => process.versions.electron
});