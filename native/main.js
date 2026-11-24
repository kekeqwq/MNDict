JSB.require("PanelBridge");
var SELECTION = "PopupMenuOnSelection";

// JSB 实例方法按 selector 映射，带参方法不在 self 上；业务逻辑放文件级函数，显式传上下文。
function mndictRefreshCommands(ctx) {
  var controller = Application.sharedInstance().studyController(ctx.window);
  if (controller) controller.refreshAddonCommands();
}

function mndictClose(ctx) {
  var panel = ctx.panel;
  ctx.panel = null;
  ctx.settingsVisible = false;
  if (panel) panel.hideFloating();
}

function mndictShow(ctx, mode, text) {
  var app = Application.sharedInstance();
  var controller = app.studyController(ctx.window);
  if (!controller) {
    app.showHUD("MNDict：拿不到 studyController", ctx.window, 3);
    return;
  }
  if (ctx.panel && ctx.settingsVisible !== (mode === "workspace")) mndictClose(ctx);
  ctx.openState = { mode: mode, text: text };
  if (!ctx.panel) {
    var panel = AddonWebPanel.panel();
    if (!panel) {
      app.showHUD("MNDict：面板创建失败（模板白名单？）", ctx.window, 4);
      return;
    }
    panel.panelWidth = mode === "workspace" ? 420 : 355;
    panel.maxContentHeight = mode === "workspace" ? 680 : 350;
    panel.onMessage = function (name, payload) {
      if (name === "__closed__") {
        if (ctx.panel === panel) {
          ctx.panel = null;
          ctx.settingsVisible = false;
          mndictRefreshCommands(ctx);
        }
        return { ok: true };
      }
      return mndictPanelMessage(name, payload, ctx.openState);
    };
    if (!panel.loadPanel()) {
      panel.teardown();
      app.showHUD("MNDict：index.html 加载失败", ctx.window, 4);
      return;
    }
    ctx.panel = panel;
  }
  ctx.settingsVisible = mode === "workspace";
  ctx.panel.showFloatingIn(controller);
  ctx.panel.post("mndict-open", ctx.openState);
}

JSB.newAddon = function () {
  return JSB.defineClass("MNDictAddon : JSExtension", {
    sceneWillConnect: function () {
      self.panel = null;
      self.settingsVisible = false;
      if (!self.observingSelection) {
        NSNotificationCenter.defaultCenter().addObserverSelectorName(self, "onTextSelection:", SELECTION);
        self.observingSelection = true;
      }
    },
    sceneDidDisconnect: function () {
      if (self.observingSelection) {
        NSNotificationCenter.defaultCenter().removeObserverName(self, SELECTION);
        self.observingSelection = false;
      }
      mndictClose(self);
    },
    notebookWillOpen: function () {
      if (!self.observingSelection) {
        NSNotificationCenter.defaultCenter().addObserverSelectorName(self, "onTextSelection:", SELECTION);
        self.observingSelection = true;
      }
    },
    notebookWillClose: function () {
      mndictClose(self);
    },
    controllerWillLayoutSubviews: function (controller) {
      if (self.panel && controller === Application.sharedInstance().studyController(self.window)) {
        self.panel.showFloatingIn(controller);
      }
    },
    onTextSelection: function (sender) {
      if (self.settingsVisible || !mndictAutoLookup()) return;
      if (!Application.sharedInstance().checkNotifySenderInWindow(sender, self.window)) return;
      var doc = sender.userInfo && sender.userInfo.documentController;
      var text = doc && doc.selectionText;
      if (typeof text !== "string") return;
      text = text.trim();
      if (!text || text.length > 120 || /[\r\n]/.test(text)) return;
      Application.sharedInstance().showHUD("MNDict 查词：" + text, self.window, 1);
      mndictShow(self, "mini", text);
    },
    queryAddonCommandStatus: function () {
      return {
        image: "icon.png", object: self, selector: "openSettings:",
        checked: Boolean(self.panel && self.panel.floatingVisible),
      };
    },
    openSettings: function () {
      try {
        if (self.panel && self.panel.floatingVisible && self.settingsVisible) mndictClose(self);
        else mndictShow(self, "workspace", "");
        mndictRefreshCommands(self);
      } catch (error) {
        Application.sharedInstance().showHUD("MNDict 异常：" + error, self.window, 4);
      }
    },
  });
};
