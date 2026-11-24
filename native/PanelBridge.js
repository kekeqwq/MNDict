var MNDICT_AUTO_KEY = "io.github.kekeqwq.mndict.lookupSelection";

function mndictAutoLookup() {
  return NSUserDefaults.standardUserDefaults().boolForKey(MNDICT_AUTO_KEY);
}

function mndictPanelMessage(name, payload, openState) {
  if (name === "getOpenState") return openState;
  if (name === "setAutoLookup" && typeof payload === "boolean") {
    NSUserDefaults.standardUserDefaults().setBoolForKey(payload, MNDICT_AUTO_KEY);
  } else if (name !== "getSettings") {
    return { ok: false };
  }
  return { ok: true, autoLookup: mndictAutoLookup() };
}
