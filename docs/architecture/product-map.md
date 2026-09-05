# Product map

Blockwise has one customer product with restricted operational surfaces. The [architecture overview](overview.md) is canonical; this page is the short route and data map.

Customer surfaces are AdStudio, assets, brand, leads, results, settings, and Meta connection. Operator surfaces are workspace support, approvals, workforce, model control, and monitoring. Public surfaces are home, pricing, legal pages, guides, and suburb reports.

AdStudio flow: Frank layered pack -> workspace-scoped editable ad -> customer brand/property inputs -> edit -> Feed and Story render -> frozen publish validation -> configured approval/provider path.

Workspace queries and storage paths carry `workspace_id` and obey RLS. Durable work is queued in the product database and processed by the separately gated VPS worker. Provider tokens stay behind the vault RPC boundary. Frank artifacts and Hermes research data remain separate.

See the [extension guide](extension-guide.md) for changes.
