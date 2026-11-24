JSB.require("PanelBridge");
JSB.require("NativeDb");
JSB.require("PageContext");
var SELECTION = "PopupMenuOnSelection";

// JSB 实例方法按 selector 映射，带参方法不在 self 上；业务逻辑放文件级函数，显式传上下文。
function mndictRefreshCommands(ctx) {
  var controller = Application.sharedInstance().studyController(ctx.window);
  if (controller) controller.refreshAddonCommands();
}

// 迷你浮层：轻点文档区即关闭。禁用宿主的轻点识别器，避免这一下清掉选区/工具条。
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

// PDF 文字层上下文提取在 native/PageContext.js
// 卡片描边：画在带圆角的层上，弧线与面板裁切完全吻合。返回是否画上（页面据此撤掉 CSS 兑底环）。
function mndictPanelBorder(ctx) {
  try {
    var view = ctx.panel && ctx.panel.view;
    var layer = view && view.layer;
    if (layer && !(layer.cornerRadius > 0) && view.superview && view.superview.layer) layer = view.superview.layer;
    if (!layer || !(layer.cornerRadius > 0)) {
      mndictLog("panelBorder 找不到带圆角的层");
      return false;
    }
    var theme = String(Application.sharedInstance().currentTheme || "").toLowerCase();
    // 与页面的 resolvePalette 一致：白/棕褐/未知 → 浅色描边；灰/黑/绿 → 深色描边
    var light = ["gray", "grey", "dark", "black", "green"].indexOf(theme) < 0;
    var color = light
      ? UIColor.colorWithRedGreenBlueAlpha(0.737, 0.753, 0.8, 1)
      : UIColor.colorWithRedGreenBlueAlpha(0.286, 0.302, 0.392, 1);
    layer.borderWidth = 1;
    layer.borderColor = color.CGColor;
    mndictLog("panelBorder 已画 radius=" + layer.cornerRadius + " light=" + light);
    return true;
  } catch (error) {
    mndictLog("panelBorder error=" + error);
    return false;
  }
}

function mndictShow(ctx, mode, text, pageText) {
  var app = Application.sharedInstance();
  var controller = app.studyController(ctx.window);
  if (!controller) {
    app.showHUD("MNDict：拿不到 studyController", ctx.window, 3);
    return;
  }
  if (ctx.panel && ctx.settingsVisible !== (mode === "workspace")) mndictClose(ctx);
  var theme = app.currentTheme;
  ctx.openState = { mode: mode, text: text, theme: theme == null ? null : String(theme), pageText: pageText || "" };
  mndictLog("show mode=" + mode + " theme=" + ctx.openState.theme + " 上下文=" + ctx.openState.pageText.length + " 字");
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
      if (name === "askAI") return mndictAskAI(ctx);
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
  var nativeBorder = mndictPanelBorder(ctx);
  ctx.openState.nativeBorder = nativeBorder;
  // 查词卡固定在屏幕下部左侧：黑色工具条所在的中带之下，内容随 fit 向下生长
  if (mode === "mini") {
    try {
      var bounds = controller.view.bounds;
      var panelView = ctx.panel.view;
      if (panelView && bounds) {
        // 左列整块：顶部栏下方到底部工具栏上方，横向约 42% 宽
        var y = Math.round(bounds.height * 0.16);
        var h = Math.round(bounds.height * 0.69);
        panelView.frame = { x: Math.round(bounds.width * 0.02), y: y, width: Math.round(bounds.width * 0.52), height: h };
        ctx.panel.maxContentHeight = h;
        mndictLog("show mini 定位 左列 w=" + Math.round(bounds.width * 0.52) + " h=" + h);
      }
    } catch (frameError) {
      mndictLog("show frame error=" + frameError);
    }
  }
  ctx.panel.post("mndict-open", ctx.openState);
}

// 在聊天视图树里按标题找按钮（用于自动点掉「点击即发送」）
function mndictFindButton(view, keyword, depth, found) {
  if (!view || depth > 14 || found.length) return;
  try {
    if (view.sendActionsForControlEvents) {
      var title = String((view.currentTitle || "") + (view.titleLabel && view.titleLabel.text ? view.titleLabel.text : ""));
      if (title.indexOf(keyword) >= 0) {
        found.push(view);
        return;
      }
    }
    var children = view.subviews || [];
    for (var i = 0; i < children.length; i++) mndictFindButton(children[i], keyword, depth + 1, found);
  } catch (error) {
    // 单个视图读取失败不影响整体遍历
  }
}

function mndictAutoSendStaged(controller) {
  try {
    var roots = [];
    var names = ["floatingChatContainer", "floatingChatNavigation", "chatController", "innerChatController"];
    for (var i = 0; i < names.length; i++) {
      try {
        var obj = controller.performSelector(names[i]);
        if (obj) roots.push(obj.view ? obj.view : obj);
      } catch (error) {
        // 忽略取不到的容器
      }
    }
    var found = [];
    for (var r = 0; r < roots.length && !found.length; r++) mndictFindButton(roots[r], "即发送", 0, found);
    for (var r2 = 0; r2 < roots.length && !found.length; r2++) mndictFindButton(roots[r2], "发送", 0, found);
    if (found.length) {
      found[0].sendActionsForControlEvents(64); // UIControlEvents.touchUpInside
      mndictLog("askAI 自动发送已触发");
    } else {
      mndictLog("askAI 未找到发送按钮");
    }
  } catch (error) {
    mndictLog("askAI autoSend error=" + error);
  }
}

// Ask AI：只走真实按钮的 touchUpInside（sender 就是按钮，MN 自带选区语境），不做带参反射。
function mndictAskAI(ctx) {
  try {
    var controller = Application.sharedInstance().studyController(ctx.window);
    var doc = controller && controller.readerController && controller.readerController.currentDocumentController;
    var word = doc && doc.selectionText ? String(doc.selectionText).trim() : "";
    if (!word) return { ok: false, detail: "没有选区" };
    mndictLog("askAI word=" + word.substring(0, 40));
    // 对齐 MN 菜单自身的 Ask AI 流程：先把当前选区数据交给 pending，再开对话框
    try {
      var data = controller.performSelector("currentBookSelectionDataForAIChat");
      mndictLog("askAI selectionData=" + (data ? "有" : "无"));
      if (data) {
        controller.performSelectorWithObject("setPendingAISelectionData:", data);
        mndictLog("askAI pending 已设置");
      }
    } catch (error) {
      mndictLog("askAI selectionData error=" + error);
    }
    var names = ["chatBtn", "inlineChatBtn"];
    var tapped = false;
    for (var i = 0; i < names.length && !tapped; i++) {
      try {
        var btn = controller.performSelector(names[i]);
        mndictLog("askAI " + names[i] + "=" + (btn ? "已取得" : "空"));
        if (btn && btn.sendActionsForControlEvents) {
          btn.sendActionsForControlEvents(64); // UIControlEvents.touchUpInside
          mndictLog("askAI " + names[i] + " 触发 touchUpInside");
          tapped = true;
        }
      } catch (error) {
        mndictLog("askAI " + names[i] + " error=" + error);
      }
    }
    try {
      var visibleNote = controller.performSelector("mn_visibleAIChatNote");
      mndictLog("askAI visibleNote=" + (visibleNote ? "有" : "无"));
    } catch (error) {
      mndictLog("askAI visibleNote 查询失败=" + error);
    }
    // 对话框可见后，把当前选区推进去（零参，安全）
    if (tapped) {
      try {
        controller.performSelector("mn_addSelectionToVisibleChat");
        mndictLog("askAI addSelectionToVisibleChat 已调用");
      } catch (error) {
        mndictLog("askAI addSelection error=" + error);
      }
      // 等「点击即发送」芯片出现后自动点掉，省一次手动点击
      try {
        NSTimer.scheduledTimerWithTimeInterval(0.6, false, function () {
          mndictAutoSendStaged(controller);
        });
      } catch (error) {
        mndictLog("askAI timer error=" + error);
      }
    }
    if (!tapped) return { ok: false, detail: "找不到可用的 AI 按钮" };
    mndictClose(ctx);
    return { ok: true };
  } catch (error) {
    mndictLog("askAI error=" + error);
    return { ok: false, detail: String(error) };
  }
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
    onOutsideTap: function () {
      if (self.panel && !self.settingsVisible) mndictClose(self);
    },
    onTextSelection: function (sender) {
      if (self.settingsVisible || !mndictAutoLookup()) return;
      if (!Application.sharedInstance().checkNotifySenderInWindow(sender, self.window)) return;
      var doc = sender.userInfo && sender.userInfo.documentController;
      var text = doc && doc.selectionText;
      if (typeof text !== "string") return;
      text = text.trim();
      if (!text || text.length > 120 || /[\r\n]/.test(text)) return;
      mndictShow(self, "mini", text, mndictPageContext(self, doc, text));
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
