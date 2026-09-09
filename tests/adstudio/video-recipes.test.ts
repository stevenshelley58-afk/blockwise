import assert from "node:assert/strict";
import test from "node:test";
import { listVideoRecipes, VIDEO_RECIPES } from "../../src/lib/adstudio/video/recipes.ts";

test("MVP exposes exactly eight lead-generation recipes", () => {
  const recipes = listVideoRecipes();
  assert.equal(recipes.length, 8);
  for (const recipe of recipes) {
    assert.equal(recipe.sceneBeats.length, 4);
    assert.ok(recipe.requiredAssets.length > 0);
    assert.ok(recipe.supportedProductionRoutes.length > 0);
    assert.ok(recipe.fallbackPolicy);
    assert.ok(recipe.cta);
    assert.ok(recipe.claimRequirements.length > 0);
  }
  assert.deepEqual(Object.keys(VIDEO_RECIPES).sort(), [
    "home_value", "pm_health_check", "qualified_buyer_demand", "rental_appraisal",
    "seller_education", "sold_nearby", "suburb_pulse", "testimonial_case_study",
  ]);
});
