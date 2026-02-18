// SECURE MODE: AI URLs and keys moved to Main Process (main.js)
let GROQ_API_KEYS = []; // For UI display only
const WHISPER_MODEL = 'whisper-large-v3';

// Configuration Constants
const CONFIG = {
    MAX_CHAT_HISTORY: 10, // Reduced to save tokens
    MAX_CONTEXT_CHARS: 15000, // Increased for better adherence
    AUDIO_CHUNK_DURATION_MS: 3000,
    MAX_TOKENS: 512,
    FOCUS_LIMIT: 500,
    TTS_SPEECH_RATE: 1.1
};

// Silence console for stealth
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
let chatHistory = []; // Loaded in loadSettings() after auth
let selectedOcrLines = new Set();
let isMeetingMode = false;
let mediaRecorder = null;
let audioChunks = [];
let transcriptionBuffer = "";

// Advanced Features State
let isTtsEnabled = false;
let voicesLoaded = false;
let isSignupMode = false;

// Streaming Global State
let activeStreamingBody = null;
let activeAccumulator = "";

// Focus Management
let focusCount = 0; // Loaded in loadSettings() after auth

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
        
        // Toggle API Key field
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

    // Enter key support
    password.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); await handleAuthSubmit(); }
    });
    username.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') { e.preventDefault(); password.focus(); }
    });
}

async function handleAuthSubmit() {
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const error = document.getElementById('authError');
    const submit = document.getElementById('authSubmit');

    if (!username || !password) {
        error.textContent = 'Please enter username and password';
        error.classList.remove('hidden');
        return;
    }

    submit.disabled = true;
    submit.textContent = 'Please wait...';
    error.classList.add('hidden');

    try {
        let result;
        if (isSignupMode) {
            const apiKeys = document.getElementById('authKeyInput').value.trim();
            result = await window.electronAPI.authSignup(username, password, apiKeys);
        } else {
            result = await window.electronAPI.authLogin(username, password);
        }

        if (result.success) {
            document.getElementById('authOverlay').classList.add('hidden');
            await continueInit();
            
            // If onboarding didn't show, drop focus for stealth
            if (document.getElementById('onboardingOverlay').classList.contains('hidden')) {
                window.electronAPI.setFocusable(false);
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

// Initialize
async function init() {
    // Setup Global Streaming Listeners
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
        // Check auth first — gate everything behind login
        const auth = await window.electronAPI.authCheck();
        setupAuth();
        
        if (!auth.loggedIn) {
            // Enable focusable so user can type in auth fields
            window.electronAPI.setFocusable(true);
            document.getElementById('authOverlay').classList.remove('hidden');
            // Auto-focus username field
            setTimeout(() => document.getElementById('authUsername').focus(), 100);
            return; // Don't init rest of app until auth
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
        
        // Initialize TTS voices
        if (window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged = () => {
                voicesLoaded = true;
            };
            // Trigger voice loading
            window.speechSynthesis.getVoices();
        }

        // Initialize focus counter display
        const fc = document.getElementById('focusCounter');
        if (fc) fc.textContent = focusCount > 0 ? `Focus: ${focusCount}` : '0';

        // Check for updates (subtle)
        checkForAppUpdates();
        
        // UX: Check First Run Onboarding
        checkFirstRun();
    } catch (error) {
        console.error('App Init Error:', error);
    }
}

async function loadSettings() {
    const keys = await window.electronAPI.getSetting('groq-api-key') || '';
    // Handle both old string format and new multiline format
    GROQ_API_KEYS = keys.split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0);
    
    // If empty array, try legacy single key check (though split handles empty string -> [''])
    if (GROQ_API_KEYS.length === 0 && keys.length > 10) GROQ_API_KEYS = [keys];

    USER_BIO = await window.electronAPI.getSetting('user-bio') || '';
    USER_JD = await window.electronAPI.getSetting('user-jd') || '';
    USER_PROJECTS = await window.electronAPI.getSetting('user-projects') || '';
    
    // Load File Lists (Default to empty arrays if not found)
    storedResumes = await window.electronAPI.getSetting('stored-resumes') || [];
    storedJDs = await window.electronAPI.getSetting('stored-jds') || [];
    storedProjects = await window.electronAPI.getSetting('stored-projects') || [];

    // Load User History & Focus (Isolated)
    chatHistory = await window.electronAPI.getSetting('invisible-chat-history') || [];
    focusCount = parseInt(await window.electronAPI.getSetting('focus-count') || '0');

    // Sync to UI if open
    document.getElementById('groqKeyInput').value = GROQ_API_KEYS.join('\n');
    document.getElementById('userBioInput').value = USER_BIO;
    if (document.getElementById('userJdInput')) document.getElementById('userJdInput').value = USER_JD;
    if (document.getElementById('userProjectsInput')) document.getElementById('userProjectsInput').value = USER_PROJECTS;
    
    // Update Focus UI
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

function setupEventListeners() {
    // Top Bar Actions
    if (hideBtn) hideBtn.addEventListener('click', () => {
        window.electronAPI.hideWindow();
    });

    if (exitBtn) exitBtn.addEventListener('click', () => {
         window.electronAPI.quitApp();
    });

    // Focus Counter Reset
    const fc = document.getElementById('focusCounter');
    if (fc) {
        fc.addEventListener('click', async () => {
            focusCount = 0;
            fc.textContent = '0';
            await window.electronAPI.setSetting('focus-count', '0');
            showToast('Focus Counter Reset', 'success');
        });
    }

    if (stopListeningBtn) stopListeningBtn.addEventListener('click', () => {
        // Stop listening logic here if implemented, or just hide indicator
        listeningIndicator.classList.add('hidden');
        stopListeningBtn.classList.add('hidden');
    });

    // Action Bar Actions
    if (analyseScreenBtn) analyseScreenBtn.addEventListener('click', startScreenGrab);
    
    if (listenBtn) listenBtn.addEventListener('click', toggleMeetingMode);
    
    if (answerQuestionBtn) answerQuestionBtn.addEventListener('click', () => {
        messageInput.focus();
    });

    // Send message on Enter (but new line on Shift+Enter)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize input
    messageInput.addEventListener('input', autoResizeInput);

    // Focus Management (Ghost Mode)
    messageInput.addEventListener('mousedown', async (e) => {
        if (focusCount >= CONFIG.FOCUS_LIMIT) {
            e.preventDefault();
            console.log('Focus limit reached. Input blocked.');
            messageInput.classList.add('input-disabled');
            messageInput.placeholder = "Focus limit reached (Max 500). Use OCR.";
            return;
        }

        await window.electronAPI.setFocusable(true);
        updateGhostStatus(false);
        setTimeout(() => messageInput.focus(), 10);
    });

    // Event listeners are now managed by setupGlobalInterceptors()
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
}

// FIX: Added focus counter reset function
function resetFocusCounter() {
    focusCount = 0;
    window.electronAPI.setSetting('focus-count', '0');
    messageInput.classList.remove('input-disabled');
    messageInput.placeholder = "Type your message...";
    console.log('Focus counter reset successfully');
    
    // Visual feedback
    const focusCounter = document.getElementById('focusCounter');
    if (focusCounter) {
        focusCounter.textContent = 'Focus: 0';
        focusCounter.style.color = '#4CAF50';
        setTimeout(() => {
            focusCounter.style.color = '';
        }, 2000);
    }
}

async function handleResumeUpload() {
    const filePath = await window.electronAPI.selectResumeFile();
    if (filePath) {
        const status = document.getElementById('uploadStatus');
        status.classList.remove('hidden');
        status.style.color = '#fff';
        const fileName = filePath.split(/[\\/]/).pop();
        status.textContent = "Parsing " + fileName + "...";
        
        try {
            console.log('Requesting parsing for:', filePath);
            const text = await window.electronAPI.parseResumeFile(filePath);
            console.log('Parse result received. Length:', text ? text.trim().length : 0);
            if (text && text.trim().length > 0) {
                storedResumes.push({ name: fileName, content: text }); 
                await window.electronAPI.setSetting('stored-resumes', storedResumes);
                renderFileLists();
                status.textContent = "Done!";
            } else {
                console.warn('Empty text returned from parse.');
                throw new Error("No text content extracted.");
            }
        } catch (err) {
            console.error('Resume parse error (UI):', err);
            status.textContent = "Error: " + (err.message || "Failed to parse");
            status.style.color = "#ff4b4b";
        }
        setTimeout(() => status.classList.add('hidden'), 5000);
    }
}

async function handleJdUpload() {
    const filePath = await window.electronAPI.selectResumeFile(); 
    if (filePath) {
        const status = document.getElementById('jdUploadStatus');
        status.classList.remove('hidden');
        status.style.color = '#fff';
        const fileName = filePath.split(/[\\/]/).pop();
        status.textContent = "Parsing " + fileName + "...";
        
        try {
            const text = await window.electronAPI.parseResumeFile(filePath);
            if (text && text.trim().length > 0) {
                storedJDs.push({ name: fileName, content: text });
                await window.electronAPI.setSetting('stored-jds', storedJDs);
                renderFileLists();
                status.textContent = "Done!";
            } else {
                throw new Error("No text content extracted.");
            }
        } catch (err) {
            console.error('JD parse error:', err);
            status.textContent = "Error: " + (err.message || "Failed to parse");
            status.style.color = "#ff4b4b";
        }
        setTimeout(() => status.classList.add('hidden'), 5000);
    }
}

async function handleProjectUpload() {
    const filePath = await window.electronAPI.selectProjectFile();
    if (filePath) {
        const status = document.getElementById('projectUploadStatus');
        status.classList.remove('hidden');
        status.style.color = '#fff';
        const fileName = filePath.split(/[\\/]/).pop();
        status.textContent = 'Parsing...';
        
        try {
            const text = await window.electronAPI.parseProjectZip(filePath);
            if (text) {
                storedProjects.push({ name: fileName, content: text }); 
                await window.electronAPI.setSetting('stored-projects', storedProjects);
                renderFileLists();
                status.textContent = 'Done!';
            }
        } catch (err) {
            console.error('Project upload error:', err);
            status.textContent = 'Error: ' + (err.message || "Failed to parse ZIP");
            status.style.color = "#ff4b4b";
        }
        setTimeout(() => status.classList.add('hidden'), 5000);
    }
}

async function handleProjectFolderUpload() {
    const filePath = await window.electronAPI.selectProjectFolder();
    if (filePath) {
        const status = document.getElementById('projectUploadStatus');
        status.classList.remove('hidden');
        status.style.color = '#fff';
        const folderName = filePath.split(/[\\/]/).pop() + "/"; 
        status.textContent = 'Scanning Folder...';
        
        try {
            const text = await window.electronAPI.parseProjectFolder(filePath);
            if (text) {
                storedProjects.push({ name: folderName, content: text }); 
                await window.electronAPI.setSetting('stored-projects', storedProjects);
                renderFileLists();
                status.textContent = 'Done!';
            }
        } catch (err) {
            console.error('Folder upload error:', err);
            status.textContent = 'Error: ' + (err.message || "Failed to parse folder");
            status.style.color = "#ff4b4b";
        }
        setTimeout(() => status.classList.add('hidden'), 5000);
    }
}

async function startScreenGrab() {
    try {
        setLoading(true);
        const base64Image = await window.electronAPI.captureScreen();
        
        if (!base64Image) {
            throw new Error('Failed to capture screen');
        }

        showOcrOverlay(true);
        
        const lines = await window.electronAPI.performOcr(base64Image);
        
        if (!lines || lines.length === 0) {
            renderOcrLines([]);
        } else {
            renderOcrLines(lines);
        }
        
    } catch (error) {
        console.error('Screen Grab Error:', error);
        hideOcrOverlay();
    } finally {
        setLoading(false);
    }
}

function showOcrOverlay(isLoading = false) {
    ocrOverlay.classList.remove('hidden');
    if (isLoading) {
        ocrLinesContainer.innerHTML = '<div class="message system"><div class="bubble">Scanning screen for text...</div></div>';
        updateOcrButtonState();
    }
}

function hideOcrOverlay() {
    ocrOverlay.classList.add('hidden');
    selectedOcrLines.clear();
    setLoading(false);
    sendButton.disabled = false;
    messageInput.disabled = false;
}

function renderOcrLines(lines) {
    ocrLinesContainer.innerHTML = '';
    selectedOcrLines.clear();
    updateOcrButtonState();

    if (lines.length === 0) {
        ocrLinesContainer.innerHTML = '<div class="message system"><div class="bubble">No text detected on screen.</div></div>';
        return;
    }

    lines.forEach((line, index) => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'ocr-line';
        lineDiv.textContent = line;
        lineDiv.dataset.index = index;
        // lineDiv.onmousedown = (e) => e.preventDefault(); // Removed to allow selection
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
    } else {
        sendOcrBtn.style.opacity = "0.5";
        sendOcrBtn.style.pointerEvents = "none";
    }
}

function sendSelectedOcrText() {
    const combinedText = Array.from(selectedOcrLines).join('\n');
    messageInput.value += (messageInput.value ? '\n' : '') + combinedText;
    autoResizeInput();
    hideOcrOverlay();
    window.electronAPI.setFocusable(false);
    window.electronAPI.releaseFocus();
    updateGhostStatus(true);
}

function autoResizeInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
}

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
    
    // Content Block Structure
    const block = document.createElement('div');
    block.className = 'content-block';

    let contentElement;

    if (role === 'system') {
        const bodyDate = document.createElement('div');
        bodyDate.className = 'block-body';
        bodyDate.textContent = content;
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

    // Stealth Copy Button (Only for non-system)
    if (role !== 'system') {
        const copyBtn = document.createElement('span');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = '📄';
        copyBtn.setAttribute('data-tooltip', 'Copy Text'); 
        messageDiv.appendChild(copyBtn);
    }

    messagesList.appendChild(messageDiv);
    scrollToBottom();
    return contentElement; // Return body element to allow streaming updates
}

async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;

    // UI INSTANT CLEAR: Clear before anything else
    messageInput.value = '';
    autoResizeInput();

    addMessageToUI('user', content);
    chatHistory.push({ role: 'user', content: content });
    saveHistory();

    setLoading(true);
    
    // Drop Focus immediately
    if (window.electronAPI.setFocusable) {
        window.electronAPI.setFocusable(false);
        window.electronAPI.releaseFocus();
        updateGhostStatus(true);
    }

    // ENHANCED: Aggregate ALL uploaded content with priority to files
    let fullBio = (storedResumes.map(f => f.content).join("\n\n") + (USER_BIO ? "\n\n" + USER_BIO : "")).trim();
    let fullJD = (storedJDs.map(f => f.content).join("\n\n") + (USER_JD ? "\n\n" + USER_JD : "")).trim();
    let fullProjects = (storedProjects.map(f => f.content).join("\n\n") + (USER_PROJECTS ? "\n\n" + USER_PROJECTS : "")).trim();

    // TRUNCATION: Prevent 400 Context Errors
    if (fullBio.length > CONFIG.MAX_CONTEXT_CHARS) fullBio = fullBio.substring(0, CONFIG.MAX_CONTEXT_CHARS) + "... [Truncated]";
    if (fullJD.length > 2000) fullJD = fullJD.substring(0, 2000) + "... [Truncated]";
    if (fullProjects.length > CONFIG.MAX_CONTEXT_CHARS) fullProjects = fullProjects.substring(0, CONFIG.MAX_CONTEXT_CHARS) + "... [Truncated]";

    const recentHistory = chatHistory.slice(-CONFIG.MAX_CHAT_HISTORY);

    // ULTIMATE HUMAN PERSONA PROMPT: Nervous Indian Interviewee (20yo)
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

    /* 
    console.log("--- CONTEXT DEBUG ---");
    console.log("Resume Files:", storedResumes.length);
    console.log("JD Files:", storedJDs.length);
    console.log("Project Files:", storedProjects.length);
    console.log("Bio Length:", fullBio.length, "chars");
    console.log("JD Length:", fullJD.length, "chars");
    console.log("Projects Length:", fullProjects.length, "chars");
    console.log("System Prompt Length:", systemPrompt.length, "chars");
    console.log("--------------------");
    */

    try {
        // Create assistant message placeholder
        activeStreamingBody = addMessageToUI('assistant', '...');
        activeStreamingBody.textContent = ''; // Clear placeholder
        activeAccumulator = '';

        const result = await window.electronAPI.aiGenerateResponse({
            systemPrompt: systemPrompt,
            chatHistory: recentHistory,
            maxTokens: CONFIG.MAX_TOKENS
        });

        // Finalize
        setLoading(false);
        
        if (result.success) {
            activeStreamingBody.textContent = result.content; // Set final text to be sure
            chatHistory.push({ role: 'assistant', content: result.content });
            saveHistory();

            if (isTtsEnabled) {
                speakText(result.content);
            }
        } else {
            throw new Error(result.error);
        }

        activeStreamingBody = null; // Reset
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
        if (window.electronAPI.setFocusable) {
            window.electronAPI.setFocusable(false);
            window.electronAPI.releaseFocus();
            updateGhostStatus(true);
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
    messageInput.disabled = isLoading;
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

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function saveHistory() {
    // Keep system messages + last N exchanges for context preservation
    const systemMessages = chatHistory.filter(m => m.role === 'system');
    const recentMessages = chatHistory.filter(m => m.role !== 'system').slice(-CONFIG.MAX_CHAT_HISTORY);
    chatHistory = [...systemMessages, ...recentMessages];
    
    window.electronAPI.setSetting('invisible-chat-history', chatHistory);
}

// Meeting Mode Logic (System Audio Only)
// Meeting Mode Logic (System Audio Only)
async function toggleMeetingMode() {
    isMeetingMode = !isMeetingMode;
    
    // UI Feedback on the Listen button
    if (listenBtn) {
        listenBtn.classList.toggle('active', isMeetingMode);
        listenBtn.textContent = isMeetingMode ? '🛑 Stop Listen' : '🎙️ Listen';
    }
    
    // Enhanced Visual Feedback (Indicator)
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

// TTS Toggle
function toggleTts() {
    isTtsEnabled = !isTtsEnabled;
    const btn = document.getElementById('ttsBtn');
    if (btn) btn.classList.toggle('active', isTtsEnabled);
    
    if (isTtsEnabled) {
        speakText("Text-to-Speech Activated");
    } else {
        window.speechSynthesis.cancel();
    }
}

// FIX: Proper voice loading with race condition handling
function speakText(text) {
    if (!window.speechSynthesis) return;
    
    // Wait for voices if not loaded
    if (!voicesLoaded) {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) {
            setTimeout(() => speakText(text), 100);
            return;
        }
        voicesLoaded = true;
    }
    
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = CONFIG.TTS_SPEECH_RATE;
    utterance.pitch = 1.0;
    
    const voices = window.speechSynthesis.getVoices();
    const femaleVoiceKeywords = ['Female', 'Zira', 'Samantha', 'Microsoft Zira', 'Google UK English Female', 'Sara', 'Victoria'];
    
    let preferredVoice = voices.find(v => 
        (v.name.includes('Google') || v.name.includes('Natural')) && 
        femaleVoiceKeywords.some(kw => v.name.includes(kw))
    );
    
    if (!preferredVoice) {
        preferredVoice = voices.find(v => femaleVoiceKeywords.some(kw => v.name.includes(kw)));
    }
    
    if (!preferredVoice) preferredVoice = voices[0];
    
    if (preferredVoice) utterance.voice = preferredVoice;
    
    window.speechSynthesis.speak(utterance);
}

// JD Keyword Ticker
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

async function startAudioCapture() {
    try {
        const sourceId = await window.electronAPI.getPrimarySourceId();
        if (!sourceId) throw new Error("No screen source found");

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId
                }
            }
        });

        stream.getVideoTracks().forEach(track => track.stop());
        
        const audioTracks = stream.getAudioTracks();
        console.log("Audio Tracks captured:", audioTracks.length);

        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        // FIX: Enhanced error handling and stream validation
        mediaRecorder.onstop = async () => {
            if (audioChunks.length > 0) {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = [];
                await processAudioChunk(audioBlob);
            }
            
            if (isMeetingMode) {
                try {
                    if (mediaRecorder && mediaRecorder.stream && mediaRecorder.stream.active) {
                        mediaRecorder.start();
                        setTimeout(() => { 
                            if (mediaRecorder && mediaRecorder.state === 'recording') {
                                mediaRecorder.stop(); 
                            }
                        }, CONFIG.AUDIO_CHUNK_DURATION_MS);
                    } else {
                        console.error('Stream no longer active, stopping meeting mode');
                        toggleMeetingMode();
                    }
                } catch (error) {
                    console.error('Failed to restart recording:', error);
                    toggleMeetingMode();
                }
            }
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

        addMessageToUI('system', "🎙️ Listen Error: Access denied. IMPORTANT: When the capture window appears, you MUST select 'System Audio' or 'Entire Screen' and check the 'Share Audio' box.");
        console.warn("Failed to start audio capture. Make sure to share 'System Audio'.");
    }
}

// FIX: Proper cleanup with null check
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

// Proper semantic version comparison: returns 1 if a > b, -1 if a < b, 0 if equal
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
            // Semantic version comparison: Only update if remote is strictly newer
            if (compareVersions(updateInfo.version, currentVersion) > 0) {
            console.log(`Update available: ${updateInfo.version} (Current: ${currentVersion})`);
            
            // Inject a subtle system message into the chat
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
                alert(`You are on the latest version (v${currentVersion}).`);
            }
        } else if (showFeedback) {
            alert(`Update check failed: ${updateInfo.error}`);
        }
    } catch (err) {
        console.warn('Silent Update Check failed (Likely offline):', err);
        if (showFeedback) alert('Update check failed (Offline?)');
    }
}

// Final Initialization
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupGlobalInterceptors();
    });
} else {
    init();
    setupGlobalInterceptors();
}

function setupGlobalInterceptors() {
    // Only attach once
    if (window._interceptorsAttached) return;
    window._interceptorsAttached = true;

    console.log("Global Interceptors Attached");

    // Dynamic Click-Through Management (Robust Strategy)
    window.addEventListener('mousemove', (e) => {
        try {
            // CRITICAL: If ANY overlay/modal is visible, NEVER ignore mouse events
            // Otherwise inputs inside modals become unclickable
            const hasVisibleOverlay = document.querySelector('.overlay:not(.hidden)');
            if (hasVisibleOverlay) {
                window.electronAPI.setIgnoreMouseEvents(false);
                return;
            }

            const interactive = e.target && e.target.closest && e.target.closest('.app-container, .top-bar, button, input, textarea, .input-area, .send-btn, .action-bar, .action-buttons, #chatContainer, #messages, .message, .file-chip, .ocr-line, .keyword-tag, #ghostStatus, .remove-file, .copy-btn, .copy-btn *, .modal-body, .modal-footer, .modal-box, .auth-box, .onboarding-box, .overlay-content, .overlay-actions');
            if (interactive) {
                window.electronAPI.setIgnoreMouseEvents(false);
            } else {
                window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
            }
        } catch (err) {}
    });

    document.addEventListener('mousedown', async (e) => {
        // ... (Interception Logic)
        const grabBtn = e.target.closest('#analyseScreenBtn'); 
        const meetingBtn = e.target.closest('#listenBtn');
        const answerBtn = e.target.closest('#answerQuestionBtn');
        const hideButton = e.target.closest('#hideBtn');
        const exitButton = e.target.closest('#exitBtn');
        const ghostBtn = e.target.closest('#ghostStatus');
        const settingsBtn = e.target.closest('#settingsBtn');
        const uploadResumeBtn = e.target.closest('#uploadResumeBtn');
        const uploadJdBtn = e.target.closest('#uploadJdBtn');
        const uploadProjectBtn = e.target.closest('#uploadProjectBtn');
        const uploadProjectFolderBtn = e.target.closest('#uploadProjectFolderBtn');
        const closeSettings = e.target.closest('#closeSettings');
        const saveSettings = e.target.closest('#saveSettings');
        const onboardingBtn = e.target.closest('#finishOnboarding');
        const ttsBtn = e.target.closest('#ttsBtn');
        const ocrBtn = e.target.closest('#sendOcr');
        const cancelBtn = e.target.closest('#cancelOcr');
        const ocrLine = e.target.closest('.ocr-line');
        const resetFocusBtn = e.target.closest('#resetFocusBtn');
        const isModalInput = e.target.closest('.modal-content, .modal-box') && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
        const isAuthInput = e.target.closest('.auth-box') && (e.target.tagName === 'INPUT');
        const isOnboardingInput = e.target.closest('.onboarding-box') && (e.target.tagName === 'INPUT');
        const isChatInput = e.target === messageInput;
        const removeFileBtn = e.target.closest('.remove-file');
        const copyBtn = e.target.closest('.copy-btn');
        const wipeAllDataBtn = e.target.closest('#wipeAllData');
        const checkForUpdatesBtn = e.target.closest('#checkForUpdatesBtn');
        const sendBtn = e.target.closest('#sendButton');
        const clearChat = e.target.closest('#clearChat');
        const authSubmitBtn = e.target.closest('#authSubmit');
        const authToggleBtn = e.target.closest('#authToggleBtn');

        // Allow focus for all inputs
        if (isModalInput || isAuthInput || isOnboardingInput || isChatInput) {
            console.log('Input clicked - forcing focusable');
            window.electronAPI.setFocusable(true);
            updateGhostStatus(false);
            
            // EXPLICIT FOCUS: Ensure the element actually gets keyboard focus
            const target = e.target.closest('input, textarea');
            if (target) {
                setTimeout(() => target.focus(), 10);
            }
            return;
        }

        const isInteractive = grabBtn || meetingBtn || answerBtn || hideButton || exitButton || ttsBtn || ghostBtn || settingsBtn || uploadResumeBtn || uploadJdBtn || uploadProjectBtn || uploadProjectFolderBtn || closeSettings || saveSettings || onboardingBtn || ocrBtn || cancelBtn || ocrLine || removeFileBtn || copyBtn || resetFocusBtn || wipeAllDataBtn || checkForUpdatesBtn || sendBtn || clearChat || authSubmitBtn || authToggleBtn;

        if (isInteractive) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            
            // STEALTH: Only release focus if NOT triggered by an upload button
            // Uploads need the window to remain focusable for the system dialog
            const isUpload = uploadResumeBtn || uploadJdBtn || uploadProjectBtn || uploadProjectFolderBtn;
            if (!isUpload && !settingsBtn && !authSubmitBtn && !onboardingBtn && !saveSettings && !sendBtn) {
                window.electronAPI.releaseFocus();
                if (e.target.blur) e.target.blur();
            } else {
                // For modals/uploads/critical actions, ensure we ARE focusable
                window.electronAPI.setFocusable(true);
            }

            if (ocrLine && !ocrBtn && !cancelBtn) return; // Toggle handled in click
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

            // Manual Logic Execution
            if (grabBtn) startScreenGrab();
            if (answerBtn) {
                window.electronAPI.setFocusable(true);
                updateGhostStatus(false);
                messageInput.focus();
            }
            if (meetingBtn) toggleMeetingMode();
            if (authSubmitBtn) handleAuthSubmit();
            if (authToggleBtn) {
                isSignupMode = !isSignupMode;
                const overlay = document.getElementById('authOverlay');
                if (overlay) setupAuth(); // Refresh UI
            }
            if (ttsBtn) toggleTts();
            if (uploadResumeBtn) handleResumeUpload();
            if (uploadJdBtn) handleJdUpload();
            if (uploadProjectBtn) handleProjectUpload();
            if (uploadProjectFolderBtn) handleProjectFolderUpload();
            if (hideButton) window.electronAPI.hideWindow();
            if (exitButton) window.electronAPI.quitApp();
            if (sendBtn) sendMessage();
            if (clearChat) { chatHistory = []; saveHistory(); renderHistory(); }
            if (ghostBtn) { updateGhostStatus(true); messageInput.blur(); }
            if (settingsBtn) { document.getElementById('settingsModal').classList.remove('hidden'); window.electronAPI.setFocusable(true); }
            if (closeSettings) { document.getElementById('settingsModal').classList.add('hidden'); window.electronAPI.setFocusable(false); window.electronAPI.releaseFocus(); updateGhostStatus(true); }
            if (saveSettings) handleSaveSettings(); // Refactored to separate function for cleanliness
            if (ocrBtn) { sendSelectedOcrText(); }
            if (cancelBtn) { hideOcrOverlay(); }
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
        
        // SERIALIZED SAVES: Prevent Windows File Lock Race Conditions
        await window.electronAPI.setSetting('groq-api-key', cleanKeys);
        await window.electronAPI.setSetting('user-bio', bio);
        await window.electronAPI.setSetting('user-jd', jd);
        await window.electronAPI.setSetting('user-projects', projects);
        await window.electronAPI.setSetting('stored-resumes', storedResumes);
        await window.electronAPI.setSetting('stored-jds', storedJDs);
        await window.electronAPI.setSetting('stored-projects', storedProjects);
        
        chatHistory = []; saveHistory(); renderHistory();
        await loadSettings();
        
        if (saveBtn) {
            saveBtn.textContent = "✅ Saved!";
            saveBtn.style.background = "#22c55e";
        }

        setTimeout(() => {
            document.getElementById('settingsModal').classList.add('hidden');
            if (saveBtn) {
                saveBtn.textContent = "Save";
                saveBtn.style.background = "";
                saveBtn.disabled = false;
            }
            window.electronAPI.setFocusable(false); 
            window.electronAPI.releaseFocus(); 
            updateGhostStatus(true);
        }, 1000);

    } catch (err) { 
        console.error('Save failed:', err); 
        const saveBtn = document.getElementById('saveSettings');
        if (saveBtn) {
            // Show actual error for debugging (e.g. EPERM)
            const errMsg = err.code || err.message || "Unknown Error";
            saveBtn.textContent = `❌ ${errMsg.substring(0, 15)}`;
            saveBtn.disabled = false;
        }
    }
}

// === UX & VISUAL FEEDBACK UTILITIES ===

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    
    toast.innerHTML = `<span style="font-size: 1.2em;">${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Remove after animation
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 3000);
}

// Global Error Handler
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global Error:', message, error);
    if (message && message.includes('ResizeObserver')) return;
    showToast(`System Error: ${message}`, 'error');
};

window.addEventListener('unhandledrejection', function(event) {
    // Optional: showToast(`Async Error: ${event.reason}`, 'error');
});

// Onboarding Logic
async function checkFirstRun() {
    const hasSeen = await window.electronAPI.getSetting('has-seen-onboarding');
    if (hasSeen === 'true') return;

    // Show Welcome Message
    const welcomeMsg = `
        <div class="bubble" style="border: 1px solid var(--accent-blue); background: rgba(59, 130, 246, 0.1);">
            <h3>👋 Welcome to Ghost AI</h3>
            <p><strong>Stealth Mode Active:</strong> Calls will pass through the window unless you hold <code>Ctrl</code> or click a button.</p>
            <hr style="border-color: var(--border-subtle); margin: 8px 0;">
            <p><strong>Shortcuts:</strong></p>
            <ul>
                <li><code>Up + Down Arrows</code>: Toggle Visibility</li>
                <li><code>Left + Right Arrows</code>: Capture Screen</li>
                <li><code>Ctrl + .</code>: Emergency Toggle</li>
            </ul>
            <br>
            <p><em>Tip: Click the "Focus" counter at the top to reset your limit.</em></p>
        </div>
    `;
    addMessageToUI('system', welcomeMsg);
    
    await window.electronAPI.setSetting('has-seen-onboarding', 'true');
}