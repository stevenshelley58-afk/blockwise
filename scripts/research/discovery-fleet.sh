#!/usr/bin/env bash
# discovery-fleet.sh — keep N discovery workers busy until the requested queue is empty.
#
# Each worker is an independent `--shard=S --shards=N` run of one discovery pass.
# Every worker re-reads the durable decisions before it plans, so a crashed or
# restarted worker never repeats a finished row, and the fleet stops on its own when
# the queue is empty. A control-slug failure aborts that worker's chunk (exit 3); the
# supervisor backs off instead of hammering a throttled channel.
#
# The shared search channel throttles hard: bursts above ~10 concurrent queries
# returned empty or truncated bodies, so the fleet size stays deliberately low and
# the two passes share the budget.
#
# Usage: discovery-fleet.sh [workers] [chunk] [paceMs] [agents|agencies]
set -u
ROOT=/worktrees/ad-radar-firstfill-zero-and-media
WORKERS=${1:-5}
CHUNK=${2:-50}
PACE=${3:-6000}
MODE=${4:-agents}
case "$MODE" in
  agents) SCRIPT=scripts/research/discovery-first-pass.mjs ;;
  agencies) SCRIPT=scripts/research/discovery-agency-pass.mjs ;;
  *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac
SUP_LOG=/root/work/frank/.adr/discovery-fleet-supervisor.log
OUT=/root/work/frank/.adr/fleet-$MODE-worker

echo "$(date -u +%H:%M:%S) fleet start mode=$MODE workers=$WORKERS chunk=$CHUNK pace=$PACE" >> "$SUP_LOG"
for shard in $(seq 1 "$WORKERS"); do
  (
    consecutive_control_failures=0
    while true; do
      cd "$ROOT" || exit 1
      node "$SCRIPT" --apply --limit="$CHUNK" --pace="$PACE" --shard="$shard" --shards="$WORKERS" >> "$OUT-$shard.out" 2>&1
      rc=$?
      if [ "$rc" -eq 3 ]; then
        consecutive_control_failures=$((consecutive_control_failures + 1))
        echo "$(date -u +%H:%M:%S) $MODE shard $shard control failure #$consecutive_control_failures; backing off" >> "$SUP_LOG"
        sleep $((90 * consecutive_control_failures))
      else
        consecutive_control_failures=0
        sleep 2
      fi
      if tail -n 40 "$OUT-$shard.out" | grep -q '"planned": 0'; then
        echo "$(date -u +%H:%M:%S) $MODE shard $shard queue empty; worker stopping" >> "$SUP_LOG"
        exit 0
      fi
    done
  ) &
  echo "$(date -u +%H:%M:%S) started $MODE shard $shard pid $!" >> "$SUP_LOG"
done
wait
echo "$(date -u +%H:%M:%S) fleet complete mode=$MODE" >> "$SUP_LOG"
