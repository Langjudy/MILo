"""Precompile nvdiffrast's CUDA rasterizer plugin for several GPU architectures.

nvdiffrast normally JIT-compiles this plugin on first use (needs MSVC + nvcc on the
user's machine) and forces TORCH_CUDA_ARCH_LIST='' so it only targets the local GPU.
For a portable package we build it once here, for all supported architectures, and
drop the resulting nvdiffrast_plugin.pyd into site-packages. milo/scene/mesh.py then
hands it to nvdiffrast so no compiler is needed at runtime.
"""
import os
import shutil
import sys
import sysconfig

ARCHS = os.environ.get("MILO_CUDA_ARCHS", "7.5;8.0;8.6;8.9;9.0+PTX")
os.environ["TORCH_CUDA_ARCH_LIST"] = ARCHS

import torch  # noqa: E402
import torch.utils.cpp_extension as ce  # noqa: E402
import nvdiffrast.torch.ops as ops  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = os.path.dirname(ops.__file__)
sources = [
    "../common/cudaraster/impl/Buffer.cpp",
    "../common/cudaraster/impl/CudaRaster.cpp",
    "../common/cudaraster/impl/RasterImpl.cu",
    "../common/cudaraster/impl/RasterImpl.cpp",
    "../common/common.cpp",
    "../common/rasterize.cu",
    "../common/interpolate.cu",
    "../common/texture.cu",
    "../common/texture.cpp",
    "../common/antialias.cu",
    "torch_bindings.cpp",
    "torch_rasterize.cpp",
    "torch_interpolate.cpp",
    "torch_texture.cpp",
    "torch_antialias.cpp",
]
build_dir = os.path.join(ROOT, "build", "nvdiffrast_plugin")
shutil.rmtree(build_dir, ignore_errors=True)
os.makedirs(build_dir)
print(f"[INFO] building nvdiffrast_plugin for archs {ARCHS} (torch {torch.__version__}, cuda {torch.version.cuda})")
ce.load(
    name="nvdiffrast_plugin",
    sources=[os.path.normpath(os.path.join(base, s)) for s in sources],
    extra_cflags=["-DNVDR_TORCH", "/wd4067", "/wd4624"],
    extra_cuda_cflags=["-DNVDR_TORCH", "-lineinfo"],
    with_cuda=True,
    build_directory=build_dir,
    verbose=False,
)
dst = sysconfig.get_paths()["platlib"]
shutil.copy2(os.path.join(build_dir, "nvdiffrast_plugin.pyd"), os.path.join(dst, "nvdiffrast_plugin.pyd"))
print(f"[INFO] installed {os.path.join(dst, 'nvdiffrast_plugin.pyd')}")
sys.exit(0)
