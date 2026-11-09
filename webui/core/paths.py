"""Filesystem layout for MILo Studio."""
import os
import sys

WEBUI_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(WEBUI_DIR)
MILO_DIR = os.path.join(ROOT_DIR, "milo")
WORKSPACE_DIR = os.path.join(ROOT_DIR, "workspace")
PROJECTS_DIR = os.path.join(WORKSPACE_DIR, "projects")
STATIC_DIR = os.path.join(WEBUI_DIR, "static")
TOOLS_DIR = os.path.join(WEBUI_DIR, "tools")
COLMAP_EXE = os.path.join(ROOT_DIR, "tools", "colmap", "bin", "colmap.exe")
DEPTH_ANYTHING_CKPT = os.path.join(
    ROOT_DIR, "submodules", "Depth-Anything-V2", "checkpoints", "depth_anything_v2_vitl.pth"
)
PYTHON = sys.executable

os.makedirs(PROJECTS_DIR, exist_ok=True)


def project_dir(pid: str) -> str:
    return os.path.join(PROJECTS_DIR, pid)
