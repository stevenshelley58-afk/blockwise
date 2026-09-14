#!/usr/bin/env bash
# discovery-fleet.sh — keep N discovery workers busy until every name group has a pass.
#
# Each worker is an independent `discovery-first-pass.mjs --shard=S --shards=N` run.
# Every worker re-reads the durable decisions before it plans, so a crashed or
# restarted worker never repeats a finished row, and the fleet stops on its own when
# the queue is empty. A control-slug failure aborts that worker's chunk (exit 3); the
# supervisor backs off instead of hammering a throttled channel.
#
# Usage: discovery-fleet.sh [workers] [chunk] [paceMs]
set -u
ROOT=/worktrees/ad-radar-firstfill-zero-and-media
LOG=/root/work/frank/.adr/discovery-fleet.log
WORKERS=${1:-5}
CHUNK=${2:-60}
PACE=${3:-5000}
SUP_LOG=/root/work/frank/.adr/discovery-fleet-supervisor.log
OUT=/root/work/frank/.adr/fleet-worker

echo "$(date -u +%H:%M:%S) fleet start workers=$WORKERS chunk=$CHUNK pace=$PACE" >> "$SUP_LOG"
for shard in $(seq 1 "$WORKERS"); do
  (
    consecutive_control_failures=0
    while true; do
      cd "$ROOT" || exit 1
      node scripts/research/discovery-first-pass.mjs --apply --limit="$CHUNK" --pace="$PACE" \
        --shard="$shard" --shards="$WORKERS" >> "$OUT-$shard.out" 2>&1
      rc=$?
      done_now=$(grep -c '"planned": 0' "$OUT-$shard.out" 2>/dev/null || echo 0)
      if [ "$rc" -eq 3 ]; then
        consecutive_control_failures=$((consecutive_control_failures + 1))
        echo "$(date -u +%H:%M:%S) shard $shard control failure #$consecutive_control_failures; backing off" >> "$SUP_LOG"
        sleep $((60 * consecutive_control_failures))
      else
        consecutive_control_failures=0
        sleep 2
      fi
      if [ "$done_now" -gt 0 ]; then
        echo "$(date -u +%H:%M:%S) shard $shard queue empty; worker stopping" >> "$SUP_LOG"
        exit 0
      fi
    done
  ) &
  echo "$(date -u +%H:%M:%S) started shard $shard pid $!" >> "$SUP_LOG"
done
wait
echo "$(date -u +%H:%M:%S) fleet complete" >> "$SUP_LOG"
