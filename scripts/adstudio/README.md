# Ad Studio operator paths

Template generation runs in Hermes. Blockwise accepts only the final layered
Feed/Story artifact through `POST /api/internal/adstudio/template-artifacts`.

The internal JSON body is:
`{ "template": <blockwise.ad-template>, "assets": [{ "assetKey", "fileName", "mimeType", "bytesBase64" }] }`

Blockwise does not fetch source URLs, create hashes, verify signatures, or retain
a private upload. Repeating a templateId is replayable only when the stored
template JSON, declared asset metadata, and asset bytes are identical; any
conflict is rejected. The artifact becomes available to the authenticated Ad
Studio gallery/editor.
