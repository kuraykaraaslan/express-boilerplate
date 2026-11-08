// modules/ui/CodeEditor/scripts/monaco-loader.js
//
// Monaco engine loader for the EJS CodeEditor — M2 STUB.
//
// In M2 this script will load monaco-editor's AMD loader, mount a Monaco
// instance over the data-kui-codeeditor element, and forward changes to the
// same kui-codeeditor:change CustomEvent that the codemirror fallback emits.
// For M1 it's a no-op so the textarea fallback wins.
//
// TODO M2: load monaco via CDN (`vs/loader.js`), call monaco.editor.create
//          inside attach(), bridge readOnly + theme + language + value.
// TODO M3: monaco.editor.setModelMarkers for diagnostics; provider registration.
// TODO M4: monaco-vim / collab cursor / minimap toggle.

(function () {
  if (window.KuiCodeEditorMonaco) return;
  window.KuiCodeEditorMonaco = {
    attach: function () {
      // TODO M2: real Monaco mount. Falls through to the codemirror
      //          fallback which is already attached by codemirror-loader.js.
      if (window && window.console) {
        // eslint-disable-next-line no-console
        console.warn('[CodeEditor] engine="monaco" not implemented yet — using codemirror fallback. See PLANS/36-CodeEditor.md M2.');
      }
    },
  };
})();
