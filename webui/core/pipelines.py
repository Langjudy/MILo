"""Builds Jobs for data preparation, training and export, with output handlers."""
import os
import re

import yaml

from . import store
from .jobs import MANAGER, Job, Stage, Step
from .paths import COLMAP_EXE, MILO_DIR, PYTHON, TOOLS_DIR, project_dir

PSNR_RE = re.compile(r"PSNR\s*:\s*([0-9.]+)")
SSIM_RE = re.compile(r"SSIM\s*:\s*([0-9.]+)")
LPIPS_RE = re.compile(r"LPIPS\s*:\s*([0-9.]+)")
ITER_EVAL_RE = re.compile(r"\[ITER (\d+)\] Evaluating (\w+)")
N_GAUSS_RE = re.compile(r"(?:Number of Gaussians|Downsampling Delaunay Gaussians from)\D*(\d+)")


def _tool(name):
    return os.path.join(TOOLS_DIR, name)


# ====================================================================== prepare
def raw_dir(pid):
    return os.path.join(project_dir(pid), "raw")


def start_prepare(pid, opts):
    p = store.get_project(pid)
    ds = p["dataset"]["path"]
    src = raw_dir(pid)
    if not os.path.isdir(src) or not os.listdir(src):
        raise ValueError("请先上传视频或图片")
    is_video = p["source"] == "video"
    stages = [
        Stage("frames", "视频抽帧" if is_video else "导入图片", 1),
        Stage("features", "特征提取", 2),
        Stage("matching", "特征匹配", 3),
        Stage("mapping", "稀疏重建（相机位姿）", 5),
        Stage("undistort", "图像去畸变", 1),
    ]
    ingest = [PYTHON, _tool("ingest.py"), "--src", src, "--dataset", ds,
              "--frames", int(opts.get("frames", 150)), "--max_side", int(opts.get("max_side", 1600)),
              "--sharp", 1 if opts.get("sharp", True) else 0,
              "--start", float(opts.get("start", 0) or 0), "--end", float(opts.get("end", 0) or 0)]
    matcher = opts.get("matcher") or "auto"
    sfm = [PYTHON, _tool("sfm.py"), "--dataset", ds, "--colmap", COLMAP_EXE,
           "--matcher", matcher, "--mapper", opts.get("mapper", "mapper"),
           "--camera", opts.get("camera", "OPENCV"), "--gpu", 1 if opts.get("gpu", True) else 0,
           "--max_image_size", int(opts.get("max_image_size", 3200)),
           "--max_features", int(opts.get("max_features", 8192))]

    def on_start(job):
        store.update_dataset(pid, status="processing", error="", prepare_opts=opts, job=job.id)

    def on_finish(job, ok):
        info = store.inspect_dataset(ds) if ok else {}
        store.update_dataset(
            pid,
            status="ready" if ok else ("uploaded" if job.status == "canceled" else "failed"),
            error="" if ok else job.error,
            **info,
        )

    job = Job("prepare", f"数据准备 · {p['name']}", pid, pid, stages,
              [Step(ingest, TOOLS_DIR, label="抽帧/导入"), Step(sfm, TOOLS_DIR, label="COLMAP 重建")],
              on_finish=on_finish, on_start=on_start)
    store.update_dataset(pid, status="processing", error="", prepare_opts=opts, job=job.id)
    return MANAGER.submit(job, os.path.join(project_dir(pid), "logs", "prepare.log"))


# ====================================================================== train
TRAIN_DEFAULTS = {
    "imp_metric": "outdoor",
    "rasterizer": "radegs",
    "mesh_config": "default",
    "dense_gaussians": False,
    "decoupled_appearance": False,
    "sampling_factor": 0.6,
    "data_device": "cuda",
    "resolution": -1,
    "white_background": False,
    "mesh_regularization": True,
    "depth_order": False,
    "depth_order_config": "default",
    "log_interval": 500,
    "sh_degree": 3,
}


def mesh_start_iter(cfg):
    try:
        with open(os.path.join(MILO_DIR, "configs", "mesh", f"{cfg}.yaml"), "r") as f:
            return int(yaml.safe_load(f).get("start_iter", 8001))
    except Exception:
        return 8001


def train_cmd(dataset, model_path, prm):
    cmd = [PYTHON, "train.py", "-s", dataset, "-m", model_path,
           "--imp_metric", prm["imp_metric"], "--rasterizer", prm["rasterizer"],
           "--mesh_config", prm["mesh_config"], "--sampling_factor", prm["sampling_factor"],
           "--data_device", prm["data_device"], "-r", prm["resolution"], "--sh_degree", prm["sh_degree"]]
    if prm["dense_gaussians"]:
        cmd.append("--dense_gaussians")
    if prm["decoupled_appearance"]:
        cmd.append("--decoupled_appearance")
    if prm["white_background"]:
        cmd.append("-w")
    if not prm["mesh_regularization"]:
        cmd.append("--no_mesh_regularization")
    if prm["depth_order"]:
        cmd += ["--depth_order", "--depth_order_config", prm["depth_order_config"]]
    if int(prm.get("log_interval") or 0) > 0:
        cmd += ["--log_interval", prm["log_interval"]]
    return cmd


def start_train(pid, name, params):
    p = store.get_project(pid)
    if p["dataset"]["status"] != "ready":
        raise ValueError("数据集还没有准备好")
    prm = dict(TRAIN_DEFAULTS)
    prm.update({k: v for k, v in (params or {}).items() if k in TRAIN_DEFAULTS})
    run = store.create_run(pid, name, prm)
    rid, model_path = run["id"], run["model_path"]
    os.makedirs(model_path, exist_ok=True)
    start_iter = mesh_start_iter(prm["mesh_config"]) if prm["mesh_regularization"] else None
    stages = [
        Stage("init", "加载数据与初始化", 0.5),
        Stage("gs", "高斯优化与致密化", 8),
        Stage("mesh", "网格正则化（Mesh-in-the-Loop）", 10),
        Stage("save", "评估与保存", 0.5),
    ]
    if not prm["mesh_regularization"]:
        stages[2]["label"] = "继续优化（已关闭网格正则化）"

    def handler(job, line, tq):
        if tq and tq["desc"].startswith("Training progress"):
            n, total = tq["n"], tq["total"]
            si = start_iter or int(total * 0.45)
            if n < si:
                job.set_stage("gs", pct=n / si * 100, state="running",
                              detail=f"迭代 {n:,}/{si:,}")
            else:
                job.set_stage("mesh", pct=(n - si) / max(total - si, 1) * 100, state="running",
                              detail=f"迭代 {n:,}/{total:,}")
            with job.lock:
                job.metrics.update(iteration=n, total=total, rate=tq["rate"], eta=tq["eta"],
                                   elapsed=tq["elapsed"], mesh_start=si)
                for k, v in tq["post"].items():
                    job.metrics[f"loss_{k}"] = v
            if "Loss" in tq["post"]:
                job.push_series("Loss", n, tq["post"]["Loss"])
            for k in ("DNLoss", "MDLoss", "MNLoss", "OccLoss", "OccLabLoss", "DOLoss"):
                if k in tq["post"]:
                    job.push_series(k, n, tq["post"][k])
            if n >= total:
                job.set_stage("save", state="running", detail="评估与保存")
            return
        if line.startswith("[INFO]") and job.stage("init")["state"] in ("pending", "running"):
            job.set_stage("init", state="running", detail=line[6:].strip()[:80])
        m = ITER_EVAL_RE.search(line)
        if m:
            job.metrics["eval_split"] = m.group(2)
        for rx, key in ((PSNR_RE, "psnr"), (SSIM_RE, "ssim"), (LPIPS_RE, "lpips")):
            m = rx.search(line)
            if m:
                job.metrics[key] = float(m.group(1))
        if "Saving Gaussians" in line:
            job.set_stage("save", state="running", detail="保存高斯模型")
        if "Training complete" in line:
            job.set_stage("save", pct=100, state="done", detail="训练完成")

    def on_start(job):
        store.update_run(pid, rid, status="running", job=job.id)

    def on_finish(job, ok):
        m = job.metrics
        store.update_run(
            pid, rid,
            status="done" if ok else job.status,
            error=job.error,
            iteration=store.latest_iteration(model_path),
            duration=round((job.finished or 0) - (job.started or job.finished or 0), 1),
            metrics={k: m.get(k) for k in ("psnr", "ssim", "lpips", "iteration", "total", "loss_Loss") if k in m},
            series=job.series,
        )

    job = Job("train", f"训练 · {p['name']} · {run['name']}", pid, rid, stages,
              [Step(train_cmd(p["dataset"]["path"], model_path, prm), MILO_DIR, handler, label="训练")],
              on_finish=on_finish, on_start=on_start)
    run = store.update_run(pid, rid, status="queued", job=job.id)
    return MANAGER.submit(job, os.path.join(store.runs_dir(pid), rid, "train.log")), run


def import_run(pid, path, name, params=None):
    path = os.path.abspath(path)
    if not store.is_model_dir(path):
        raise ValueError("该目录不是 MILo/3DGS 训练输出（需要 cfg_args 和 point_cloud/iteration_*/point_cloud.ply）")
    prm = dict(TRAIN_DEFAULTS)
    # cfg_args only stores dataset params; training options come from the user
    prm.update({k: v for k, v in (params or {}).items() if k in TRAIN_DEFAULTS})
    try:
        with open(os.path.join(path, "cfg_args"), "r", encoding="utf-8") as f:
            txt = f.read()
        m = re.search(r"data_device='([^']+)'", txt)
        if m:
            prm["data_device"] = m.group(1)
    except Exception:
        pass
    run = store.create_run(pid, name or os.path.basename(path), prm, model_path=path)
    return store.update_run(pid, run["id"], status="done", iteration=store.latest_iteration(path))


# ====================================================================== export
METHODS = {
    "sdf": {"label": "SDF 精细化（推荐，MILo 原生）", "script": "mesh_extract_sdf.py"},
    "integration": {"label": "高斯积分 SDF（较快）", "script": "mesh_extract_integration.py"},
    "tsdf": {"label": "规则 TSDF 融合（平滑、闭合）", "script": "mesh_extract_regular_tsdf.py"},
}


def extract_spec(run, ds_path, prm):
    """Returns (cmd, produced_mesh_path, cache_key)."""
    mp = run["model_path"]
    rp = run["params"]
    it = store.latest_iteration(mp)
    method = prm["method"]
    base = [PYTHON, METHODS[method]["script"], "-m", mp, "--iteration", it, "--rasterizer", rp.get("rasterizer", "radegs")]
    if ds_path:
        base += ["-s", ds_path]
    if method == "sdf":
        cmd = base + ["--config", rp.get("mesh_config", "default"), "--refine_iter", int(prm.get("refine_iter", 1000))]
        out = os.path.join(mp, "mesh_learnable_sdf.ply")
        key = f"sdf_it{it}_r{prm.get('refine_iter', 1000)}"
    elif method == "integration":
        mode = prm.get("sdf_mode", "integration")
        cmd = base + ["--sdf_mode", mode]
        out = os.path.join(mp, f"mesh_{mode}_sdf.ply")
        key = f"int_{mode}_it{it}"
    else:
        res = int(prm.get("tsdf_res", 1024))
        cmd = base + ["--mesh_res", res, "--num_cluster", int(prm.get("tsdf_clusters", 50))]
        out = os.path.join(mp, f"mesh_regular_tsdf_res{res}_post.ply")
        key = f"tsdf_it{it}_res{res}_c{prm.get('tsdf_clusters', 50)}"
    return cmd, out, key


EXPORT_DEFAULTS = {
    "method": "sdf",
    "refine_iter": 1000,
    "sdf_mode": "integration",
    "tsdf_res": 1024,
    "tsdf_clusters": 50,
    "crop": "auto",
    "crop_scale": 1.0,
    "axis": "zup",
    "min_component": 500,
    "smooth": 0,
    "target_faces": 0,
    "colors": True,
    "formats": ["ply", "glb"],
    "basename": "mesh",
    "reuse_cache": True,
}


def start_export(pid, rid, name, params):
    p = store.get_project(pid)
    run = store.get_run(pid, rid)
    if not run or run.get("status") != "done":
        raise ValueError("请选择一个已完成的训练结果")
    prm = dict(EXPORT_DEFAULTS)
    prm.update({k: v for k, v in (params or {}).items() if k in EXPORT_DEFAULTS})
    prm["basename"] = re.sub(r"[^A-Za-z0-9_.-]+", "_", prm.get("basename") or "mesh") or "mesh"
    ex = store.create_export(pid, rid, name, prm)
    eid = ex["id"]
    out_dir = os.path.join(store.exports_dir(pid), eid)
    ds_path = p["dataset"]["path"] if p["dataset"].get("status") == "ready" else ""
    cmd, produced, key = extract_spec(run, ds_path, prm)
    cache = os.path.join(store.runs_dir(pid), rid, "mesh_cache", f"{key}.ply")
    use_cache = prm["reuse_cache"] and os.path.isfile(cache)

    stages = [
        Stage("extract_pre", "预处理：加载模型与 Delaunay 四面体化", 1),
        Stage("extract", f"网格提取：{METHODS[prm['method']]['label']}", 8),
        Stage("post_load", "读取网格", 0.3),
        Stage("post_crop", "裁剪场景", 0.2),
        Stage("post_clean", "去除碎片", 0.5),
        Stage("post_smooth", "平滑", 0.5),
        Stage("post_decimate", "减面", 1),
        Stage("post_write", "写出文件", 0.7),
        Stage("post_preview", "生成网页预览", 0.8),
    ]
    method = prm["method"]

    def handler(job, line, tq):
        if tq:
            desc = tq["desc"]
            main = (method == "sdf" and desc.startswith("Training progress")) or (method != "sdf")
            if main:
                job.set_stage("extract", pct=tq["n"] / tq["total"] * 100, state="running",
                              detail=f"{desc or '进度'} {tq['n']}/{tq['total']}  剩余 {tq['eta']}")
            else:
                s = job.stage("extract")
                if s["state"] != "running":
                    job.set_stage("extract_pre", state="running", detail=f"{desc} {tq['n']}/{tq['total']}")
                else:
                    base = s["detail"].split(" · ")[0]
                    job.set_stage("extract", detail=f"{base} · {desc} {tq['n']}/{tq['total']}")
            return
        if job.stage("extract")["state"] == "pending":
            txt = line.replace("[INFO]", "").replace("[ INFO ]", "").strip()
            if txt and not txt.startswith("$"):
                job.set_stage("extract_pre", state="running", detail=txt[:90])
            if "Delaunay triangulation time" in line or "Triangulated" in line:
                job.set_stage("extract_pre", pct=100, state="done", detail=txt[:90])
                job.set_stage("extract", state="running", detail="开始提取")

    post = [PYTHON, _tool("postprocess.py"), "--mesh", cache if use_cache else produced,
            "--cache", "" if use_cache else cache, "--model", run["model_path"], "--out", out_dir,
            "--basename", prm["basename"], "--crop", prm["crop"], "--crop_scale", float(prm["crop_scale"]),
            "--axis", prm["axis"], "--min_component", int(prm["min_component"]), "--smooth", int(prm["smooth"]),
            "--target_faces", int(prm["target_faces"]), "--colors", 1 if prm["colors"] else 0,
            "--formats", ",".join(prm["formats"]) or "ply"]

    steps = []
    if not use_cache:
        steps.append(Step(cmd, MILO_DIR, handler, label="网格提取"))

    def on_start(job):
        store.update_export(pid, eid, status="running", job=job.id)
        if use_cache:
            job.set_stage("extract_pre", pct=100, state="done", detail="复用缓存")
            job.set_stage("extract", pct=100, state="done", detail=f"复用已提取的原始网格（{key}）")

    def on_finish(job, ok):
        m = job.metrics
        store.update_export(
            pid, eid, status="done" if ok else job.status, error=job.error,
            files=m.get("files", []),
            stats={k: m.get(k) for k in ("vertices", "faces", "raw_vertices", "raw_faces", "extent",
                                          "has_colors", "preview_faces", "post_seconds") if k in m},
            used_cache=use_cache,
            duration=round((job.finished or 0) - (job.started or job.finished or 0), 1),
        )

    steps.append(Step(post, TOOLS_DIR, label="后处理与导出"))
    job = Job("export", f"导出 · {p['name']} · {ex['name']}", pid, eid, stages, steps,
              on_finish=on_finish, on_start=on_start)
    ex = store.update_export(pid, eid, status="queued", job=job.id)
    return MANAGER.submit(job, os.path.join(out_dir, "export.log")), ex


# ====================================================================== startup
def recover_interrupted():
    """Mark anything that was running when the server stopped as interrupted."""
    for p in store.list_projects():
        if p["dataset"].get("status") == "processing":
            store.update_dataset(p["id"], status="failed", error="服务关闭，任务被中断")
        for r in p["runs"]:
            if r.get("status") in ("queued", "running"):
                store.update_run(p["id"], r["id"], status="failed", error="服务关闭，训练被中断")
        for e in p["exports"]:
            if e.get("status") in ("queued", "running"):
                store.update_export(p["id"], e["id"], status="failed", error="服务关闭，导出被中断")
