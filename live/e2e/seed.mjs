// Fixtures for the end-to-end run, written fresh into a temp folder each time:
// - a seed portrait for the fake face server,
// - a portrait to upload when creating a character,
// - a tiny avatar pack (talk + rest poses, four clips) to import for Santa.
// Never touches the real faces folder or Mirli data dir.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function seed(root, python) {
  rmSync(root, { recursive: true, force: true });
  for (const d of ["face/faces", "face/seed", "pack/stills", "pack/clips", "data"]) mkdirSync(join(root, d), { recursive: true });
  const py = `import cv2, numpy as np, sys
root = sys.argv[1]
def portrait(path, bgr, w=512, h=512):
    img = np.zeros((h, w, 3), np.uint8); img[:] = bgr
    cv2.circle(img, (w // 2, h // 3), min(w, h) // 4, (230, 230, 230), -1)
    cv2.imwrite(path, img)
portrait(f"{root}/face/seed/girl.png", (180, 160, 140))
portrait(f"{root}/rosa.png", (60, 120, 200))
portrait(f"{root}/pack/stills/talk.png", (40, 40, 190), 320, 400)
portrait(f"{root}/pack/stills/rest.png", (40, 120, 60), 320, 400)`;
  execFileSync(python, ["-c", py, root]);
  // 1 s clips from each still (the first and last frame are the pose, as the avatar creator guarantees).
  const clip = (id, still) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", join(root, "pack", "stills", `${still}.png`),
    "-t", "1", "-r", "16", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(root, "pack", "clips", `${id}.mp4`)]);
  clip("talk_idle_a", "talk"); clip("laugh", "talk"); clip("talk_to_rest", "rest"); clip("rest_to_talk", "talk");
  writeFileSync(join(root, "pack", "manifest.json"), JSON.stringify({
    version: 1, talkPose: "talk", restPose: "rest", startPose: "talk", width: 320, height: 400, fps: 16,
    poses: { talk: { label: "talk", still: "stills/talk.png", faceBox: { x: 60, y: 40, size: 200 } }, rest: { label: "rest", still: "stills/rest.png" } },
    clips: [
      { id: "talk_idle_a", from: "talk", to: "talk", kind: "idle", src: "clips/talk_idle_a.mp4" },
      { id: "laugh", from: "talk", to: "talk", kind: "reaction", tags: ["laugh"], src: "clips/laugh.mp4" },
      { id: "talk_to_rest", from: "talk", to: "rest", kind: "transition", src: "clips/talk_to_rest.mp4" },
      { id: "rest_to_talk", from: "rest", to: "talk", kind: "transition", src: "clips/rest_to_talk.mp4" },
    ],
  }, null, 1));
}
