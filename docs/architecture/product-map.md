# Product map

Blockwise has one customer product with restricted operational surfaces. The [architecture overview](overview.md) is canonical; this page is the short route and data map.

Customer surfaces are Home, AdStudio, assets/BrandPack, Leads, Results, Settings, and Meta connection. AdStudio is the primary workflow for nontechnical agents; Leads are the practical benefit of consistent useful ads. Operator surfaces are workspace support, approvals, workforce, model control, and monitoring. Public surfaces are home, pricing, legal pages, guides, and suburb reports.

AdStudio flow: Frank layered pack -> workspace-scoped editable ad -> customer brand/property inputs -> edit -> Feed and Story render -> frozen publish validation -> configured approval/provider path.

Workspace queries and storage paths carry `workspace_id` and obey RLS. Durable work is queued in the product database and processed by the separately gated VPS worker. Provider tokens stay behind the vault RPC boundary. Results may show supported stale metrics with a clear last-known timestamp, but must not invent current zeroes, ROI, winners, or failed status for unreviewed leads. Frank artifacts and Hermes research data remain separate.

See the [extension guide](extension-guide.md) for changes.
