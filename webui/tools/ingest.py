"""Turn an uploaded video or a set of images into <dataset>/input/*.jpg (+ thumbnails).

Video: the clip is split into N equal windows and the sharpest frame (variance of
Laplacian) of each window is kept, which avoids motion-blurred frames.
"""
import argparse
import json
import os
import shutil

import cv2
import numpy as np

from progress import M, P, fail, log

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
VID_EXT = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm", ".wmv", ".flv", ".mpg", ".mpeg"}


def resize_max(img, max_side):
    if max_side <= 0:
        return img
    h, w = img.shape[:2]
    s = max(h, w)
    if s <= max_side:
        return img
    f = max_side / s
    return cv2.resize(img, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)


def sharpness(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (0, 0), fx=0.5, fy=0.5) if max(g.shape) > 1000 else g
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def write(img, out_dir, thumb_dir, idx):
    name = f"{idx:05d}.jpg"
    cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(os.path.join(out_dir, name))
    cv2.imencode(".jpg", resize_max(img, 320), [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tofile(
        os.path.join(thumb_dir, name)
    )


def from_video(path, out_dir, thumb_dir, n_frames, max_side, use_sharp, t0, t1):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        fail(f"无法打开视频：{os.path.basename(path)}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if total <= 0:
        fail("无法读取视频帧数")
    f0 = max(0, int(t0 * fps)) if t0 > 0 else 0
    f1 = min(total, int(t1 * fps)) if t1 > 0 else total
    if f1 - f0 < 2:
        fail("截取的时间范围太短")
    n_frames = max(2, min(n_frames, f1 - f0))
    M(video_frames=total, video_fps=round(fps, 2), video_seconds=round(total / fps, 1))
    log(f"[INFO] 视频共 {total} 帧, {fps:.2f} fps, 时长 {total / fps:.1f}s; 选取区间 {f0}-{f1}, 目标 {n_frames} 帧")
    bounds = np.linspace(f0, f1, n_frames + 1).astype(int)
    # candidate frames per window: up to 6 evenly spaced (or 1 if sharpness filtering is off)
    cand = {}
    for w in range(n_frames):
        a, b = bounds[w], max(bounds[w] + 1, bounds[w + 1])
        k = min(6, b - a) if use_sharp else 1
        idxs = np.linspace(a, b - 1, k).astype(int) if k > 1 else [a + (b - a) // 2]
        for i in idxs:
            cand[int(i)] = w
    best = {}  # window -> (score, img)
    cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
    fi = f0
    last_pct = -1
    while fi < f1:
        if fi in cand:
            ok, img = cap.read()
            if not ok:
                break
            w = cand[fi]
            img = resize_max(img, max_side)
            sc = sharpness(img) if use_sharp else 0.0
            if w not in best or sc > best[w][0]:
                best[w] = (sc, img, fi)
        else:
            if not cap.grab():
                break
        fi += 1
        pct = (fi - f0) / (f1 - f0) * 100
        if int(pct) != last_pct:
            last_pct = int(pct)
            P("frames", pct * 0.9, "running", f"扫描视频 {fi - f0}/{f1 - f0} 帧")
    cap.release()
    meta = []
    for i, w in enumerate(sorted(best)):
        write(best[w][1], out_dir, thumb_dir, i + 1)
        fi = best[w][2]
        meta.append({"name": f"{i + 1:05d}.jpg", "frame": fi, "t": round(fi / fps, 3)})
        P("frames", 90 + 10 * (i + 1) / len(best), "running", f"写出图片 {i + 1}/{len(best)}")
    duration = total / fps
    secs = {}
    for m in meta:
        secs[int(m["t"])] = secs.get(int(m["t"]), 0) + 1
    empty = [s for s in range(int(f0 / fps), int(np.ceil(f1 / fps))) if s not in secs]
    log(f"[INFO] 抽帧覆盖：{len(secs)} 个整秒有画面" + (f"，缺少第 {empty} 秒" if empty else "，区间内每一秒都有帧"))
    return meta, duration


def from_images(src_dir, out_dir, thumb_dir, max_side):
    files = sorted(
        f for f in os.listdir(src_dir) if os.path.splitext(f)[1].lower() in IMG_EXT
    )
    if not files:
        fail("没有找到图片文件")
    n = 0
    meta = []
    for i, f in enumerate(files):
        img = cv2.imdecode(np.fromfile(os.path.join(src_dir, f), dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            log(f"[WARN] 跳过无法读取的文件 {f}")
            continue
        n += 1
        write(resize_max(img, max_side), out_dir, thumb_dir, n)
        meta.append({"name": f"{n:05d}.jpg", "source": f, "t": None})
        P("frames", (i + 1) / len(files) * 100, "running", f"导入图片 {i + 1}/{len(files)}")
    return meta, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="video file or directory of images")
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--frames", type=int, default=150)
    ap.add_argument("--max_side", type=int, default=1600)
    ap.add_argument("--sharp", type=int, default=1)
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--end", type=float, default=0)
    a = ap.parse_args()

    out_dir = os.path.join(a.dataset, "input")
    thumb_dir = os.path.join(a.dataset, "thumbs")
    for d in (out_dir, thumb_dir):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
    P("frames", 0, "running", "准备中")
    if os.path.isdir(a.src):
        vids = [f for f in os.listdir(a.src) if os.path.splitext(f)[1].lower() in VID_EXT]
        if vids:
            meta, duration = from_video(os.path.join(a.src, vids[0]), out_dir, thumb_dir, a.frames, a.max_side,
                                        a.sharp, a.start, a.end)
        else:
            meta, duration = from_images(a.src, out_dir, thumb_dir, a.max_side)
    else:
        meta, duration = from_video(a.src, out_dir, thumb_dir, a.frames, a.max_side, a.sharp, a.start, a.end)
    n = len(meta)
    # frame -> video time mapping, used later for the per-second coverage report
    with open(os.path.join(a.dataset, "frames.json"), "w", encoding="utf-8") as f:
        json.dump({"duration": duration, "start": a.start or 0, "end": a.end or duration, "frames": meta},
                  f, ensure_ascii=False)
    if n < 3:
        fail(f"有效图片太少（{n} 张），至少需要 3 张")
    M(num_frames=n)
    P("frames", 100, "done", f"共 {n} 张图片")
    log(f"[INFO] 已生成 {n} 张待处理图片")


if __name__ == "__main__":
    main()
