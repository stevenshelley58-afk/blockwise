# Meta connection preview

The `/concept/meta-connect` surface is an explicitly synthetic interaction preview for the proposed Meta partner-access flow. It is not a customer connection screen and never calls a provider route, writes browser storage, or changes account data.

## Guard and scope

- The route renders only when `BLOCKWISE_META_CONNECT_PREVIEW=true`; otherwise it returns `notFound()`.
- The page reads the public, validated `META_BUSINESS_ID` through `getMetaPartnerBusinessId()`. It does not invent a Business ID when that setting is absent.
- The normal `/connect-meta`, OAuth, settings, operator queue and provider routes are untouched.
- Preview state is local to the page. The selector demonstrates Setup, Missing access, Waiting for approval and Connected. The check is bounded and labelled `SIMULATED`.

## Composition

The page follows the existing Blockwise customer tokens and shadcn controls. It uses a compact two-column desktop layout and a single-column mobile layout. The left side carries three short steps, the Business ID copy control, the minimum Page and ad-account permissions, optional Instagram guidance, conversion-only Pixel guidance, and an official Meta Help disclosure. The right side carries the check result, named fictional example assets, an explicit absent Instagram identity, retry states and a Continue action that renders an in-page next-step confirmation.

The preview deliberately does not draw a fake Meta interface or use screenshots. The external settings and Help links are ordinary links with a persistent preview disclaimer in the header and result copy.
