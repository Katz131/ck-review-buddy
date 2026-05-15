@echo off
title CK Review Buddy Installer
echo.
echo  ==========================================
echo   CK Review Buddy - Auto Installer
echo  ==========================================
echo.

:: Set install location to a fixed folder in user profile
set INSTALL_DIR=%USERPROFILE%\ck-review-buddy

:: Get the directory this bat file is in
set BAT_DIR=%~dp0

echo  Installing to: %INSTALL_DIR%
echo.

:: Create install dir if needed
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy all extension files over (replaces old version)
xcopy /E /Y /Q "%BAT_DIR%*" "%INSTALL_DIR%\" >nul 2>&1

:: Remove the bat file from the install dir (not needed there)
if exist "%INSTALL_DIR%\install.bat" del "%INSTALL_DIR%\install.bat" >nul 2>&1

echo  Done! Extension files copied to:
echo  %INSTALL_DIR%
echo.
echo  Next step:
echo  1. Open Brave and go to: brave://extensions
echo  2. Find "CK Review Buddy" and click RELOAD
echo     (or Load Unpacked if first time, select the folder above)
echo.

:: Open brave://extensions automatically
start brave "brave://extensions" >nul 2>&1
if errorlevel 1 start chrome "brave://extensions" >nul 2>&1

echo  Press any key to close...
pause >nul
