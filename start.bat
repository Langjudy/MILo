@echo off
chcp 65001 >nul
title MILo Studio  ^|  关闭此窗口即停止全部服务
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%ROOT%venv\python.exe" (
    echo [错误] 找不到 %ROOT%venv\python.exe ，整合包不完整，请重新解压。
    pause
    exit /b 1
)

REM ---- Optional developer toolchain. The portable package ships every CUDA extension
REM ---- precompiled, so MSVC / CUDA Toolkit are NOT required to run MILo Studio.
REM ---- If they are installed (developer machine), set them up so nvdiffrast can still
REM ---- JIT-compile when the precompiled plugin is missing.
set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" (
    set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\Installer;%PATH%"
    call "%VCVARS%" -vcvars_ver=14.29 >nul 2>nul
    set "DISTUTILS_USE_SDK=1"
)
if exist "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2\bin\nvcc.exe" (
    set "CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2"
    set "CUDA_PATH=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2"
)

REM ---- bundled model weights (LPIPS/VGG) live inside the package, no download needed
set "TORCH_HOME=%ROOT%cache\torch"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
set "PATH=%ROOT%venv;%ROOT%venv\Library\bin;%ROOT%venv\Scripts;%ROOT%tools\colmap\bin;%PATH%"

echo.
echo   正在启动 MILo Studio ...
echo.
"%ROOT%venv\python.exe" "%ROOT%webui\server.py"

echo.
echo   MILo Studio 已停止。
pause
endlocal
