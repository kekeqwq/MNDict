import { resolvePalette } from "../src/theme";

function equal(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`主题映射：预期 ${expected}，实际 ${actual}`);
}

for (const template of ["White", "Sepia"]) {
  equal(resolvePalette(template, "dark"), "latte");
}
for (const template of ["Gray", "Dark", "Black", " Green "]) {
  equal(resolvePalette(template, "light"), "macchiato");
}
equal(resolvePalette(null, "dark"), "macchiato");
equal(resolvePalette("unknown", "light"), "latte");
equal(resolvePalette(undefined), "latte");
console.log("主题映射测试通过");
