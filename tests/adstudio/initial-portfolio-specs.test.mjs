import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INITIAL_PORTFOLIO_IDS,
  initialPortfolioSpecs,
  requiredInputKeysById,
} from "../../scripts/adstudio/v2/initial-portfolio-specs.mjs";

const SPEC_SOURCE = readFileSync(new URL("../../scripts/adstudio/v2/initial-portfolio-specs.mjs", import.meta.url), "utf8");

const expectedSemanticKeys = {
  "180": ["address", "price", "fact_beds", "fact_baths", "fact_area", "lot_area"],
  "149": ["address", "price", "stat_beds", "stat_baths", "stat_area"],
  "033": ["address", "price", "fact_beds", "fact_baths", "fact_area"],
  "044": ["event_date", "event_time", "checklist_1", "checklist_2", "checklist_3"],
  "021": ["address", "fact_beds", "fact_baths", "url"],
  "006": ["address", "price", "about_label", "features_label", "feature_1", "feature_2", "feature_3"],
  "039": ["address", "feature_1", "feature_2", "feature_3", "feature_4"],
  "062": ["old_price", "price", "amenity_1", "amenity_2", "amenity_3"],
  "154": ["service_1", "service_2", "service_3", "service_4", "website"],
  "108": ["address", "feature_1", "feature_2", "feature_3", "feature_4"],
  "111": ["address", "amenity_1", "amenity_2", "amenity_3", "amenity_4", "price"],
  "182": ["plan_1", "price_1", "plan_2", "price_2", "plan_3", "price_3"],
  "143": ["event_date", "event_time", "address", "badge"],
  "145": ["event_date", "event_time", "address", "agent_name", "badge"],
  "148": ["headline_line", "support_line", "room_label"],
  "159": ["address", "price", "fact_beds", "fact_rooms", "rent_cadence"],
  "176": ["address", "price", "feature_1", "feature_2"],
  "194": ["location", "price", "feature_1", "feature_2", "feature_3"],
  "127": ["sold_badge", "address", "proof_line", "agent_name"],
  "199": ["address", "price", "fact_beds", "fact_baths", "fact_area", "url"],
};

const expectedDirectorPalettes = {
  "180": ["#F7F6F2", "#17202A", "#8C9AA6", "#D8E4E8"], "149": ["#376F86", "#193344", "#F5F8FA", "#FFFFFF"],
  "033": ["#F4EFEA", "#B6A79D", "#4B332C"], "044": ["#1E2423", "#FAF8F2", "#B48663"],
  "021": ["#F7F2EF", "#806E63", "#B9A9A1"], "006": ["#FFFFFF", "#11181B", "#DCE1E4", "#657B88"],
  "039": ["#8EA3C2", "#FFFFFF", "#182839"], "062": ["#72A8D2", "#FBF8ED", "#3A2A15", "#536743"],
  "154": ["#F6F2ED", "#9E7B5A", "#2A2723"], "108": ["#151718", "#FFFFFF", "#B9AA91", "#4C5A42"],
  "111": ["#2F5EAA", "#A8C7E5", "#FFFFFF"], "182": ["#F5F7FA", "#1A9BDC", "#16344A"],
  "143": ["#F7F5F0", "#354C3A", "#AAB7A2", "#000000"], "145": ["#C84B2C", "#A83A27", "#FFF6EA"],
  "148": ["#3A241C", "#B78365", "#F8EFE6"], "159": ["#111111", "#D8C7A4", "#6E5744", "#FFFFFF"],
  "176": ["#B7633F", "#3E2530", "#FFF1D9", "#6B6B3D"], "194": ["#163C2D", "#7C9B6D", "#F3EBDD", "#000000"],
  "127": ["#13253D", "#506273", "#FFFFFF", "#687965"], "199": ["#101111", "#2D3428", "#F5F0E6", "#B39A63"],
};

const expectedMediaCounts = [4, 3, 5, 4, 3, 4, 4, 4, 3, 4, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1];

const boxesOverlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const overlapRatio = (a, b) => {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 ? (width * height) / smallerArea : 0;
};
const normalizedSafeRegion = (layout) => ({
  x: layout.safeZone.x / layout.width,
  y: layout.safeZone.y / layout.height,
  width: layout.safeZone.width / layout.width,
  height: layout.safeZone.height / layout.height,
});
const containsBox = (outer, inner) => (
  outer.x <= inner.x
  && outer.y <= inner.y
  && outer.x + outer.width >= inner.x + inner.width
  && outer.y + outer.height >= inner.y + inner.height
);
const largestEmptyRegionRatio = (layers, region, columns = 24, rows = 30) => {
  const occupied = Array.from({ length: rows }, () => Array(columns).fill(false));
  for (const layer of layers) {
    if (layer.inputKey === "background_patch") continue;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const cell = {
          x: region.x + (column / columns) * region.width,
          y: region.y + (row / rows) * region.height,
          width: region.width / columns,
          height: region.height / rows,
        };
        if (boxesOverlap(cell, layer.box)) occupied[row][column] = true;
      }
    }
  }
  let largest = 0;
  for (let top = 0; top < rows; top += 1) {
    const clearColumns = Array(columns).fill(true);
    for (let bottom = top; bottom < rows; bottom += 1) {
      for (let column = 0; column < columns; column += 1) clearColumns[column] &&= !occupied[bottom][column];
      let run = 0;
      for (const clear of clearColumns) {
        run = clear ? run + 1 : 0;
        largest = Math.max(largest, (run * (bottom - top + 1)) / (columns * rows));
      }
    }
  }
  return largest;
};

test("native geometry is authored as exactly 40 literal placement plans", () => {
  assert.doesNotMatch(SPEC_SOURCE, /materializeNativeBlueprint|feedBlueprint\s*\?\s*entry|forEach\(.*property_image/u);
  const feedSource = SPEC_SOURCE.match(/const FEED_LAYER_PLANS[\s\S]*?const STORY_LAYER_PLANS/u)?.[0] || "";
  const storySource = SPEC_SOURCE.match(/const STORY_LAYER_PLANS[\s\S]*?const finalizePlacement/u)?.[0] || "";
  const ids = "180|149|033|044|021|006|039|062|154|108|111|182|143|145|148|159|176|194|127|199";
  assert.equal((feedSource.match(new RegExp(`^\\s+"(?:${ids})":\\s*\\[`, "gmu")) || []).length, 20);
  assert.equal((storySource.match(new RegExp(`^\\s+"(?:${ids})":\\s*\\[`, "gmu")) || []).length, 20);
});

test("initial portfolio contains the exact 20 launch IDs and native geometry", () => {
  assert.deepEqual(Object.keys(initialPortfolioSpecs).sort(), [...INITIAL_PORTFOLIO_IDS].sort());
  assert.equal(INITIAL_PORTFOLIO_IDS.length, 20);
  assert.equal(new Set(INITIAL_PORTFOLIO_IDS).size, 20);
  INITIAL_PORTFOLIO_IDS.forEach((id, index) => {
    const spec = initialPortfolioSpecs[id];
    assert.deepEqual(spec.palette.directorTuple, expectedDirectorPalettes[id], `${id} palette drifted`);
    assert.equal(spec.mediaCount, expectedMediaCounts[index], `${id} media count drifted`);
    assert.deepEqual(spec.semanticInventory, expectedSemanticKeys[id], `${id} semantic inventory drifted`);
    assert.equal(spec.id, id);
    assert.equal(spec.formats.feed.width, 1080);
    assert.equal(spec.formats.feed.height, 1350);
    assert.equal(spec.formats.story.width, 1080);
    assert.equal(spec.formats.story.height, 1920);
  });
  assert.equal(new Set(INITIAL_PORTFOLIO_IDS.map((id) => initialPortfolioSpecs[id].formats.feed.geometryFingerprint)).size, 20);
  assert.equal(new Set(INITIAL_PORTFOLIO_IDS.map((id) => initialPortfolioSpecs[id].formats.story.geometryFingerprint)).size, 20);
  const allPlacementArrays = INITIAL_PORTFOLIO_IDS.flatMap((id) => ["feed", "story"].map((placement) => {
    const layers = initialPortfolioSpecs[id].formats[placement].layers;
    return JSON.stringify(layers.map((layer) => [layer.inputKey, layer.type, layer.box, layer.shape, layer.mask, layer.z]));
  }));
  assert.equal(new Set(allPlacementArrays).size, 40, "all 40 native placement arrays must be structurally distinct");
});

test("declared property media slots are exact and required", () => {
  INITIAL_PORTFOLIO_IDS.forEach((id, index) => {
    const spec = initialPortfolioSpecs[id];
    const propertyInputs = spec.inputs.images.filter((input) => input.kind === "image");
    assert.equal(propertyInputs.length, expectedMediaCounts[index], `${id} property input count drifted`);
    assert.ok(propertyInputs.every((input) => input.required), `${id} property media must be required`);
    for (const placement of [spec.formats.feed, spec.formats.story]) {
      const propertyLayers = placement.layers.filter((layer) => layer.type === "image_slot");
      assert.equal(propertyLayers.length, expectedMediaCounts[index], `${id} ${placement.placement} image layer count drifted`);
      assert.equal(new Set(propertyLayers.map((layer) => layer.inputKey)).size, expectedMediaCounts[index], `${id} ${placement.placement} image slots must be unique`);
    }
    const logo = spec.inputs.images.find((input) => input.key === "logo_slot");
    assert.ok(logo && !logo.required, `${id} logo must remain optional`);
    if (id === "145") {
      const portrait = spec.inputs.images.find((input) => input.key === "portrait_slot");
      assert.ok(portrait && !portrait.required, "145 portrait must remain optional");
    }
  });
});

test("every Story declares canonical supporting and shared CTA backings", () => {
  for (const id of INITIAL_PORTFOLIO_IDS) {
    const layers = initialPortfolioSpecs[id].formats.story.layers;
    const backings = layers.filter((layer) => layer.type === "overlay_patch");
    assert.equal(backings.length, 2, `${id} Story must declare two backing patches`);
    assert.deepEqual(backings.map((layer) => layer.id).sort(), ["story-backing-cta", "story-backing-supporting"]);
    for (const backing of backings) {
      assert.equal(backing.colourRole, "story-backing");
      assert.equal(backing.colour, "#f4f0e8");
      assert.equal(backing.editable, true);
      assert.ok(backing.z < layers.find((layer) => layer.inputKey === "supporting").z, `${id} supporting backing must be beneath copy`);
    }
    const ctaBacking = backings.find((layer) => layer.id === "story-backing-cta");
    const ctaCopy = layers.filter((layer) => layer.type === "text" && ["cta", "contact"].includes(layer.inputKey));
    for (const copy of ctaCopy) assert.ok(copy.box.x >= ctaBacking.box.x && copy.box.x + copy.box.width <= ctaBacking.box.x + ctaBacking.box.width && copy.box.y >= ctaBacking.box.y && copy.box.y + copy.box.height <= ctaBacking.box.y + ctaBacking.box.height, `${id} CTA backing must cover ${copy.inputKey}`);
  }
});

test("non-overlay Story copy/media intersections are fully backed", () => {
  const ids = ["149", "033", "044", "021", "006", "039", "062", "154", "108", "182", "143"];
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const covers = (backing, copy) => backing.box.x <= copy.box.x && backing.box.y <= copy.box.y && backing.box.x + backing.box.width >= copy.box.x + copy.box.width && backing.box.y + backing.box.height >= copy.box.y + copy.box.height;
  for (const id of ids) {
    const layers = initialPortfolioSpecs[id].formats.story.layers;
    const media = layers.filter((layer) => ["image_slot", "portrait_slot"].includes(layer.type));
    const backings = layers.filter((layer) => layer.type === "overlay_patch");
    for (const copy of layers.filter((layer) => layer.type === "text")) {
      for (const photo of media) {
        if (overlaps(copy.box, photo.box)) assert.ok(backings.some((backing) => covers(backing, copy)), `${id} ${copy.inputKey} overlaps ${photo.inputKey} without a full backing`);
      }
    }
  }
});

test("neutral gallery copy is source-free and distinct across all 20 archetypes", () => {
  const headlines = INITIAL_PORTFOLIO_IDS.map((id) => {
    const input = initialPortfolioSpecs[id].inputs.text.find((entry) => entry.key === "headline");
    assert.ok(input?.sample?.trim(), `${id} needs a gallery headline`);
    assert.ok(input.sample.length <= input.maxLength, `${id} gallery headline exceeds its input contract`);
    return input.sample;
  });
  assert.equal(new Set(headlines).size, 20, "every launch template needs distinct gallery copy");
  const serialized = JSON.stringify(Object.values(initialPortfolioSpecs).map((spec) => spec.inputs.text));
  assert.doesNotMatch(serialized, /Borcelle|Fauget|Liceria|Rimberio|Block Realty|\+?\d{2,3}[ -]?\d{3}[ -]?\d{3,4}/iu);
});

test("every placement declares the exact safe margins", () => {
  for (const spec of Object.values(initialPortfolioSpecs)) {
    assert.deepEqual(spec.formats.feed.safeMargins, { left: 72, right: 72, top: 96, bottom: 96 });
    assert.deepEqual(spec.formats.story.safeMargins, { left: 72, right: 72, top: 240, bottom: 300 });
    assert.deepEqual(spec.formats.feed.safeZone, { x: 72, y: 96, width: 936, height: 1158 });
    assert.deepEqual(spec.formats.story.safeZone, { x: 72, y: 240, width: 936, height: 1380 });
  }
  assert.equal(new Set(INITIAL_PORTFOLIO_IDS.map((id) => initialPortfolioSpecs[id].formats.feed.structuralFingerprint)).size, 20);
  assert.equal(new Set(INITIAL_PORTFOLIO_IDS.map((id) => initialPortfolioSpecs[id].formats.story.structuralFingerprint)).size, 20);
});

test("structural fingerprints exclude IDs and remain unique by authored layer intent", () => {
  const fingerprints = INITIAL_PORTFOLIO_IDS.map((id) => {
    const layers = initialPortfolioSpecs[id].formats.story.layers;
    return JSON.stringify(layers.map((layer) => [layer.type, layer.role, layer.shape, layer.mask, layer.colourRole]));
  });
  assert.equal(new Set(fingerprints).size, 20, "Story structures must differ without relying on layer IDs");
});

test("ID 006 keeps its authored listing hierarchy and four editable media slots", () => {
  const spec = initialPortfolioSpecs["006"];
  assert.equal(spec.mediaCount, 4);
  for (const placement of ["feed", "story"]) {
    const layout = spec.formats[placement];
    const media = layout.layers.filter((layer) => layer.type === "image_slot");
    assert.equal(media.length, 4, `${placement} must retain one hero and three thumbnails`);
    assert.equal(new Set(media.map((layer) => layer.inputKey)).size, 4);
    assert.ok(layout.geometryFingerprint.length > 0);
    assert.ok(layout.structuralFingerprint.length > 0);
  }

  const feed = spec.formats.feed.layers;
  const feedLayer = (inputKey) => feed.find((layer) => layer.inputKey === inputKey);
  assert.equal(feedLayer("headline").font, "serif-display");
  assert.ok(feedLayer("headline").box.y < feedLayer("customer_photo").box.y);
  assert.ok(feedLayer("customer_photo").box.x < feed.find((layer) => layer.role === "listing-price-brand-card").box.x);
  assert.equal(feedLayer("about_panel").role, "about-features-panel");
  assert.equal(feedLayer("contact_bar").role, "full-contact-bar");
  assert.equal(feedLayer("contact_bar").box.width, 0.84);

  const story = spec.formats.story.layers;
  const storyLayer = (inputKey) => story.find((layer) => layer.inputKey === inputKey);
  assert.equal(storyLayer("headline").font, "serif-display");
  assert.ok(storyLayer("headline").box.y < storyLayer("customer_photo").box.y);
  assert.ok(storyLayer("customer_photo").box.height >= 0.31);
  assert.equal(storyLayer("about_panel").role, "stacked-features-panel");
  assert.equal(storyLayer("contact_bar").role, "story-contact-bar");
  assert.ok(storyLayer("cta").box.y >= storyLayer("contact_bar").box.y);
});

test("story geometry is native and not a uniform feed transform", () => {
  const minimumStoryHeroHeights = {
    "180": 0.40, "149": 0.44, "033": 0.34, "044": 0.44, "021": 0.34,
    "006": 0.31, "039": 0.42, "062": 0.38, "154": 0.50, "108": 0.46,
    "111": 0.40, "182": 0.45, "143": 0.38, "145": 0.46, "148": 0.68,
    "159": 0.72, "176": 0.66, "194": 0.62, "127": 0.66, "199": 0.64,
  };
  for (const spec of Object.values(initialPortfolioSpecs)) {
    const feed = new Map(spec.formats.feed.layers.map((layer) => [layer.inputKey, layer.box]));
    const transforms = spec.formats.story.layers
      .filter((layer) => feed.has(layer.inputKey))
      .map((layer) => {
        const source = feed.get(layer.inputKey);
        return [layer.box.x - source.x, layer.box.y - source.y, layer.box.width - source.width, layer.box.height - source.height].map((value) => value.toFixed(4)).join(",");
      });
    assert.ok(new Set(transforms).size > 1, `${spec.id} story is a uniform feed transform`);
    const storyHero = spec.formats.story.layers.find((layer) => layer.inputKey === "customer_photo");
    assert.ok(storyHero.box.height >= minimumStoryHeroHeights[spec.id], `${spec.id} Story hero is too short for its art direction`);
    for (const layer of spec.formats.story.layers.filter((entry) => entry.type === "text")) {
      assert.ok(layer.pixelBox.y >= 250, `${spec.id} ${layer.id} breaches Story top render gate`);
      assert.ok(layer.pixelBox.y + layer.pixelBox.height <= 1580, `${spec.id} ${layer.id} breaches Story bottom render gate`);
    }
    for (const layer of spec.formats.feed.layers.filter((entry) => entry.type === "text")) {
      assert.ok(layer.pixelBox.x >= 72 && layer.pixelBox.x + layer.pixelBox.width <= 1008, `${spec.id} ${layer.id} breaches Feed horizontal safe zone`);
      assert.ok(layer.pixelBox.y >= 96 && layer.pixelBox.y + layer.pixelBox.height <= 1254, `${spec.id} ${layer.id} breaches Feed vertical safe zone`);
    }
  }
});

test("non-overlay Feed archetypes keep editable copy clear of media", () => {
  const nonOverlayIds = ["180", "149", "033", "044", "021", "006", "039", "062", "154", "108", "182", "143"];
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const id of nonOverlayIds) {
    const layers = initialPortfolioSpecs[id].formats.feed.layers;
    const media = layers.filter((layer) => layer.type === "image_slot" || layer.type === "portrait_slot");
    for (const copy of layers.filter((layer) => layer.type === "text")) {
      for (const photo of media) {
        assert.ok(!overlaps(copy.box, photo.box), `${id} ${copy.inputKey} overlaps ${photo.inputKey}`);
      }
    }
  }
});

test("Feed text boxes do not overlap one another", () => {
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const id of INITIAL_PORTFOLIO_IDS) {
    const textLayers = initialPortfolioSpecs[id].formats.feed.layers.filter((layer) => layer.type === "text");
    for (let left = 0; left < textLayers.length; left += 1) {
      for (let right = left + 1; right < textLayers.length; right += 1) {
        assert.ok(!overlaps(textLayers[left].box, textLayers[right].box), `${id} ${textLayers[left].inputKey} overlaps ${textLayers[right].inputKey}`);
      }
    }
  }
});

test("authored hierarchy keeps headlines and support copy readable", () => {
  for (const id of INITIAL_PORTFOLIO_IDS) {
    for (const placement of ["feed", "story"]) {
      const textLayers = initialPortfolioSpecs[id].formats[placement].layers.filter((layer) => layer.type === "text");
      const headline = textLayers.find((layer) => layer.inputKey === "headline");
      const supporting = textLayers.find((layer) => layer.inputKey === "supporting");
      const label = id + " " + placement;
      assert.ok(headline, label + " needs an authored headline");
      assert.ok(supporting, label + " needs authored support copy");
      assert.ok(headline.box.height >= 0.07 && headline.box.height <= 0.15, label + " headline should occupy a dominant 7-15% text box");
      assert.ok(headline.box.width >= 0.30, label + " headline box is too narrow for a clear hierarchy");
      assert.ok(headline.sizeRatio >= 0.30, label + " headline font ratio is too small");
      assert.ok(supporting.box.height >= 0.02 && supporting.box.width >= 0.20, label + " support copy is too small to read");
      assert.ok(supporting.sizeRatio >= 0.28, label + " support font ratio is too small");
    }
  }
});

test("safe-zone layouts cap unintentional empty rectangles", () => {
  for (const id of INITIAL_PORTFOLIO_IDS) {
    for (const placement of ["feed", "story"]) {
      const layout = initialPortfolioSpecs[id].formats[placement];
      const voidRatio = largestEmptyRegionRatio(layout.layers, normalizedSafeRegion(layout));
      assert.ok(voidRatio <= 0.18, id + " " + placement + " has an unintentional empty rectangle covering " + (voidRatio * 100).toFixed(1) + "% of the safe zone");
    }
  }
});

test("CTA geometry is deliberate, contained, and usable", () => {
  const buttonShapes = new Set(["pill", "rounded", "rect"]);
  for (const id of INITIAL_PORTFOLIO_IDS) {
    for (const placement of ["feed", "story"]) {
      const layout = initialPortfolioSpecs[id].formats[placement];
      const safeRegion = normalizedSafeRegion(layout);
      const label = id + " " + placement;
      const button = layout.layers.find((layer) => layer.inputKey === "accent_patch");
      const cta = layout.layers.find((layer) => layer.inputKey === "cta");
      const iconLayer = layout.layers.find((layer) => layer.inputKey === "icon_primary");
      assert.ok(button && button.role === "cta-button" && buttonShapes.has(button.shape), label + " needs a purposeful CTA button");
      assert.ok(button.box.width >= 0.18 && button.box.height >= 0.045, label + " CTA button is too small");
      assert.ok(button.box.width * button.box.height <= 0.08, label + " CTA button is oversized");
      assert.ok(containsBox(safeRegion, button.box), label + " CTA button breaches the safe zone");
      assert.ok(cta && containsBox(button.box, cta.box), label + " CTA copy must sit inside its button");
      assert.ok(iconLayer && containsBox(button.box, iconLayer.box), label + " CTA icon must sit inside its button");
    }
  }
});

test("Feed text overlap stays within the five-percent visual tolerance", () => {
  for (const id of INITIAL_PORTFOLIO_IDS) {
    const textLayers = initialPortfolioSpecs[id].formats.feed.layers.filter((layer) => layer.type === "text");
    for (let left = 0; left < textLayers.length; left += 1) {
      for (let right = left + 1; right < textLayers.length; right += 1) {
        const ratio = overlapRatio(textLayers[left].box, textLayers[right].box);
        assert.ok(ratio <= 0.05, id + " Feed " + textLayers[left].inputKey + " overlaps " + textLayers[right].inputKey + " by " + (ratio * 100).toFixed(1) + "%");
      }
    }
  }
});

test("decorative circles and rings stay intentional rather than becoming giant ellipses", () => {
  const roundShapes = new Set(["circle", "ellipse", "oval", "ring"]);
  for (const spec of Object.values(initialPortfolioSpecs)) {
    for (const placement of [spec.formats.feed, spec.formats.story]) {
      for (const layer of placement.layers.filter((entry) => entry.type === "vector_decor" && roundShapes.has(entry.shape))) {
        assert.ok(layer.box.width <= 0.25 && layer.box.height <= 0.25, spec.id + " " + placement.placement + " decorative " + layer.inputKey + " is too large");
        assert.ok(layer.box.width * layer.box.height <= 0.04, spec.id + " " + placement.placement + " decorative " + layer.inputKey + " is a giant ellipse/blob");
      }
    }
  }
});

test("Story text boxes stay within the canonical five-percent overlap limit", () => {
  const overlapRatio = (a, b) => {
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const smallerArea = Math.min(a.width * a.height, b.width * b.height);
    return smallerArea > 0 ? (width * height) / smallerArea : 0;
  };
  for (const id of INITIAL_PORTFOLIO_IDS) {
    const textLayers = initialPortfolioSpecs[id].formats.story.layers.filter((layer) => layer.type === "text");
    for (let left = 0; left < textLayers.length; left += 1) {
      for (let right = left + 1; right < textLayers.length; right += 1) {
        const ratio = overlapRatio(textLayers[left].box, textLayers[right].box);
        assert.ok(ratio <= 0.05, `${id} ${textLayers[left].inputKey} overlaps ${textLayers[right].inputKey} by ${(ratio * 100).toFixed(1)}%`);
      }
    }
  }
});

test("CTA patches and decorative vectors have safe stacking order", () => {
  for (const spec of Object.values(initialPortfolioSpecs)) {
    for (const placement of [spec.formats.feed, spec.formats.story]) {
      const byInput = new Map(placement.layers.map((layer) => [layer.inputKey, layer]));
      assert.ok(byInput.get("accent_patch").z < byInput.get("cta").z, `${spec.id} ${placement.placement} CTA patch covers copy`);
      assert.ok(byInput.get("surface_patch").z < byInput.get("headline").z, `${spec.id} ${placement.placement} surface covers headline`);
      assert.ok(byInput.get("icon_primary").z > byInput.get("cta").z, `${spec.id} ${placement.placement} CTA icon is hidden`);
      for (const layer of placement.layers.filter((entry) => entry.type === "vector_decor")) {
        assert.ok(layer.z < byInput.get("cta").z, `${spec.id} ${placement.placement} decor covers CTA copy`);
      }
    }
  }
});

test("distinctive archetypes retain their concrete structural layers", () => {
  const required = {
    "180": ["property_image_1", "property_image_2", "property_image_3"],
    "149": ["surface_patch", "price"],
    "033": ["circular_inset_patch"],
    "044": ["checklist_icon", "checklist_1", "checklist_2", "checklist_3"],
    "062": ["price_strike_line", "amenity_1", "amenity_2", "amenity_3"],
    "111": ["amenity_pill_1", "amenity_pill_2", "amenity_pill_3"],
    "182": ["price_row_1", "price_row_2", "price_row_3"],
    "143": ["notched_patch"],
    "145": ["portrait_slot"],
    "199": ["fact_bar"],
  };
  for (const [id, keys] of Object.entries(required)) {
    const layerKeys = new Set(initialPortfolioSpecs[id].formats.feed.layers.map((layer) => layer.inputKey));
    for (const key of keys) assert.ok(layerKeys.has(key), `${id} missing concrete ${key} layer`);
  }
  const feed = (id) => new Map(initialPortfolioSpecs[id].formats.feed.layers.map((layer) => [layer.inputKey, layer]));
  const circular = feed("033").get("property_image_4");
  assert.equal(circular.mask, "ellipse");
  assert.equal(circular.shape, "circle");
  assert.ok(circular.box.width !== circular.box.height, "033 circular inset must be independently placed");
  assert.equal(feed("021").get("flowing_line_decor").path, "wave");
  assert.equal(feed("021").get("flowing_line_decor").shape, "wave");
  assert.equal(feed("143").get("notched_patch").notch.corner, "top-right");
  assert.equal(feed("143").get("notched_patch").shape, "notched");
  for (const key of ["amenity_pill_1", "amenity_pill_2", "amenity_pill_3"]) assert.equal(feed("111").get(key).shape, "pill");
  for (const key of ["price_row_1", "price_row_2", "price_row_3"]) assert.equal(feed("182").get(key).shape, "rounded");
  assert.equal(feed("182").get("customer_photo").role, "tower-image");
  const checkBoxes = ["check_icon_1", "check_icon_2", "check_icon_3"].map((key) => JSON.stringify(feed("044").get(key).box));
  assert.equal(new Set(checkBoxes).size, 3, "044 checklist icons need independent geometry");
  assert.equal(feed("148").get("customer_photo").box.x, 0);
  assert.equal(feed("159").get("customer_photo").box.x, 0);
  assert.equal(feed("199").get("fact_bar").shape, "rect");
});

test("specs are source-free and have per-archetype semantic inventory", () => {
  const serialized = JSON.stringify(initialPortfolioSpecs);
  assert.doesNotMatch(serialized, /meta_ad_candidates|\.png|\.webp|Henrietta|Mitchell|123-456|sourceFile|sourceAd/u);
  for (const id of INITIAL_PORTFOLIO_IDS) {
    const spec = initialPortfolioSpecs[id];
    const inputKeys = spec.inputInventory.map((input) => input.key);
    assert.equal(new Set(inputKeys).size, inputKeys.length, `${id} has duplicate input IDs`);
    assert.deepEqual(requiredInputKeysById[id], spec.requiredInputKeys);
    for (const key of expectedSemanticKeys[id]) assert.ok(inputKeys.includes(key), `${id} missing semantic input ${key}`);
    assert.ok(inputKeys.includes("customer_photo"), `${id} missing primary image slot`);
    assert.ok(inputKeys.includes("logo_slot"), `${id} missing logo slot`);
    for (const placement of [spec.formats.feed, spec.formats.story]) {
      const layerIds = placement.layers.map((layer) => layer.id);
      assert.equal(new Set(layerIds).size, layerIds.length, `${id} has duplicate ${placement.placement} layer IDs`);
      const layerInputKeys = new Set(placement.layers.map((layer) => layer.inputKey));
      for (const key of inputKeys) assert.ok(layerInputKeys.has(key), `${id} ${placement.placement} does not render ${key}`);
    }
  }
});
