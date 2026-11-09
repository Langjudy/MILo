@echo off
REM MILo native-Windows environment. Usage:
REM   milo_env.bat                 -> opens a shell with the env set up
REM   milo_env.bat train.py ...    -> runs a script from milo\ with venv python
REM nvdiffrast JIT-compiles its CUDA kernels on first use, so cl.exe/nvcc must be on PATH.
REM MSVC 14.29 is used because CUDA 12.2's nvcc rejects the newer 14.4x toolset.
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\Installer;%PATH%"
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" -vcvars_ver=14.29 >nul
set DISTUTILS_USE_SDK=1
set CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2
set CUDA_PATH=%CUDA_HOME%
set TORCH_CUDA_ARCH_LIST=8.9
set PYTHONIOENCODING=utf-8
set "PATH=%~dp0venv;%~dp0venv\Library\bin;%~dp0venv\Scripts;%PATH%"
cd /d "%~dp0milo"
if "%~1"=="" (
    echo MILo env ready. Use: python train.py -s ^<data^> -m ^<output^> ...
    cmd /k
) else (
    "%~dp0venv\python.exe" %*
)
