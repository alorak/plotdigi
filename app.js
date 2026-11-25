/* PlotDigi — WebPlotDigitizer çekirdeği ile grafikten veri çıkarma.
 * Kalibrasyon (wpd.Calibration + wpd.XYAxes), veri seti (wpd.Dataset) ve
 * otomatik çıkarma (wpd.AutoDetectionData + algoritmalar) kütüphaneden gelir.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const CALIB_LABELS = ['X1', 'X2', 'Y1', 'Y2'];
  const CALIB_HINTS = [
    'X1: x ekseninde değeri bilinen ilk noktaya tıklayın',
    'X2: x ekseninde değeri bilinen ikinci noktaya tıklayın',
    'Y1: y ekseninde değeri bilinen ilk noktaya tıklayın',
    'Y2: y ekseninde değeri bilinen ikinci noktaya tıklayın',
  ];

  // ---------- Durum ----------
  const state = {
    img: null,
    W: 0,
    H: 0,
    imageData: null,
    srcCanvas: document.createElement('canvas'),
    calPx: [null, null, null, null], // {x, y} görsel pikseli
    calibIndex: -1,                   // yerleştirilmekte olan kalibrasyon noktası
    axes: null,                       // kalibre edilmiş wpd.XYAxes
    dataset: new wpd.Dataset(2),
    dataMode: 'manual',               // 'manual' | 'auto'
    tool: null,                       // null | 'pick' | 'mask'
    mask: null,                       // {x0, y0, x1, y1}
    dragStart: null,
    algos: null,
  };

  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const loupe = $('#loupe');
  const lctx = loupe.getContext('2d');

  function resetAlgos() {
    state.algos = {
      avg: new wpd.AveragingWindowAlgo(),
      xstep: new wpd.XStepWithInterpolationAlgo(),
    };
  }
  resetAlgos();

  // ---------- Görsel yükleme ----------
  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('Görsel okunamadı.');
    };
    img.src = url;
  }

  function setImage(img) {
    state.img = img;
    state.W = img.naturalWidth;
    state.H = img.naturalHeight;
    state.srcCanvas.width = state.W;
    state.srcCanvas.height = state.H;
    const sctx = state.srcCanvas.getContext('2d', { willReadFrequently: true });
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, state.W, state.H);
    sctx.drawImage(img, 0, 0);
    state.imageData = sctx.getImageData(0, 0, state.W, state.H);

    canvas.width = state.W;
    canvas.height = state.H;

    // her şeyi sıfırla
    state.calPx = [null, null, null, null];
    state.axes = null;
    state.dataset.clearAll();
    state.mask = null;
    state.tool = null;
    resetAlgos();

    $('#dropzone').hidden = true;
    $('#canvas-wrap').hidden = false;
    $('#btn-new').hidden = false;

    setCalibIndex(0);
    calibrate();
    fitCanvas();
  }

  // Görseli sol alana sığdır (küçük görselleri en fazla 3 kat büyüt)
  function fitCanvas() {
    if (!state.img) return;
    const stageEl = $('#stage');
    const narrow = window.innerWidth <= 820;
    const aw = stageEl.clientWidth - 42;
    const ah = narrow ? window.innerHeight * 0.7 : stageEl.clientHeight - 42;
    const k = Math.max(0.05, Math.min(aw / state.W, ah / state.H, 3));
    canvas.style.width = Math.floor(state.W * k) + 'px';
    canvas.style.height = Math.floor(state.H * k) + 'px';
    redraw();
  }

  function resetToUpload() {
    state.img = null;
    state.imageData = null;
    state.axes = null;
    state.calPx = [null, null, null, null];
    state.dataset.clearAll();
    state.mask = null;
    state.tool = null;
    state.calibIndex = -1;
    $$('.calib-val').forEach((el) => (el.value = ''));
    $('#dropzone').hidden = false;
    $('#canvas-wrap').hidden = true;
    $('#btn-new').hidden = true;
    $('#file-input').value = '';
    updateUI();
  }

  $('#file-input').addEventListener('change', (e) => loadFile(e.target.files[0]));

  const dz = $('#dropzone');
  const stage = $('#stage');
  ['dragenter', 'dragover'].forEach((ev) =>
    stage.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    stage.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  stage.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        loadFile(item.getAsFile());
        return;
      }
    }
  });

  $('#btn-new').addEventListener('click', resetToUpload);

  // ---------- Koordinatlar ----------
  function eventToImage(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left - canvas.clientLeft) * (state.W / canvas.clientWidth);
    const y = (e.clientY - r.top - canvas.clientTop) * (state.H / canvas.clientHeight);
    return { x, y };
  }

  // ekran pikseli başına görsel pikseli (çizimleri sabit boyutta tutmak için)
  function scale() {
    return canvas.clientWidth ? state.W / canvas.clientWidth : 1;
  }

  // ---------- Kalibrasyon ----------
  function setCalibIndex(i) {
    state.calibIndex = i;
    state.tool = null;
    updateUI();
  }

  function normalizeValue(str) {
    const s = str.trim();
    // Türkçe ondalık virgülü: "0,5" -> "0.5"
    if (/^[-+]?\d+,\d+([eE][-+]?\d+)?$/.test(s)) return s.replace(',', '.');
    return s;
  }

  function calibrate() {
    const vals = $$('.calib-val').map((el) => normalizeValue(el.value));
    const status = $('#calib-status');
    state.axes = null;

    const missingPx = state.calPx.some((p) => !p);
    const missingVal = vals.some((v) => v === '');
    if (missingPx || missingVal) {
      status.textContent = '';
      status.className = 'status';
      updateUI();
      return;
    }

    const cal = new wpd.Calibration(2);
    const [p1, p2, p3, p4] = state.calPx;
    cal.addPoint(p1.x, p1.y, vals[0], '0');
    cal.addPoint(p2.x, p2.y, vals[1], '0');
    cal.addPoint(p3.x, p3.y, '0', vals[2]);
    cal.addPoint(p4.x, p4.y, '0', vals[3]);

    const axes = new wpd.XYAxes();
    let ok = false;
    try {
      ok = axes.calibrate(cal, $('#log-x').checked, $('#log-y').checked, false);
    } catch (err) {
      ok = false;
    }
    if (ok) {
      const test = axes.pixelToData(p1.x, p1.y);
      ok = test.every(Number.isFinite) || axes.isDate(0) || axes.isDate(1);
    }

    if (ok) {
      state.axes = axes;
      status.textContent = 'Kalibre edildi ✓';
      status.className = 'status ok';
    } else {
      status.textContent = 'Geçersiz değerler';
      status.className = 'status err';
    }
    resetAlgos();
    renderAlgoParams();
    updateUI();
  }

  $$('.calib-pt').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (!state.img) return;
      setCalibIndex(Number(btn.dataset.i));
    })
  );
  $$('.calib-val').forEach((el) => el.addEventListener('input', calibrate));
  $('#log-x').addEventListener('change', calibrate);
  $('#log-y').addEventListener('change', calibrate);

  // ---------- Sekmeler ----------
  $$('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      state.dataMode = tab.dataset.mode;
      state.tool = null;
      $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#tab-manual').hidden = state.dataMode !== 'manual';
      $('#tab-auto').hidden = state.dataMode !== 'auto';
      renderAlgoParams();
      updateUI();
    })
  );

  // ---------- Otomatik çıkarma ----------
  const colorDist = $('#color-dist');
  colorDist.addEventListener('input', () => ($('#color-dist-val').textContent = colorDist.value));

  function currentAlgo() {
    return state.algos[$('#algo').value];
  }

  // Kütüphanedeki parametre adlarının Türkçe karşılıkları
  const PARAM_LABELS = {
    xStep: 'ΔX (px)',
    yStep: 'ΔY (px)',
    xmin: 'X min',
    xmax: 'X max',
    delx: 'ΔX adımı',
    ymin: 'Y min',
    ymax: 'Y max',
    smoothing: 'Yumuşatma %',
  };

  function renderAlgoParams() {
    const box = $('#algo-params');
    box.innerHTML = '';
    const list = currentAlgo().getParamList(state.axes);
    for (const [key, [label, unit, value]] of Object.entries(list)) {
      const lab = document.createElement('label');
      lab.textContent = PARAM_LABELS[key] || `${label} (${unit})`;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.dataset.key = key;
      inp.value = Number.isFinite(value) ? +Number(value).toPrecision(6) : value;
      lab.appendChild(inp);
      box.appendChild(lab);
    }
  }
  $('#algo').addEventListener('change', renderAlgoParams);

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function buildMask() {
    const mask = new Set();
    if (!state.mask) return mask;
    const { W } = state;
    const x0 = Math.max(0, Math.floor(Math.min(state.mask.x0, state.mask.x1)));
    const x1 = Math.min(state.W - 1, Math.ceil(Math.max(state.mask.x0, state.mask.x1)));
    const y0 = Math.max(0, Math.floor(Math.min(state.mask.y0, state.mask.y1)));
    const y1 = Math.min(state.H - 1, Math.ceil(Math.max(state.mask.y0, state.mask.y1)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) mask.add(y * W + x);
    }
    return mask;
  }

  function runAuto() {
    if (!state.axes) return;
    const btn = $('#btn-run');
    btn.disabled = true;
    btn.textContent = 'Çalışıyor…';

    setTimeout(() => {
      try {
        const algo = currentAlgo();
        const params = {};
        $$('#algo-params input').forEach((inp) => (params[inp.dataset.key] = inp.value));
        algo.setParams(params);

        const det = new wpd.AutoDetectionData();
        det.fgColor = hexToRgb($('#fg-color').value);
        det.colorDetectionMode = 'fg';
        det.colorDistance = Number(colorDist.value);
        det.imageWidth = state.W;
        det.imageHeight = state.H;
        det.setMask(buildMask());
        det.algorithm = algo;
        det.generateBinaryData(state.imageData);

        algo.run(det, state.dataset, state.axes, state.imageData);
      } catch (err) {
        console.error(err);
        alert('Otomatik çıkarma başarısız: ' + err.message);
      }
      btn.disabled = false;
      btn.textContent = 'Çalıştır';
      redraw();
      updateUI();
    }, 20);
  }
  $('#btn-run').addEventListener('click', runAuto);

  function toggleTool(name) {
    state.tool = state.tool === name ? null : name;
    if (state.tool) state.calibIndex = -1;
    updateUI();
  }
  $('#btn-pick').addEventListener('click', () => toggleTool('pick'));
  $('#btn-mask').addEventListener('click', () => toggleTool('mask'));
  $('#btn-mask-clear').addEventListener('click', () => {
    state.mask = null;
    redraw();
    updateUI();
  });

  $('#btn-clear').addEventListener('click', () => {
    state.dataset.clearAll();
    redraw();
    updateUI();
  });

  // ---------- Fare etkileşimi ----------
  canvas.addEventListener('mousedown', (e) => {
    if (!state.img || e.button !== 0) return;
    const p = eventToImage(e);

    if (state.calibIndex >= 0) {
      const i = state.calibIndex;
      state.calPx[i] = p;
      const next = state.calPx.findIndex((c) => !c);
      state.calibIndex = next;
      $$('.calib-val')[i].focus();
      calibrate();
      redraw();
      return;
    }

    if (state.tool === 'pick') {
      const xi = Math.min(state.W - 1, Math.max(0, Math.round(p.x)));
      const yi = Math.min(state.H - 1, Math.max(0, Math.round(p.y)));
      const k = (yi * state.W + xi) * 4;
      const d = state.imageData.data;
      $('#fg-color').value = rgbToHex([d[k], d[k + 1], d[k + 2]]);
      state.tool = null;
      updateUI();
      return;
    }

    if (state.tool === 'mask') {
      state.dragStart = p;
      state.mask = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      redraw();
      return;
    }

    if (state.dataMode === 'manual' && state.axes) {
      if (e.shiftKey) {
        removeNearest(p);
      } else {
        state.dataset.addPixel(p.x, p.y);
      }
      redraw();
      updateUI();
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (!state.img || state.dataMode !== 'manual') return;
    e.preventDefault();
    removeNearest(eventToImage(e));
    redraw();
    updateUI();
  });

  function removeNearest(p) {
    state.dataset.removeNearestPixel(p.x, p.y, 12 * scale());
  }

  window.addEventListener('mousemove', (e) => {
    if (state.tool === 'mask' && state.dragStart) {
      const p = eventToImage(e);
      state.mask.x1 = p.x;
      state.mask.y1 = p.y;
      redraw();
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.tool === 'mask' && state.dragStart) {
      state.dragStart = null;
      const m = state.mask;
      if (Math.abs(m.x1 - m.x0) < 3 || Math.abs(m.y1 - m.y0) < 3) state.mask = null;
      state.tool = null;
      redraw();
      updateUI();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const L = loupe.offsetWidth || 140;
    let left = cx + 18;
    let top = cy + 18;
    if (left + L > r.width) left = cx - L - 18;
    if (top + L > r.height) top = cy - L - 18;
    loupe.style.left = Math.max(0, left) + 'px';
    loupe.style.top = Math.max(0, top) + 'px';
    drawLoupe(eventToImage(e));
  });
  canvas.addEventListener('mouseleave', () => (loupe.hidden = true));

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      state.tool = null;
      state.calibIndex = -1;
      updateUI();
    } else if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      state.dataset.removeLastPixel();
      redraw();
      updateUI();
    }
  });

  // ---------- Çizim ----------
  function redraw() {
    if (!state.img) return;
    const s = scale();
    ctx.clearRect(0, 0, state.W, state.H);
    ctx.drawImage(state.srcCanvas, 0, 0);

    // algılama alanı
    if (state.mask) {
      const { x0, y0, x1, y1 } = state.mask;
      ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([6 * s, 4 * s]);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 * s;
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
    }

    // eksen çizgileri
    const [p1, p2, p3, p4] = state.calPx;
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.5)';
    ctx.lineWidth = 1.5 * s;
    if (p1 && p2) line(p1, p2);
    if (p3 && p4) line(p3, p4);

    // kalibrasyon noktaları
    ctx.font = `600 ${12 * s}px system-ui, sans-serif`;
    state.calPx.forEach((p, i) => {
      if (!p) return;
      const r = 6 * s;
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2 * s;
      line({ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y });
      line({ x: p.x, y: p.y - r }, { x: p.x, y: p.y + r });
      ctx.fillStyle = '#2563eb';
      ctx.fillText(CALIB_LABELS[i], p.x + 5 * s, p.y - 5 * s);
    });

    // veri noktaları
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 * s;
    for (const pt of state.dataset.getAllPixels()) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function line(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawLoupe(p) {
    const zoom = 4;
    const size = loupe.width;
    const src = size / zoom;
    loupe.hidden = false;
    lctx.imageSmoothingEnabled = false;
    lctx.fillStyle = '#fff';
    lctx.fillRect(0, 0, size, size);
    lctx.drawImage(canvas, p.x - src / 2, p.y - src / 2, src, src, 0, 0, size, size);
    lctx.strokeStyle = 'rgba(220, 38, 38, 0.8)';
    lctx.lineWidth = 1;
    lctx.beginPath();
    lctx.moveTo(size / 2, 0);
    lctx.lineTo(size / 2, size);
    lctx.moveTo(0, size / 2);
    lctx.lineTo(size, size / 2);
    lctx.stroke();

    if (state.axes) {
      const [x, y] = state.axes.pixelToData(p.x, p.y);
      const txt = `${fmt(x, 0)}, ${fmt(y, 1)}`;
      lctx.font = '11px ui-monospace, monospace';
      lctx.fillStyle = 'rgba(255,255,255,0.85)';
      lctx.fillRect(0, size - 18, size, 18);
      lctx.fillStyle = '#18181b';
      lctx.textAlign = 'center';
      lctx.fillText(txt, size / 2, size - 5);
      lctx.textAlign = 'start';
    }
  }

  window.addEventListener('resize', fitCanvas);

  // ---------- CSV ----------
  function fmt(v, axisIndex) {
    if (state.axes && state.axes.isDate(axisIndex)) {
      return wpd.dateConverter.formatDateNumber(v, state.axes.getInitialDateFormat(axisIndex));
    }
    if (!Number.isFinite(v)) return '';
    return String(parseFloat(v.toPrecision(6)));
  }

  function buildCSV() {
    if (!state.axes || state.dataset.getCount() === 0) return '';
    let delim = $('#delim').value;
    if (delim === '\\t') delim = '\t';
    let rows = state.dataset.getAllPixels().map((p) => state.axes.pixelToData(p.x, p.y));
    if ($('#sort-x').checked) rows = rows.slice().sort((a, b) => a[0] - b[0]);
    const lines = ['x' + delim + 'y'];
    for (const [x, y] of rows) lines.push(fmt(x, 0) + delim + fmt(y, 1));
    return lines.join('\n');
  }

  $('#delim').addEventListener('change', updateUI);
  $('#sort-x').addEventListener('change', updateUI);

  $('#btn-copy').addEventListener('click', async () => {
    const text = $('#csv').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      $('#csv').select();
      document.execCommand('copy');
    }
    const b = $('#btn-copy');
    b.textContent = 'Kopyalandı ✓';
    setTimeout(() => (b.textContent = 'Kopyala'), 1200);
  });

  $('#btn-download').addEventListener('click', () => {
    const text = $('#csv').value;
    if (!text) return;
    const blob = new Blob([text + '\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'veri.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- Arayüz durumu ----------
  function updateUI() {
    $$('.calib-pt').forEach((b, i) => {
      b.classList.toggle('set', !!state.calPx[i]);
      b.classList.toggle('active', state.calibIndex === i);
    });

    $('#btn-pick').classList.toggle('active', state.tool === 'pick');
    $('#btn-mask').classList.toggle('active', state.tool === 'mask');
    $('#btn-mask-clear').hidden = !state.mask;
    $('#btn-run').disabled = !state.axes;

    $('#point-count').textContent = state.dataset.getCount();
    $('#csv').value = buildCSV();
    $('#btn-copy').disabled = $('#btn-download').disabled = !$('#csv').value;

    // ipucu
    let hint = '';
    if (state.img) {
      if (state.calibIndex >= 0) hint = CALIB_HINTS[state.calibIndex];
      else if (state.tool === 'pick') hint = 'Eğri rengini seçmek için görsele tıklayın';
      else if (state.tool === 'mask') hint = 'Algılama alanını sürükleyerek çizin';
      else if (!state.axes) hint = 'Sağ panelde X1, X2, Y1, Y2 değerlerini girin';
      else if (state.dataMode === 'manual' && state.dataset.getCount() === 0)
        hint = 'Veri noktası eklemek için tıklayın';
      else if (state.dataMode === 'auto' && state.dataset.getCount() === 0)
        hint = 'Eğri rengini seçip “Çalıştır”a basın';
    }
    $('#hint').textContent = hint;
    $('#hint').hidden = !hint;
    canvas.style.cursor = state.tool === 'pick' ? 'copy' : 'crosshair';
  }

  renderAlgoParams();
  updateUI();
})();
