# Meta connection preview

This route is a synthetic, customer-facing concept preview for the proposed Meta
partner-access flow. It is available only when
`BLOCKWISE_META_CONNECT_PREVIEW=true`; it does not call Meta, write provider
state, or persist browser state.

## Composition

The main surface is four compact, responsive panels. This preview uses the existing data-blue token for a reference-aligned blue accent; see the scoped exception in `DESIGN.md`.

1. Open Meta Business Settings, with the ownership and revocation reassurance.
2. Copy the configured Blockwise Business Portfolio ID.
3. See the required Page and ad account plus optional Instagram asset, with
   Partial access called out.
4. Click **I've added Blockwise**, view a bounded synthetic result, and continue
   to the in-page next-step preview with named example assets.

The secondary **Preview options** disclosure exposes Setup, Missing access,
Waiting for approval, and Connected states. All simulated checking is local and
cancellable when the scenario changes or the component unmounts.

## Walkthrough

The closed **Need the full walkthrough?** disclosure reuses the existing
`META_PARTNER_STEPS` Meta settings screenshot fixtures and their titles, alt text,
dimensions, details, and tips. Each image links to its same-origin full-size
asset for mobile inspection. The screenshots locate controls in Meta; the copy
states the final required permissions explicitly: turn on Manage campaigns and
View performance, leave Full control off, then assign the assets.

No fake Meta screens or customer/provider records are used. Preview assets are
explicitly labelled as examples.
