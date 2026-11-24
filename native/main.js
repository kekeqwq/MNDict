JSB.require("PanelBridge");
var SELECTION = "PopupMenuOnSelection";

JSB.newAddon = function () {
  return JSB.defineClass("MNDictAddon : JSExtension", {
    sceneWillConnect: function () {
      self.panel = null;
      self.settingsVisible = false;
      self.observeSelection();
    },
    sceneDidDisconnect: function () {
      if (self.observingSelection) NSNotificationCenter.defaultCenter().removeObserverName(self, SELECTION);
      self.observingSelection = false;
      self.closePanel();
    },
    notebookWillOpen: function () {
      self.observeSelection();
    },
    notebookWillClose: function () {
      self.closePanel();
    },
    observeSelection: function () {
      if (self.observingSelection) return;
      NSNotificationCenter.defaultCenter().addObserverSelectorName(self, "onTextSelection:", SELECTION);
      self.observingSelection = true;
    },
    onTextSelection: function (sender) {
      if (self.settingsVisible || !mndictAutoLookup()) return;
      if (!Application.sharedInstance().checkNotifySenderInWindow(sender, self.window)) return;
      var doc = sender.userInfo && sender.userInfo.documentController;
      var text = doc && doc.selectionText;
      if (typeof text !== "string") return;
      text = text.trim();
      if (!text || text.length > 120 || /[\r\n]/.test(text)) return;
      self.showPanel("mini", text);
    },
    queryAddonCommandStatus: function () {
      return {
        image: "icon.png", object: self, selector: "openSettings:", checked: self.settingsVisible,
      };
    },
    openSettings: function () {
      if (self.settingsVisible) self.closePanel();
      else self.showPanel("workspace", "");
      self.refreshCommands();
    },
    closePanel: function () {
      var panel = self.panel;
      self.panel = null;
      self.settingsVisible = false;
      if (panel) panel.hideFloating();
    },
    refreshCommands: function () {
      var controller = Application.sharedInstance().studyController(self.window);
      if (controller) controller.refreshAddonCommands();
    },
    showPanel: function (mode, text) {
      var controller = Application.sharedInstance().studyController(self.window);
      if (!controller) return;
      if (self.panel && self.settingsVisible !== (mode === "workspace")) self.closePanel();
      self.openState = { mode: mode, text: text };
      if (!self.panel) {
        var panel = AddonWebPanel.panel();
        if (!panel) return;
        panel.panelWidth = mode === "workspace" ? 420 : 355;
        panel.maxContentHeight = mode === "workspace" ? 680 : 350;
        panel.onMessage = function (name, payload) {
          if (name === "__closed__") {
            if (self.panel === panel) {
              self.panel = null;
              self.settingsVisible = false;
              self.refreshCommands();
            }
            return { ok: true };
          }
          return mndictPanelMessage(name, payload, self.openState);
        };
        if (!panel.loadPanel()) { panel.teardown(); return; }
        self.panel = panel;
      }
      self.settingsVisible = mode === "workspace";
      self.panel.showFloatingInMode(controller, mode);
      self.panel.post("mndict-open", self.openState);
    },
  });
};
