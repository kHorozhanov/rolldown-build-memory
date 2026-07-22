# Build-time peak memory scales with module count (and with barrel size for re-export barrels), OOMing moderate graphs that esbuild bundles flat

**rolldown version:** 1.1.5 (as bundled by vite@8.1.5); also reproduced on 1.2.0.
**OS:** macOS (Apple Silicon), 16 GB. Also relevant on CI-sized Linux.

### Summary

rolldown's peak build RSS grows ~linearly with the number of modules in the graph and
is several times esbuild's for the *same* graph, with the gap widening as the graph
grows. On top of that, importing a few symbols through a large `export *` re-export
barrel makes rolldown load and retain the AST of **every** member of the barrel, even
though those members are correctly tree-shaken from the output.

Together these make rolldown OOM on real-world graphs (a Next.js App Router app,
~2,500 modules, reaches ~9–10 GB and is jetsam-killed at 16 GB) that webpack,
turbopack and esbuild handle without trouble. This is likely the user-facing face of
the AST-arena retention discussed in #9516 and the footprint gap in #9330, but with a
tiny dependency-free repro and a bundler baseline.

### Minimal reproduction

https://github.com/kHorozhanov/rolldown-build-memory

```bash
npm install
npm run matrix
```

`generate.mjs` writes N trivial leaf modules, a barrel that `export *`s all of them,
and an entry that imports `used` symbols. `build.mjs` bundles `generated/index.js`
with rolldown or esbuild; `matrix.sh` runs it under the OS peak-RSS meter
(`/usr/bin/time -l`/`-v`). OS RSS is used deliberately — the allocation is in the
native addon, so `process.memoryUsage()` and `--max-old-space-size` don't see it.

### Results

**Per-module memory (`used = N`, every leaf reachable — identical graph for both):**

| N | esbuild | rolldown | ratio |
|--:|--:|--:|--:|
| 1,000 | 55 MB | 137 MB | 2.5× |
| 2,000 | 57 MB | 190 MB | 3.3× |
| 4,000 | 60 MB | 297 MB | 5.0× |
| 8,000 | 65 MB | 493 MB | 7.6× |

esbuild is flat; rolldown adds ~55 MB per 1,000 (tiny) modules and the ratio widens.

**Barrel penalty (`used = 50` symbols; N = how many leaves the barrel re-exports):**

| N (barrel size) | flat, used=50 | barrel, used=50 | penalty |
|--:|--:|--:|--:|
| 1,000 | 78 MB | 126 MB | 1.6× |
| 2,000 | 79 MB | 171 MB | 2.2× |
| 4,000 | 81 MB | 260 MB | 3.2× |
| 8,000 | 79 MB | 431 MB | 5.5× |

`flat` loads only the 50 leaves it needs and stays flat. `barrel` grows with the size
of the barrel, not with what's imported: 50 symbols from an 8,000-member barrel costs
almost as much as building all 8,000. Output is ~20 KB in every case — the unused
members are tree-shaken from the bundle, so the cost is purely loading + retaining
their ASTs during the build.

### Why it bites in practice

The graph shape that triggers this is exactly what large apps have: index-file
barrels and library barrels (`date-fns`, hook libraries, telemetry SDKs) re-exporting
hundreds of modules, imported for a few symbols each. Frameworks that don't rewrite
barrel imports the way Next's `optimizePackageImports` does for webpack/turbopack hand
rolldown the full graph. In the app that motivated this, deep-importing the two worst
barrels dropped peak RSS ~1–2 GB, but the app's own ~1,300 modules kept it near the
ceiling because of the per-module cost above.

### Ask

1. Is the per-module retention here the same all-modules-until-`instantiate_chunks`
   AST arena from #9516, and is any of the un-landed follow-up (arena right-sizing /
   per-module AST release / streaming) planned? The synthetic case suggests it's not
   just the fixture — it's O(modules) with a large constant.
2. The barrel penalty looks separable: could members of a side-effect-free `export *`
   barrel that end up fully tree-shaken be dropped (or not fully parsed/retained)
   before chunk instantiation? esbuild demonstrates the same output is reachable
   without loading them all.

Happy to profile specific runs or adjust the repro.
