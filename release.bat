@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: ── Read version from manifest.json ──
for /f "tokens=2 delims=:" %%a in ('findstr /C:"\"version\"" manifest.json') do (
    set "RAW=%%a"
)
set "RAW=%RAW: =%"
set "RAW=%RAW:"=%"
set "RAW=%RAW:,=%"
set "VER=%RAW%"

for /f "tokens=2 delims=:" %%a in ('findstr /C:"\"name\"" manifest.json') do (
    set "NRAW=%%a"
)
:: Extract vXXX from the name field
for /f "tokens=1 delims= " %%b in ('echo %NRAW% ^| findstr /R "v[0-9]*"') do (
    set "VTAG=%%b"
)
:: Clean up
set "VTAG=%VTAG: =%"
set "VTAG=%VTAG:"=%"
set "VTAG=%VTAG:,=%"
for /f "tokens=*" %%c in ('echo %NRAW%') do set "NRAW=%%c"

echo.
echo ====================================
echo   CK Buddy Release Script
echo ====================================
echo   Version: %VER% (%VTAG%)
echo ====================================
echo.

:: ── Check if git is installed ──
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: git is not installed or not in PATH.
    echo Install from https://git-scm.com/download/win
    pause
    exit /b 1
)

:: ── Initialize repo if needed ──
if not exist ".git" (
    echo No git repo found. Initializing...
    git init
    git branch -M main

    :: Create .gitignore
    echo Creating .gitignore...
    (
        echo # Old version backups
        echo ck_buddy_v*/
        echo mnt/
        echo.
        echo # OS junk
        echo .DS_Store
        echo Thumbs.db
        echo desktop.ini
        echo.
        echo # Node
        echo node_modules/
        echo.
        echo # Secrets
        echo *.pem
        echo *.key
    ) > .gitignore

    echo.
    echo ── First-time setup ──
    set /p "REPO_URL=Enter your GitHub repo URL (e.g. https://github.com/user/ck-review-buddy.git): "
    if "!REPO_URL!"=="" (
        echo No URL provided. Create a repo on GitHub first, then re-run.
        pause
        exit /b 1
    )
    git remote add origin !REPO_URL!
    echo Remote set to: !REPO_URL!
    echo.
)

:: ── Stage, commit, tag, push ──
echo Staging all changes...
git add -A

echo.
echo Changes to be committed:
git status --short
echo.

set "MSG=Release %VTAG% (manifest %VER%)"
set /p "CUSTOM_MSG=Commit message [%MSG%]: "
if not "!CUSTOM_MSG!"=="" set "MSG=!CUSTOM_MSG!"

git commit -m "%MSG%"
if %errorlevel% neq 0 (
    echo Nothing to commit — already up to date.
    pause
    exit /b 0
)

:: Tag this release
git tag -a "%VTAG%" -m "Release %VTAG%" 2>nul
if %errorlevel% neq 0 (
    echo Tag %VTAG% already exists, skipping tag.
) else (
    echo Tagged as %VTAG%
)

echo.
echo Pushing to origin/main...
git push -u origin main
git push origin --tags

echo.
echo ====================================
echo   Released %VTAG% (manifest %VER%)
echo ====================================
echo.
pause
