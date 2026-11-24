// PDF 文字层上下文：供词组识别用，优先取包含选区的那页文本。
function mndictPageContext(ctx, doc, text) {
  try {
    var document = doc && doc.document;
    if (!document || !document.pageTextForPageNo) return "";
    var flatSel = String(text).replace(/[\s\u3000]+/g, "").toLowerCase();
    var nos = [doc.currPageNo, doc.currPageIndex, (doc.currPageNo || 1) - 1];
    var fallback = "";
    for (var i = 0; i < nos.length; i++) {
      var pageNo = nos[i];
      if (typeof pageNo !== "number" || !isFinite(pageNo)) continue;
      var pageText = "";
      try { pageText = document.pageTextForPageNo(pageNo); } catch (pageError) { pageText = ""; }
      if (typeof pageText !== "string" || !pageText) continue;
      if (!fallback) fallback = pageText;
      var flatPage = pageText.replace(/[\s\u3000]+/g, "").toLowerCase();
      if (flatSel && flatPage.indexOf(flatSel) >= 0) return pageText.slice(0, 100000);
    }
    return fallback.slice(0, 100000);
  } catch (error) {
    mndictLog("pageContext error=" + error);
    return "";
  }
}
