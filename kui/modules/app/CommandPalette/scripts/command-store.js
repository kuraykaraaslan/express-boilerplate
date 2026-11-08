// Tiny imperative command registry — parity with hooks/useCommandStore.ts.
// Any module on the page can add commands at runtime:
//   var dispose = window.__KuiCmdStore.register({ id, label, group, order, hidden, icon, shortcut, keywords, href, onClick });
//   var disposeAll = window.__KuiCmdStore.registerMany([...]);
// Every palette lists them next to its own items when it opens (`icon` is a Font Awesome
// class string, `onClick` a function). A command with hidden: true stays registered but is
// not listed, so gating (module off, no permission) is a flag, not a re-register.
// TODO M2: scope-aware unregister, conditional `enabled()` gating.
(function () {
  if (window.__KuiCmdStore) return;
  var registry = {};
  var listeners = [];

  function groupOf(cmd) {
    return cmd.group || cmd.category || 'Commands';
  }

  function key(cmd) {
    return cmd.id || (groupOf(cmd) + '::' + cmd.label);
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* swallow */ }
    }
  }

  window.__KuiCmdStore = {
    register: function (cmd) {
      var k = key(cmd);
      registry[k] = cmd;
      emit();
      return function () {
        delete registry[k];
        emit();
      };
    },
    registerMany: function (cmds) {
      var keys = (cmds || []).map(function (cmd) {
        var k = key(cmd);
        registry[k] = cmd;
        return k;
      });
      emit();
      return function () {
        keys.forEach(function (k) { delete registry[k]; });
        emit();
      };
    },
    key: key,
    groupOf: groupOf,
    all: function () {
      var out = [];
      for (var k in registry) if (Object.prototype.hasOwnProperty.call(registry, k)) out.push(registry[k]);
      return out;
    },
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    }
  };
})();
