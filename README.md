# 📝 Invisible Notes (Windows)

**A Windows note-taking app that stays completely invisible during screen sharing.**

Perfect for taking private notes during Zoom, Google Meet, Teams, or any other video calls without others seeing your notes!

---

## ✨ Features

- 🔒 **100% Invisible** - Uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` to hide from all screen capture
- ⌨️ **Global Hotkey** - Press `Ctrl+Shift+N` to show/hide notes instantly
- 💾 **Auto-Save** - Your notes are automatically saved as you type
- 🎯 **Always On Top** - Window floats above other apps for easy reference
- 🌙 **Dark Mode** - Beautiful semi-transparent dark interface
- 📊 **Word Count** - Track your note length in real-time
- 📌 **System Tray** - Runs in the system tray for quick access

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (https://nodejs.org/)
- Windows 10 Version 2004 or later (for screen capture exclusion)

### Install & Run

```powershell
# Navigate to the project
cd InvisibleNotes-Windows

# Install dependencies
npm install

# Run the app
npm start
```

### Optional: Enable Screen Capture Exclusion
For the screen capture exclusion to work, you need native modules:

```powershell
npm install ffi-napi ref-napi
npm run rebuild
```

> **Note**: The app works fine without these - you just won't have the screen capture exclusion feature.

---

## 📖 Usage

1. **Launch the app** - It will appear in your system tray (📝 icon)
2. **Show notes** - Press `Ctrl+Shift+N` or click the tray icon → "Show/Hide Notes"
3. **Take notes** - Type away! Your notes auto-save
4. **Hide notes** - Press `Ctrl+Shift+N` again
5. **Share your screen** - Your notes stay visible to YOU but invisible to others! ✨

---

## 🔒 How It Works

The app uses Windows's `SetWindowDisplayAffinity` API with `WDA_EXCLUDEFROMCAPTURE`, which tells the system to exclude this window from:
- Screen recordings
- Screenshots (Win+Shift+S, Snipping Tool)
- Screen sharing (Zoom, Meet, Teams, Discord, etc.)
- Any other screen capture method

**You** can see the notes on your screen, but they won't appear in any shared/captured content!

---

## ⚙️ Technical Details

- **Platform**: Windows 10 Version 2004+
- **Framework**: Electron
- **Storage**: localStorage
- **Screen Exclusion**: `SetWindowDisplayAffinity` via ffi-napi

---

## 🐛 Troubleshooting

**Hotkey not working?**
- Another app might be using Ctrl+Shift+N
- Try restarting the app

**Window appearing in screenshots?**
- Make sure you have ffi-napi and ref-napi installed
- Check the console for any errors
- Requires Windows 10 Version 2004 or later

**App not starting?**
- Make sure Node.js is installed
- Run `npm install` again

---

## 💡 Tips

- Keep the notes window small and in a corner during calls
- Use it for meeting agendas, action items, or quick references
- Great for teleprompter-style scripts during presentations
- Perfect for keeping private information visible while screen sharing

---

**Enjoy your invisible note-taking! 🎉**
