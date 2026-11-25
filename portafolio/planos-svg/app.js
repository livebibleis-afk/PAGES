/* Planos SVG — editor táctil de planos de planta.
   Muros con espesor y snapping, puertas/ventanas, cotas, textos,
   deshacer/rehacer, foto de fondo con calibración de 2 puntos. */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var STORE = 'planos-svg-doc-v1';
  var GRID = 0.05;
  var MIN_LEN = 0.02;

  var stage = document.getElementById('stage');
  var hintEl = document.getElementById('hint');
  var propsEl = document.getElementById('props');
  var propsBody = document.getElementById('props-body');
  var lengthInput = document.getElementById('input-length');
  var orthoChk = document.getElementById('chk-ortho');
  var autoDimChk = document.getElementById('chk-auto-dim');
  var gridChk = document.getElementById('chk-grid');
  var opacityRng = document.getElementById('rng-opacity');
  var opacityVal = document.getElementById('opacity-val');

  var tool = 'select';
  var seq = 1;
  var view = { x: 2.5, y: 2.5, scale: 70 };
  var doc = emptyDoc();
  var selected = null; /* { kind, id, handle? } */
  var history = [];
  var future = [];
  var ignoreSave = false;
  var startPt = null;
  var previewPt = null;
  var pointers = new Map();
  var pinch = null;
  var pan = null;
  var drag = null;
  var calibPts = [];

  function uid(prefix) { return (prefix || 'id') + '_' + (seq++); }

  function emptyDoc() {
    return {
      version: 1,
      grid: GRID,
      autoDimensions: true,
      showGrid: true,
      background: null,
      walls: [],
      openings: [],
      dimensions: [],
      labels: []
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function setHint(t) { hintEl.textContent = t || ''; }

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }

  function mul(a, s) { return { x: a.x * s, y: a.y * s }; }

  function unit(a, b) {
    var d = dist(a, b) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  }

  function perp(u) { return { x: -u.y, y: u.x }; }

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmt(m) { return (Math.round(m * 100) / 100).toFixed(2); }

  function parseLen(s) {
    if (s == null) return NaN;
    var t = String(s).trim().replace(',', '.').replace(/[^\d.\-]/g, '');
    var n = parseFloat(t);
    return isFinite(n) && n > 0 ? n : NaN;
  }

  function wallEnds(w) { return { a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 } }; }

  function wallLen(w) { return dist({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); }

  function wallAt(w, t) {
    return { x: w.x1 + (w.x2 - w.x1) * t, y: w.y1 + (w.y2 - w.y1) * t };
  }

  function projectT(w, p) {
    var dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    var l2 = dx * dx + dy * dy;
    if (!l2) return 0;
    return (dx * (p.x - w.x1) + dy * (p.y - w.y1)) / l2;
  }

  function distToSeg(w, p) {
    var t = clamp(projectT(w, p), 0, 1);
    var q = wallAt(w, t);
    return { t: t, point: q, dist: dist(p, q) };
  }

  function findById(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function pushHistory() {
    history.push(clone(doc));
    if (history.length > 60) history.shift();
    future = [];
    updateHistoryButtons();
  }

  function undo() {
    if (!history.length) return;
    future.push(clone(doc));
    doc = history.pop();
    selected = null;
    render();
    persist();
    updateHistoryButtons();
    updateProps();
  }

  function redo() {
    if (!future.length) return;
    history.push(clone(doc));
    doc = future.pop();
    selected = null;
    render();
    persist();
    updateHistoryButtons();
    updateProps();
  }

  function updateHistoryButtons() {
    document.getElementById('btn-undo').disabled = !history.length;
    document.getElementById('btn-redo').disabled = !future.length;
    document.getElementById('btn-delete').disabled = !selected;
  }

  /* ---------- view / snap ---------- */

  function svgSize() {
    var r = stage.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }

  function screenToWorld(cx, cy) {
    var s = svgSize();
    return {
      x: (cx - s.left - s.w / 2) / view.scale + view.x,
      y: (cy - s.top - s.h / 2) / view.scale + view.y
    };
  }

  function worldToScreen(p) {
    var s = svgSize();
    return {
      x: (p.x - view.x) * view.scale + s.w / 2,
      y: (p.y - view.y) * view.scale + s.h / 2
    };
  }

  function snapThreshold() { return 14 / view.scale; }

  function snapPoint(p, from) {
    var best = { x: p.x, y: p.y, d: Infinity, kind: 'raw' };
    function consider(q, kind) {
      var d = dist(p, q);
      if (d < best.d) best = { x: q.x, y: q.y, d: d, kind: kind };
    }
    if (doc.showGrid !== false) {
      var g = doc.grid || GRID;
      consider({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }, 'grid');
    }
    var i, w, ends;
    for (i = 0; i < doc.walls.length; i++) {
      w = doc.walls[i];
      consider({ x: w.x1, y: w.y1 }, 'end');
      consider({ x: w.x2, y: w.y2 }, 'end');
      consider(mid({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }), 'mid');
    }
    if (from) {
      consider({ x: p.x, y: from.y }, 'axis');
      consider({ x: from.x, y: p.y }, 'axis');
    }
    var th = snapThreshold();
    if (best.d <= th) {
      if (from && orthoChk.checked && (best.kind === 'grid' || best.kind === 'raw' || best.kind === 'axis')) {
        return applyOrtho(from, { x: best.x, y: best.y });
      }
      return { x: best.x, y: best.y };
    }
    if (from && orthoChk.checked) return applyOrtho(from, p);
    return { x: p.x, y: p.y };
  }

  function applyOrtho(from, p) {
    if (Math.abs(p.x - from.x) >= Math.abs(p.y - from.y)) return { x: p.x, y: from.y };
    return { x: from.x, y: p.y };
  }

  /* ---------- mutations ---------- */

  function setWallLength(w, length, fromStart) {
    var a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
    var u = unit(a, b);
    if (fromStart === false) {
      w.x1 = b.x - u.x * length;
      w.y1 = b.y - u.y * length;
    } else {
      w.x2 = a.x + u.x * length;
      w.y2 = a.y + u.y * length;
    }
  }

  function addWall(x1, y1, x2, y2, thickness) {
    if (Math.hypot(x2 - x1, y2 - y1) < MIN_LEN) return null;
    var w = { id: uid('w'), x1: x1, y1: y1, x2: x2, y2: y2, thickness: thickness || 0.15 };
    doc.walls.push(w);
    return w;
  }

  function addOpening(type, wallId, t, width) {
    var w = findById(doc.walls, wallId);
    if (!w) return null;
    var L = wallLen(w);
    var wd = width || (type === 'door' ? 0.8 : 1.2);
    if (L <= wd + 0.02) return null;
    var half = wd / 2 / L;
    t = clamp(t, half + 0.001, 1 - half - 0.001);
    var o = { id: uid(type === 'door' ? 'd' : 'v'), type: type, wallId: wallId, t: t, width: wd, hinge: 0 };
    doc.openings.push(o);
    return o;
  }

  function openingsOn(wallId) {
    return doc.openings.filter(function (o) { return o.wallId === wallId; });
  }

  function deleteSelected() {
    if (!selected) return;
    pushHistory();
    var id = selected.id, kind = selected.kind;
    if (kind === 'wall') {
      doc.walls = doc.walls.filter(function (w) { return w.id !== id; });
      doc.openings = doc.openings.filter(function (o) { return o.wallId !== id; });
    } else if (kind === 'opening') {
      doc.openings = doc.openings.filter(function (o) { return o.id !== id; });
    } else if (kind === 'dim') {
      doc.dimensions = doc.dimensions.filter(function (d) { return d.id !== id; });
    } else if (kind === 'label') {
      doc.labels = doc.labels.filter(function (l) { return l.id !== id; });
    }
    selected = null;
    render();
    persist();
    updateProps();
    updateHistoryButtons();
  }

  /* ---------- hit test ---------- */

  function hitTest(p) {
    var tol = snapThreshold();
    var i, w, o, d, lab, h, pr, L, half;
    if (selected && selected.kind === 'wall') {
      w = findById(doc.walls, selected.id);
      if (w) {
        if (dist(p, { x: w.x1, y: w.y1 }) <= tol * 1.2) return { kind: 'wall', id: w.id, handle: 'a' };
        if (dist(p, { x: w.x2, y: w.y2 }) <= tol * 1.2) return { kind: 'wall', id: w.id, handle: 'b' };
      }
    }
    for (i = doc.labels.length - 1; i >= 0; i--) {
      lab = doc.labels[i];
      if (dist(p, { x: lab.x, y: lab.y }) <= Math.max(0.3, tol * 1.4)) return { kind: 'label', id: lab.id };
    }
    for (i = doc.dimensions.length - 1; i >= 0; i--) {
      d = doc.dimensions[i];
      if (distToSeg({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, p).dist <= tol) return { kind: 'dim', id: d.id };
    }
    for (i = doc.openings.length - 1; i >= 0; i--) {
      o = doc.openings[i];
      w = findById(doc.walls, o.wallId);
      if (!w) continue;
      L = wallLen(w);
      half = (o.width / 2) / L;
      pr = distToSeg(w, p);
      if (pr.dist <= Math.max(w.thickness / 2, tol) && Math.abs(pr.t - o.t) <= half + 0.02) {
        return { kind: 'opening', id: o.id };
      }
    }
    var bestW = null, bestD = tol * 1.15;
    for (i = 0; i < doc.walls.length; i++) {
      w = doc.walls[i];
      pr = distToSeg(w, p);
      h = Math.max(w.thickness / 2, tol);
      if (pr.dist <= h && pr.dist < bestD) { bestD = pr.dist; bestW = w; }
    }
    if (bestW) return { kind: 'wall', id: bestW.id };
    return null;
  }

  function nearestWall(p) {
    var best = null, bestD = Infinity, i, w, pr;
    for (i = 0; i < doc.walls.length; i++) {
      w = doc.walls[i];
      pr = distToSeg(w, p);
      if (pr.dist < bestD) { bestD = pr.dist; best = { wall: w, t: clamp(pr.t, 0, 1), dist: pr.dist }; }
    }
    return best && best.dist <= Math.max(0.4, snapThreshold() * 2) ? best : null;
  }

  /* ---------- render ---------- */

  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    });
    return n;
  }

  function viewTransform() {
    var s = svgSize();
    return 'translate(' + (s.w / 2) + ',' + (s.h / 2) + ') scale(' + view.scale + ') translate(' + (-view.x) + ',' + (-view.y) + ')';
  }

  function wallSegments(w) {
    var L = wallLen(w);
    if (L < MIN_LEN) return [];
    var cuts = openingsOn(w.id).map(function (o) {
      var half = o.width / 2 / L;
      return { a: clamp(o.t - half, 0, 1), b: clamp(o.t + half, 0, 1) };
    }).sort(function (a, b) { return a.a - b.a; });
    var segs = [], t = 0, i, c;
    for (i = 0; i < cuts.length; i++) {
      c = cuts[i];
      if (c.a > t + 0.0005) segs.push([t, c.a]);
      t = Math.max(t, c.b);
    }
    if (t < 1 - 0.0005) segs.push([t, 1]);
    return segs;
  }

  function wallPolygon(w, t0, t1) {
    var a = wallAt(w, t0), b = wallAt(w, t1);
    var u = unit(a, b);
    var n = mul(perp(u), w.thickness / 2);
    var p1 = add(a, n), p2 = add(b, n), p3 = sub(b, n), p4 = sub(a, n);
    return [p1, p2, p3, p4].map(function (p) { return p.x + ',' + p.y; }).join(' ');
  }

  function renderGrid(g) {
    if (doc.showGrid === false) return;
    var s = svgSize();
    var wMin = screenToWorld(s.left, s.top);
    var wMax = screenToWorld(s.left + s.w, s.top + s.h);
    var x0 = Math.min(wMin.x, wMax.x), x1 = Math.max(wMin.x, wMax.x);
    var y0 = Math.min(wMin.y, wMax.y), y1 = Math.max(wMin.y, wMax.y);
    var major = 1, minor = 0.2;
    if (view.scale < 30) minor = 1;
    function lines(step, color, width) {
      var x = Math.floor(x0 / step) * step;
      for (; x <= x1; x += step) g.appendChild(el('line', { x1: x, y1: y0, x2: x, y2: y1, stroke: color, 'stroke-width': width, 'vector-effect': 'non-scaling-stroke' }));
      var y = Math.floor(y0 / step) * step;
      for (; y <= y1; y += step) g.appendChild(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: color, 'stroke-width': width, 'vector-effect': 'non-scaling-stroke' }));
    }
    lines(minor, '#e4ddd0', 1);
    lines(major, '#d4cbb8', 1);
  }


  function arrowHead(parent, from, to, color) {
    var u = unit(from, to);
    var n = perp(u);
    var size = Math.max(0.07, 7 / view.scale);
    var base = { x: to.x - u.x * size, y: to.y - u.y * size };
    var p1 = { x: base.x + n.x * size * 0.38, y: base.y + n.y * size * 0.38 };
    var p2 = { x: base.x - n.x * size * 0.38, y: base.y - n.y * size * 0.38 };
    parent.appendChild(el('polygon', {
      points: to.x + ',' + to.y + ' ' + p1.x + ',' + p1.y + ' ' + p2.x + ',' + p2.y,
      fill: color
    }));
  }

  function renderDimLine(parent, a, b, offset, text, highlight) {
    var u = unit(a, b);
    var n = perp(u);
    var off = mul(n, offset);
    var a2 = add(a, off), b2 = add(b, off);
    var ext = 0.08;
    var color = highlight ? '#2563eb' : '#b42318';
    var sw = 1.25 / view.scale;
    parent.appendChild(el('line', { x1: a.x, y1: a.y, x2: a2.x, y2: a2.y, stroke: color, 'stroke-width': sw }));
    parent.appendChild(el('line', { x1: b.x, y1: b.y, x2: b2.x, y2: b2.y, stroke: color, 'stroke-width': sw }));
    parent.appendChild(el('line', { x1: a2.x, y1: a2.y, x2: b2.x, y2: b2.y, stroke: color, 'stroke-width': sw }));
    arrowHead(parent, b2, a2, color);
    arrowHead(parent, a2, b2, color);
    var c = mid(a2, b2);
    var ang = Math.atan2(u.y, u.x) * 180 / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    var fs = Math.max(0.16, 12 / view.scale);
    var t = el('text', {
      x: c.x, y: c.y, fill: color,
      'font-size': fs,
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      transform: 'rotate(' + ang + ' ' + c.x + ' ' + c.y + ') translate(0 ' + (-fs * 0.7) + ')'
    });
    t.textContent = text;
    parent.appendChild(t);
  }

  function render() {
    var s = svgSize();
    stage.setAttribute('viewBox', '0 0 ' + s.w + ' ' + s.h);
    stage.innerHTML = '';
    var defs = el('defs');
    var m = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
    m.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#b42318' }));
    defs.appendChild(m);
    stage.appendChild(defs);
    var root = el('g', { id: 'world', transform: viewTransform() });
    var gridG = el('g', { id: 'grid' });
    renderGrid(gridG);
    root.appendChild(gridG);

    if (doc.background && doc.background.src) {
      var bg = doc.background;
      var img = el('image', {
        href: bg.src,
        x: bg.x, y: bg.y, width: bg.width, height: bg.height,
        opacity: bg.opacity == null ? 0.45 : bg.opacity,
        preserveAspectRatio: 'none'
      });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', bg.src);
      root.appendChild(img);
    }

    var wallsG = el('g', { id: 'walls' });
    doc.walls.forEach(function (w) {
      var hi = selected && selected.kind === 'wall' && selected.id === w.id;
      wallSegments(w).forEach(function (seg) {
        wallsG.appendChild(el('polygon', {
          points: wallPolygon(w, seg[0], seg[1]),
          fill: hi ? '#1d4ed8' : '#1c1914',
          stroke: hi ? '#60a5fa' : 'none',
          'stroke-width': hi ? (1 / view.scale) : 0
        }));
      });
    });
    root.appendChild(wallsG);

    var openG = el('g', { id: 'openings' });
    doc.openings.forEach(function (o) {
      var w = findById(doc.walls, o.wallId);
      if (!w) return;
      var L = wallLen(w);
      if (!L) return;
      var a = wallAt(w, o.t - o.width / 2 / L);
      var b = wallAt(w, o.t + o.width / 2 / L);
      var u = unit({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      var n = perp(u);
      var hi = selected && selected.kind === 'opening' && selected.id === o.id;
      var sw = 1.5 / view.scale;
      var color = hi ? '#2563eb' : '#1c1914';
      if (o.type === 'window') {
        var inset = mul(n, w.thickness * 0.22);
        openG.appendChild(el('line', { x1: a.x + inset.x, y1: a.y + inset.y, x2: b.x + inset.x, y2: b.y + inset.y, stroke: '#2b6cb0', 'stroke-width': sw }));
        openG.appendChild(el('line', { x1: a.x - inset.x, y1: a.y - inset.y, x2: b.x - inset.x, y2: b.y - inset.y, stroke: '#2b6cb0', 'stroke-width': sw }));
        openG.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': sw * 0.8 }));
      } else {
        var hinge = o.hinge ? b : a;
        var swingDir = o.hinge ? -1 : 1;
        var leafEnd = add(hinge, mul(n, o.width * swingDir));
        var r = o.width;
        var startAng = Math.atan2(u.y, u.x);
        if (o.hinge) startAng += Math.PI;
        var midAng = startAng + (swingDir > 0 ? -Math.PI / 4 : Math.PI / 4);
        /* 90° arc from wall direction toward n */
        var from = o.hinge ? { x: -u.x, y: -u.y } : u;
        /* leaf lies along +n or -n from hinge; arc from along-wall to leaf */
        var wallDir = o.hinge ? { x: -u.x, y: -u.y } : u;
        var leafDir = mul(n, swingDir);
        var a1 = Math.atan2(wallDir.y, wallDir.x);
        var a2 = Math.atan2(leafDir.y, leafDir.x);
        var large = 0;
        var sweep = (a2 - a1 + Math.PI * 3) % (Math.PI * 2) > Math.PI ? 0 : 1;
        if (swingDir < 0) sweep = 1 - sweep;
        /* Use two-line door: jamb + 90° leaf + light arc */
        var sx = hinge.x + Math.cos(a1) * r;
        var sy = hinge.y + Math.sin(a1) * r;
        /* start of arc should be the other jamb? Actually start is along wall to the opening edge that is not the hinge — that's the other point */
        var other = o.hinge ? a : b;
        var arc = 'M ' + other.x + ' ' + other.y + ' A ' + r + ' ' + r + ' 0 0 ' + (swingDir > 0 ? 1 : 0) + ' ' + leafEnd.x + ' ' + leafEnd.y;
        openG.appendChild(el('path', { d: arc, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-dasharray': (4 / view.scale) + ' ' + (3 / view.scale) }));
        openG.appendChild(el('line', { x1: hinge.x, y1: hinge.y, x2: leafEnd.x, y2: leafEnd.y, stroke: color, 'stroke-width': sw }));
        openG.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': sw * 0.6, 'stroke-dasharray': (3 / view.scale) + ' ' + (2 / view.scale) }));
      }
    });
    root.appendChild(openG);

    var dimG = el('g', { id: 'dims' });
    if (doc.autoDimensions) {
      doc.walls.forEach(function (w) {
        var a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
        if (dist(a, b) < 0.15) return;
        renderDimLine(dimG, a, b, Math.max(0.35, w.thickness / 2 + 0.28), fmt(dist(a, b)), false);
      });
    }
    doc.dimensions.forEach(function (d) {
      var a = { x: d.x1, y: d.y1 }, b = { x: d.x2, y: d.y2 };
      var hi = selected && selected.kind === 'dim' && selected.id === d.id;
      renderDimLine(dimG, a, b, d.offset || 0.4, fmt(dist(a, b)), hi);
    });
    root.appendChild(dimG);

    var labG = el('g', { id: 'labels' });
    doc.labels.forEach(function (lab) {
      var hi = selected && selected.kind === 'label' && selected.id === lab.id;
      var fs = Math.max(0.22, 14 / view.scale);
      if (hi) labG.appendChild(el('rect', {
        x: lab.x - 0.1, y: lab.y - fs, width: Math.max(0.8, (lab.text || '').length * fs * 0.55), height: fs * 1.4,
        fill: '#dbeafe', stroke: '#2563eb', 'stroke-width': 1 / view.scale, rx: 0.05
      }));
      var t = el('text', {
        x: lab.x, y: lab.y, fill: '#1c1914',
        'font-size': fs,
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'dominant-baseline': 'middle'
      });
      t.textContent = lab.text || '';
      labG.appendChild(t);
    });
    root.appendChild(labG);

    if (startPt && previewPt) {
      var prev = el('g', { id: 'preview' });
      prev.appendChild(el('line', {
        x1: startPt.x, y1: startPt.y, x2: previewPt.x, y2: previewPt.y,
        stroke: '#2563eb', 'stroke-width': 2 / view.scale, 'stroke-dasharray': (8 / view.scale) + ' ' + (5 / view.scale)
      }));
      var L = dist(startPt, previewPt);
      var c = mid(startPt, previewPt);
      var tx = el('text', { x: c.x, y: c.y - 10 / view.scale, fill: '#1d4ed8', 'font-size': 13 / view.scale, 'text-anchor': 'middle', 'font-family': 'ui-sans-serif, system-ui, sans-serif' });
      tx.textContent = fmt(L) + ' m';
      prev.appendChild(tx);
      root.appendChild(prev);
    }

    if (calibPts.length) {
      calibPts.forEach(function (p) {
        root.appendChild(el('circle', { cx: p.x, cy: p.y, r: 6 / view.scale, fill: '#f59e0b', stroke: '#fff', 'stroke-width': 2 / view.scale }));
      });
      if (calibPts.length === 2) {
        root.appendChild(el('line', { x1: calibPts[0].x, y1: calibPts[0].y, x2: calibPts[1].x, y2: calibPts[1].y, stroke: '#f59e0b', 'stroke-width': 2 / view.scale }));
      }
    }

    if (selected && selected.kind === 'wall') {
      var sw = findById(doc.walls, selected.id);
      if (sw) {
        var hr = 6 / view.scale;
        [['a', sw.x1, sw.y1], ['b', sw.x2, sw.y2]].forEach(function (h) {
          root.appendChild(el('circle', { cx: h[1], cy: h[2], r: hr, fill: '#fff', stroke: '#2563eb', 'stroke-width': 2 / view.scale, 'data-handle': h[0] }));
        });
      }
    }

    stage.appendChild(root);
  }

  /* ---------- props / tools ---------- */

  function currentLengthTarget() {
    if (selected && selected.kind === 'wall') return findById(doc.walls, selected.id);
    return null;
  }

  function updateProps() {
    updateHistoryButtons();
    propsBody.innerHTML = '';
    if (!selected) {
      propsEl.hidden = true;
      return;
    }
    propsEl.hidden = false;
    var html = '';
    if (selected.kind === 'wall') {
      var w = findById(doc.walls, selected.id);
      if (!w) { propsEl.hidden = true; return; }
      lengthInput.value = fmt(wallLen(w));
      html += '<label>Espesor (m) <input id="input-th" type="text" inputmode="decimal" value="' + fmt(w.thickness) + '"></label>';
      html += '<button type="button" class="btn" id="btn-apply-th">Espesor</button>';
    } else if (selected.kind === 'opening') {
      var o = findById(doc.openings, selected.id);
      if (!o) { propsEl.hidden = true; return; }
      lengthInput.value = fmt(o.width);
      html += '<span class="chk">' + (o.type === 'door' ? 'Puerta' : 'Ventana') + ' · ancho en Largo</span>';
      if (o.type === 'door') html += '<button type="button" class="btn" id="btn-flip">Invertir giro</button>';
    } else if (selected.kind === 'label') {
      var lab = findById(doc.labels, selected.id);
      if (!lab) { propsEl.hidden = true; return; }
      html += '<label>Texto <input id="input-label" type="text" value="' + String(lab.text || '').replace(/"/g, '&quot;') + '"></label>';
    } else if (selected.kind === 'dim') {
      var d = findById(doc.dimensions, selected.id);
      if (!d) { propsEl.hidden = true; return; }
      lengthInput.value = fmt(dist({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }));
      html += '<span class="chk">Cota manual</span>';
    }
    propsBody.innerHTML = html;
    var thBtn = document.getElementById('btn-apply-th');
    if (thBtn) thBtn.addEventListener('click', applyThickness);
    var flip = document.getElementById('btn-flip');
    if (flip) flip.addEventListener('click', function () {
      var o2 = findById(doc.openings, selected.id);
      if (!o2) return;
      pushHistory();
      o2.hinge = o2.hinge ? 0 : 1;
      render(); persist();
    });
    var labIn = document.getElementById('input-label');
    if (labIn) labIn.addEventListener('change', function () {
      var l2 = findById(doc.labels, selected.id);
      if (!l2) return;
      pushHistory();
      l2.text = labIn.value;
      render(); persist();
    });
  }

  function applyThickness() {
    var w = currentLengthTarget();
    var inp = document.getElementById('input-th');
    if (!w || !inp) return;
    var n = parseLen(inp.value);
    if (!isFinite(n) || n < 0.05 || n > 1.2) return;
    pushHistory();
    w.thickness = n;
    render(); persist();
  }

  function applyLength() {
    var n = parseLen(lengthInput.value);
    if (!isFinite(n)) { setHint('Escribe un largo válido en metros, por ejemplo 4.50'); return; }
    if (startPt && tool === 'wall') {
      var dir = previewPt || { x: startPt.x + n, y: startPt.y };
      if (orthoChk.checked) dir = applyOrtho(startPt, dir);
      var u = unit(startPt, dist(startPt, dir) < MIN_LEN ? { x: startPt.x + 1, y: startPt.y } : dir);
      pushHistory();
      var w = addWall(startPt.x, startPt.y, startPt.x + u.x * n, startPt.y + u.y * n);
      startPt = w ? { x: w.x2, y: w.y2 } : null;
      previewPt = null;
      selected = w ? { kind: 'wall', id: w.id } : null;
      render(); persist(); updateProps();
      setHint('Muro de ' + fmt(n) + ' m. Sigue tocando para encadenar, o cambia a Seleccionar.');
      return;
    }
    if (selected && selected.kind === 'wall') {
      var wall = findById(doc.walls, selected.id);
      if (!wall) return;
      pushHistory();
      setWallLength(wall, n, selected.handle !== 'a');
      render(); persist(); updateProps();
      return;
    }
    if (selected && selected.kind === 'opening') {
      var o = findById(doc.openings, selected.id);
      var w2 = o && findById(doc.walls, o.wallId);
      if (!o || !w2) return;
      if (n >= wallLen(w2) - 0.02) { setHint('Ese ancho no cabe en el muro.'); return; }
      pushHistory();
      o.width = n;
      var half = n / 2 / wallLen(w2);
      o.t = clamp(o.t, half + 0.001, 1 - half - 0.001);
      render(); persist(); updateProps();
      return;
    }
    if (tool === 'calibrate' && calibPts.length === 2) {
      applyCalibration(n);
    }
  }

  function applyCalibration(realLen) {
    if (calibPts.length < 2 || !doc.background) return;
    var D = dist(calibPts[0], calibPts[1]);
    if (D < 1e-6) { setHint('Los dos puntos están demasiado juntos.'); return; }
    var factor = realLen / D;
    var A = calibPts[0];
    var bg = doc.background;
    pushHistory();
    bg.x = A.x + (bg.x - A.x) * factor;
    bg.y = A.y + (bg.y - A.y) * factor;
    bg.width *= factor;
    bg.height *= factor;
    calibPts = [];
    startPt = null;
    previewPt = null;
    render(); persist();
    setHint('Escala ajustada: esos puntos miden ' + fmt(realLen) + ' m. Ya puedes trazar muros encima.');
  }

  function setTool(name) {
    tool = name;
    startPt = null;
    previewPt = null;
    calibPts = [];
    document.querySelectorAll('.tool').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-tool') === name ? 'true' : 'false');
    });
    var hints = {
      select: 'Toca un elemento para seleccionarlo. Arrastra para moverlo. Dos dedos: zoom.',
      wall: 'Toca el inicio y el final del muro, o arrastra. Escribe el largo y pulsa Aplicar.',
      door: 'Toca un muro para colocar una puerta. Luego puedes cambiar su ancho.',
      window: 'Toca un muro para colocar una ventana.',
      dim: 'Toca dos puntos para una cota manual.',
      label: 'Toca donde quieras un texto.',
      calibrate: 'Toca dos puntos sobre la foto y escribe la distancia real en Largo.'
    };
    setHint(hints[name] || '');
    render();
  }

  /* ---------- pointer ---------- */

  function onDown(e) {
    if (e.target.closest && e.target.closest('header, nav, #props, #length-bar, #menu, aside')) return;
    e.preventDefault();
    var id = e.pointerId;
    pointers.set(id, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinch = {
        dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        scale: view.scale, vx: view.x, vy: view.y
      };
      var midW = screenToWorld(pinch.mid.x, pinch.mid.y);
      pinch.world = midW;
      drag = null;
      pan = null;
      return;
    }
    var p = snapPoint(screenToWorld(e.clientX, e.clientY), startPt);
    var raw = screenToWorld(e.clientX, e.clientY);

    if (tool === 'select') {
      var hit = hitTest(raw);
      if (hit) {
        selected = hit;
        var orig = null;
        if (hit.kind === 'wall') orig = clone(findById(doc.walls, hit.id));
        if (hit.kind === 'opening') orig = clone(findById(doc.openings, hit.id));
        if (hit.kind === 'label') orig = clone(findById(doc.labels, hit.id));
        if (hit.kind === 'dim') orig = clone(findById(doc.dimensions, hit.id));
        drag = { id: id, kind: hit.kind, itemId: hit.id, handle: hit.handle || null, start: raw, orig: orig, moved: false, hist: false };
        updateProps();
        render();
      } else {
        selected = null;
        updateProps();
        pan = { id: id, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        render();
      }
      return;
    }

    if (tool === 'wall') {
      if (!startPt) {
        startPt = p;
        previewPt = p;
        setHint('Ahora toca el otro extremo, o escribe el largo exacto y pulsa Aplicar.');
        render();
      } else {
        drag = { id: id, kind: 'draw-wall', start: startPt, moved: false };
      }
      return;
    }

    if (tool === 'dim') {
      if (!startPt) { startPt = p; previewPt = p; render(); }
      else drag = { id: id, kind: 'draw-dim', start: startPt, moved: false };
      return;
    }

    if (tool === 'calibrate') {
      if (calibPts.length >= 2) calibPts = [];
      calibPts.push(p);
      if (calibPts.length === 1) setHint('Toca el segundo punto de la medida conocida.');
      if (calibPts.length === 2) {
        lengthInput.value = '';
        lengthInput.focus();
        setHint('Escribe la distancia real en metros (Largo) y pulsa Aplicar.');
      }
      render();
      return;
    }

    if (tool === 'door' || tool === 'window') {
      var nw = nearestWall(raw);
      if (!nw) { setHint('Toca más cerca de un muro.'); return; }
      pushHistory();
      var o = addOpening(tool, nw.wall.id, nw.t);
      selected = o ? { kind: 'opening', id: o.id } : null;
      render(); persist(); updateProps();
      return;
    }

    if (tool === 'label') {
      var text = window.prompt('Texto de la etiqueta:', 'Ambiente');
      if (text == null) return;
      text = String(text).trim();
      if (!text) return;
      pushHistory();
      var lab = { id: uid('t'), x: p.x, y: p.y, text: text };
      doc.labels.push(lab);
      selected = { kind: 'label', id: lab.id };
      render(); persist(); updateProps();
    }
  }

  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    else if (e.pointerType && e.pointerType !== 'mouse') return;
    if (pinch && pointers.size >= 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (pinch.dist > 0) {
        var ns = clamp(pinch.scale * (d / pinch.dist), 12, 400);
        var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        view.scale = ns;
        /* keep pinch.world under the midpoint */
        var s = svgSize();
        view.x = pinch.world.x - (mid.x - s.left - s.w / 2) / view.scale;
        view.y = pinch.world.y - (mid.y - s.top - s.h / 2) / view.scale;
        render();
      }
      return;
    }
    if (pan && pan.id === e.pointerId) {
      view.x = pan.vx - (e.clientX - pan.x) / view.scale;
      view.y = pan.vy - (e.clientY - pan.y) / view.scale;
      render();
      return;
    }
    var raw = screenToWorld(e.clientX, e.clientY);
    var p = snapPoint(raw, startPt || (drag && drag.start));
    if (drag && drag.kind === 'draw-wall') {
      previewPt = p;
      lengthInput.value = fmt(dist(startPt, previewPt));
      render();
      return;
    }
    if (drag && drag.kind === 'draw-dim') {
      previewPt = p;
      lengthInput.value = fmt(dist(startPt, previewPt));
      render();
      return;
    }
    if (startPt && (tool === 'wall' || tool === 'dim') && !drag) {
      previewPt = p;
      lengthInput.value = fmt(dist(startPt, previewPt));
      render();
      return;
    }
    if (drag && drag.orig) {
      var dx = raw.x - drag.start.x, dy = raw.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.scale < 4) return;
      if (!drag.hist) { pushHistory(); drag.hist = true; }
      drag.moved = true;
      if (drag.kind === 'wall') {
        var w = findById(doc.walls, drag.itemId);
        if (!w) return;
        if (drag.handle === 'a') {
          var q = snapPoint(raw, { x: w.x2, y: w.y2 });
          w.x1 = q.x; w.y1 = q.y;
        } else if (drag.handle === 'b') {
          var q2 = snapPoint(raw, { x: w.x1, y: w.y1 });
          w.x2 = q2.x; w.y2 = q2.y;
        } else {
          w.x1 = drag.orig.x1 + dx; w.y1 = drag.orig.y1 + dy;
          w.x2 = drag.orig.x2 + dx; w.y2 = drag.orig.y2 + dy;
        }
      } else if (drag.kind === 'opening') {
        var o = findById(doc.openings, drag.itemId);
        var ww = o && findById(doc.walls, o.wallId);
        if (o && ww) {
          var t = projectT(ww, raw);
          var half = o.width / 2 / wallLen(ww);
          o.t = clamp(t, half + 0.001, 1 - half - 0.001);
        }
      } else if (drag.kind === 'label') {
        var lab = findById(doc.labels, drag.itemId);
        if (lab) { lab.x = drag.orig.x + dx; lab.y = drag.orig.y + dy; }
      } else if (drag.kind === 'dim') {
        var dm = findById(doc.dimensions, drag.itemId);
        if (dm) {
          dm.x1 = drag.orig.x1 + dx; dm.y1 = drag.orig.y1 + dy;
          dm.x2 = drag.orig.x2 + dx; dm.y2 = drag.orig.y2 + dy;
        }
      }
      render();
      if (selected && selected.kind === 'wall') {
        var cw = findById(doc.walls, selected.id);
        if (cw) lengthInput.value = fmt(wallLen(cw));
      }
    }
  }

  function finishDrawWall(p) {
    if (!startPt) return;
    p = snapPoint(p, startPt);
    if (dist(startPt, p) < MIN_LEN) return;
    pushHistory();
    var w = addWall(startPt.x, startPt.y, p.x, p.y);
    startPt = { x: p.x, y: p.y };
    previewPt = null;
    selected = w ? { kind: 'wall', id: w.id } : null;
    render(); persist(); updateProps();
    setHint('Muro de ' + fmt(wallLen(w)) + ' m. Encadena otro o cambia a Seleccionar.');
  }

  function finishDrawDim(p) {
    if (!startPt) return;
    p = snapPoint(p, startPt);
    if (dist(startPt, p) < MIN_LEN) return;
    pushHistory();
    doc.dimensions.push({ id: uid('c'), x1: startPt.x, y1: startPt.y, x2: p.x, y2: p.y, offset: 0.4 });
    startPt = null;
    previewPt = null;
    render(); persist();
    setHint('Cota añadida: ' + fmt(dist({ x: startPt ? startPt.x : 0, y: 0 }, p)) + ' m.');
    /* startPt already null — fix hint */
    var last = doc.dimensions[doc.dimensions.length - 1];
    setHint('Cota añadida: ' + fmt(dist({ x: last.x1, y: last.y1 }, { x: last.x2, y: last.y2 })) + ' m.');
  }

  function onUp(e) {
    var raw = screenToWorld(e.clientX, e.clientY);
    if (drag && drag.kind === 'draw-wall' && startPt) {
      var p = snapPoint(raw, startPt);
      if (dist(startPt, p) >= MIN_LEN) finishDrawWall(p);
    } else if (drag && drag.kind === 'draw-dim' && startPt) {
      var p2 = snapPoint(raw, startPt);
      if (dist(startPt, p2) >= MIN_LEN) finishDrawDim(p2);
    } else if (tool === 'wall' && startPt && drag == null) {
      /* second tap without a drag-draw session started in this pointer: handled on next down */
    } else if (tool === 'wall' && startPt && !drag) {
      /* no-op */
    }
    /* second tap for wall: pointerdown set drag draw-wall, or if start exists and this was a new down without moving */
    if (tool === 'wall' && startPt && pointers.size === 1 && !pinch) {
      var end = snapPoint(raw, startPt);
      if (drag && drag.kind === 'draw-wall' && dist(startPt, end) >= MIN_LEN) {
        /* already finished above */
      } else if (!drag || drag.kind === 'draw-wall') {
        if (dist(startPt, end) >= MIN_LEN && drag && drag.kind === 'draw-wall') {
          /* finished */
        }
      }
    }
    if (drag && drag.moved) persist();
    if (drag && drag.kind === 'wall') updateProps();
    drag = null;
    pan = null;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  }

  /* Fix wall second-tap: onDown when startPt already set begins drag; if user taps without move, onUp should commit */
  var _onUp = onUp;
  onUp = function (e) {
    var wasDraw = drag && (drag.kind === 'draw-wall' || drag.kind === 'draw-dim');
    var raw = screenToWorld(e.clientX, e.clientY);
    if (wasDraw && startPt) {
      var p = snapPoint(raw, startPt);
      if (dist(startPt, p) >= MIN_LEN) {
        if (drag.kind === 'draw-wall') finishDrawWall(p);
        else finishDrawDim(p);
        drag = null;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        return;
      }
    }
    /* Second tap: startPt set, this pointer had no drag-wall (start already existed so onDown created draw-wall) */
    _onUp(e);
  };

  /* Simpler wall placement: if startPt is set and user taps (down+up) away, commit.
     onDown already sets drag draw-wall when startPt exists. onUp wrapper commits. Good. */

  function onWheel(e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.1 : 0.9;
    var world = screenToWorld(e.clientX, e.clientY);
    view.scale = clamp(view.scale * factor, 12, 400);
    var s = svgSize();
    view.x = world.x - (e.clientX - s.left - s.w / 2) / view.scale;
    view.y = world.y - (e.clientY - s.top - s.h / 2) / view.scale;
    render();
  }

  /* ---------- IO ---------- */

  function persist() {
    if (ignoreSave) return;
    try {
      var payload = clone(doc);
      try {
        localStorage.setItem(STORE, JSON.stringify(payload));
      } catch (err) {
        if (payload.background) {
          payload.background = { src: null, x: doc.background.x, y: doc.background.y, width: doc.background.width, height: doc.background.height, opacity: doc.background.opacity, omitted: true };
          localStorage.setItem(STORE, JSON.stringify(payload));
          setHint('Plano guardado sin la foto (ocupaba demasiado espacio).');
        }
      }
    } catch (e) { /* ignore */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && d.version === 1 && Array.isArray(d.walls)) {
        doc = d;
        if (!doc.openings) doc.openings = [];
        if (!doc.dimensions) doc.dimensions = [];
        if (!doc.labels) doc.labels = [];
        autoDimChk.checked = doc.autoDimensions !== false;
        gridChk.checked = doc.showGrid !== false;
        if (doc.background && doc.background.opacity != null) {
          opacityRng.value = String(Math.round(doc.background.opacity * 100));
          opacityVal.textContent = opacityRng.value + '%';
        }
        var maxId = 0;
        ['walls', 'openings', 'dimensions', 'labels'].forEach(function (k) {
          doc[k].forEach(function (it) {
            var m = String(it.id || '').match(/(\d+)$/);
            if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
          });
        });
        seq = maxId + 1;
      }
    } catch (e) { /* ignore */ }
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function bounds() {
    var xs = [0, 6], ys = [0, 4];
    function addp(x, y) { xs.push(x); ys.push(y); }
    doc.walls.forEach(function (w) { addp(w.x1, w.y1); addp(w.x2, w.y2); });
    doc.labels.forEach(function (l) { addp(l.x, l.y); });
    doc.dimensions.forEach(function (d) { addp(d.x1, d.y1); addp(d.x2, d.y2); });
    if (doc.background) {
      addp(doc.background.x, doc.background.y);
      addp(doc.background.x + doc.background.width, doc.background.y + doc.background.height);
    }
    var pad = 0.8;
    var minX = Math.min.apply(null, xs) - pad, maxX = Math.max.apply(null, xs) + pad;
    var minY = Math.min.apply(null, ys) - pad, maxY = Math.max.apply(null, ys) + pad;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, w: maxX - minX, h: maxY - minY };
  }

  function exportJSON() {
    var data = clone(doc);
    download('plano.json', JSON.stringify(data, null, 2), 'application/json');
  }

  function exportSVGString(includeBg) {
    var b = bounds();
    var scale = 100; /* 1 m = 100 px in the file */
    var wpx = b.w * scale, hpx = b.h * scale;
    var payload = clone(doc);
    if (!includeBg && payload.background) payload.background.src = null;
    var json = JSON.stringify(payload);
    var parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + wpx + ' ' + hpx + '" width="' + wpx + 'px" height="' + hpx + 'px" data-planos="1">');
    parts.push('<!--PLANOS-SVG-DATA ' + json.replace(/--/g, '\\u002d\\u002d') + ' -->');
    parts.push('<rect width="100%" height="100%" fill="#f3efe6"/>');
    parts.push('<g transform="translate(' + (-b.minX * scale) + ' ' + (-b.minY * scale) + ') scale(' + scale + ')">');
    /* reuse current DOM world without view transform: temporary render at identity is heavy; build paths here */
    if (includeBg && doc.background && doc.background.src) {
      var bg = doc.background;
      parts.push('<image href="' + escapeAttr(bg.src) + '" x="' + bg.x + '" y="' + bg.y + '" width="' + bg.width + '" height="' + bg.height + '" opacity="' + (bg.opacity == null ? 0.45 : bg.opacity) + '" preserveAspectRatio="none"/>');
    }
    doc.walls.forEach(function (wall) {
      wallSegments(wall).forEach(function (seg) {
        parts.push('<polygon points="' + wallPolygon(wall, seg[0], seg[1]) + '" fill="#1c1914"/>');
      });
    });
    /* openings / dims / labels are already in the live SVG; serialize a simplified copy */
    parts.push('</g></svg>');
    /* Better: clone live #world, strip preview/handles, set transform to export transform */
    return buildExportSVG(includeBg);
  }

  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function buildExportSVG(includeBg) {
    var b = bounds();
    var scale = 80;
    var wpx = Math.max(200, b.w * scale), hpx = Math.max(200, b.h * scale);
    var payload = clone(doc);
    if (!includeBg && payload.background) payload.background = Object.assign({}, payload.background, { src: null });
    var json = JSON.stringify(payload);
    var g = document.getElementById('world');
    if (!g) render();
    g = document.getElementById('world');
    var prev = view;
    /* clone and rewrite transform */
    var cloneG = g.cloneNode(true);
    var prevPrev = cloneG.querySelector('#preview');
    if (prevPrev) prevPrev.remove();
    cloneG.querySelectorAll('circle[data-handle], circle[stroke="#2563eb"]').forEach(function (n) {
      if (n.getAttribute('data-handle') != null || (selected && n.getAttribute('stroke') === '#2563eb' && n.tagName === 'circle' && !cloneG.querySelector('#openings').contains(n))) {
        /* keep opening strokes; drop handles: handles are last circles with white fill */
      }
    });
    Array.from(cloneG.querySelectorAll('circle')).forEach(function (c) {
      if (c.getAttribute('fill') === '#fff' && c.getAttribute('stroke') === '#2563eb') c.remove();
    });
    var grid = cloneG.querySelector('#grid');
    if (grid) grid.remove();
    if (!includeBg) {
      var im = cloneG.querySelector('image');
      if (im) im.remove();
    }
    cloneG.setAttribute('transform', 'translate(' + (-b.minX * scale) + ' ' + (-b.minY * scale) + ') scale(' + scale + ')');
    var ser = new XMLSerializer();
    var inner = ser.serializeToString(cloneG);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' +
      wpx + ' ' + hpx + '" width="' + wpx + '" height="' + hpx + '" data-planos="1">\n' +
      '<!--PLANOS-SVG-DATA ' + json.replace(/--/g, '@@DASH@@') + ' -->\n' +
      '<rect width="100%" height="100%" fill="#f3efe6"/>\n' +
      inner + '\n</svg>';
  }

  function exportSVG() {
    download('plano.svg', buildExportSVG(true), 'image/svg+xml');
  }

  function exportPNG() {
    var svg = buildExportSVG(true);
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      var mul = 2;
      canvas.width = Math.max(2, img.width * mul);
      canvas.height = Math.max(2, img.height * mul);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f3efe6';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (b2) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b2);
        a.download = 'plano.png';
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.onerror = function () { setHint('No se pudo exportar el PNG.'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function importJSONText(text) {
    var d = JSON.parse(text);
    if (!d || !Array.isArray(d.walls)) throw new Error('JSON no reconocido');
    pushHistory();
    doc = d;
    if (!doc.openings) doc.openings = [];
    if (!doc.dimensions) doc.dimensions = [];
    if (!doc.labels) doc.labels = [];
    if (doc.autoDimensions == null) doc.autoDimensions = true;
    selected = null;
    startPt = null;
    render(); persist(); updateProps();
    setHint('Plano importado.');
  }

  function importSVGText(text) {
    var m = text.match(/<!--PLANOS-SVG-DATA\s([\s\S]*?)\s-->/);
    if (m) {
      importJSONText(m[1].replace(/@@DASH@@/g, '--'));
      return;
    }
    var dom = new DOMParser().parseFromString(text, 'image/svg+xml');
    var root = dom.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('SVG inválido');
    var vb = (root.getAttribute('viewBox') || '0 0 100 100').trim().split(/[\s,]+/).map(Number);
    var vw = vb[2] || 100, vh = vb[3] || 100;
    /* If the drawing is large, treat units as mm; otherwise as meters */
    var unit = (Math.max(vw, vh) > 200) ? 0.001 : 1;
    var lines = [];
    function take(x1, y1, x2, y2) { lines.push({ x1: x1 * unit, y1: y1 * unit, x2: x2 * unit, y2: y2 * unit }); }
    root.querySelectorAll('line').forEach(function (n) {
      take(+n.getAttribute('x1') || 0, +n.getAttribute('y1') || 0, +n.getAttribute('x2') || 0, +n.getAttribute('y2') || 0);
    });
    root.querySelectorAll('polyline, polygon').forEach(function (n) {
      var pts = (n.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(function (v, i, a) { return !isNaN(v); });
      for (var i = 0; i + 3 < pts.length; i += 2) take(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    });
    root.querySelectorAll('path').forEach(function (n) {
      var d = n.getAttribute('d') || '';
      var nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
      if (!nums || nums.length < 4) return;
      /* naive: pairs from M/L commands */
      var cmds = d.replace(/,/g, ' ').trim().split(/(?=[MLHVZmlhvz])/);
      var x = 0, y = 0, sx = 0, sy = 0;
      cmds.forEach(function (c) {
        var t = c.trim(); if (!t) return;
        var typ = t[0];
        var args = t.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (typ === 'M' || typ === 'L') {
          for (var i = 0; i + 1 < args.length; i += 2) {
            var nx = args[i], ny = args[i + 1];
            if (typ === 'L' || i > 0) take(x, y, nx, ny);
            x = nx; y = ny;
            if (typ === 'M' && i === 0) { sx = x; sy = y; typ = 'L'; }
          }
        } else if (typ === 'm' || typ === 'l') {
          for (var j = 0; j + 1 < args.length; j += 2) {
            var nx2 = x + args[j], ny2 = y + args[j + 1];
            if (typ === 'l' || j > 0) take(x, y, nx2, ny2);
            x = nx2; y = ny2;
            if (typ === 'm' && j === 0) { sx = x; sy = y; typ = 'l'; }
          }
        } else if (typ === 'H') { take(x, y, args[0], y); x = args[0]; }
        else if (typ === 'V') { take(x, y, x, args[0]); y = args[0]; }
        else if (typ === 'Z' || typ === 'z') { take(x, y, sx, sy); x = sx; y = sy; }
      });
    });
    if (!lines.length) throw new Error('No se encontraron líneas en el SVG.');
    pushHistory();
    lines.forEach(function (ln) {
      if (Math.hypot(ln.x2 - ln.x1, ln.y2 - ln.y1) >= 0.05) addWall(ln.x1, ln.y1, ln.x2, ln.y2, 0.15);
    });
    selected = null;
    render(); persist();
    setHint('SVG importado de forma aproximada: ' + lines.length + ' muros. Revisa espesores y uniones.');
  }

  function newPlan() {
    if (!window.confirm('¿Empezar un plano nuevo? Se perderá lo no exportado.')) return;
    pushHistory();
    doc = emptyDoc();
    selected = null;
    startPt = null;
    previewPt = null;
    calibPts = [];
    view = { x: 2.5, y: 2.5, scale: 70 };
    render(); persist(); updateProps();
    setHint('Plano nuevo. Elige Muro para empezar.');
  }

  function loadBackgroundFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var src = reader.result;
      var im = new Image();
      im.onload = function () {
        pushHistory();
        var width = 10;
        var height = width * (im.height / im.width || 0.7);
        doc.background = { src: src, x: -0.5, y: -0.5, width: width, height: height, opacity: (parseInt(opacityRng.value, 10) || 45) / 100 };
        render(); persist();
        setHint('Foto cargada. Usa Calibrar: dos puntos y la distancia real en metros.');
        setTool('calibrate');
      };
      im.src = src;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- wire UI ---------- */

  document.querySelectorAll('.tool').forEach(function (btn) {
    btn.addEventListener('click', function () { setTool(btn.getAttribute('data-tool')); });
  });
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  document.getElementById('btn-delete').addEventListener('click', deleteSelected);
  document.getElementById('btn-apply-length').addEventListener('click', applyLength);
  lengthInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applyLength(); }
  });
  autoDimChk.addEventListener('change', function () {
    pushHistory();
    doc.autoDimensions = autoDimChk.checked;
    render(); persist();
  });
  gridChk.addEventListener('change', function () {
    doc.showGrid = gridChk.checked;
    render(); persist();
  });
  opacityRng.addEventListener('input', function () {
    opacityVal.textContent = opacityRng.value + '%';
    if (doc.background) {
      doc.background.opacity = (parseInt(opacityRng.value, 10) || 0) / 100;
      render();
    }
  });
  opacityRng.addEventListener('change', function () { persist(); });

  var menu = document.getElementById('menu');
  document.getElementById('btn-menu').addEventListener('click', function () { menu.hidden = !menu.hidden; });
  document.getElementById('btn-close-menu').addEventListener('click', function () { menu.hidden = true; });
  document.getElementById('btn-new').addEventListener('click', function () { menu.hidden = true; newPlan(); });
  document.getElementById('btn-bg').addEventListener('click', function () { document.getElementById('file-bg').click(); });
  document.getElementById('btn-export-json').addEventListener('click', function () { menu.hidden = true; exportJSON(); });
  document.getElementById('btn-export-svg').addEventListener('click', function () { menu.hidden = true; exportSVG(); });
  document.getElementById('btn-export-png').addEventListener('click', function () { menu.hidden = true; exportPNG(); });
  document.getElementById('btn-import-json').addEventListener('click', function () { document.getElementById('file-json').click(); });
  document.getElementById('btn-import-svg').addEventListener('click', function () { document.getElementById('file-svg').click(); });
  document.getElementById('file-bg').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) loadBackgroundFile(f);
    e.target.value = '';
    menu.hidden = true;
  });
  document.getElementById('file-json').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { try { importJSONText(r.result); } catch (err) { setHint('No se pudo importar el JSON.'); } menu.hidden = true; };
    r.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('file-svg').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { try { importSVGText(r.result); } catch (err) { setHint(err.message || 'No se pudo importar el SVG.'); } menu.hidden = true; };
    r.readAsText(f);
    e.target.value = '';
  });

  stage.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    if (e.key === 'Escape') { startPt = null; previewPt = null; calibPts = []; setTool('select'); }
    if (e.key === 'Enter') applyLength();
  });

  window.addEventListener('resize', function () { render(); });

  function fitView() {
    var b = bounds();
    var s = svgSize();
    if (!s.w || !s.h) return;
    view.x = (b.minX + b.maxX) / 2;
    view.y = (b.minY + b.maxY) / 2;
    var sc = Math.min(s.w / (b.w || 1), s.h / (b.h || 1)) * 0.8;
    view.scale = Math.max(12, Math.min(400, sc));
    render();
  }

  /* Public test hook */
  window.PlanosSVG = {
    getDoc: function () { return doc; },
    setDoc: function (d) { pushHistory(); doc = d; render(); persist(); },
    addWall: addWall,
    addOpening: addOpening,
    addLabel: function (x, y, text) { var l = { id: uid('t'), x: x, y: y, text: text }; doc.labels.push(l); return l; },
    addDim: function (x1, y1, x2, y2) { var d = { id: uid('c'), x1: x1, y1: y1, x2: x2, y2: y2, offset: 0.4 }; doc.dimensions.push(d); return d; },
    setWallLength: setWallLength,
    setTool: setTool,
    render: render,
    persist: persist,
    undo: undo,
    redo: redo,
    exportSVG: buildExportSVG,
    exportJSON: function () { return JSON.stringify(doc); },
    importJSON: importJSONText,
    importSVG: importSVGText,
    pushHistory: pushHistory,
    select: function (kind, id) { selected = { kind: kind, id: id }; updateProps(); render(); },
    resetView: function () { view = { x: 2.5, y: 2.5, scale: 70 }; render(); },
    fitView: fitView
  };

  restore();
  doc.autoDimensions = autoDimChk.checked;
  doc.showGrid = gridChk.checked;
  render();
  updateHistoryButtons();
  setHint('Elige Muro y toca dos puntos. Puedes escribir el largo exacto.');
})();
