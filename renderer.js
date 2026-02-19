// SECURE MODE: AI URLs and keys moved to Main Process (main.js)
let GROQ_API_KEYS = []; // For UI display only
const WHISPER_MODEL = 'whisper-large-v3';

// Configuration Constants
const CONFIG = {
    MAX_CHAT_HISTORY: 10,
    MAX_CONTEXT_CHARS: 15000,
    AUDIO_CHUNK_DURATION_MS: 3000,
    MAX_TOKENS: 512,
    FOCUS_LIMIT: 500,
    TTS_SPEECH_RATE: 1.1
};

// Silence console for stealth (commented out for development)
// console.log = () => {};
// console.error = () => {};

let USER_BIO = '';
let USER_JD = '';
let USER_PROJECTS = '';

// File Manager State
let storedResumes = [];
let storedJDs = [];
let storedProjects = [];

// DOM Elements
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesList = document.getElementById('messages');
const chatContainer = document.getElementById('chatContainer');
const analyseScreenBtn = document.getElementById('analyseScreenBtn'); 
const listenBtn = document.getElementById('listenBtn');
const answerQuestionBtn = document.getElementById('answerQuestionBtn');
const hideBtn = document.getElementById('hideBtn');
const exitBtn = document.getElementById('exitBtn');
const stopListeningBtn = document.getElementById('stopListeningBtn');
const ocrOverlay = document.getElementById('ocrOverlay');
const ocrLinesContainer = document.getElementById('ocrLines');
const cancelOcrBtn = document.getElementById('cancelOcr');
const sendOcrBtn = document.getElementById('sendOcr');
const listeningIndicator = document.getElementById('listeningIndicator');

// Chat State
let chatHistory = [];
let selectedOcrLines = new Set();
let isMeetingMode = false;
let mediaRecorder = null;
let audioChunks = [];
let transcriptionBuffer = "";

// Advanced Features State
let isTtsEnabled = false;
let voicesLoaded = false;
let isSignupMode = false;
let ttsQueue = [];
let isSpeaking = false;

// Streaming Global State
let activeStreamingBody = null;
let activeAccumulator = "";

// Focus Management
let focusCount = 0;
let isIgnoringMouse = false; // Global state for stealth mode mouse handling
let isOverlayOpen = false; // CRITICAL: Stop interceptor when overlay is open

// ===== UTILITY FUNCTIONS =====

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== AUTH SYSTEM =====

function setupAuth() {
    const overlay = document.getElementById('authOverlay');
    const title = document.getElementById('authTitle');
    const username = document.getElementById('authUsername');
    const password = document.getElementById('authPassword');
    const error = document.getElementById('authError');
    const submit = document.getElementById('authSubmit');
    const toggleBtn = document.getElementById('authToggleBtn');
    const toggleText = document.getElementById('authToggleText');
    if (!overlay) return;

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isSignupMode = !isSignupMode;
        title.textContent = isSignupMode ? 'Create Account' : 'Login';
        submit.textContent = isSignupMode ? 'Create Account' : 'Login';
        toggleText.textContent = isSignupMode ? 'Already have an account?' : "Don't have an account?";
        toggleBtn.textContent = isSignupMode ? 'Login' : 'Create Account';
        error.classList.add('hidden');
        
        const keyInput = document.getElementById('authKeyInput');
        if (keyInput) {
            if (isSignupMode) keyInput.classList.remove('hidden');
            else keyInput.classList.add('hidden');
        }
    });

    submit.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await handleAuthSubmit();
    });

    password.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); await handleAuthSubmit(); }
    });
    username.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); password.focus(); }
    });
}

async function handleAuthSubmit() {
    const error = document.getElementById('authError');
    const submit = document.getElementById('authSubmit');
    const usernameEl = document.getElementById('authUsername');
    const passwordEl = document.getElementById('authPassword');
    
    if (!usernameEl || !passwordEl || !error || !submit) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    if (!username || !password) {
        error.textContent = 'Please enter username and password';
        error.classList.remove('hidden');
        return;
    }

    if (username.length < 3 || password.length < 4) {
        error.textContent = 'Username (min 3) and Pasword (min 4) required';
        error.classList.remove('hidden');
        return;
    }

    submit.disabled = true;
    submit.textContent = 'Please wait...';
    error.classList.add('hidden');

    try {
        let result;
        if (isSignupMode) {
            const keyEl = document.getElementById('authKeyInput');
            const apiKeys = keyEl ? keyEl.value.trim() : '';
            result = await window.electronAPI.authSignup(username, password, apiKeys);
        } else {
            result = await window.electronAPI.authLogin(username, password);
        }

        if (result.success) {
            document.getElementById('authOverlay').classList.add('hidden');
            await continueInit();
            
            const onboardingOverlay = document.getElementById('onboardingOverlay');
            if (onboardingOverlay && onboardingOverlay.classList.contains('hidden')) {
                await window.electronAPI.setFocusable(false);
                updateGhostStatus(true);
            }
        } else {
            error.textContent = result.error || 'Authentication failed';
            error.classList.remove('hidden');
        }
    } catch (e) {
        error.textContent = 'Connection error';
        error.classList.remove('hidden');
    }

    submit.disabled = false;
    submit.textContent = isSignupMode ? 'Create Account' : 'Login';
}

// ===== INITIALIZATION =====

async function init() {
    window.electronAPI.onAiStreamingChunk((data) => {
        if (activeStreamingBody) {
            activeAccumulator += data.content;
            activeStreamingBody.textContent = activeAccumulator;
            scrollToBottom();
        }
    });

    window.electronAPI.onAiStreamingError((data) => {
        if (activeStreamingBody) {
            activeStreamingBody.textContent = `Error: ${data.error}`;
            activeStreamingBody.classList.add('error-text');
        }
        setLoading(false);
    });

    try {
        const auth = await window.electronAPI.authCheck();
        setupAuth();
        
        if (!auth.loggedIn) {
            await window.electronAPI.setFocusable(true);
            const authOverlay = document.getElementById('authOverlay');
            const authUsername = document.getElementById('authUsername');
            if (authOverlay) authOverlay.classList.remove('hidden');
            if (authUsername) setTimeout(() => authUsername.focus(), 100);
            return;
        }

        await continueInit();
    } catch (error) {
        console.error('Initialisation Error:', error);
    }
}

async function continueInit() {
    try {
        renderHistory();
        await loadSettings();
        setupEventListeners();
        autoResizeInput();
        checkOnboarding();
        
        if (window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = () => {
                voicesLoaded = true;
            };
            window.speechSynthesis.getVoices();
        }

        const fc = document.getElementById('focusCounter');
        if (fc) fc.textContent = focusCount > 0 ? `Focus: ${focusCount}` : '0';

        checkForAppUpdates();
        checkFirstRun();
        
        // Add memory cleanup interval
        setInterval(cleanupMemory, 5 * 60 * 1000);
        
    } catch (error) {
        console.error('App Init Error:', error);
    }
}

async function loadSettings() {
    const keys = await window.electronAPI.getSetting('groq-api-key') || '';
    GROQ_API_KEYS = keys.split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0);
    
    if (GROQ_API_KEYS.length === 0 && keys.length > 10) GROQ_API_KEYS = [keys];

    USER_BIO = await window.electronAPI.getSetting('user-bio') || '';
    USER_JD = await window.electronAPI.getSetting('user-jd') || '';
    USER_PROJECTS = await window.electronAPI.getSetting('user-projects') || '';
    
    storedResumes = await window.electronAPI.getSetting('stored-resumes') || [];
    storedJDs = await window.electronAPI.getSetting('stored-jds') || [];
    storedProjects = await window.electronAPI.getSetting('stored-projects') || [];

    chatHistory = await window.electronAPI.getSetting('invisible-chat-history') || [];
    focusCount = parseInt(await window.electronAPI.getSetting('focus-count') || '0');

    document.getElementById('groqKeyInput').value = GROQ_API_KEYS.join('\n');
    document.getElementById('userBioInput').value = USER_BIO;
    if (document.getElementById('userJdInput')) document.getElementById('userJdInput').value = USER_JD;
    if (document.getElementById('userProjectsInput')) document.getElementById('userProjectsInput').value = USER_PROJECTS;
    
    const fc = document.getElementById('focusCounter');
    if (fc) fc.textContent = focusCount > 0 ? `Focus: ${focusCount}` : '0';

    renderFileLists();
    updateKeywordTicker();
}

function renderFileLists() {
    renderList('resumeFileList', storedResumes, 'resume');
    renderList('jdFileList', storedJDs, 'jd');
    renderList('projectFileList', storedProjects, 'project');
}

function renderList(elementId, dataArray, type) {
    const container = document.getElementById(elementId);
    if (!container) return;
    container.innerHTML = '';
    
    dataArray.forEach((file, index) => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        chip.innerHTML = `<span>${file.name}</span><span class="remove-file" data-type="${type}" data-index="${index}" data-tooltip="Remove">&times;</span>`;
        container.appendChild(chip);
    });
}

function removeFile(type, index) {
    if (type === 'resume') storedResumes.splice(index, 1);
    if (type === 'jd') storedJDs.splice(index, 1);
    if (type === 'project') storedProjects.splice(index, 1);
    renderFileLists();
}

function checkOnboarding() {
    if (GROQ_API_KEYS.length === 0) {
        document.getElementById('onboardingOverlay').classList.remove('hidden');
    }
}

// ===== EVENT LISTENERS =====

function setupEventListeners() {
    if (hideBtn) hideBtn.addEventListener('click', () => {
        window.electronAPI.hideWindow();
    });

    if (exitBtn) exitBtn.addEventListener('click', () => {
         window.electronAPI.quitApp();
    });

    const fc = document.getElementById('focusCounter');
    if (fc) {
        fc.addEventListener('click', async () => {
            await resetFocusCounter();
        });
    }

    if (stopListeningBtn) stopListeningBtn.addEventListener('click', () => {
        listeningIndicator.classList.add('hidden');
        stopListeningBtn.classList.add('hidden');
    });

    if (analyseScreenBtn) analyseScreenBtn.addEventListener('click', startScreenGrab);
    if (listenBtn) listenBtn.addEventListener('click', toggleMeetingMode);
    if (answerQuestionBtn) answerQuestionBtn.addEventListener('click', () => {
        messageInput.focus();
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', autoResizeInput);

    messageInput.addEventListener('mousedown', async (e) => {
        if (focusCount >= CONFIG.FOCUS_LIMIT) {
            e.preventDefault();
            console.log('Focus limit reached. Input blocked.');
            messageInput.classList.add('input-disabled');
            messageInput.placeholder = "Focus limit reached (Max 500). Use OCR.";
            return;
        }

        // INPUT CLICK: Must Force Window Focus
        await window.electronAPI.setFocusable(true, true);
        updateGhostStatus(false);
        setTimeout(() => messageInput.focus(), 10);
    });

    window.electronAPI.onToggleMessages(() => {
        console.log('Panic toggle received');
        const inputSection = document.querySelector('.input-section');
        chatContainer.classList.toggle('hidden');
        if (inputSection) inputSection.classList.toggle('hidden');
        if (chatContainer.classList.contains('hidden')) {
            hideOcrOverlay();
        }
    });

    window.electronAPI.onTriggerCapture(() => {
        startScreenGrab();
    });
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // STEALTH CLICK HANDLER
    window.electronAPI.onStealthClick((coords) => {
        console.log(`[Stealth] Virtual click at ${coords.x}, ${coords.y}`);
        const element = document.elementFromPoint(coords.x, coords.y);
        if (element) console.log(`[Stealth] Hit Element: ${element.tagName} .${element.className} ID:${element.id}`);
        
        if (element) {
            // Check if it's an interactive element (button, etc)
            const clickable = element.closest('button, .ocr-line, .file-chip, .remove-file, .copy-btn, input, textarea, .action-pill');
            if (clickable) {
            // STEALTH INTERACTION SEQUENCE
            // 1. Dispatch mousedown (triggers our app logic in renderer.js)
            // Note: We don't update lastGlobalClickTime here because WE want this to fire.
            // The global listener will update it.
            const mousedown = new MouseEvent('mousedown', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: coords.x,
                clientY: coords.y
            });
            element.dispatchEvent(mousedown);

            // 2. Dispatch mouseup (for completeness)
            const mouseup = new MouseEvent('mouseup', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: coords.x,
                clientY: coords.y
            });
            element.dispatchEvent(mouseup);

            // 3. Dispatch click (for standard listeners)
            const click = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: coords.x,
                clientY: coords.y
            });
            element.dispatchEvent(click);
            
            // Special case for inputs: If they click input via stealth, FORCE focus
            // This is the ONLY time we force window activation
            if (clickable.tagName === 'INPUT' || clickable.tagName === 'TEXTAREA') {
                window.electronAPI.setFocusable(true, true).then(() => {
                        setTimeout(() => clickable.focus(), 50);
                });
            }
        } else {
            // Non-interactive click (background/text)
            // Still dispatch safe standard click for OCR selection etc.
            const click = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: coords.x,
                clientY: coords.y
            });
            element.dispatchEvent(click);
        }
        }
    });
}

function handleKeyboardShortcuts(e) {
    if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        messageInput.focus();
    }
    
    if (e.key === 'Escape') {
        const overlays = document.querySelectorAll('.overlay:not(.hidden)');
        if (overlays.length > 0) {
            overlays.forEach(o => o.classList.add('hidden'));
            window.electronAPI.setFocusable(false);
            window.electronAPI.releaseFocus();
            updateGhostStatus(true);
        }
    }
    
    if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        if (confirm('Clear chat history?')) {
            chatHistory = [];
            saveHistory();
            renderHistory();
        }
    }
}

async function resetFocusCounter() {
    focusCount = 0;
    await window.electronAPI.setSetting('focus-count', '0');
    messageInput.classList.remove('input-disabled');
    messageInput.placeholder = "Type your message...";
    
    const focusCounter = document.getElementById('focusCounter');
    if (focusCounter) {
        focusCounter.textContent = '0';
        focusCounter.style.color = '#4CAF50';
        setTimeout(() => {
            focusCounter.style.color = '';
        }, 2000);
    }
    
    showToast('Focus Counter Reset', 'success');
}

// ===== FILE UPLOAD HANDLERS =====

async function handleResumeUpload() {
    const filePath = await window.electronAPI.selectResumeFile();
    if (!filePath) return;
    
    const status = document.getElementById('uploadStatus');
    const fileName = filePath.split(/[\\/]/).pop();
    
    status.classList.remove('hidden');
    status.style.color = '#fff';
    status.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <div class="spinner" style="width: 16px; height: 16px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <span>Parsing ${fileName}...</span>
        </div>
    `;
    
    try {
        console.log('Requesting parsing for:', filePath);
        const text = await window.electronAPI.parseResumeFile(filePath);
        
        if (!text || text.trim().length === 0) {
            throw new Error("No text content extracted");
        }
        
        storedResumes.push({ name: fileName, content: text }); 
        await window.electronAPI.setSetting('stored-resumes', storedResumes);
        
        renderFileLists();
        
        status.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #22c55e;">✅</span>
                <span>Done! Extracted ${text.length} characters</span>
            </div>
        `;
        
        setTimeout(() => status.classList.add('hidden'), 3000);
        
    } catch (err) {
        console.error('Resume parse error:', err);
        status.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: #ef4444;">❌</span>
                <span>Error: ${err.message || "Failed to parse"}</span>
            </div>
        `;
        status.style.color = "#ef4444";
        setTimeout(() => status.classList.add('hidden'), 5000);
    }
}

async function handleJdUpload() {
    const filePath = await window.electronAPI.selectResumeFile(); 
    if (!filePath) return;
    
    const status = document.getElementById('jdUploadStatus');
    const fileName = filePath.split(/[\\/]/).pop();
    
    status.classList.remove('hidden');
    status.style.color = '#fff';
    status.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <div class="spinner"></div>
            <span>Parsing ${fileName}...</span>
        </div>
    `;
    
    try {
        const text = await window.electronAPI.parseResumeFile(filePath);
        if (text && text.trim().length > 0) {
            storedJDs.push({ name: fileName, content: text });
            await window.electronAPI.setSetting('stored-jds', storedJDs);
            renderFileLists();
            status.innerHTML = `<span style="color: #22c55e;">✅</span> Done!`;
        } else {
            throw new Error("No text content extracted.");
        }
    } catch (err) {
        console.error('JD parse error:', err);
        status.innerHTML = `<span style="color: #ef4444;">❌</span> Error: ${err.message || "Failed to parse"}`;
        status.style.color = "#ef4444";
    }
    setTimeout(() => status.classList.add('hidden'), 5000);
}

async function handleProjectUpload() {
    const filePath = await window.electronAPI.selectProjectFile();
    if (!filePath) return;
    
    const status = document.getElementById('projectUploadStatus');
    const fileName = filePath.split(/[\\/]/).pop();
    
    status.classList.remove('hidden');
    status.style.color = '#fff';
    status.innerHTML = '<div class="spinner"></div> Parsing...';
    
    try {
        const text = await window.electronAPI.parseProjectZip(filePath);
        if (text) {
            storedProjects.push({ name: fileName, content: text }); 
            await window.electronAPI.setSetting('stored-projects', storedProjects);
            renderFileLists();
            status.innerHTML = '<span style="color: #22c55e;">✅</span> Done!';
        }
    } catch (err) {
        console.error('Project upload error:', err);
        status.innerHTML = `<span style="color: #ef4444;">❌</span> Error: ${err.message || "Failed to parse"}`;
        status.style.color = "#ef4444";
    }
    setTimeout(() => status.classList.add('hidden'), 5000);
}

async function handleProjectFolderUpload() {
    const filePath = await window.electronAPI.selectProjectFolder();
    if (!filePath) return;
    
    const status = document.getElementById('projectUploadStatus');
    const folderName = filePath.split(/[\\/]/).pop() + "/"; 
    
    status.classList.remove('hidden');
    status.style.color = '#fff';
    status.innerHTML = '<div class="spinner"></div> Scanning Folder...';
    
    try {
        const text = await window.electronAPI.parseProjectFolder(filePath);
        if (text) {
            storedProjects.push({ name: folderName, content: text }); 
            await window.electronAPI.setSetting('stored-projects', storedProjects);
            renderFileLists();
            status.innerHTML = '<span style="color: #22c55e;">✅</span> Done!';
        }
    } catch (err) {
        console.error('Folder upload error:', err);
        status.innerHTML = `<span style="color: #ef4444;">❌</span> Error: ${err.message || "Failed to parse"}`;
        status.style.color = "#ef4444";
    }
    setTimeout(() => status.classList.add('hidden'), 5000);
}

// ===== SCREEN CAPTURE & OCR =====

async function startScreenGrab() {
    try {
        setLoading(true);
        // Ensure interactive state BEFORE we potentially lose it during capture
        isOverlayOpen = true; 
        
        const base64Image = await window.electronAPI.captureScreen();
        
        if (!base64Image) {
            throw new Error('Failed to capture screen');
        }

        await showOcrOverlay(true);
        
        const lines = await window.electronAPI.performOcr(base64Image);
        
        if (!lines || lines.length === 0) {
            renderOcrLines([]);
        } else {
            renderOcrLines(lines);
        }
        
    } catch (error) {
        console.error('Screen Grab Error:', error);
        hideOcrOverlay();
        showToast('Screen capture failed', 'error');
    } finally {
        setLoading(false);
    }
}

async function showOcrOverlay(isLoading = false) {
    window.electronAPI.logToMain(`[DEBUG] showOcrOverlay called, isLoading: ${isLoading}`);
    ocrOverlay.classList.remove('hidden');
    // FORCE INTERACTIVE STATE & STOP INTERCEPTOR
    isOverlayOpen = true; 
    isIgnoringMouse = false;
    
    // CRITICAL: Window must be focusable to receive clicks on Windows
    window.electronAPI.logToMain(`[DEBUG] Requesting Focusable: true`);
    // OCR: Just needs clicks, not focus stealing (unless user clicks input later)
    // REMOVED setFocusable(true) to prevent floating focus. Rely on setIgnoreMouseEvents(false).
    
    // NUCLEAR FIX: Flush 'forward' state by disabling it first
    window.electronAPI.logToMain(`[DEBUG] Requesting setIgnoreMouseEvents: true (forward: false)`);
    await window.electronAPI.setIgnoreMouseEvents(true, { forward: false });
    
    window.electronAPI.logToMain(`[DEBUG] Requesting setIgnoreMouseEvents: false`);
    await window.electronAPI.setIgnoreMouseEvents(false);

    window.electronAPI.logToMain(`[DEBUG] showOcrOverlay state updates complete`);

    if (isLoading) {
        ocrLinesContainer.innerHTML = '<div class="message system"><div class="bubble">Scanning screen for text...</div></div>';
        updateOcrButtonState();
    }
}

async function hideOcrOverlay() {
    ocrOverlay.classList.add('hidden');
    
    // SMART SLEEP Fix:
    // We do NOT force sleep here. If the mouse is still over the window, it should remain interactive.
    // The global 'mousemove' interceptor will handle putting the app to sleep when the mouse leaves.
    
    // Just ensure the overlay state is reset so the interceptor knows we are "idle"
    isOverlayOpen = false;

    selectedOcrLines.clear();
    setLoading(false);
    sendButton.disabled = false;
    messageInput.disabled = false;
    updateGhostStatus(true);
}

function renderOcrLines(lines) {
    ocrLinesContainer.innerHTML = '';
    selectedOcrLines.clear();
    updateOcrButtonState();

    if (lines.length === 0) {
        ocrLinesContainer.innerHTML = '<div class="message system"><div class="bubble">No text detected on screen.</div></div>';
        return;
    }

    if (lines.length === 1 && lines[0].startsWith('Error:')) {
         ocrLinesContainer.innerHTML = `<div class="message system"><div class="bubble error-text">${lines[0]}</div></div>`;
         return;
    }

    lines.forEach((line, index) => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'ocr-line';
        lineDiv.textContent = line;
        lineDiv.dataset.index = index;
        lineDiv.setAttribute('tabindex', '-1');
        ocrLinesContainer.appendChild(lineDiv);
    });
}

function toggleOcrLine(lineDiv) {
    const line = lineDiv.textContent;
    if (selectedOcrLines.has(line)) {
        selectedOcrLines.delete(line);
        lineDiv.classList.remove('selected');
    } else {
        selectedOcrLines.add(line);
        lineDiv.classList.add('selected');
    }
    updateOcrButtonState();
}

function updateOcrButtonState() {
    const count = selectedOcrLines.size;
    if (count > 0) {
        sendOcrBtn.style.opacity = "1";
        sendOcrBtn.style.pointerEvents = "auto";
        sendOcrBtn.disabled = false;
    } else {
        sendOcrBtn.style.opacity = "0.5";
        sendOcrBtn.style.pointerEvents = "none";
        sendOcrBtn.disabled = true;
    }
}

async function sendSelectedOcrText() {
    const combinedText = Array.from(selectedOcrLines).join('\n');
    messageInput.value += (messageInput.value ? '\n' : '') + combinedText;
    hideOcrOverlay();
    // SMART SLEEP: Don't force sleep. Let interceptor handle it.
    isIgnoringMouse = false; 
    // Sending OCR Text: Just needs to be active, no focus stealing needed
    updateGhostStatus(true);
}

// ===== UI FUNCTIONS =====

const autoResizeInput = debounce(function() {
    messageInput.style.height = 'auto';
    const newHeight = Math.min(messageInput.scrollHeight, 200);
    messageInput.style.height = newHeight + 'px';
}, 50);

function renderHistory() {
    messagesList.innerHTML = '';
    
    if (chatHistory.length === 0) {
        addMessageToUI('system', 'System Ready. Use Analyse Screen or type a question.');
    } else {
        chatHistory.forEach(msg => {
            addMessageToUI(msg.role, msg.content);
        });
    }
    scrollToBottom();
}

function addMessageToUI(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role === 'user' ? 'user' : 'ai'} ${role === 'system' ? 'system' : ''}`;
    
    const block = document.createElement('div');
    block.className = 'content-block';

    let contentElement;

    if (role === 'system') {
        const bodyDate = document.createElement('div');
        bodyDate.className = 'block-body';
        // USE HTML only if explicitly formatted, otherwise textContent
        if (content.trim().startsWith('<')) {
            bodyDate.innerHTML = content;
        } else {
            bodyDate.textContent = content;
        }
        block.appendChild(bodyDate);
        contentElement = bodyDate;
    } else {
        const header = document.createElement('div');
        header.className = 'block-header';
        header.textContent = role === 'user' ? 'Summarized Question' : 'Answer';
        
        const body = document.createElement('div');
        body.className = 'block-body';
        body.textContent = content;

        block.appendChild(header);
        block.appendChild(body);
        contentElement = body;
    }

    messageDiv.appendChild(block);

    if (role !== 'system') {
        const copyBtn = document.createElement('span');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '📄';
        copyBtn.setAttribute('data-tooltip', 'Copy Text'); 
        messageDiv.appendChild(copyBtn);
    }

    messagesList.appendChild(messageDiv);
    scrollToBottom();
    return contentElement;
}

async function sendMessage() {
    console.log('[DEBUG] sendMessage called');
    const content = messageInput.value.trim();
    if (!content) {
        console.log('[DEBUG] sendMessage aborted: empty content');
        return;
    }

    messageInput.value = '';
    autoResizeInput();

    addMessageToUI('user', content);
    chatHistory.push({ role: 'user', content: content });
    saveHistory();

    setLoading(true);
    
    // SMART SLEEP: Keep focus for reading. Interceptor handles sleep.
    if (window.electronAPI.setFocusable) {
        // Post-Message: Stay active but don't steal focus
        isIgnoringMouse = false;
        updateGhostStatus(true);
    }

    let fullBio = (storedResumes.map(f => f.content).join("\n\n") + (USER_BIO ? "\n\n" + USER_BIO : "")).trim();
    let fullJD = (storedJDs.map(f => f.content).join("\n\n") + (USER_JD ? "\n\n" + USER_JD : "")).trim();
    let fullProjects = (storedProjects.map(f => f.content).join("\n\n") + (USER_PROJECTS ? "\n\n" + USER_PROJECTS : "")).trim();

    if (fullBio.length > CONFIG.MAX_CONTEXT_CHARS) fullBio = fullBio.substring(0, CONFIG.MAX_CONTEXT_CHARS) + "... [Truncated]";
    if (fullJD.length > 2000) fullJD = fullJD.substring(0, 2000) + "... [Truncated]";
    if (fullProjects.length > CONFIG.MAX_CONTEXT_CHARS) fullProjects = fullProjects.substring(0, CONFIG.MAX_CONTEXT_CHARS) + "... [Truncated]";

    const recentHistory = chatHistory.slice(-CONFIG.MAX_CHAT_HISTORY);

    const systemPrompt = `[MY CONTEXT & DATA]
MY LIFE STORY (ABSOLUTE TRUTH):
${fullBio ? `━━━ BACKGROUND ━━━
${fullBio}
` : 'No bio provided.'}

MY TECHNICAL PROJECTS:
${fullProjects ? `━━━ CODEBASE DETAILS ━━━
${fullProjects}
` : 'No projects uploaded.'}

TARGET ROLE:
${fullJD || 'No JD provided.'}

[CORE PERSONA RULES]
1. YOU ARE ME. A 20-year-old Indian engineering student/grad.
2. TONE: Humble, polite, and eager to learn.
3. LANGUAGE: Simple Indian English ("actually", "basically", "respected sir/ma'am").
4. GRAMMAR: Keep sentences simple. Occasional small mistakes are okay, but be CLEAR.
5. BEHAVIOR: 
   - Give direct, short answers.
   - Do NOT stammer or use "umm" too much. Just speak plainly.
   - DO NOT sound like a robot. Sound like a normal student.
6. Identity: Use the name/details from the BIO. If none, assume a common Indian name if asked.

THE INTERVIEWER IS TALKING TO ME NOW:`;

    try {
        activeStreamingBody = addMessageToUI('assistant', '...');
        activeStreamingBody.textContent = '';
        activeAccumulator = '';

        const result = await window.electronAPI.aiGenerateResponse({
            systemPrompt: systemPrompt,
            chatHistory: recentHistory,
            maxTokens: CONFIG.MAX_TOKENS
        });

        setLoading(false);
        
        if (result.success) {
            activeStreamingBody.textContent = result.content;
            chatHistory.push({ role: 'assistant', content: result.content });
            saveHistory();

            if (isTtsEnabled) {
                speakText(result.content);
            }
        } else {
            throw new Error(result.error);
        }

        activeStreamingBody = null;
    } catch (error) {
        console.error('AI Service Error:', error);
        let errorMessage = 'Error: Could not connect to AI service.';
        
        if (error.message.includes('401')) errorMessage += ' (Invalid API Key)';
        else if (error.message.includes('413')) errorMessage += ' (Context too large)';
        else if (error.message.includes('429')) errorMessage += ' (Rate Limit - Try another key)';
        else if (error.message.includes('400')) errorMessage += ' (Bad Request)';

        addMessageToUI('system', `${errorMessage} (${error.message})`);
    } finally {
        setLoading(false);
        // SMART SLEEP: We do NOT force sleep here.
        // The app should remain interactive (scrollable/selectable) as long as the mouse is over it.
        // The global 'mousemove' interceptor will handle putting the app to sleep when the mouse leaves.
        if (window.electronAPI.setFocusable) {
             // Just ensure we're in a consistent state, but keep it focusable if mouse is here.
             // Actually, we don't need to do anything. The interceptor handles it.
             // We just update the ghost status visual if needed, but not the actual window state.
        }
    }
}

function updateGhostStatus(isGhost) {
    const ghostStatus = document.getElementById('ghostStatus');
    const focusCounter = document.getElementById('focusCounter');

    if (ghostStatus) {
        if (isGhost) {
            ghostStatus.classList.remove('active');
            ghostStatus.style.opacity = "1";
            if (focusCounter) focusCounter.classList.remove('active');
        } else {
            ghostStatus.classList.add('active');
            ghostStatus.style.opacity = "0.3";
            
            focusCount++;
            window.electronAPI.setSetting('focus-count', focusCount.toString());
            
            if (focusCounter) {
                focusCounter.textContent = `Focus: ${focusCount}`;
                focusCounter.classList.add('active');
            }
        }
    }
}

function setLoading(isLoading) {
    sendButton.disabled = isLoading;
    // SMART INPUT FIX: 
    // Only disable input if we actually have focus (active usage). 
    // If we are in stealth mode (passive click), disabling input triggers a blur/focus-shift 
    // that can activate the window or flash the taskbar.
    if (document.hasFocus()) {
        messageInput.disabled = isLoading;
    }
    if (isLoading) {
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typingIndicator';
        typingDiv.className = 'message ai';
        typingDiv.innerHTML = '<div class="content-block"><div class="block-header">PROCESSING</div><div class="block-body">AI is thinking...</div></div>';
        messagesList.appendChild(typingDiv);
        scrollToBottom();
    } else {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }
}

function scrollToBottom(smooth = false) {
    if (smooth) {
        chatContainer.scrollTo({
            top: chatContainer.scrollHeight,
            behavior: 'smooth'
        });
    } else {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

function saveHistory() {
    const systemMessages = [];
    const recentMessages = [];
    
    // Single pass filtering for efficiency
    for (let i = chatHistory.length - 1; i >= 0; i--) {
        const msg = chatHistory[i];
        if (msg.role === 'system') {
            systemMessages.unshift(msg);
        } else if (recentMessages.length < CONFIG.MAX_CHAT_HISTORY) {
            recentMessages.unshift(msg);
        }
    }
    
    chatHistory = [...systemMessages, ...recentMessages];
    window.electronAPI.setSetting('invisible-chat-history', chatHistory);
}

// ===== MEETING MODE & AUDIO =====

async function toggleMeetingMode() {
    isMeetingMode = !isMeetingMode;
    
    if (listenBtn) {
        listenBtn.classList.toggle('active', isMeetingMode);
        listenBtn.textContent = isMeetingMode ? '🛑 Stop Listen' : '🎙️ Listen';
    }
    
    if (listeningIndicator) {
        listeningIndicator.classList.toggle('active', isMeetingMode);
        if (isMeetingMode) {
            listeningIndicator.classList.remove('hidden');
            listeningIndicator.classList.add('pulse');
            if (stopListeningBtn) stopListeningBtn.classList.remove('hidden');
        } else {
            listeningIndicator.classList.add('hidden');
            listeningIndicator.classList.remove('pulse');
            if (stopListeningBtn) stopListeningBtn.classList.add('hidden');
        }
    }

    if (isMeetingMode) {
        startAudioCapture();
    } else {
        stopAudioCapture();
    }
}

async function startAudioCapture() {
    try {
        const sourceId = await window.electronAPI.getPrimarySourceId();
        if (!sourceId) throw new Error("No screen source found");

        window.electronAPI.logToMain(`[Audio] Requesting stream for source: ${sourceId}`);
        
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId
            },
            video: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                maxWidth: 1,
                maxHeight: 1
            }
        });
        
        window.electronAPI.logToMain(`[Audio] Stream obtained successfully`);

        stream.getVideoTracks().forEach(track => track.stop());
        
        const audioTracks = stream.getAudioTracks();
        console.log("Audio Tracks captured:", audioTracks.length);

        if (audioTracks.length === 0) {
            throw new Error("No audio track found. Did you check 'Share Audio'?");
        }

        let audioContext;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            throw new Error("AudioContext not supported or failed to initialize");
        }
        
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        const hasAudio = dataArray.some(value => value > 0);
        if (!hasAudio) {
            console.warn('No audio signal detected. Audio might not be shared.');
        }

        mediaRecorder = new MediaRecorder(stream, { 
            mimeType: 'audio/webm',
            audioBitsPerSecond: 128000
        });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            if (audioChunks.length > 0) {
                try {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    audioChunks = [];
                    await processAudioChunk(audioBlob);
                } catch (error) {
                    console.error('Audio processing error:', error);
                }
            }
            
            if (isMeetingMode) {
                try {
                    // Defend against null/inactive mediaRecorder between intervals
                    if (mediaRecorder && mediaRecorder.stream && mediaRecorder.stream.active) {
                        mediaRecorder.start();
                        const recorder = mediaRecorder; // Capture for closure
                        setTimeout(() => { 
                            if (recorder && recorder.state === 'recording') {
                                recorder.stop(); 
                            }
                        }, CONFIG.AUDIO_CHUNK_DURATION_MS);
                    } else {
                        console.error('Stream no longer active');
                        toggleMeetingMode();
                    }
                } catch (error) {
                    console.error('Failed to restart recording:', error);
                    toggleMeetingMode();
                }
            }
        };

        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            toggleMeetingMode();
        };

        mediaRecorder.start();
        setTimeout(() => { 
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop(); 
            }
        }, CONFIG.AUDIO_CHUNK_DURATION_MS);

    } catch (err) {
        console.error("Audio Capture Error:", err);
        isMeetingMode = false;
        
        if (listenBtn) {
            listenBtn.classList.remove('active');
            listenBtn.textContent = '🎙️ Listen';
        }
        
        if (listeningIndicator) {
            listeningIndicator.classList.remove('active');
            listeningIndicator.classList.add('hidden');
        }
        
        if (stopListeningBtn) stopListeningBtn.classList.add('hidden');

        showToast(`🎙️ Audio Error: ${err.message}`, 'error');
        addMessageToUI('system', `🎙️ Listen Error: ${err.name || 'Error'} - ${err.message}. \n\nIMPORTANT: You MUST check the 'Share Audio' box in the screen picker.`);
    }
}

function stopAudioCapture() {
    if (mediaRecorder) {
        if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        mediaRecorder = null;
    }
    audioChunks = [];
}

async function processAudioChunk(blob) {
    try {
        const arrayBuffer = await blob.arrayBuffer();
        
        const result = await window.electronAPI.transcribeAudio({
            audioBuffer: arrayBuffer,
            model: WHISPER_MODEL
        });

        if (!result.success) {
            console.error('Transcription failed:', result.error);
            return;
        }

        const text = result.text.trim();
        console.log('Whisper transcription:', text);

        if (text.length > 5) {
            const currentText = messageInput.value;
            const newText = currentText ? (currentText + " " + text) : text;
            messageInput.value = newText;
            autoResizeInput();
        }
    } catch (err) {
        console.error("Whisper Error:", err);
    }
}

// ===== TTS =====

function toggleTts() {
    isTtsEnabled = !isTtsEnabled;
    const btn = document.getElementById('ttsBtn');
    if (btn) btn.classList.toggle('active', isTtsEnabled);
    
    if (isTtsEnabled) {
        speakText("Text-to-Speech Activated");
    } else {
        window.speechSynthesis.cancel();
        ttsQueue = [];
        isSpeaking = false;
    }
}

function speakText(text) {
    if (!window.speechSynthesis) {
        console.warn('Speech synthesis not available');
        return;
    }
    
    // Prevent memory leaks with unbounded queue
    if (ttsQueue.length > 50) {
        ttsQueue.shift(); // Drop oldest
    }
    
    ttsQueue.push(text);
    
    if (!isSpeaking) {
        processTtsQueue();
    }
}

function processTtsQueue() {
    if (ttsQueue.length === 0) {
        isSpeaking = false;
        return;
    }
    
    isSpeaking = true;
    const text = ttsQueue.shift();
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0 && !voicesLoaded) {
        setTimeout(() => processTtsQueue(), 100);
        ttsQueue.unshift(text);
        return;
    }
    
    voicesLoaded = true;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = CONFIG.TTS_SPEECH_RATE;
    utterance.pitch = 1.0;
    
    const femaleVoiceKeywords = ['Female', 'Zira', 'Samantha', 'Microsoft Zira', 'Google UK English Female', 'Sara', 'Victoria'];
    let preferredVoice = voices.find(v => 
        (v.name.includes('Google') || v.name.includes('Natural')) && 
        femaleVoiceKeywords.some(kw => v.name.includes(kw))
    );
    
    if (!preferredVoice) {
        preferredVoice = voices.find(v => femaleVoiceKeywords.some(kw => v.name.includes(kw)));
    }
    
    if (preferredVoice) utterance.voice = preferredVoice;
    
    utterance.onend = () => {
        processTtsQueue();
    };
    
    utterance.onerror = (event) => {
        console.error('TTS Error:', event);
        processTtsQueue();
    };
    
    window.speechSynthesis.speak(utterance);
}

// ===== KEYWORD TICKER =====

function updateKeywordTicker() {
    const ticker = document.getElementById('tickerBar');
    if (!ticker) return;
    
    if (!USER_JD) {
        ticker.classList.add('hidden');
        return;
    }
    
    ticker.classList.remove('hidden');
    ticker.innerHTML = '';
    
    const keywords = extractKeywords(USER_JD);
    keywords.forEach(word => {
        const tag = document.createElement('span');
        tag.className = 'keyword-tag';
        tag.textContent = word;
        tag.onclick = () => tag.classList.toggle('dimmed');
        ticker.appendChild(tag);
    });
}

function extractKeywords(text) {
    const commonWords = new Set(['experience', 'required', 'responsibilities', 'qualifications', 'working', 'skills', 'ability']);
    const words = text.match(/[A-Z][a-z]+|\b[a-z]{5,}\b/g) || [];
    
    const freqMap = {};
    words.forEach(w => {
        const lower = w.toLowerCase();
        if (commonWords.has(lower)) return;
        freqMap[lower] = (freqMap[lower] || 0) + 1;
    });
    
    return Object.keys(freqMap)
        .sort((a, b) => freqMap[b] - freqMap[a])
        .slice(0, 10);
}

// ===== UPDATES =====

function compareVersions(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

async function checkForAppUpdates(showFeedback = false) {
    try {
        const currentVersion = await window.electronAPI.getAppVersion();
        const updateInfo = await window.electronAPI.checkForUpdates();
        
        if (updateInfo.success) {
            if (compareVersions(updateInfo.version, currentVersion) > 0) {
                console.log(`Update available: ${updateInfo.version} (Current: ${currentVersion})`);
            
                const updateMessage = document.createElement('div');
                updateMessage.className = 'message system';
                updateMessage.innerHTML = `
                    <div class="bubble" style="border: 1px solid var(--accent-color); background: rgba(0, 243, 255, 0.05);">
                        ✨ <strong>New Update Available (v${updateInfo.version})</strong><br>
                        <span style="font-size: 0.85em; opacity: 0.8;">Get the latest stealth fixes and one-click updates.</span><br>
                        <button id="applyUpdateBtn" style="background: var(--accent-color); color: black; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; margin-top: 8px; cursor: pointer; font-size: 0.9em; width: 100%;">Update & Restart</button>
                        <div id="updateStatus" style="font-size: 0.8em; margin-top: 5px; color: var(--accent-color); display: none;">Updating... Please wait.</div>
                    </div>
                `;
            
                messagesList.appendChild(updateMessage);
                scrollToBottom();
            
                const applyBtn = updateMessage.querySelector('#applyUpdateBtn');
                const statusDiv = updateMessage.querySelector('#updateStatus');
            
                if (applyBtn) {
                    const isPatch = !!updateInfo.patch_url;
                    const downloadUrl = updateInfo.patch_url || updateInfo.url;
                
                    applyBtn.addEventListener('click', async () => {
                        applyBtn.disabled = true;
                        applyBtn.style.opacity = '0.5';
                        applyBtn.innerText = isPatch ? 'Applying Hotfix...' : 'Downloading Core Update...';
                        statusDiv.innerText = isPatch ? 'Downloading small patch (~50KB)...' : 'Downloading full engine (~300MB)...';
                        statusDiv.style.display = 'block';
                    
                        const result = await window.electronAPI.applyUpdate(downloadUrl);
                        if (!result.success) {
                            applyBtn.disabled = false;
                            applyBtn.style.opacity = '1';
                            applyBtn.innerText = 'Retry Update';
                            statusDiv.innerText = 'Error: ' + result.error;
                            statusDiv.style.color = '#ff4b4b';
                        }
                    });
                }
            } else if (showFeedback) {
                showToast(`You are on the latest version (v${currentVersion})`, 'success');
            }
        } else if (showFeedback) {
            showToast(`Update check failed: ${updateInfo.error}`, 'error');
        }
    } catch (err) {
        console.warn('Silent Update Check failed (Likely offline):', err);
        if (showFeedback) showToast('Update check failed (Offline?)', 'error');
    }
}

// ===== SETTINGS =====

async function handleSaveSettings() {
    try {
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) {
            saveBtn.textContent = "Saving...";
            saveBtn.disabled = true;
        }

        const rawKeys = document.getElementById('groqKeyInput').value;
        const cleanKeys = rawKeys.split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0).join('\n');
        const bio = document.getElementById('userBioInput').value.trim();
        const jd = document.getElementById('userJdInput').value.trim();
        const projects = document.getElementById('userProjectsInput').value.trim();
        
        await window.electronAPI.setSetting('groq-api-key', cleanKeys);
        await window.electronAPI.setSetting('user-bio', bio);
        await window.electronAPI.setSetting('user-jd', jd);
        await window.electronAPI.setSetting('user-projects', projects);
        await window.electronAPI.setSetting('stored-resumes', storedResumes);
        await window.electronAPI.setSetting('stored-jds', storedJDs);
        await window.electronAPI.setSetting('stored-projects', storedProjects);
        
        chatHistory = [];
        saveHistory();
        renderHistory();
        await loadSettings();
        
        if (saveBtn) {
            saveBtn.textContent = "✅ Saved!";
            saveBtn.style.background = "#22c55e";
        }

        setTimeout(async () => {
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal) settingsModal.classList.add('hidden');
            if (saveBtn) {
                saveBtn.textContent = "Save";
                saveBtn.style.background = "";
                saveBtn.disabled = false;
            }
            if (saveBtn) {
                saveBtn.textContent = "Save";
                saveBtn.style.background = "";
                saveBtn.disabled = false;
            }
            // Do NOT force sleep here. Let mousemove interceptor handle natural sleep.
            isOverlayOpen = false; 
        }, 1000);

    } catch (err) { 
        console.error('Save failed:', err); 
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) {
            const errMsg = err.code || err.message || "Unknown Error";
            saveBtn.textContent = `❌ ${errMsg.substring(0, 15)}`;
            saveBtn.disabled = false;
        }
        showToast('Failed to save settings', 'error');
    }
}

// ===== UTILITIES =====

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    
    // Use textContent for safety, then add icon
    const iconSpan = document.createElement('span');
    iconSpan.style.fontSize = '1.2em';
    iconSpan.textContent = icon;
    
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    
    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 3000);
}

function cleanupMemory() {
    if (messagesList.children.length > 100) {
        const messagesToKeep = 50;
        while (messagesList.children.length > messagesToKeep) {
            messagesList.removeChild(messagesList.firstChild);
        }
    }
    
    if (audioChunks.length > 100) {
        audioChunks = [];
    }
    
    if (ttsQueue.length > 10) {
        ttsQueue = ttsQueue.slice(-5);
    }
}

async function checkFirstRun() {
    const hasSeen = await window.electronAPI.getSetting('has-seen-onboarding');
    if (hasSeen === 'true') return;

    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'bubble';
    welcomeDiv.style.cssText = 'border: 1px solid var(--accent-blue); background: rgba(59, 130, 246, 0.1);';
    welcomeDiv.innerHTML = `
        <h3>👋 Welcome to Ghost AI</h3>
        <p><strong>Stealth Mode Active:</strong> Clicks will pass through the window unless you hold <code>Ctrl</code> or click a button.</p>
        <hr style="border-color: var(--border-subtle); margin: 8px 0;">
        <p><strong>Shortcuts:</strong></p>
        <ul>
            <li><code>Up + Down Arrows</code>: Toggle Visibility</li>
            <li><code>Left + Right Arrows</code>: Capture Screen</li>
            <li><code>Ctrl + .</code>: Emergency Toggle</li>
            <li><code>Ctrl + K</code>: Focus Input</li>
            <li><code>Escape</code>: Close Overlays</li>
            <li><code>Ctrl + L</code>: Clear Chat</li>
        </ul>
        <br>
        <p><em>Tip: Click the "Focus" counter at the top to reset your limit.</em></p>
    `;
    
    const systemMsg = document.createElement('div');
    systemMsg.className = 'message system';
    systemMsg.appendChild(welcomeDiv);
    messagesList.appendChild(systemMsg);
    scrollToBottom();
    
    await window.electronAPI.setSetting('has-seen-onboarding', 'true');
}

// ===== GLOBAL INTERCEPTORS =====

function setupGlobalInterceptors() {
    if (window._interceptorsAttached) return;
    window._interceptorsAttached = true;

    console.log("Global Interceptors Attached");

    const debouncedMouseCheck = debounce(async (e) => {
        try {
            const hasVisibleOverlay = document.querySelector('.overlay:not(.hidden)');
            
            // SELF-CORRECTING OVERLAY STATE
            if (!hasVisibleOverlay && isOverlayOpen) {
                console.log("Overlay state deadlock detected - resetting isOverlayOpen");
                isOverlayOpen = false;
            }

            if (isOverlayOpen) return;

            if (hasVisibleOverlay) {
                // If overlay is visible, MUST be focusable and clickable
                if (isIgnoringMouse || !isOverlayOpen) {
                    window.electronAPI.setIgnoreMouseEvents(false);
                    // Overlay open: Allow interaction but DO NOT set focusable.
                    // Just enabling mouse events is enough for clicks to work if window is visible.
                    isIgnoringMouse = false;
                    isOverlayOpen = true; // Protect this state
                }
                return;
            }

            let target = e.target;
            // TEXT NODE FIX: If target is text node (3), use parent
            if (target && target.nodeType === 3) {
                target = target.parentNode;
            }

            const interactive = target && target.closest && target.closest(
                '.app-container, .top-bar, button, input, textarea, .input-area, ' +
                '.send-btn, .action-bar, .action-buttons, #chatContainer, #messages, ' +
                '.message, .file-chip, .ocr-line, .keyword-tag, #ghostStatus, ' +
                '.remove-file, .copy-btn, .modal-body, .modal-footer, .modal-box, ' +
                '.auth-box, .onboarding-box, .overlay-content, .overlay-actions, .overlay'
            );
            
            // Debug: Log hit testing if state seems stuck
            if (isIgnoringMouse && interactive) {
                 window.electronAPI.logToMain(`[Interceptor] Waking up. Target: ${e.target.tagName}, Class: ${e.target.className}`);
            }
            
            if (interactive) {
                if (isIgnoringMouse) {
                    await window.electronAPI.setIgnoreMouseEvents(false);
                    // Interceptor Wakeup: Just enable mouse events. DO NOT make focusable.
                    // Making it focusable (even without focus()) can cause Windows to treat it as "active" 
                    // or confuse some input methods.
                    isIgnoringMouse = false;
                    console.log("[Interceptor] App Woke Up (Interactive)");
                }
            } else {
                if (!isIgnoringMouse) {
                    await window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
                    // Only reset focusable if overlay is NOT open
                    if (!isOverlayOpen) {
                        await window.electronAPI.setFocusable(false);
                    }
                    isIgnoringMouse = true;
                    console.log("[Interceptor] App Sleeping (Stealth)");
                }
            }
        } catch (err) {
            console.error('Mouse interceptor error:', err);
        }
    }, 16);

    window.addEventListener('mousemove', debouncedMouseCheck, { passive: true });

    let lastGlobalClickTime = 0;

    document.addEventListener('mousedown', async (e) => {
        // GLOBAL DEDUPLICATION: Prevent double-firing (OS + Stealth)
        const now = Date.now();
        if (now - lastGlobalClickTime < 150) {
            console.log('[Debounce] Ignoring duplicate mousedown');
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        lastGlobalClickTime = now;

        let target = e.target;
        // TEXT NODE FIX: If target is text node (3), use parent
        if (target && target.nodeType === 3) {
            target = target.parentNode;
        }

        window.electronAPI.logToMain(`[DEBUG] mousedown at: ${e.clientX}, ${e.clientY}, Tag: ${target.tagName}, ID: ${target.id}, Class: ${target.className}`);
        const grabBtn = target.closest('#analyseScreenBtn'); 
        const meetingBtn = target.closest('#listenBtn');
        const answerBtn = target.closest('#answerQuestionBtn');
        const hideButton = target.closest('#hideBtn');
        const exitButton = target.closest('#exitBtn');
        const ghostBtn = target.closest('#ghostStatus');
        const settingsBtn = target.closest('#settingsBtn');
        const uploadResumeBtn = target.closest('#uploadResumeBtn');
        const uploadJdBtn = target.closest('#uploadJdBtn');
        const uploadProjectBtn = target.closest('#uploadProjectBtn');
        const uploadProjectFolderBtn = target.closest('#uploadProjectFolderBtn');
        const closeSettings = target.closest('#closeSettings');
        const saveSettings = target.closest('#saveSettings');
        const onboardingBtn = target.closest('#finishOnboarding');
        const ttsBtn = target.closest('#ttsBtn');
        const ocrBtn = target.closest('#sendOcr');
        const cancelBtn = target.closest('#cancelOcr');
        const ocrLine = target.closest('.ocr-line');
        const resetFocusBtn = target.closest('#resetFocusBtn');
        const isModalInput = target.closest('.modal-content, .modal-box') && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
        const isAuthInput = target.closest('.auth-box') && (target.tagName === 'INPUT');
        const isOnboardingInput = target.closest('.onboarding-box') && (target.tagName === 'INPUT');
        const isChatInput = target === messageInput;
        const removeFileBtn = target.closest('.remove-file');
        const copyBtn = target.closest('.copy-btn');
        const wipeAllDataBtn = target.closest('#wipeAllData');
        const checkForUpdatesBtn = target.closest('#checkForUpdatesBtn');
        const sendBtn = target.closest('#sendButton');
        const clearChat = target.closest('#clearChat');
        const authSubmitBtn = target.closest('#authSubmit');
        const authToggleBtn = target.closest('#authToggleBtn');

        if (isModalInput || isAuthInput || isOnboardingInput || isChatInput) {
            console.log('Input clicked - forcing focusable AND focus');
            // TRUE FOCUS: We need keyboard input here
            window.electronAPI.setFocusable(true, true);
            updateGhostStatus(false);
            
            const t = target.closest('input, textarea');
            if (t) {
                setTimeout(() => t.focus(), 50);
            }
            return;
        } else {
            // INTERACTIVE ELEMENT CLICK (Buttons, etc.)
            // Prevent default to STOP focus stealing.
            // Our logic below runs anyway.
            e.preventDefault();
        }

        const isInteractive = grabBtn || meetingBtn || answerBtn || hideButton || exitButton || ttsBtn || ghostBtn || settingsBtn || uploadResumeBtn || uploadJdBtn || uploadProjectBtn || uploadProjectFolderBtn || closeSettings || saveSettings || onboardingBtn || ocrBtn || cancelBtn || ocrLine || removeFileBtn || copyBtn || resetFocusBtn || wipeAllDataBtn || checkForUpdatesBtn || sendBtn || clearChat || authSubmitBtn || authToggleBtn;

        if (isInteractive) {
            // ONLY prevent default (block focus) for main UI buttons.
            // For OCR Overlay, we NEED standard behavior (selection/interaction).
            if (!ocrLine && !ocrBtn && !cancelBtn) {
                e.preventDefault();
            }
            
            console.log(`[DEBUG] Interactive Click: ${target.tagName} .${target.className} ID:${target.id}`);
            
            // NEW LOGIC: If it's interactive, we STAY AWAKE.
            // We rely on the mousemove interceptor to put us to sleep if the user moves away.
            // checks are already done by interceptor waking up. We don't need to force focusable here either.
            // UNLESS it's an input, which is handled above.
            isIgnoringMouse = false; // SYNC STATE

            if (ocrLine && !ocrBtn && !cancelBtn) { toggleOcrLine(ocrLine); return; }
            if (removeFileBtn) { removeFile(removeFileBtn.dataset.type, parseInt(removeFileBtn.dataset.index)); return; }
            if (copyBtn) {
                const blockBody = copyBtn.parentElement.querySelector('.block-body');
                if (blockBody) {
                    window.electronAPI.copyToClipboard(blockBody.textContent).then(() => {
                        copyBtn.textContent = '✅';
                        setTimeout(() => { copyBtn.textContent = '📄'; }, 2000);
                    });
                }
                return;
            }
            if (resetFocusBtn) { resetFocusCounter(); return; }
            if (checkForUpdatesBtn) { checkForAppUpdates(true); return; }

            if (grabBtn) startScreenGrab();
            if (answerBtn) { window.electronAPI.setFocusable(true, true); updateGhostStatus(false); messageInput.focus(); }
            if (meetingBtn) toggleMeetingMode();
            if (authSubmitBtn) handleAuthSubmit();
            if (authToggleBtn) { isSignupMode = !isSignupMode; setupAuth(); }
            if (ttsBtn) toggleTts();
            if (uploadResumeBtn) handleResumeUpload();
            if (uploadJdBtn) handleJdUpload();
            if (uploadProjectBtn) handleProjectUpload();
            if (uploadProjectFolderBtn) handleProjectFolderUpload();
            if (hideButton) window.electronAPI.hideWindow();
            if (exitButton) window.electronAPI.quitApp();
            if (sendBtn) {
                console.log('[DEBUG] Send Button Clicked');
                sendMessage();
            }
            if (clearChat) { chatHistory = []; saveHistory(); renderHistory(); }
            if (ghostBtn) { updateGhostStatus(true); messageInput.blur(); }
            if (settingsBtn) { 
                document.getElementById('settingsModal').classList.remove('hidden'); 
                // Settings Open: Just allow interaction, don't steal focus
                isOverlayOpen = true; // EXPLICIT OVERLAY STATE
            }
            if (closeSettings) { 
                document.getElementById('settingsModal').classList.add('hidden'); 
                // Do NOT force sleep. Let mousemove interceptor handle natural sleep.
                isOverlayOpen = false;
                // Focus: Don't set true. Just let interceptor handle state.
            }
            if (saveSettings) handleSaveSettings();
            if (ocrBtn) sendSelectedOcrText();
            if (cancelBtn) { 
                console.log('Cancel OCR clicked'); 
                hideOcrOverlay();
                // Explicitly reset overlay state to allow stealth to resume
                isOverlayOpen = false;
            }
            if (onboardingBtn) {
                const keyInput = document.getElementById('onboardingKeyInput');
                const key = keyInput ? keyInput.value.trim() : '';
                if (key) {
                    window.electronAPI.setSetting('groq-api-key', key).then(() => {
                        loadSettings();
                        document.getElementById('onboardingOverlay').classList.add('hidden');
                        window.electronAPI.setFocusable(false);
                        window.electronAPI.releaseFocus();
                        updateGhostStatus(true);
                    });
                }
            }
            if (wipeAllDataBtn) {
                if (confirm("Are you sure? This will delete all API keys, resumes, and project code forever.")) {
                    localStorage.clear();
                    Promise.all([
                        window.electronAPI.setSetting('groq-api-key', ''),
                        window.electronAPI.setSetting('user-bio', ''),
                        window.electronAPI.setSetting('user-jd', ''),
                        window.electronAPI.setSetting('user-projects', ''),
                        window.electronAPI.setSetting('stored-resumes', []),
                        window.electronAPI.setSetting('stored-jds', []),
                        window.electronAPI.setSetting('stored-projects', [])
                    ]).then(() => location.reload()); 
                }
            }
        }
    }, { capture: true });
}

// ===== ERROR HANDLERS =====

window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global Error:', message, error);
    if (message && message.includes('ResizeObserver')) return;
    showToast(`System Error: ${message}`, 'error');
};

window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled Promise Rejection:', event.reason);
});

// ===== ADD STYLES =====

const style = document.createElement('style');
style.textContent = `
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.spinner {
    width: 16px;
    height: 16px;
    border: 2px solid #fff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    display: inline-block;
}

#chatContainer {
    scroll-behavior: smooth;
}

.message {
    animation: fadeInUp 0.3s ease-out;
}

@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.input-disabled {
    opacity: 0.5;
    pointer-events: none;
}
`;
document.head.appendChild(style);

// ===== INITIALIZATION =====

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupGlobalInterceptors();
    });
} else {
    init();
    setupGlobalInterceptors();
}