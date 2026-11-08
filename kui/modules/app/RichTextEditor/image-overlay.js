/* =========================================================
   image-overlay.js — floating overlay anchored above a
   clicked <img> (resize / align / remove). Parallel of
   ImageOverlay.tsx. Attaches showImgOverlay / hideImgOverlay
   onto ctx.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  K.attachImageOverlay = function (ctx) {
    var overlay = null;
    var selected = null;

    ctx.showImgOverlay = function (img) {
      selected = img;
      ctx.store.set({ imgSel: { open: true, el: img, rect: img.getBoundingClientRect() } });
      hide();
      var r = img.getBoundingClientRect();
      overlay = document.createElement('div');
      overlay.className = 'kui-rte-popup kui-rte-bubble';
      overlay.style.position = 'fixed';
      overlay.style.top = (r.top - 38) + 'px';
      overlay.style.left = r.left + 'px';
      overlay.innerHTML =
        '<button type="button" data-act="size:25%" title="Small">S</button>' +
        '<button type="button" data-act="size:50%" title="Medium">M</button>' +
        '<button type="button" data-act="size:100%" title="Large">L</button>' +
        '<span class="w-px h-5 bg-border mx-1 self-center"></span>' +
        '<button type="button" data-act="align:left" title="Left">⇤</button>' +
        '<button type="button" data-act="align:center" title="Center">⇔</button>' +
        '<button type="button" data-act="align:right" title="Right">⇥</button>' +
        '<span class="w-px h-5 bg-border mx-1 self-center"></span>' +
        '<button type="button" data-act="remove" title="Remove"><i class="fa-solid fa-trash w-3.5 h-3.5"></i></button>';
      document.body.appendChild(overlay);
      overlay.addEventListener('mousedown', function (e) {
        var b = e.target.closest('button[data-act]');
        if (!b || !selected) return;
        e.preventDefault();
        var act = b.getAttribute('data-act');
        if      (act.indexOf('size:')  === 0) ctx.actions.applyImageResize(act.slice(5));
        else if (act.indexOf('align:') === 0) ctx.actions.applyImageAlign(act.slice(6));
        else if (act === 'remove')            ctx.actions.removeSelectedImage();
      });
    };

    function hide() {
      if (overlay) { overlay.remove(); overlay = null; }
    }
    ctx.hideImgOverlay = function () {
      hide();
      ctx.store.set({ imgSel: { open: false, el: null, rect: null } });
      selected = null;
    };
  };
})();
