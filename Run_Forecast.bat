@echo off
REM ======================================================================
REM   Call Forecast  -  double-click to run
REM ======================================================================
REM   Reads every export in .\data, retrains, writes CSVs to .\outputs and
REM   opens the dashboard from .\reports.
REM
REM   First run installs what it needs into a virtualenv kept OUTSIDE this
REM   folder. That is deliberate: this project lives in OneDrive, and
REM   OneDrive's sync locks files mid-install and corrupts pip.
REM ======================================================================

setlocal
cd /d "%~dp0"

set "VENV=%USERPROFILE%\.venvs\callforecast"
set "PY=%VENV%\Scripts\python.exe"

if not exist "%PY%" (
    echo Creating the environment in %VENV% ...
    python -m venv "%VENV%"
    if errorlevel 1 (
        echo.
        echo Could not create the environment. Is Python installed and on PATH?
        echo Download it from https://www.python.org/downloads/
        echo.
        pause
        exit /b 1
    )
    echo Installing dependencies - this takes a few minutes the first time ...
    "%PY%" -m pip install --quiet --disable-pip-version-check -r requirements.txt
    if errorlevel 1 (
        echo.
        echo Dependency install failed. See the messages above.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Running the forecast ...
echo.
"%PY%" -m call_forecast run -v --root "%~dp0"

if errorlevel 1 (
    echo.
    echo The run did not complete. See the messages above.
    echo.
    pause
    exit /b 1
)

if exist "reports\dashboard.html" (
    echo.
    echo Opening the dashboard ...
    start "" "reports\dashboard.html"
)

echo.
pause
endlocal
