# Processing benchmark

`npm run benchmark:generate` creates deterministic local fixtures under the ignored
`.benchmark/fixtures` directory. `npm run benchmark -- --label before` runs the
same workload and writes allowlisted JSON Lines to `benchmarks/results/before.jsonl`.

Use the same generated fixtures for the comparison runs:

```text
npm run benchmark -- --label after-balanced --speed balanced
npm run benchmark -- --label after-fast --speed fast --hardware h264_qsv
```

The hardware argument is only used after that encoder has passed a real capability
probe on the host. The application performs this probe automatically and falls back
to the CPU when initialization or encoding fails. See `RESULTS.md` for the measured
comparison.

The log contains fixture IDs, stage names, elapsed time, sizes and quality metrics.
Original file names, user data and absolute paths are intentionally excluded.

The fixed workload contains a small JPEG, 24MP JPEG, transparent PNG, WebP,
10-second and 60-second 1080p videos, a 5-second 4K video, WAV audio and an AI
upscaling image. AI stages are explicitly marked unavailable when the configured
Python models are not installed, rather than silently substituting another algorithm.
