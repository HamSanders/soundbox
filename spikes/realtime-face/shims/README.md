Stand-ins for two upstream imports the single-GPU Lite path never calls:
`xfuser` (multi-GPU sequence parallelism) and `mediapipe` (optional face crop).
They exist only so `import` succeeds without installing either package.
