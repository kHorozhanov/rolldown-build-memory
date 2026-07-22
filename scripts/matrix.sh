#!/usr/bin/env bash
# Measure peak build RSS across module counts, topologies and bundlers.
#
#   bash scripts/matrix.sh                 # default sweep
#   NS="1000 3000 6000" bash scripts/matrix.sh
#
# Peak RSS is read from the OS (GNU `time -v` on Linux, BSD `time -l` on macOS),
# which — unlike process.memoryUsage() — includes rolldown's native Rust arenas.
set -u
cd "$(dirname "$0")/.."

NS="${NS:-1000 2000 4000 6000}"
TOPOS="${TOPOS:-flat barrel}"
BUNDLERS="${BUNDLERS:-esbuild rolldown}"

# Locate a `time` that reports peak RSS and detect its unit.
if /usr/bin/time -v true 2>/dev/null; then TIME=(/usr/bin/time -v); UNIT=kb          # GNU/Linux
elif /usr/bin/time -l true 2>/dev/null; then TIME=(/usr/bin/time -l); UNIT=bytes     # macOS/BSD
else echo "no peak-RSS-capable /usr/bin/time found"; exit 1; fi

peak_mb() { # parse the meter's stderr capture -> MB
  local f="$1" v
  v=$(grep -iE "maximum resident set size" "$f" | grep -oE "[0-9]+" | head -1)
  [ -z "$v" ] && { echo "?"; return; }
  if [ "$UNIT" = bytes ]; then echo $(( v / 1024 / 1024 )); else echo $(( v / 1024 )); fi
}

printf "%-9s %-8s %-10s %-12s %-10s\n" "bundler" "topo" "N" "peakRSS(MB)" "time(ms)"
printf -- "------------------------------------------------------------\n"
tmp="$(mktemp)"
for n in $NS; do
  for topo in $TOPOS; do
    node scripts/generate.mjs "$n" "$topo" >/dev/null
    for b in $BUNDLERS; do
      "${TIME[@]}" node scripts/build.mjs "$b" >"$tmp.out" 2>"$tmp.err"
      ms=$(grep -oE "bundled in [0-9]+ms" "$tmp.out" | grep -oE "[0-9]+" | head -1)
      printf "%-9s %-8s %-10s %-12s %-10s\n" "$b" "$topo" "$n" "$(peak_mb "$tmp.err")" "${ms:-?}"
    done
  done
done
rm -f "$tmp" "$tmp.out" "$tmp.err"
