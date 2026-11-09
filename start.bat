@echo off
chcp 65001 >nul
title MILo Studio  ^|  关闭此窗口即停止全部服务
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%ROOT%venv\python.exe" (
    echo [错误] 找不到 %ROOT%venv\python.exe ，请先按说明安装环境。
    pause
    exit /b 1
)

REM ---- MSVC 14.29 toolset: nvdiffrast JIT-compiles CUDA kernels on first use,
REM ---- and CUDA 12.2's nvcc does not accept the newer 14.4x toolset.
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\Installer;%PATH%"
set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" (
    call "%VCVARS%" -vcvars_ver=14.29 >nul
) else (
    echo [警告] 未找到 Visual Studio 2022 编译环境，网格渲染模块可能无法首次编译。
)

set "CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2"
set "CUDA_PATH=%CUDA_HOME%"
set "TORCH_CUDA_ARCH_LIST=8.9"
set "DISTUTILS_USE_SDK=1"
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
