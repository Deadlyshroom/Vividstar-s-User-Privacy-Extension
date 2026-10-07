'use strict';
const $ = id => document.getElementById(id);
let tabId = null, tabHost = '', tabUrl = '', tabIncognito = false, st = {}, real = null;

async function save(patch, noReload) {
  await browser.storage.local.set(patch);
  await browser.runtime.sendMessage({ type: 'sync' });
  if (!noReload && $('reload').checked && tabId != null) { try { await browser.tabs.reload(tabId, { bypassCache: true }); } catch (e) {} }
  await refresh();
}

async function refresh() {
  st = await browser.storage.local.get(UA.DEFAULTS);
  $('enabled').checked = st.enabled;
  $('reload').checked = st.reloadOnApply;
  $('host').textContent = tabHost || 'n/a (not a web page)';
  $('seconds').value = st.autoChangeSeconds;
  if ([...$('autoProfile').options].some(o => o.value === st.autoProfile)) $('autoProfile').value = st.autoProfile;
  const rotOn = !!(st.autoChange && st.enabled);
  const secs = Number(st.autoChangeSeconds) || 300;
  const every = secs < 60 ? secs + ' s' : secs < 3600 ? Math.round(secs / 60) + ' min' : Math.round(secs / 3600) + ' h';
  $('autoBanner').className = 'state ' + (rotOn ? 'on' : 'off');
  $('autoTitle').textContent = rotOn ? 'Auto rotation: ON' : 'Auto rotation: OFF';
  $('autoSub').textContent = !st.enabled ? 'User-Agent switching is disabled — real Firefox User-Agent'
    : rotOn ? `${UA.describe(st.autoCurrentUA)} · new one every ${every}`
    : (st.globalUA ? 'Fixed User-Agent: ' + UA.describe(st.globalUA) : 'Sending your real Firefox User-Agent');
  $('autoStatus').textContent = st.autoChange ? `Running — current: ${UA.describe(st.autoCurrentUA)}` : 'Rotation is off.';
  $('applySite').disabled = $('defaultSite').disabled = $('clearSite').disabled = $('exemptSite').disabled = !tabHost;

  // privacy
  const preset = UA.detectPreset(st);
  $('level').value = preset;
  $('qStrip').checked = !!st.stripTracking;
  $('qDnt').checked = !!(st.hdrDNT && st.hdrGPC);
  $('qRef').checked = st.referrerMode !== 'default';
  $('qWebrtc').checked = st.webrtcMode === 'no-leak' || st.webrtcMode === 'off';
  $('qCanvas').checked = !!st.canvasNoise;

  // proxy
  const proxies = UA.cleanProxies(st.proxies);
  const sel = $('proxySel');
  sel.innerHTML = '';
  proxies.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = UA.proxyLabel(p); sel.appendChild(o); });
  if (!proxies.length) { const o = document.createElement('option'); o.textContent = 'No proxy set up yet'; sel.appendChild(o); }
  sel.value = String(Math.min(Number(st.proxySelected) || 0, Math.max(0, proxies.length - 1)));
  sel.disabled = !proxies.length || st.proxyRotation !== 'off';
  $('proxyEnabled').checked = !!st.proxyEnabled;
  $('proxyEnabled').disabled = !proxies.length;
  $('checkIp').disabled = false;
  $('rotateProxy').disabled = proxies.length < 2;

  const url = tabHost ? `https://${tabHost}/` : '';
  const status = await browser.runtime.sendMessage({ type: 'status', url });
  const eff = (status && status.ua) || '';
  $('detected').textContent = UA.describe(eff);
  $('effective').textContent = eff || 'Firefox is sending its real User-Agent here.';
  $('exemptSite').textContent = status && status.exempt ? 'Privacy tweaks skipped here — click to re-enable' : 'Skip privacy tweaks on this site';

  let ps = '';
  if (!proxies.length) ps = 'Add Tor or any SOCKS/HTTP proxy in Settings → IP & Proxy.';
  else if (st.proxyEnabled && status && status.proxyDown) ps = 'Proxy is failing — traffic paused (kill switch). ' + (status.lastProxyError || '');
  else if (st.proxyEnabled) ps = tabHost ? (status && status.proxy ? 'This site uses: ' + status.proxy : 'This site connects directly (bypass/scope rule).') : 'Proxy is on.';
  else ps = 'Proxy is off — sites see your real IP.';
  $('proxyStatus').textContent = ps;
}


function showReal() {
  if (!real) return;
  $('realBadge').textContent = real.summary || 'Firefox';
  $('realDetail').textContent = real.detail + (real.rfp && real.rfp.value && real.rfp.level !== 'controlled_by_this_extension'
    ? ' · Resist Fingerprinting is on in this browser (it overrides some spoofed values)' : '');
}

function updateOsHint() {
  const box = $('osHint');
  const ua = $('ua').value.trim();
  if (!real || !ua) { box.hidden = true; return; }
  const i = UA.parseUA(ua);
  let msg = '';
  if (i.family === 'bot') msg = '';
  else if (i.mobile !== !!real.mobile) msg = `You are on a ${real.mobile ? 'phone/tablet' : 'desktop'}; this UA claims ${i.mobile ? 'mobile' : 'desktop'}. Screen size and touch support will contradict it.`;
  else if (i.os !== real.os && i.os !== 'other') msg = `This UA claims ${UA.OS_NAMES[i.os]} but you are really on ${UA.OS_NAMES[real.os]}. Fonts, GPU and screen can reveal that; a profile for ${UA.OS_NAMES[real.os]} is safer.`;
  box.textContent = msg;
  box.hidden = !msg;
}

$('runCheck').onclick = async () => {
  const box = $('report');
  box.textContent = 'Checking…';
  let tab = null;
  try { [tab] = await browser.tabs.query({ active: true, currentWindow: true }); } catch (e) {}
  UA.renderReport(box, await UA.runCheck(tab || { url: '' }));
};
$('ua').addEventListener('input', updateOsHint);

function currentUA() { return $('ua').value.trim(); }

/* Unsaved text is kept per site so closing the popup (it closes whenever you click away) never loses it. */
const DRAFT = 'uaForgeDraft';
function saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify({ host: tabHost, ua: $('ua').value })); } catch (e) {} }
function loadDraft() { try { const d = JSON.parse(localStorage.getItem(DRAFT)); return d && d.host === tabHost && typeof d.ua === 'string' ? d.ua : null; } catch (e) { return null; } }
function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (e) {} }
$('ua').addEventListener('input', saveDraft);

async function init() {
  await UA.loadEnv();
  real = await UA.detectReal();
  UA.fillProfileSelect($('profile'));
  const stored0 = await browser.storage.local.get({ uaProfile: '', globalProfile: '' });
  const want = stored0.uaProfile || stored0.globalProfile || UA.recommendedProfile(real);   // remembered choice, else your own OS
  $('profile').value = UA.validProfileId(want) ? want : UA.recommendedProfile(real);
  showReal();
  UA.fillProfileSelect($('autoProfile'), { rotation: true });
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id;
    tabUrl = tab.url; tabIncognito = !!tab.incognito;
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) tabHost = u.hostname;
  } catch (e) {}
  const s = await browser.storage.local.get({ globalUA: '' });
  const siteRule = tabHost ? UA.findRule(tabHost, (await browser.storage.local.get({ rules: {} })).rules) : '';
  const saved = (siteRule && siteRule !== UA.DEFAULT) ? siteRule : (s.globalUA || UA.generate($('profile').value));
  const draft = loadDraft();
  $('ua').value = draft !== null && draft !== '' ? draft : saved;
  await refresh();
  updateOsHint();
}

/* ---- User-Agent ---- */
$('enabled').onchange = () => save({ enabled: $('enabled').checked }, true);
$('reload').onchange = () => browser.storage.local.set({ reloadOnApply: $('reload').checked });
// Picking a profile fills the box right away with that profile's current User-Agent.
$('profile').onchange = () => {
  $('ua').value = UA.generate($('profile').value, { jitter: false });
  saveDraft(); updateOsHint();
  browser.storage.local.set({ uaProfile: $('profile').value });
};
// Generate (optional): a different, real-world User-Agent for the profile on every press.
$('generate').onclick = () => {
  const prev = $('ua').value;
  let ua = '';
  for (let i = 0; i < 12 && (!ua || ua === prev); i++) ua = UA.generate($('profile').value, { vary: true, jitter: true });
  $('ua').value = ua;
  saveDraft(); updateOsHint();
  browser.storage.local.set({ uaProfile: $('profile').value });
};
$('applyAll').onclick = () => {
  const ua = currentUA();
  if (!ua) return;
  clearDraft();
  const fromProfile = ua === UA.generate($('profile').value, { jitter: false });
  save({ globalUA: ua, globalProfile: fromProfile ? $('profile').value : '', uaProfile: $('profile').value, autoChange: false });
};
$('applySite').onclick = async () => {
  if (!currentUA() || !tabHost) return;
  const { rules } = await browser.storage.local.get({ rules: {} });
  rules[tabHost] = currentUA();
  clearDraft();
  save({ rules, uaProfile: $('profile').value });
};
$('defaultSite').onclick = async () => {
  const { rules } = await browser.storage.local.get({ rules: {} });
  rules[tabHost] = UA.DEFAULT;
  save({ rules });
};
$('clearSite').onclick = async () => {
  const { rules } = await browser.storage.local.get({ rules: {} });
  for (const k of Object.keys(rules)) if (UA.normalizeHost(k) === tabHost) delete rules[k];
  save({ rules });
};
$('clearAll').onclick = () => { clearDraft(); save({ globalUA: '', globalProfile: '', rules: {}, autoChange: true, autoCurrentUA: '' }); };
$('startAuto').onclick = () => save({
  autoChange: true, autoProfile: $('autoProfile').value,
  autoChangeSeconds: Math.max(60, Number($('seconds').value) || 300), globalUA: st.globalUA || ''
});
$('stopAuto').onclick = () => save({ autoChange: false });
$('rotateNow').onclick = async () => {
  if (!st.autoChange) return save({ autoChange: true, autoProfile: $('autoProfile').value, autoChangeSeconds: Math.max(60, Number($('seconds').value) || 300) });
  await browser.runtime.sendMessage({ type: 'rotateNow' });
  save({});
};

/* ---- Privacy ---- */
$('level').onchange = () => {
  const p = UA.PRIVACY_PRESETS[$('level').value];
  if (p) save({ ...p, privacyEnabled: $('level').value !== 'off' });
};
$('qStrip').onchange = () => save({ stripTracking: $('qStrip').checked });
$('qDnt').onchange = () => save({ hdrDNT: $('qDnt').checked, hdrGPC: $('qDnt').checked });
$('qRef').onchange = () => save({ referrerMode: $('qRef').checked ? 'origin' : 'default' });
$('qWebrtc').onchange = () => save({ webrtcMode: $('qWebrtc').checked ? 'no-leak' : 'default' }, true);
$('qCanvas').onchange = () => save({ canvasNoise: $('qCanvas').checked });
$('exemptSite').onclick = async () => {
  if (!tabHost) return;
  const { privacyExempt } = await browser.storage.local.get({ privacyExempt: '' });
  const list = String(privacyExempt).split(/[\s,;]+/).map(UA.normalizeHost).filter(Boolean);
  const i = list.indexOf(tabHost);
  if (i >= 0) list.splice(i, 1); else list.push(tabHost);
  save({ privacyExempt: list.join('\n') });
};

/* ---- IP / proxy ---- */
$('proxyEnabled').onchange = () => save({ proxyEnabled: $('proxyEnabled').checked }, false);
$('proxySel').onchange = () => save({ proxySelected: Number($('proxySel').value) || 0 });
$('checkIp').onclick = async () => {
  $('ipOut').textContent = 'Checking…';
  const r = await browser.runtime.sendMessage({ type: 'checkIP', idx: null });
  $('ipOut').textContent = r && r.ok ? 'Sites see: ' + r.ip : 'Check failed: ' + ((r && r.error) || 'no response');
  refresh();
};
$('rotateProxy').onclick = async () => {
  const n = UA.cleanProxies(st.proxies).length;
  if (n < 2) return;
  if (st.proxyRotation === 'off') await save({ proxySelected: ((Number(st.proxySelected) || 0) + 1) % n }, true);
  else await browser.runtime.sendMessage({ type: 'rotateProxy' });
  $('ipOut').textContent = 'Switched proxy. Press "Check my IP" to confirm.';
  refresh();
};
$('options').onclick = () => { browser.runtime.openOptionsPage(); window.close(); };
init();

/* remember rotation choices immediately (not only when Start is pressed) */
$('autoProfile').onchange = () => save({ autoProfile: $('autoProfile').value }, true);
$('seconds').onchange = () => save({ autoChangeSeconds: Math.min(86400, Math.max(60, Number($('seconds').value) || 300)) }, true);
