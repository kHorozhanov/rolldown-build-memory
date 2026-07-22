# rolldown build-memory reproduction

A minimal, self-contained reproduction of two related build-time memory behaviours
in [rolldown](https://github.com/rolldown/rolldown) that make it OOM on module
graphs that `esbuild` (and `webpack`/`turbopack`) bundle comfortably:

1. **Per-module retention** — rolldown's peak RSS grows ~linearly with the number of
   modules in the graph and is several times esbuild's, with the gap widening as the
   graph grows. esbuild stays roughly flat.
2. **Barrel penalty** — importing a handful of symbols through a large
   `export *` re-export barrel makes rolldown *load and retain* every member of the
   barrel (its full AST), even though tree-shaking correctly drops them from the
   output. esbuild only pays for what's used.

Everything here is synthetic and generated; there is no application code.

## Why this matters

These two behaviours compound on real apps. A production Next.js App Router build
(~90 routes, ~300 `use client` components, ~2,500 modules once app code, the shared
UI package, and dependencies are pulled in) peaks at **~9–10 GB** during the bundle
step and is killed by the OS before it finishes, on a 16 GB machine — while the same
app builds fine with webpack and with turbopack. That build reaches rolldown through
[`@vitejs/plugin-rsc`](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc)
/ Vite 8 / [vinext](https://github.com/cloudflare/vinext); the OOM lands in
plugin-rsc's first pass, `[1/5] analyze client references`, which is itself a full
rolldown build of the server graph. Deep-importing the worst barrels (a `date-fns`
locale barrel alone pulled ~540 modules; a hook library barrel imported ~100×) shaved
the peak by ~1–2 GB, but the floor stayed high because the app's *own* modules still
pay the per-module cost of behaviour (1). This repo isolates both behaviours away from
any framework so they can be measured directly.

## Setup

```bash
npm install
```

Pinned to `rolldown@1.1.5` (the version bundled by `vite@8.1.5`) and a recent
`esbuild` for comparison.

## Run

```bash
# full sweep (module-count scaling + barrel penalty), prints two tables
npm run matrix

# or drive it manually:
node scripts/generate.mjs <N> <barrel|flat|named> [used]  # write generated/index.js
node scripts/build.mjs <rolldown|esbuild>                # bundle it (run under a peak-RSS meter)

# topologies: `barrel` = `export *` star barrel; `named` = `export { x } from` named
# barrel (+ a `sideEffects:false` manifest, so `experimental.lazyBarrel` is eligible);
# `flat` = entry imports the used leaves directly.
```

`scripts/matrix.sh` runs `scripts/build.mjs` under the OS peak-RSS meter (`/usr/bin/time -v`
on Linux, `/usr/bin/time -l` on macOS). Peak RSS is read from the OS on purpose:
rolldown does its heavy allocation in a native Rust addon **inside the Node process**,
so OS RSS captures it while `process.memoryUsage()` (V8 heap only) does not — and
`--max-old-space-size` therefore has no effect.

## Measurements

Machine: Apple M-series, 16 GB, macOS. `rolldown@1.1.5`, `esbuild@0.24`, Node 22.
Peak RSS in MB (lower is better). Numbers are stable across runs to within a few MB.

### Table 1 — per-module build memory (`used = N`, every leaf reachable)

Identical reachable graph for both bundlers; only the bundler changes.

| N modules | esbuild | rolldown | rolldown / esbuild |
|----------:|--------:|---------:|-------------------:|
| 1,000     | 55 MB   | 137 MB   | 2.5× |
| 2,000     | 57 MB   | 190 MB   | 3.3× |
| 4,000     | 60 MB   | 297 MB   | 5.0× |
| 8,000     | 65 MB   | 493 MB   | 7.6× |

esbuild is ~flat; rolldown climbs ~55 MB per 1,000 trivial modules and the ratio
widens with N. Real modules (JSX/TSX, imports, types) carry much larger ASTs than
these synthetic ~0.5 KB leaves, so the same slope reaches multiple GB at real app
sizes.

### Table 1b — `lazy_barrel` fixes the *named* barrel, but not `export *`

rolldown ships an opt-in `experimental.lazyBarrel` that defers *loading* a barrel's
unused members — so the dead ASTs are never allocated (this is measured at the
`post-scan` phase boundary, where the peak occurs). It only applies to modules
declared side-effect-free (`"sideEffects": false`), and only to **named** re-exports:

| N=8000, used=50, side-effect-free barrel | post-scan peak RSS |
|---|---:|
| **named** barrel (`export { x } from './x'`), lazyBarrel **off** | 599 MB |
| **named** barrel, lazyBarrel **on** | **211 MB** — the 7,950 unused members are never loaded |
| **star** barrel (`export * from './x'`), lazyBarrel **on** | 599 MB — no effect |
| flat (`used=50` imported directly), reference | 135 MB |

Two gaps: it's off by default, and it **cannot defer `export *`** — a name can't be
attributed to a star target without loading it, so all targets are loaded to resolve
any named import. The `date-fns` main entry is exactly this `export *` shape (245
star re-exports); `react-use` is the named shape (113 named re-exports).

### Table 2 — barrel penalty (`used = 50`; the number of leaves that *exist* scales with N)

Only 50 symbols are ever imported. `flat` imports them directly; `barrel` imports the
same 50 from a barrel that `export *`s all N leaves.

| leaves exist (N) | flat, used=50 | barrel, used=50 | penalty |
|-----------------:|--------------:|----------------:|--------:|
| 1,000            | 78 MB         | 126 MB          | 1.6× |
| 2,000            | 79 MB         | 171 MB          | 2.2× |
| 4,000            | 81 MB         | 260 MB          | 3.2× |
| 8,000            | 79 MB         | 431 MB          | 5.5× |

`flat` stays flat (only the 50 needed leaves are loaded). `barrel` grows with the
*size of the barrel*, not with what's used — importing 50 symbols from an 8,000-member
barrel costs nearly as much as building all 8,000. The generated output is ~20 KB in
every `used=50` case (the unused members are correctly tree-shaken from the bundle);
the cost is purely in loading and retaining their ASTs during the build. esbuild's
`barrel used=50` stays at its ~53 MB baseline.

## What the repro shows vs. what it doesn't

- It **does** isolate rolldown's per-module retention and the barrel penalty, with a
  bundler baseline (esbuild) proving the same graph need not cost this much.
- It **does not** reproduce the exact 9 GB figure — these leaves are tiny. Scale N up
  and/or enlarge the leaf bodies in `scripts/generate.mjs` to push RSS into GB range;
  the slopes above predict where it lands.
- The framework path (`@vitejs/plugin-rsc` → rolldown) is described above but not
  bundled here, to keep the reproduction dependency-free and fast to run.

## Files

- `scripts/generate.mjs` — writes `generated/` (N leaves, a barrel, an entry).
- `scripts/build.mjs` — bundles `generated/index.js` with rolldown or esbuild.
- `scripts/matrix.sh` — sweeps N × topology × bundler under the OS peak-RSS meter.
- `reports/` — draft write-ups for the upstream issues.
