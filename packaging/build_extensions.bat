@echo off
chcp 65001 >nul
REM Rebuild every native extension for several GPU generations so the environment can be
REM shipped to other machines (RTX 20/30/40, A100, H100; newer GPUs via PTX), and turn the
REM two editable installs (nvdiffrast, tetra-nerf) into normal site-packages installs.
REM Needs: Visual Studio 2022 with the MSVC 14.29 toolset, CUDA Toolkit 12.2.
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "PY=%ROOT%\venv\python.exe"

set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\Installer;%PATH%"
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" -vcvars_ver=14.29 >nul || goto :fail
set "CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.2"
set "CUDA_PATH=%CUDA_HOME%"
set "DISTUTILS_USE_SDK=1"
if "%MILO_CUDA_ARCHS%"=="" set "MILO_CUDA_ARCHS=7.5;8.0;8.6;8.9;9.0+PTX"
set "TORCH_CUDA_ARCH_LIST=%MILO_CUDA_ARCHS%"
set "MAX_JOBS=8"
set "PATH=%ROOT%\venv;%ROOT%\venv\Library\bin;%ROOT%\venv\Scripts;%PATH%"
echo [INFO] TORCH_CUDA_ARCH_LIST=%TORCH_CUDA_ARCH_LIST%

for %%E in (simple-knn fused-ssim diff-gaussian-rasterization diff-gaussian-rasterization_ms diff-gaussian-rasterization_gof) do (
    echo.
    echo ===== %%E
    "%PY%" -m pip install --no-build-isolation --no-deps --force-reinstall --no-cache-dir "submodules\%%E" || goto :fail
)

echo.
echo ===== nvdiffrast (non-editable) + precompiled plugin
"%PY%" -m pip uninstall -y nvdiffrast
"%PY%" -m pip install --no-build-isolation --no-deps --no-cache-dir "submodules\nvdiffrast" || goto :fail
"%PY%" packaging\build_nvdiffrast_plugin.py || goto :fail

echo.
echo ===== tetra-nerf (CGAL Delaunay, non-editable wheel)
"%PY%" -m pip uninstall -y tetra-nerf
pushd submodules\tetra_triangulation
rmdir /s /q build dist 2>nul
"%PY%" setup_win.py build_ext --inplace || (popd & goto :fail)
"%PY%" setup_win.py bdist_wheel || (popd & goto :fail)
for %%W in (dist\*.whl) do "%PY%" -m pip install --no-deps --force-reinstall "%%W" || (popd & goto :fail)
popd

echo.
echo [OK] all extensions rebuilt for %TORCH_CUDA_ARCH_LIST%
exit /b 0

:fail
echo [FAILED] see the messages above
exit /b 1
