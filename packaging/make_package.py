"""Assemble the portable MILo Studio package (unzip-and-run, no installer).

Usage:  venv\\python.exe packaging\\make_package.py [output_dir] [--zip]

Run packaging\\build_extensions.bat first so every extension is precompiled for
several GPU architectures and no editable (absolute-path) installs remain.
"""
import os
import shutil
import subprocess
import sys
import sysconfig

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else \
    os.path.join(os.path.dirname(ROOT), "MILo-Studio-win64")
make_zip = "--zip" in sys.argv

# ---------------------------------------------------------------- sanity checks
site = sysconfig.get_paths()["platlib"]
problems = []
for f in os.listdir(site):
    if f.startswith("__editable__"):
        problems.append(f"editable install still present: {f} (run packaging\\build_extensions.bat)")
if not os.path.isfile(os.path.join(site, "nvdiffrast_plugin.pyd")):
    problems.append("precompiled nvdiffrast_plugin.pyd missing (run packaging\\build_extensions.bat)")
if not os.path.isfile(os.path.join(ROOT, "tools", "colmap", "bin", "colmap.exe")):
    problems.append("tools\\colmap\\bin\\colmap.exe missing")
if not os.path.isfile(os.path.join(ROOT, "cache", "torch", "hub", "checkpoints", "vgg16-397923af.pth")):
    problems.append("cache\\torch\\hub\\checkpoints\\vgg16-397923af.pth missing (LPIPS weights)")
if problems:
    print("\n".join("[ERROR] " + p for p in problems))
    sys.exit(1)

# ---------------------------------------------------------------- copy
# (source, ignore patterns). Everything else in the repo (data, output, workspace,
# build artifacts, git metadata, extension sources) stays out of the package.
ITEMS = [
    # playwright/greenlet/pyee are only used to make documentation screenshots
    ("venv", ["__pycache__", "*.pyc", "pkgs", "conda-meta", "playwright", "playwright-*", "greenlet*", "pyee*"]),
    ("milo", ["__pycache__", "output", "*.pyc"]),
    ("webui", ["__pycache__", "*.pyc"]),
    ("tools/colmap", []),
    ("cache/torch", []),
    ("submodules/Depth-Anything-V2", [".git", "assets", "metric_depth"]),
    ("assets", []),
    ("start.bat", None),
    ("README.md", None),
    ("LICENSE.md", None),
]

if os.path.exists(out):
    print(f"[INFO] removing old {out}")
    shutil.rmtree(out)
os.makedirs(out)
for rel, ignore in ITEMS:
    src = os.path.join(ROOT, rel)
    dst = os.path.join(out, rel)
    print(f"[INFO] copying {rel}")
    if ignore is None:
        shutil.copy2(src, dst)
    else:
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*ignore))
os.makedirs(os.path.join(out, "workspace", "projects"))

with open(os.path.join(out, "使用说明.txt"), "w", encoding="utf-8") as f:
    f.write(
        "MILo Studio 整合包（Windows 64 位）\n"
        "==================================\n\n"
        "1. 把整个文件夹放到纯英文、不含空格的路径下，例如 D:\\MILo-Studio-win64\n"
        "2. 双击 start.bat，浏览器会自动打开 http://127.0.0.1:7860\n"
        "3. 关闭 start.bat 的黑色窗口即可停止全部服务（包括正在进行的训练）\n\n"
        "电脑要求：NVIDIA RTX 20 / 30 / 40 系列显卡，显存 8GB 以上（推荐 12GB 以上），\n"
        "          显卡驱动 528 或更高版本；不需要安装 Python、CUDA 或 Visual Studio。\n\n"
        "你的项目、训练结果和导出的模型都保存在 workspace\\projects 目录下。\n"
        "项目主页：https://github.com/Langjudy/MILo\n"
    )

size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
print(f"[OK] package folder: {out}  ({size / 1e9:.2f} GB)")

if make_zip:
    z = out + ".zip"
    print(f"[INFO] creating {z} ...")
    if os.path.exists(z):
        os.remove(z)
    # bsdtar (built into Windows 10+) writes zip64 for >4GB archives
    subprocess.run(["tar", "-a", "-c", "-f", z, "-C", os.path.dirname(out), os.path.basename(out)], check=True)
    print(f"[OK] {z}  ({os.path.getsize(z) / 1e9:.2f} GB)")
