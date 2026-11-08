import { MAX_TRANSFORM_OUTPUT_BYTES } from './transform-output'
import { MAX_TRANSFORM_SCRIPT_CHARS, TRANSFORM_DEFAULT_TIMEOUT_MS, TRANSFORM_MAX_TIMEOUT_MS, TRANSFORM_MIN_TIMEOUT_MS } from './transform.dto'

/**
 * The compute frame's shell and policy (phase 35.5, ADR-0017, POSTURE §14), pure: the two routes
 * (`dashboard-compute-frame.route.ts`, `dashboard-display-compute-frame.route.ts`) serve exactly this, and the UI test
 * drives the shell's script in a harness without loading a Next route.
 *
 * The policy is the template frame's (`dashboard-frame.route.ts`) plus what a classic Worker made from a Blob needs,
 * and nothing a script could use to reach anything. The frame loads this fixed shell, so the policy below is the
 * script's whole world whatever the app's policy is (a `srcdoc` document would inherit the app's):
 *
 * - `sandbox allow-scripts`: the same sandbox as the iframe attribute, so the shell is opaque-origin even when
 *   someone opens this URL directly: no cookies, no storage, no DOM of the app.
 * - `default-src 'none'`: nothing loads unless a directive below says so (no images, fonts, media, frames).
 * - `script-src 'unsafe-inline'`: the shell is one inline script. No `blob:`, no `https:` and no `'unsafe-eval'`: a
 *   script cannot import or load code from anywhere, and `eval` / `new Function` are refused inside it.
 * - `worker-src blob:`: the Worker is created from the one Blob the shell builds (the script with its `export
 *   default` bound, then the runner; a classic Worker, because a Chrome module Worker does not load in an
 *   opaque-origin document, phase 35.6); a `blob:` URL is only ever minted by this document, and nothing else may be
 *   a Worker. A Blob Worker inherits this policy.
 * - `connect-src 'none'`: no `fetch`, no `XMLHttpRequest`, no WebSocket, no beacon, from the shell or the Worker.
 * - `form-action 'none'`, `base-uri 'none'`: no form submits anywhere, no base URL tricks.
 * - `frame-ancestors 'self'`: only this app can frame it.
 *
 * The proxy leaves a route's own `Content-Security-Policy` alone (`proxy/csp.ts` `withSecurityHeaders`).
 */
export const COMPUTE_FRAME_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  'worker-src blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ')

/** The shell gives a Worker this long to load a script's module before it reports `load` and gives up on it. */
export const COMPUTE_LOAD_TIMEOUT_MS = 5_000

/**
 * The Worker's own module, built by the shell as `import * as m from "<the script's Blob URL>";` followed by this
 * source, so the tenant's text is a separate module the runner imports, never concatenated into code. It runs the
 * default export per `run` message, synchronously, and answers with the result as JSON TEXT (so the shell can
 * measure it and the host parses it into plain data) or an error by code: `load` (no default export function),
 * `throw` (the function threw), `invalid` (not an object, a promise, or not serialisable). It never reads anything
 * but the `run` message, and it never sends anything but a `loaded` or a `result`.
 */
export const COMPUTE_RUNNER_SOURCE = `const fn = typeof m.default === 'function' ? m.default : null;
self.onmessage = (ev) => {
  const d = ev.data;
  if (!d || d.type !== 'run' || typeof d.runId !== 'string') return;
  const fail = (code, message) => self.postMessage({ type: 'result', runId: d.runId, ok: false, error: { code, message: String(message).slice(0, 500) } });
  if (!fn) { fail('load', 'The script has no default export function'); return; }
  const t0 = performance.now();
  let out;
  try { out = fn(d.input); }
  catch (err) { fail('throw', err && err.message !== undefined ? err.message : err); return; }
  if (out === null || typeof out !== 'object' || Array.isArray(out)) { fail('invalid', 'The script must return an object ({ slots })'); return; }
  if (typeof out.then === 'function') { fail('invalid', 'The script must be synchronous (it returned a promise)'); return; }
  let json;
  try { json = JSON.stringify(out); }
  catch (err) { fail('invalid', 'The result cannot be serialised'); return; }
  if (typeof json !== 'string') { fail('invalid', 'The result cannot be serialised'); return; }
  self.postMessage({ type: 'result', runId: d.runId, ok: true, json, cpuMs: performance.now() - t0 });
};
self.postMessage({ type: 'loaded' });
`

/** A Worker that has answered its last run and has nothing waiting is terminated after this long (see the script below). */
export const COMPUTE_IDLE_MS = 5_000

/**
 * The shell's one inline script. It posts `computeReady` to its parent and then takes, from its PARENT ONLY (an
 * opaque-origin document has no origin to name, so the parent window is the identity, POSTURE §5):
 *
 * - `computeInit { id, script, timeoutMs }`: one classic Worker per id, made from one Blob (the script with its one
 *   `export default` bound in a strict function scope, then the runner); an id already known is replaced.
 * - `computeRun { id, runId, input }`: runs the default export once the Worker has loaded; the latest run of an id
 *   waits while one is in flight and replaces any earlier waiting one (the host coalesces too).
 * - `computeDrop { id }`: terminates the Worker and forgets the id.
 *
 * It answers `computeResult { id, runId, ok: true, json, cpuMs }` or `{ ok: false, error: { code, message } }`.
 * A run past its budget TERMINATES the Worker and reports `timeout`; the next `computeRun` makes a new one (E4).
 * A Worker that does not load in time, or whose module throws while loading, reports `load` the same way. The shell
 * never evaluates the host's data as code (the input is a message, the script text a Blob the Worker parses), it holds
 * no credential (none is sent), and a result over the size cap is refused here before it crosses to the host.
 *
 * The bounds a script cannot talk its way out of (review of 35.5, F4 / F5):
 * - The load wait and the run budget are two timers. The script shares the Worker global with the runner, so it can
 *   post `{ type: 'loaded' }` itself; the first `loaded` of a Worker counts, every later one is ignored, and neither
 *   touches the run budget, so a script that announces itself loaded still dies at its budget.
 * - A Worker that has answered and has nothing waiting is terminated after `COMPUTE_IDLE_MS` and made again on the
 *   next run (a Blob Worker spawns in a few ms). A script that leaves a timer or a nested Worker spinning
 *   between runs therefore burns a core for at most that long, not for as long as the board is open.
 * - A Worker's `blob:` URL is revoked once it has loaded, or when it is killed before that; a respawn mints a fresh
 *   one. Nothing accumulates in the document across respawns.
 *
 * Written against the globals a sandboxed document has (`parent`, `addEventListener`, `Worker`, `Blob`, `URL`, the
 * timers), and nothing else, so a test can run it with fakes for those.
 */
export const COMPUTE_SHELL_SCRIPT = `(function(){
  var RUNNER=${JSON.stringify(COMPUTE_RUNNER_SOURCE).replace(/</g, '\\u003c')};
  var MAX_SCRIPT=${MAX_TRANSFORM_SCRIPT_CHARS},MIN_T=${TRANSFORM_MIN_TIMEOUT_MS},MAX_T=${TRANSFORM_MAX_TIMEOUT_MS},DEFAULT_T=${TRANSFORM_DEFAULT_TIMEOUT_MS},MAX_JSON=${MAX_TRANSFORM_OUTPUT_BYTES},LOAD_MS=${COMPUTE_LOAD_TIMEOUT_MS},IDLE_MS=${COMPUTE_IDLE_MS};
  var entries={};
  function reply(m){parent.postMessage(m,'*');}
  function fail(id,runId,code,message){reply({type:'computeResult',id:id,runId:runId,ok:false,error:{code:code,message:String(message||'').slice(0,500)}});}
  function clear(e,k){if(e[k]){clearTimeout(e[k]);e[k]=null;}}
  function release(e){var u=e.urls;e.urls=null;if(u)for(var i=0;i<u.length;i++)URL.revokeObjectURL(u[i]);}
  // A Chrome module Worker does not load in an opaque-origin document (blob: or data:, with or without an import; seen in
  // the running app, phase 35.6), a classic one does. So the script's ONE \`export default\` is bound to a local inside a
  // strict function scope (its top-level names stay its own) and the runner reads it from there; any other import or
  // export is refused as a load error. The text is still never evaluated by the shell: the Worker parses its Blob.
  var LOAD_TEXT='The script could not be loaded: check for a syntax error (only one export default, no import or other export)';
  function classic(script){
    var defaults=script.match(/^[ \\t]*export[ \\t]+default\\b/gm);
    if(!defaults||defaults.length!==1)return {error:'The script needs exactly one export default'};
    var body=script.replace(/^([ \\t]*)export[ \\t]+default\\b/m,'$1__nbDefault__ =');
    if(/^[ \\t]*(import|export)\\b/m.test(body))return {error:'The script may not import or export anything but its one export default'};
    return 'var m=(function(){\\'use strict\\';var __nbDefault__;\\n'+body+'\\n;return {default:__nbDefault__};})();\\n'+RUNNER;
  }
  function kill(e){clear(e,'loadTimer');clear(e,'runTimer');clear(e,'idleTimer');if(e.worker){e.worker.terminate();e.worker=null;}release(e);e.loaded=false;e.busy=null;}
  function idle(e){
    clear(e,'idleTimer');
    if(!e.worker||e.busy||e.pending)return;
    e.idleTimer=setTimeout(function(){e.idleTimer=null;if(!e.busy&&!e.pending)kill(e);},IDLE_MS);
  }
  function spawn(e){
    var src=classic(e.script);
    if(typeof src!=='string'){var q=e.pending;e.pending=null;if(q)fail(e.id,q.runId,'load',src.error);return;}
    var url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
    e.urls=[url];
    var w;
    try{w=new Worker(url);}catch(err){release(e);var p0=e.pending;e.pending=null;if(p0)fail(e.id,p0.runId,'load',(err&&err.message)||LOAD_TEXT);return;}
    e.worker=w;e.loaded=false;
    w.onerror=function(ev){var msg=(ev&&ev.message)||LOAD_TEXT;var run=e.busy;var p=e.pending;e.pending=null;kill(e);if(run)fail(e.id,run.runId,'load',msg);else if(p)fail(e.id,p.runId,'load',msg);};
    w.onmessage=function(ev){
      var d=ev.data;if(!d)return;
      if(d.type==='loaded'){if(e.loaded)return;e.loaded=true;clear(e,'loadTimer');release(e);flush(e);return;}
      if(d.type!=='result')return;
      var run=e.busy;if(!run||d.runId!==run.runId)return;
      clear(e,'runTimer');
      e.busy=null;
      if(d.ok===true){
        if(typeof d.json!=='string'||d.json.length>MAX_JSON)fail(e.id,run.runId,'invalid','the result is over the '+MAX_JSON+'-byte limit');
        else reply({type:'computeResult',id:e.id,runId:run.runId,ok:true,json:d.json,cpuMs:typeof d.cpuMs==='number'?d.cpuMs:0});
      }else fail(e.id,run.runId,(d.error&&d.error.code)||'throw',d.error&&d.error.message);
      flush(e);
    };
    e.loadTimer=setTimeout(function(){e.loadTimer=null;var p=e.pending;e.pending=null;kill(e);if(p)fail(e.id,p.runId,'load','The script did not load in time');},LOAD_MS);
  }
  function flush(e){
    if(!e.worker||!e.loaded||e.busy)return;
    if(!e.pending){idle(e);return;}
    clear(e,'idleTimer');
    var run=e.pending;e.pending=null;e.busy=run;
    e.worker.postMessage({type:'run',runId:run.runId,input:run.input});
    e.runTimer=setTimeout(function(){e.runTimer=null;var r=e.busy;kill(e);if(r)fail(e.id,r.runId,'timeout','The script ran past its '+e.timeoutMs+' ms budget');},e.timeoutMs);
  }
  addEventListener('message',function(ev){
    if(ev.source!==parent)return;
    var d=ev.data;
    if(!d||typeof d.type!=='string'||typeof d.id!=='string')return;
    if(d.type==='computeInit'){
      if(typeof d.script!=='string'||d.script.length>MAX_SCRIPT)return;
      var t=typeof d.timeoutMs==='number'&&isFinite(d.timeoutMs)?Math.min(MAX_T,Math.max(MIN_T,Math.round(d.timeoutMs))):DEFAULT_T;
      var old=entries[d.id];if(old)kill(old);
      var e=entries[d.id]={id:d.id,script:d.script,timeoutMs:t,worker:null,loaded:false,busy:null,pending:null,loadTimer:null,runTimer:null,idleTimer:null,urls:null};
      spawn(e);
      return;
    }
    if(d.type==='computeDrop'){var g=entries[d.id];if(g){kill(g);delete entries[d.id];}return;}
    if(d.type==='computeRun'){
      var r=entries[d.id];if(!r||typeof d.runId!=='string')return;
      r.pending={runId:d.runId,input:d.input};
      if(!r.worker)spawn(r);else flush(r);
    }
  });
  reply({type:'computeReady'});
})();`

/** The shell: one document, one inline script, the policy above. */
export const COMPUTE_FRAME_SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
${COMPUTE_SHELL_SCRIPT}
</script></body></html>`
