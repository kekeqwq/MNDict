JSB.require("PanelBridge");
JSB.require("NativeDb");
var SELECTION = "PopupMenuOnSelection";

// JSB 实例方法按 selector 映射，带参方法不在 self 上；业务逻辑放文件级函数，显式传上下文。
function mndictRefreshCommands(ctx) {
  var controller = Application.sharedInstance().studyController(ctx.window);
  if (controller) controller.refreshAddonCommands();
}

// 迷你浮层：轻点文档区即关闭（识别器不拦截原有手势）
function mndictWatchOutside(ctx) {
  mndictUnwatchOutside(ctx);
  var controller = Application.sharedInstance().studyController(ctx.window);
  var doc = controller && controller.readerController && controller.readerController.currentDocumentController;
  var view = doc && doc.view;
  mndictLog("watchOutside controller=" + Boolean(controller) + " doc=" + Boolean(doc) + " view=" + Boolean(view));
  if (!view) return;
  var tap = UITapGestureRecognizer.alloc().initWithTargetAction(ctx, "onOutsideTap:");
  tap.cancelsTouchesInView = false;
  view.addGestureRecognizer(tap);
  ctx.outsideTap = tap;
  ctx.outsideView = view;
  mndictLog("watchOutside recognizer=" + Boolean(tap));
}

function mndictUnwatchOutside(ctx) {
  if (ctx.outsideTap && ctx.outsideView) ctx.outsideView.removeGestureRecognizer(ctx.outsideTap);
  ctx.outsideTap = null;
  ctx.outsideView = null;
}

function mndictClose(ctx) {
  mndictLog("close");
  var panel = ctx.panel;
  ctx.panel = null;
  ctx.settingsVisible = false;
  mndictUnwatchOutside(ctx);
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
  mndictLog("show mode=" + mode);
  if (!ctx.panel) {
    var panel = AddonWebPanel.panel();
    if (!panel) {
      app.showHUD("MNDict：面板创建失败（模板白名单？）", ctx.window, 4);
      return;
    }
    panel.panelWidth = mode === "workspace" ? 480 : 420;
    panel.maxContentHeight = mode === "workspace" ? 760 : 560;
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
  if (mode === "mini") mndictWatchOutside(ctx);
  else mndictUnwatchOutside(ctx);
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
    onOutsideTap: function () {
      var closing = Boolean(self.panel && !self.settingsVisible);
      mndictLog("outsideTap closing=" + closing);
      if (closing) mndictClose(self);
    },
    onTextSelection: function (sender) {
      if (self.settingsVisible || !mndictAutoLookup()) return;
      if (!Application.sharedInstance().checkNotifySenderInWindow(sender, self.window)) return;
      var doc = sender.userInfo && sender.userInfo.documentController;
      var text = doc && doc.selectionText;
      if (typeof text !== "string") return;
      text = text.trim();
      if (!text || text.length > 120 || /[\r\n]/.test(text)) return;
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
