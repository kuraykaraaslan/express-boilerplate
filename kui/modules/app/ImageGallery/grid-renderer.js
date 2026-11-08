/* ── Grid render ────────────────────────────────────────────────────── */
function renderGrid() {
  var grid = document.getElementById(G_ID + '-grid');
  if (!grid) return;
  grid.innerHTML = '';

  images.forEach(function (img, i) {
    var item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-idx', i);
    item.className = [
      'group relative overflow-hidden rounded-lg bg-surface-sunken transition-all duration-200',
      ASPECT,
      REORDER ? 'cursor-grab active:cursor-grabbing' : '',
    ].filter(Boolean).join(' ');

    if (REORDER) {
      item.draggable = true;
      item.addEventListener('dragstart',  function () { dndStart(i); });
      item.addEventListener('dragover',   function (e) { e.preventDefault(); dndOver(i); });
      item.addEventListener('dragleave',  function () { dndLeave(); });
      item.addEventListener('drop',       function () { dndDrop(i); });
      item.addEventListener('dragend',    function () { dndEnd(); });
      item.addEventListener('contextmenu',function (e) { e.preventDefault(); e.stopPropagation(); openGalleryCtx(i, e); return false; });
    }

    /* Image */
    var pic = document.createElement('img');
    pic.src     = img.src;
    pic.alt     = img.alt || '';
    pic.loading = 'lazy';
    pic.draggable = false;
    pic.className = [
      'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105',
      ASPECT === '' ? 'aspect-square' : '',
      REORDER ? 'pointer-events-none' : '',
    ].filter(Boolean).join(' ');
    item.appendChild(pic);

    /* Drag handle badge */
    if (REORDER) {
      var grip = document.createElement('div');
      grip.setAttribute('aria-hidden', 'true');
      grip.className = 'absolute top-1.5 left-1.5 z-10 w-6 h-6 flex items-center justify-center rounded bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none';
      grip.innerHTML = '<i class="fa-solid fa-grip-vertical text-xs" aria-hidden="true"></i>';
      item.appendChild(grip);
    }

    /* Hover overlay → lightbox */
    if (LIGHTBOX) {
      var overlay = document.createElement('button');
      overlay.type      = 'button';
      overlay.setAttribute('aria-label', 'Open ' + (img.alt || 'image') + ' in lightbox');
      overlay.className = 'absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/0 group-hover:bg-black/40 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-inset';
      overlay.innerHTML = '<i class="fa-solid fa-expand text-white text-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-md" aria-hidden="true"></i>'
        + (img.caption ? '<span class="text-white text-xs font-medium px-2 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-md" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(img.caption) + '</span>' : '');
      overlay.addEventListener('click', function () { lbOpen(i); });
      item.appendChild(overlay);
    }

    /* Static caption */
    if (CAPTIONS && img.caption) {
      var cap = document.createElement('p');
      cap.className = 'absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs px-2 py-1 pointer-events-none';
      cap.style.cssText = 'display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden';
      cap.textContent = img.caption;
      item.appendChild(cap);
    }

    grid.appendChild(item);
  });
}

/* ── Utility ────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
