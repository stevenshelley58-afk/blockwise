# Lead-generation publish flow

## Product decisions

Blockwise generates leads for agents. Property details are optional creative context, not a mandatory step or the campaign unit. Ad management remains in Performance.

Saved creative enters Lead capture, Audience & budget, then Review. The recommended preset uses a new lead-generation campaign, a shared campaign budget, one audience and automatic eligible placements. Advanced controls can reuse compatible active campaigns/ad sets or separate the audience budget. Existing budgets and sibling ads are not changed.

The expandable "Why use this campaign setup?" guide explains the default separately from "Customise setup". The application does not claim that every setup qualifies as a full Advantage+ leads campaign.

The budget is an average daily budget, not a maximum lifetime spend. Review explicitly states that daily spend can vary and no total cap is set. Do not label daily budget multiplied by days as a guaranteed maximum.

## One approval

Approve & publish durably saves the authenticated approval, queues paused object creation, then uses the existing leased activation service after the complete graph is persisted. Queue retries reuse the plan and activation mutation. Ambiguous activation remains quarantined rather than being replayed.

The result popup offers Create another ad and View in Performance. Its Meta configuration summary comes from readback. Activation acceptance alone is not delivery evidence and must not be called Live.

Provider writes and worker activation remain separately gated. This change does not enable either gate.

## Meta references

Checked against Meta's maintained SDK object contracts:
- [Campaign](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/campaign.py)
- [Ad set](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adset.py)
- [Ad](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/ad.py)

## Verification boundary

Desktop and 390px mobile interaction checks used the actual PublishFlow component with isolated synthetic API responses, including the final popup. No Meta ad was created and no spend was authorised during testing. These checks are component evidence, not end-to-end provider acceptance.
