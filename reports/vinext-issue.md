# `vite build` OOMs at `[1/5] analyze client references` on a moderate App Router app (builds fine with webpack & turbopack)

**vinext:** 1.0.0-beta.3 · **@vinext/cloudflare:** 1.0.0-beta.3
**vite:** 8.1.5 (rolldown 1.1.5) · **@vitejs/plugin-rsc:** 0.5.28 · **Node:** 22
**OS:** macOS (Apple Silicon), 16 GB

### Summary

A production Next.js 15 App Router app builds cleanly with `next build` (webpack) and
with `next build --turbopack`, but its vinext build (`vite build`) is killed by the OS
during `[1/5] analyze client references`. Peak memory reaches ~9–10 GB and macOS
jetsam kills the process before the analyze pass finishes. It is not slow-then-done —
it never completes on 16 GB, at any baseline.

### App shape (what makes it hit this)

The app is not unusual, just not tiny:

| | this app | a small app that builds fine |
|--|--:|--:|
| routes (`page.tsx`) | 89 | 8 |
| components (`.tsx`) | 777 | 112 |
| `use client` boundaries | 303 | 34 |
| modules in the rsc graph | ~2,500 | ~800 |

Dependencies are ordinary and largely shared with the app that builds fine
(`swiper`, `date-fns`, telemetry SDK, an animation lib, a search client, a hook
library). The differentiator is **scale** — ~9× the client boundaries and modules.

### Where the memory goes

Instrumenting the plugin hooks and correlating phase timestamps against the OS swap
trace: the JS `transform` phase finishes fast (~2,500 modules in ~2 s, memory flat);
memory then climbs for minutes in a **native rolldown phase after transform with no JS
hook running**, entirely within `[1/5]`. Per plugin-rsc's source, `[1/5]` is a full
rolldown build of the server graph in which `scanBuildStripPlugin` replaces every
module body with bare side-effect `import` statements — so the blow-up is a function
of **graph shape**, not code volume.

### Root cause is upstream (rolldown), but vinext is where users hit it

rolldown retains an AST arena per module until chunk instantiation; peak build RSS
therefore scales ~linearly with module count, several times esbuild's, and a large
`export *` barrel makes it load+retain every member even for a few used symbols. A
dependency-free reproduction with measurements (rolldown vs esbuild; barrel vs flat):

https://github.com/kHorozhanov/rolldown-build-memory

### Things that did NOT fix it (all measured)

`TOKIO_WORKER_THREADS`/`RAYON_NUM_THREADS` caps · `rolldown@1.2.0` override ·
`MIMALLOC_PURGE_DELAY=0` · `build.minify:false` · `experimental.lazyBarrel` ·
`experimental.nativeMagicString` · `experimental.attachDebugInfo:'none'` ·
`treeshake.moduleSideEffects:'no-external'` · `treeshake:false` · deep-importing the
worst barrels (helped ~1–2 GB) · stubbing the telemetry SDK out (−~700 modules, still
OOM) · lowest achievable memory baseline. `--max-old-space-size` has no effect (native
allocation). Build-time dep pre-bundling isn't available (removed in Vite 5.1) and the
5 plugin-rsc steps share one in-process manager, so per-environment process isolation
isn't possible.

### What would help vinext users before rolldown lands arena work

1. **Apply barrel-import optimization in the vinext build** the way Next's
   `optimizePackageImports` does for the webpack/turbopack path — the single biggest
   lever a user can't easily reach themselves. (Manually deep-importing barrels helped
   here but only covers app-authored imports.)
2. **A documented memory ceiling / guidance** — "apps above ~N modules currently need
   a high-memory build environment," so this fails loudly with advice rather than a
   bare OS kill (cf. #797, #1220).
3. Track the upstream rolldown memory work; the app is buildable today only on a
   larger/less-loaded machine or CI.

### Repro

Any App Router app in the ~2,000+ module range with many `use client` boundaries and a
few large `export *` barrels reproduces it; the linked repo reproduces the underlying
rolldown behaviour dependency-free. Happy to share the full phase/swap trace and the
per-lever measurements.
