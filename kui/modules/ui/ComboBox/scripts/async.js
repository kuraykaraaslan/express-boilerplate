/*
 * ComboBox / MultiSelect async-search runtime — mirrors NextJS
 *   modules/ui/ComboBox/hooks/useAsync.ts.
 *
 * Contract:
 *   - Debounced 300 ms by default.
 *   - AbortController cancels any in-flight request when a new query arrives.
 *   - In-memory cache keyed by query, 5 min TTL.
 *
 * The host page registers an async resolver against a combobox root via:
 *   ComboBoxAsync.register(rootEl, async function(query, signal) { ... });
 * The script in each ComboBox.ejs root will pick it up if present.
 */
(function () {
  if (window.ComboBoxAsync) return;

  var TTL_MS = 5 * 60 * 1000;
  var caches = new WeakMap();   // root -> Map<query, { ts, data }>
  var aborts = new WeakMap();   // root -> AbortController
  var timers = new WeakMap();   // root -> timeout id
  var resolvers = new WeakMap();// root -> function

  function getCache(root) {
    var c = caches.get(root);
    if (!c) { c = new Map(); caches.set(root, c); }
    return c;
  }

  window.ComboBoxAsync = {
    register: function (root, resolver) {
      if (!root || typeof resolver !== 'function') return;
      resolvers.set(root, resolver);
    },
    has: function (root) {
      return resolvers.has(root);
    },
    /**
     * Run an async search with debounce + AbortController + cache.
     * @param {HTMLElement} root combobox root element
     * @param {string} query
     * @param {{ debounceMs?: number, onStart?: Function, onResult: Function, onError?: Function, onFinish?: Function }} cb
     */
    search: function (root, query, cb) {
      var resolver = resolvers.get(root);
      if (!resolver) return;
      var key = (query || '').trim().toLowerCase();
      var cache = getCache(root);
      var hit = cache.get(key);
      if (hit && (Date.now() - hit.ts) < TTL_MS) {
        if (cb && cb.onResult) cb.onResult(hit.data);
        if (cb && cb.onFinish) cb.onFinish();
        return;
      }
      // Cancel previous in-flight + timer.
      var prevController = aborts.get(root);
      if (prevController) prevController.abort();
      var prevTimer = timers.get(root);
      if (prevTimer) clearTimeout(prevTimer);

      var controller = new AbortController();
      aborts.set(root, controller);
      if (cb && cb.onStart) cb.onStart();

      var debounceMs = (cb && cb.debounceMs) || 300;
      var t = setTimeout(function () {
        Promise.resolve()
          .then(function () { return resolver(query, controller.signal); })
          .then(function (data) {
            if (controller.signal.aborted) return;
            cache.set(key, { ts: Date.now(), data: data });
            if (cb && cb.onResult) cb.onResult(data);
          })
          .catch(function (err) {
            if (controller.signal.aborted) return;
            if (err && err.name === 'AbortError') return;
            if (cb && cb.onError) cb.onError(err);
          })
          .finally(function () {
            if (controller.signal.aborted) return;
            if (cb && cb.onFinish) cb.onFinish();
          });
      }, debounceMs);
      timers.set(root, t);
    },
  };
})();
