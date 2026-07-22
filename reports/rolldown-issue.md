# Build-time peak memory scales with total module count; `lazyBarrel` fixes named barrels but not `export *`, and is off by default

**rolldown:** 1.1.5 (as bundled by vite@8.1.5); also built from source at current `main` for the phase traces below.
**OS:** macOS (Apple Silicon), 16 GB.

### Summary

For a moderate module graph, rolldown's **peak build RSS is reached during the scan phase** — every module's AST (bumpalo arena) is allocated and held — and it is several times esbuild's for the same graph, widening as the graph grows. This is the user-facing side of the AST-arena retention in #9516 / the footprint gap in #9330, but with a tiny dependency-free repro, a bundler baseline, and phase-boundary traces.

A large-but-ordinary Next.js App Router build (~2,500 modules) reaches ~9–10 GB and is OS-killed on 16 GB, where webpack and turbopack build it fine. The two behaviours below explain it.

### Reproduction

https://github.com/<user>/rolldown-build-memory — `npm i && npm run matrix`.

Generates N trivial leaf modules reached three ways: `flat` (entry imports the used leaves directly), `named` (`export { x } from './x'` barrel, `sideEffects:false`), `barrel` (`export *` star barrel). Built under the OS peak-RSS meter; the source build additionally prints peak RSS at the scan/link/generate boundaries.

### 1. Per-module retention — rolldown vs esbuild (identical reachable graph)

| N | esbuild | rolldown | ratio |
|--:|--:|--:|--:|
| 1,000 | 55 MB | 137 MB | 2.5× |
| 4,000 | 60 MB | 297 MB | 5.0× |
| 8,000 | 65 MB | 493 MB | 7.6× |

esbuild is ~flat; rolldown adds ~55 MB per 1,000 trivial modules and the gap widens. Real JSX/TSX modules carry far larger ASTs, so the same slope reaches multiple GB at real app sizes. Phase trace (N=8000): `post-scan` is already the peak; link/generate add little. `--max-old-space-size` has no effect (native allocation).

### 2. `lazyBarrel` fixes the named barrel — but not `export *`, and it's off by default

`experimental.lazyBarrel` defers *loading* a barrel's unused members, so their ASTs are never allocated — the only thing that lowers the scan-phase peak:

| N=8000, used=50, `sideEffects:false` barrel | post-scan peak |
|---|--:|
| **named** barrel, lazyBarrel off | 599 MB |
| **named** barrel, lazyBarrel on | **211 MB** |
| **star** (`export *`) barrel, lazyBarrel on | 599 MB — no effect |
| flat reference | 135 MB |

Two gaps:
- **`export *` is not deferrable.** `BarrelInfo::take_needed_records` attributes any name not found in `named` to *all* star records, so every star target is loaded to resolve any named import (`crates/rolldown_common/src/types/lazy_barrel.rs` ~L220-230). The `date-fns` main entry is exactly this shape — 245 `export *` re-exports. `react-use` is the named shape (113 named re-exports) that `lazyBarrel` handles well.
- **Off by default**, and it requires an explicit `sideEffects:false` (a structurally-pure re-export barrel without the declaration isn't deferred — 602 MB in the repro).

### Questions for maintainers

1. Is per-module AST retention until the bulk drop the intended steady state, or is any of the #9516 follow-up (arena right-sizing / per-module release / streaming) planned? The repro shows it's O(modules) with a large constant, not just the fixture.
2. For a **`sideEffects:false` `export *` barrel** the members are asserted side-effect-free, so deferral is *safe* — the only blocker is star name-resolution (and `export *` ambiguity, which strictly needs all targets checked). Is a lazy star-resolution path (reusing the existing on-demand loader) something you'd accept? Happy to draft it with guidance on the ambiguity handling.
3. Would you consider defaulting `lazyBarrel` on for eligible barrels, or documenting it? It's a large, safe win that's currently undiscoverable.

Repro, phase traces, and the full per-lever measurements are in the linked repo; glad to profile specific runs.
