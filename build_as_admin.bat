@echo off
cd /d "%~dp0"
echo Starting Build Process with Admin Privileges...
npm run build
if %errorlevel% neq 0 (
    echo.
    echo BUILD FAILED!
    echo.
    pause
    exit /b %errorlevel%
)
echo.
echo BUILD SUCCESS! 
echo Check the 'dist' folder.
pause
