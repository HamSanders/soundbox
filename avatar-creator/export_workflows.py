"""Write the API-format workflow files from graphs.py (the source of truth).

    python avatar-creator/export_workflows.py

The UI-format files (*.ui.json) were made by loading each API file in the ComfyUI frontend
(app.loadApiJson) and saving the graph; re-make them the same way after changing graphs.py.
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import graphs  # noqa: E402

OUT = Path(__file__).parent / "workflows"
EX = "avatar/master.png"  # placeholder input names; the driver/handler replaces them per call
files = {
    "avatar_portrait": graphs.portrait("Photo of a friendly woman in her forties, cafe counter, facing the camera, warm light, 4:5 portrait"),
    "avatar_pose_still": graphs.pose_still(EX, "she leans forward with both forearms on the counter"),
    "avatar_clip": graphs.clip(EX, "avatar/lean.png", "she leans forward onto the counter to listen", length=49),
}
OUT.mkdir(exist_ok=True)
for name, g in files.items():
    (OUT / f"{name}.api.json").write_text(json.dumps(g, indent=1), encoding="utf8")
    print(OUT / f"{name}.api.json")
