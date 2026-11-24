var MNDICT_AUTO_KEY = "io.github.kekeqwq.mndict.lookupSelection";

function mndictAutoLookup() {
  return NSUserDefaults.standardUserDefaults().boolForKey(MNDICT_AUTO_KEY);
}

// mn.call 跨 JSB 后布尔可能被包装，统一归一化
function mndictBool(value) {
  if (value === true || value === 1 || value === "true" || value === "1") return true;
  if (value && typeof value === "object") {
    return mndictBool(value.value !== undefined ? value.value : value[0]);
  }
  return false;
}

function mndictPanelMessage(name, payload, openState) {
  if (name === "getOpenState") return openState;
  if (name === "setAutoLookup") {
    NSUserDefaults.standardUserDefaults().setBoolForKey(mndictBool(payload), MNDICT_AUTO_KEY);
  } else if (name !== "getSettings") {
    return { ok: false, got: typeof payload };
  }
  return { ok: true, autoLookup: mndictAutoLookup(), got: typeof payload };
}
