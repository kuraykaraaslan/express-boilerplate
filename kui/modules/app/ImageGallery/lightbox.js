/* ── Lightbox ───────────────────────────────────────────────────────── */
var lbIndex  = 0;
var lbZoomed = false;

function lbOpen(i) {
  lbIndex  = i;
  lbZoomed = false;
  var lb = document.getElementById(G_ID + '-lb');
  if (lb) lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  lbUpdate();
}

function lbClose() {
  var lb = document.getElementById(G_ID + '-lb');
  if (lb) lb.style.display = 'none';
  document.body.style.overflow = '';
  lbZoomed = false;
  var lbImg = document.getElementById(G_ID + '-lb-img');
  if (lbImg) { lbImg.style.transform = ''; lbImg.className = lbImg.className.replace('cursor-zoom-out','cursor-zoom-in'); }
}

function lbNav(dir) {
  lbIndex  = (lbIndex + dir + images.length) % images.length;
  lbZoomed = false;
  lbUpdate();
}

function lbZoom() {
  lbZoomed = !lbZoomed;
  var lbImg  = document.getElementById(G_ID + '-lb-img');
  var lbZBtn = document.getElementById(G_ID + '-lb-zoom');
  var lbZIco = document.getElementById(G_ID + '-lb-zoom-icon');
  if (lbImg)  { lbImg.style.transform = lbZoomed ? 'scale(1.5)' : ''; lbImg.className = lbImg.className.replace(lbZoomed ? 'cursor-zoom-in' : 'cursor-zoom-out', lbZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'); }
  if (lbZBtn) lbZBtn.setAttribute('aria-label', lbZoomed ? 'Zoom out' : 'Zoom in');
  if (lbZIco) { lbZIco.className = 'fa-solid ' + (lbZoomed ? 'fa-magnifying-glass-minus' : 'fa-magnifying-glass-plus'); }
}

function lbUpdate() {
  var img     = images[lbIndex];
  var lbImg   = document.getElementById(G_ID + '-lb-img');
  var lbCnt   = document.getElementById(G_ID + '-lb-counter');
  var lbCap   = document.getElementById(G_ID + '-lb-caption');
  var lbPrev  = document.getElementById(G_ID + '-lb-prev');
  var lbNext  = document.getElementById(G_ID + '-lb-next');
  var lbThumbs= document.getElementById(G_ID + '-lb-thumbs');

  if (lbImg)  { lbImg.src = img.src; lbImg.alt = img.alt || ''; lbImg.style.transform = ''; }
  if (lbCnt)  lbCnt.textContent = (lbIndex + 1) + ' / ' + images.length;
  if (lbCap)  { lbCap.textContent = img.caption || ''; lbCap.classList.toggle('hidden', !img.caption); }
  if (lbPrev) lbPrev.style.display = images.length > 1 ? '' : 'none';
  if (lbNext) lbNext.style.display = images.length > 1 ? '' : 'none';

  if (lbThumbs && images.length > 1) {
    lbThumbs.innerHTML = '';
    images.forEach(function (im, j) {
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.setAttribute('aria-label', 'View image ' + (j + 1));
      btn.setAttribute('aria-pressed', j === lbIndex ? 'true' : 'false');
      btn.className = [
        'shrink-0 w-12 h-12 rounded overflow-hidden transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
        j === lbIndex ? 'ring-2 ring-white opacity-100 scale-105' : 'opacity-40 hover:opacity-70',
      ].join(' ');
      var bImg = document.createElement('img');
      bImg.src       = im.src;
      bImg.alt       = im.alt || '';
      bImg.className = 'w-full h-full object-cover';
      bImg.draggable = false;
      btn.appendChild(bImg);
      btn.addEventListener('click', function () { lbIndex = j; lbZoomed = false; lbUpdate(); });
      lbThumbs.appendChild(btn);
    });
  }
}

/* Lightbox buttons → per-instance listeners (no shared window globals) */
function bindLbHandlers() {
  var zoomBtn  = document.getElementById(G_ID + '-lb-zoom');
  var closeBtn = document.getElementById(G_ID + '-lb-close');
  var prevBtn  = document.getElementById(G_ID + '-lb-prev');
  var nextBtn  = document.getElementById(G_ID + '-lb-next');
  var bgBtn    = document.getElementById(G_ID + '-lb-bg');
  var lbImg    = document.getElementById(G_ID + '-lb-img');
  if (zoomBtn)  zoomBtn.addEventListener('click', lbZoom);
  if (closeBtn) closeBtn.addEventListener('click', lbClose);
  if (prevBtn)  prevBtn.addEventListener('click', function(){ lbNav(-1); });
  if (nextBtn)  nextBtn.addEventListener('click', function(){ lbNav(1); });
  if (bgBtn)    bgBtn.addEventListener('click', lbClose);
  if (lbImg)    lbImg.addEventListener('click', lbZoom);
}

/* Lightbox keyboard */
document.addEventListener('keydown', function (e) {
  var lb = document.getElementById(G_ID + '-lb');
  if (!lb || lb.style.display === 'none') return;
  if (e.key === 'Escape')      { lbClose(); }
  if (e.key === 'ArrowLeft')   { lbNav(-1); }
  if (e.key === 'ArrowRight')  { lbNav(1); }
});
