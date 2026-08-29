/**
 * Gallery-level diversity checks shared by the AdStudio verifier and its
 * focused regression tests.
 *
 * Intent concentration is meaningful only once the gallery reaches the
 * existing five-template diversity scope. Layout collisions remain a hard
 * gate at every gallery size, including a one-template gallery.
 */
export function diversityFailures(docs) {
  const failures = [];
  if (docs.length === 0) return failures;

  const packIds = new Set(docs.map((doc) => doc.provenance?.packId).filter(Boolean));
  const singleSourcePack = packIds.size === 1 && docs.every((doc) => doc.provenance?.packId === [...packIds][0]);
  if (!singleSourcePack) {
    const intents = docs.map((doc) => doc.classification?.primary_intent).filter((intent) => intent && intent !== "other");
    const distinct = new Set(intents);
    if (distinct.size < 5 && docs.length >= 5) failures.push(`diversity: only ${distinct.size} distinct non-other intents (<5)`);
    if (docs.length >= 5) {
      const counts = new Map();
      for (const intent of intents) counts.set(intent, (counts.get(intent) ?? 0) + 1);
      for (const [intent, count] of counts) {
        if (count / Math.max(1, intents.length) > 0.5) failures.push(`diversity: intent "${intent}" is ${Math.round((count / intents.length) * 100)}% of the gallery (>50%)`);
      }
    }
  }

  const signatures = new Map();
  for (const doc of docs) {
    const signature = skeletonSignature(doc);
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
  }
  for (const [signature, count] of signatures) {
    if (count > 3) failures.push(`diversity: ${count} templates share an identical layout skeleton (>3)`);
  }
  return failures;
}

function skeletonSignature(doc) {
  const boxes = [];
  const q = (value) => Math.min(11, Math.max(0, Math.round(value * 12)));
  for (const layout of [doc.formats?.feed, doc.formats?.story]) {
    if (!layout) continue;
    for (const layer of layout.layers ?? []) {
      boxes.push([q(layer.box.x), q(layer.box.y), q(layer.box.x + layer.box.width), q(layer.box.y + layer.box.height)].join(","));
    }
  }
  for (const box of Object.values(doc.__textBoxes ?? {})) {
    boxes.push([q(box.x), q(box.y), q(box.x + box.width), q(box.y + box.height)].join(","));
  }
  return boxes.sort().join("|");
}
