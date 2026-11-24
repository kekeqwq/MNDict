var MNDICT_AUTO_KEY = "io.github.kekeqwq.mndict.lookupSelection";

// mn.call 与 NSUserDefaults 的值跨 JSB 后可能被包装成对象，统一归一化
function mndictBool(value) {
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      return value === 1;
    case "string":
      return value === "on" || value === "true" || value === "1";
    case "object": {
      if (!value) return false;
      if ("value" in value) return mndictBool(value.value);
      if ("0" in value) return mndictBool(value[0]);
      if ("data" in value) return mndictBool(value.data);
      for (var key in value) return mndictBool(value[key]);
      return false;
    }
    default:
      return false;
  }
}

function mndictAutoLookup() {
  var prefs = NSUserDefaults.standardUserDefaults();
  return prefs.boolForKey(MNDICT_AUTO_KEY) || mndictBool(prefs.objectForKey(MNDICT_AUTO_KEY));
}

function mndictPanelMessage(name, payload, openState) {
  if (name === "getOpenState") return openState;
  if (name === "setAutoLookup") {
    var prefs = NSUserDefaults.standardUserDefaults();
    var value = mndictBool(payload);
    prefs.setBoolForKey(value, MNDICT_AUTO_KEY);
    prefs.setObjectForKey(value, MNDICT_AUTO_KEY);
  } else if (name !== "getSettings") {
    return { ok: false, got: typeof payload };
  }
  var keys = payload && typeof payload === "object" ? Object.keys(payload).join(",") : "";
  return { ok: true, autoLookup: mndictAutoLookup(), got: typeof payload, keys: keys };
}
