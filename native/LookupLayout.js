// Keep the lookup card anchored on the left without starving narrow windows of reading width.
function mndictLookupFrame(width, height) {
  if (!(width > 0 && height > 0)) return null;
  var x = Math.round(Math.min(22, width * 0.02));
  var y = Math.round(Math.min(132, height * 0.16));
  var bottom = Math.round(Math.min(100, height * 0.15));
  var portrait = Math.max(0, Math.min(1, (height / width - 0.85) / 0.4));
  var preferred = width * (0.52 + portrait * 0.06);
  var readable = Math.min(380, width * 0.68);
  return {
    x: x, y: y,
    width: Math.round(Math.min(width - 2 * x, 650, Math.max(preferred, readable))),
    height: Math.round(height - y - bottom),
  };
}

function mndictLayoutLookup(panel, controller) {
  try {
    var view = panel.view;
    var bounds = controller.view && controller.view.bounds;
    if (!view || !bounds) return;
    var next = mndictLookupFrame(bounds.width, bounds.height);
    if (!next) return;
    var frame = view.frame;
    if (!frame || frame.x !== next.x || frame.y !== next.y || frame.width !== next.width || frame.height !== next.height) {
      view.frame = next;
    }
    if (panel.maxContentHeight !== next.height) panel.maxContentHeight = next.height;
  } catch (error) {
    mndictLog("show frame error=" + error);
  }
}
