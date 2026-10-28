import { assertEquals } from "jsr:@std/assert";
import { pickStep2, step2Missing } from "./validate.ts";

Deno.test("step 2 ignores step 1 keys and invalid choices", () => {
  const out = pickStep2({ business_name: "Hacked", logo_choice: "Neon", color_palette: "Ember", training_locations: ["In my home", "Moon"] });
  assertEquals(out, { color_palette: "Ember", training_locations: ["In my home"] });
});

Deno.test("logo, colors and training location are required", () => {
  assertEquals(step2Missing({ training_locations: [] }), ["where you train", "logo", "website colors"]);
  assertEquals(step2Missing({ training_locations: ["In my home"], logo_choice: "Custom", color_palette: "Custom" }), []);
});
