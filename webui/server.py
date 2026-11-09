"""MILo Studio - local web UI for the MILo mesh reconstruction pipeline.

Run via start.bat (sets up MSVC/CUDA env). Closing the console stops everything:
the server puts itself in a Windows Job Object with KILL_ON_JOB_CLOSE, so all
training / COLMAP child processes die with it.
"""
import ctypes
import mimetypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from typing import List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))

import uvicorn  # noqa: E402
from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from core import pipelines, store  # noqa: E402
from core.jobs import MANAGER  # noqa: E402
from core.paths import (COLMAP_EXE, DEPTH_ANYTHING_CKPT, MILO_DIR, ROOT_DIR, STATIC_DIR,  # noqa: E402
                        WORKSPACE_DIR, project_dir)
from scene_geom import load_cameras, scene_frame  # noqa: E402


# ---------------------------------------------------------------- lifetime
def bind_to_job_object():
    """All child processes inherit the job; closing the console kills the whole tree."""
    if os.name != "nt":
        return
    try:
        k32 = ctypes.windll.kernel32
        job = k32.CreateJobObjectW(None, None)

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in
                        ("r", "w", "o", "rb", "wb", "ob")]

        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32),
                        ("SchedulingClass", ctypes.c_uint32)]

        class EXTENDED(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        info = EXTENDED()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info))
        k32.AssignProcessToJobObject(job, k32.GetCurrentProcess())
        bind_to_job_object.handle = job  # keep the handle alive for the life of the process
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] 无法创建 Job Object：{e}")


# The Windows registry often maps .js to text/plain, which browsers refuse for ES modules.
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".glb", "model/gltf-binary"), (".ply", "application/octet-stream"),
                    (".svg", "image/svg+xml"), (".wasm", "application/wasm")):
    mimetypes.add_type(_type, _ext)

app = FastAPI(title="MILo Studio")


@app.middleware("http")
async def _no_cache_static(request: Request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/static/") and "/vendor/" not in request.url.path:
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def ok(data=None, **kw):
    return JSONResponse({"ok": True, "data": data, **kw})


@app.exception_handler(ValueError)
async def _value_error(_req: Request, exc: ValueError):
    return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)


def need_project(pid):
    p = store.get_project(pid)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


def safe_join(base, rel):
    full = os.path.abspath(os.path.join(base, rel))
    if not full.startswith(os.path.abspath(base) + os.sep) and full != os.path.abspath(base):
        raise HTTPException(403, "非法路径")
    return full


# ---------------------------------------------------------------- system
_gpu_cache = {"t": 0, "data": None}


def gpu_status():
    if time.time() - _gpu_cache["t"] < 2 and _gpu_cache["data"]:
        return _gpu_cache["data"]
    data = None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu",
             "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5,
            creationflags=0x08000000).stdout.strip().splitlines()[0]
        name, used, total, util, temp = [x.strip() for x in out.split(",")]
        data = {"name": name, "mem_used": int(used), "mem_total": int(total), "util": int(util), "temp": int(temp)}
    except Exception:
        pass
    _gpu_cache.update(t=time.time(), data=data)
    return data


@app.get("/api/system")
def system():
    du = shutil.disk_usage(ROOT_DIR)
    return ok({
        "gpu": gpu_status(),
        "colmap": os.path.isfile(COLMAP_EXE),
        "depth_anything": os.path.isfile(DEPTH_ANYTHING_CKPT),
        "disk_free_gb": round(du.free / 1e9, 1),
        "workspace": WORKSPACE_DIR,
        "busy": MANAGER.current.to_dict() if MANAGER.current else None,
        "queued": sum(1 for j in MANAGER.jobs.values() if j.status == "queued"),
    })


@app.get("/api/options")
def options():
    cfgs = sorted(f[:-5] for f in os.listdir(os.path.join(MILO_DIR, "configs", "mesh")) if f.endswith(".yaml"))
    return ok({
        "train_defaults": pipelines.TRAIN_DEFAULTS,
        "export_defaults": pipelines.EXPORT_DEFAULTS,
        "mesh_configs": cfgs,
        "methods": {k: v["label"] for k, v in pipelines.METHODS.items()},
    })


# ---------------------------------------------------------------- projects
@app.get("/api/projects")
def projects():
    return ok(store.list_projects())


@app.post("/api/projects")
def create_project(body: dict = Body(...)):
    source = body.get("source", "video")
    name = (body.get("name") or "").strip() or time.strftime("场景 %m-%d %H:%M")
    if source == "colmap":
        path = os.path.abspath(body.get("dataset_path", "").strip().strip('"'))
        if not store.is_colmap_dataset(path):
            raise ValueError("该目录不是 COLMAP 数据集（需要 images/ 和 sparse/0/）")
        return ok(store.create_project(name, "colmap", path))
    if source not in ("video", "images"):
        raise ValueError("未知的数据来源")
    return ok(store.create_project(name, source))


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return ok(need_project(pid))


@app.patch("/api/projects/{pid}")
def rename_project(pid: str, body: dict = Body(...)):
    p = need_project(pid)
    p["name"] = body.get("name", p["name"])
    if "default_run" in body:
        p["default_run"] = body["default_run"]
    store.save_project(p)
    return ok(store.get_project(pid))


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    for j in MANAGER.jobs.values():
        if j.project == pid and j.status in ("queued", "running"):
            raise ValueError("该项目还有正在运行的任务，请先取消")
    store.delete_project(pid)
    return ok()


@app.post("/api/projects/{pid}/upload")
async def upload(pid: str, files: List[UploadFile] = File(...), replace: Optional[str] = None):
    p = need_project(pid)
    d = pipelines.raw_dir(pid)
    if replace == "1" or p["source"] == "video":
        shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    saved = []
    for i, f in enumerate(files):
        ext = os.path.splitext(f.filename or "")[1].lower() or ".bin"
        stem = "video" if p["source"] == "video" else f"img_{len(os.listdir(d)) + 1:05d}"
        dst = os.path.join(d, stem + ext)
        with open(dst, "wb") as out:
            while True:
                chunk = await f.read(8 << 20)
                if not chunk:
                    break
                out.write(chunk)
        saved.append({"name": f.filename, "size": os.path.getsize(dst)})
        if p["source"] == "video":
            break
    uploads = [{"name": n, "size": os.path.getsize(os.path.join(d, n))} for n in sorted(os.listdir(d))]
    video_info = None
    if p["source"] == "video":
        import cv2
        cap = cv2.VideoCapture(os.path.join(d, os.listdir(d)[0]))
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS) or 30
            n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            video_info = {"fps": round(fps, 2), "frames": n, "seconds": round(n / fps, 1),
                          "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                          "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                          "original_name": saved[0]["name"] if saved else ""}
        cap.release()
        if not video_info:
            raise ValueError("无法读取该视频文件")
    store.update_dataset(pid, status="uploaded", uploads=uploads, video=video_info, error="")
    return ok(store.get_project(pid))


@app.delete("/api/projects/{pid}/uploads")
def clear_uploads(pid: str):
    need_project(pid)
    shutil.rmtree(pipelines.raw_dir(pid), ignore_errors=True)
    store.update_dataset(pid, status="empty", uploads=[], video=None, error="")
    return ok(store.get_project(pid))


@app.get("/api/projects/{pid}/cover")
def cover(pid: str):
    p = need_project(pid)
    ds = p["dataset"]["path"]
    for sub in ("thumbs", "images", "input"):
        d = os.path.join(ds, sub)
        if os.path.isdir(d):
            names = sorted(os.listdir(d))
            if names:
                return FileResponse(os.path.join(d, names[len(names) // 3]))
    raise HTTPException(404)


@app.post("/api/projects/{pid}/prepare")
def prepare(pid: str, body: dict = Body(default={})):
    need_project(pid)
    if MANAGER.active_for("prepare", pid):
        raise ValueError("数据准备已在进行中")
    job = pipelines.start_prepare(pid, body)
    return ok(job.to_dict())


@app.get("/api/projects/{pid}/frames")
def frames(pid: str):
    p = need_project(pid)
    ds = p["dataset"]["path"]
    for sub in ("thumbs", "images", "input"):
        d = os.path.join(ds, sub)
        if os.path.isdir(d):
            names = sorted(os.listdir(d))
            return ok({"dir": sub, "names": names})
    return ok({"dir": None, "names": []})


@app.get("/api/projects/{pid}/coverage")
def coverage(pid: str):
    """Per-frame video time + whether COLMAP registered it (written by tools/sfm.py)."""
    p = need_project(pid)
    path = os.path.join(p["dataset"]["path"], "coverage.json")
    if not os.path.isfile(path):
        return ok(None)
    import json
    with open(path, "r", encoding="utf-8") as f:
        return ok(json.load(f))


@app.get("/api/projects/{pid}/frame/{sub}/{name}")
def frame(pid: str, sub: str, name: str):
    p = need_project(pid)
    if sub not in ("thumbs", "images", "input"):
        raise HTTPException(404)
    return FileResponse(safe_join(os.path.join(p["dataset"]["path"], sub), name))


# ---------------------------------------------------------------- runs
@app.post("/api/projects/{pid}/runs")
def create_run(pid: str, body: dict = Body(...)):
    need_project(pid)
    job, run = pipelines.start_train(pid, body.get("name"), body.get("params", {}))
    return ok({"job": job.to_dict(), "run": run})


@app.post("/api/projects/{pid}/runs/import")
def import_run(pid: str, body: dict = Body(...)):
    need_project(pid)
    return ok(pipelines.import_run(pid, body.get("path", "").strip().strip('"'), body.get("name"),
                                   body.get("params")))


@app.get("/api/projects/{pid}/runs/{rid}")
def get_run(pid: str, rid: str):
    r = store.get_run(pid, rid)
    if not r:
        raise HTTPException(404, "训练结果不存在")
    return ok(r)


@app.delete("/api/projects/{pid}/runs/{rid}")
def delete_run(pid: str, rid: str):
    if MANAGER.active_for("train", rid):
        raise ValueError("训练正在进行，请先取消")
    store.delete_run(pid, rid)
    return ok()


@app.get("/api/projects/{pid}/runs/{rid}/snapshots")
def snapshots(pid: str, rid: str):
    r = store.get_run(pid, rid)
    if not r:
        raise HTTPException(404)
    mp = r["model_path"]
    snaps = []
    if os.path.isdir(mp):
        for f in os.listdir(mp):
            if f.startswith("iter_") and f.endswith(".png"):
                try:
                    snaps.append({"iteration": int(f[5:-4]), "name": f})
                except ValueError:
                    pass
    snaps.sort(key=lambda s: s["iteration"])
    return ok(snaps)


@app.get("/api/projects/{pid}/runs/{rid}/scene")
def scene(pid: str, rid: str):
    r = store.get_run(pid, rid)
    if not r:
        raise HTTPException(404)
    mp = r["model_path"]
    it = store.latest_iteration(mp)
    if it is None:
        raise ValueError("该训练结果还没有保存的高斯模型")
    cams = load_cameras(mp) or []
    fr = scene_frame(cams)
    ply = os.path.join("point_cloud", f"iteration_{it}", "point_cloud.ply")
    data = {
        "iteration": it,
        "ply_url": f"/api/projects/{pid}/runs/{rid}/files/{ply.replace(os.sep, '/')}",
        "ply_size": os.path.getsize(os.path.join(mp, ply)),
        "cameras": [{"name": c.get("img_name"), "position": c["position"], "rotation": c["rotation"],
                     "fx": c.get("fx"), "fy": c.get("fy"), "width": c.get("width"), "height": c.get("height")}
                    for c in cams],
    }
    if fr:
        data.update(target=fr["target"].tolist(), up=fr["up"].tolist(), radius=fr["radius"])
    return ok(data)


@app.get("/api/projects/{pid}/runs/{rid}/files/{path:path}")
def run_file(pid: str, rid: str, path: str):
    r = store.get_run(pid, rid)
    if not r:
        raise HTTPException(404)
    full = safe_join(r["model_path"], path)
    if not os.path.isfile(full):
        raise HTTPException(404)
    return FileResponse(full)


# ---------------------------------------------------------------- exports
@app.post("/api/projects/{pid}/exports")
def create_export(pid: str, body: dict = Body(...)):
    need_project(pid)
    job, ex = pipelines.start_export(pid, body.get("run"), body.get("name"), body.get("params", {}))
    return ok({"job": job.to_dict(), "export": ex})


@app.delete("/api/projects/{pid}/exports/{eid}")
def delete_export(pid: str, eid: str):
    if MANAGER.active_for("export", eid):
        raise ValueError("导出正在进行，请先取消")
    store.delete_export(pid, eid)
    return ok()


@app.get("/api/projects/{pid}/exports/{eid}/files/{name}")
def export_file(pid: str, eid: str, name: str, download: int = 0):
    full = safe_join(os.path.join(store.exports_dir(pid), eid), name)
    if not os.path.isfile(full):
        raise HTTPException(404)
    if download:
        return FileResponse(full, filename=name)
    return FileResponse(full)


@app.post("/api/open-folder")
def open_folder(body: dict = Body(...)):
    """Reveal a project/run/export folder in Explorer (local app convenience)."""
    pid = body.get("project")
    target = project_dir(pid)
    if body.get("export"):
        target = os.path.join(store.exports_dir(pid), body["export"])
    elif body.get("run"):
        r = store.get_run(pid, body["run"])
        target = r["model_path"] if r else target
    if not os.path.isdir(target):
        raise ValueError("目录不存在")
    os.startfile(target)  # noqa: S606 - local desktop app
    return ok()


# ---------------------------------------------------------------- jobs
@app.get("/api/jobs")
def jobs():
    return ok(MANAGER.list())


@app.get("/api/jobs/{jid}")
def job(jid: str, since: int = 0):
    j = MANAGER.get(jid)
    if not j:
        raise HTTPException(404, "任务不存在（可能是服务重启前的任务）")
    return ok(j.to_dict(since=since))


@app.post("/api/jobs/{jid}/cancel")
def cancel(jid: str):
    if not MANAGER.cancel(jid):
        raise HTTPException(404)
    return ok()


_BUILD = str(int(time.time()))


@app.get("/")
def index():
    with open(os.path.join(STATIC_DIR, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    # version-stamp our own assets so a browser never reuses a stale cached copy
    html = html.replace("/static/app.js", f"/static/app.js?v={_BUILD}").replace(
        "/static/style.css", f"/static/style.css?v={_BUILD}")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------------- main
def free_port(start=7860):
    for port in range(start, start + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("找不到可用端口")


def main():
    bind_to_job_object()
    pipelines.recover_interrupted()
    port = free_port(int(os.environ.get("MILO_STUDIO_PORT", 7860)))
    url = f"http://127.0.0.1:{port}/"

    def open_browser():
        for _ in range(100):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.1)
        if os.environ.get("MILO_STUDIO_NO_BROWSER") != "1":
            webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()
    print("=" * 64)
    print("  MILo Studio 已启动")
    print(f"  浏览器访问: {url}")
    print("  关闭此窗口即可停止全部服务（包括正在运行的训练）")
    print("=" * 64, flush=True)
    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    finally:
        MANAGER.shutdown()


if __name__ == "__main__":
    main()
