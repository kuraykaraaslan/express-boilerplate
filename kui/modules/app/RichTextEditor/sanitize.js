/* =========================================================
   sanitize.js — paste sanitizer + image upload helper.
   Pixel-parallel sibling of React's sanitize.ts.
   Exposes K.sanitize() and K.resolveImageSrc() on the
   __KuiRte namespace.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.sanitize = function (html) {
    if (!html) return '';
    var s = html;
    s = s.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<\/?(o|w|m|v):[^>]+>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/\s(class|style|lang|dir|xml:lang|xmlns(?::\w+)?)="[^"]*"/gi, '');
    s = s.replace(/<\/?font[^>]*>/gi, '');
    s = s.replace(/<p>\s*<\/p>/gi, '');
    return s;
  };

  /** resolveImageSrc(file, uploadFnName?) — prefers a global upload fn
      (named via the data-image-upload-fn attr); falls back to base64. */
  K.resolveImageSrc = function (file, uploadFnName) {
    var fn = uploadFnName && typeof window[uploadFnName] === 'function' ? window[uploadFnName] : null;
    if (fn) {
      try {
        var p = fn(file);
        if (p && typeof p.then === 'function') return p;
      } catch (e) {}
    }
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error('Failed to read file.')); };
      r.readAsDataURL(file);
    });
  };

  K.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c];
    });
  };
  K.escapeAttr = function (s) { return String(s).replace(/"/g, '&quot;'); };

  K.parseJSONAttr = function (el, name) {
    var v = el.getAttribute(name);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  };
})();
