# Simple-first native Ad Studio (12 September 2026)

## Change

The native trial starts with its actual ad preview and visible Photos and Words
actions. Adjust design reveals the existing Vue editor; Done designing returns
without remounting it. The original ad and legacy editor remain unchanged.
This is a small integration layer over the existing native engine, not another
canvas editor, format conversion or publish implementation.

The alternatives and decision are in
[the native editor architecture](../architecture/adstudio-vue-editor.md#simple-first-interaction-decision-12-september).
DESIGN.md records the changed interaction contract.

## Observed checks

- Full repository suite: 1,270 passed, two existing infrastructure skips.
- Typecheck, NUL check and production build passed on the VPS.
- Focused native-host security, scene conversion and photo-helper tests: 13 passed.
- Impeccable distill/craft-floor used; first-party detector returned no findings.
- Browser checks ran at desktop 1440x960 and mobile 390x844 / 320x844.
- The simple default hides and makes the native tools inert.
- Real upstream element insertion survives an immediate return, simple wording
  edits, photo replacement, save and reopen; the iframe instance stays the same.
- AI proposals do not apply before explicit confirmation.
- Library-photo replacement updates both formats and preserves unrelated native
  objects. Unit tests cover crop geometry, masks, groups, and deleted slots.
- Save failure remains actionable, retry succeeds, and native JSON plus exact-size
  PNGs pass the backend validators in the component harness.
- Feed/Story ad previews and publish-review navigation passed in that harness.

## Scope of evidence

The browser harness explicitly mocks account/auth, copy proposals and persistence,
while running the actual React host, bundled Vue editor, image rendering and
backend document/PNG validators. The ad in its screenshots is a labelled
synthetic fixture, not an approved customer creative. Upload continues using the
existing media reservation/upload/finalization path; the browser photo check
exercises library adoption, not a live customer upload.

The signed-in customer browser could not be reached: CUA timed out again.
The existing test login was rejected during the earlier installation and was not
reset or bypassed. No authenticated live copy/save/publish acceptance is claimed.
No Meta action, paid AI request, budget change, or provider activation occurred.
Provider writes were verified disabled before release.

## Evidence locations

VPS scratch logs: /root/work/adstudio-simple-{tests,types,build}-final-20260912.log,
adstudio-simple-host-final-20260912.log, adstudio-simple-focused-20260912.log.
Browser receipts/screenshots: /root/work/adstudio-vue-simple-host-20260912/.
Screenshots were inspected together, then one bounded correction pass was run.

Deployment uses the standard main watcher and immutable product release path.
The source is based on 3c53dae898686b59dd32a7f9cbd8c297b6799ad8. Read live
/api/health and the autodeploy log to identify the actual serving revision; this
record alone is not deployment proof.
