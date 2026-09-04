# Meta manual publishing handoff

## Purpose

Use this workflow while Blockwise's automated Meta connection remains gated by
App Review and the external partner proof. This is an operator service, not a
Meta API connection. It must never set a provider connection to `connected` or
claim that Blockwise published through the Marketing API.

## Customer workflow

1. Finish and save the ad in Ad Studio.
2. Open **Review & publish**.
3. Review the saved Feed and Story PNGs and the Meta copy.
4. Complete and confirm the destination, budget, audience, placements,
   schedule, variants, and any offer-fulfilment details.
5. Optionally download the Feed and Story PNGs.
6. Select **Request manual publishing**.
7. Return to the same screen to see `Requested`, `In progress`, `Completed`, or
   `Cancelled` status.

The customer must not send a password, access token, recovery code, or other
Meta credential to Blockwise.

## Operator workflow

1. Open **Operator → Customers** and select a customer with a Meta help need.
2. In **Manual Meta publishing requests**, verify the workspace, ad name,
   revision number, document hash, request note, and captured publish setup.
3. Open both private creative previews and compare them with the captured Meta
   copy and setup. Treat all customer-entered values as instructions to verify,
   not as proof of Meta account state.
4. Enter a reason and choose **Start manual handoff**.
5. In Meta Business Suite or Ads Manager, use the customer's authorised access
   path to create the requested campaign manually. Do not ask for or store the
   customer's credentials. Keep new campaign, ad set, and ad objects paused
   until the customer explicitly authorises activation.
6. Recheck the account, Page, Instagram identity (when selected), destination,
   budget, audience, placements, schedule, creative, copy, and lead form before
   activation.
7. Enter a completion reason and choose **Mark manually fulfilled** only after
   the manual work is visible in the intended Meta account.

`Completed` is an operator fulfillment record only. It does not mean Meta is
connected to Blockwise and does not authorise automated reporting, lead access,
or future API publishing.

## Failure and cancellation

- If the customer selected the wrong ad or instructions are incomplete, add a
  reason and cancel the request. Ask the customer to save a corrected revision
  and submit a new request.
- If Meta rejects the manual action, leave the request in progress while the
  operator resolves the exact account-side issue. Do not convert an error into
  `Completed`.
- If any active object was created unintentionally, pause it immediately,
  verify its effective status in Meta, record the incident, and escalate to the
  named operator owner.

## Rollback

1. Keep `BLOCKWISE_META_PARTNER_STARTS_ENABLED` absent or set to anything other
   than the exact value `true`.
2. Revert the customer entry point to a neutral App Review message if the manual
   service is unavailable.
3. Existing audit events remain immutable. Do not delete requests to hide an
   incomplete handoff; cancel them with a reason.
4. The OAuth routes and existing genuinely connected workspaces remain
   separate from this manual workflow.
