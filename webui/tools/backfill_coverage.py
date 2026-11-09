"""Rebuild frames.json + coverage.json for a video project processed before coverage
tracking existed: each extracted image is matched back to its source video frame."""
import glob
import json
import os
import sys

import cv2
import numpy as np

from sfm import registered_names, write_coverage


def main(project_dir):
    ds = os.path.join(project_dir, "dataset")
    vids = glob.glob(os.path.join(project_dir, "raw", "*"))
    if not vids:
        print("no video in raw/")
        return
    cap = cv2.VideoCapture(vids[0])
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    small = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        small.append(cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32))
    small = np.stack(small)
    frames = []
    for path in sorted(glob.glob(os.path.join(ds, "input", "*.jpg"))):
        im = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_GRAYSCALE)
        s = cv2.resize(im, (64, 36), interpolation=cv2.INTER_AREA).astype(np.float32)
        fi = int(np.argmin(((small - s) ** 2).mean((1, 2))))
        frames.append({"name": os.path.basename(path), "frame": fi, "t": round(fi / fps, 3)})
    duration = len(small) / fps
    with open(os.path.join(ds, "frames.json"), "w", encoding="utf-8") as f:
        json.dump({"duration": duration, "start": 0, "end": duration, "frames": frames}, f)
    sparse = os.path.join(ds, "distorted", "sparse")
    models = [d for d in os.listdir(sparse) if os.path.isdir(os.path.join(sparse, d))] if os.path.isdir(sparse) else []
    final = os.path.join(ds, "sparse", "0")
    write_coverage(ds, sparse, models, final)
    print("registered in final model:", len(registered_names(final)), "/", len(frames))


if __name__ == "__main__":
    main(sys.argv[1])
