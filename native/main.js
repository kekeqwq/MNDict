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
  try {
    var tap = null;
    var action = "onOutsideTap:";
    try {
      tap = UITapGestureRecognizer.alloc().initWithTargetAction(ctx, action);
      mndictLog("watchOutside path=alloc.init tap=" + Boolean(tap));
    } catch (error1) {
      mndictLog("watchOutside alloc.init 失败=" + error1);
    }
    if (!tap) {
      try {
        tap = UITapGestureRecognizer.new();
        mndictLog("watchOutside path=new tap=" + Boolean(tap) + " addTarget=" + Boolean(tap && tap.addTargetAction));
        if (tap && tap.addTargetAction) tap.addTargetAction(ctx, action);
        else if (tap && tap.initWithTargetAction) tap.initWithTargetAction(ctx, action);
      } catch (error2) {
        mndictLog("watchOutside new 失败=" + error2);
      }
    }
    if (!tap) return;
    tap.cancelsTouchesInView = false;
    view.addGestureRecognizer(tap);
    ctx.outsideTap = tap;
    ctx.outsideView = view;
    mndictLog("watchOutside recognizer added");
  } catch (error) {
    mndictLog("watchOutside error=" + error);
  }
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
    onOutsideTap: function (sender) {
      var closing = Boolean(self.panel && !self.settingsVisible);
      try {
        var probeController = Application.sharedInstance().studyController(self.window);
        var probeDoc = probeController && probeController.readerController && probeController.readerController.currentDocumentController;
        var probeView = probeDoc && probeDoc.view;
        var point = sender && sender.locationInView ? sender.locationInView(probeView) : null;
        var pageNo = probeDoc ? probeDoc.currPageNo : -1;
        mndictLog("probe tap=" + (point ? Math.round(point.x) + "," + Math.round(point.y) : "?") +
          " page=" + pageNo + " bounds=" + (probeView ? Math.round(probeView.bounds.width) + "x" + Math.round(probeView.bounds.height) : "?"));
        var contents = Document.textContentsForPageNo(pageNo);
        mndictLog("probe contents count=" + (contents ? contents.length : -1));
        if (contents && contents.length) {
          for (var i = 0; i < Math.min(2, contents.length); i++) {
            var item = contents[i];
            var keys = [];
            for (var key in item) keys.push(key);
            mndictLog("probe item" + i + " keys=[" + keys.join(",") + "] json=" + String(JSON.stringify(item)).substring(0, 300));
          }
        }
        var pageText = Document.pageTextForPageNo(pageNo);
        mndictLog("probe text head=" + String(pageText || "").substring(0, 80).replace(/\n/g, "\\n"));
      } catch (error) {
        mndictLog("probe error=" + error);
      }
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
