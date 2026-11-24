// VRAM in use on GPU 0, sampled by one long-running nvidia-smi.
// This is the whole card, not just this spike: subtract the baseline taken
// before the engines start, and mind anything else using the GPU.

import { spawn } from "node:child_process";

export class GpuMeter {
  current = 0;
  peak = 0;
  #proc = null;

  start(intervalMs = 250) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      try {
        this.#proc = spawn(
          "nvidia-smi",
          ["--query-gpu=memory.used", "--format=csv,noheader,nounits", "-i", "0", "-lms", String(intervalMs)],
          { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch {
        return done();
      }
      this.#proc.on("error", done);
      this.#proc.stdout.on("data", (b) => {
        for (const line of b.toString().split(/\r?\n/)) {
          const v = Number(line.trim());
          if (line.trim() && Number.isFinite(v)) {
            this.current = v;
            if (v > this.peak) this.peak = v;
            done();
          }
        }
      });
      setTimeout(done, 3000);
    });
  }

  /** Peak since the last call, then reset to the current reading. */
  takePeak() {
    const p = this.peak;
    this.peak = this.current;
    return p;
  }

  stop() {
    try {
      this.#proc?.kill();
    } catch {}
  }
}
