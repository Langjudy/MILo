# Windows build of the tetranerf CGAL Delaunay extension.
# The upstream CMake build relies on GCC/make; this uses torch's extension
# builder with MSVC instead. CGAL/GMP/MPFR come from conda-forge in the env.
import os
import sys

from setuptools import setup, find_packages
from torch.utils.cpp_extension import CUDAExtension, BuildExtension

here = os.path.dirname(os.path.abspath(__file__))
prefix = os.path.join(sys.prefix, "Library")

setup(
    name="tetra-nerf",
    version="0.1.1",
    packages=find_packages(),
    ext_modules=[
        CUDAExtension(
            name="tetranerf.utils.extension.tetranerf_cpp_extension",
            sources=["src/triangulation.cpp", "src/py_binding.cpp"],
            include_dirs=[os.path.join(here, "src"), os.path.join(prefix, "include")],
            library_dirs=[os.path.join(prefix, "lib")],
            libraries=["gmp", "mpfr"],
            extra_compile_args={"cxx": ["/std:c++17", "/bigobj", "/EHsc", "/DNOMINMAX"]},
        )
    ],
    cmdclass={"build_ext": BuildExtension},
    zip_safe=False,
)
