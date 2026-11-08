/* ── Context menu (gallery-specific, built by JS) ───────────────────── */
var ctxMenu = document.getElementById(G_ID + '-ctx');

function ensureGlobalCtx() {
  if (window._kuiCtx) return;
  window._kuiCtx = { active: null };
  document.addEventListener('mousedown', function (e) {
    var id = window._kuiCtx.active;
    if (!id) return;
    var m = document.getElementById(id);
    if (m && !m.contains(e.target)) window.closeContextMenu(id);
  });
  window.addEventListener('scroll', function () {
    if (window._kuiCtx.active) window.closeContextMenu(window._kuiCtx.active);
  }, { capture: true, passive: true });
  document.addEventListener('keydown', function (e) {
    var id = window._kuiCtx.active;
    if (!id) return;
    var m = document.getElementById(id);
    if (!m || m.style.display === 'none') return;
    if (e.key === 'Escape') { e.preventDefault(); window.closeContextMenu(id); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var focusable = Array.from(m.querySelectorAll('[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'));
      if (!focusable.length) return;
      var idx  = focusable.indexOf(document.activeElement);
      var next = e.key === 'ArrowDown' ? (idx + 1) % focusable.length : (idx <= 0 ? focusable.length - 1 : idx - 1);
      focusable[next].focus();
    }
  });
  window.closeContextMenu = window.closeContextMenu || function (id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'none';
    if (window._kuiCtx.active === id) window._kuiCtx.active = null;
  };
  window.openContextMenu = window.openContextMenu || function () {};
}

function openGalleryCtx(i, event) {
  if (!ctxMenu) return;
  ensureGlobalCtx();

  /* Close any other open menu first */
  if (window._kuiCtx.active && window._kuiCtx.active !== G_ID + '-ctx') {
    window.closeContextMenu(window._kuiCtx.active);
  }

  /* Build menu items via DOM (keeps click handlers attached) */
  ctxMenu.innerHTML = '';
  appendCtxItems(ctxMenu, i);

  /* Position */
  ctxMenu.style.visibility = 'hidden';
  ctxMenu.style.display    = 'block';
  var mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  var vw = window.innerWidth,   vh = window.innerHeight, GAP = 8;
  var x  = (event.clientX + mw > vw - GAP) ? Math.max(GAP, event.clientX - mw) : event.clientX;
  var y  = (event.clientY + mh > vh - GAP) ? Math.max(GAP, event.clientY - mh) : event.clientY;
  ctxMenu.style.left       = x + 'px';
  ctxMenu.style.top        = y + 'px';
  ctxMenu.style.visibility = 'visible';
  window._kuiCtx.active    = G_ID + '-ctx';
  var first = ctxMenu.querySelector('[role="menuitem"]:not([disabled])');
  if (first) first.focus();
}

function appendCtxItems(parent, i) {
  var total = images.length;
  appendCtxItem(parent, 'fa-expand',       'Open in lightbox', null, false, false, function () { lbOpen(i); });
  appendCtxItem(parent, 'fa-copy',         'Copy image URL',   '⌘C', false, false, function () { if (navigator.clipboard) navigator.clipboard.writeText(images[i].src).catch(function(){}); });
  appendCtxSeparator(parent);
  appendCtxGroup(parent, 'Reorder');
  appendCtxItem(parent, 'fa-angles-left',  'Move to first',    null, false, i === 0,          function () { moveToIdx(i, 0); });
  appendCtxItem(parent, 'fa-angles-right', 'Move to last',     null, false, i === total - 1,  function () { moveToIdx(i, total - 1); });
  appendCtxSeparator(parent);
  appendCtxItem(parent, 'fa-trash',        'Remove',           null, true,  false, function () { removeAt(i); });
}

function appendCtxItem(parent, iconCls, label, shortcut, danger, disabled, fn) {
  var col     = danger ? 'text-error hover:bg-error-subtle focus-visible:bg-error-subtle' : 'text-text-primary hover:bg-surface-overlay focus-visible:bg-surface-overlay';
  var iconCol = danger ? 'text-error' : 'text-text-secondary';
  var dis     = disabled ? ' opacity-40 cursor-not-allowed pointer-events-none' : '';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  btn.setAttribute('tabindex', '-1');
  if (disabled) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
  btn.className = 'flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors select-none focus-visible:outline-none ' + col + dis;

  var iconSpan = document.createElement('span');
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.className = 'w-4 flex items-center justify-center shrink-0 ' + iconCol;
  iconSpan.innerHTML = '<i class="fa-solid ' + iconCls + ' text-xs" aria-hidden="true"></i>';
  btn.appendChild(iconSpan);

  var labelSpan = document.createElement('span');
  labelSpan.className = 'flex-1 truncate';
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);

  if (shortcut) {
    var kbd = document.createElement('kbd');
    kbd.className = 'shrink-0 ml-6 text-[11px] font-mono text-text-disabled';
    kbd.textContent = shortcut;
    btn.appendChild(kbd);
  }

  if (!disabled && fn) {
    btn.addEventListener('click', function () { fn(); if (window.closeContextMenu) window.closeContextMenu(G_ID + '-ctx'); });
  }
  parent.appendChild(btn);
}

function appendCtxSeparator(parent) {
  var sep = document.createElement('div');
  sep.setAttribute('role', 'separator');
  sep.setAttribute('aria-orientation', 'horizontal');
  sep.className = 'my-1 mx-2 border-t border-border';
  parent.appendChild(sep);
}

function appendCtxGroup(parent, label) {
  var p = document.createElement('p');
  p.setAttribute('role', 'presentation');
  p.className = 'px-3 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-widest text-text-disabled select-none';
  p.textContent = label;
  parent.appendChild(p);
}

function moveToIdx(from, to) {
  var moved = images.splice(from, 1)[0];
  images.splice(to, 0, moved);
  renderGrid();
}

function removeAt(i) {
  images.splice(i, 1);
  renderGrid();
}
