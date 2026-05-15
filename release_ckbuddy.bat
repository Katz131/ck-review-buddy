@echo off
REM ============================================================
REM CK Buddy release-to-GitHub button
REM
REM Double-click this file after Claude has updated the version
REM numbers (via bump.js). It will:
REM   1. Read the version from manifest.json
REM   2. Commit all pending changes
REM   3. Create a v<version> tag
REM   4. Push everything to GitHub
REM
REM FIRST TIME SETUP (run these once in this folder):
REM   git init
REM   git remote add origin https://github.com/Katz131/ck-review-buddy.git
REM   git branch -M main
REM ============================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   CK Buddy release button
echo ============================================================
echo.

REM ---- Locate git.exe ----
set "GIT_EXE="
if exist "C:\Program Files\Git\cmd\git.exe" set "GIT_EXE=C:\Program Files\Git\cmd\git.exe"
if not defined GIT_EXE if exist "C:\Program Files (x86)\Git\cmd\git.exe" set "GIT_EXE=C:\Program Files (x86)\Git\cmd\git.exe"
if not defined GIT_EXE if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT_EXE=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not defined GIT_EXE (
    for /f "usebackq delims=" %%G in (`where git 2^>nul`) do if not defined GIT_EXE set "GIT_EXE=%%G"
)
if not defined GIT_EXE (
    echo ERROR: Could not find git.exe.
    echo Looked in:
    echo   C:\Program Files\Git\cmd\git.exe
    echo   C:\Program Files (x86^)\Git\cmd\git.exe
    echo   %LOCALAPPDATA%\Programs\Git\cmd\git.exe
    echo   and PATH via "where git".
    echo Press any key to close...
    pause >nul
    exit /b 1
)
echo Using git: "%GIT_EXE%"
echo.

REM ---- Pull version out of manifest.json via PowerShell ----
for /f "usebackq delims=" %%V in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content -Raw manifest.json | ConvertFrom-Json).version"`) do set VERSION=%%V

if "%VERSION%"=="" (
    echo ERROR: Could not read version from manifest.json.
    echo Press any key to close...
    pause >nul
    exit /b 1
)

echo Detected version: v%VERSION%
echo.

REM ---- Stage and commit any changes ----
echo Staging changes...
"%GIT_EXE%" add -A
if errorlevel 1 goto :fail

REM Only commit if there are staged changes
"%GIT_EXE%" diff --cached --quiet
if errorlevel 1 (
    echo Committing...
    "%GIT_EXE%" commit -m "CK Buddy v%VERSION%"
    if errorlevel 1 goto :fail
) else (
    echo No new file changes to commit. Tag-only release.
)

REM ---- Create tag (skip if it already exists) ----
"%GIT_EXE%" rev-parse -q --verify "refs/tags/v%VERSION%" >nul
if errorlevel 1 (
    echo Creating tag v%VERSION%...
    "%GIT_EXE%" tag -a "v%VERSION%" -m "CK Buddy v%VERSION%"
    if errorlevel 1 goto :fail
) else (
    echo Tag v%VERSION% already exists locally, skipping create.
)

REM ---- Push main ----
echo Pushing main branch...
"%GIT_EXE%" push origin main
if errorlevel 1 goto :fail

REM ---- Push tag ----
echo Pushing tag v%VERSION%...
"%GIT_EXE%" push origin "v%VERSION%"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo   DONE! Released CK Buddy v%VERSION% to GitHub.
echo ============================================================
echo.
echo Press any key to close...
pause >nul
endlocal
exit /b 0

:fail
echo.
echo ============================================================
echo   Something went wrong. Look at the messages above.
echo ============================================================
echo.
echo Press any key to close...
pause >nul
endlocal
exit /b 1
