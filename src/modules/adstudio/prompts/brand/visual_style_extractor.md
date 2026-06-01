---
name: brand.visual_style_extractor
version: 1
input_schema: BrandVisualInputs
output_schema: BrandVisualStyle
model_requirements:
  structured_json: true
  vision_input: true
temperature_policy: low
failure_policy: repair_once_then_fail
---

Analyze visual hierarchy, colours, typography, image treatment, layout density, and corner radius.
