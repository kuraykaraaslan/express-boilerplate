/* =========================================================
   emoji-picker.js — emoji palette popover. Parallel of
   EmojiPicker.tsx. Attaches showEmoji onto ctx.
========================================================= */
(function () {
  var K = window.__KuiRte = window.__KuiRte || {};

  var EMOJIS = ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','👍','👎','👌','✌️','🤞','🤟','🤘','👋','🤚','✋','🖐️','🖖','👏','🙌','🤝','🙏','💪','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💕','💖','💗','💘','💝','🔥','✨','⭐','🌟','💫','💯','✅','❌','⚠️','❓','❗','💡','📌','📎','🔗','🎉'];

  K.attachEmojiPicker = function (ctx) {
    var pop = null;

    ctx.openEmoji = function (anchorBtn) {
      if (pop) { pop.remove(); pop = null; return; }
      pop = document.createElement('div');
      pop.className = 'kui-rte-popup kui-rte-emoji';
      var r = anchorBtn.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, r.left - 220) + 'px';
      EMOJIS.forEach(function (e) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', 'Insert ' + e);
        b.addEventListener('click', function () {
          ctx.actions.insertEmoji(e);
          ctx.closeEmoji();
        });
        pop.appendChild(b);
      });
      document.body.appendChild(pop);
      setTimeout(function () {
        var off = function (ev) {
          if (pop && !pop.contains(ev.target) && ev.target !== anchorBtn) {
            ctx.closeEmoji();
            document.removeEventListener('mousedown', off);
          }
        };
        document.addEventListener('mousedown', off);
      }, 0);
    };

    ctx.closeEmoji = function () {
      if (pop) { pop.remove(); pop = null; }
    };
  };
})();
