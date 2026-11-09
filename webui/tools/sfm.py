"""COLMAP 4.x structure-from-motion: <dataset>/input -> <dataset>/{images, sparse/0}.

Mirrors milo/convert.py but with COLMAP 4 option names, a choice of matcher and
mapper, and live progress for each phase.
"""
import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys

from progress import M, P, fail, log

FILE_RE = re.compile(r"Processed file \[(\d+)/(\d+)\]")
BLOCK_RE = re.compile(r"Processing block \[(\d+)/(\d+), (\d+)/(\d+)\]")
IMAGE_RE = re.compile(r"(?:Processing|Matching) image \[(\d+)/(\d+)\]")
REG_RE = re.compile(r"num_reg_frames=(\d+)")
BRACKET_RE = re.compile(r"\[(\d+)/(\d+)\]")


def run(cmd, stage, n_images, label):
    log("$ " + " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd))
    P(stage, 0, "running", label)
    p = subprocess.Popen(
        [str(c) for c in cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL
    )
    last = []
    for raw in iter(p.stdout.readline, b""):
        line = raw.decode("utf-8", errors="replace").rstrip()
        if not line:
            continue
        msg = line.split("] ", 1)[1] if "] " in line else line
        last = (last + [msg])[-15:]
        pct = None
        detail = None
        m = FILE_RE.search(line)
        if m:
            i, n = int(m.group(1)), int(m.group(2))
            pct, detail = i / n * 100, f"{label} {i}/{n}"
        m = m or BLOCK_RE.search(line)
        if m and pct is None:
            a, A, b, B = map(int, m.groups())
            pct, detail = ((a - 1) * B + b) / (A * B) * 100, f"{label} 块 {(a - 1) * B + b}/{A * B}"
        m2 = IMAGE_RE.search(line)
        if m2 and pct is None:
            i, n = int(m2.group(1)), int(m2.group(2))
            pct, detail = i / n * 100, f"{label} {i}/{n}"
        m3 = REG_RE.search(line)
        if m3 and pct is None:
            k = int(m3.group(1))
            pct, detail = min(99, k / max(n_images, 1) * 100), f"已注册 {k}/{n_images} 张图片"
        if pct is None and stage == "undistort":
            m4 = BRACKET_RE.search(line)
            if m4:
                i, n = int(m4.group(1)), int(m4.group(2))
                pct, detail = i / n * 100, f"{label} {i}/{n}"
        if pct is not None:
            P(stage, pct, None, detail)
            if stage == "mapping" or "Processed file" in line:
                continue  # very chatty: keep the job log short
        if line.startswith(("E", "F")) or "Error" in line or "error" in line:
            print(line, flush=True)
        elif any(k in line for k in ("===", "Elapsed", "initial image pair", "Bundle adjustment report", "Writing")):
            print(msg, flush=True)
    code = p.wait()
    if code != 0:
        log("\n".join(last))
        fail(f"COLMAP {label}失败（退出码 {code}）")
    P(stage, 100, "done", label + "完成")


def count_registered(sparse_model_dir):
    path = os.path.join(sparse_model_dir, "images.bin")
    if not os.path.isfile(path):
        return 0
    with open(path, "rb") as f:
        return struct.unpack("<Q", f.read(8))[0]


def registered_names(sparse_model_dir):
    """Image names stored in a COLMAP images.bin (same layout in COLMAP 3.x and 4.x)."""
    names = set()
    path = os.path.join(sparse_model_dir, "images.bin")
    if not os.path.isfile(path):
        return names
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        for _ in range(n):
            f.read(4 + 8 * 7 + 4)  # image_id, qvec, tvec, camera_id
            name = b""
            while True:
                c = f.read(1)
                if c in (b"\x00", b""):
                    break
                name += c
            names.add(name.decode("utf-8", errors="replace"))
            n2d = struct.unpack("<Q", f.read(8))[0]
            f.seek(24 * n2d, 1)
    return names


def quiet_run(cmd):
    p = subprocess.run([str(c) for c in cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
    return p.returncode


def try_merge(colmap, sparse, models, best):
    """Incremental mapping sometimes splits a video into several sub-models. Try to merge
    the others into the largest one (works when they share enough images/points)."""
    cur = os.path.join(sparse, best)
    cur_n = count_registered(cur)
    merged_any = False
    for m in sorted((x for x in models if x != best), key=lambda d: -count_registered(os.path.join(sparse, d))):
        out = os.path.join(sparse, f"merged_{m}")
        os.makedirs(out, exist_ok=True)
        if quiet_run([colmap, "model_merger", "--input_path1", cur, "--input_path2", os.path.join(sparse, m),
                      "--output_path", out]) == 0 and count_registered(out) > cur_n:
            quiet_run([colmap, "bundle_adjuster", "--input_path", out, "--output_path", out])
            log(f"[INFO] 已把子模型 {m} 合并进主模型：{cur_n} → {count_registered(out)} 张")
            cur, cur_n, merged_any = out, count_registered(out), True
        else:
            shutil.rmtree(out, ignore_errors=True)
    return cur, merged_any


def write_coverage(ds, sparse, models, chosen_dir):
    """Per-frame registration status + video time, for the UI timeline."""
    meta_path = os.path.join(ds, "frames.json")
    meta = {"duration": None, "frames": []}
    if os.path.isfile(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    if not meta.get("frames"):
        meta["frames"] = [{"name": n, "t": None} for n in sorted(os.listdir(os.path.join(ds, "input")))]
    reg = registered_names(chosen_dir)
    by_name = {fr["name"]: fr for fr in meta["frames"]}
    subs = []
    for m in sorted(models):
        names = registered_names(os.path.join(sparse, m))
        ts = [by_name[n]["t"] for n in names if n in by_name and by_name[n].get("t") is not None]
        subs.append({"name": m, "n": len(names), "t0": min(ts) if ts else None, "t1": max(ts) if ts else None})
    for fr in meta["frames"]:
        fr["registered"] = fr["name"] in reg
    meta["submodels"] = subs
    meta["num_registered"] = len(reg)
    with open(os.path.join(ds, "coverage.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    # human readable summary
    timed = [fr for fr in meta["frames"] if fr.get("t") is not None]
    if timed:
        lost = sorted({int(fr["t"]) for fr in timed} - {int(fr["t"]) for fr in timed if fr["registered"]})
        for s in subs:
            if s["t0"] is not None:
                log(f"[INFO] 子模型 {s['name']}：{s['n']} 张，覆盖 {s['t0']:.1f}–{s['t1']:.1f} 秒")
        if lost:
            log(f"[WARN] 以下秒数的画面没有进入最终模型：{compress(lost)}")
        else:
            log("[INFO] 视频的每一秒都有画面进入最终模型")
        M(lost_seconds=lost)


def compress(secs):
    out, i = [], 0
    while i < len(secs):
        j = i
        while j + 1 < len(secs) and secs[j + 1] == secs[j] + 1:
            j += 1
        out.append(f"{secs[i]}" if i == j else f"{secs[i]}–{secs[j]}")
        i = j + 1
    return "、".join(out) + " 秒"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--colmap", required=True)
    ap.add_argument("--matcher", default="auto", choices=["auto", "exhaustive", "sequential"])
    ap.add_argument("--mapper", default="mapper", choices=["mapper", "global_mapper"])
    ap.add_argument("--camera", default="OPENCV")
    ap.add_argument("--gpu", type=int, default=1)
    ap.add_argument("--max_image_size", type=int, default=3200)
    ap.add_argument("--max_features", type=int, default=8192)
    a = ap.parse_args()

    ds = a.dataset
    inp = os.path.join(ds, "input")
    if not os.path.isdir(inp) or not os.listdir(inp):
        fail("没有待处理的图片，请先完成抽帧/导入")
    n_images = len(os.listdir(inp))
    dist = os.path.join(ds, "distorted")
    for d in (dist, os.path.join(ds, "images"), os.path.join(ds, "sparse"), os.path.join(ds, "stereo")):
        shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.join(dist, "sparse"))
    db = os.path.join(dist, "database.db")

    run([a.colmap, "feature_extractor", "--database_path", db, "--image_path", inp,
         "--ImageReader.single_camera", "1", "--ImageReader.camera_model", a.camera,
         "--FeatureExtraction.use_gpu", str(a.gpu), "--FeatureExtraction.max_image_size", str(a.max_image_size),
         "--SiftExtraction.max_num_features", str(a.max_features)],
        "features", n_images, "特征提取")

    matcher = a.matcher
    if matcher == "auto":
        # exhaustive matching connects every frame with every other frame; with GPU SIFT it is
        # affordable up to a few hundred images and avoids broken chains in videos
        matcher = "exhaustive" if n_images <= 300 else "sequential"
        log(f"[INFO] 自动选择匹配方式：{'穷举匹配' if matcher == 'exhaustive' else '顺序匹配（重叠 30 帧）'}（{n_images} 张图片）")
    if matcher == "sequential":
        cmd = [a.colmap, "sequential_matcher", "--database_path", db, "--FeatureMatching.use_gpu", str(a.gpu),
               "--SequentialMatching.overlap", "30", "--SequentialMatching.quadratic_overlap", "1"]
    else:
        cmd = [a.colmap, "exhaustive_matcher", "--database_path", db, "--FeatureMatching.use_gpu", str(a.gpu)]
    run(cmd, "matching", n_images, "特征匹配")

    sparse = os.path.join(dist, "sparse")
    if a.mapper == "global_mapper":
        cmd = [a.colmap, "global_mapper", "--database_path", db, "--image_path", inp, "--output_path", sparse]
    else:
        # slightly relaxed registration thresholds: fewer frames get dropped and videos split
        # into fewer disconnected sub-models (defaults: 30 inliers / 0.25 ratio / 100 init inliers)
        cmd = [a.colmap, "mapper", "--database_path", db, "--image_path", inp, "--output_path", sparse,
               "--Mapper.ba_global_function_tolerance=0.000001",
               "--Mapper.abs_pose_min_num_inliers", "15", "--Mapper.abs_pose_min_inlier_ratio", "0.15",
               "--Mapper.init_min_num_inliers", "60", "--Mapper.max_reg_trials", "5"]
    run(cmd, "mapping", n_images, "稀疏重建")

    models = [d for d in os.listdir(sparse) if os.path.isdir(os.path.join(sparse, d))]
    if not models:
        fail("COLMAP 没能重建出任何模型：图片之间重叠太少或画面太模糊。可以尝试增加帧数，或拍摄时绕物体缓慢移动")
    best = max(models, key=lambda d: count_registered(os.path.join(sparse, d)))
    chosen = os.path.join(sparse, best)
    if len(models) > 1:
        log(f"[WARN] 画面被分成了 {len(models)} 段互不相连的子模型，尝试合并…")
        P("mapping", 99, None, f"尝试合并 {len(models)} 个子模型")
        chosen, merged = try_merge(a.colmap, sparse, models, best)
        if not merged:
            log("[WARN] 子模型之间没有足够的共同特征，无法合并，只保留最大的一段")
    n_reg = count_registered(chosen)
    log(f"[INFO] 共 {len(models)} 个子模型，最终模型注册 {n_reg}/{n_images} 张图片")
    M(num_registered=n_reg, num_frames=n_images, num_submodels=len(models))
    write_coverage(ds, sparse, models, chosen)
    if n_reg < max(3, 0.3 * n_images):
        log(f"[WARN] 只有 {n_reg}/{n_images} 张图片成功注册，重建效果可能不佳")

    run([a.colmap, "image_undistorter", "--image_path", inp, "--input_path", chosen,
         "--output_path", ds, "--output_type", "COLMAP"],
        "undistort", n_images, "图像去畸变")

    # Gaussian splatting loaders expect <ds>/sparse/0
    sp = os.path.join(ds, "sparse")
    os.makedirs(os.path.join(sp, "0"), exist_ok=True)
    for f in os.listdir(sp):
        if f == "0":
            continue
        shutil.move(os.path.join(sp, f), os.path.join(sp, "0", f))
    shutil.rmtree(os.path.join(ds, "stereo"), ignore_errors=True)
    for f in ("run-colmap-geometric.sh", "run-colmap-photometric.sh"):
        try:
            os.remove(os.path.join(ds, f))
        except FileNotFoundError:
            pass
    log(f"[INFO] 数据集已就绪：{ds}")


if __name__ == "__main__":
    sys.exit(main())
