'use strict';
const $ = id => document.getElementById(id);

/* ---------------- tabs ---------------- */
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== 'pane-' + id; });
  try { history.replaceState(null, '', '#' + id); } catch (e) {}
}
document.querySelectorAll('.tab').forEach(t => { t.onclick = () => showTab(t.dataset.tab); });
if (/^#(ua|privacy|spoof|ip|check|backup)$/.test(location.hash)) showTab(location.hash.slice(1));

/* ---------------- generic field binding (data-key) ---------------- */
const fields = () => [...document.querySelectorAll('[data-key]')];

function fillFields(s) {
  for (const el of fields()) {
    const k = el.dataset.key;
    if (!(k in s)) continue;
    const v = s[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') { if ([...el.options].some(o => o.value === String(v))) el.value = String(v); }
    else el.value = (v === undefined || v === null) ? '' : v;
  }
}

function collectFields() {
  const out = {};
  for (const el of fields()) {
    const k = el.dataset.key;
    if (el.type === 'checkbox') out[k] = el.checked;
    else if (el.dataset.num !== undefined) out[k] = el.value === '' ? '' : Number(el.value);
    else out[k] = el.value.trim();
  }
  return out;
}

const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number(v) || d));

/* ---------------- spoofing tab helpers ---------------- */
(function () {
  const sel = $('gpuPreset');
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Choose a GPU…'; sel.appendChild(o0);
  for (const g of UA.GPU_PRESETS) { const o = document.createElement('option'); o.value = g.id; o.textContent = g.label; sel.appendChild(o); }
  try {
    const dl = $('tzNames');
    for (const z of (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [])) { const o = document.createElement('option'); o.value = z; dl.appendChild(o); }
  } catch (e) {}
})();
function syncSpoofUI() {
  const m = $('webglMode').value;
  $('gpuPresetBox').hidden = m !== 'preset';
  $('gpuCustomBox').hidden = m !== 'custom';
  $('tzBox').hidden = $('tzMode').value !== 'custom';
}
$('webglMode').onchange = syncSpoofUI;
$('tzMode').onchange = syncSpoofUI;

/* ---------------- custom User-Agent list ---------------- */
function refreshProfileSelects() {
  const keep = { g: $('gprofile').value, a: $('autoProfile').value };
  UA.fillProfileSelect($('gprofile'));
  UA.fillProfileSelect($('autoProfile'), { rotation: true });
  if ([...$('gprofile').options].some(o => o.value === keep.g)) $('gprofile').value = keep.g;
  if ([...$('autoProfile').options].some(o => o.value === keep.a)) $('autoProfile').value = keep.a;
}
function customInfo() {
  const lines = $('customUAs').value.split(/\r?\n/).map(l => l.trim()).filter(l => l && l[0] !== '#').length;
  const ok = UA.parseCustomUAs($('customUAs').value).length;
  $('customInfo').textContent = lines ? ok + ' valid' + (ok < lines ? ', ' + (lines - ok) + ' line(s) ignored (not printable ASCII, or too short/long)' : '') + '.' : 'Nothing saved.';
}
$('customUAs').addEventListener('input', () => {
  UA.configure({ customList: UA.parseCustomUAs($('customUAs').value) });
  refreshProfileSelects(); customInfo();
});

/* ---------------- per-site UA rules ---------------- */
let rules = {};

function renderRules() {
  const box = $('rules'); box.innerHTML = '';
  for (const [host, ua] of Object.entries(rules)) addRow(host, ua);
}

function addRow(host, ua) {
  const d = document.createElement('div'); d.className = 'rule';
  const h = document.createElement('input'); h.type = 'text'; h.className = 'host'; h.placeholder = 'example.com'; h.value = host;
  const p = document.createElement('select');
  UA.fillProfileSelect(p, { leading: [{ id: '', label: 'Preset…' }, { id: UA.DEFAULT, label: 'Firefox default (no spoof)' }] });
  const u = document.createElement('input'); u.type = 'text'; u.className = 'ruleua'; u.placeholder = 'User-Agent'; u.value = ua;
  p.onchange = () => { if (p.value) u.value = p.value === UA.DEFAULT ? UA.DEFAULT : UA.generate(p.value); p.value = ''; };
  const x = document.createElement('button'); x.textContent = 'Remove'; x.onclick = () => d.remove();
  d.append(h, p, u, x); $('rules').appendChild(d);
}

function collectRules() {
  const out = {};
  document.querySelectorAll('.rule').forEach(r => {
    const h = UA.normalizeHost(r.querySelector('.host').value), u = r.querySelector('.ruleua').value.trim();
    if (h && u) out[h] = u;
  });
  return out;
}

/* ---------------- proxies ---------------- */
function addProxyRow(p, checked) {
  p = Object.assign({ name: '', type: 'socks5', host: '', port: '', username: '', password: '', isolate: false }, p || {});
  const box = document.createElement('div'); box.className = 'proxy';

  const l1 = document.createElement('div'); l1.className = 'line l1';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'proxySel'; radio.title = 'Use this proxy'; radio.className = 'psel'; radio.checked = !!checked;
  const name = document.createElement('input'); name.type = 'text'; name.className = 'pname'; name.placeholder = 'Name (optional)'; name.value = p.name;
  const type = document.createElement('select'); type.className = 'ptype';
  UA.PROXY_TYPES.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t.toUpperCase(); type.appendChild(o); });
  type.value = p.type;
  const host = document.createElement('input'); host.type = 'text'; host.className = 'phost'; host.placeholder = 'host or IP'; host.value = p.host;
  const port = document.createElement('input'); port.type = 'number'; port.className = 'pport'; port.placeholder = 'port'; port.min = 1; port.max = 65535; port.value = p.port;
  l1.append(radio, name, type, host, port);

  const l2 = document.createElement('div'); l2.className = 'line l2';
  const user = document.createElement('input'); user.type = 'text'; user.className = 'puser'; user.placeholder = 'username (optional)'; user.value = p.username; user.autocomplete = 'off';
  const pass = document.createElement('input'); pass.type = 'password'; pass.className = 'ppass'; pass.placeholder = 'password (optional)'; pass.value = p.password; pass.autocomplete = 'new-password';
  const iso = document.createElement('label'); iso.className = 'chk';
  const isoBox = document.createElement('input'); isoBox.type = 'checkbox'; isoBox.className = 'piso'; isoBox.checked = !!p.isolate;
  iso.append(isoBox, document.createTextNode(' Separate circuit per site (Tor)'));
  const test = document.createElement('button'); test.textContent = 'Test'; test.className = 'sm';
  const del = document.createElement('button'); del.textContent = 'Remove'; del.className = 'sm'; del.onclick = () => { box.remove(); };
  l2.append(user, pass, iso, test, del);

  test.onclick = async () => {
    await save(true);
    const rows = [...document.querySelectorAll('.proxy')].filter(r => validRow(r));
    const idx = rows.indexOf(box);
    if (idx < 0) { out('Fill in host and port first.', true); return; }
    runCheck(idx);
  };

  box.append(l1, l2);
  $('proxies').appendChild(box);
}

function rowToProxy(r) {
  return {
    name: r.querySelector('.pname').value.trim(), type: r.querySelector('.ptype').value,
    host: r.querySelector('.phost').value.trim(), port: r.querySelector('.pport').value,
    username: r.querySelector('.puser').value, password: r.querySelector('.ppass').value,
    isolate: r.querySelector('.piso').checked
  };
}
function validRow(r) { return UA.cleanProxies([rowToProxy(r)]).length === 1; }

function collectProxies() {
  const list = []; let selected = 0;
  document.querySelectorAll('.proxy').forEach(r => {
    const clean = UA.cleanProxies([rowToProxy(r)]);
    if (!clean.length) return;
    list.push(clean[0]);
    if (r.querySelector('.psel').checked) selected = list.length - 1;
  });
  return { list, selected };
}

function renderProxies(list, selected) {
  $('proxies').innerHTML = '';
  list.forEach((p, i) => addProxyRow(p, i === selected));
}

function addPreset(id) {
  const p = UA.PROXY_PRESETS.find(x => x.id === id);
  const any = document.querySelector('.psel:checked');
  addProxyRow(p, !any);
}

$('addTorBrowser').onclick = () => addPreset('tor-browser');
$('addTorService').onclick = () => addPreset('tor-service');
$('addSSH').onclick = () => addPreset('ssh');
$('addProxy').onclick = () => addProxyRow({}, !document.querySelector('.psel:checked'));

/* ---------------- IP / leak checks ---------------- */
function out(text, bad) { const o = $('ipOut'); o.textContent = text; o.style.color = bad ? '#d33' : ''; }

async function runCheck(idx) {
  out('Checking…');
  const r = await browser.runtime.sendMessage({ type: 'checkIP', idx: idx === undefined ? null : idx });
  if (r && r.ok) out('Sites see this IP: ' + r.ip);
  else out('Check failed: ' + ((r && r.error) || 'no response') + ' — the proxy may be down or blocked.', true);
}

$('checkReal').onclick = async () => { await save(true); runCheck(); };
$('rotateProxyNow').onclick = async () => { await save(true); await browser.runtime.sendMessage({ type: 'rotateProxy' }); runCheck(); };

$('checkWebRTC').onclick = async () => {
  out('Testing WebRTC… (contacts a public STUN server)');
  const res = await new Promise(resolve => {
    const seen = new Set(); let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); }
    catch (e) { return resolve({ error: 'WebRTC is disabled — no leak possible.' }); }
    const done = () => { try { pc.close(); } catch (e) {} resolve({ ips: [...seen] }); };
    pc.createDataChannel('x');
    pc.onicecandidate = ev => {
      if (!ev.candidate) return done();
      const m = /candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/.exec(ev.candidate.candidate);
      if (m) seen.add(m[2] + ' ' + m[1]);
    };
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => resolve({ error: 'WebRTC test failed.' }));
    setTimeout(done, 6000);
  });
  if (res.error) return out(res.error, false);
  const pub = res.ips.filter(x => x.startsWith('srflx ') || x.startsWith('relay '));
  if (!pub.length) out('No public address exposed by WebRTC (found: ' + (res.ips.join(', ') || 'nothing') + ').');
  else out('WebRTC exposes: ' + pub.join(', ') + ' — compare with the proxy IP; if it is your real IP, set WebRTC to "no direct UDP".', true);
};

/* ---------------- privacy presets ---------------- */
document.querySelectorAll('.preset').forEach(b => {
  b.onclick = () => {
    fillFields(UA.PRIVACY_PRESETS[b.dataset.preset]);
    $('presetInfo').textContent = ' "' + b.dataset.preset + '" filled in — press Save to apply.';
  };
});

/* ---------------- keep the auto-rotation pill live ---------------- */
function paintAutoInfo(s) {
  $('autoInfo').textContent = s.autoChange ? `Auto rotation ON — current: ${UA.describe(s.autoCurrentUA)}` : 'Auto rotation OFF';
  $('autoInfo').className = 'pill big ' + (s.autoChange ? 'on' : 'off');
}
browser.storage.onChanged.addListener(async (ch, area) => {
  if (area !== 'local' || !['autoChange', 'autoCurrentUA'].some(k => k in ch)) return;
  paintAutoInfo(await browser.storage.local.get(UA.DEFAULTS));
});

/* ---------------- load / save ---------------- */
async function load() {
  await UA.loadEnv();
  const s = await browser.storage.local.get(UA.DEFAULTS);
  refreshProfileSelects();
  fillFields(s);
  syncSpoofUI(); customInfo();
  paintAutoInfo(s);
  rules = s.rules || {}; renderRules();
  const list = UA.cleanProxies(s.proxies);
  renderProxies(list, Number(s.proxySelected) || 0);
  if (!$('gprofile').dataset.init) {
    $('gprofile').dataset.init = '1';
    const real = await UA.detectReal();
    const want = s.uaProfile || s.globalProfile || UA.recommendedProfile(real);
    if (UA.validProfileId(want)) $('gprofile').value = want;
  }
  showVersions(s);
  const preset = UA.detectPreset(s);
  $('presetInfo').textContent = ' Current: ' + preset + '.';
}

function showVersions(s) {
  const d = s.liveData || {};
  const parts = [`Chrome/Edge ${UA.chromeMajor()}`, `Firefox ${UA.firefoxMajor()}`, `Safari ${UA.safariMajor()}`];
  const api = UA.apiCount() ? ` · your list: ${UA.apiCount()} agents, fetched ${new Date(s.apiFetched).toLocaleString()}` : '';
  const live = d.chrome || d.firefox ? 'feeds ' + new Date(s.liveFetched || d.at || Date.now()).toLocaleString() : '';
  const src = (api || live) ? live + (live && api ? '; ' : '') + api.replace(/^ · /, '') : 'estimated — no online data yet';
  const err = [s.apiError, s.liveError].filter(Boolean).join(' · ');
  $('verInfo').textContent = ' Using ' + parts.join(' · ') + ' (' + src + ')' + (err ? ' — ' + err : '');
}
$('refreshVer').onclick = async () => {
  $('verInfo').textContent = ' Checking…';
  const r = await browser.runtime.sendMessage({ type: 'refreshVersions' });
  await UA.loadEnv();
  const s = await browser.storage.local.get(UA.DEFAULTS);
  fillFields(s); showVersions(s);
  if (!(r && r.ok)) $('verInfo').textContent += ' — failed: ' + ((r && r.error) || 'no response');
};

function flash(t) { $('status').textContent = ' ' + t; setTimeout(() => { $('status').textContent = ''; }, 3000); }

async function save(quiet) {
  const o = collectFields();
  o.autoChangeSeconds = clamp(o.autoChangeSeconds, 60, 86400, 300);
  o.proxyRotateSeconds = clamp(o.proxyRotateSeconds, 30, 86400, 600);
  if (o.hwConcurrency !== '') o.hwConcurrency = clamp(o.hwConcurrency, 1, 64, 4);
  if (o.screenSize && !/^\d{3,5}x\d{3,5}$/.test(o.screenSize)) { flash('Screen size must look like 1920x1080'); o.screenSize = ''; }
  if (o.screenDPR !== '') o.screenDPR = (Number(o.screenDPR) >= 0.5 && Number(o.screenDPR) <= 4) ? Number(o.screenDPR) : '';
  if (o.tzMode === 'custom') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: o.tzName }); } catch (e) { flash('Unknown time zone "' + o.tzName + '" — use a name like Europe/Berlin'); o.tzName = ''; o.tzMode = 'off'; }
  }
  if (o.webglMode === 'preset' && !o.gpuPreset) o.webglMode = 'off';
  o.gpuVendor = (o.gpuVendor || '').slice(0, 200); o.gpuRenderer = (o.gpuRenderer || '').slice(0, 200);
  o.customUAs = UA.parseCustomUAs(o.customUAs).map(c => (c.name && c.name !== UA.describe(c.ua) ? c.name + ' | ' : '') + c.ua).join('\n');
  if (!/^https:\/\//i.test(o.ipCheckUrl || '')) o.ipCheckUrl = UA.DEFAULTS.ipCheckUrl;
  o.customListUrl = (o.customListUrl || '').trim();
  if (o.customListUrl && !/^https:\/\//i.test(o.customListUrl)) { flash('List link must start with https://'); o.customListUrl = ''; }
  o.uaApi = !!o.customListUrl;
  if (!o.customListUrl) Object.assign(o, { apiList: [], apiFetched: 0, apiError: '' });
  o.rules = collectRules();
  o.uaProfile = $('gprofile').value;
  o.globalProfile = (o.globalUA && UA.generate($('gprofile').value) === o.globalUA) ? $('gprofile').value : '';
  const px = collectProxies();
  o.proxies = px.list; o.proxySelected = px.selected;
  await browser.storage.local.set(o);
  await browser.runtime.sendMessage({ type: 'sync' });
  if (quiet === true) return;
  await load();
  flash('Saved. Reload open tabs to apply to them.');
}

$('add').onclick = () => addRow('', '');
// Picking a profile fills the box right away with that profile's current User-Agent.
const gbox = () => document.querySelector('[data-key="globalUA"]');
$('gprofile').onchange = () => {
  gbox().value = UA.generate($('gprofile').value, { jitter: false });
  browser.storage.local.set({ uaProfile: $('gprofile').value });
};
// Generate (optional): a different, real-world User-Agent for the profile on every press.
$('ggen').onclick = () => {
  const prev = gbox().value;
  let ua = '';
  for (let i = 0; i < 12 && (!ua || ua === prev); i++) ua = UA.generate($('gprofile').value, { vary: true, jitter: true });
  gbox().value = ua;
  browser.storage.local.set({ uaProfile: $('gprofile').value });
};
$('save').onclick = () => save();
$('reset').onclick = async () => {
  if (!confirm('Reset all Vivid User Privacy settings (including proxies)?')) return;
  await browser.storage.local.clear(); await load(); flash('Reset.');
};

/* ---------------- backup ---------------- */
$('export').onclick = async () => {
  const s = await browser.storage.local.get(UA.DEFAULTS);
  const o = {};
  for (const k of Object.keys(UA.DEFAULTS)) if (!UA.RUNTIME_KEYS.includes(k)) o[k] = s[k];
  o.proxies = UA.cleanProxies(o.proxies).map(p => ({ ...p, password: '' }));   // never export secrets
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }));
  a.download = 'vivid-user-privacy-settings.json'; a.click();
};
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  try {
    const data = JSON.parse(await e.target.files[0].text()), o = {};
    for (const k of Object.keys(UA.DEFAULTS)) {
      if (!(k in data) || UA.RUNTIME_KEYS.includes(k)) continue;
      const def = UA.DEFAULTS[k];
      if (k === 'proxies') o[k] = UA.cleanProxies(data[k]);
      else if (k === 'rules') { if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) o[k] = data[k]; }
      else if (typeof def === typeof data[k] || def === '') o[k] = data[k];
    }
    await browser.storage.local.set(o); await load(); flash('Imported.');
  } catch (err) { flash('Import failed: invalid file.'); }
  e.target.value = '';
};

UA.fillProfileSelect($('gprofile'));
UA.fillProfileSelect($('autoProfile'), { rotation: true });
load();

/* ---------------- Browser check ---------------- */
(async function () {
  const real = await UA.detectReal();
  $('realSummary').textContent = real.summary + ' — ' + UA.OS_NAMES[real.os];
  $('realDetails').textContent = real.detail + (real.rfp && real.rfp.value && real.rfp.level !== 'controlled_by_this_extension'
    ? ' · Resist Fingerprinting is already on in this browser' : '');
  $('realUA').textContent = real.ua;
})();

$('checkRecent').onclick = async () => {
  const box = $('checkOut');
  box.textContent = 'Checking…';
  let tabs = [];
  try { tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] }); } catch (e) {}
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  UA.renderReport(box, await UA.runCheck(tabs[0] || { url: '' }));
};

$('checkExample').onclick = async () => {
  const box = $('checkOut');
  box.textContent = 'Opening example.com…';
  let tab;
  try {
    tab = await browser.tabs.create({ url: 'https://example.com/', active: false });
    await new Promise(resolve => {
      const done = () => { browser.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve(); };
      const fn = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
      const t = setTimeout(done, 15000);
      browser.tabs.onUpdated.addListener(fn);
    });
    tab = await browser.tabs.get(tab.id);
    UA.renderReport(box, await UA.runCheck(tab));
  } catch (e) {
    UA.renderReport(box, { error: 'Could not run the check: ' + ((e && e.message) || e) });
  } finally {
    if (tab) { try { await browser.tabs.remove(tab.id); } catch (e) {} }
  }
};
