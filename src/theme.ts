export function resolvePalette(template: unknown, bridgeTheme?: "light" | "dark"): "latte" | "macchiato" {
  switch (typeof template === "string" ? template.trim().toLowerCase() : "") {
    case "white":
    case "sepia":
      return "latte";
    case "gray":
    case "grey":
    case "dark":
    case "black":
    case "green":
      return "macchiato";
    default:
      return bridgeTheme === "dark" ? "macchiato" : "latte";
  }
}
