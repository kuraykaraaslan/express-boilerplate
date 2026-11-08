// modules/ui/ColorPicker/scripts/color-convert.js
//
// Zero-dependency color conversions for the M1 EJS ColorPicker.
// Mirrors modules/ui/ColorPicker/color/convert.ts in the NextJS sibling.

(function () {
  if (window.KuiColorConvert) return;

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }
  function round(n, digits) {
    digits = digits || 0;
    var m = Math.pow(10, digits);
    return Math.round(n * m) / m;
  }
  function toHex2(n) {
    var v = clamp(Math.round(n), 0, 255).toString(16);
    return v.length === 1 ? '0' + v : v;
  }

  // ─── HEX ↔ RGBA ───────────────────────────────────────────────────────────
  function hexToRgba(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (!s) return null;
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
    } else if (/^#[0-9a-fA-F]{4}$/.test(s)) {
      s = '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3] + s[4]+s[4];
    }
    if (/^#[0-9a-fA-F]{6}$/.test(s)) {
      return {
        r: parseInt(s.slice(1, 3), 16),
        g: parseInt(s.slice(3, 5), 16),
        b: parseInt(s.slice(5, 7), 16),
        a: 1,
      };
    }
    if (/^#[0-9a-fA-F]{8}$/.test(s)) {
      return {
        r: parseInt(s.slice(1, 3), 16),
        g: parseInt(s.slice(3, 5), 16),
        b: parseInt(s.slice(5, 7), 16),
        a: parseInt(s.slice(7, 9), 16) / 255,
      };
    }
    return null;
  }
  function rgbaToHex(c) {
    var r = toHex2(c.r), g = toHex2(c.g), b = toHex2(c.b);
    if (c.a >= 1) return ('#' + r + g + b).toLowerCase();
    return ('#' + r + g + b + toHex2(c.a * 255)).toLowerCase();
  }

  // ─── RGBA ↔ HSLA ──────────────────────────────────────────────────────────
  function rgbaToHsla(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min, h = 0;
    var l = (max + min) / 2;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: s * 100, l: l * 100, a: c.a };
  }
  function hslaToRgba(c) {
    var h = ((c.h % 360) + 360) % 360;
    var s = clamp(c.s, 0, 100) / 100;
    var l = clamp(c.l, 0, 100) / 100;
    function k(n) { return (n + h / 30) % 12; }
    var aSL = s * Math.min(l, 1 - l);
    function f(n) { return l - aSL * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); }
    return {
      r: Math.round(f(0) * 255),
      g: Math.round(f(8) * 255),
      b: Math.round(f(4) * 255),
      a: clamp(c.a, 0, 1),
    };
  }

  // ─── RGBA ↔ HWB ───────────────────────────────────────────────────────────
  function rgbaToHwb(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min, h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, w: min * 100, b: (1 - max) * 100, a: c.a };
  }
  function hsvToRgba(c) {
    var h = ((c.h % 360) + 360) % 360 / 60;
    var s = clamp(c.s, 0, 100) / 100;
    var v = clamp(c.v, 0, 100) / 100;
    var i = Math.floor(h), f = h - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var r=0, g=0, b=0;
    switch (i % 6) {
      case 0: r=v; g=t; b=p; break;
      case 1: r=q; g=v; b=p; break;
      case 2: r=p; g=v; b=t; break;
      case 3: r=p; g=q; b=v; break;
      case 4: r=t; g=p; b=v; break;
      case 5: r=v; g=p; b=q; break;
    }
    return {
      r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255),
      a: clamp(c.a, 0, 1),
    };
  }
  function hwbToRgba(c) {
    var w = clamp(c.w, 0, 100) / 100, bk = clamp(c.b, 0, 100) / 100;
    if (w + bk >= 1) {
      var gray = w / (w + bk), v = Math.round(gray * 255);
      return { r: v, g: v, b: v, a: clamp(c.a, 0, 1) };
    }
    var V = 1 - bk;
    var S = V === 0 ? 0 : 1 - w / V;
    return hsvToRgba({ h: c.h, s: S * 100, v: V * 100, a: c.a });
  }

  // ─── RGBA ↔ OKLCH ─────────────────────────────────────────────────────────
  function srgbToLinear(v) {
    var x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(v) {
    var x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return clamp(x * 255, 0, 255);
  }
  function rgbaToOklch(c) {
    var r = srgbToLinear(c.r), g = srgbToLinear(c.g), b = srgbToLinear(c.b);
    var l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    var A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    var B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    var chroma = Math.sqrt(A * A + B * B);
    var h = Math.atan2(B, A) * 180 / Math.PI;
    if (h < 0) h += 360;
    return { l: L, c: chroma, h: h, a: c.a };
  }
  function oklchToRgba(c) {
    var L = c.l;
    var hRad = c.h * Math.PI / 180;
    var A = c.c * Math.cos(hRad);
    var B = c.c * Math.sin(hRad);
    var l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    var m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    var s_ = L - 0.0894841775 * A - 1.2914855480 * B;
    var lc = l_*l_*l_, mc = m_*m_*m_, sc = s_*s_*s_;
    var r =  4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
    var g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
    var b = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
    return {
      r: Math.round(linearToSrgb(r)),
      g: Math.round(linearToSrgb(g)),
      b: Math.round(linearToSrgb(b)),
      a: clamp(c.a, 0, 1),
    };
  }

  // ─── Formatters ───────────────────────────────────────────────────────────
  function formatHex(c) { return rgbaToHex(c); }
  function formatRgba(c) {
    var r = clamp(Math.round(c.r), 0, 255);
    var g = clamp(Math.round(c.g), 0, 255);
    var b = clamp(Math.round(c.b), 0, 255);
    var a = clamp(c.a, 0, 1);
    return a >= 1 ? 'rgb(' + r + ', ' + g + ', ' + b + ')'
                  : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + round(a, 3) + ')';
  }
  function formatHsla(c) {
    var h = rgbaToHsla(c);
    var hue = round(h.h, 1), s = round(h.s, 1), l = round(h.l, 1), a = clamp(h.a, 0, 1);
    return a >= 1 ? 'hsl(' + hue + ', ' + s + '%, ' + l + '%)'
                  : 'hsla(' + hue + ', ' + s + '%, ' + l + '%, ' + round(a, 3) + ')';
  }
  function formatHwb(c) {
    var w = rgbaToHwb(c);
    var hue = round(w.h, 1), wh = round(w.w, 1), bk = round(w.b, 1), a = clamp(w.a, 0, 1);
    return a >= 1 ? 'hwb(' + hue + ' ' + wh + '% ' + bk + '%)'
                  : 'hwb(' + hue + ' ' + wh + '% ' + bk + '% / ' + round(a, 3) + ')';
  }
  function formatOklch(c) {
    var o = rgbaToOklch(c);
    var L = round(o.l, 4), ch = round(o.c, 4), hue = round(o.h, 2), a = clamp(o.a, 0, 1);
    return a >= 1 ? 'oklch(' + L + ' ' + ch + ' ' + hue + ')'
                  : 'oklch(' + L + ' ' + ch + ' ' + hue + ' / ' + round(a, 3) + ')';
  }

  function formatAs(c, fmt) {
    switch (fmt) {
      case 'hex':   return formatHex(c);
      case 'rgba':  return formatRgba(c);
      case 'hsla':  return formatHsla(c);
      case 'hwb':   return formatHwb(c);
      case 'oklch': return formatOklch(c);
    }
    return formatHex(c);
  }

  // ─── Parser ───────────────────────────────────────────────────────────────
  function parseAlpha(raw) {
    if (raw == null || raw === '') return 1;
    var s = String(raw).trim();
    if (s.charAt(s.length - 1) === '%') return clamp(parseFloat(s) / 100, 0, 1);
    var v = parseFloat(s);
    if (v > 1 && v <= 100) return clamp(v / 100, 0, 1);
    return clamp(v, 0, 1);
  }
  function parseColor(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (!s) return null;
    if (s.charAt(0) === '#' || /^[0-9a-fA-F]{3,8}$/.test(s)) {
      var hex = hexToRgba(s);
      if (hex) return hex;
    }
    var m;
    if (/^rgba?\(/i.test(s)) {
      m = s.match(/-?\d*\.?\d+\s*%?/g);
      if (!m || m.length < 3) return null;
      function ch(raw) {
        raw = raw.trim();
        return raw.charAt(raw.length - 1) === '%'
          ? clamp(parseFloat(raw) / 100 * 255, 0, 255)
          : clamp(parseFloat(raw), 0, 255);
      }
      return { r: ch(m[0]), g: ch(m[1]), b: ch(m[2]), a: parseAlpha(m[3]) };
    }
    if (/^hsla?\(/i.test(s)) {
      m = s.match(/^hsla?\(\s*(-?\d*\.?\d+)(?:deg)?[\s,]+(-?\d*\.?\d+)\s*%?[\s,]+(-?\d*\.?\d+)\s*%?\s*(?:[,/]\s*(-?\d*\.?\d+\s*%?))?\s*\)$/i);
      if (!m) return null;
      return hslaToRgba({ h: parseFloat(m[1]), s: clamp(parseFloat(m[2]), 0, 100), l: clamp(parseFloat(m[3]), 0, 100), a: parseAlpha(m[4]) });
    }
    if (/^hwb\(/i.test(s)) {
      m = s.match(/^hwb\(\s*(-?\d*\.?\d+)(?:deg)?\s+(-?\d*\.?\d+)\s*%?\s+(-?\d*\.?\d+)\s*%?\s*(?:[,/]\s*(-?\d*\.?\d+\s*%?))?\s*\)$/i);
      if (!m) return null;
      return hwbToRgba({ h: parseFloat(m[1]), w: clamp(parseFloat(m[2]), 0, 100), b: clamp(parseFloat(m[3]), 0, 100), a: parseAlpha(m[4]) });
    }
    if (/^oklch\(/i.test(s)) {
      m = s.match(/^oklch\(\s*(-?\d*\.?\d+\s*%?)\s+(-?\d*\.?\d+)\s+(-?\d*\.?\d+)(?:deg)?\s*(?:[,/]\s*(-?\d*\.?\d+\s*%?))?\s*\)$/i);
      if (!m) return null;
      var lRaw = m[1].trim();
      var L = lRaw.charAt(lRaw.length - 1) === '%' ? clamp(parseFloat(lRaw) / 100, 0, 1) : clamp(parseFloat(lRaw), 0, 1);
      return oklchToRgba({ l: L, c: clamp(parseFloat(m[2]), 0, 0.5), h: parseFloat(m[3]), a: parseAlpha(m[4]) });
    }
    return null;
  }

  function normalizeHex(s) {
    if (!s) return null;
    s = String(s).trim();
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = '#' + s[1]+s[1] + s[2]+s[2] + s[3]+s[3];
    }
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
  }

  window.KuiColorConvert = {
    hexToRgba: hexToRgba,
    rgbaToHex: rgbaToHex,
    rgbaToHsla: rgbaToHsla,
    hslaToRgba: hslaToRgba,
    rgbaToHwb: rgbaToHwb,
    hwbToRgba: hwbToRgba,
    rgbaToOklch: rgbaToOklch,
    oklchToRgba: oklchToRgba,
    formatAs: formatAs,
    parseColor: parseColor,
    normalizeHex: normalizeHex,
    clamp: clamp,
  };
})();
