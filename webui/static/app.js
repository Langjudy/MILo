import { SplatViewer, MeshViewer } from './viewers.js?v=1';

/* ====================================================================== utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (b) => (b == null ? '—' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('zh-CN'));
const fmtDur = (s) => {
  if (s == null || isNaN(s)) return '—';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}时${m}分` : m ? `${m}分${x}秒` : `${x}秒`;
};
const fmtTime = (t) => {
  if (!t) return '';
  const d = new Date(t * 1000);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  let j;
  try { j = await r.json(); } catch { throw new Error(`请求失败（HTTP ${r.status}）`); }
  if (!r.ok || j.ok === false) throw new Error(j.error || j.detail || `请求失败（HTTP ${r.status}）`);
  return j.data;
}
const GET = (u) => api('GET', u);
const POST = (u, b = {}) => api('POST', u, b);
const PATCH = (u, b) => api('PATCH', u, b);
const DEL = (u) => api('DELETE', u);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 3200);
}

function download(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

const I = {
  video: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3"/></svg>',
  images: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="m7 4 13 8-13 8z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  cube: '<svg viewBox="0 0 24 24"><path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  axes: '<svg viewBox="0 0 24 24"><path d="M4 20V4M4 20h16M4 20l9-9"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  flat: '<svg viewBox="0 0 24 24"><path d="M12 3 21 8l-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
  top: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/></svg>',
  star: '★',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-5-5m5 5 5-5M4 20h16"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  import: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg>',
};

const STATUS = {
  empty: ['', '未上传'], uploaded: ['info', '待处理'], processing: ['run', '处理中'], ready: ['ok', '已就绪'],
  failed: ['err', '失败'], queued: ['run', '排队中'], running: ['run', '运行中'], done: ['ok', '已完成'], canceled: ['err', '已取消'],
};
const tag = (st) => { const [k, l] = STATUS[st] || ['', st || '—']; return `<span class="tag ${k}"><span class="d"></span>${l}</span>`; };

/* ====================================================================== state */
const S = {
  projects: [], project: null, options: null, system: null, cleanups: [],
  route: { name: 'home' },
};
function onCleanup(fn) { S.cleanups.push(fn); }
function cleanup() { S.cleanups.splice(0).forEach((f) => { try { f(); } catch (e) { console.warn(e); } }); }

/* ====================================================================== form helpers */
function seg(name, opts, value) {
  return `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function sw(name, title, sub, on, disabled = false) {
  return `<label class="switch" ${disabled ? 'style="opacity:.45;pointer-events:none"' : ''}><span class="s-txt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" data-sw="${name}" ${on ? 'checked' : ''}><span class="knob"></span></label>`;
}
function range(name, label, min, max, step, value, fmt = (v) => v) {
  const p = ((value - min) / (max - min)) * 100;
  return `<div class="field"><div class="lbl-row"><span>${label}</span><span class="val" data-val="${name}">${fmt(value)}</span></div><input type="range" data-range="${name}" min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${p}%"></div>`;
}
/** Bind seg/sw/range inside root to a state object. onChange(name, value). */
function bindForm(root, state, onChange, fmts = {}) {
  $$('[data-seg]', root).forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
    let v = b.dataset.v; if (v === 'true') v = true; else if (v === 'false') v = false; else if (v !== '' && !isNaN(v)) v = Number(v);
    state[s.dataset.seg] = v; onChange && onChange(s.dataset.seg, v);
  }));
  $$('[data-sw]', root).forEach((c) => c.addEventListener('change', () => { state[c.dataset.sw] = c.checked; onChange && onChange(c.dataset.sw, c.checked); }));
  $$('[data-range]', root).forEach((r) => r.addEventListener('input', () => {
    const v = Number(r.value); state[r.dataset.range] = v;
    r.style.setProperty('--p', ((v - r.min) / (r.max - r.min)) * 100 + '%');
    const lab = $(`[data-val="${r.dataset.range}"]`, root); if (lab) lab.textContent = (fmts[r.dataset.range] || ((x) => x))(v);
    onChange && onChange(r.dataset.range, v);
  }));
  $$('[data-input]', root).forEach((i) => i.addEventListener('input', () => {
    state[i.dataset.input] = i.type === 'number' ? Number(i.value) : i.value; onChange && onChange(i.dataset.input, state[i.dataset.input]);
  }));
}

function modal({ title, sub = '', body, okText = '确定', cancelText = '取消', onOk, wide = false }) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal" style="${wide ? 'width:min(760px,100%)' : ''}"><div class="modal-h"><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div><div class="modal-b">${body}</div><div class="modal-f"><button class="btn ghost" data-x>${cancelText}</button><button class="btn primary" data-ok>${okText}</button></div></div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  $('[data-x]', m).onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  $('[data-ok]', m).onclick = async () => {
    const btn = $('[data-ok]', m); btn.disabled = true;
    try { if ((await onOk(m)) !== false) close(); } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
  };
  return m;
}
const confirmBox = (title, sub, okText = '确定') => new Promise((res) => {
  const m = modal({ title, sub, body: '', okText, onOk: () => res(true) });
  $('.modal-b', m).remove();
  $('[data-x]', m).addEventListener('click', () => res(false));
});

/* ====================================================================== job monitor */
class JobMonitor {
  constructor(el, jobId, { groups = null, showLog = true, onUpdate, onDone, compact = false, title } = {}) {
    Object.assign(this, { el, jobId, groups, showLog, onUpdate, onDone, compact, title });
    this.since = 0; this.alive = true; this.data = null;
    el.innerHTML = `<div class="job-head"><div class="pct">0<small>%</small></div><div class="meta"><div class="t"></div><div class="prog lg running" style="margin-top:8px"><i></i></div><div class="small muted sub" style="margin-top:6px"></div></div><button class="btn danger sm" data-cancel>${I.stop}取消</button></div><div class="err-slot"></div><div class="stages"></div>${showLog ? '<details class="adv" style="margin-top:14px"><summary>运行日志</summary><div class="inner"><div class="console"></div></div></details>' : ''}`;
    $('[data-cancel]', el).onclick = async () => {
      if (!(await confirmBox('确定取消这个任务吗？', '正在运行的进程会被立即终止，已完成的部分会保留。', '取消任务'))) return;
      try { await POST(`/api/jobs/${jobId}/cancel`); toast('已请求取消'); } catch (e) { toast(e.message, 'err'); }
    };
    this.tick();
  }
  stop() { this.alive = false; clearTimeout(this.timer); }
  async tick() {
    if (!this.alive) return;
    let d;
    try { d = await GET(`/api/jobs/${this.jobId}?since=${this.since}`); } catch (e) {
      $('.t', this.el).textContent = '无法获取任务状态：' + e.message;
      $('[data-cancel]', this.el).hidden = true;
      return;
    }
    this.data = d;
    this.render(d);
    this.onUpdate && this.onUpdate(d);
    if (['done', 'failed', 'canceled'].includes(d.status)) {
      $('[data-cancel]', this.el).hidden = true;
      this.alive = false;
      this.onDone && this.onDone(d);
      return;
    }
    this.timer = setTimeout(() => this.tick(), 1000);
  }
  render(d) {
    const el = this.el;
    $('.pct', el).innerHTML = `${Math.floor(d.overall)}<small>%</small>`;
    $('.t', el).innerHTML = `${esc(this.title || d.title)} &nbsp;${tag(d.status)}`;
    const bar = $('.job-head .prog', el);
    bar.className = 'prog lg ' + (d.status === 'done' ? 'done' : d.status === 'failed' || d.status === 'canceled' ? 'failed' : 'running');
    $('i', bar).style.width = d.overall + '%';
    const el2 = d.started ? ((d.finished || Date.now() / 1000) - d.started) : 0;
    $('.sub', el).textContent = d.status === 'queued' ? '等待 GPU 空闲…' : `已用时 ${fmtDur(el2)}`;
    $('.err-slot', el).innerHTML = d.error && d.status !== 'done' ? `<div class="job-err">${esc(d.error)}</div>` : '';
    // stages
    let html = '';
    const groupOf = (k) => (this.groups ? this.groups.find((g) => g.keys.includes(k)) : null);
    let lastGroup = null;
    for (const s of d.stages) {
      const g = groupOf(s.key);
      if (g && g !== lastGroup) { html += `<div class="stage-group">${g.label}</div>`; lastGroup = g; }
      const icon = s.state === 'done' ? '✓' : s.state === 'failed' || s.state === 'canceled' ? '!' : '';
      html += `<div class="stage ${s.state}"><div class="ic">${icon}</div><div class="nm"><span>${esc(s.label)}</span><small>${esc(s.detail || '')}</small></div><div class="p">${s.state === 'pending' ? '' : Math.floor(s.pct) + '%'}</div><div class="prog ${s.state}"><i style="width:${s.pct}%"></i></div></div>`;
    }
    $('.stages', el).innerHTML = html;
    // log
    if (this.showLog && d.log) {
      const c = $('.console', el);
      const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
      // We always re-request the previous last line (it may be a tqdm bar refreshed in place),
      // so drop it from the DOM before appending the new batch.
      if (this.hasTail && d.log.length && c.lastChild) c.lastChild.remove();
      const frag = document.createDocumentFragment();
      for (const line of d.log) {
        const div = document.createElement('div');
        div.textContent = line;
        if (/\d+%\|/.test(line)) div.className = 'l-tq';
        else if (line.startsWith('$')) div.className = 'l-cmd';
        else if (/\[(INFO| INFO )\]|^I\d{8}/.test(line)) div.className = 'l-info';
        else if (/WARN|Warning/.test(line)) div.className = 'l-warn';
        else if (/Error|error|Traceback|Exception|失败/.test(line)) div.className = 'l-err';
        frag.appendChild(div);
      }
      c.appendChild(frag);
      while (c.childNodes.length > 1500) c.firstChild.remove();
      if (atBottom) c.scrollTop = c.scrollHeight;
      this.hasTail = d.log_end > 0;
      this.since = Math.max(0, d.log_end - 1);
    }
  }
}

/* ====================================================================== chart */
const SERIES_COLORS = { Loss: '#7b93ff', DNLoss: '#3dd6b5', MDLoss: '#f6b74d', MNLoss: '#ff8ac2', OccLoss: '#b48cff', OccLabLoss: '#8fd3ff', DOLoss: '#c8e65a' };
const LOSS_SHORT = { Loss: '总损失', DNLoss: '深度-法线一致', MDLoss: '网格深度', MNLoss: '网格法线', OccLoss: '中心占用', OccLabLoss: '占用标签', DOLoss: '深度顺序' };
const LOSS_INFO = {
  Loss: '总损失：渲染图和真实照片之间的颜色误差（L1 + SSIM）。代表画面像不像。',
  DNLoss: '深度-法线一致性损失（第 3000 次迭代后出现）：要求高斯渲染出的深度图和法线图互相吻合，让高斯“贴”在真实表面上。',
  MDLoss: '网格深度损失（网格正则化阶段）：从高斯中提取的网格渲染出的深度，要和高斯渲染的深度一致。',
  MNLoss: '网格法线损失（网格正则化阶段）：网格的法线要和高斯渲染的法线一致，让网格表面平整、朝向正确。',
  OccLoss: '中心占用损失（网格正则化阶段）：高斯的中心应该落在物体内部（SDF 占用为正），防止高斯漂浮在空中。',
  OccLabLoss: '占用标签损失（网格正则化阶段）：让可学习的 SDF 和从深度图推算出的“内/外”标签一致。',
  DOLoss: '深度顺序损失：用单目深度模型约束前后遮挡关系（只在开启深度顺序正则化时出现）。',
};
function drawChart(canvas, series, { marker, hidden = new Set() } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const names = Object.keys(series || {}).filter((n) => series[n].length > 1 && !hidden.has(n));
  const pad = { l: 46, r: 12, t: 10, b: 22 };
  ctx.font = '11px Segoe UI, sans-serif'; ctx.fillStyle = '#7d879b'; ctx.strokeStyle = '#242d40';
  if (!names.length) { ctx.fillText('等待训练数据…', pad.l, h / 2); return; }
  let xmax = 0, ymin = Infinity, ymax = -Infinity;
  names.forEach((n) => series[n].forEach(([x, y]) => { if (y > 0) { xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); } }));
  if (marker) xmax = Math.max(xmax, marker.total || 0);
  const ly = (y) => Math.log10(Math.max(y, 1e-6));
  const y0 = ly(ymin), y1 = ly(ymax) + 1e-6;
  const X = (x) => pad.l + (x / (xmax || 1)) * (w - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (ly(y) - y0) / (y1 - y0 || 1)) * (h - pad.t - pad.b);
  // grid
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yy = pad.t + (i / 4) * (h - pad.t - pad.b);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    const val = Math.pow(10, y1 - (i / 4) * (y1 - y0));
    ctx.fillText(val < 0.01 ? val.toExponential(1) : val.toFixed(3), 4, yy + 4);
  }
  for (let i = 0; i <= 4; i++) { const xv = (xmax * i) / 4; ctx.fillText(Math.round(xv).toLocaleString(), X(xv) - 12, h - 6); }
  if (marker?.mesh_start && marker.mesh_start < xmax) {
    const mx = X(marker.mesh_start);
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#f6b74d88'; ctx.beginPath(); ctx.moveTo(mx, pad.t); ctx.lineTo(mx, h - pad.b); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#f6b74d'; ctx.fillText('网格正则化开始', mx + 4, pad.t + 10); ctx.fillStyle = '#7d879b';
  }
  names.forEach((n) => {
    ctx.strokeStyle = SERIES_COLORS[n] || '#aaa'; ctx.lineWidth = n === 'Loss' ? 2 : 1.4; ctx.beginPath();
    series[n].forEach(([x, y], i) => { if (y <= 0) return; i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); });
    ctx.stroke();
  });
}

/* ====================================================================== chrome */
function setTopbar(title, crumb = '', actions = '') {
  $('#topbar').innerHTML = `<div><h1>${title}</h1>${crumb ? `<div class="crumb">${crumb}</div>` : ''}</div><div class="spacer"></div>${actions}`;
}

function renderSidebar() {
  const p = S.project;
  const sp = $('#sideProject');
  sp.className = 'side-project' + (p ? '' : ' empty');
  sp.innerHTML = `<span class="lbl">当前项目</span><span class="nm">${p ? esc(p.name) : '未选择 · 点击选择项目'}</span>`;
  sp.onclick = () => (location.hash = '#/');
  const busy = S.system?.busy;
  const runsDone = p ? p.runs.some((r) => r.status === 'done') : false;
  const st = {
    data: { done: p?.dataset.status === 'ready', enabled: !!p, running: busy?.kind === 'prepare' && busy.project === p?.id },
    train: { done: runsDone, enabled: p?.dataset.status === 'ready' || runsDone, running: busy?.kind === 'train' && busy.project === p?.id },
    preview: { done: false, enabled: runsDone, running: false },
    export: { done: p ? p.exports.some((e) => e.status === 'done') : false, enabled: runsDone, running: busy?.kind === 'export' && busy.project === p?.id },
  };
  $$('#steps a').forEach((a) => {
    const k = a.dataset.step, s = st[k];
    a.classList.toggle('active', S.route.name === 'project' && S.route.step === k);
    a.classList.toggle('disabled', !s.enabled);
    a.classList.toggle('done', s.done);
    $('.dot', a).className = 'dot' + (s.running ? ' running' : '');
    a.href = p ? `#/p/${p.id}/${k}` : '#/';
  });
}

async function pollSystem() {
  try {
    const s = await GET('/api/system');
    const prevBusy = S.system?.busy?.id;
    S.system = s;
    const g = s.gpu;
    const box = $('#gpu');
    if (g) {
      $('.gpu-name', box).textContent = g.name.replace('NVIDIA GeForce ', '');
      $('.gpu-temp', box).textContent = `${g.temp}°C`;
      $('.meter i', box).style.width = (g.mem_used / g.mem_total) * 100 + '%';
      $('.gpu-mem', box).textContent = `显存 ${(g.mem_used / 1024).toFixed(1)} / ${(g.mem_total / 1024).toFixed(0)} GB`;
      $('.gpu-util', box).textContent = `占用 ${g.util}%`;
    }
    const n = (s.busy ? 1 : 0) + s.queued;
    $('#queueBadge').hidden = !n; $('#queueBadge').textContent = n;
    if (prevBusy !== s.busy?.id) renderSidebar();
  } catch { /* server gone */ }
  setTimeout(pollSystem, 3000);
}

async function openDrawer() {
  const d = $('#drawer'); d.hidden = false;
  const body = $('#drawerBody');
  const jobs = await GET('/api/jobs');
  if (!jobs.length) { body.innerHTML = '<div class="empty-note">本次启动后还没有运行过任务</div>'; return; }
  body.innerHTML = jobs.map((j) => `<div class="qitem"><div class="t"><span>${esc(j.title)}</span>${tag(j.status)}</div><div class="prog ${j.status === 'done' ? 'done' : j.status === 'running' ? 'running' : j.status === 'failed' || j.status === 'canceled' ? 'failed' : ''}"><i style="width:${j.overall}%"></i></div><div class="row between small muted"><span>${fmtTime(j.created)}</span><span>${Math.floor(j.overall)}%</span></div>${j.status === 'running' || j.status === 'queued' ? `<button class="btn danger sm" data-cj="${j.id}">${I.stop}取消</button>` : ''}</div>`).join('');
  $$('[data-cj]', body).forEach((b) => (b.onclick = async () => { await POST(`/api/jobs/${b.dataset.cj}/cancel`); openDrawer(); }));
}
$('#queueBtn').onclick = openDrawer;
document.addEventListener('click', (e) => { if (e.target.closest('[data-close-drawer]')) $('#drawer').hidden = true; });

/* ====================================================================== router */
async function route() {
  cleanup();
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  const view = $('#view');
  view.className = 'view';
  try {
    if (parts[0] === 'p' && parts[1]) {
      S.route = { name: 'project', pid: parts[1], step: parts[2] || 'data' };
      S.project = await GET(`/api/projects/${parts[1]}`);
      renderSidebar();
      const fn = { data: viewData, train: viewTrain, preview: viewPreview, export: viewExport }[S.route.step] || viewData;
      await fn(view);
    } else {
      S.route = { name: 'home' };
      await viewHome(view);
    }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`;
  }
  renderSidebar();
}
async function reloadProject() { S.project = await GET(`/api/projects/${S.project.id}`); renderSidebar(); return S.project; }

/* ====================================================================== home */
async function viewHome(view) {
  S.projects = await GET('/api/projects');
  if (S.project && !S.projects.find((p) => p.id === S.project.id)) S.project = null;
  setTopbar('项目', '每个项目包含一组素材、它的训练结果与导出模型',
    `<button class="btn primary" id="newProj">${I.upload}新建项目</button>`);
  const card = (p) => {
    const runs = p.runs.filter((r) => r.status === 'done').length;
    const cover = p.dataset.num_frames ? `/api/projects/${p.id}/cover` : '';
    const src = { video: '视频', images: '图片', colmap: 'COLMAP' }[p.source];
    return `<div class="proj" data-pid="${p.id}"><div class="thumb ${cover ? '' : 'ph'}" ${cover ? `style="background-image:url('${cover}')"` : ''}>${cover ? '' : I.cube}${tag(p.dataset.status)}</div><div class="body"><div class="row between"><span class="nm">${esc(p.name)}</span><span class="tag">${src}</span></div><div class="stats"><span><b>${fmtNum(p.dataset.num_frames)}</b> 张图</span><span><b>${runs}</b> 个模型</span><span><b>${p.exports.filter((e) => e.status === 'done').length}</b> 次导出</span></div><div class="small muted">更新于 ${fmtTime(p.updated)}</div></div></div>`;
  };
  view.innerHTML = `<div class="hero"><div><h2>从照片到三维网格</h2><p>上传一段绕物体拍摄的视频或一组照片，MILo 会自动估计相机位姿、训练高斯场景，并提取带颜色的三角网格。</p></div></div>
  <div class="proj-grid">${S.projects.map(card).join('')}<div class="proj new" id="newProj2"><div><div class="plus">+</div><div>新建项目</div></div></div></div>`;
  $$('.proj[data-pid]', view).forEach((c) => (c.onclick = () => (location.hash = `#/p/${c.dataset.pid}/data`)));
  $('#newProj').onclick = $('#newProj2').onclick = newProjectModal;
}

function newProjectModal() {
  const st = { source: 'video', name: '', path: '' };
  const m = modal({
    title: '新建项目', sub: '选择素材类型。之后可以随时在“数据准备”里重新上传。', okText: '创建项目',
    body: `<div class="field"><label>项目名称</label><input class="input" data-input="name" placeholder="例如：客厅、雕像、卡车…"></div>
    <div class="opt-cards c3" id="srcCards">
      <div class="opt big on" data-src="video"><div class="ico">${I.video}</div><div><b>视频</b><small>绕物体拍摄的视频，自动抽取清晰帧</small></div></div>
      <div class="opt big" data-src="images"><div class="ico">${I.images}</div><div><b>图片</b><small>一组多角度照片（建议 50–300 张）</small></div></div>
      <div class="opt big" data-src="colmap"><div class="ico">${I.folder}</div><div><b>已有数据集</b><small>COLMAP 格式（images + sparse/0）</small></div></div>
    </div>
    <div class="field" id="pathField" hidden><label>数据集目录</label><input class="input mono" data-input="path" placeholder="例如 C:\\data\\tandt\\truck"><div class="hint">目录下需要有 <span class="mono">images/</span> 和 <span class="mono">sparse/0/</span>，这类数据可以跳过 COLMAP 直接训练。</div></div>`,
    onOk: async () => {
      const p = await POST('/api/projects', { name: st.name, source: st.source, dataset_path: st.path });
      location.hash = `#/p/${p.id}/${p.source === 'colmap' ? 'train' : 'data'}`;
    },
  });
  bindForm(m, st);
  $$('[data-src]', m).forEach((c) => (c.onclick = () => {
    $$('[data-src]', m).forEach((x) => x.classList.toggle('on', x === c));
    st.source = c.dataset.src; $('#pathField', m).hidden = st.source !== 'colmap';
  }));
  setTimeout(() => $('[data-input=name]', m).focus(), 50);
}

/* ====================================================================== step 1: data */
async function viewData(view) {
  const p = S.project;
  const ds = p.dataset;
  setTopbar('数据准备', `${esc(p.name)} · 素材 → 抽帧 → COLMAP 相机位姿`,
    `<button class="btn ghost" data-open>${I.folder}打开项目文件夹</button><button class="btn ghost danger" data-delp>${I.trash}删除项目</button>`);
  $('[data-open]').onclick = () => POST('/api/open-folder', { project: p.id }).catch((e) => toast(e.message, 'err'));
  $('[data-delp]').onclick = async () => {
    const ext = p.dataset.external ? '外部导入的数据集目录不会被删除。' : '';
    if (!(await confirmBox(`删除项目“${p.name}”？`, `项目里的素材、训练结果和导出文件都会被永久删除，无法恢复。${ext}外部导入的训练目录不会被删除。`, '永久删除'))) return;
    try { await DEL(`/api/projects/${p.id}`); S.project = null; toast('项目已删除', 'ok'); location.hash = '#/'; } catch (e) { toast(e.message, 'err'); }
  };

  if (ds.status === 'processing' && ds.job) {
    view.innerHTML = `<div class="grid cols-2"><div class="card"><div class="card-h"><h3>正在处理</h3><span class="sub">抽帧 → 特征提取 → 匹配 → 稀疏重建 → 去畸变</span></div><div class="card-b" id="jm"></div></div><div class="card"><div class="card-h"><h3>抽取的图片</h3><span class="sub" id="fcount"></span></div><div class="card-b"><div class="thumbs" id="thumbs"></div></div></div></div>`;
    let lastFrames = -1;
    const mon = new JobMonitor($('#jm'), ds.job, {
      onUpdate: async (d) => {
        const f = d.stages.find((s) => s.key === 'frames');
        if (f && f.state === 'done' && lastFrames < 0) { lastFrames = 0; loadThumbs(); }
      },
      onDone: async (d) => {
        if (d.status === 'done') toast('数据准备完成', 'ok'); else if (d.status === 'failed') toast('数据准备失败：' + d.error, 'err');
        await reloadProject(); route();
      },
    });
    onCleanup(() => mon.stop());
    const loadThumbs = async () => {
      const fr = await GET(`/api/projects/${p.id}/frames`);
      $('#fcount').textContent = fr.names.length ? `${fr.names.length} 张` : '';
      $('#thumbs').innerHTML = fr.names.map((n) => `<img loading="lazy" src="/api/projects/${p.id}/frame/${fr.dir}/${n}">`).join('');
    };
    return;
  }
  if (ds.status === 'processing') { // job lost (server restarted)
    view.innerHTML = '<div class="banner warn">任务状态丢失，请重新开始处理。</div>';
    return;
  }

  if (ds.status === 'ready') {
    const [fr, cov] = await Promise.all([GET(`/api/projects/${p.id}/frames`), GET(`/api/projects/${p.id}/coverage`).catch(() => null)]);
    const rate = ds.num_frames ? Math.round((ds.num_registered / ds.num_frames) * 100) : 0;
    view.innerHTML = `<div class="stack">
      <div class="next-cta"><div><b>数据集已就绪</b><span>${fmtNum(ds.num_registered)} / ${fmtNum(ds.num_frames)} 张图片成功估计了相机位姿，可以开始训练。</span></div><a class="btn primary lg" href="#/p/${p.id}/train">开始训练 ${I.arrow}</a></div>
      ${coverageCard(cov)}
      <div class="grid" style="grid-template-columns: 340px minmax(0,1fr)">
        <div class="card"><div class="card-h"><h3>数据集</h3>${tag('ready')}</div><div class="card-b stack">
          <div class="info-grid" style="grid-template-columns:1fr 1fr"><div class="stat accent"><div class="k">图片</div><div class="v">${fmtNum(ds.num_frames)}</div></div><div class="stat teal"><div class="k">注册成功</div><div class="v">${fmtNum(ds.num_registered)}<small>${rate}%</small></div></div></div>
          ${rate < 70 ? '<div class="banner warn">注册率偏低：部分图片没有找到相机位姿。可以增加帧数、减少运动模糊，或改用“穷举匹配”重新处理。</div>' : ''}
          <div class="field"><label>位置</label><div class="mono small muted" style="word-break:break-all">${esc(ds.path)}</div></div>
          ${ds.external ? '<div class="small muted">这是外部导入的 COLMAP 数据集，不会被修改或删除。</div>' : `<button class="btn" id="redo">${I.reset}调整参数重新处理</button>`}
        </div></div>
        <div class="card"><div class="card-h"><h3>图片预览</h3><span class="sub">${fr.names.length} 张</span></div><div class="card-b"><div class="thumbs">${fr.names.slice(0, 400).map((n) => `<img loading="lazy" src="/api/projects/${p.id}/frame/${fr.dir}/${n}">`).join('')}</div></div></div>
      </div></div>`;
    const redo = $('#redo');
    if (redo) redo.onclick = () => renderDataForm(view, true);
    return;
  }
  renderDataForm(view, false);
}

function secRanges(secs) {
  const out = [];
  for (let i = 0; i < secs.length; i++) {
    let j = i;
    while (j + 1 < secs.length && secs[j + 1] === secs[j] + 1) j++;
    out.push(i === j ? `${secs[i]}` : `${secs[i]}–${secs[j]}`);
    i = j;
  }
  return out.join('、');
}

/** Timeline of which seconds of the video made it into the reconstruction. */
function coverageCard(cov) {
  if (!cov || !cov.frames?.length) return '';
  const frames = cov.frames;
  const timed = frames.filter((f) => f.t != null);
  if (!timed.length) {
    // photo sets: one dot per image
    const lost = frames.filter((f) => !f.registered).length;
    return `<div class="card"><div class="card-h"><h3>图片注册情况</h3><span class="sub">${frames.length - lost} / ${frames.length} 张进入模型</span></div><div class="card-b"><div class="dots">${frames.map((f) => `<i class="${f.registered ? 'ok' : 'bad'}" title="${esc(f.source || f.name)}${f.registered ? '' : '（未注册）'}"></i>`).join('')}</div></div></div>`;
  }
  const dur = Math.max(cov.duration || 0, ...timed.map((f) => f.t + 0.001));
  const S = Math.ceil(dur);
  const ext = new Array(S).fill(0), reg = new Array(S).fill(0);
  timed.forEach((f) => { const s = Math.min(S - 1, Math.floor(f.t)); ext[s]++; if (f.registered) reg[s]++; });
  const t0 = Math.floor(cov.start || 0), t1 = Math.ceil(cov.end || dur);
  const inClip = (s) => s >= t0 && s < t1;
  const max = Math.max(1, ...ext);
  const lost = [], partial = [];
  for (let s = 0; s < S; s++) {
    if (!inClip(s)) continue;
    if (ext[s] && !reg[s]) lost.push(s); else if (reg[s] < ext[s]) partial.push(s);
  }
  const noFrames = [];
  for (let s = t0; s < Math.min(t1, S); s++) if (!ext[s] && s + 1 <= dur) noFrames.push(s);
  const bars = ext.map((e, s) => {
    const r = reg[s];
    const tip = inClip(s) ? `第 ${s}–${s + 1} 秒：抽取 ${e} 帧，进入模型 ${r} 帧` : `第 ${s} 秒：不在截取范围内`;
    return `<div class="tl-sec ${inClip(s) ? '' : 'out'}" title="${tip}"><div class="tl-bad" style="height:${((e - r) / max) * 100}%"></div><div class="tl-ok" style="height:${(r / max) * 100}%"></div></div>`;
  }).join('');
  const ticks = [];
  const step = S > 120 ? 20 : S > 60 ? 10 : 5;
  for (let s = 0; s <= S; s += step) ticks.push(`<span style="left:${(s / S) * 100}%">${s}s</span>`);
  const covered = ext.filter((e, s) => inClip(s) && reg[s] > 0).length;
  const subs = (cov.submodels || []).filter((m) => m.t0 != null).sort((a, b) => b.n - a.n);
  const ok = !lost.length && !noFrames.length;
  return `<div class="card"><div class="card-h"><h3>时间覆盖</h3><span class="sub">视频的每一秒是否进入了最终的重建</span><div class="right">${ok ? '<span class="tag ok">每一秒都已覆盖</span>' : `<span class="tag err">${lost.length + noFrames.length} 秒缺失</span>`}</div></div>
    <div class="card-b stack">
      <div class="timeline">${bars}</div>
      <div class="tl-axis">${ticks.join('')}</div>
      <div class="row small muted" style="gap:16px"><span><i class="lg-dot ok"></i>进入模型的帧</span><span><i class="lg-dot bad"></i>抽取了但 COLMAP 没能注册的帧</span><span>柱高 = 该秒抽取的帧数</span></div>
      ${ok ? `<div class="small muted">共 ${Math.max(0, covered)} 秒，每一秒都至少有 1 帧参与重建。</div>` : `<div class="banner warn"><div>
        ${lost.length ? `<b>第 ${secRanges(lost)} 秒</b>的画面虽然抽了帧，但没有进入最终模型，重建出来的场景会缺少这些时间段拍到的部分。<br>` : ''}
        ${noFrames.length ? `第 ${secRanges(noFrames)} 秒没有抽到帧（每秒帧数太少）。<br>` : ''}
        ${subs.length > 1 ? `COLMAP 把视频分成了 ${subs.length} 段互不相连的部分：${subs.map((m) => `${m.t0.toFixed(1)}–${m.t1.toFixed(1)} 秒（${m.n} 张）`).join('；')}，只保留了最大的一段。<br>` : ''}
        改进方法：匹配方式选“穷举匹配”；适当提高每秒帧数；拍摄时放慢移动速度，避免画面模糊或只拍到白墙、地面这类缺少纹理的区域。</div></div>`}
    </div></div>`;
}

function renderDataForm(view, redo) {
  const p = S.project, ds = p.dataset;
  const isVideo = p.source === 'video';
  const prev = ds.prepare_opts || {};
  const st = Object.assign({
    frames: 150, max_side: 1600, sharp: true, start: 0, end: 0, sample_mode: 'per_sec', per_sec: 8,
    matcher: 'auto', mapper: 'mapper', camera: 'OPENCV', gpu: true, max_features: 8192, max_image_size: 3200,
  }, prev);
  // settings saved by the previous version had no sample_mode and defaulted videos to sequential
  if (!prev.sample_mode || (st.matcher !== 'sequential' && st.matcher !== 'exhaustive')) st.matcher = 'auto';
  const vi = ds.video;
  const hasUpload = ds.uploads && ds.uploads.length;
  const uploadInfo = () => {
    if (!hasUpload) return '';
    if (isVideo && vi) return `<div class="info-grid" style="margin-top:14px"><div class="stat"><div class="k">时长</div><div class="v">${vi.seconds}<small>秒</small></div></div><div class="stat"><div class="k">帧率</div><div class="v">${vi.fps}<small>fps</small></div></div><div class="stat"><div class="k">分辨率</div><div class="v" style="font-size:16px">${vi.width}×${vi.height}</div></div><div class="stat"><div class="k">总帧数</div><div class="v">${fmtNum(vi.frames)}</div></div></div><div class="small muted" style="margin-top:8px">${esc(vi.original_name)} · ${fmtBytes(ds.uploads[0].size)}</div>`;
    const total = ds.uploads.reduce((a, u) => a + u.size, 0);
    return `<div class="info-grid" style="margin-top:14px"><div class="stat accent"><div class="k">已上传图片</div><div class="v">${ds.uploads.length}</div></div><div class="stat"><div class="k">总大小</div><div class="v" style="font-size:16px">${fmtBytes(total)}</div></div></div>`;
  };
  // effective clip length and resulting frame count for both sampling modes
  const clipLen = () => (vi ? Math.max(0.1, Math.min(st.end || vi.seconds, vi.seconds) - Math.max(0, st.start || 0)) : 0);
  const totalFrames = () => {
    if (!vi) return st.frames;
    const n = st.sample_mode === 'per_sec' ? Math.round(st.per_sec * clipLen()) : st.frames;
    return Math.max(2, Math.min(n, Math.floor(clipLen() * vi.fps)));
  };
  const sampleSummary = () => {
    if (!vi) return '';
    const n = totalFrames(), L = clipLen(), ps = n / L;
    const s0 = Math.max(0, st.start || 0), s1 = Math.min(st.end || vi.seconds, vi.seconds);
    const full = ps >= 1;
    return `<div>将抽取 <b>${n}</b> 帧，平均每秒 <b>${ps.toFixed(1)}</b> 帧，相邻两帧间隔约 ${(L / n).toFixed(2)} 秒。` +
      (full ? `<span style="color:var(--teal)">第 ${s0.toFixed(0)}–${s1.toFixed(1)} 秒的每一秒都会有帧。</span>`
            : '<span style="color:var(--amber)">每秒不到 1 帧，部分秒数会没有画面，建议提高帧数。</span>') +
      `<br>帧在时间上均匀分布：视频被等分成 ${n} 段，每段取一帧${st.sharp ? '（取段内最清晰的一帧）' : '（取段的中点）'}。</div>`;
  };
  view.innerHTML = `<div class="split">
    <div class="stack">
      <div class="card"><div class="card-h"><h3>1 · 上传${isVideo ? '视频' : '图片'}</h3>${tag(hasUpload ? 'uploaded' : 'empty')}</div><div class="card-b">
        <div class="drop" id="drop"><div class="ico">${isVideo ? I.video : I.images}</div><b>${hasUpload ? '重新上传，' : ''}拖放${isVideo ? '视频文件' : '图片或文件夹'}到这里</b><small>${isVideo ? '支持 mp4 / mov / avi / mkv 等常见格式' : '支持 jpg / png / tif / webp，可多选'}，或点击选择</small>
          <input type="file" id="fileIn" hidden ${isVideo ? 'accept="video/*"' : 'accept="image/*" multiple'}>
          ${isVideo ? '' : '<input type="file" id="dirIn" hidden webkitdirectory multiple>'}
        </div>
        ${isVideo ? '' : `<div class="row" style="margin-top:10px"><button class="btn sm" id="pickDir">${I.folder}选择整个文件夹</button><span class="small muted">追加上传会与已上传的图片合并</span>${hasUpload ? '<button class="btn sm ghost" id="clearUp">清空已上传</button>' : ''}</div>`}
        <div class="upload-bar" id="upBar" hidden><div class="row between small"><span id="upTxt">上传中…</span><span id="upPct" class="mono">0%</span></div><div class="prog running" style="margin-top:6px"><i></i></div></div>
        ${uploadInfo()}
        ${ds.status === 'failed' && ds.error ? `<div class="job-err">上次处理失败：${esc(ds.error)}</div>` : ''}
      </div></div>
      <div class="banner"><div><b>拍摄建议：</b>绕物体缓慢走一圈或两圈（高低各一圈更好），保持画面清晰、光照稳定；避免大面积反光、透明物体和运动物体。物体在画面中尽量占较大比例。</div></div>
    </div>
    <div class="card"><div class="card-h"><h3>2 · 处理参数</h3><span class="sub">抽帧 + COLMAP 估计相机位姿</span></div><div class="card-b stack" id="form">
      ${isVideo ? `
        <div class="field"><label>抽帧方式</label>${seg('sample_mode', [['per_sec', '按每秒帧数'], ['total', '按总帧数']], st.sample_mode)}</div>
        <div id="ps" ${st.sample_mode === 'per_sec' ? '' : 'hidden'}>${range('per_sec', '每秒抽取帧数', 1, 30, 1, st.per_sec, (v) => `${v} 帧/秒`)}</div>
        <div id="tot" ${st.sample_mode === 'total' ? '' : 'hidden'}>${range('frames', '抽取总帧数', 20, 600, 10, st.frames, (v) => `${v} 帧`)}</div>
        <div class="banner" id="intv" style="font-size:12.5px;line-height:1.6">${sampleSummary()}</div>
        <div class="hint">物体类场景总共 100–250 帧通常足够；帧数越多，COLMAP 和训练越慢。</div>
        <div class="fields two"><div class="field"><label>开始时间（秒）</label><input class="input" type="number" min="0" step="0.5" data-input="start" value="${st.start}"></div><div class="field"><label>结束时间（秒，0 = 到结尾）</label><input class="input" type="number" min="0" step="0.5" data-input="end" value="${st.end}"></div></div>
        ${sw('sharp', '清晰度优选', '每个时间窗口内挑选最清晰（模糊最少）的一帧', st.sharp)}` : ''}
      <div class="field"><label>图片最长边</label>${seg('max_side', [[1280, '1280'], [1600, '1600（推荐）'], [1920, '1920'], [2560, '2560'], [0, '原始']], st.max_side)}<div class="hint">训练时超过 1600 像素的图片会被自动缩小，过大只会拖慢 COLMAP。</div></div>
      <div class="hr"></div>
      <div class="field"><label>特征匹配方式</label>${seg('matcher', [['auto', '自动（推荐）'], ['exhaustive', '穷举匹配'], ['sequential', '顺序匹配']], st.matcher)}<div class="hint">穷举匹配会两两比较所有图片，画面最不容易“断开”；顺序匹配只比较前后约 30 帧，速度快，但遇到模糊或缺少纹理的片段时，容易把视频切成互不相连的几段。“自动”在 300 张以内用穷举匹配，超过时用顺序匹配。</div></div>
      <details class="adv"><summary>高级 COLMAP 参数</summary><div class="inner">
        <div class="field"><label>重建算法</label>${seg('mapper', [['mapper', '增量式（稳健）'], ['global_mapper', '全局式（快速）']], st.mapper)}</div>
        <div class="field"><label>相机模型</label>${seg('camera', [['OPENCV', 'OPENCV'], ['SIMPLE_RADIAL', 'SIMPLE_RADIAL'], ['PINHOLE', 'PINHOLE']], st.camera)}<div class="hint">手机/相机拍摄用 OPENCV（含镜头畸变）；已去畸变的图片可用 PINHOLE。</div></div>
        <div class="field"><label>单张特征点上限</label>${seg('max_features', [[4096, '4096'], [8192, '8192'], [16384, '16384']], st.max_features)}</div>
        ${sw('gpu', 'GPU 加速', '使用 CUDA 进行特征提取和匹配', st.gpu)}
      </div></details>
      <button class="btn primary lg" id="go" ${hasUpload ? '' : 'disabled'}>${I.play}开始处理</button>
      ${redo ? '<button class="btn ghost" id="back">返回</button>' : ''}
    </div></div>
  </div>`;
  bindForm($('#form'), st, (k, v) => {
    if (k === 'sample_mode') { $('#ps').hidden = v !== 'per_sec'; $('#tot').hidden = v !== 'total'; }
    const e = $('#intv'); if (e) e.innerHTML = sampleSummary();
  });
  const fileIn = $('#fileIn'), drop = $('#drop');
  drop.onclick = (e) => { if (e.target.closest('input')) return; fileIn.click(); };
  fileIn.onchange = () => doUpload([...fileIn.files]);
  if (!isVideo) {
    $('#pickDir').onclick = () => $('#dirIn').click();
    $('#dirIn').onchange = () => doUpload([...$('#dirIn').files]);
    const cu = $('#clearUp');
    if (cu) cu.onclick = async () => {
      try { await DEL(`/api/projects/${p.id}/uploads`); toast('已清空', 'ok'); await reloadProject(); renderDataForm(view, redo); } catch (e) { toast(e.message, 'err'); }
    };
  }
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); doUpload([...e.dataTransfer.files]); };
  $('#go').onclick = async () => {
    try { await POST(`/api/projects/${p.id}/prepare`, { ...st, frames: totalFrames() }); await reloadProject(); route(); } catch (e) { toast(e.message, 'err'); }
  };
  const back = $('#back'); if (back) back.onclick = () => route();

  function doUpload(files) {
    if (!files.length) return;
    if (isVideo && !/^video\//.test(files[0].type) && !/\.(mp4|mov|avi|mkv|m4v|webm|wmv|flv|mpe?g)$/i.test(files[0].name)) { toast('请选择视频文件', 'err'); return; }
    if (!isVideo) files = files.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|tif+|webp|bmp)$/i.test(f.name));
    if (!files.length) { toast('没有可用的图片文件', 'err'); return; }
    const fd = new FormData();
    (isVideo ? files.slice(0, 1) : files).forEach((f) => fd.append('files', f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${p.id}/upload`);
    $('#upBar').hidden = false;
    const total = files.reduce((a, f) => a + f.size, 0);
    xhr.upload.onprogress = (e) => {
      const pct = e.lengthComputable ? (e.loaded / e.total) * 100 : 0;
      $('#upPct').textContent = pct.toFixed(0) + '%';
      $('#upTxt').textContent = `上传中 ${fmtBytes(e.loaded)} / ${fmtBytes(total)}`;
      $('#upBar i').style.width = pct + '%';
    };
    xhr.onload = async () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 300 || j.ok === false) { toast(j.error || j.detail || '上传失败', 'err'); $('#upBar').hidden = true; return; }
      toast('上传完成', 'ok'); await reloadProject(); renderDataForm(view, redo);
    };
    xhr.onerror = () => toast('上传失败', 'err');
    xhr.send(fd);
  }
}

/* ====================================================================== step 2: train */
const PRESETS = {
  fast: { label: '快速预览', desc: '最快出结果，网格较粗', time: '≈25–35 分钟', p: { mesh_config: 'lowres', dense_gaussians: false, decoupled_appearance: false, sampling_factor: 0.3, data_device: 'cuda' } },
  std: { label: '标准', desc: '官方默认配置，速度与质量均衡', time: '≈30–50 分钟', p: { mesh_config: 'default', dense_gaussians: false, decoupled_appearance: false, sampling_factor: 0.6, data_device: 'cuda' } },
  hq: { label: '高质量', desc: '稠密高斯 + 高分辨率网格 + 外观解耦', time: '≈1–1.5 小时', p: { mesh_config: 'highres', dense_gaussians: true, decoupled_appearance: true, sampling_factor: 0.6, data_device: 'cpu' } },
  ultra: { label: '极致', desc: '最高网格分辨率，显存需求最大', time: '≈1.5–2.5 小时', p: { mesh_config: 'veryhighres', dense_gaussians: true, decoupled_appearance: true, sampling_factor: 0.6, data_device: 'cpu' } },
};
const MESH_CFG_LABEL = { verylowres: '极低（≤25 万点）', lowres: '低（≤50 万点）', default: '默认（≈200 万点）', highres: '高（≤900 万点）', veryhighres: '极高（≤1400 万点）' };

async function viewTrain(view) {
  const p = S.project;
  if (!S.options) S.options = await GET('/api/options');
  setTopbar('场景训练', `${esc(p.name)} · 高斯泼溅 + Mesh-in-the-Loop 网格正则化`,
    `<button class="btn" id="importRun">${I.import}导入已有训练结果</button>`);
  $('#importRun').onclick = importRunModal;

  const running = p.runs.find((r) => r.status === 'running' || r.status === 'queued');
  let sel = S.selRun && p.runs.find((r) => r.id === S.selRun) ? S.selRun : (running || p.runs[0])?.id;
  const st = Object.assign({}, S.options.train_defaults, PRESETS.std.p, { preset: 'std', name: '' });
  const dsReady = p.dataset.status === 'ready';

  view.innerHTML = `<div class="split">
    <div class="stack">
      <div class="card"><div class="card-h"><h3>训练参数</h3></div><div class="card-b stack" id="tform">
        ${dsReady ? '' : '<div class="banner warn">数据集还没准备好，请先完成“数据准备”。</div>'}
        <div class="field" id="nameF"><label>名称（可选）</label><input class="input" data-input="name" placeholder="例如：高质量-第一版"></div>
        <div class="field"><label>质量预设</label><div class="opt-cards c2" id="presets">${Object.entries(PRESETS).map(([k, v]) => `<div class="opt ${k === st.preset ? 'on' : ''}" data-preset="${k}"><b>${v.label}</b><small>${v.desc}</small><div class="meta"><span>${v.time}</span></div></div>`).join('')}</div><div class="hint">耗时按 RTX 4060 Ti、约 250 张图估算，实际取决于场景和图片数量。</div></div>
        <div class="field" id="impF"><label>场景类型</label>${seg('imp_metric', [['outdoor', '室外 / 物体环绕'], ['indoor', '室内']], st.imp_metric)}<div class="hint">影响高斯重要性采样的方式。拍摄室外物体或开放场景选“室外”。</div></div>
        <div id="core"></div>
        <details class="adv"><summary>高级参数</summary><div class="inner" id="adv"></div></details>
        <button class="btn primary lg" id="start" ${dsReady ? '' : 'disabled'}>${I.play}开始训练</button>
        <div class="small muted" style="text-align:center">总迭代数固定为 18,000（MILo fast 配置）；网格正则化从约第 8,000 次迭代开始。</div>
      </div></div>
    </div>
    <div class="stack">
      <div id="runPanel"></div>
      <div class="card"><div class="card-h"><h3>训练记录</h3><span class="sub">${p.runs.length} 个</span></div><div class="list" id="runList"></div></div>
    </div>
  </div>`;

  const renderCore = () => {
    $('#core').innerHTML = `<div class="stack">
      <div class="field"><label>网格分辨率（mesh_config）</label><select class="input" data-sel="mesh_config">${S.options.mesh_configs.filter((c) => MESH_CFG_LABEL[c]).map((c) => `<option value="${c}" ${c === st.mesh_config ? 'selected' : ''}>${MESH_CFG_LABEL[c]} · ${c}</option>`).join('')}</select><div class="hint">训练时 Delaunay 网格顶点数的上限，直接决定最终网格能表现多少细节。高 / 极高建议配合“稠密高斯”。</div></div>
      ${sw('dense_gaussians', '稠密高斯（dense_gaussians）', '使用更多高斯基元，细节更好，显存和时间增加', st.dense_gaussians)}
      ${sw('decoupled_appearance', '外观解耦（decoupled_appearance）', '补偿不同照片之间的曝光、白平衡差异，室外场景推荐开启', st.decoupled_appearance)}
    </div>`;
    $('#adv').innerHTML = `
      <div class="field"><label>光栅化器</label>${seg('rasterizer', [['radegs', 'RaDe-GS（推荐）'], ['gof', 'GOF']], st.rasterizer)}</div>
      ${range('sampling_factor', '高斯采样系数（sampling_factor）', 0.1, 1, 0.05, st.sampling_factor, (v) => v.toFixed(2))}
      <div class="hint">控制高斯数量。数值越小训练越快、模型越轻，0.1–0.3 适合快速预览。</div>
      <div class="field"><label>图片存放位置（data_device）</label>${seg('data_device', [['cuda', '显存（更快）'], ['cpu', '内存（省显存）']], st.data_device)}<div class="hint">图片多或分辨率高时选“内存”，可以避免显存不足。</div></div>
      <div class="field"><label>训练分辨率（-r）</label>${seg('resolution', [[-1, '自动'], [1, '原始'], [2, '1/2'], [4, '1/4'], [8, '1/8']], st.resolution)}<div class="hint">“自动”会把宽度超过 1600 像素的图片缩小到 1600。</div></div>
      <div class="field"><label>球谐阶数（sh_degree）</label>${seg('sh_degree', [[0, '0'], [1, '1'], [2, '2'], [3, '3']], st.sh_degree)}<div class="hint">用来表达随视角变化的颜色（例如反光），3 阶效果最好。</div></div>
      <div class="field"><label>训练快照间隔</label>${seg('log_interval', [[0, '关闭'], [250, '250'], [500, '500'], [1000, '1000']], st.log_interval)}<div class="hint">每隔 N 次迭代保存一张渲染、深度、法线的对比图，可以在右侧实时查看。</div></div>
      ${sw('mesh_regularization', '网格正则化（Mesh-in-the-Loop）', 'MILo 的核心：训练时提取网格并约束高斯。关闭后就退化为普通 3DGS。', st.mesh_regularization)}
      ${sw('white_background', '白色背景', '数据集为白底物体时开启', st.white_background)}
      ${sw('depth_order', '深度顺序正则化（depth_order）', S.system?.depth_anything ? '用 Depth-Anything-V2 的单目深度约束几何' : '需要先下载 Depth-Anything-V2 vitl 权重（约 1.3GB）', st.depth_order, !S.system?.depth_anything)}`;
    bindForm($('#core'), st);
    bindForm($('#adv'), st);
    $$('[data-sel]', $('#core')).forEach((s) => (s.onchange = () => (st[s.dataset.sel] = s.value)));
  };
  renderCore();
  bindForm($('#nameF'), st);
  bindForm($('#impF'), st);
  $$('[data-preset]').forEach((c) => (c.onclick = () => {
    $$('[data-preset]').forEach((x) => x.classList.toggle('on', x === c));
    st.preset = c.dataset.preset; Object.assign(st, PRESETS[st.preset].p); renderCore();
  }));
  $('#start').onclick = async () => {
    const params = { ...st }; delete params.preset; delete params.name;
    try {
      const r = await POST(`/api/projects/${p.id}/runs`, { name: st.name || `${PRESETS[st.preset].label} · ${fmtTime(Date.now() / 1000)}`, params });
      S.selRun = r.run.id; toast('训练任务已提交', 'ok'); await reloadProject(); route();
    } catch (e) { toast(e.message, 'err'); }
  };

  const renderList = () => {
    const pr = S.project;
    $('#runList').innerHTML = pr.runs.length ? pr.runs.map((r) => `<div class="li ${r.id === sel ? 'sel' : ''}" data-rid="${r.id}"><div><div class="t">${pr.default_run === r.id ? `<span class="star" title="默认模型">${I.star}</span>` : ''}<span class="n">${esc(r.name)}</span></div><div class="s">${fmtTime(r.created)} · ${MESH_CFG_LABEL[r.params.mesh_config] || r.params.mesh_config}${r.params.dense_gaussians ? ' · 稠密' : ''}${r.metrics?.psnr ? ` · PSNR ${r.metrics.psnr.toFixed(2)}` : ''}${r.external ? ' · 外部导入' : ''}</div></div>${tag(r.status)}</div>`).join('') : '<div class="empty-note">还没有训练记录</div>';
    $$('[data-rid]', $('#runList')).forEach((li) => (li.onclick = () => { sel = S.selRun = li.dataset.rid; renderList(); renderRun(); }));
  };
  let mon = null;
  onCleanup(() => mon && mon.stop());
  const renderRun = () => {
    mon && mon.stop(); mon = null;
    const r = S.project.runs.find((x) => x.id === sel);
    const panel = $('#runPanel');
    if (!r) { panel.innerHTML = `<div class="card"><div class="card-b"><div class="empty-note" style="padding:60px 20px">${I.cube.replace('<svg', '<svg style="width:56px;height:56px;stroke:var(--line-2);fill:none;stroke-width:1.2"')}<div style="margin-top:10px">在左侧选择参数，开始第一次训练</div></div></div></div>`; return; }
    const chips = [MESH_CFG_LABEL[r.params.mesh_config] || r.params.mesh_config, r.params.imp_metric === 'indoor' ? '室内' : '室外', r.params.rasterizer === 'gof' ? 'GOF' : 'RaDe-GS', r.params.dense_gaussians ? '稠密高斯' : null, r.params.decoupled_appearance ? '外观解耦' : null, `采样 ${r.params.sampling_factor}`].filter(Boolean);
    panel.innerHTML = `<div class="card"><div class="card-h"><h3>${esc(r.name)}</h3>${tag(r.status)}<div class="right">
        ${r.status === 'done' ? `<a class="btn sm" href="#/p/${S.project.id}/preview">${I.cube}预览场景</a><a class="btn sm primary" href="#/p/${S.project.id}/export">导出模型 ${I.arrow}</a>` : ''}
        <button class="icon-btn" title="打开文件夹" data-of>${I.folder}</button>${r.status !== 'running' && r.status !== 'queued' ? `<button class="icon-btn" title="删除" data-del>${I.trash}</button>` : ''}</div></div>
      <div class="card-b"><div class="row" style="margin-bottom:12px">${chips.map((c) => `<span class="tag">${esc(c)}</span>`).join('')}</div>
        <div id="jobBox"></div>
        <div class="kpis" id="kpis"></div>
        <div class="grid cols-2" style="margin-top:16px">
          <div><div style="margin-bottom:8px"><b class="small">损失曲线</b><span class="small muted">（越低越好；鼠标停在图例上看含义，点击可隐藏）</span></div><div class="legend" id="legend" style="margin-bottom:6px"></div><canvas class="chart" id="chart"></canvas></div>
          <div><div class="row between" style="margin-bottom:8px"><b class="small">训练快照</b><span class="small muted" id="snapLbl"></span></div><div class="snap" id="snap"><div class="empty-note">训练快照会在这里显示</div></div><input type="range" id="snapRange" min="0" max="0" value="0" style="margin-top:6px" hidden></div>
        </div>
        ${r.error && r.status !== 'done' && r.status !== 'running' ? `<div class="job-err">${esc(r.error)}</div>` : ''}
      </div></div>`;
    $('[data-of]', panel).onclick = () => POST('/api/open-folder', { project: S.project.id, run: r.id }).catch((e) => toast(e.message, 'err'));
    const del = $('[data-del]', panel);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('删除这个训练结果？', r.external ? '外部导入的目录不会被删除，只移除记录。' : '训练输出文件会被永久删除，无法恢复。', '删除'))) return;
      await DEL(`/api/projects/${S.project.id}/runs/${r.id}`); sel = S.selRun = null; await reloadProject(); route();
    };
    const hidden = new Set();
    let series = r.series || {}, marker = { total: r.metrics?.total || 18000, mesh_start: 8001 };
    const redraw = () => {
      drawChart($('#chart'), series, { marker, hidden });
      $('#legend').innerHTML = Object.keys(series).map((n) => `<span class="${hidden.has(n) ? 'off' : ''}" data-s="${n}" title="${esc(LOSS_INFO[n] || n)}"><i style="background:${SERIES_COLORS[n] || '#aaa'}"></i>${n}<small class="muted">${LOSS_SHORT[n] ? ' ' + LOSS_SHORT[n] : ''}</small></span>`).join('');
      $$('[data-s]', $('#legend')).forEach((s) => (s.onclick = () => { hidden.has(s.dataset.s) ? hidden.delete(s.dataset.s) : hidden.add(s.dataset.s); redraw(); }));
    };
    const kpi = (m, live) => {
      const it = m.iteration ?? r.iteration;
      const items = [
        ['迭代', it != null ? `${fmtNum(it)}<small>/ ${fmtNum(m.total || 18000)}</small>` : '—', 'accent'],
        live ? ['速度', m.rate ? esc(m.rate) : '—'] : ['用时', fmtDur(r.duration)],
        live ? ['剩余时间', m.eta ? esc(m.eta) : '—'] : ['PSNR', m.psnr ? m.psnr.toFixed(2) + '<small>dB</small>' : '—', 'teal'],
        ['Loss', m.loss_Loss != null ? Number(m.loss_Loss).toFixed(4) : '—'],
      ];
      if (live && m.loss_N_Gauss) items.push(['高斯数量', fmtNum(m.loss_N_Gauss)]);
      if (live && m.psnr) items.push(['PSNR', m.psnr.toFixed(2) + '<small>dB</small>', 'teal']);
      $('#kpis').innerHTML = items.map(([k, v, c]) => `<div class="stat ${c || ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    };
    let snaps = [], followLatest = true;
    const loadSnaps = async () => {
      try { snaps = await GET(`/api/projects/${S.project.id}/runs/${r.id}/snapshots`); } catch { return; }
      const rg = $('#snapRange'); if (!rg) return;
      if (!snaps.length) return;
      rg.hidden = false; rg.max = snaps.length - 1;
      if (followLatest) rg.value = snaps.length - 1;
      showSnap(Number(rg.value));
    };
    const showSnap = (i) => {
      const s = snaps[i]; if (!s) return;
      $('#snap').innerHTML = `<img src="/api/projects/${S.project.id}/runs/${r.id}/files/${s.name}?t=${s.iteration}"><span class="tag info cap">迭代 ${fmtNum(s.iteration)}</span>`;
      $('#snapLbl').textContent = `${i + 1} / ${snaps.length}`;
      const rg = $('#snapRange'); rg.style.setProperty('--p', (i / Math.max(1, snaps.length - 1)) * 100 + '%');
    };
    $('#snapRange').oninput = (e) => { followLatest = Number(e.target.value) === snaps.length - 1; showSnap(Number(e.target.value)); };
    if (r.status === 'running' || r.status === 'queued') {
      let lastSnapCheck = 0;
      mon = new JobMonitor($('#jobBox'), r.job, {
        onUpdate: (d) => {
          series = d.series || series;
          marker = { total: d.metrics.total || 18000, mesh_start: d.metrics.mesh_start || 8001 };
          kpi(d.metrics, true); redraw();
          if (Date.now() - lastSnapCheck > 8000) { lastSnapCheck = Date.now(); loadSnaps(); }
        },
        onDone: async (d) => {
          toast(d.status === 'done' ? '训练完成！' : d.status === 'canceled' ? '训练已取消' : '训练失败：' + d.error, d.status === 'done' ? 'ok' : 'err');
          await reloadProject(); route();
        },
      });
    } else {
      kpi(r.metrics || {}, false); redraw(); loadSnaps();
    }
    new ResizeObserver(() => redraw()).observe($('#chart'));
  };
  renderList(); renderRun();
}

function importRunModal() {
  const st = { path: '', name: '', mesh_config: 'default', rasterizer: 'radegs', imp_metric: 'outdoor' };
  const m = modal({
    title: '导入已有训练结果', sub: '把之前用命令行训练好的 MILo 输出目录加入这个项目，用于预览和导出。', okText: '导入',
    body: `<div class="field"><label>训练输出目录（-m 的路径）</label><input class="input mono" data-input="path" placeholder="例如 C:\\Users\\...\\MILo\\output\\truck_test"><div class="hint">目录里需要有 cfg_args 和 point_cloud/iteration_*/point_cloud.ply。</div></div>
      <div class="field"><label>名称</label><input class="input" data-input="name" placeholder="默认使用目录名"></div>
      <div class="field"><label>训练时使用的网格配置（--mesh_config）</label>${seg('mesh_config', Object.keys(MESH_CFG_LABEL).map((k) => [k, k]), st.mesh_config)}<div class="hint">cfg_args 里没有记录这一项。导出时会按它决定 Delaunay 点数的上限，请选择训练时用的配置。</div></div>
      <div class="field"><label>光栅化器</label>${seg('rasterizer', [['radegs', 'RaDe-GS'], ['gof', 'GOF']], st.rasterizer)}</div>`,
    onOk: async () => {
      const r = await POST(`/api/projects/${S.project.id}/runs/import`, { path: st.path, name: st.name, params: { mesh_config: st.mesh_config, rasterizer: st.rasterizer } });
      S.selRun = r.id; toast('已导入', 'ok'); await reloadProject(); route();
    },
  });
  bindForm(m, st);
}

/* ====================================================================== step 3: preview */
function doneRuns(p) { return p.runs.filter((r) => r.status === 'done'); }
function defaultRunId(p) {
  const done = doneRuns(p);
  return (done.find((r) => r.id === p.default_run) || done[0])?.id;
}

async function viewPreview(view) {
  const p = S.project;
  const runs = doneRuns(p);
  setTopbar('场景预览', `${esc(p.name)} · 实时渲染训练得到的 3D 高斯场景`);
  view.className = 'view full';
  if (!runs.length) { view.innerHTML = '<div class="vp-empty"><div>还没有完成的训练结果</div></div>'; return; }
  let rid = S.previewRun && runs.find((r) => r.id === S.previewRun) ? S.previewRun : defaultRunId(p);
  const st = { fov: 50, auto: false, cam: 0 };
  view.innerHTML = `<div class="split-wide">
    <div class="panel-l">
      <div class="sec"><h4>训练结果</h4><div class="list" id="pruns" style="margin:0 -18px"></div></div>
      <div class="sec"><h4>默认模型</h4><div class="small muted">导出步骤会默认使用带 <span class="star">${I.star}</span> 标记的模型。</div><button class="btn" id="setDef">${I.star} 设为默认模型</button></div>
      <div class="sec" id="viewCtl"><h4>视角</h4>
        ${range('cam', '跳转到训练相机', 0, 1, 1, 0, (v) => `#${v + 1}`)}
        ${range('fov', '视场角（FOV）', 20, 100, 1, st.fov, (v) => v + '°')}
        ${sw('auto', '自动环绕', '围绕场景中心缓慢旋转', false)}
        <div class="row"><button class="btn" id="resetV">${I.reset}重置视角</button><button class="btn" id="shot">${I.camera}保存截图</button></div>
      </div>
      <div class="sec"><h4>模型信息</h4><div class="info-grid" id="minfo" style="grid-template-columns:1fr 1fr"></div></div>
      <div class="foot"><a class="btn primary lg" style="width:100%" href="#/p/${p.id}/export">用这个模型导出网格 ${I.arrow}</a></div>
    </div>
    <div class="stage-area"><div class="viewport bg-dark" id="vp"></div>
      <div class="vp-help">左键拖动：旋转 · 右键拖动：平移 · 滚轮：缩放 · WASD/方向键也可移动</div>
      <div class="vp-loading" id="vpl"><div class="box"><b id="vplT">正在加载高斯场景…</b><div class="prog running"><i></i></div><div class="small muted" id="vplS" style="margin-top:8px"></div></div></div>
    </div>
  </div>`;
  const listRuns = () => {
    $('#pruns').innerHTML = runs.map((r) => `<div class="li ${r.id === rid ? 'sel' : ''}" data-r="${r.id}"><div><div class="t">${S.project.default_run === r.id || (!S.project.default_run && r === runs[0]) ? `<span class="star">${I.star}</span>` : ''}<span class="n">${esc(r.name)}</span></div><div class="s">${fmtTime(r.created)} · ${MESH_CFG_LABEL[r.params.mesh_config] || r.params.mesh_config}${r.metrics?.psnr ? ' · PSNR ' + r.metrics.psnr.toFixed(2) : ''}</div></div></div>`).join('');
    $$('[data-r]', $('#pruns')).forEach((li) => (li.onclick = () => { if (li.dataset.r !== rid) { S.previewRun = li.dataset.r; route(); } }));
  };
  listRuns();
  $('#setDef').onclick = async () => { await PATCH(`/api/projects/${p.id}`, { default_run: rid }); await reloadProject(); listRuns(); toast('已设为默认模型', 'ok'); };

  const scene = await GET(`/api/projects/${p.id}/runs/${rid}/scene`);
  const vp = $('#vp');
  const sv = new SplatViewer(vp, {
    onProgress: (pct, label) => {
      const l = $('#vpl'); if (!l) return;
      $('#vplS').textContent = `${label || ''}`;
      $('#vpl i').style.width = (pct || 0) + '%';
    },
  });
  onCleanup(() => sv.dispose());
  const r = runs.find((x) => x.id === rid);
  $('#minfo').innerHTML = `<div class="stat"><div class="k">迭代</div><div class="v">${fmtNum(scene.iteration)}</div></div><div class="stat"><div class="k">文件大小</div><div class="v" style="font-size:16px">${fmtBytes(scene.ply_size)}</div></div><div class="stat"><div class="k">训练相机</div><div class="v">${scene.cameras.length}</div></div><div class="stat teal"><div class="k">PSNR</div><div class="v">${r.metrics?.psnr ? r.metrics.psnr.toFixed(2) : '—'}</div></div>`;
  const camR = $('[data-range=cam]'); camR.max = Math.max(0, scene.cameras.length - 1);
  bindForm($('#viewCtl'), st, (k, v) => {
    if (k === 'cam') sv.goTrainingCamera(v);
    if (k === 'fov') sv.setFov(v);
    if (k === 'auto') sv.setAutoRotate(v);
  }, { cam: (v) => `#${v + 1} ${scene.cameras[v]?.name || ''}`, fov: (v) => v + '°' });
  $('#resetV').onclick = () => sv.resetView();
  $('#shot').onclick = () => { const d = sv.screenshot(); if (d) download(d, `${S.project.name}_${Date.now()}.png`); };
  try {
    await sv.load(scene);
    $('#vpl')?.remove();
    // count splats
    try {
      const n = sv.viewer.getSplatMesh().getSplatCount();
      $('#minfo').insertAdjacentHTML('afterbegin', `<div class="stat accent" style="grid-column:1/-1"><div class="k">高斯数量</div><div class="v">${fmtNum(n)}</div></div>`);
    } catch { /* */ }
  } catch (e) {
    console.error(e);
    $('#vplT').textContent = '加载失败：' + e.message;
  }
}

/* ====================================================================== step 4: export */
const STYLES = [['color', '原色'], ['unlit', '原色·无光照'], ['clay', '白模'], ['normal', '法线'], ['elevation', '高度'], ['wire', '线框'], ['colorwire', '原色+线框'], ['xray', 'X 光']];
const FACE_PRESETS = [[0, '保持原始'], [2000000, '200 万'], [500000, '50 万'], [100000, '10 万'], [-1, '自定义']];

async function viewExport(view) {
  const p = S.project;
  if (!S.options) S.options = await GET('/api/options');
  const runs = doneRuns(p);
  setTopbar('模型导出', `${esc(p.name)} · 网格提取 → 后处理 → 多格式导出`);
  view.className = 'view full';
  if (!runs.length) { view.innerHTML = '<div class="vp-empty"><div>还没有完成的训练结果，请先完成训练</div></div>'; return; }
  const st = Object.assign({}, S.options.export_defaults, { run: defaultRunId(p), name: '', faces_preset: 0, custom_faces: 300000 });
  st.formats = [...st.formats];
  let selExport = S.selExport && p.exports.find((e) => e.id === S.selExport) ? S.selExport : (p.exports.find((e) => e.status === 'running' || e.status === 'queued') || p.exports.find((e) => e.status === 'done') || p.exports[0])?.id;
  const vs = { style: 'color', light: 'studio', bg: 'dark', exposure: 1.0, grid: true, axes: false, flat: false, auto: false };

  view.innerHTML = `<div class="split-wide">
    <div class="panel-l" id="eform">
      <div class="sec"><h4>源模型</h4><select class="input" data-sel="run">${runs.map((r) => `<option value="${r.id}" ${r.id === st.run ? 'selected' : ''}>${(p.default_run === r.id ? '★ ' : '') + esc(r.name)}</option>`).join('')}</select></div>
      <div class="sec"><h4>网格提取方法</h4>
        <div class="opt-cards" id="methods">
          <div class="opt" data-m="sdf"><b>SDF 精细化</b><small>MILo 原生方法：在训练得到的 Delaunay 网格上继续优化 SDF，细节最好</small></div>
          <div class="opt" data-m="integration"><b>高斯积分 SDF</b><small>直接对高斯积分求 SDF 再用四面体 Marching，更快</small></div>
          <div class="opt" data-m="tsdf"><b>规则 TSDF 融合</b><small>渲染深度后做体素融合，表面更平滑但细节较少</small></div>
        </div>
        <div id="mparams"></div>
      </div>
      <div class="sec" id="post"><h4>后处理</h4>
        ${sw('crop_on', '自动裁剪', '只保留相机围绕的主体区域，去掉远处背景和天空碎片', st.crop === 'auto')}
        <div id="cropS">${range('crop_scale', '裁剪半径（× 相机距离）', 0.4, 3, 0.05, st.crop_scale, (v) => v.toFixed(2) + '×')}</div>
        <div class="field"><label>坐标系</label>${seg('axis', [['zup', 'Z 轴朝上'], ['yup', 'Y 轴朝上'], ['orig', '原始 COLMAP']], st.axis)}<div class="hint">Z 轴朝上：Blender、3ds Max、UE；Y 轴朝上：Unity、Maya、three.js。GLB 文件始终按 glTF 规范使用 Y 轴朝上，导入 Blender 时会自动转换。</div></div>
        ${range('min_component', '去除小碎片（面数 &lt;）', 0, 20000, 100, st.min_component, (v) => (v ? fmtNum(v) + ' 面' : '不去除'))}
        ${range('smooth', '表面平滑（Taubin 迭代）', 0, 30, 1, st.smooth, (v) => (v ? v + ' 次' : '关闭'))}
        <div class="field"><label>减面（目标面数）</label>${seg('faces_preset', FACE_PRESETS, st.faces_preset)}<input class="input" type="number" data-input="custom_faces" value="${st.custom_faces}" min="1000" step="1000" id="customFaces" hidden style="margin-top:6px"></div>
      </div>
      <div class="sec" id="outs"><h4>输出</h4>
        <div class="field"><label>格式</label><div class="checks">${['ply', 'obj', 'glb', 'stl'].map((f) => `<label class="check"><input type="checkbox" data-fmt="${f}" ${st.formats.includes(f) ? 'checked' : ''}>${f.toUpperCase()}</label>`).join('')}</div><div class="hint">PLY / GLB 保存顶点颜色；OBJ 以扩展格式写入顶点颜色；STL 只有几何。</div></div>
        ${sw('colors', '顶点颜色', '把训练得到的颜色写入网格', st.colors)}
        <div class="field"><label>文件名</label><input class="input mono" data-input="basename" value="${esc(st.basename)}"></div>
        ${sw('reuse_cache', '复用已提取的原始网格', '同一模型、同一提取参数只需提取一次，之后调整后处理参数可秒级导出', st.reuse_cache)}
      </div>
      <div class="foot"><button class="btn primary lg" style="width:100%" id="go">${I.play}开始导出</button></div>
    </div>
    <div class="stage-area">
      <div class="viewport bg-dark" id="vp" style="flex:1">
      <div class="vp-toolbar" id="styles">${STYLES.map(([k, l]) => `<button data-style="${k}" class="${k === vs.style ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="vp-side" id="side">
        <button data-act="reset" title="重置视角">${I.reset}</button>
        <button data-act="top" title="俯视">${I.top}</button>
        <button data-tg="grid" class="on" title="地面网格">${I.grid}</button>
        <button data-tg="axes" title="坐标轴">${I.axes}</button>
        <button data-tg="flat" title="平面着色">${I.flat}</button>
        <button data-tg="auto" title="自动旋转">${I.rotate}</button>
        <button data-act="shot" title="截图">${I.camera}</button>
      </div>
      <div class="vp-info" id="vinfo"></div>
      <div class="vp-help" id="dispCtl" style="display:grid;gap:8px;width:250px;bottom:auto;top:64px;right:64px;padding:12px" hidden></div>
      </div>
      <div class="vp-bottom" style="padding:0;align-items:stretch;height:300px">
        <div style="flex:1.25;padding:14px 18px;overflow:auto;border-right:1px solid var(--line)" id="eJob"></div>
        <div style="flex:1;overflow:auto;display:flex;flex-direction:column"><div class="row between" style="padding:12px 16px 8px"><b class="small">导出记录</b><button class="btn sm ghost" id="dispBtn">显示设置</button></div><div class="list" id="exList"></div></div>
      </div>
    </div>
  </div>`;

  // --- form
  const form = $('#eform');
  const renderMethod = () => {
    $$('[data-m]', form).forEach((c) => c.classList.toggle('on', c.dataset.m === st.method));
    const mp = $('#mparams');
    if (st.method === 'sdf') mp.innerHTML = range('refine_iter', 'SDF 精细化迭代次数', 200, 3000, 100, st.refine_iter, (v) => fmtNum(v)) + '<div class="hint">越多表面越精细，耗时大致线性增加（1000 次约 10–15 分钟）。</div>';
    else if (st.method === 'integration') mp.innerHTML = `<div class="field"><label>SDF 来源</label>${seg('sdf_mode', [['integration', '高斯积分'], ['depth_fusion', '深度融合']], st.sdf_mode)}</div>`;
    else mp.innerHTML = `<div class="field"><label>体素分辨率</label>${seg('tsdf_res', [[512, '512'], [1024, '1024'], [2048, '2048']], st.tsdf_res)}<div class="hint">2048 细节更多，但内存占用约为 1024 的 8 倍。</div></div>${range('tsdf_clusters', '保留最大的连通块数', 1, 200, 1, st.tsdf_clusters)}`;
    bindForm(mp, st, null, { refine_iter: (v) => fmtNum(v) });
  };
  $$('[data-m]', form).forEach((c) => (c.onclick = () => { st.method = c.dataset.m; renderMethod(); }));
  renderMethod();
  bindForm($('#post'), st, (k, v) => {
    if (k === 'crop_on') { st.crop = v ? 'auto' : 'none'; $('#cropS').style.display = v ? '' : 'none'; }
    if (k === 'faces_preset') $('#customFaces').hidden = v !== -1;
  }, { crop_scale: (v) => v.toFixed(2) + '×', min_component: (v) => (v ? fmtNum(v) + ' 面' : '不去除'), smooth: (v) => (v ? v + ' 次' : '关闭') });
  bindForm($('#outs'), st);
  $('[data-sel=run]', form).onchange = (e) => (st.run = e.target.value);
  $$('[data-fmt]', form).forEach((c) => (c.onchange = () => { st.formats = $$('[data-fmt]', form).filter((x) => x.checked).map((x) => x.dataset.fmt); }));
  $('#go').onclick = async () => {
    if (!st.formats.length) { toast('请至少选择一种输出格式', 'err'); return; }
    const target_faces = st.faces_preset === -1 ? Number(st.custom_faces) : st.faces_preset;
    const params = { ...st, target_faces }; ['run', 'name', 'faces_preset', 'custom_faces', 'crop_on'].forEach((k) => delete params[k]);
    try {
      const r = await POST(`/api/projects/${p.id}/exports`, { run: st.run, name: `${S.options.methods[st.method].split('（')[0]} · ${fmtTime(Date.now() / 1000)}`, params });
      S.selExport = r.export.id; selExport = r.export.id; toast('导出任务已提交', 'ok'); await reloadProject(); renderExports(); showExport();
    } catch (e) { toast(e.message, 'err'); }
  };

  // --- viewer
  const mv = new MeshViewer($('#vp'));
  onCleanup(() => mv.dispose());
  let loadedFor = null;
  $('#styles').onclick = (e) => {
    const b = e.target.closest('[data-style]'); if (!b) return;
    vs.style = b.dataset.style; $$('[data-style]').forEach((x) => x.classList.toggle('on', x === b)); mv.applyStyle(vs.style);
  };
  $('#side').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'reset') mv.resetView();
    if (b.dataset.act === 'top') mv.viewFrom('top');
    if (b.dataset.act === 'shot') download(mv.screenshot(), `${S.project.name}_${vs.style}.png`);
    if (b.dataset.tg) {
      const k = b.dataset.tg; vs[k] = !vs[k]; b.classList.toggle('on', vs[k]);
      if (k === 'grid') mv.setGrid(vs[k]); if (k === 'axes') mv.setAxes(vs[k]); if (k === 'flat') mv.setFlat(vs[k]); if (k === 'auto') mv.setAutoRotate(vs[k]);
    }
  };
  const disp = $('#dispCtl');
  disp.innerHTML = `<div class="field"><label>光照</label>${seg('light', [['studio', '工作室'], ['soft', '柔光'], ['dramatic', '戏剧'], ['warm', '暖光']], vs.light)}</div>
    <div class="field"><label>背景</label>${seg('bg', [['dark', '深色'], ['studio', '影棚'], ['light', '浅色'], ['black', '黑'], ['white', '白']], vs.bg)}</div>
    ${range('exposure', '曝光', 0.3, 2.5, 0.05, vs.exposure, (v) => v.toFixed(2))}`;
  bindForm(disp, vs, (k, v) => {
    if (k === 'light') mv.setLighting(v);
    if (k === 'bg') { $('#vp').className = 'viewport bg-' + v; mv.grid.material.opacity = (v === 'light' || v === 'white') ? 0.25 : 0.55; }
    if (k === 'exposure') mv.setExposure(v);
  }, { exposure: (v) => v.toFixed(2) });
  $('#dispBtn').onclick = () => (disp.hidden = !disp.hidden);

  const empty = (msg) => {
    $('#vinfo').innerHTML = '';
    if (!$('#vp .vp-empty')) $('#vp').insertAdjacentHTML('beforeend', `<div class="vp-empty"><div>${I.cube}<div>${msg}</div></div></div>`);
    else $('#vp .vp-empty div div').textContent = msg;
  };
  const loadPreview = async (ex) => {
    if (loadedFor === ex.id) return;
    loadedFor = ex.id;
    $('#vp .vp-empty')?.remove();
    $('#vp').insertAdjacentHTML('beforeend', '<div class="vp-loading" id="mload"><div class="box"><b>加载预览模型…</b><div class="prog running"><i></i></div></div></div>');
    try {
      const info = await mv.load(`/api/projects/${p.id}/exports/${ex.id}/files/preview.glb?v=${ex.created}`, (f) => { const i = $('#mload i'); if (i) i.style.width = f * 100 + '%'; });
      const s = ex.stats || {};
      $('#vinfo').innerHTML = `<span class="chip">顶点 <b>${fmtNum(s.vertices)}</b></span><span class="chip">三角面 <b>${fmtNum(s.faces)}</b></span>${s.preview_faces && s.preview_faces < s.faces ? `<span class="chip">预览已简化到 <b>${fmtNum(info.faces)}</b> 面</span>` : ''}${s.extent ? `<span class="chip">尺寸 <b>${s.extent.map((x) => x.toFixed(2)).join(' × ')}</b></span>` : ''}${info.hasColors ? '' : '<span class="chip">无顶点颜色</span>'}`;
      mv.applyStyle(vs.style);
    } catch (e) { empty('预览加载失败：' + e.message); loadedFor = null; }
    $('#mload')?.remove();
  };

  // --- export list / job
  let mon = null;
  onCleanup(() => mon && mon.stop());
  const renderExports = () => {
    const list = S.project.exports;
    $('#exList').innerHTML = list.length ? list.map((e) => `<div class="li ${e.id === selExport ? 'sel' : ''}" data-e="${e.id}"><div><div class="t"><span class="n">${esc(e.name)}</span></div><div class="s">${(e.files || []).map((f) => f.format.toUpperCase()).join(' · ') || '—'}${e.stats?.faces ? ' · ' + fmtNum(e.stats.faces) + ' 面' : ''}${e.used_cache ? ' · 复用缓存' : ''}</div></div>${tag(e.status)}</div>`).join('') : '<div class="empty-note">还没有导出记录</div>';
    $$('[data-e]', $('#exList')).forEach((li) => (li.onclick = () => { selExport = S.selExport = li.dataset.e; renderExports(); showExport(); }));
  };
  const showExport = () => {
    mon && mon.stop(); mon = null;
    const ex = S.project.exports.find((e) => e.id === selExport);
    const box = $('#eJob');
    if (!ex) { box.innerHTML = '<div class="empty-note" style="padding-top:90px">在左侧设置参数后点击“开始导出”。<br>进度、结果文件会显示在这里。</div>'; empty('导出完成后，可以在这里用不同样式查看模型'); return; }
    if (ex.status === 'running' || ex.status === 'queued') {
      empty('正在导出，完成后自动加载预览…');
      mon = new JobMonitor(box, ex.job, {
        title: ex.name, showLog: true,
        groups: [{ label: '预处理与网格提取', keys: ['extract_pre', 'extract'] }, { label: '后处理与导出', keys: ['post_load', 'post_crop', 'post_clean', 'post_smooth', 'post_decimate', 'post_write', 'post_preview'] }],
        onDone: async (d) => {
          toast(d.status === 'done' ? '导出完成！' : d.status === 'canceled' ? '已取消导出' : '导出失败：' + d.error, d.status === 'done' ? 'ok' : 'err');
          await reloadProject(); renderExports(); showExport();
        },
      });
      return;
    }
    if (ex.status !== 'done') {
      box.innerHTML = `<div class="row between"><b>${esc(ex.name)}</b>${tag(ex.status)}</div>${ex.error ? `<div class="job-err">${esc(ex.error)}</div>` : ''}<div class="row" style="margin-top:12px"><button class="btn sm danger" data-delx>${I.trash}删除记录</button></div>`;
      $('[data-delx]', box).onclick = () => delExport(ex);
      empty('这次导出没有完成');
      return;
    }
    const s = ex.stats || {};
    const pr = ex.params || {};
    box.innerHTML = `<div class="row between"><div><b>${esc(ex.name)}</b><div class="small muted">${fmtTime(ex.created)} · 用时 ${fmtDur(ex.duration)}${ex.used_cache ? '（复用缓存）' : ''}</div></div><div class="row"><button class="btn sm" data-ofx>${I.folder}打开文件夹</button><button class="icon-btn" data-delx title="删除">${I.trash}</button></div></div>
      <div class="info-grid" style="margin:12px 0"><div class="stat accent"><div class="k">三角面</div><div class="v">${fmtNum(s.faces)}</div></div><div class="stat"><div class="k">顶点</div><div class="v">${fmtNum(s.vertices)}</div></div><div class="stat"><div class="k">原始网格面数</div><div class="v">${fmtNum(s.raw_faces)}</div></div></div>
      <div class="files">${(ex.files || []).map((f) => `<div class="file"><span class="fmt">${f.format.toUpperCase()}</span><span class="fn">${esc(f.name)}</span><span class="sz">${fmtBytes(f.size)}</span><a class="btn sm" href="/api/projects/${p.id}/exports/${ex.id}/files/${encodeURIComponent(f.name)}?download=1">${I.dl}下载</a></div>`).join('')}</div>
      <div class="row small muted" style="margin-top:10px;gap:6px">${[pr.method, pr.crop === 'auto' ? `裁剪 ${pr.crop_scale}×` : '不裁剪', { zup: 'Z 朝上', yup: 'Y 朝上', orig: '原始坐标' }[pr.axis], pr.smooth ? `平滑 ${pr.smooth}` : null, pr.target_faces ? `减面 ${fmtNum(pr.target_faces)}` : null].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
    $('[data-ofx]', box).onclick = () => POST('/api/open-folder', { project: p.id, export: ex.id }).catch((e) => toast(e.message, 'err'));
    $('[data-delx]', box).onclick = () => delExport(ex);
    loadPreview(ex);
  };
  const delExport = async (ex) => {
    if (!(await confirmBox('删除这条导出记录？', '导出的文件会被一起删除。', '删除'))) return;
    await DEL(`/api/projects/${p.id}/exports/${ex.id}`); selExport = S.selExport = null; loadedFor = null; mv.clear(); await reloadProject(); renderExports(); showExport();
  };
  renderExports(); showExport();
}

/* ====================================================================== boot */
window.addEventListener('hashchange', route);
route();
pollSystem();
