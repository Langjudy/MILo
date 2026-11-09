"""JSON-file metadata store: projects -> dataset, training runs, exports."""
import json
import os
import random
import shutil
import string
import struct
import threading
import time

from .paths import PROJECTS_DIR, project_dir

_lock = threading.RLock()


def _now() -> float:
    return time.time()


def new_id(prefix: str) -> str:
    stamp = time.strftime("%Y%m%d_%H%M%S")
    tail = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"{prefix}_{stamp}_{tail}"


# On Windows, os.replace() and open() fail with PermissionError while another thread
# has the same file open, so both sides retry briefly.
def _read(path: str, default=None):
    for attempt in range(20):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return default
        except (PermissionError, json.JSONDecodeError):
            if attempt == 19:
                return default
            time.sleep(0.02)
    return default


def _write(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    for attempt in range(50):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 49:
                raise
            time.sleep(0.02)


# ---------------------------------------------------------------- projects
def project_file(pid: str) -> str:
    return os.path.join(project_dir(pid), "project.json")


def list_projects():
    out = []
    with _lock:
        for pid in os.listdir(PROJECTS_DIR):
            p = _read(project_file(pid))
            if p:
                p["runs"] = list_runs(pid)
                p["exports"] = list_exports(pid)
                out.append(p)
    out.sort(key=lambda p: p.get("updated", 0), reverse=True)
    return out


def get_project(pid: str):
    p = _read(project_file(pid))
    if p is None:
        return None
    p["runs"] = list_runs(pid)
    p["exports"] = list_exports(pid)
    return p


def create_project(name: str, source: str, dataset_path: str = None):
    pid = new_id("p")
    p = {
        "id": pid,
        "name": name or pid,
        "source": source,  # video | images | colmap
        "created": _now(),
        "updated": _now(),
        "dataset": {
            "path": dataset_path or os.path.join(project_dir(pid), "dataset"),
            "external": bool(dataset_path),
            "status": "ready" if dataset_path else "empty",  # empty|uploaded|processing|ready|failed
            "num_frames": 0,
            "num_registered": 0,
            "uploads": [],
        },
    }
    if dataset_path:
        p["dataset"].update(inspect_dataset(dataset_path))
    save_project(p)
    return p


def save_project(p) -> None:
    p = {k: v for k, v in p.items() if k not in ("runs", "exports")}
    p["updated"] = _now()
    with _lock:
        _write(project_file(p["id"]), p)


def update_dataset(pid: str, **fields):
    with _lock:
        p = _read(project_file(pid))
        p["dataset"].update(fields)
        save_project(p)
        return p


def delete_project(pid: str) -> None:
    with _lock:
        shutil.rmtree(project_dir(pid), ignore_errors=True)


def inspect_dataset(path: str) -> dict:
    """Count images and registered cameras in a COLMAP dataset directory."""
    info = {"num_frames": 0, "num_registered": 0}
    img_dir = os.path.join(path, "images")
    if os.path.isdir(img_dir):
        info["num_frames"] = len([f for f in os.listdir(img_dir) if not f.startswith(".")])
    for cand in (os.path.join(path, "sparse", "0", "images.bin"), os.path.join(path, "sparse", "images.bin")):
        if os.path.isfile(cand):
            with open(cand, "rb") as f:
                info["num_registered"] = struct.unpack("<Q", f.read(8))[0]
            break
    return info


def is_colmap_dataset(path: str) -> bool:
    return os.path.isdir(os.path.join(path, "images")) and (
        os.path.isfile(os.path.join(path, "sparse", "0", "cameras.bin"))
        or os.path.isfile(os.path.join(path, "sparse", "0", "cameras.txt"))
    )


# ---------------------------------------------------------------- runs
def runs_dir(pid: str) -> str:
    return os.path.join(project_dir(pid), "runs")


def run_file(pid: str, rid: str) -> str:
    return os.path.join(runs_dir(pid), rid, "run.json")


def list_runs(pid: str):
    d = runs_dir(pid)
    if not os.path.isdir(d):
        return []
    runs = [_read(run_file(pid, rid)) for rid in os.listdir(d)]
    runs = [r for r in runs if r]
    runs.sort(key=lambda r: r.get("created", 0), reverse=True)
    return runs


def get_run(pid: str, rid: str):
    return _read(run_file(pid, rid))


def create_run(pid: str, name: str, params: dict, model_path: str = None):
    rid = new_id("r")
    r = {
        "id": rid,
        "project": pid,
        "name": name or rid,
        "created": _now(),
        "params": params,
        "model_path": model_path or os.path.join(runs_dir(pid), rid, "model"),
        "external": bool(model_path),
        "status": "ready" if model_path else "queued",
        "metrics": {},
    }
    _write(run_file(pid, rid), r)
    return r


def update_run(pid: str, rid: str, **fields):
    with _lock:
        r = _read(run_file(pid, rid))
        if r is None:
            return None
        r.update(fields)
        _write(run_file(pid, rid), r)
        return r


def delete_run(pid: str, rid: str):
    shutil.rmtree(os.path.join(runs_dir(pid), rid), ignore_errors=True)


def latest_iteration(model_path: str):
    pc = os.path.join(model_path, "point_cloud")
    if not os.path.isdir(pc):
        return None
    its = []
    for d in os.listdir(pc):
        if d.startswith("iteration_") and os.path.isfile(os.path.join(pc, d, "point_cloud.ply")):
            try:
                its.append(int(d.split("_")[1]))
            except ValueError:
                pass
    return max(its) if its else None


def is_model_dir(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "cfg_args")) and latest_iteration(path) is not None


# ---------------------------------------------------------------- exports
def exports_dir(pid: str) -> str:
    return os.path.join(project_dir(pid), "exports")


def export_file(pid: str, eid: str) -> str:
    return os.path.join(exports_dir(pid), eid, "export.json")


def list_exports(pid: str):
    d = exports_dir(pid)
    if not os.path.isdir(d):
        return []
    ex = [_read(export_file(pid, e)) for e in os.listdir(d)]
    ex = [e for e in ex if e]
    ex.sort(key=lambda e: e.get("created", 0), reverse=True)
    return ex


def get_export(pid: str, eid: str):
    return _read(export_file(pid, eid))


def create_export(pid: str, rid: str, name: str, params: dict):
    eid = new_id("e")
    e = {
        "id": eid,
        "project": pid,
        "run": rid,
        "name": name or eid,
        "created": _now(),
        "params": params,
        "status": "queued",
        "files": [],
        "stats": {},
    }
    _write(export_file(pid, eid), e)
    return e


def update_export(pid: str, eid: str, **fields):
    with _lock:
        e = _read(export_file(pid, eid))
        if e is None:
            return None
        e.update(fields)
        _write(export_file(pid, eid), e)
        return e


def delete_export(pid: str, eid: str):
    shutil.rmtree(os.path.join(exports_dir(pid), eid), ignore_errors=True)
