# Build vs Maintain Mode

Date: 2026-05-30

The reset runtime distinguishes between build mode and maintain mode so the
operator can rebuild quality deliberately instead of running broad ingestion.

## Build Mode

Build mode is used when rebuilding or expanding the verified corpus.

Allowed work:

1. Run census against priority postcodes or known agencies.
2. Resolve pages for verified entities.
3. Classify existing creatives that lack enrichment.
4. File coverage defects for missing entities.
5. Backfill evidence where provenance is incomplete.

Not allowed:

1. Broad postcode ad sweeps that directly create displayable ads.
2. Setting `is_real_estate = true` without evidence and a decision record.
3. Treating failed collection as zero ads.

## Maintain Mode

Maintain mode is the default runtime posture after reset.

Allowed work:

1. Refresh due verified advertiser pages.
2. Update active status and snapshots.
3. Classify new creatives.
4. Audit coverage samples.
5. Raise defects for stale or failed pages.

Not allowed:

1. Re-enabling the old worker loop as the default runtime.
2. Mounting worker source into Hermes.
3. Adding unpinned images to active compose.

## Runtime Switch

`HERMES_RESEARCH_MODE` documents the intended posture:

| Value | Meaning |
| --- | --- |
| `build` | Operator is rebuilding verified coverage and may run bounded backfills |
| `maintain` | Routine refresh only |

`BLOCKWISE_RESEARCH_RUNTIME_ENABLED` is a separate enablement flag. Keeping it
`false` allows deploying the reset runtime without starting new research work.
