<script>
/*
 * Body scroll lock with scrollbar compensation + iOS rubber-band fix.
 *
 * Reference counted: nested overlays share one lock, body is only
 * unlocked when the last overlay closes.
 */
(function () {
  if (window.__overlayScrollLock) return;

  var lockCount = 0;
  var saved = { overflow: '', paddingRight: '', position: '', top: '', width: '' };
  var savedScrollY = 0;

  function isIOS() {
    if (typeof navigator === 'undefined') return false;
    return /iP(ad|hone|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function lock() {
    if (lockCount === 0) {
      var body = document.body;
      var html = document.documentElement;
      var scrollbarWidth = window.innerWidth - html.clientWidth;
      saved.overflow     = body.style.overflow;
      saved.paddingRight = body.style.paddingRight;
      saved.position     = body.style.position;
      saved.top          = body.style.top;
      saved.width        = body.style.width;
      if (isIOS()) {
        savedScrollY = window.scrollY;
        body.style.position = 'fixed';
        body.style.top = '-' + savedScrollY + 'px';
        body.style.width = '100%';
      } else {
        body.style.overflow = 'hidden';
        if (scrollbarWidth > 0) {
          var currentPad = parseFloat(getComputedStyle(body).paddingRight) || 0;
          body.style.paddingRight = (currentPad + scrollbarWidth) + 'px';
        }
      }
    }
    lockCount += 1;
  }

  function unlock() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      var body = document.body;
      var wasIOS = body.style.position === 'fixed';
      body.style.overflow     = saved.overflow;
      body.style.paddingRight = saved.paddingRight;
      body.style.position     = saved.position;
      body.style.top          = saved.top;
      body.style.width        = saved.width;
      if (wasIOS) window.scrollTo(0, savedScrollY);
    }
  }

  window.__overlayScrollLock = { lock: lock, unlock: unlock };
})();
</script>
