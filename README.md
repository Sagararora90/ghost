# 👻 Ghost AI: The Stealth Interview Partner

[![Live Site](https://img.shields.io/badge/Live-Website-blue?style=for-the-badge&logo=ghost)](https://Sagararora90.github.io/ghost/)
[![Release](https://img.shields.io/github/v/release/Sagararora90/ghost?style=for-the-badge&color=green)](https://github.com/Sagararora90/ghost/releases)

**Ghost AI** is a specialized, high-security AI assistant designed for technical candidates and professionals. It is engineered to be 100% undetectable by proctoring software, screen-sharing tools (Zoom, Teams, etc.), and screen recorders.

---

## 💎 Why Ghost AI?

*   **🛡️ Focus Guard**: Triple-layer focus protection ensures the app never "steals" focus from your active window, remaining invisible to proctoring telemetry.
*   **👁️ Display Affinity**: Built Using Windows low-level APIs to remain invisible to screen-sharing and recording software. Only you see the AI; they see your desktop.
*   **🧠 Context-Aware Brain**: Securely handles multiple AI providers (Groq, Gemini, Hugging Face) with automatic key rotation and rate-limit handling.
*   **🎤 Live Transcription**: Real-time audio capture for meeting modes, transcribing speech directly into your chat.
*   **📸 Stealth OCR**: Capture technical questions directly from your screen with a non-interactive overlay.

---

## 🚀 Quick Start

1.  **Download**: Get the latest `Ghost_Portable.zip` from [Releases](https://github.com/Sagararora90/ghost/releases).
2.  **Run**: Extract and double-click `Ghost.exe`.
3.  **Activate**: The app starts hidden. Press **`Arrow Up` + `Arrow Down`** together to bring up the interface.
4.  **Configure**: Add your API keys in Settings.

---

## ⌨️ Global Shortcuts

| Action | Keys |
| :--- | :--- |
| **Toggle Visibility** | `↑` + `↓` |
| **Quick Screen Capture** | `←` + `→` |
| **Emergency Shutdown** | `Ctrl` + `Shift` + `Alt` + `Q` |
| **Toggle Messages List** | `Ctrl` + `.` |

---

## 🔒 Security & Privacy

*   **Zero-Exposure Backend**: All API keys and sensitive AI logic are handled in the Electron Main process, never exposed to the frontend memory or network logs.
*   **Local Storage**: All your data (Bio, Resume, History) is stored locally on your machine.

---

## 🛠️ Development

Ghost is built using:
- **Electron** (Cross-platform desktop framework)
- **Node.js** (Secure backend processing)
- **Tesseract.js** (High-precision OCR)
- **uIOhook** (Global low-level keyboard/mouse hooks)

---

## 📄 License

Proprietary. Developed for the modern high-stakes technical candidate.
