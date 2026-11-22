// Portraits for the fake face server: plain coloured squares, written fresh
// for every run into a temp folder (never the real faces folder).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function seedFaces(python) {
  const home = join(tmpdir(), "mirli-live-e2e-face");
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, "faces"), { recursive: true });
  mkdirSync(join(home, "seed"), { recursive: true });
  const py = `import cv2, numpy as np, sys
home = sys.argv[1]
for name, bgr in [("seed/girl", (180, 160, 140)), ("faces/Ada-e2e00001", (60, 120, 200)), ("faces/Ben-e2e00002", (90, 170, 80)), ("faces/0fea11caf8194e3d86b337b9-56ea891b", (40, 40, 190))]:
    img = np.zeros((512, 512, 3), np.uint8); img[:] = bgr
    cv2.circle(img, (256, 220), 120, (230, 230, 230), -1)
    cv2.imwrite(f"{home}/{name}.png", img)`;
  execFileSync(python, ["-c", py, home]);
}
