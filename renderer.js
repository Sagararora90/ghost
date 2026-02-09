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
const clearChatBtn = document.getElementById('clearChat');
const screenGrabBtn = document.getElementById('screenGrabBtn');
const ocrOverlay = document.getElementById('ocrOverlay');
const ocrLinesContainer = document.getElementById('ocrLines');
const cancelOcrBtn = document.getElementById('cancelOcr');
const sendOcrBtn = document.getElementById('sendOcr');
const listeningIndicator = document.getElementById('listeningIndicator');

// Chat State
let chatHistory = JSON.parse(localStorage.getItem('invisible-chat-history') || '[]');
let selectedOcrLines = new Set();
let isMeetingMode = false;
let mediaRecorder = null;
let audioChunks = [];
let transcriptionBuffer = "";

// Advanced Features State
let isTtsEnabled = false;
let voicesLoaded = false;

// Focus Management
let focusCount = parseInt(localStorage.getItem('focus-count') || '0');

// Initialize
async function init() {
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

        // Check for updates (subtle)
        checkForAppUpdates();
    } catch (error) {
        console.error('Initialisation Error:', error);
        alert('Init Error: ' + error.message);
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

    // Sync to UI if open
    document.getElementById('groqKeyInput').value = GROQ_API_KEYS.join('\n');
    document.getElementById('userBioInput').value = USER_BIO;
    if (document.getElementById('userJdInput')) document.getElementById('userJdInput').value = USER_JD;
    if (document.getElementById('userProjectsInput')) document.getElementById('userProjectsInput').value = USER_PROJECTS;
    
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
        chip.innerHTML = `<span>${file.name}</span><span class="remove-file" data-type="${type}" data-index="${index}">&times;</span>`;
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

    // Universal INTERCEPTOR (mousedown) - FIX: Added async
    document.addEventListener('mousedown', async (e) => {
        const ghostStatusEl = document.getElementById('ghostStatus');
        const isTypingMode = ghostStatusEl && ghostStatusEl.classList.contains('active');
        
        const grabBtn = e.target.closest('#screenGrabBtn');
        const robotBtn = e.target.closest('#robotIconContainer');
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
        const isModalInput = e.target.closest('.modal-content') && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');

        // Allow focus for modal inputs
        if (isModalInput) {
            console.log('Modal input click - enabling focus');
            window.electronAPI.setFocusable(true);
            updateGhostStatus(false);
            return;
        }

        // INTERCEPT AND RELEASE FOCUS for any interactive element
        const removeFileBtn = e.target.closest('.remove-file');
        const copyBtn = e.target.closest('.copy-btn');
        const wipeAllDataBtn = e.target.closest('#wipeAllData');
        const sendBtn = e.target.closest('#sendButton');
        const clearChat = e.target.closest('#clearChat');

        if (grabBtn || ttsBtn || robotBtn || ghostBtn || settingsBtn || uploadResumeBtn || uploadJdBtn || uploadProjectBtn || uploadProjectFolderBtn || closeSettings || saveSettings || onboardingBtn || ocrBtn || cancelBtn || ocrLine || removeFileBtn || copyBtn || resetFocusBtn || wipeAllDataBtn || sendBtn || clearChat) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // IMMUTABLE STEALTH: Drop all focus BEFORE executing logic
            window.electronAPI.releaseFocus();
            if (e.target.blur) e.target.blur();
            if (document.activeElement && document.activeElement !== messageInput) document.activeElement.blur();
            
            // OCR Selection
            if (ocrLine && !ocrBtn && !cancelBtn) {
                console.log('OCR Line Click Detected:', ocrLine.textContent);
                toggleOcrLine(ocrLine);
                return; 
            }

            // File Removal
            if (removeFileBtn) {
                const type = removeFileBtn.dataset.type;
                const index = parseInt(removeFileBtn.dataset.index);
                removeFile(type, index);
                return;
            }

            // Stealth Copy
            if (copyBtn) {
                const textToCopy = copyBtn.parentElement.querySelector('.bubble').textContent;
                window.electronAPI.copyToClipboard(textToCopy).then(() => {
                    console.log('Text copied to clipboard via Native API');
                    copyBtn.textContent = '✅';
                    setTimeout(() => copyBtn.textContent = '📄', 1500);
                }).catch(err => console.error('Copy failed:', err));
                return;
            }

            // Reset Focus Counter
            if (resetFocusBtn) {
                resetFocusCounter();
                return;
            }

            // EXECUTE LOGIC MANUALLY ON MOUSEDOWN
            if (grabBtn) startScreenGrab();
            if (ttsBtn) toggleTts();
            if (robotBtn) toggleMeetingMode();
            if (sendBtn) sendMessage();
            if (clearChat) {
                chatHistory = [];
                saveHistory();
                renderHistory();
            }
            if (ghostBtn) { 
                updateGhostStatus(true); 
                messageInput.blur(); 
            }
            
            // Settings Open/Close/Save
            if (settingsBtn) {
                document.getElementById('settingsModal').classList.remove('hidden');
                if (window.electronAPI.setFocusable) window.electronAPI.setFocusable(true);
            }
            
            if (closeSettings) {
                document.getElementById('settingsModal').classList.add('hidden');
                if (window.electronAPI.setFocusable) {
                    window.electronAPI.setFocusable(false);
                    window.electronAPI.releaseFocus();
                }
                updateGhostStatus(true);
            }
            
            // FIX: Properly handle async save
            if (saveSettings) {
                try {
                    const rawKeys = document.getElementById('groqKeyInput').value;
                    const cleanKeys = rawKeys.split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0).join('\n');
                    
                    const bio = document.getElementById('userBioInput').value.trim();
                    const jd = document.getElementById('userJdInput').value.trim();
                    const projects = document.getElementById('userProjectsInput').value.trim();
                    
                    // Save all settings in parallel
                    await Promise.all([
                        window.electronAPI.setSetting('groq-api-key', cleanKeys),
                        window.electronAPI.setSetting('user-bio', bio),
                        window.electronAPI.setSetting('user-jd', jd),
                        window.electronAPI.setSetting('user-projects', projects),
                        window.electronAPI.setSetting('stored-resumes', storedResumes),
                        window.electronAPI.setSetting('stored-jds', storedJDs),
                        window.electronAPI.setSetting('stored-projects', storedProjects)
                    ]);

                    // RESET CHAT HISTORY on identity change to clear old persona
                    chatHistory = [];
                    saveHistory();
                    renderHistory();

                    await loadSettings();
                    document.getElementById('settingsModal').classList.add('hidden');
                    
                    if (window.electronAPI.setFocusable) {
                        window.electronAPI.setFocusable(false);
                        window.electronAPI.releaseFocus();
                    }
                    updateGhostStatus(true);
                } catch (error) {
                    console.error('Settings save failed:', error);
                    alert('Failed to save settings. Please try again.');
                }
            }

            if (wipeAllDataBtn) {
                if (confirm("Are you sure? This will delete all API keys, resumes, and project code forever.")) {
                    localStorage.clear();
                    await Promise.all([
                        window.electronAPI.setSetting('groq-api-key', ''),
                        window.electronAPI.setSetting('user-bio', ''),
                        window.electronAPI.setSetting('user-jd', ''),
                        window.electronAPI.setSetting('user-projects', ''),
                        window.electronAPI.setSetting('stored-resumes', []),
                        window.electronAPI.setSetting('stored-jds', []),
                        window.electronAPI.setSetting('stored-projects', [])
                    ]);
                    location.reload(); 
                }
            }

            // Onboarding
            if (onboardingBtn) {
                const key = document.getElementById('onboardingKeyInput').value.trim();
                if (key) {
                    await window.electronAPI.setSetting('groq-api-key', key);
                    await loadSettings();
                    document.getElementById('onboardingOverlay').classList.add('hidden');
                    if (window.electronAPI.setFocusable) {
                        window.electronAPI.setFocusable(false);
                        window.electronAPI.releaseFocus();
                    }
                    updateGhostStatus(true);
                }
            }

            // Uploads
            if (uploadResumeBtn) handleResumeUpload();
            if (uploadJdBtn) handleJdUpload();
            if (uploadProjectBtn) handleProjectUpload();
            if (uploadProjectFolderBtn) handleProjectFolderUpload();
            
            // OCR Actions
            if (ocrBtn) {
                window.electronAPI.releaseFocus();
                sendSelectedOcrText();
                if (window.electronAPI.setFocusable) window.electronAPI.setFocusable(false);
            }
            if (cancelBtn) {
                window.electronAPI.releaseFocus();
                hideOcrOverlay();
            }
            
            return;
        }

        if (isTypingMode && e.target !== messageInput) {
            if (e.target.closest('.header') || e.target === chatContainer) {
                console.log('Interacting outside input while focus active - releasing');
                e.preventDefault();
                e.stopPropagation();
                window.electronAPI.releaseFocus();
                updateGhostStatus(true);
                messageInput.blur();
            }
        }
    }, { capture: true });

    // Toggle Visibility (Panic)
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

    // Dynamic Click-Through Management
    window.addEventListener('mouseenter', () => {
        console.log('Mouse entered window - disabling click-through');
        window.electronAPI.setIgnoreMouseEvents(false);
    });
    
    window.addEventListener('mouseleave', () => {
        console.log('Mouse left window - enabling click-through (Stealth Mode)');
        window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
    });
}

// FIX: Added focus counter reset function
function resetFocusCounter() {
    focusCount = 0;
    localStorage.setItem('focus-count', '0');
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
        const fileName = filePath.split(/[\\/]/).pop();
        status.textContent = "Parsing " + fileName + "...";
        
        try {
            const text = await window.electronAPI.parseResumeFile(filePath);
            if (text) {
                storedResumes.push({ name: fileName, content: text }); 
                await window.electronAPI.setSetting('stored-resumes', storedResumes); // Auto-save
                renderFileLists();
                status.textContent = "Done!";
            }
        } catch (err) {
            console.error('Resume parse error:', err);
            status.textContent = "Error parsing file.";
        }
        setTimeout(() => status.classList.add('hidden'), 3000);
    }
}

async function handleJdUpload() {
    const filePath = await window.electronAPI.selectResumeFile(); 
    if (filePath) {
        const status = document.getElementById('jdUploadStatus');
        status.classList.remove('hidden');
        const fileName = filePath.split(/[\\/]/).pop();
        status.textContent = "Parsing " + fileName + "...";
        
        try {
            const text = await window.electronAPI.parseResumeFile(filePath);
            if (text) {
                storedJDs.push({ name: fileName, content: text });
                await window.electronAPI.setSetting('stored-jds', storedJDs); // Auto-save
                renderFileLists();
                status.textContent = "Done!";
            }
        } catch (err) {
            console.error('JD parse error:', err);
            status.textContent = "Error parsing file.";
        }
        setTimeout(() => status.classList.add('hidden'), 3000);
    }
}

async function handleProjectUpload() {
    const filePath = await window.electronAPI.selectProjectFile();
    if (filePath) {
        const status = document.getElementById('projectUploadStatus');
        status.classList.remove('hidden');
        const fileName = filePath.split(/[\\/]/).pop();
        status.textContent = 'Parsing...';
        
        try {
            const text = await window.electronAPI.parseProjectZip(filePath);
            if (text) {
                storedProjects.push({ name: fileName, content: text }); 
                await window.electronAPI.setSetting('stored-projects', storedProjects); // Auto-save
                renderFileLists();
                status.textContent = 'Done!';
            }
        } catch (err) {
            console.error(err);
            status.textContent = 'Error!';
        }
        setTimeout(() => status.classList.add('hidden'), 3000);
    }
}

async function handleProjectFolderUpload() {
    const filePath = await window.electronAPI.selectProjectFolder();
    if (filePath) {
        const status = document.getElementById('projectUploadStatus');
        status.classList.remove('hidden');
        const folderName = filePath.split(/[\\/]/).pop() + "/"; 
        status.textContent = 'Scanning Folder...';
        
        try {
            const text = await window.electronAPI.parseProjectFolder(filePath);
            if (text) {
                storedProjects.push({ name: folderName, content: text }); 
                await window.electronAPI.setSetting('stored-projects', storedProjects); // Auto-save
                renderFileLists();
                status.textContent = 'Done!';
            }
        } catch (err) {
            console.error(err);
            status.textContent = 'Error!';
        }
        setTimeout(() => status.classList.add('hidden'), 3000);
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
        lineDiv.onmousedown = (e) => e.preventDefault();
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
        addMessageToUI('assistant', "Hello! I'm your Invisible AI assistant. How can I help you today?");
    } else {
        chatHistory.forEach(msg => {
            addMessageToUI(msg.role, msg.content);
        });
    }
    scrollToBottom();
}

function addMessageToUI(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role === 'user' ? 'user' : 'ai'}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = content;
    
    messageDiv.appendChild(bubble);

    // Stealth Copy Button
    const copyBtn = document.createElement('span');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = '📄';
    copyBtn.title = 'Copy Text';
    messageDiv.appendChild(copyBtn);

    messagesList.appendChild(messageDiv);
    scrollToBottom();
}

async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;

    addMessageToUI('user', content);
    chatHistory.push({ role: 'user', content: content });
    messageInput.value = '';
    autoResizeInput();
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

    // ULTIMATE HUMAN PERSONA PROMPT: Absolute first-person dominance
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
1. YOU ARE ME. Respond as the person described in the data above.
2. NEVER mention you are an AI or using provided context. 
3. Use "I", "me", "my". Answer as if you LIVED these projects.
4. Professional yet conversational Indian Tech Interview style.
5. Answer EVERY question. Stay in character no matter what.
6. Identity: If asked who you are, use the name/details from the BIO.

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
        const result = await window.electronAPI.aiGenerateResponse({
            systemPrompt: systemPrompt,
            chatHistory: recentHistory,
            maxTokens: CONFIG.MAX_TOKENS
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        const aiMessage = result.content;

        // Add AI response
        addMessageToUI('assistant', aiMessage);
        chatHistory.push({ role: 'assistant', content: aiMessage });
        saveHistory();

        if (isTtsEnabled) {
            speakText(aiMessage);
        }

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
            localStorage.setItem('focus-count', focusCount.toString());
            
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
        typingDiv.className = 'message ai system';
        typingDiv.innerHTML = '<div class="bubble">AI is thinking...</div>';
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
    
    localStorage.setItem('invisible-chat-history', JSON.stringify(chatHistory));
}

// Meeting Mode Logic (System Audio Only)
async function toggleMeetingMode() {
    isMeetingMode = !isMeetingMode;
    const robotIcon = document.getElementById('robotIconContainer');
    if (robotIcon) robotIcon.classList.toggle('active', isMeetingMode);
    listeningIndicator.classList.toggle('active', isMeetingMode);

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
                    chromeMediaSourceId: sourceId,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
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
        const robotIcon = document.getElementById('robotIconContainer');
        if (robotIcon) robotIcon.classList.remove('active');
        listeningIndicator.classList.remove('active');
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

async function checkForAppUpdates() {
    try {
        const currentVersion = await window.electronAPI.getAppVersion();
        const updateInfo = await window.electronAPI.checkForUpdates();
        
        if (updateInfo.success && updateInfo.version !== currentVersion) {
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
                applyBtn.addEventListener('click', async () => {
                    applyBtn.disabled = true;
                    applyBtn.style.opacity = '0.5';
                    applyBtn.innerText = 'Downloading...';
                    statusDiv.style.display = 'block';
                    
                    const result = await window.electronAPI.applyUpdate(updateInfo.url);
                    if (!result.success) {
                        applyBtn.disabled = false;
                        applyBtn.style.opacity = '1';
                        applyBtn.innerText = 'Retry Update';
                        statusDiv.innerText = 'Error: ' + result.error;
                        statusDiv.style.color = '#ff4b4b';
                    }
                });
            }
        }
    } catch (err) {
        console.warn('Silent Update Check failed (Likely offline):', err);
    }
}

// Start
document.addEventListener('DOMContentLoaded', init);