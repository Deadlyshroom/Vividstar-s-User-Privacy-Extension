'use strict';

const DEF = UA.DEFAULTS;   // (ua-lib.js already owns the global name DEFAULTS)

// Settings that are applied through browser.privacy.* (Firefox-level prefs)
const BROWSER_KEYS = ['privacyEnabled', 'webrtcMode', 'cookieMode', 'trackingProtection', 'blockPing',
  'blockPrefetch', 'resistFingerprinting', 'firstPartyIsolate', 'proxyEnabled', 'proxyForceWebRTC'];

// Tracking parameters removed from visited URLs when "Clean links" is on
const TRACK_EXACT = ['fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'mkt_tok', 'vero_id', 'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_kwcid', 'ef_id', '_ga', '_gl', 'wickedid',
  'srsltid', 'mibextid', 'ref_src', 'ref_url', 'ck_subscriber_id', 'sc_cid', 'irclickid', 'cjevent', 'zanpid'];
const TRACK_PREFIX = ['utm_', 'pk_', 'mtm_', 'hsa_', 'stm_', 'itm_'];


// Bot-check pages ("Verify you are human") compare the claimed browser with the real engine (TLS, HTTP/2, JavaScript),
// so a Chrome/Safari identity on Firefox loops forever. The extension never touches the check's own frames, and a site that
// shows a check keeps User-Agent switching ON but only with a Firefox identity (same engine) and no fingerprint tweaks.
const CHECK_FRAME_HOSTS = ['challenges.cloudflare.com'];

// Link redirectors that only exist to log the click: [host regex, path, query parameter(s) holding the real URL]
const REDIRECTORS = [
  [/^(www\.)?google\.[a-z.]+$/, '/url', ['q', 'url']],
  [/^(l|lm|m|www)\.facebook\.com$/, '/l.php', ['u']],
  [/^l\.instagram\.com$/, '/', ['u']],
  [/^(www\.)?youtube\.com$/, '/redirect', ['q']],
  [/^(www\.)?duckduckgo\.com$/, '/l/', ['uddg']],
  [/^(steamcommunity\.com|store\.steampowered\.com|help\.steampowered\.com)$/, '/linkfilter/', ['u', 'url']],
  [/^(www\.)?reddit\.com$/, '/out', ['url']],
  [/^out\.reddit\.com$/, '/', ['url']],
  [/^(www\.)?linkedin\.com$/, '/safety/go/', ['url']],
  [/^slack-redir\.net$/, '/link', ['url']],
  [/^(www\.)?vk\.com$/, '/away.php', ['to']],
    [/^[a-z0-9-]+\.safelinks\.protection\.outlook\.com$/, '/', ['url']],
  [/^(www\.)?facebook\.com$/, '/flx/warn/', ['u']],
  [/^t\.umblr\.com$/, '/redirect', ['z']]
];

// Extra tracking parameters that only exist on one site (share ids etc.): [host regex, [names]]
const SITE_TRACK = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, ['si', 'pp', 'feature', 'source_ve_path', 'embeds_referring_euri', 'embeds_referring_origin']],
  [/(^|\.)(steampowered\.com|steamcommunity\.com)$/, ['snr', 'curator_clanid']],
  [/(^|\.)(twitter\.com|x\.com)$/, ['s', 't']],
  [/(^|\.)(spotify\.com)$/, ['si', 'context', 'nd', 'dlsi']],
  [/(^|\.)(amazon\.[a-z.]+)$/, ['tag', 'linkCode', 'linkId', 'ref_', 'pf_rd_p', 'pf_rd_r', 'pd_rd_i', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'content-id']],
  [/(^|\.)(reddit\.com)$/, ['share_id', 'utm_name', 'ref', 'ref_source', '$deep_link', 'correlation_id', 'rdt']]
];

function unwrapRedirect(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  for (const [re, path, params] of REDIRECTORS) {
    if (!re.test(u.hostname) || u.pathname !== path) continue;
    for (const k of params) {
      const v = u.searchParams.get(k);
      if (v && /^https?:\/\//i.test(v) && v !== url) return v;
    }
  }
  return null;
}

function upgradeToHttps(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'http:' || u.port) return null;
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.indexOf(':') >= 0 || isLocalHost(u.hostname)) return null;
  u.protocol = 'https:';
  return u.toString();
}

const DEFAULT_CHECK = 'https://api.ipify.org/?format=json';

let state = { ...DEF };
let realOS = 'linux';      // the OS Firefox really runs on (windows | macos | linux | android)
let derived = { cf: {}, cfSite: {}, exempt: {}, bypass: {}, listed: {}, trackExact: new Set(), trackPrefix: [] };
let csHandle = null;
let fontCssHandle = null;
let rotateTimer = null;
let proxyTimer = null;
let proxyIndex = 0;        // current proxy for "timed" rotation
let proxyShift = 0;        // bumped when a proxy fails, to move rotation modes on
let proxyDownUntil = 0;    // kill switch: block proxied traffic until this time
let lastProxyError = '';
let queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(fn).catch(e => console.error('[Vivid User Privacy]', e));
  return queue;
}

/* ---------------- state ---------------- */

function hostLines(s) {
  return String(s || '').split(/[\s,;]+/).map(x => UA.normalizeHost(x)).filter(Boolean);
}
function toMap(s) { const m = {}; for (const h of hostLines(s)) m[h] = '1'; return m; }

function rebuildDerived() {
  derived.cf = {};
  for (const h of CHECK_FRAME_HOSTS) derived.cf[h] = '1';
  derived.cfSite = {};   // sites that showed a check (learned automatically)
  for (const h of (Array.isArray(state.cfSites) ? state.cfSites : [])) derived.cfSite[h] = '1';
  derived.exempt = { ...toMap(state.privacyExempt), ...derived.cf, ...derived.cfSite };
  derived.bypass = toMap(state.proxyBypass);
  derived.listed = toMap(state.proxySites);
  derived.trackExact = new Set(TRACK_EXACT);
  derived.trackPrefix = TRACK_PREFIX.slice();
  for (let t of String(state.stripExtra || '').split(/[\s,;]+/)) {
    t = t.trim().toLowerCase();
    if (!t) continue;
    if (t.endsWith('*')) { if (t.length > 1) derived.trackPrefix.push(t.slice(0, -1)); }
    else derived.trackExact.add(t);
  }
}

function sanitizeState() {
  if (!state.rules || typeof state.rules !== 'object') state.rules = {};
  state.proxies = UA.cleanProxies(state.proxies);
  state.autoProfile = validRotationProfile(state.autoProfile);
  UA.configure({ customList: UA.parseCustomUAs(state.customUAs) });
  rebuildDerived();
}

async function loadState() {
  await UA.loadEnv();
  try { const pi = await browser.runtime.getPlatformInfo(); realOS = { win: 'windows', mac: 'macos', android: 'android' }[pi.os] || 'linux'; } catch (e) {}
  const stored = await browser.storage.local.get(null);
  state = { ...DEF, ...stored };
  forceFresh();
  sanitizeState();
  proxyIndex = state.proxies.length ? Math.floor(Math.random() * state.proxies.length) : 0;
}

function validRotationProfile(id) {
  if (id === 'custom-list' || UA.ROTATION_EXTRAS.some(p => p.id === id) || UA.PROFILES.some(p => p.id === id)) return id;
  return 'random-any';
}

/* Sticky rotation: a site keeps the User-Agent it first saw (until its tabs are closed or the settings change), so
   headers, page JavaScript and your login session never change halfway through a visit. */
const stickyUA = new Map();
let stickyDirty = false;

function stickyKey(host) {
  host = String(host || '').toLowerCase();
  if (!host || /^[\d.]+$/.test(host) || host.indexOf(':') >= 0) return host;
  const p = host.split('.');
  const n = (p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|org|net|gov|edu|ac|or|ne|go)$/.test(p[p.length - 2])) ? 3 : 2;
  return p.slice(-n).join('.');
}

// Cross-tab identity leak protection forces per-site sticky identities, so two tabs of one site can never show two browsers
function stickyOn() { return state.autoSticky !== false || !!state.crossTabProtect; }

function autoFor(host) {
  if (!stickyOn() || !host) return state.autoCurrentUA;
  const k = stickyKey(host);
  let ua = stickyUA.get(k);
  if (!ua) { ua = state.autoCurrentUA; stickyUA.set(k, ua); stickyDirty = true; }
  return ua;
}

// Sites already assigned a User-Agent, for the page-side script (your own per-site rules always win)
function stickyRules() {
  const r = { ...state.rules };
  for (const [k, ua] of stickyUA) if (!(k in r)) r[k] = ua;
  return r;
}

async function pruneSticky() {
  if (!stickyUA.size) return;
  let tabs;
  try { tabs = await browser.tabs.query({}); } catch (e) { return; }
  const open = new Set();
  for (const t of tabs) { const h = hostOf(t.url || ''); if (h) open.add(stickyKey(h)); }
  for (const k of [...stickyUA.keys()]) if (!open.has(k)) stickyUA.delete(k);
}

// Firefox identity (same engine as the real browser) for sites that show a bot check
function checkSafeUA() {
  const id = { windows: 'firefox-windows', macos: 'firefox-mac', android: 'android-firefox' }[realOS] || 'firefox-linux';
  return UA.generate(id, { jitter: false });
}
function checkSafe(host, ua) {
  if (!ua || !host || !UA.findRule(host, derived.cfSite)) return ua;
  if (/\bFirefox\/\d/.test(ua)) return ua;
  try { return checkSafeUA() || ua; } catch (e) { return ua; }
}

function resolveUA(host) {
  if (!state.enabled) return '';
  if (host && UA.findRule(host, derived.cf)) return '';   // the check's own frames: always the real browser
  const rule = UA.findRule(host, state.rules);
  if (rule) return rule === UA.DEFAULT ? '' : checkSafe(host, rule);
  if (state.autoChange && state.autoCurrentUA) return checkSafe(host, autoFor(host));
  return checkSafe(host, state.globalUA || '');
}

function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

function privacyExempt(host) { return !!(host && UA.findRule(host, derived.exempt)); }

function siteKey(h) {
  h = String(h || '').toLowerCase();
  if (!h || /^[\d.]+$/.test(h) || h.indexOf(':') >= 0) return h;
  return h.split('.').slice(-2).join('.');
}
function sameSite(a, b) { return siteKey(a) === siteKey(b); }

/* ---------------- HTTP header spoofing + privacy headers ---------------- */

function hostForRequest(d) {
  // Sub-resources follow the page they load into, so headers match what JS reports.
  const frame = d.type === 'main_frame' || d.type === 'sub_frame';
  return hostOf(frame ? d.url : (d.documentUrl || d.originUrl || d.url));
}

const uaCache = new Map();
function uaInfo(ua) {
  let c = uaCache.get(ua);
  if (!c) {
    if (uaCache.size > 40) uaCache.clear();
    c = { info: UA.parseUA(ua), hints: clientHints(ua) };
    uaCache.set(ua, c);
  }
  return c;
}

function clientHints(ua) {
  const i = UA.parseUA(ua);
  if (!i.chromium) return null;
  const brand = i.family === 'edge' ? 'Microsoft Edge' : i.family === 'opera' ? 'Opera' : i.family === 'samsung' ? 'Samsung Internet' : 'Google Chrome';
  const brandVer = i.family === 'chrome' ? i.chromiumMajor : (i.major || i.chromiumMajor);
  const plat = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', cros: 'Chrome OS' }[i.os] || 'Unknown';
  return {
    'Sec-CH-UA': `"Chromium";v="${i.chromiumMajor}", "${brand}";v="${brandVer}", "Not.A/Brand";v="99"`,
    'Sec-CH-UA-Mobile': i.mobile ? '?1' : '?0',
    'Sec-CH-UA-Platform': `"${plat}"`
  };
}

function adjustReferer(headers, d, mode) {
  const idx = headers.findIndex(h => h.name.toLowerCase() === 'referer');
  if (idx < 0) return headers;
  if (mode === 'none') { headers.splice(idx, 1); return headers; }
  let r, t;
  try { r = new URL(headers[idx].value); t = new URL(d.url); } catch (e) { return headers; }
  if (mode === 'origin') headers[idx].value = r.origin + '/';
  else if (mode === 'cross-origin-strip' && !sameSite(r.hostname, t.hostname)) headers.splice(idx, 1);
  return headers;
}

browser.webRequest.onBeforeSendHeaders.addListener(async d => {
  await ready;
  const host = hostForRequest(d);
  const ua = resolveUA(host);
  const privOn = state.privacyEnabled && !privacyExempt(host);
  const wantReferer = privOn && state.referrerMode && state.referrerMode !== 'default';
  const wantPriv = privOn && (state.hdrDNT || state.hdrGPC || effLang());
  if (!ua && !wantReferer && !wantPriv) return {};

  let headers = (d.requestHeaders || []).slice();
  const set = (name, value) => {
    const n = name.toLowerCase();
    const h = headers.find(x => x.name.toLowerCase() === n);
    if (h) h.value = value; else headers.push({ name, value });
  };

  if (ua) {
    const ci = uaInfo(ua);
    const hints = d.url.startsWith('https:') ? ci.hints : null;
    const info = ci.info;
    const stealth = state.stealth !== false && info.family !== 'firefox';
    // Firefox-only request headers (TE: trailers) give the engine away; drop them when stealth is on.
    headers = headers.filter(h => !/^sec-ch-ua/i.test(h.name) && !(stealth && h.name.toLowerCase() === 'te'));
    if (stealth && info.chromium && (d.type === 'main_frame' || d.type === 'sub_frame')) {
      set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7');
    }
    if (stealth && info.chromium) {
      if (d.type === 'image' || d.type === 'imageset') set('Accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
      else if (d.type === 'stylesheet') set('Accept', 'text/css,*/*;q=0.1');
        }
    set('User-Agent', ua);
    if (hints) for (const [name, value] of Object.entries(hints)) headers.push({ name, value });
  }

  if (wantPriv) {
    if (state.hdrDNT) set('DNT', '1');
    if (state.hdrGPC) set('Sec-GPC', '1');
    if (effLang()) set('Accept-Language', effLang());
  }
  if (wantReferer) headers = adjustReferer(headers, d, state.referrerMode);

  return { requestHeaders: headers };
}, { urls: ['http://*/*', 'https://*/*'] }, ['blocking', 'requestHeaders']);

/* ---------------- Geolocation: full block at the browser level ----------------
   Adds Permissions-Policy / Feature-Policy so the browser itself refuses geolocation
   for the page AND all its iframes, even if page script tries to get around the JS hooks. */
/* ---------------- Bot check: stop the endless loop ----------------
   When a page answers with a challenge, the site is remembered and its tab reloaded once with a Firefox identity.
   Non-blocking on purpose: it only watches, so it can never delay or break a page load. */
browser.webRequest.onHeadersReceived.addListener(d => {
  try {
    const x = (d.responseHeaders || []).find(y => y.name.toLowerCase() === 'cf-mitigated');
    if (!x || String(x.value || '').toLowerCase() !== 'challenge') return;
    const host = hostOf(d.url);
    if (!host || d.tabId < 0) return;
    enqueue(async () => {
      await ready;
      if (UA.findRule(host, derived.cf) || UA.findRule(host, derived.cfSite)) return;
      state.cfSites = [...(Array.isArray(state.cfSites) ? state.cfSites : []), stickyKey(host)].slice(-300);
      rebuildDerived();
      await browser.storage.local.set({ cfSites: state.cfSites });
      await applyContentScript();
      try { await browser.tabs.reload(d.tabId, { bypassCache: true }); } catch (e) {}
    });
  } catch (e) {}
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['responseHeaders']);

browser.webRequest.onHeadersReceived.addListener(async d => {
  await ready;
  if (!state.privacyEnabled || !state.geoFull) return {};
  if (privacyExempt(hostForRequest(d))) return {};
  const headers = (d.responseHeaders || []).slice();
  headers.push({ name: 'Permissions-Policy', value: 'geolocation=()' });
  headers.push({ name: 'Feature-Policy', value: "geolocation 'none'" });
  return { responseHeaders: headers };
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] }, ['blocking', 'responseHeaders']);

/* ---------------- tracking-parameter stripping + proxy kill switch ---------------- */

function isTrackingParam(name, host) {
  name = name.toLowerCase();
  if (derived.trackExact.has(name)) return true;
  if (host) for (const [re, names] of SITE_TRACK) if (re.test(host) && names.includes(name)) return true;
  for (const p of derived.trackPrefix) if (name.startsWith(p)) return true;
  return false;
}

function stripTrackingParams(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (!u.search || u.search.length < 2) return null;
  const parts = u.search.slice(1).split('&');
  const kept = parts.filter(p => {
    let k = p.split('=')[0];
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
    return !isTrackingParam(k, u.hostname);
  });
  if (kept.length === parts.length) return null;
  u.search = kept.length ? '?' + kept.join('&') : '';
  return u.toString();
}

browser.webRequest.onBeforeRequest.addListener(async d => {
  await ready;
  // New site while rotating: pin its User-Agent and make sure the page-side script knows it before the page loads.
  if ((d.type === 'main_frame' || d.type === 'sub_frame') && state.enabled && state.autoChange && stickyOn()) {
    resolveUA(hostOf(d.url));
    if (stickyDirty) { stickyDirty = false; await applyContentScript(true); }
  }
  // Kill switch: while the proxy is known to be failing, do not let proxied traffic out directly.
  if (state.proxyEnabled && state.proxyKillSwitch && Date.now() < proxyDownUntil && !checkInfo(d) && proxyDecision(d)) {
    return { cancel: true };
  }
  if (d.type === 'main_frame' && d.method === 'GET' && state.privacyEnabled && !privacyExempt(hostOf(d.url))) {
    if (state.stripTracking) {
      const direct = unwrapRedirect(d.url);
      if (direct) return { redirectUrl: direct };
    }
    if (state.upgradeHttps) {
      const secure = upgradeToHttps(d.url);
      if (secure) return { redirectUrl: secure };
    }
  }
  if (d.type === 'main_frame' && d.method === 'GET' && state.privacyEnabled && state.stripTracking && !privacyExempt(hostOf(d.url))) {
    const cleaned = stripTrackingParams(d.url);
    if (cleaned && cleaned !== d.url) return { redirectUrl: cleaned };
  }
  return {};
}, { urls: ['http://*/*', 'https://*/*'] }, ['blocking']);

/* ---------------- proxy (IP hiding) ---------------- */

function isLocalHost(h) {
  h = String(h || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h.indexOf(':') >= 0) return /^\[?(::1|fe80:|f[cd][0-9a-f]{2}:)/i.test(h);   // IPv6 loopback / link-local / ULA
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const a = +m[1], b = +m[2];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return h.indexOf('.') < 0;   // single-label intranet names
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function pickProxy(ctx) {
  const list = state.proxies, n = list.length;
  if (!n) return null;
  let i;
  if (state.proxyRotation === 'per-site') i = (hashStr(siteKey(ctx)) + proxyShift) % n;
  else if (state.proxyRotation === 'timed') i = (proxyIndex + proxyShift) % n;
  else i = Math.min(Math.max(0, Number(state.proxySelected) || 0), n - 1);
  return list[i];
}

function checkHost() { return hostOf(state.ipCheckUrl || DEFAULT_CHECK); }

// Recognise our own "check my IP" request (made by the background page, tabId -1).
function checkInfo(d) {
  if (d.tabId !== -1 || String(d.url).indexOf('uaforge=') < 0) return null;
  if (hostOf(d.url) !== checkHost()) return null;
  const m = /[?&]uaforge=([^&]*)/.exec(d.url);
  const v = m ? m[1] : 'auto';
  return { idx: /^\d+$/.test(v) ? Number(v) : null };
}

// Returns {p, ctx} when this request should go through a proxy, otherwise null.
function proxyDecision(d) {
  const chk = checkInfo(d);
  if (chk) {
    if (chk.idx !== null) return state.proxies[chk.idx] ? { p: state.proxies[chk.idx], ctx: 'check' } : null;
    if (!state.proxyEnabled || !state.proxies.length) return null;
    return { p: pickProxy('check'), ctx: 'check' };
  }
  if (!state.proxyEnabled || !state.proxies.length) return null;
  const target = hostOf(d.url);
  if (!target || isLocalHost(target)) return null;
  const ctx = hostForRequest(d);
  // "Never proxy" covers the site itself and everything that page loads
  if (UA.findRule(target, derived.bypass) || UA.findRule(ctx, derived.bypass)) return null;
  if (state.proxyScope === 'listed' && !UA.findRule(ctx, derived.listed)) return null;
  const p = pickProxy(ctx);
  return p ? { p, ctx } : null;
}

function toProxyInfo(p, key) {
  const info = { type: p.type === 'socks5' ? 'socks' : p.type, host: p.host, port: p.port, failoverTimeout: 5 };
  if (info.type === 'socks' || info.type === 'socks4') {
    info.proxyDNS = state.proxyDNS !== false;      // resolve hostnames on the proxy, not locally
    if (p.isolate) { info.username = 'uaforge-' + (key || 'x'); info.password = 'x'; }   // Tor: separate circuit per site
    else if (p.username) { info.username = p.username; info.password = p.password || ''; }
  }
  return info;
}

browser.proxy.onRequest.addListener(async d => {
  await ready;
  const r = proxyDecision(d);
  if (!r) return;                       // not ours: Firefox's own proxy settings apply
  return toProxyInfo(r.p, siteKey(r.ctx));
}, { urls: ['<all_urls>'] });

// HTTP/HTTPS proxy credentials
const authTried = new Set();
browser.webRequest.onAuthRequired.addListener(async d => {
  if (!d.isProxy) return {};
  await ready;
  const ch = d.challenger || {};
  const p = state.proxies.find(x => x.host === ch.host && Number(x.port) === Number(ch.port));
  if (!p || !p.username) return {};
  if (authTried.has(d.requestId)) return { cancel: true };   // wrong credentials: don't loop
  authTried.add(d.requestId);
  if (authTried.size > 500) authTried.clear();
  return { authCredentials: { username: p.username, password: p.password || '' } };
}, { urls: ['<all_urls>'] }, ['blocking']);

browser.webRequest.onCompleted.addListener(d => { authTried.delete(d.requestId); }, { urls: ['<all_urls>'] });

browser.webRequest.onErrorOccurred.addListener(d => {
  authTried.delete(d.requestId);
  if (!state.proxyEnabled || !/PROXY_(CONNECTION_REFUSED|AUTHENTICATION_FAILED|SERVICE_UNAVAILABLE)/.test(String(d.error))) return;
  lastProxyError = d.error;
  if (state.proxyKillSwitch) proxyDownUntil = Date.now() + 10000;
  if (state.proxyRotation !== 'off' && state.proxies.length > 1) proxyShift++;   // fail over to the next proxy
}, { urls: ['<all_urls>'] });

async function checkIP(idx) {
  const u = new URL(state.ipCheckUrl || DEFAULT_CHECK);
  u.searchParams.set('uaforge', idx === null || idx === undefined ? 'auto' : String(idx));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(u.toString(), { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
    const txt = (await r.text()).trim();
    let ip = txt;
    try { const j = JSON.parse(txt); ip = j.ip || j.query || j.address || txt; } catch (e) {}
    proxyDownUntil = 0;
    return { ok: true, ip: String(ip).slice(0, 120) };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? 'Timed out (proxy unreachable?)' : String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

async function rotateProxy() {
  const n = state.proxies.length;
  if (n > 1) {
    let next, tries = 0;
    do { next = Math.floor(Math.random() * n); tries++; } while (next === proxyIndex % n && tries < 10);
    proxyIndex = next;
    proxyShift = 0;
  }
  if (state.proxyRotateUA && state.enabled && state.autoChange) await rotate();
  scheduleProxy();
}

function scheduleProxy() {
  clearTimeout(proxyTimer);
  proxyTimer = null;
  if (!state.proxyEnabled || state.proxyRotation !== 'timed' || state.proxies.length < 2) return;
  const secs = Math.min(86400, Math.max(30, Number(state.proxyRotateSeconds) || 600));
  proxyTimer = setTimeout(() => enqueue(rotateProxy), secs * 1000);
}

/* ---------------- Firefox-level privacy settings ---------------- */

async function applyBrowserPrivacy() {
  const P = browser.privacy;
  if (!P || !P.network || !P.websites) return;
  const on = !!state.privacyEnabled;
  const put = async (setting, value) => {
    try {
      if (!setting) return;
      if (value === null || value === undefined) await setting.clear({});
      else await setting.set({ value });
    } catch (e) { console.warn('[Vivid User Privacy] could not change a privacy setting:', e && e.message); }
  };

  // WebRTC: with a proxy active, never let WebRTC reveal the real IP.
  let w = on ? state.webrtcMode : 'default';
  if (state.proxyEnabled && state.proxyForceWebRTC && (w === 'default' || w === 'public-only')) w = 'no-leak';
  await put(P.network.peerConnectionEnabled, w === 'off' ? false : null);
  await put(P.network.webRTCIPHandlingPolicy,
    w === 'public-only' ? 'default_public_interface_only' : w === 'no-leak' ? 'disable_non_proxied_udp' : null);

  await put(P.network.networkPredictionEnabled, on && state.blockPrefetch ? false : null);
  await put(P.websites.hyperlinkAuditingEnabled, on && state.blockPing ? false : null);
  await put(P.websites.trackingProtectionMode, on && state.trackingProtection ? 'always' : null);
  await put(P.websites.resistFingerprinting, on && state.resistFingerprinting ? true : null);
  await put(P.websites.firstPartyIsolate, on && state.firstPartyIsolate ? true : null);
  const cm = state.cookieMode;
  await put(P.websites.cookieConfig, on && cm && cm !== 'default' ? { behavior: cm, nonPersistentCookies: false } : null);
}

/* ---------------- JavaScript spoofing + fingerprint hardening ----------------
   Registered as a document_start content script whose source embeds the
   current config, so it runs synchronously before any page script. */

function injector(cfg) {
  try {
    let host = '';
    try { host = (location.hostname || '').toLowerCase(); } catch (e) {}
    if (!host) { try { host = window.parent.location.hostname.toLowerCase(); } catch (e) {} }

    if (cfg.cf && findRule(host, cfg.cf)) return;   // the check's own frames: leave completely untouched
    let ua = '';
    if (cfg.uaOn) {
      ua = findRule(host, cfg.rules);
      if (ua === cfg.DEFAULT) ua = '';
      else if (!ua) ua = cfg.fallback || '';
      if (ua && ua !== cfg.DEFAULT && cfg.checkUA && cfg.cfSite && findRule(host, cfg.cfSite) && !/\bFirefox\/\d/.test(ua)) ua = cfg.checkUA;   // bot-check site: Firefox identity only
    }
    const P = (cfg.priv && !(cfg.exempt && findRule(host, cfg.exempt))) ? cfg.priv : null;
    if (!ua && !P) return;

    const win = window.wrappedJSObject;
    const proto = win.Navigator.prototype;
    const nav = win.navigator;

    function define(name, value) {
      const desc = { get: exportFunction(function () { return value; }, window), set: undefined, enumerable: true, configurable: true };
      try { Object.defineProperty(proto, name, desc); }
      catch (e) { try { Object.defineProperty(nav, name, desc); } catch (e2) {} }
    }
    function remove(name) { try { delete proto[name]; } catch (e) {} }
    function defGetter(target, name, value) {
      try { Object.defineProperty(target, name, { get: exportFunction(function () { return value; }, window), set: undefined, enumerable: true, configurable: true }); } catch (e) {}
    }
    function defMethodOn(target, name, fn) {
      try { Object.defineProperty(target, name, { value: exportFunction(fn, window), writable: true, configurable: true, enumerable: true }); } catch (e) {}
    }

    const i = ua ? parseUA(ua) : null;

    /* ======================= User-Agent spoofing ======================= */
    if (ua) {
      const platform = i.os === 'windows' ? 'Win32' : i.os === 'macos' ? 'MacIntel' : i.os === 'ios'
        ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : i.os === 'android' ? 'Linux armv81' : 'Linux x86_64';
      const vendor = i.family === 'firefox' ? '' : (i.chromium ? 'Google Inc.' : 'Apple Computer, Inc.');
      let appVersion = ua.replace(/^Mozilla\//, '');
      if (i.family === 'firefox') {
        appVersion = '5.0 (' + (i.os === 'windows' ? 'Windows' : i.os === 'macos' ? 'Macintosh' : i.os === 'android' ? 'Android' : 'X11') + ')';
      }

      define('userAgent', ua);
      define('appVersion', appVersion);
      define('platform', platform);
      define('vendor', vendor);
      define('productSub', i.family === 'firefox' ? '20100101' : '20030107');
      define('maxTouchPoints', i.mobile ? 5 : 0);

      if (i.family === 'firefox') {
        define('oscpu', i.os === 'windows' ? 'Windows NT 10.0; Win64; x64'
          : i.os === 'macos' ? 'Intel Mac OS X 10.15' : i.os === 'android' ? 'Linux armv81' : 'Linux x86_64');
      } else {
        remove('oscpu');
        remove('buildID');
      }

      if (i.chromium) {
        try {
          const brandName = i.family === 'edge' ? 'Microsoft Edge' : i.family === 'opera' ? 'Opera' : i.family === 'samsung' ? 'Samsung Internet' : 'Google Chrome';
          const brandVer = i.family === 'chrome' ? i.chromiumMajor : (i.major || i.chromiumMajor);
          const brands = [
            { brand: 'Chromium', version: String(i.chromiumMajor) },
            { brand: brandName, version: String(brandVer) },
            { brand: 'Not.A/Brand', version: '99' }
          ];
          const platName = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', cros: 'Chrome OS' }[i.os] || 'Unknown';
          const high = {
            brands, mobile: i.mobile, platform: platName,
            architecture: i.os === 'macos' || i.os === 'android' ? 'arm' : 'x86',
            bitness: '64', model: '', wow64: false,
            platformVersion: i.os === 'windows' ? '15.0.0' : i.os === 'macos' ? '14.6.1' : i.os === 'android' ? '15.0.0' : '6.8.0',
            uaFullVersion: i.chromiumFull,
            fullVersionList: brands.map(b => ({ brand: b.brand, version: b.brand === 'Not.A/Brand' ? '99.0.0.0' : (i.chromiumFull || b.version) }))
          };
          const data = cloneInto({
            brands, mobile: i.mobile, platform: platName,
            getHighEntropyValues: function () {
              return new win.Promise(exportFunction(function (resolve) { resolve(cloneInto(high, window)); }, window));
            },
            toJSON: function () { return cloneInto({ brands, mobile: i.mobile, platform: platName }, window); }
          }, window, { cloneFunctions: true });
          define('userAgentData', data);
        } catch (e) {}
      } else {
        remove('userAgentData');
      }

      /* ---- Deep stealth: hide the real engine from "true browser core" checks ---- */
      if (cfg.stealth && i.family !== 'firefox') {
        const W = win;
        const names = o => { try { return Object.getOwnPropertyNames(o); } catch (e) { return []; } };
        const protoOf = n => { try { return W[n] && W[n].prototype; } catch (e) { return null; } };
        const defMethod = (name, fn) => defMethodOn(proto, name, fn);
        const defWin = (name, value) => {
          try { Object.defineProperty(W, name, { value, writable: true, configurable: true, enumerable: true }); } catch (e) {}
        };
        const resolved = v => new win.Promise(exportFunction(function (res) { res(v); }, window));

        // 1) Remove Firefox-only surface (moz* props, -moz CSS props, buildID, Error.fileName...)
        try {
          const mozRe = /^(on)?moz/i;
          const protos = ['Window', 'Document', 'Element', 'HTMLElement', 'Navigator', 'CSSStyleDeclaration',
            'CSS2Properties', 'MouseEvent', 'Screen', 'HTMLMediaElement', 'HTMLCanvasElement'].map(protoOf);
          for (const t of [W].concat(protos)) {
            if (!t) continue;
            for (const n of names(t)) if (mozRe.test(n)) { try { delete t[n]; } catch (e) {} }
          }
          const firefoxOnlyGlobals = ['InstallTrigger', 'sidebar', 'scrollMaxX', 'scrollMaxY', 'fullScreen', 'netscape'];
          for (const t of [W, protoOf('Window')]) if (t) for (const n of firefoxOnlyGlobals) { try { delete t[n]; } catch (e) {} }
          const ep = protoOf('Error');
          if (ep) for (const n of ['fileName', 'lineNumber', 'columnNumber']) { try { delete ep[n]; } catch (e) {} }
          for (const n of ['buildID', 'oscpu', 'mozGetUserMedia']) remove(n);
        } catch (e) {}

        // 2) CSS.supports('-moz-…') must be false on non-Gecko engines
        try {
          const CSSo = W.CSS, orig = CSSo.supports;
          CSSo.supports = exportFunction(function (a, b) {
            const q = (b === undefined) ? String(a) : String(a) + ':' + String(b);
            if (/(^|[^a-z])-moz-/i.test(q)) return false;
            return b === undefined ? orig.call(CSSo, a) : orig.call(CSSo, a, b);
          }, window);
        } catch (e) {}

        // 3) Chromium-only surface
        if (i.chromium) {
          try {
            if (!('chrome' in W)) {
              const t0 = Date.now();
              defWin('chrome', cloneInto({
                app: {
                  isInstalled: false,
                  InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                  RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                  getDetails: function () { return null; },
                  getIsInstalled: function () { return false; },
                  runningState: function () { return 'cannot_run'; }
                },
                csi: function () { return cloneInto({ onloadT: t0, startE: t0, pageT: Date.now() - t0, tran: 15 }, window); },
                loadTimes: function () {
                  const n = Date.now() / 1000;
                  return cloneInto({ requestTime: n - 1, startLoadTime: n - 1, commitLoadTime: n - 0.9, finishDocumentLoadTime: n - 0.5,
                    finishLoadTime: n - 0.4, firstPaintTime: n - 0.45, firstPaintAfterLoadTime: 0, navigationType: 'Other',
                    wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false,
                    connectionInfo: 'h2' }, window);
                }
              }, window, { cloneFunctions: true }));
            }
          } catch (e) {}

          try { define('deviceMemory', 8); } catch (e) {}
          try {
            define('connection', cloneInto({
              effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, type: i.mobile ? 'cellular' : 'wifi',
              addEventListener: function () {}, removeEventListener: function () {}
            }, window, { cloneFunctions: true }));
          } catch (e) {}
          try {
            defMethod('getBattery', function () {
              return resolved(cloneInto({
                charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
                onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null,
                addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return true; }
              }, window, { cloneFunctions: true }));
            });
          } catch (e) {}
          try {
            define('bluetooth', cloneInto({
              getAvailability: function () { return resolved(false); },
              requestDevice: function () {
                return new win.Promise(exportFunction(function (res, rej) {
                  rej(new win.DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'));
                }, window));
              }
            }, window, { cloneFunctions: true }));
          } catch (e) {}

          // More Chromium-only surface
          try {
            const perfP = protoOf('Performance');
            if (perfP && !('memory' in perfP)) {
              defGetter(perfP, 'memory', cloneInto({ jsHeapSizeLimit: 4294967296, totalJSHeapSize: 35000000, usedJSHeapSize: 28000000 }, window));
            }
            for (const n of ['webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL']) {
              if (!(n in W)) defWin(n, exportFunction(function () {}, window));
            }
            if (!('webkitGetUserMedia' in proto) && nav.mediaDevices) {
              defMethod('webkitGetUserMedia', function () {});
            }
          } catch (e) {}

          // V8-style Error API and stack format (Firefox: "fn@url:l:c", Chromium: "    at fn (url:l:c)")
          try {
            const E = W.Error;
            E.stackTraceLimit = 10;
            E.captureStackTrace = exportFunction(function (obj) {
              try { obj.stack = (new E()).stack; } catch (e) {}
            }, window);
            const desc = Object.getOwnPropertyDescriptor(E.prototype, 'stack');
            if (desc && desc.get) {
              const origGet = desc.get;
              const toV8 = function (s, self) {
                if (typeof s !== 'string') return s;
                let head = 'Error';
                try { head = String(self.name || 'Error') + (self.message ? ': ' + String(self.message) : ''); } catch (e) {}
                const out = [head];
                for (const line of s.split('\n')) {
                  if (!line) continue;
                  const m = /^(.*?)@(.*?):(\d+):(\d+)$/.exec(line);
                  if (!m) continue;
                  if (/^(moz-extension|resource|chrome):/.test(m[2])) continue;
                  const fn = m[1].replace(/\*.*$/, '').replace(/^.*\//, '');
                  out.push(fn ? '    at ' + fn + ' (' + m[2] + ':' + m[3] + ':' + m[4] + ')' : '    at ' + m[2] + ':' + m[3] + ':' + m[4]);
                }
                return out.join('\n');
              };
              Object.defineProperty(E.prototype, 'stack', {
                get: exportFunction(function () {
                  let raw; try { raw = origGet.call(this); } catch (e) { return undefined; }
                  return toV8(raw, this);
                }, window),
                set: exportFunction(function (v) {
                  try { Object.defineProperty(this, 'stack', { value: v, writable: true, configurable: true, enumerable: false }); } catch (e) {}
                }, window),
                configurable: true, enumerable: false
              });
            }
          } catch (e) {}
        }
      }
    }

    /* ---- Stealth: native-looking toString + Web Worker coverage ---- */
    if (ua && cfg.stealth && i && i.family !== 'firefox') {
      // 1) Spoofed getters/methods must not reveal their source via Function.prototype.toString
      try {
        const FP = win.Function.prototype;
        const origTS = FP.toString;
        const fakeNames = new win.WeakMap();
        const markFake = function (fn, nm) { try { fakeNames.set(fn, nm); } catch (e) {} };
        const wrapped = exportFunction(function () {
          let nm;
          try { nm = fakeNames.get(this); } catch (e) {}
          if (nm !== undefined) return 'function ' + nm + '() { [native code] }';
          return origTS.call(this);
        }, window);
        Object.defineProperty(FP, 'toString', { value: wrapped, writable: true, configurable: true, enumerable: false });
        markFake(wrapped, 'toString');
        // mark the descriptors we installed on Navigator.prototype
        for (const n of Object.getOwnPropertyNames(proto)) {
          const d = Object.getOwnPropertyDescriptor(proto, n);
          if (d && d.get && /^(userAgent|appVersion|platform|vendor|productSub|maxTouchPoints|userAgentData|deviceMemory|connection|bluetooth|languages|language|hardwareConcurrency)$/.test(n)) markFake(d.get, 'get ' + n);
          if (d && typeof d.value === 'function' && /^(getBattery|sendBeacon|webkitGetUserMedia)$/.test(n)) markFake(d.value, n);
        }
      } catch (e) {}

      // 2) Web Workers: navigator.* inside a worker would still report Firefox. Wrap classic workers
      //    in a blob that applies the same navigator values first, then importScripts() the real script.
      if (cfg.workerMode !== 'real') try {
        const pre = '(function(){var P=Object.getPrototypeOf(self.navigator)||WorkerNavigator.prototype;' +
          'function D(n,v){try{Object.defineProperty(P,n,{get:function(){return v},configurable:true,enumerable:true})}catch(e){}}' +
          'var c=' + JSON.stringify({
            userAgent: ua, platform: (function () { return i.os === 'windows' ? 'Win32' : i.os === 'macos' ? 'MacIntel' : i.os === 'ios' ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : i.os === 'android' ? 'Linux armv81' : 'Linux x86_64'; })(),
            appVersion: ua.replace(/^Mozilla\//, ''), vendor: i.chromium ? 'Google Inc.' : 'Apple Computer, Inc.',
            hardwareConcurrency: (P && P.hwc) || undefined, language: (P && P.langs && P.langs[0]) || undefined
          }) + ';' +
          'for(var k in c){if(c[k]!==undefined)D(k,c[k]);}' +
          'try{delete P.oscpu}catch(e){}try{delete P.buildID}catch(e){}})();';
        ['Worker', 'SharedWorker'].forEach(function (nm) {
          const Orig = window[nm];
          if (!Orig || !win[nm]) return;
          const Wrapped = exportFunction(function (url, opts) {
            try {
              const o = opts || {};
              if (o.type === 'module') return new Orig(url, opts);
              const abs = new URL(String(url), location.href).href;
              let code;
              if (/^https?:/i.test(abs)) code = pre + 'importScripts(' + JSON.stringify(abs) + ');';
              else if (/^blob:/i.test(abs)) {
                // Sites often revoke a blob: URL right after creating the worker, so read its source now
                // (importing it later would fail) and put our navigator values in front of it.
                const x = new window.XMLHttpRequest();
                x.open('GET', abs, false);
                x.send();
                const text = String(x.responseText || '');
                const strict = /^\s*(['"])use strict\1;?/.exec(text);
                code = strict ? strict[0] + pre + text.slice(strict[0].length) : pre + text;
              } else return new Orig(url, opts);
              const blob = new window.Blob([code], { type: 'text/javascript' });
              return new Orig(window.URL.createObjectURL(blob), opts);
            } catch (e) { return new Orig(url, opts); }
          }, window, { allowCrossOriginArguments: true });
          Wrapped.prototype = win[nm].prototype;
          try { Object.defineProperty(win, nm, { value: Wrapped, writable: true, configurable: true, enumerable: false }); } catch (e) {}
        });
      } catch (e) {}
    }

    /* ---- Web Workers: optionally block them entirely ---- */
    if (cfg.workerMode === 'block') {
      try {
        ['Worker', 'SharedWorker'].forEach(function (nm) {
          if (!win[nm]) return;
          const Blocked = exportFunction(function () {
            throw new win.DOMException('Web Workers are blocked by Vivid User Privacy.', 'SecurityError');
          }, window);
          Blocked.prototype = win[nm].prototype;
          try { Object.defineProperty(win, nm, { value: Blocked, writable: true, configurable: true, enumerable: false }); } catch (e) {}
        });
      } catch (e) {}
    }

    /* ======================= Privacy / fingerprint hardening ======================= */
    if (P) {
      // Languages (matches the Accept-Language header)
      try {
        if (P.langs && P.langs.length) {
          const arr = cloneInto(P.langs, window);
          try { win.Object.freeze(arr); } catch (e) {}
          define('languages', arr);
          define('language', P.langs[0]);
        }
      } catch (e) {}

      if (P.hwc) define('hardwareConcurrency', P.hwc);
      if (P.dnt) define('doNotTrack', '1');
      if (P.gpc) define('globalPrivacyControl', true);
      if (P.beacon) defMethodOn(proto, 'sendBeacon', function () { return true; });

      // Screen size (blend-in picks the most common size for the claimed device type)
      try {
        let scr = P.screen;
        if (!scr && P.screenAuto) {
          const mob = i ? i.mobile : /Mobile|Android|iPhone|iPad/.test(String(nav.userAgent));
          scr = mob ? { w: 412, h: 915 } : { w: 1920, h: 1080 };
          if (!mob && !P.dpr) { defGetter(win, 'devicePixelRatio', 1); }
        }
        if (win.Screen && (scr || P.depth)) {
          const S = win.Screen.prototype, d = P.depth || 24;
          const list = [['colorDepth', d], ['pixelDepth', d]];
          if (scr) list.push(['width', scr.w], ['height', scr.h], ['availWidth', scr.w], ['availHeight', Math.max(100, scr.h - 40)]);
          list.forEach(function (kv) { defGetter(S, kv[0], kv[1]); });
        }
        if (P.dpr) defGetter(win, 'devicePixelRatio', P.dpr);
        if (scr && P.screenWindow) {
          // a maximised window on that screen: taskbar/dock ~40px, browser toolbars ~85px
          const oh = Math.max(100, scr.h - 40);
          [['outerWidth', scr.w], ['outerHeight', oh], ['innerWidth', scr.w], ['innerHeight', Math.max(100, oh - 85)],
           ['screenX', 0], ['screenY', 0], ['screenLeft', 0], ['screenTop', 0]].forEach(function (kv) { defGetter(win, kv[0], kv[1]); });
        }
      } catch (e) {}

      // Device memory, WebGPU, media devices, speech voices
      try { if (P.mem) define('deviceMemory', P.mem); } catch (e) {}
      try { if (P.webgpu) remove('gpu'); } catch (e) {}
      try {
        if (P.mediaDev && win.MediaDevices) {
          defMethodOn(win.MediaDevices.prototype, 'enumerateDevices', function () {
            return new win.Promise(exportFunction(function (res) { res(cloneInto([], window)); }, window));
          });
        }
      } catch (e) {}
      try {
        if (P.voices && win.SpeechSynthesis) defMethodOn(win.SpeechSynthesis.prototype, 'getVoices', function () { return cloneInto([], window); });
      } catch (e) {}

      // More spoofing: battery, network info, gamepads, colour scheme, timers, storage quota
      try { if (P.battery) remove('getBattery'); } catch (e) {}
      try { if (P.conn) { remove('connection'); remove('mozConnection'); remove('webkitConnection'); } } catch (e) {}
      try { if (P.pads) defMethodOn(proto, 'getGamepads', function () { return cloneInto([], window); }); } catch (e) {}
      try {
        if (P.light && win.matchMedia) {
          const origMM = win.matchMedia;
          defMethodOn(win, 'matchMedia', function (q) {
            const r = origMM.call(win, q);
            try {
              const t = String(q);
              if (!/,|\band\b|\bnot\b/i.test(t)) {
                let v = null;
                if (/prefers-color-scheme\s*:\s*dark/i.test(t)) v = false;
                else if (/prefers-color-scheme\s*:\s*light/i.test(t)) v = true;
                else if (/prefers-reduced-motion\s*:\s*reduce/i.test(t)) v = false;
                else if (/prefers-reduced-motion\s*:\s*no-preference/i.test(t)) v = true;
                if (v !== null) Object.defineProperty(r, 'matches', { get: exportFunction(function () { return v; }, window), configurable: true });
              }
            } catch (e) {}
            return r;
          });
        }
      } catch (e) {}
      try {
        // Accessibility preferences (forced colours / high contrast, contrast, inverted colours, reduced transparency / data)
        // can reveal assistive-technology use and make a browser rare: report the default ("none") for simple queries.
        if (P.a11y && win.matchMedia) {
          const prevMM = win.matchMedia;
          defMethodOn(win, 'matchMedia', function (q) {
            const r = prevMM.call(win, q);
            try {
              const t = String(q);
              if (!/,|\band\b|\bnot\b/i.test(t)) {
                let v = null;
                if (/forced-colors\s*:\s*active/i.test(t)) v = false;
                else if (/forced-colors\s*:\s*none/i.test(t)) v = true;
                else if (/prefers-contrast\s*:\s*(more|less|custom)/i.test(t)) v = false;
                else if (/prefers-contrast\s*:\s*no-preference/i.test(t)) v = true;
                else if (/inverted-colors\s*:\s*inverted/i.test(t)) v = false;
                else if (/inverted-colors\s*:\s*none/i.test(t)) v = true;
                else if (/prefers-reduced-transparency\s*:\s*reduce/i.test(t)) v = false;
                else if (/prefers-reduced-transparency\s*:\s*no-preference/i.test(t)) v = true;
                else if (/prefers-reduced-data\s*:\s*reduce/i.test(t)) v = false;
                else if (/prefers-reduced-data\s*:\s*no-preference/i.test(t)) v = true;
                if (v !== null) Object.defineProperty(r, 'matches', { get: exportFunction(function () { return v; }, window), configurable: true });
              }
            } catch (e) {}
            return r;
          });
        }
      } catch (e) {}
      try {
        // Screen orientation: a desktop claims landscape, a phone/tablet UA claims portrait
        if (P.orient && win.ScreenOrientation) {
          const mobile = i ? i.mobile : /Mobile|Android|iPhone|iPad/.test(String(nav.userAgent));
          const SO = win.ScreenOrientation.prototype;
          defGetter(SO, 'type', mobile ? 'portrait-primary' : 'landscape-primary');
          defGetter(SO, 'angle', 0);
        }
      } catch (e) {}
      try {
        // Media capabilities: keep "supported", but report the same smooth / not power-efficient answer everywhere,
        // so hardware video decoding (which depends on your GPU) cannot be told apart
        if (P.mediaCaps && win.MediaCapabilities) {
          ['decodingInfo', 'encodingInfo'].forEach(function (name) {
            const orig = window.MediaCapabilities.prototype[name];
            if (!orig) return;
            defMethodOn(win.MediaCapabilities.prototype, name, function (cfg) {
              const self = this;
              return new win.Promise(exportFunction(function (res, rej) {
                orig.call(self, cfg).then(function (r) {
                  res(cloneInto({ supported: !!r.supported, smooth: !!r.supported, powerEfficient: false }, window));
                }, function (e) { rej(e); });
              }, window));
            });
          });
        }
      } catch (e) {}
      try {
        // Cross-tab identity leak protection: a page opened from, or navigated to from, another site must not inherit
        // that site's window.name or keep a live window.opener handle (both link two tabs / two identities together)
        if (P.xtab) {
          const siteOf = function (h) {
            h = String(h || '').toLowerCase();
            if (!h || /^[\d.]+$/.test(h) || h.indexOf(':') >= 0) return h;
            return h.split('.').slice(-2).join('.');
          };
          const me = siteOf(host);
          let refHost = '';
          try { refHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
          let crossOpener = false;
          try {
            if (window.opener) {
              try { crossOpener = siteOf(window.opener.location.hostname) !== me; } catch (e2) { crossOpener = true; }
            }
          } catch (e) {}
          if (window === window.top) {
            if (crossOpener || (refHost && siteOf(refHost) !== me)) { try { win.name = ''; } catch (e) {} }
            if (crossOpener) defGetter(win, 'opener', null);
          }
        }
      } catch (e) {}
      try {
        if (P.coarse && win.Performance) {
          const origNow = window.Performance.prototype.now;
          defMethodOn(win.Performance.prototype, 'now', function () { return Math.round(origNow.call(this) / 100) * 100; });
        }
      } catch (e) {}
      try {
        if (P.storage && win.StorageManager) {
          defMethodOn(win.StorageManager.prototype, 'estimate', function () {
            return new win.Promise(exportFunction(function (res) { res(cloneInto({ quota: 10737418240, usage: 0 }, window)); }, window));
          });
        }
      } catch (e) {}

      // Blend in: standard battery / time zone / audio so the combination is not unique
      try {
        if (P.blend) {
          try { remove('getBattery'); } catch (e) {}
          try { remove('webdriver'); define('webdriver', false); } catch (e) {}
        }
      } catch (e) {}

      try {
        if (P.tz && win.Date) {
          const DP = window.Date.prototype;
          defMethodOn(win.Date.prototype, 'getTimezoneOffset', function () { return 0; });
          const wrapLocale = function (name) {
            const orig = DP[name];
            if (!orig) return;
            defMethodOn(win.Date.prototype, name, function (loc, opts) {
              let o = opts;
              try { o = (opts && typeof opts === 'object') ? Object.assign({}, opts) : {}; if (!o.timeZone) o.timeZone = 'UTC'; } catch (e) { o = opts; }
              return orig.call(this, loc, o);
            });
          };
          ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(wrapLocale);
          if (window.Intl && window.Intl.DateTimeFormat) {
            const RO = window.Intl.DateTimeFormat.prototype.resolvedOptions;
            defMethodOn(win.Intl.DateTimeFormat.prototype, 'resolvedOptions', function () {
              const r = RO.call(this);
              try { if (!this.__uaf) r.timeZone = 'UTC'; } catch (e) {}
              return r;
            });
          }
        }
      } catch (e) {}

      // Custom time zone: offsets, wall-clock getters, toString family, Intl default zone and toLocale* all agree
      try {
        if (P.tzName && win.Date && window.Intl) {
          const tz = P.tzName, D = window.Date, DP = D.prototype, getTime = DP.getTime, OrigDTF = window.Intl.DateTimeFormat;
          const fmt = new OrigDTF('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
          const fmtName = new OrigDTF('en-US', { timeZone: tz, timeZoneName: 'long' });
          const offMin = function (t) {            // minutes to add to UTC to get the wall clock in tz
            const p = fmt.formatToParts(new D(t)), o = {};
            for (let k = 0; k < p.length; k++) o[p[k].type] = Number(p[k].value);
            return Math.round((D.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second) - Math.floor(t / 1000) * 1000) / 60000);
          };
          const gu = function (d, n) { return DP[n].call(d); };
          const wall = function (self) { const t = getTime.call(self); return t !== t ? null : new D(t + offMin(t) * 60000); };
          [['getFullYear', 'getUTCFullYear'], ['getMonth', 'getUTCMonth'], ['getDate', 'getUTCDate'], ['getDay', 'getUTCDay'],
           ['getHours', 'getUTCHours'], ['getMinutes', 'getUTCMinutes']].forEach(function (kv) {
            defMethodOn(win.Date.prototype, kv[0], function () { const w = wall(this); return w ? gu(w, kv[1]) : NaN; });
          });
          defMethodOn(win.Date.prototype, 'getTimezoneOffset', function () { const t = getTime.call(this); return t !== t ? NaN : -offMin(t); });

          const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
          const zone = function (t) {
            try { const pp = fmtName.formatToParts(new D(t)); for (let k = 0; k < pp.length; k++) if (pp[k].type === 'timeZoneName') return pp[k].value; } catch (e) {}
            return tz;
          };
          const str = function (self) {
            const t = getTime.call(self);
            if (t !== t) return null;
            const off = offMin(t), w = new D(t + off * 60000), a = Math.abs(off);
            const y = String(gu(w, 'getUTCFullYear'));
            return {
              date: DAYS[gu(w, 'getUTCDay')] + ' ' + MON[gu(w, 'getUTCMonth')] + ' ' + p2(gu(w, 'getUTCDate')) + ' ' + ('0000' + y).slice(-Math.max(4, y.length)),
              time: p2(gu(w, 'getUTCHours')) + ':' + p2(gu(w, 'getUTCMinutes')) + ':' + p2(gu(w, 'getUTCSeconds')),
              zone: 'GMT' + (off < 0 ? '-' : '+') + p2(Math.floor(a / 60)) + p2(a % 60) + ' (' + zone(t) + ')'
            };
          };
          defMethodOn(win.Date.prototype, 'toString', function () { const r = str(this); return r ? r.date + ' ' + r.time + ' ' + r.zone : 'Invalid Date'; });
          defMethodOn(win.Date.prototype, 'toDateString', function () { const r = str(this); return r ? r.date : 'Invalid Date'; });
          defMethodOn(win.Date.prototype, 'toTimeString', function () { const r = str(this); return r ? r.time + ' ' + r.zone : 'Invalid Date'; });

          ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(function (name) {
            const orig = DP[name];
            if (!orig) return;
            defMethodOn(win.Date.prototype, name, function (loc, opts) {
              let o = opts;
              try { o = (opts && typeof opts === 'object') ? Object.assign({}, opts) : {}; if (!o.timeZone) o.timeZone = tz; } catch (e) { o = opts; }
              return orig.call(this, loc, o);
            });
          });
          // new Intl.DateTimeFormat() without an explicit timeZone defaults to the fake one
          try {
            const W = exportFunction(function (loc, opts) {
              let o = opts;
              try { o = (opts && typeof opts === 'object') ? Object.assign({}, opts) : {}; if (!o.timeZone) o.timeZone = tz; } catch (e) { o = opts; }
              return new OrigDTF(loc, o);
            }, window, { allowCrossOriginArguments: true });
            W.prototype = win.Intl.DateTimeFormat.prototype;
            try { W.supportedLocalesOf = exportFunction(function (l, o) { return OrigDTF.supportedLocalesOf(l, o); }, window); } catch (e) {}
            Object.defineProperty(win.Intl, 'DateTimeFormat', { value: W, writable: true, configurable: true, enumerable: false });
          } catch (e) {}
        }
      } catch (e) {}

      // Audio fingerprint: imperceptible noise on readbacks
      try {
        if (P.audio) {
          const seed = (Math.random() * 4294967296) >>> 0;
          const jig = function (arr) {
            for (let k = 0, n = arr.length; k < n; k += 7) {
              let r = Math.imul(k + 1, 2654435761) ^ seed;
              r = (Math.imul(r ^ (r >>> 15), 2246822519) >>> 0);
              arr[k] += ((r % 2001) - 1000) * 1e-9;
            }
          };
          if (window.AudioBuffer) {
            const og = window.AudioBuffer.prototype.getChannelData, oc = window.AudioBuffer.prototype.copyFromChannel;
            defMethodOn(win.AudioBuffer.prototype, 'getChannelData', function () {
              const d = og.apply(this, arguments);
              try { if (!this.__uafn) { jig(d); } } catch (e) {}
              return d;
            });
            defMethodOn(win.AudioBuffer.prototype, 'copyFromChannel', function (dest) {
              const r = oc.apply(this, arguments);
              try { jig(dest); } catch (e) {}
              return r;
            });
          }
          if (window.AnalyserNode) {
            const of = window.AnalyserNode.prototype.getFloatFrequencyData;
            defMethodOn(win.AnalyserNode.prototype, 'getFloatFrequencyData', function (a) {
              const r = of.apply(this, arguments);
              try { jig(a); } catch (e) {}
              return r;
            });
          }
        }
      } catch (e) {}

      // Geolocation: always "permission denied"
      try {
        if (P.geo && !P.geoFull) {
          const denied = function () {
            return cloneInto({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }, window);
          };
          const fail = function (err) {
            if (typeof err === 'function') window.setTimeout(function () { try { err(denied()); } catch (e) {} }, 0);
          };
          define('geolocation', cloneInto({
            getCurrentPosition: function (ok, err) { fail(err); },
            watchPosition: function (ok, err) { fail(err); return 1; },
            clearWatch: function () {}
          }, window, { cloneFunctions: true }));
        }
      } catch (e) {}

      // Geolocation: FULL block (API, Permissions API, and every iframe)
      try {
        if (P.geoFull) {
          const mkErr = function () {
            return cloneInto({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }, window);
          };
          const deny = function (err) {
            if (typeof err === 'function') window.setTimeout(function () { try { err(mkErr()); } catch (e) {} }, 0);
          };
          let wid = 0;
          if (win.Geolocation) {
            const G = win.Geolocation.prototype;
            defMethodOn(G, 'getCurrentPosition', function (ok, err) { deny(err); });
            defMethodOn(G, 'watchPosition', function (ok, err) { deny(err); return ++wid; });
            defMethodOn(G, 'clearWatch', function () {});
          } else {
            define('geolocation', cloneInto({
              getCurrentPosition: function (ok, err) { deny(err); },
              watchPosition: function (ok, err) { deny(err); return ++wid; },
              clearWatch: function () {}
            }, window, { cloneFunctions: true }));
          }
          // navigator.permissions.query({name:'geolocation'}) -> always "denied"
          if (win.Permissions && win.Permissions.prototype.query) {
            const origQ = window.Permissions.prototype.query;
            defMethodOn(win.Permissions.prototype, 'query', function (desc) {
              let isGeo = false;
              try { isGeo = !!desc && String(desc.name) === 'geolocation'; } catch (e) {}
              if (!isGeo) return origQ.call(this, desc);
              return new win.Promise(exportFunction(function (resolve) {
                resolve(cloneInto({ name: 'geolocation', state: 'denied', onchange: null,
                  addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return true; } },
                  window, { cloneFunctions: true }));
              }, window));
            });
          }
        }
      } catch (e) {}

      // document.referrer follows the Referer header policy
      try {
        if (P.referrer && P.referrer !== 'default' && win.Document) {
          const rd = Object.getOwnPropertyDescriptor(window.Document.prototype, 'referrer');
          const sk = function (h) {
            h = String(h || '').toLowerCase();
            if (!h || /^[\d.]+$/.test(h) || h.indexOf(':') >= 0) return h;
            return h.split('.').slice(-2).join('.');
          };
          Object.defineProperty(win.Document.prototype, 'referrer', {
            get: exportFunction(function () {
              let r = '';
              try { r = rd.get.call(this); } catch (e) { return ''; }
              if (!r || P.referrer === 'none') return '';
              try {
                const u = new URL(r);
                if (P.referrer === 'origin') return u.origin + '/';
                if (P.referrer === 'cross-origin-strip' && sk(u.hostname) !== sk(location.hostname)) return '';
              } catch (e) {}
              return r;
            }, window),
            set: undefined, enumerable: true, configurable: true
          });
        }
      } catch (e) {}

      // Canvas fingerprinting: add imperceptible, per-page-load noise to pixel readbacks
      try {
        if (P.canvas) {
          const seed = (Math.random() * 4294967296) >>> 0;
          const perturb = function (d) {
            for (let k = 0, n = d.length; k < n; k += 4) {
              if (d[k + 3] === 0) continue;
              let r = Math.imul(k + 1, 2654435761) ^ seed;
              r = Math.imul(r ^ (r >>> 15), 2246822519);
              r = (r ^ (r >>> 13)) >>> 0;
              if ((r & 15) === 0) d[k + ((r >>> 4) % 3)] ^= 1;
            }
          };
          const CP = window.HTMLCanvasElement.prototype;
          const C2 = window.CanvasRenderingContext2D.prototype;
          const oGet = C2.getImageData, oPut = C2.putImageData, oURL = CP.toDataURL, oBlob = CP.toBlob;
          const noisy = function (canvas) {
            try {
              const w = canvas.width, h = canvas.height;
              if (!w || !h || w * h > 16000000) return null;
              const t = document.createElement('canvas');
              t.width = w; t.height = h;
              const c = t.getContext('2d');
              c.drawImage(canvas, 0, 0);
              const img = oGet.call(c, 0, 0, w, h);
              perturb(img.data);
              oPut.call(c, img, 0, 0);
              return t;
            } catch (e) { return null; }
          };
          defMethodOn(win.HTMLCanvasElement.prototype, 'toDataURL', function () {
            return oURL.apply(noisy(this) || this, arguments);
          });
          defMethodOn(win.HTMLCanvasElement.prototype, 'toBlob', function (cb, type, quality) {
            const src = noisy(this) || this;
            return oBlob.call(src, function (b) { if (typeof cb === 'function') cb(b); }, type, quality);
          });
          defMethodOn(win.CanvasRenderingContext2D.prototype, 'getImageData', function () {
            const img = oGet.apply(this, arguments);
            try { perturb(img.data); } catch (e) {}
            return img;
          });
        }
      } catch (e) {}

      // WebGL: hide the real GPU
      try {
        if (P.webgl && P.webgl !== 'off') {
          const gpu = (function () {
            if (P.webgl === 'fixed' && P.gpu) {
              const ff = i ? i.family === 'firefox' : /Firefox\//.test(String(nav.userAgent));
              return [P.gpu[0], P.gpu[1], ff ? 'Mozilla' : 'WebKit', ff ? 'Mozilla' : 'WebKit WebGL'];
            }
            const common = ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'WebKit', 'WebKit WebGL'];
            if (P.webgl !== 'match' || !i) return common;
            if (i.family === 'bot') return common;
            if (i.family === 'safari' || i.os === 'ios') return ['Apple Inc.', 'Apple GPU', 'WebKit', 'WebKit WebGL'];
            if (i.family === 'firefox') {
              if (i.os === 'windows') return [common[0], common[1], 'Mozilla', 'Mozilla'];
              if (i.os === 'macos') return ['Apple', 'Apple M1', 'Mozilla', 'Mozilla'];
              if (i.os === 'android') return ['Qualcomm', 'Adreno (TM) 650', 'Mozilla', 'Mozilla'];
              return ['Intel', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)', 'Mozilla', 'Mozilla'];
            }
            if (i.os === 'macos') return ['Google Inc. (Apple)', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'WebKit', 'WebKit WebGL'];
            if (i.os === 'android') return ['Google Inc. (Qualcomm)', 'ANGLE (Qualcomm, Adreno (TM) 650, OpenGL ES 3.2)', 'WebKit', 'WebKit WebGL'];
            if (i.os === 'linux' || i.os === 'cros') return ['Google Inc. (Intel)', 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)', 'WebKit', 'WebKit WebGL'];
            return common;
          })();
          ['WebGLRenderingContext', 'WebGL2RenderingContext'].forEach(function (nm) {
            if (!window[nm] || !win[nm]) return;
            const orig = window[nm].prototype.getParameter;
            defMethodOn(win[nm].prototype, 'getParameter', function (p) {
              if (p === 37445) return gpu[0];   // UNMASKED_VENDOR_WEBGL
              if (p === 37446) return gpu[1];   // UNMASKED_RENDERER_WEBGL
              if (p === 7936) return gpu[2];    // VENDOR
              if (p === 7937) return gpu[3];    // RENDERER
              return orig.call(this, p);
            });
          });
        }
      } catch (e) {}
    }
  } catch (e) { /* never break the page */ }
}

const BLEND_LANG = 'en-US,en;q=0.9';
function effLang() { return state.acceptLanguage || (state.blendIn ? BLEND_LANG : ''); }

function parseLangs(s) {
  return String(s || '').split(',').map(x => x.split(';')[0].trim()).filter(Boolean).slice(0, 8);
}

// OS the browser should claim to be on, for OS-matched fonts: the spoofed global / rotating UA, else the real OS.
function claimedOS() {
  const ua = state.enabled ? ((state.autoChange && state.autoCurrentUA) || state.globalUA || '') : '';
  if (ua) { const o = UA.parseUA(ua).os; if (['windows', 'macos', 'linux', 'android', 'ios'].includes(o)) return o; if (o === 'cros') return 'linux'; }
  return realOS;
}

function fontHide() { return UA.fontHideList(state.fontMode, claimedOS(), state.fontList); }

function gpuOverride() {
  if (state.webglMode === 'preset') {
    const g = UA.GPU_PRESETS.find(x => x.id === state.gpuPreset);
    return g ? [g.vendor, g.renderer] : null;
  }
  if (state.webglMode === 'custom') {
    const v = String(state.gpuVendor || '').trim().slice(0, 200), r = String(state.gpuRenderer || '').trim().slice(0, 200);
    return (v || r) ? [v || 'Google Inc.', r || 'ANGLE'] : null;
  }
  return null;
}

function privacyJsConfig() {
  if (!state.privacyEnabled) return null;
  const s = state;
  const hw = Math.round(Number(s.hwConcurrency));
  const sm = /^(\d{3,5})x(\d{3,5})$/.exec(String(s.screenSize || '').trim());
  const dpr = Number(s.screenDPR);
  const depth = Math.round(Number(s.screenDepth));
  const mem = Number(s.deviceMemory);
  const bl = !!s.blendIn;
  const gpu = gpuOverride();
  let tzName = '';
  if (s.tzMode === 'custom' && s.tzName) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: s.tzName }); tzName = s.tzName; } catch (e) { tzName = ''; }
  } else if (s.tzMode === 'utc') tzName = 'UTC';
  const P = {
    langs: parseLangs(effLang()),
    hwc: hw >= 1 && hw <= 64 ? hw : (bl ? 8 : 0),
    dnt: !!s.hdrDNT, gpc: !!s.hdrGPC,
    screen: sm ? { w: Number(sm[1]), h: Number(sm[2]) } : null,
    screenAuto: bl && !sm,
    dpr: dpr >= 0.5 && dpr <= 4 ? dpr : 0,
    depth: [24, 30, 32].includes(depth) ? depth : 0,
    screenWindow: !!s.screenWindow,
    blend: bl,
    tz: bl && s.blendTimezone !== false && !tzName,
    tzName,
    audio: bl || !!s.audioNoise,
    canvas: bl || !!s.canvasNoise,
    webgl: gpu ? 'fixed' : (s.webglMode === 'preset' || s.webglMode === 'custom') ? 'off' : ((s.webglMode && s.webglMode !== 'off') ? s.webglMode : (bl ? 'match' : 'off')),
    gpu,
    webgpu: !!s.blockWebGPU,
    mem: [0.25, 0.5, 1, 2, 4, 8].includes(mem) ? mem : 0,
    mediaDev: !!s.hideMediaDevices,
    voices: !!s.hideVoices,
    battery: !!s.hideBattery, conn: !!s.hideConnection, pads: !!s.hideGamepads,
    light: !!s.preferLight, coarse: !!s.coarseTimers, storage: !!s.fakeStorage, a11y: !!s.hideA11y, orient: !!s.matchOrientation, mediaCaps: !!s.fakeMediaCaps, xtab: !!s.crossTabProtect,
    geo: !!(s.geoBlock || s.geoFull),
    geoFull: !!s.geoFull,
    beacon: !!s.blockBeacon,
    referrer: s.referrerMode || 'default'
  };
  const any = P.blend || P.audio || P.langs.length || P.hwc || P.dnt || P.gpc || P.screen || P.dpr || P.depth || P.canvas || P.webgl !== 'off' ||
    P.webgpu || P.mem || P.mediaDev || P.voices || P.battery || P.conn || P.pads || P.light || P.a11y || P.orient || P.mediaCaps || P.xtab || P.coarse || P.storage || P.tzName || P.geo || P.geoFull || P.beacon || P.referrer !== 'default';
  return any ? P : null;
}

// Fonts are hidden with an extension-injected stylesheet (it is not blocked by a page's Content-Security-Policy):
// an @font-face whose source cannot be decoded makes that family name resolve to "not installed" instead of the real system font.
async function applyFontCss() {
  if (fontCssHandle) { try { await fontCssHandle.unregister(); } catch (e) {} fontCssHandle = null; }
  if (!state.privacyEnabled || state.fontMode === 'off') return;
  const names = fontHide();
  if (!names.length) return;
  const css = names.map(n => '@font-face{font-family:"' + n.replace(/["\\]/g, '') + '";src:url("data:font/woff2;base64,AAAA");}').join('');
  const exclude = Object.keys(derived.exempt).flatMap(h => ['*://' + h + '/*', '*://*.' + h + '/*']);
  try {
    fontCssHandle = await browser.contentScripts.register({
      matches: ['<all_urls>'], excludeMatches: exclude.length ? exclude : undefined,
      css: [{ code: css }], allFrames: true, matchAboutBlank: true, runAt: 'document_start'
    });
  } catch (e) { console.error('[Vivid User Privacy] font stylesheet registration failed', e); }
}


let csQueue = Promise.resolve();
function applyContentScript(skipFonts) {
  csQueue = csQueue.then(() => applyContentScriptNow(skipFonts)).catch(e => console.error('[Vivid User Privacy]', e));
  return csQueue;
}

async function applyContentScriptNow(skipFonts) {
  if (!skipFonts) await applyFontCss();
  const old = csHandle;   // swap in the new script first, then drop the old one, so no page load falls into a gap
  csHandle = null;
  const dropOld = async () => { if (old) { try { await old.unregister(); } catch (e) {} } };
  const fallback = (state.autoChange && state.autoCurrentUA) ? state.autoCurrentUA : (state.globalUA || '');
  const rules = (state.autoChange && stickyOn()) ? stickyRules() : state.rules;
  const hasRules = Object.keys(rules).length > 0;
  const uaNeeded = state.enabled && (fallback || hasRules);
  const priv = privacyJsConfig();
  if (!uaNeeded && !priv) { await dropOld(); return; }
  const cfg = {
    uaOn: !!state.enabled, workerMode: state.workerMode || 'match', rules, fallback, DEFAULT: UA.DEFAULT, stealth: state.stealth !== false,
    priv, exempt: derived.exempt, cf: derived.cf, cfSite: derived.cfSite,
    checkUA: (() => { try { return checkSafeUA(); } catch (e) { return ''; } })()
  };
  const code = `(function(){\n${UA.parseUA}\n${UA.findRule}\n(${injector})(${JSON.stringify(cfg)});\n})();`;
  try {
    csHandle = await browser.contentScripts.register({
      matches: ['<all_urls>'],
      js: [{ code }],
      allFrames: true,
      matchAboutBlank: true,
      runAt: 'document_start'
    });
  } catch (e) { console.error('[Vivid User Privacy] content script registration failed', e); }
  await dropOld();
}

/* ---------------- badge ---------------- */

function describeUA(ua) {
  ua = String(ua || '');
  let code = 'UA', name = 'Custom';
  if (/Edg(e|A|iOS)?\//.test(ua)) { code = 'EDG'; name = 'Edge'; }
  else if (/OPR\/|Opera/.test(ua)) { code = 'OPR'; name = 'Opera'; }
  else if (/Firefox\/|FxiOS\//.test(ua)) { code = 'FF'; name = 'Firefox'; }
  else if (/Chrome\/|CriOS\//.test(ua)) { code = 'CHR'; name = 'Chrome'; }
  else if (/Safari\//.test(ua)) { code = 'SAF'; name = 'Safari'; }
  let os = '', oc = '';
  if (/Windows/.test(ua)) { os = 'Windows'; oc = 'WIN'; }
  else if (/iPhone/.test(ua)) { os = 'iPhone'; oc = 'iOS'; }
  else if (/iPad/.test(ua)) { os = 'iPad'; oc = 'iOS'; }
  else if (/Android/.test(ua)) { os = 'Android'; oc = 'AND'; }
  else if (/Macintosh|Mac OS X/.test(ua)) { os = 'macOS'; oc = 'MAC'; }
  else if (/CrOS/.test(ua)) { os = 'ChromeOS'; oc = 'CrOS'; }
  else if (/Linux|X11/.test(ua)) { os = 'Linux'; oc = 'LNX'; }
  return { code, osCode: oc, label: name + (os ? ' on ' + os : '') };
}


/* Toolbar icon showing "BROWSER / OS" (e.g. FF over WIN), drawn on a canvas */
function agentIcon(code, osCode) {
  const out = {};
  for (const s of [16, 32, 64]) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), r = s * 0.2;
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(s, 0, s, s, r); g.arcTo(s, s, 0, s, r); g.arcTo(0, s, 0, 0, r); g.arcTo(0, 0, s, 0, r); g.closePath();
    g.fillStyle = '#05070a'; g.fill();
    g.lineWidth = Math.max(1, s / 16); g.strokeStyle = '#2f81f7'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 ' + Math.round(s * (code.length > 2 ? 0.37 : 0.45)) + 'px system-ui, Arial, sans-serif';
    g.fillStyle = '#58a6ff'; g.fillText(code, s / 2, s * 0.31, s * 0.9);
    g.font = '800 ' + Math.round(s * 0.37) + 'px system-ui, Arial, sans-serif';
    g.fillStyle = '#ffffff'; g.fillText(osCode || '?', s / 2, s * 0.72, s * 0.9);
    out[s] = g.getImageData(0, 0, s, s);
  }
  return out;
}

function updateBadge() {
  const ruleCount = Object.keys(state.rules).length;
  const rotating = !!(state.autoChange && state.autoCurrentUA);
  const ua = rotating ? state.autoCurrentUA : state.globalUA;
  const uaActive = !!(state.enabled && (ua || ruleCount));
  const proxyActive = state.proxyEnabled && state.proxies.length > 0;

  let agent = null, text, color, lines = ['Vivid User Privacy — ' + (uaActive ? 'ON' : 'OFF'), 'Auto rotation: ' + (state.enabled && state.autoChange ? 'ON' : 'OFF')];
  if (uaActive && ua) {
    const d = describeUA(ua);
    text = rotating ? 'AUTO' : 'SET';
    color = rotating ? '#2f9e44' : '#e07b00'; agent = d;
    lines.push('Agent: ' + d.label + (rotating ? ' (rotating automatically)' : ' (your chosen User-Agent — auto rotation is off)'), ua);
    if (ruleCount) lines.push('+ ' + ruleCount + ' per-site rule' + (ruleCount > 1 ? 's' : ''));
  } else if (uaActive) {
    text = 'RULE'; color = '#2f81f7';
    lines.push('Agent: per-site rules only (' + ruleCount + ')');
  } else {
    text = 'OFF'; color = '#d33';
    lines.push('Sending your real Firefox User-Agent');
  }
  if (proxyActive) lines.push('Proxy: on');

  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({ color });
  if (browser.browserAction.setBadgeTextColor) browser.browserAction.setBadgeTextColor({ color: '#ffffff' });
  browser.browserAction.setTitle({ title: lines.join('\n') });
  const icon = agent ? { imageData: agentIcon(agent.code, agent.osCode) } : { path: uaActive ? 'icon.svg' : 'icon-off.svg' };
  browser.browserAction.setIcon(icon).catch(() => {});
}

/* ---------------- UA rotation ---------------- */

async function rotate() {
  // Random rotation can also draw from the user's own saved agents (Settings → User-Agent → My custom User-Agents)
  const mixable = /^random-(any|desktop|mobile)$/.test(state.autoProfile) && state.mixCustom !== false && UA.customAgents().length > 0;
  const pct = Math.min(100, Math.max(0, Number(state.customMixPercent) || 0));
  const ua = (mixable && Math.random() * 100 < pct)
    ? UA.generate('custom-list')
    : UA.generate(UA.pickProfile(state.autoProfile), { jitter: true });
  await pruneSticky();   // sites with open tabs keep their current User-Agent; everything else moves on
  await browser.storage.local.set({ autoCurrentUA: ua, autoLastChanged: Date.now() });
}

function schedule() {
  clearTimeout(rotateTimer);
  rotateTimer = null;
  if (!state.enabled || !state.autoChange) return;
  const secs = Math.min(86400, Math.max(60, Number(state.autoChangeSeconds) || 300));
  const wait = Math.max(0, (state.autoLastChanged || 0) + secs * 1000 - Date.now());
  rotateTimer = setTimeout(() => enqueue(rotate), wait);
}

/* ---------------- live browser versions ---------------- */

const LIVE_EVERY = 3600 * 1000;   // always-fresh: re-check the online sources at most hourly

// Staying current is not optional in this add-on: these three are always on.
function forceFresh() { state.keepFresh = true; state.uaApi = /^https:\/\//i.test(state.customListUrl || ''); state.liveVersions = true; }
let liveBusy = false;

async function fetchJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Optional: your own list of User-Agents, any plain-text file (one per line; "#" comments, quotes and trailing commas are tolerated,
// and a JSON array of strings also works). Blank = not used. Only fetched when you set a URL.
async function fetchList(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (text.length > 2000000) throw new Error('file is larger than 2 MB');
    const t0 = text.trim();
    if (t0[0] === '[') { try { const j = JSON.parse(t0); if (Array.isArray(j)) return j; } catch (e) { /* fall through to line parsing */ } }
    return text.split(/\r?\n/).map(l => l.trim().replace(/^["']|["'],?$/g, '').trim()).filter(l => l && l[0] !== '#');
  } finally { clearTimeout(t); }
}

// Layered, so something always works:  online UA list  →  vendor version feeds  →  built-in estimates.
async function refreshVersions(force) {
  if (liveBusy) return { ok: false, error: 'already running' };
  if (!state.liveVersions && !state.uaApi) return { ok: false, error: 'Online lookups are turned off.' };
  const last = Math.max(state.liveFetched || 0, state.apiFetched || 0);
  if (!force && Date.now() - last < LIVE_EVERY) return { ok: true, cached: true };
  liveBusy = true;
  const patch = {}, errs = [];
  const sane = (n, est) => n >= est - 6 && n <= est + 10;   // ignore garbage / wrong feeds
  try {
    if (state.uaApi) {
      try {
        const list = await fetchList(state.customListUrl);
        const clean = UA.cleanApiList(list);
        if (clean.length < 3) throw new Error('no valid User-Agent lines found (each line must start with Mozilla/5.0 (…)');
        patch.apiList = clean; patch.apiFetched = Date.now(); patch.apiError = '';
      } catch (e) { patch.apiError = 'Your list: ' + (e.message || e); errs.push(patch.apiError); }
    }
    if (state.liveVersions) {
      const data = Object.assign({}, state.liveData || {}), ferrs = [];
      try {
        const j = await fetchJSON('https://versionhistory.googleapis.com/v1/chrome/platforms/win/channels/stable/versions?pageSize=1&orderBy=version%20desc');
        const v = parseInt(j && j.versions && j.versions[0] && j.versions[0].version, 10);
        if (sane(v, UA.estimate.chrome())) data.chrome = v; else ferrs.push('Chrome feed returned an unexpected version');
      } catch (e) { ferrs.push('Chrome: ' + (e.message || e)); }
      try {
        const j = await fetchJSON('https://product-details.mozilla.org/1.0/firefox_versions.json');
        const f = parseInt(j && j.LATEST_FIREFOX_VERSION, 10), esr = parseInt(j && j.FIREFOX_ESR, 10);
        if (sane(f, UA.estimate.firefox())) data.firefox = f; else ferrs.push('Firefox feed returned an unexpected version');
        if (esr >= 115 && esr <= f) data.esr = esr;
      } catch (e) { ferrs.push('Firefox: ' + (e.message || e)); }
      if (ferrs.length < 2) { data.at = Date.now(); patch.liveData = data; patch.liveFetched = Date.now(); }
      patch.liveError = ferrs.join('; ');
      // only an error if neither source worked at all
      if (ferrs.length >= 2 && (!state.uaApi || patch.apiError)) errs.push(...ferrs);
    }
    await browser.storage.local.set(patch);
    return { ok: errs.length === 0, error: errs.join('; ') };
  } finally { liveBusy = false; }
}

// Keep the saved "Apply to all sites" UA current when it was generated from a profile.
async function freshenGlobal() {
  if (!state.keepFresh || !state.globalProfile || state.autoChange) return;
  if (!UA.PROFILES.some(p => p.id === state.globalProfile)) return;
  const ua = UA.generate(state.globalProfile, { jitter: false });
  if (ua !== state.globalUA) await browser.storage.local.set({ globalUA: ua });
}

let liveTimer = null;
function scheduleLive() {
  clearInterval(liveTimer);
  liveTimer = null;
  if (!state.liveVersions && !state.uaApi) return;
  liveTimer = setInterval(() => enqueue(() => refreshVersions(false)), 15 * 60 * 1000);
}

/* ---------------- wiring ---------------- */

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).every(k => k === 'uaProfile' || k === 'cfSites')) return;   // remembered dropdown choice only: nothing to re-apply
  if (Object.keys(changes).every(k => k === 'autoCurrentUA' || k === 'autoLastChanged')) {
    // a rotation tick: only the injected User-Agent and the badge change, nothing else needs rebuilding
    enqueue(async () => {
      for (const [k, c] of Object.entries(changes)) state[k] = ('newValue' in c) ? c.newValue : DEF[k];
      await applyContentScript(true);
      updateBadge();
      schedule();
    });
    return;
  }
  enqueue(async () => {
    for (const [k, c] of Object.entries(changes)) state[k] = ('newValue' in c) ? c.newValue : DEF[k];
    forceFresh();
    sanitizeState();
    if (changes.chromeMajor || changes.safariMajor) {
      UA.configure({ chromeMajor: Number(state.chromeMajor) || 0, safariMajor: Number(state.safariMajor) || 0 });
    }
    const liveChanged = changes.liveData || changes.liveVersions || changes.apiList || changes.uaApi || changes.customListUrl;
    if (changes.liveData || changes.liveVersions) UA.applyLive(state.liveVersions ? state.liveData : null);
    if (changes.apiList || changes.uaApi) UA.applyApi(state.uaApi ? state.apiList : []);
    if (liveChanged || changes.chromeMajor || changes.safariMajor || changes.keepFresh || changes.globalProfile) await freshenGlobal();
    if (changes.liveVersions || changes.uaApi || changes.customListUrl) { scheduleLive(); refreshVersions(true); }
    if (changes.proxies || changes.proxyRotation) { proxyShift = 0; proxyDownUntil = 0; }
    if (changes.autoProfile || changes.autoChange || changes.autoSticky || changes.crossTabProtect || changes.customUAs || changes.mixCustom || changes.customMixPercent || changes.enabled || changes.globalUA) stickyUA.clear();
    await applyContentScript();
    updateBadge();
    if (Object.keys(changes).some(k => BROWSER_KEYS.includes(k))) await applyBrowserPrivacy();
    const regen = changes.autoChange || changes.autoProfile || changes.customUAs || changes.mixCustom || changes.customMixPercent || changes.chromeMajor || changes.safariMajor || changes.liveData || changes.apiList;
    if (state.enabled && state.autoChange && (regen || !state.autoCurrentUA)) await rotate();
    schedule();
    scheduleProxy();
  });
});

browser.runtime.onMessage.addListener(async msg => {
  await ready;
  switch (msg && msg.type) {
    case 'getEffective': return resolveUA(hostOf(msg.url || ''));
    case 'status': {
      const host = hostOf(msg.url || '');
      const r = host ? proxyDecision({ url: msg.url, type: 'main_frame', tabId: 1 }) : null;
      return {
        ua: resolveUA(host),
        exempt: privacyExempt(host),
        proxy: r ? UA.proxyLabel(r.p) : '',
        proxyOn: !!(state.proxyEnabled && state.proxies.length),
        proxyDown: Date.now() < proxyDownUntil,
        lastProxyError
      };
    }
    case 'rotateNow': await rotate(); return true;
    case 'refreshVersions': return refreshVersions(true);
    case 'rotateProxy': await rotateProxy(); return true;
    case 'checkIP': return checkIP(msg.idx === undefined ? null : msg.idx);
    case 'sync': await new Promise(r => setTimeout(r, 60)); await queue; return true;
  }
});

const ready = (async () => {
  await loadState();
  await applyContentScript();
  updateBadge();
  await applyBrowserPrivacy();
  if (state.enabled && state.autoChange && !state.autoCurrentUA) await rotate();
  schedule();
  scheduleProxy();
  scheduleLive();
  enqueue(async () => { await refreshVersions(false); await freshenGlobal(); });
  window.addEventListener('online', () => enqueue(() => refreshVersions(false)));   // catch up as soon as the network is back
})().catch(e => console.error('[Vivid User Privacy] startup failed', e));
