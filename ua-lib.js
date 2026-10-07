'use strict';
/* Shared by background, popup and options. Pure helpers + local UA generation. */

const DEFAULT_SENTINEL = '__default__'; // rule value meaning "no spoofing on this site"

const PROFILES = [
  { id: 'chrome-windows',  label: 'Chrome — Windows',        group: 'Desktop' },
  { id: 'chrome-mac',      label: 'Chrome — macOS',          group: 'Desktop' },
  { id: 'chrome-linux',    label: 'Chrome — Linux',          group: 'Desktop' },
  { id: 'chrome-chromeos', label: 'Chrome — ChromeOS',       group: 'Desktop' },
  { id: 'edge-windows',    label: 'Edge — Windows',          group: 'Desktop' },
  { id: 'edge-mac',        label: 'Edge — macOS',            group: 'Desktop' },
  { id: 'edge-linux',      label: 'Edge — Linux',            group: 'Desktop' },
  { id: 'firefox-windows', label: 'Firefox — Windows',       group: 'Desktop' },
  { id: 'firefox-mac',     label: 'Firefox — macOS',         group: 'Desktop' },
  { id: 'firefox-linux',   label: 'Firefox — Linux',         group: 'Desktop' },
  { id: 'firefox-esr-windows', label: 'Firefox ESR — Windows', group: 'Desktop' },
  { id: 'firefox-esr-linux',   label: 'Firefox ESR — Linux',   group: 'Desktop' },
  { id: 'safari-mac',      label: 'Safari — macOS',          group: 'Desktop' },
  { id: 'opera-windows',   label: 'Opera — Windows',         group: 'Desktop' },
  { id: 'opera-mac',       label: 'Opera — macOS',           group: 'Desktop' },
  { id: 'opera-linux',     label: 'Opera — Linux',           group: 'Desktop' },
  { id: 'android-chrome',  label: 'Chrome — Android phone',  group: 'Mobile' },
  { id: 'android-chrome-tablet', label: 'Chrome — Android tablet', group: 'Mobile' },
  { id: 'android-firefox', label: 'Firefox — Android phone', group: 'Mobile' },
  { id: 'android-edge',    label: 'Edge — Android phone',    group: 'Mobile' },
  { id: 'android-samsung', label: 'Samsung Internet — Android', group: 'Mobile' },
  { id: 'ios-safari',      label: 'Safari — iPhone',         group: 'Mobile' },
  { id: 'ipad-safari',     label: 'Safari — iPad',           group: 'Mobile' },
  { id: 'ios-chrome',      label: 'Chrome — iPhone',         group: 'Mobile' },
  { id: 'ios-firefox',     label: 'Firefox — iPhone',        group: 'Mobile' },
  { id: 'ios-edge',        label: 'Edge — iPhone',           group: 'Mobile' },
  { id: 'googlebot',       label: 'Googlebot (desktop)',     group: 'Bots' },
  { id: 'googlebot-mobile',label: 'Googlebot (smartphone)',  group: 'Bots' },
  { id: 'bingbot',         label: 'Bingbot',                 group: 'Bots' }
];

const ROTATION_EXTRAS = [
  { id: 'random-any',     label: 'Random — any browser/device' },
  { id: 'random-desktop', label: 'Random — desktop only' },
  { id: 'random-mobile',  label: 'Random — mobile only' }
];

/* ---------------- shared settings schema (single source of truth) ---------------- */

const DEFAULTS = {
  /* User-Agent */
  enabled: true, globalUA: '', rules: {},
  autoChange: true, autoSticky: true, autoChangeSeconds: 3600, autoProfile: 'random-desktop', autoCurrentUA: '', autoLastChanged: 0,
  chromeMajor: '', safariMajor: '', stealth: true,
  reloadOnApply: true,
  uaProfile: '',             // profile last chosen in the popup / settings (remembered across reloads)
  globalProfile: '',         // profile the saved global UA was generated from ('' = custom text)
  keepFresh: true,           // re-generate the saved global UA when browser versions change
  liveVersions: true,        // look up the newest Chrome / Firefox versions online
  liveData: {}, liveFetched: 0, liveError: '',
  uaApi: false,              // true only while a custom list URL is set
  customListUrl: '',         // optional: https URL of your own plain-text list of User-Agents (one per line)
  apiList: [], apiFetched: 0, apiError: '',

  /* Privacy: request headers */
  privacyEnabled: true,      // master switch for everything in the Privacy tab
  privacyExempt: '',         // sites (one per line) where privacy tweaks are skipped
  hdrDNT: false,             // send DNT: 1
  hdrGPC: false,             // send Sec-GPC: 1 (Global Privacy Control)
  referrerMode: 'default',   // default | origin | cross-origin-strip | none
  cfSites: [],               // sites that showed a bot check (learned automatically; Firefox identity only there)
  stripTracking: false,      // "Clean links": remove utm_*, fbclid, gclid ... and skip tracking redirectors (google.com/url?q=, l.facebook.com ...)
  upgradeHttps: false,       // open http:// pages over https:// (skips local addresses and your skip list)
  stripExtra: '',            // extra parameter names to strip (supports trailing *)
  acceptLanguage: '',        // e.g. en-US,en;q=0.9 (also sets navigator.languages)

  /* Privacy: "blend in" — make this browser look like the most common one so it is not unique */
  blendIn: false,            // master switch: standard values for everything below that you left on "real"
  blendTimezone: true,       // (with blendIn) report UTC time zone
  audioNoise: false,         // tiny noise in Web Audio readbacks (audio fingerprint)

  /* Privacy: fingerprint hardening (page JavaScript) */
  hwConcurrency: '',         // navigator.hardwareConcurrency override
  screenSize: '',            // e.g. 1920x1080
  screenDPR: '',             // devicePixelRatio override, e.g. 1, 1.25, 2
  screenDepth: '',           // colour depth override: 24 | 30 | 32
  screenWindow: false,       // also make innerWidth/outerWidth/screenX/... consistent with the fake screen
  canvasNoise: false,        // add tiny per-page noise to canvas readbacks
  webglMode: 'off',          // off | match | common | preset | custom
  gpuPreset: '',             // id from GPU_PRESETS (webglMode = preset)
  gpuVendor: '',             // custom unmasked vendor   (webglMode = custom)
  gpuRenderer: '',           // custom unmasked renderer (webglMode = custom)
  blockWebGPU: false,        // hide navigator.gpu (WebGPU reveals the real GPU)
  geoBlock: true,            // deny navigator.geolocation
  geoFull: true,             // full geolocation lockdown (API + Permissions API + Permissions-Policy header)
  blockBeacon: false,        // neuter navigator.sendBeacon

  /* Spoofing: fonts, time zone, devices */
  fontMode: 'off',           // off | match (fonts of the spoofed OS) | common | custom (only your list)
  fontList: '',              // fonts to keep visible (one per line / comma separated)
  tzMode: 'off',             // off | utc | custom
  tzName: '',                // IANA time zone for tzMode = custom, e.g. Europe/Berlin
  deviceMemory: '',          // navigator.deviceMemory: 0.5 | 1 | 2 | 4 | 8
  hideMediaDevices: false,   // enumerateDevices() returns an empty list
  hideBattery: false,        // remove navigator.getBattery (battery level/charging is a fingerprint)
  hideConnection: false,     // remove navigator.connection (network type, speed estimate)
  hideGamepads: false,       // navigator.getGamepads() returns an empty list
  preferLight: false,        // report light colour scheme and "no reduced motion" to media queries
  coarseTimers: false,       // round performance.now() to 100 ms (blunts timing attacks)
  fakeStorage: false,        // navigator.storage.estimate() reports a fixed 10 GB quota and 0 bytes used
  matchOrientation: false,   // screen.orientation reports landscape (desktop UA) or portrait (mobile UA)
  fakeMediaCaps: false,      // mediaCapabilities decoding/encoding info no longer reveals hardware acceleration
  workerMode: 'match',       // match (workers report the claimed browser) | real (leave workers alone) | block (disable Worker / SharedWorker)
  crossTabProtect: false,    // keep one identity per site across all tabs; drop window.name / window.opener links from other sites
  hideA11y: false,           // matchMedia() reports no accessibility preferences (forced colours, contrast, inverted, reduced transparency/data)
  hideVoices: false,         // speechSynthesis.getVoices() returns an empty list (voice list is a fingerprint)

  /* User-Agent: your own saved agents ("Label | Mozilla/5.0 ..." or just the string, one per line) */
  customUAs: '',
  mixCustom: true,           // also pick from my custom agents when rotation is set to a Random option
  customMixPercent: 50,      // chance (%) that a rotation picks one of my custom agents instead of a built-in profile

  /* Privacy: Firefox-level settings (browser.privacy API) */
  webrtcMode: 'default',     // default | public-only | no-leak | off
  cookieMode: 'default',     // default | reject_third_party | reject_trackers | reject_trackers_and_partition_foreign
  trackingProtection: false,
  blockPing: false,          // hyperlink auditing (<a ping>)
  blockPrefetch: false,      // network prediction / DNS prefetch
  resistFingerprinting: false,
  firstPartyIsolate: false,

  /* IP hiding via proxy */
  proxyEnabled: false,
  proxies: [],               // [{name,type,host,port,username,password,isolate}]
  proxySelected: 0,
  proxyScope: 'all',         // all | listed
  proxySites: '',
  proxyBypass: '',
  proxyRotation: 'off',      // off | timed | per-site
  proxyRotateSeconds: 600,
  proxyRotateUA: false,
  proxyDNS: true,
  proxyKillSwitch: true,
  proxyForceWebRTC: true,
  ipCheckUrl: 'https://api.ipify.org/?format=json'
};

const RUNTIME_KEYS = ['cfSites', 'autoCurrentUA', 'autoLastChanged', 'liveData', 'liveFetched', 'liveError', 'apiList', 'apiFetched', 'apiError'];

const PRIVACY_PRESET_KEYS = ['hdrDNT', 'hdrGPC', 'referrerMode', 'stripTracking', 'hwConcurrency', 'canvasNoise',
  'webglMode', 'geoBlock', 'geoFull', 'blockBeacon', 'webrtcMode', 'cookieMode', 'trackingProtection', 'blockPing', 'blockPrefetch'];

const PRIVACY_PRESETS = (function () {
  const base = {};
  PRIVACY_PRESET_KEYS.forEach(k => { base[k] = DEFAULTS[k]; });
  return {
    off: { ...base },
    balanced: { ...base, hdrDNT: true, hdrGPC: true, referrerMode: 'origin', stripTracking: true, webrtcMode: 'public-only',
      cookieMode: 'reject_trackers', trackingProtection: true, blockPing: true, blockPrefetch: true },
    strict: { ...base, hdrDNT: true, hdrGPC: true, referrerMode: 'cross-origin-strip', stripTracking: true, hwConcurrency: 4,
      canvasNoise: true, webglMode: 'match', geoBlock: true, geoFull: true, blockBeacon: true, webrtcMode: 'no-leak',
      cookieMode: 'reject_trackers_and_partition_foreign', trackingProtection: true, blockPing: true, blockPrefetch: true }
  };
})();

function detectPreset(s) {
  for (const id of ['off', 'balanced', 'strict']) {
    const p = PRIVACY_PRESETS[id];
    if (PRIVACY_PRESET_KEYS.every(k => String(s[k] === undefined ? DEFAULTS[k] : s[k]) === String(p[k]))) return id;
  }
  return 'custom';
}

const PROXY_TYPES = ['socks5', 'socks4', 'http', 'https'];

const PROXY_PRESETS = [
  { id: 'tor-browser', name: 'Tor Browser (local)', type: 'socks5', host: '127.0.0.1', port: 9150, isolate: true },
  { id: 'tor-service', name: 'Tor service (local)', type: 'socks5', host: '127.0.0.1', port: 9050, isolate: true },
  { id: 'ssh',         name: 'SSH tunnel (ssh -D 1080)', type: 'socks5', host: '127.0.0.1', port: 1080, isolate: false }
];

function cleanProxies(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const host = String(p.host || '').trim().replace(/^\[|\]$/g, '');
    const port = Math.round(Number(p.port));
    if (!host || /[\s\/]/.test(host) || !(port >= 1 && port <= 65535)) continue;
    out.push({
      name: String(p.name || '').slice(0, 60),
      type: PROXY_TYPES.includes(p.type) ? p.type : 'socks5',
      host, port,
      username: String(p.username || ''),
      password: String(p.password || ''),
      isolate: !!p.isolate
    });
  }
  return out.slice(0, 50);
}

function proxyLabel(p) {
  if (!p) return '';
  return (p.name ? p.name + ' — ' : '') + `${p.type}://${p.host}:${p.port}`;
}

const env = { customList: [], lastCustom: -1, firefoxMajor: 0, chromeMajor: 0, safariMajor: 0, liveChrome: 0, liveFirefox: 0, liveEsr: 0,
  apiList: [], apiChrome: 0, apiFirefox: 0, apiEsr: 0, apiSafari: 0 };
const DAY = 864e5;

function configure(o) { Object.assign(env, o); }

async function loadEnv() {
  try {
    const info = await browser.runtime.getBrowserInfo();
    const m = parseInt(info.version, 10);
    if (m) env.firefoxMajor = m;
  } catch (e) { /* ignore */ }
  try {
    const s = await browser.storage.local.get({ chromeMajor: '', safariMajor: '', liveVersions: true, liveData: {}, uaApi: false, apiList: [], customUAs: '' });
    env.customList = parseCustomUAs(s.customUAs);
    env.chromeMajor = Number(s.chromeMajor) || 0;
    env.safariMajor = Number(s.safariMajor) || 0;
    applyLive(s.liveVersions ? s.liveData : null);
    applyApi(s.uaApi ? s.apiList : []);
  } catch (e) { /* ignore */ }
}

function applyLive(d) {
  env.liveChrome = (d && Number(d.chrome)) || 0;
  env.liveFirefox = (d && Number(d.firefox)) || 0;
  env.liveEsr = (d && Number(d.esr)) || 0;
}

/* ---- Optional user-supplied list of User-Agents (plain text, one per line) ---- */

function cleanApiList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let u of list) {
    if (typeof u !== 'string') continue;
    u = u.trim().replace(/\bVersion\/(\d+) Safari\//, 'Version/$1.0 Safari/');   // the list writes "Version/27", browsers send "Version/27.0"
    if (u.length > 300 || !/^Mozilla\/5\.0 \(/.test(u) || /[<>"\r\n]/.test(u)) continue;
    out.push(u);
    if (out.length >= 1000) break;
  }
  return out;
}

function applyApi(list) {
  const l = cleanApiList(list);
  const best = { chrome: 0, firefox: 0, safari: 0 }, lowFx = [];
  for (const u of l) {
    const i = parseUA(u);
    if (i.family === 'chrome' || i.family === 'edge') best.chrome = Math.max(best.chrome, i.chromiumMajor);
    if (i.family === 'firefox') { best.firefox = Math.max(best.firefox, i.major); lowFx.push(i.major); }
    if (i.family === 'safari') best.safari = Math.max(best.safari, i.major);
  }
  const ok = (n, est) => (n >= est - 3 && n <= est + 10) ? n : 0;   // ignore stale or nonsensical data
  env.apiList = l;
  env.apiChrome = ok(best.chrome, estChrome());
  env.apiFirefox = ok(best.firefox, estFirefox());
  const lo = lowFx.length ? Math.min(...lowFx) : 0;
  env.apiEsr = (best.firefox && lo && best.firefox - lo >= 5) ? lo : 0;
  env.apiSafari = (best.safari >= 26 && best.safari <= 40) ? best.safari : 0;
}

const API_MATCH = {
  'chrome-windows': i => i.family === 'chrome' && i.os === 'windows',
  'chrome-mac':     i => i.family === 'chrome' && i.os === 'macos',
  'chrome-linux':   i => i.family === 'chrome' && i.os === 'linux',
  'edge-windows':   i => i.family === 'edge' && i.os === 'windows',
  'edge-mac':       i => i.family === 'edge' && i.os === 'macos',
  'edge-linux':     i => i.family === 'edge' && i.os === 'linux',
  'firefox-windows':i => i.family === 'firefox' && i.os === 'windows',
  'firefox-mac':    i => i.family === 'firefox' && i.os === 'macos',
  'firefox-linux':  i => i.family === 'firefox' && i.os === 'linux',
  'safari-mac':     i => i.family === 'safari' && i.os === 'macos'
};

// Returns a UA taken straight from the online list, or '' (then the local generator is used).
function fromApi(id, opts) {
  const test = API_MATCH[id];
  if (!test || !env.apiList.length) return '';
  if (env.chromeMajor && /^(chrome|edge)/.test(id)) return '';   // a manual Chrome override always wins
  const fresh = id.startsWith('firefox') ? estFirefox() - 3 : id.startsWith('safari') ? 26 : estChrome() - 3;
  const hits = env.apiList.map(parseUA).filter(i => test(i) && (id.startsWith('safari') ? i.major : id.startsWith('firefox') ? i.major : i.chromiumMajor) >= fresh);
  if (!hits.length) return '';
  const key = i => id.startsWith('chrome') || id.startsWith('edge') ? i.chromiumMajor : i.major;
  hits.sort((a, b) => key(b) - key(a));
  // For Firefox the list also carries the ESR build; the normal profile always wants the newest.
  const pool = opts && opts.jitter ? hits.filter(h => key(h) >= key(hits[0]) - 1) : [hits[0]];
  return pool[Math.floor(Math.random() * pool.length)].ua;
}

/* Version numbers: your manual override → newest version fetched online → estimate from vendor release cadence. */
function estChrome()  { return 143 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 11, 2)) / (28 * DAY))); }
function estFirefox() { return 146 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 11, 9)) / (28 * DAY))); }
function chromeMajor()  { return env.chromeMajor || Math.max(env.liveChrome, env.apiChrome) || estChrome(); }
function firefoxMajor() { return Math.max(env.liveFirefox, env.apiFirefox) || estFirefox(); }
function esrMajor()     { return env.liveEsr || env.apiEsr || (estFirefox() >= 153 ? 153 : 140); }
function safariMajor() {
  if (env.safariMajor) return env.safariMajor;
  if (env.apiSafari) return env.apiSafari;
  return 26 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 8, 15)) / (365.25 * DAY)));
}
function samsungMajor() { return 29 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 11, 1)) / (122 * DAY))); }

function behind(n, opts) { return opts && opts.jitter ? Math.max(1, n - Math.floor(Math.random() * 3)) : n; }

function generate(id, opts) {
  // Your own saved agents: 'custom:N' = that exact string; 'custom-list' = a random one (never the same twice in a row)
  if (typeof id === 'string' && id.indexOf('custom:') === 0) {
    const c = env.customList[Number(id.slice(7))];
    if (c) return c.ua;
    id = 'random-any';
  } else if (id === 'custom-list' && env.customList.length) {
    let n = Math.floor(Math.random() * env.customList.length);
    if (env.customList.length > 1 && n === env.lastCustom) n = (n + 1) % env.customList.length;
    env.lastCustom = n;
    return env.customList[n].ua;
  }
  if (!(opts && opts.local)) { const a = fromApi(id, opts); if (a) return a; }
  id = pickProfile(id);
  // opts.vary = "Generate" button: every value below is picked among combinations that real browsers really send
  // (recent versions, real OS tokens, real Safari/iOS release pairs), so each press gives a different, genuine-looking string.
  const V = !!(opts && opts.vary), R = n => Math.floor(Math.random() * n), pick = a => a[R(a.length)];
  const c = V ? Math.max(101, chromeMajor() - R(15)) : behind(chromeMajor(), opts);
  const f = V ? Math.max(100, firefoxMajor() - R(15)) : behind(firefoxMajor(), opts);
  const e = V ? pick([115, 128, 140, esrMajor()]) : esrMajor();   // supported ESR lines
  const s = safariMajor();
  // Safari majors that exist: ...16, 17, 18, then 26, 27... (Apple skipped 19-25). Older majors had minors .0-.6; the newest is taken as .0.
  const sv = (() => {
    if (!V) return s + '.0';
    const majors = [16, 17, 18].concat(Array.from({ length: Math.max(0, s - 25) }, (_, i) => 26 + i)).filter(m => m <= s).slice(-4);
    const m = pick(majors);
    return m + '.' + (m === s ? 0 : R(7));
  })();
  const iosTok = v => (parseInt(v, 10) >= 26 ? '18_6' : v.replace('.', '_'));   // iOS 26+ freezes the OS token at 18_6
  const iosVer = parseInt(sv, 10) >= 26 ? '18.6' : sv;
  const chrome = `Chrome/${c}.0.0.0`;
  const webkit = 'AppleWebKit/537.36 (KHTML, like Gecko)';
  const win = 'Windows NT 10.0; Win64; x64', mac = 'Macintosh; Intel Mac OS X 10_15_7', lin = 'X11; Linux x86_64';
  const apple = 'AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const op = `OPR/${Math.max(1, c - 15)}.0.0.0`;
  switch (id) {
    case 'chrome-windows': return `Mozilla/5.0 (${win}) ${webkit} ${chrome} Safari/537.36`;
    case 'chrome-mac':     return `Mozilla/5.0 (${mac}) ${webkit} ${chrome} Safari/537.36`;
    case 'chrome-linux':   return `Mozilla/5.0 (${lin}) ${webkit} ${chrome} Safari/537.36`;
    case 'chrome-chromeos':return `Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) ${webkit} ${chrome} Safari/537.36`;
    case 'edge-windows':   return `Mozilla/5.0 (${win}) ${webkit} ${chrome} Safari/537.36 Edg/${c}.0.0.0`;
    case 'edge-mac':       return `Mozilla/5.0 (${mac}) ${webkit} ${chrome} Safari/537.36 Edg/${c}.0.0.0`;
    case 'edge-linux':     return `Mozilla/5.0 (${lin}) ${webkit} ${chrome} Safari/537.36 Edg/${c}.0.0.0`;
    case 'opera-windows':  return `Mozilla/5.0 (${win}) ${webkit} ${chrome} Safari/537.36 ${op}`;
    case 'opera-mac':      return `Mozilla/5.0 (${mac}) ${webkit} ${chrome} Safari/537.36 ${op}`;
    case 'opera-linux':    return `Mozilla/5.0 (${lin}) ${webkit} ${chrome} Safari/537.36 ${op}`;
    case 'firefox-windows':return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${f}.0) Gecko/20100101 Firefox/${f}.0`;
    case 'firefox-mac':    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${f}.0) Gecko/20100101 Firefox/${f}.0`;
    case 'firefox-linux':  return `Mozilla/5.0 (${V ? pick(['X11; Linux x86_64', 'X11; Linux x86_64', 'X11; Ubuntu; Linux x86_64', 'X11; Fedora; Linux x86_64']) : 'X11; Linux x86_64'}; rv:${f}.0) Gecko/20100101 Firefox/${f}.0`;
    case 'firefox-esr-windows': return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${e}.0) Gecko/20100101 Firefox/${e}.0`;
    case 'firefox-esr-linux':   return `Mozilla/5.0 (X11; Linux x86_64; rv:${e}.0) Gecko/20100101 Firefox/${e}.0`;
    case 'safari-mac':     return `Mozilla/5.0 (${mac}) ${apple} Version/${sv} Safari/605.1.15`;
    case 'android-chrome': return `Mozilla/5.0 (Linux; Android 10; K) ${webkit} ${chrome} Mobile Safari/537.36`;
    case 'android-chrome-tablet': return `Mozilla/5.0 (Linux; Android 10; K) ${webkit} ${chrome} Safari/537.36`;
    case 'android-firefox':return `Mozilla/5.0 (Android ${V ? pick([11, 12, 13, 14, 15]) : 15}; Mobile; rv:${f}.0) Gecko/${f}.0 Firefox/${f}.0`;
    case 'android-edge':   return `Mozilla/5.0 (Linux; Android 10; K) ${webkit} ${chrome} Mobile Safari/537.36 EdgA/${c}.0.0.0`;
    case 'android-samsung':return `Mozilla/5.0 (Linux; Android 10; K) ${webkit} SamsungBrowser/${samsungMajor()}.0 ${chrome} Mobile Safari/537.36`;
    case 'ios-safari':     return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosTok(sv)} like Mac OS X) ${apple} Version/${sv} Mobile/15E148 Safari/604.1`;
    case 'ipad-safari':    return `Mozilla/5.0 (iPad; CPU OS ${iosTok(sv)} like Mac OS X) ${apple} Version/${sv} Mobile/15E148 Safari/604.1`;
    case 'ios-chrome':     return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosTok(sv)} like Mac OS X) ${apple} CriOS/${c}.0.0.0 Mobile/15E148 Safari/604.1`;
    case 'ios-firefox':    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosTok(sv)} like Mac OS X) ${apple} FxiOS/${f}.0 Mobile/15E148 Safari/605.1.15`;
    case 'ios-edge':       return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosTok(sv)} like Mac OS X) ${apple} Version/${iosVer} EdgiOS/${c}.0.0.0 Mobile/15E148 Safari/605.1.15`;
    case 'googlebot':      return 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    case 'googlebot-mobile': return `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) ${webkit} ${chrome} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`;
    case 'bingbot':        return 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
    default:               return generate('chrome-windows', opts);
  }
}

function pickProfile(id) {
  const pool = g => PROFILES.filter(p => g ? p.group === g : p.group !== 'Bots');
  const rnd = a => a[Math.floor(Math.random() * a.length)].id;
  if (id === 'random-any' || id === 'custom-list') return rnd(pool());
  if (id === 'random-desktop') return rnd(pool('Desktop'));
  if (id === 'random-mobile') return rnd(pool('Mobile'));
  return PROFILES.some(p => p.id === id) ? id : 'chrome-windows';
}

/* ---- The two functions below are injected into pages as source text, so they
        must stay self-contained (no outside references). ---- */

function findRule(host, rules) {
  host = String(host || '').toLowerCase();
  if (!host || !rules) return '';
  let best = '', bestLen = -1;
  for (const key of Object.keys(rules)) {
    const value = rules[key];
    if (!value) continue;
    const p = String(key).trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[\/?#]/)[0]
      .replace(/:\d+$/, '').replace(/^\*\./, '').replace(/^\./, '');
    if (!p) continue;
    if ((host === p || host.endsWith('.' + p)) && p.length > bestLen) { best = value; bestLen = p.length; }
  }
  return best;
}

function parseUA(ua) {
  const m = re => { const x = re.exec(ua); return x ? x[1] : ''; };
  const isIOS = /\b(iPhone|iPad|iPod)\b/.test(ua);
  const os = /Windows/.test(ua) ? 'windows' : isIOS ? 'ios' : /Android/.test(ua) ? 'android'
    : /CrOS/.test(ua) ? 'cros' : /Macintosh|Mac OS X/.test(ua) ? 'macos'
    : /Linux|X11/.test(ua) ? 'linux' : 'other';
  let family = 'other', version = '';
  if ((version = m(/\bEdg(?:e|A|iOS)?\/([\d.]+)/))) family = 'edge';
  else if ((version = m(/\bOPR\/([\d.]+)/))) family = 'opera';
  else if ((version = m(/\bSamsungBrowser\/([\d.]+)/))) family = 'samsung';
  else if ((version = m(/\b(?:Firefox|FxiOS)\/([\d.]+)/))) family = 'firefox';
  else if ((version = m(/\bCriOS\/([\d.]+)/))) family = 'chrome';
  else if ((version = m(/\bChrome\/([\d.]+)/))) family = 'chrome';
  else if ((version = m(/\bVersion\/([\d.]+).*Safari\//))) family = 'safari';
  if (/Googlebot|bingbot/i.test(ua)) { family = 'bot'; version = ''; }
  return {
    ua, os, family, version,
    major: parseInt(version, 10) || 0,
    chromiumMajor: parseInt(m(/\bChrome\/([\d.]+)/), 10) || 0,
    chromiumFull: m(/\bChrome\/([\d.]+)/),
    chromium: /\bChrome\//.test(ua) && !isIOS && family !== 'bot' && family !== 'firefox',
    mobile: /Mobi|iPhone|iPad|iPod/.test(ua)
  };
}

function describe(ua) {
  if (!ua) return 'Firefox default';
  const i = parseUA(ua);
  const fam = { chrome: 'Chrome', edge: 'Edge', opera: 'Opera', firefox: 'Firefox', safari: 'Safari', samsung: 'Samsung Internet', bot: 'Bot', other: 'Custom' }[i.family];
  const os = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', cros: 'ChromeOS', other: '' }[i.os];
  return `${fam}${i.major ? ' ' + i.major : ''}${os ? ' on ' + os : ''}`;
}

// "Label | Mozilla/5.0 ..." or just the User-Agent. Only printable ASCII (a User-Agent goes into an HTTP header).
function parseCustomUAs(text) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === '#') continue;
    let label = '', ua = line;
    const k = line.indexOf('|');
    if (k > 0) {
      const l = line.slice(0, k).trim();
      if (l && l.length <= 60 && !/[\/(;]/.test(l)) { label = l; ua = line.slice(k + 1).trim(); }
    }
    if (!/^[\x20-\x7E]{8,512}$/.test(ua)) continue;
    out.push({ name: label || describe(ua), ua });
    if (out.length >= 100) break;
  }
  return out;
}

function validProfileId(id) {
  if (typeof id !== 'string') return false;
  if (id.indexOf('custom:') === 0) return !!env.customList[Number(id.slice(7))];
  return PROFILES.some(p => p.id === id);
}

function normalizeHost(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[\/?#]/)[0]
    .replace(/:\d+$/, '').replace(/^\*\./, '').replace(/^\./, '');
}

function fillProfileSelect(sel, opts) {
  opts = opts || {};
  sel.innerHTML = '';
  const add = (parent, o) => { const e = document.createElement('option'); e.value = o.id; e.textContent = o.label; parent.appendChild(e); };
  if (opts.leading) opts.leading.forEach(o => add(sel, o));
  if (opts.rotation) {
    const g = document.createElement('optgroup'); g.label = 'Random';
    ROTATION_EXTRAS.forEach(o => add(g, o));
    if (env.customList.length) add(g, { id: 'custom-list', label: 'Random — from my custom agents' });
    sel.appendChild(g);
  }
  if (env.customList.length && !opts.rotation) {
    const g = document.createElement('optgroup'); g.label = 'My custom agents';
    env.customList.forEach((c, n) => add(g, { id: 'custom:' + n, label: c.name }));
    sel.appendChild(g);
  }
  for (const grp of ['Desktop', 'Mobile', 'Bots']) {
    const g = document.createElement('optgroup'); g.label = grp;
    PROFILES.filter(p => p.group === grp).forEach(p => add(g, p));
    sel.appendChild(g);
  }
}

/* ================= Real-browser detection + "what do sites see?" self-test ================= */

const FORKS = [
  [/tor browser/i, 'Tor Browser'], [/mullvad/i, 'Mullvad Browser'], [/librewolf/i, 'LibreWolf'],
  [/waterfox/i, 'Waterfox'], [/floorp/i, 'Floorp'], [/\bzen\b/i, 'Zen Browser'], [/pale ?moon/i, 'Pale Moon'],
  [/basilisk/i, 'Basilisk'], [/seamonkey/i, 'SeaMonkey'], [/icecat/i, 'GNU IceCat'], [/fennec/i, 'Fennec'],
  [/firefox (focus|reality)/i, 'Firefox Focus/Reality']
];
const OS_FROM_PLATFORM = { win: 'windows', mac: 'macos', linux: 'linux', android: 'android', cros: 'cros', openbsd: 'linux' };
const OS_NAMES = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS', cros: 'ChromeOS', other: 'Unknown OS' };
const ARCH_NAMES = { 'x86-64': '64-bit', 'x86-32': '32-bit', arm: 'ARM', aarch64: 'ARM 64-bit', arm64: 'ARM 64-bit' };

let realCache = null;

/* The background page, popup and options page are never spoofed, so their navigator.userAgent is the truth.
   getBrowserInfo / getPlatformInfo add the exact version, build and platform. */
async function detectReal(force) {
  if (realCache && !force) return realCache;
  const r = { name: 'Firefox', vendor: '', version: '', major: 0, buildID: '', channel: 'release', fork: '',
    os: 'other', arch: '', archLabel: '', ua: '', mobile: false, rfp: null, summary: '', detail: '' };
  try { r.ua = String(navigator.userAgent || ''); } catch (e) {}
  const parsed = parseUA(r.ua);
  r.os = parsed.os;
  r.mobile = parsed.mobile;
  try {
    const i = await browser.runtime.getBrowserInfo();
    r.name = String(i.name || r.name); r.vendor = String(i.vendor || ''); r.version = String(i.version || '');
    r.buildID = String(i.buildID || '');
  } catch (e) { /* very old Firefox or API blocked */ }
  if (!r.version && parsed.family === 'firefox') r.version = parsed.version;
  r.major = parseInt(r.version, 10) || parsed.major || 0;
  try {
    const p = await browser.runtime.getPlatformInfo();
    if (p) {
      if (OS_FROM_PLATFORM[p.os]) r.os = OS_FROM_PLATFORM[p.os];
      r.arch = String(p.arch || '');
      r.archLabel = ARCH_NAMES[r.arch] || r.arch;
    }
  } catch (e) { /* ignore */ }
  if (r.os === 'android') r.mobile = true;

  // Release channel from the version string (ESR cannot be told apart from release by an add-on)
  if (/a1$/.test(r.version)) r.channel = 'Nightly';
  else if (/a2$/.test(r.version)) r.channel = 'Developer Edition';
  else if (/b\d+$/.test(r.version)) r.channel = 'Beta';
  else r.channel = 'Release / ESR';

  // Forks: look at the product name Firefox reports and at the UA string
  const hay = r.name + ' ' + r.ua;
  for (const [re, label] of FORKS) if (re.test(hay)) { r.fork = label; break; }
  if (!r.fork && r.name && !/^firefox$/i.test(r.name)) r.fork = r.name;

  // Resist Fingerprinting already on (Tor/Mullvad/LibreWolf ship it) overrides several spoofed values
  try {
    const g = await browser.privacy.websites.resistFingerprinting.get({});
    r.rfp = { value: !!g.value, level: g.levelOfControl };
  } catch (e) { /* ignore */ }

  const product = r.fork || r.name || 'Firefox';
  r.summary = `${product}${r.version ? ' ' + r.version : ''}`;
  r.detail = [OS_NAMES[r.os] + (r.archLabel ? ' ' + r.archLabel : ''), r.fork ? 'Firefox-based' : r.channel,
    r.vendor, r.buildID ? 'build ' + r.buildID : ''].filter(Boolean).join(' · ');
  realCache = r;
  return r;
}

/* Profile that matches the OS you are really on (a Chrome UA on your own OS is the least contradictory). */
function recommendedProfile(real) {
  const os = real && real.os;
  if (os === 'windows') return 'chrome-windows';
  if (os === 'macos') return 'chrome-mac';
  if (os === 'linux' || os === 'cros') return 'chrome-linux';
  if (os === 'android') return 'android-chrome';
  return 'chrome-windows';
}

/* Injected into the page (executeScript) as source text — keep fully self-contained. Reads what a website
   would read, through the page's own view of the DOM, and returns plain JSON-safe values. */
function probePage() {
  const win = window.wrappedJSObject || window;
  const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (e) { return d; } };
  const str = v => (v === undefined || v === null) ? null : String(v).slice(0, 300);
  const has = n => safe(() => n in win, false);
  const nav = win.navigator;
  const out = {};
  out.ua = str(safe(() => nav.userAgent));
  out.platform = str(safe(() => nav.platform));
  out.vendor = str(safe(() => nav.vendor));
  out.appVersion = str(safe(() => nav.appVersion));
  out.productSub = str(safe(() => nav.productSub));
  out.oscpu = str(safe(() => nav.oscpu));
  out.buildID = str(safe(() => nav.buildID));
  out.deviceMemory = str(safe(() => nav.deviceMemory));
  out.maxTouchPoints = safe(() => Number(nav.maxTouchPoints), null);
  out.uaData = safe(() => {
    const d = nav.userAgentData;
    if (!d) return null;
    const brands = [];
    const list = d.brands;
    for (let k = 0; k < Math.min(10, Number(list.length) || 0); k++) brands.push(String(list[k].brand) + ' ' + String(list[k].version));
    return { brands: brands, platform: String(d.platform), mobile: !!d.mobile };
  }, null);
  out.gecko = [];
  ['InstallTrigger', 'mozInnerScreenX', 'scrollMaxX', 'netscape', 'mozPaintCount'].forEach(n => { if (has(n)) out.gecko.push('window.' + n); });
  if (safe(() => typeof nav.mozGetUserMedia === 'function', false)) out.gecko.push('navigator.mozGetUserMedia');
  if (safe(() => 'fileName' in win.Error.prototype, false)) out.gecko.push('Error.prototype.fileName');
  if (safe(() => win.CSS.supports('-moz-appearance', 'none'), false)) out.gecko.push("CSS.supports('-moz-…')");
  if (safe(() => 'MozAppearance' in win.document.documentElement.style, false)) out.gecko.push('style.MozAppearance');
  if (out.oscpu) out.gecko.push('navigator.oscpu');
  if (out.buildID) out.gecko.push('navigator.buildID');
  if (out.productSub === '20100101') out.gecko.push("navigator.productSub '20100101'");
  const stack = String(safe(() => new win.Error('x').stack, ''));
  out.stackStyle = /^\s+at /m.test(stack) ? 'v8' : (/@/.test(stack) ? 'gecko' : 'unknown');
  if (out.stackStyle === 'gecko') out.gecko.push('Error.stack format (fn@url)');
  out.blink = {
    chromeObject: has('chrome'),
    userAgentData: !!out.uaData,
    deviceMemory: out.deviceMemory !== null,
    webkitFileSystem: has('webkitRequestFileSystem'),
    perfMemory: safe(() => 'memory' in win.performance, false),
    captureStackTrace: safe(() => typeof win.Error.captureStackTrace === 'function', false)
  };
  out.nativeToString = safe(() => {
    const d = Object.getOwnPropertyDescriptor(win.Navigator.prototype, 'userAgent');
    if (!d || !d.get) return null;
    return /\[native code\]/.test(String(win.Function.prototype.toString.call(d.get)));
  }, null);

  return new Promise(resolve => {
    let done = false;
    const finish = w => { if (done) return; done = true; out.worker = w; resolve(out); };
    setTimeout(() => finish(null), 1500);
    try {
      const blob = new window.Blob(['postMessage({ua:navigator.userAgent,platform:navigator.platform})'], { type: 'text/javascript' });
      const url = window.URL.createObjectURL(blob);
      const w = new win.Worker(url);
      w.onmessage = exportFunction(function (e) {
        try { finish({ ua: String(e.data.ua).slice(0, 300), platform: String(e.data.platform).slice(0, 60) }); } catch (x) { finish(null); }
        try { w.terminate(); window.URL.revokeObjectURL(url); } catch (x) {}
      }, window);
      w.onerror = exportFunction(function () { finish(null); }, window);
    } catch (e) { finish(null); }
  });
}

function analyzeProbe(p, ctx) {
  ctx = ctx || {};
  const real = ctx.real || {};
  const rows = [];
  const add = (status, label, value, detail) => rows.push({ status, label, value: value == null ? '' : String(value), detail: detail || '' });
  const c = parseUA(p.ua || '');
  const spoofing = !!ctx.expectedUA;
  const claimsFirefox = c.family === 'firefox';

  add('info', 'Real browser', (real.summary || '?') + ' on ' + (OS_NAMES[real.os] || '?'));
  add('info', 'Sites are told', describe(p.ua), p.ua);

  if (spoofing) {
    if (p.ua === ctx.expectedUA) add('ok', 'JavaScript and HTTP User-Agent agree', 'yes');
    else if (p.ua === real.ua) {
      add('leak', 'Spoof applied to this page', 'NO — page sees the real User-Agent',
        ctx.incognito ? 'Private window: enable "Run in Private Windows" for Vivid User Privacy in about:addons.'
          : 'Reload the page after changing settings. Some pages (about:, addons.mozilla.org) cannot be changed.');
    } else add('warn', 'JavaScript and HTTP User-Agent agree', 'no', 'Page reports a different UA than the one sent in headers (a site rule or rotation may have changed it).');
  }

  const wantPlatform = { windows: /^Win/, macos: /^Mac/, linux: /^Linux/, android: /^Linux/, ios: /^(iPhone|iPad)/, cros: /^(Linux|CrOS)/ }[c.os];
  if (wantPlatform) add(wantPlatform.test(p.platform || '') ? 'ok' : 'leak', 'navigator.platform matches the claimed OS', p.platform);

  const wantVendor = claimsFirefox ? '' : (c.chromium ? 'Google Inc.' : (c.family === 'safari' ? 'Apple Computer, Inc.' : null));
  if (wantVendor !== null) add((p.vendor || '') === wantVendor ? 'ok' : 'leak', 'navigator.vendor matches the claimed browser', p.vendor || '(empty)');

  if (c.chromium) {
    const d = p.uaData;
    if (!d) add('leak', 'Client Hints (navigator.userAgentData)', 'missing', 'Chromium browsers expose it.');
    else {
      const okBrand = d.brands.some(b => b.indexOf(String(c.chromiumMajor)) >= 0);
      add(okBrand ? 'ok' : 'leak', 'Client Hints (navigator.userAgentData)', d.brands.join(', '));
    }
  } else if (p.uaData) add('leak', 'Client Hints (navigator.userAgentData)', 'present', 'The claimed browser does not have it.');

  if (!claimsFirefox) {
    if (p.gecko.length) add('leak', 'Firefox/Gecko giveaways visible', p.gecko.length + ' found', p.gecko.join(', '));
    else add('ok', 'Firefox/Gecko giveaways visible', 'none');
  }
  if (c.chromium) {
    const missing = Object.keys(p.blink).filter(k => !p.blink[k]);
    add(missing.length ? 'warn' : 'ok', 'Chromium-only features present', missing.length ? 'missing: ' + missing.join(', ') : 'all present');
  } else if (c.family === 'safari' || c.os === 'ios') {
    add(p.blink.chromeObject ? 'leak' : 'ok', 'window.chrome absent (as in Safari)', p.blink.chromeObject ? 'present' : 'absent');
  }

  if (p.nativeToString !== null) add(p.nativeToString ? 'ok' : 'leak', 'Spoofed getters look native (Function.toString)', p.nativeToString ? 'yes' : 'no');

  if (p.worker) {
    const same = p.worker.ua === p.ua && (!wantPlatform || wantPlatform.test(p.worker.platform || ''));
    add(same ? 'ok' : 'leak', 'Web Worker reports the same browser', same ? 'yes' : p.worker.ua, same ? '' : 'A site can read your real UA from a Worker.');
  } else add('info', 'Web Worker check', 'could not run', 'The page blocks blob: workers (Content-Security-Policy).');

  if (spoofing && real.os && c.os !== real.os && !c.mobile === !real.mobile) {
    add('warn', 'Claimed OS differs from your real OS', (OS_NAMES[c.os] || '?') + ' vs ' + (OS_NAMES[real.os] || '?'),
      'Fonts, screen size, GPU and time zone can still show your real system. Picking a profile for your own OS avoids that.');
  } else if (spoofing && c.mobile !== !!real.mobile) {
    add('warn', 'Claimed device type differs from your real device', c.mobile ? 'mobile' : 'desktop',
      'Screen size, touch support and GPU will contradict it.');
  }

  const leaks = rows.filter(r => r.status === 'leak').length;
  const warns = rows.filter(r => r.status === 'warn').length;
  let verdict, level;
  if (!spoofing) { verdict = 'No spoofing here: sites see your true browser — ' + describe(p.ua) + '.'; level = 'good'; }
  else if (!leaks && !warns) { verdict = 'Convincing: sites see ' + describe(p.ua) + ' and nothing testable contradicts it.'; level = 'good'; }
  else if (!leaks) { verdict = 'Mostly convincing: sites see ' + describe(p.ua) + ' (' + warns + ' thing' + (warns > 1 ? 's' : '') + ' to review).'; level = 'warn'; }
  else { verdict = 'Detectable: ' + leaks + ' giveaway' + (leaks > 1 ? 's' : '') + ' reveal your real browser (' + (real.summary || 'Firefox') + ').'; level = 'bad'; }
  return { rows, verdict, level, leaks, warns };
}

/* tab: a browser.tabs.Tab. Returns {report} or {error}. */
async function runCheck(tab) {
  const real = await detectReal();
  const url = (tab && tab.url) || '';
  if (!/^https?:/i.test(url)) return { error: 'Open a normal web page (http/https) first. Firefox does not let add-ons run on about: pages, addons.mozilla.org and similar.' };
  let status = null;
  try { status = await browser.runtime.sendMessage({ type: 'status', url }); } catch (e) {}
  let res;
  try {
    const r = await browser.tabs.executeScript(tab.id, { code: '(' + probePage + ')()' });
    res = r && r[0];
  } catch (e) {
    return { error: 'Could not run the check on this tab: ' + ((e && e.message) || e) };
  }
  if (!res || !res.ua) return { error: 'The page did not answer. Reload it and try again.' };
  const report = analyzeProbe(res, { expectedUA: (status && status.ua) || '', real, incognito: !!tab.incognito });
  return { report, probe: res };
}

function renderReport(box, result) {
  box.textContent = '';
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  if (result.error) { box.appendChild(mk('div', 'note warn', result.error)); return; }
  const rep = result.report;
  box.appendChild(mk('div', 'note ' + (rep.level === 'good' ? 'good' : rep.level === 'bad' ? 'warn' : ''), rep.verdict));
  const icons = { ok: '✓', leak: '✗', warn: '!', info: 'i' };
  for (const r of rep.rows) {
    const row = mk('div', 'rr rr-' + r.status);
    row.appendChild(mk('span', 'ic', icons[r.status]));
    const body = mk('div', 'rb');
    const head = mk('div', '');
    head.appendChild(mk('b', '', r.label));
    if (r.value) head.appendChild(mk('span', 'mono rv', ' ' + r.value));
    body.appendChild(head);
    if (r.detail) body.appendChild(mk('div', 'mut', r.detail));
    row.appendChild(body);
    box.appendChild(row);
  }
  box.appendChild(mk('div', 'mut', 'Not testable from an add-on: TLS/JA3 and HTTP/2 fingerprints, header order, installed fonts, module workers.'));
}

/* ================= Spoofing data: GPUs and fonts ================= */

// [id, label, unmasked vendor, unmasked renderer] — strings as real browsers report them (ANGLE style for Chromium UAs).
const GPU_PRESETS = [
  ['nv-3060',   'NVIDIA GeForce RTX 3060 (Windows)',  'Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['nv-4070',   'NVIDIA GeForce RTX 4070 (Windows)',  'Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['nv-1650',   'NVIDIA GeForce GTX 1650 (Windows)',  'Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['amd-580',   'AMD Radeon RX 580 (Windows)',        'Google Inc. (AMD)',    'ANGLE (AMD, AMD Radeon RX 580 Series (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['amd-6600',  'AMD Radeon RX 6600 (Windows)',       'Google Inc. (AMD)',    'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['intel-630', 'Intel UHD Graphics 630 (Windows)',   'Google Inc. (Intel)',  'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['intel-xe',  'Intel Iris Xe Graphics (Windows)',   'Google Inc. (Intel)',  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['apple-m1',  'Apple M1 (macOS)',                   'Google Inc. (Apple)',  'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'],
  ['apple-m2',  'Apple M2 (macOS)',                   'Google Inc. (Apple)',  'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'],
  ['apple-gpu', 'Apple GPU (Safari / iPhone)',        'Apple Inc.',           'Apple GPU'],
  ['lin-intel', 'Intel Mesa UHD 620 (Linux)',         'Google Inc. (Intel)',  'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)'],
  ['lin-nv',    'NVIDIA GTX 1060 (Linux)',            'Google Inc. (NVIDIA Corporation)', 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1060/PCIe/SSE2, OpenGL 4.5.0)'],
  ['and-adreno','Qualcomm Adreno 650 (Android)',      'Google Inc. (Qualcomm)', 'ANGLE (Qualcomm, Adreno (TM) 650, OpenGL ES 3.2)'],
  ['and-mali',  'ARM Mali-G78 (Android)',             'Google Inc. (ARM)',    'ANGLE (ARM, Mali-G78, OpenGL ES 3.2)']
].map(a => ({ id: a[0], label: a[1], vendor: a[2], renderer: a[3] }));

// Fonts each OS ships with. Anything in FONT_UNIVERSE that is not in the chosen set is made to look "not installed".
const FONT_SETS = {
  windows: ['Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Cambria Math', 'Candara', 'Cascadia Code', 'Cascadia Mono', 'Comic Sans MS',
    'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Javanese Text',
    'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue',
    'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic',
    'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe MDL2 Assets', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Emoji',
    'Segoe UI Historic', 'Segoe UI Symbol', 'Segoe UI Variable', 'SimSun', 'Sitka', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
    'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic'],
  macos: ['American Typewriter', 'Andale Mono', 'Apple Chancery', 'Apple Color Emoji', 'Apple SD Gothic Neo', 'Arial', 'Arial Black', 'Arial Narrow',
    'Avenir', 'Avenir Next', 'Baskerville', 'Big Caslon', 'Brush Script MT', 'Chalkboard', 'Cochin', 'Copperplate', 'Courier', 'Courier New', 'Didot',
    'Futura', 'Geneva', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Hoefler Text', 'Impact', 'Lucida Grande', 'Marker Felt', 'Menlo', 'Monaco',
    'Optima', 'Palatino', 'Papyrus', 'Rockwell', 'San Francisco', 'SF Pro', 'Skia', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Zapfino'],
  linux: ['Cantarell', 'Cousine', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Droid Sans', 'FreeMono', 'FreeSans', 'FreeSerif', 'Liberation Mono',
    'Liberation Sans', 'Liberation Serif', 'Nimbus Mono PS', 'Nimbus Roman', 'Nimbus Sans', 'Noto Color Emoji', 'Noto Mono', 'Noto Sans', 'Noto Serif',
    'Arimo', 'Tinos', 'Ubuntu', 'Ubuntu Mono'],
  android: ['Carrois Gothic SC', 'Coming Soon', 'Cutive Mono', 'Dancing Script', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif', 'Noto Sans', 'Noto Serif', 'Roboto'],
  ios: ['American Typewriter', 'Arial', 'Avenir', 'Avenir Next', 'Courier', 'Courier New', 'Futura', 'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue',
    'Menlo', 'Optima', 'Palatino', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
  common: ['Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']
};

// Fonts that fingerprinting scripts commonly probe for (their lists are mostly Office, Adobe, designer and developer fonts).
const FONT_EXTRA = ['Agency FB', 'Algerian', 'Book Antiqua', 'Bookman Old Style', 'Bauhaus 93', 'Bell MT', 'Berlin Sans FB', 'Bernard MT Condensed', 'Bradley Hand ITC',
  'Britannic Bold', 'Broadway', 'Calisto MT', 'Castellar', 'Century', 'Century Gothic', 'Century Schoolbook', 'Colonna MT', 'Cooper Black', 'Copperplate Gothic Bold',
  'Curlz MT', 'Edwardian Script ITC', 'Elephant', 'Engravers MT', 'Eras ITC', 'Felix Titling', 'Footlight MT Light', 'Forte', 'Freestyle Script', 'French Script MT',
  'Garamond', 'Gigi', 'Gill Sans MT', 'Goudy Old Style', 'Haettenschweiler', 'Harlow Solid Italic', 'Harrington', 'High Tower Text', 'Informal Roman', 'Jokerman',
  'Juice ITC', 'Kristen ITC', 'Kunstler Script', 'Lucida Bright', 'Lucida Calligraphy', 'Lucida Fax', 'Lucida Handwriting', 'Lucida Sans', 'Lucida Sans Typewriter',
  'Magneto', 'Maiandra GD', 'Matura MT Script Capitals', 'Mistral', 'Modern No. 20', 'Monotype Corsiva', 'Niagara Engraved', 'Niagara Solid', 'OCR A Extended',
  'Old English Text MT', 'Onyx', 'Parchment', 'Perpetua', 'Playbill', 'Poor Richard', 'Pristina', 'Rage Italic', 'Ravie', 'Rockwell Condensed', 'Script MT Bold',
  'Showcard Gothic', 'Snap ITC', 'Stencil', 'Tempus Sans ITC', 'Tw Cen MT', 'Viner Hand ITC', 'Vivaldi', 'Vladimir Script', 'Wide Latin', 'Adobe Caslon Pro',
  'Adobe Garamond Pro', 'Myriad Pro', 'Minion Pro', 'Kozuka Gothic Pro', 'Source Sans Pro', 'Source Serif Pro', 'Source Code Pro', 'Inter', 'Montserrat', 'Poppins',
  'PT Sans', 'PT Serif', 'Merriweather', 'Oswald', 'Raleway', 'Playfair Display', 'Lato', 'Open Sans', 'Fira Sans', 'Fira Code', 'Fira Mono', 'JetBrains Mono',
  'Hack', 'IBM Plex Sans', 'IBM Plex Mono', 'Bitstream Vera Sans', 'Bitstream Vera Sans Mono', 'Terminal', 'MS Sans Serif', 'MS Serif', 'Small Fonts', 'Fixedsys',
  'MS PGothic', 'MS UI Gothic', 'MS Mincho', 'Meiryo', 'Yu Mincho', 'SimHei', 'KaiTi', 'FangSong', 'NSimSun', 'PMingLiU', 'Batang', 'Gulim', 'Dotum', 'Gungsuh',
  'Arial Unicode MS', 'Arial Narrow', 'Arial Rounded MT Bold', 'Baskerville Old Face', 'Bodoni MT', 'Californian FB', 'Cambria Bold', 'Candara Light',
  'Gloucester MT Extra Condensed', 'Gill Sans Ultra Bold', 'Lucida Grande', 'Luminari', 'Noteworthy', 'Herculanum', 'Bangla Sangam MN', 'Kohinoor Devanagari',
  'Sathu', 'Tamil MN', 'Telugu MN', 'Thonburi', 'Kailasa', 'PingFang SC', 'Hiragino Sans', 'Hiragino Kaku Gothic Pro', 'Osaka', 'STHeiti', 'Songti SC',
  'Abyssinica SIL', 'Lohit Devanagari', 'Lohit Tamil', 'Droid Sans Fallback', 'Noto Sans CJK JP', 'Noto Sans CJK SC', 'WenQuanYi Micro Hei', 'Kalimati',
  'Khmer OS', 'Mukti Narrow', 'Padauk', 'Purisa', 'Rekha', 'Sawasdee', 'Tlwg Typist', 'Umpush', 'Waree', 'Garuda', 'Loma', 'Norasi', 'TeX Gyre Heros',
  'URW Gothic', 'URW Bookman', 'Z003', 'C059', 'P052', 'Roboto Condensed', 'Roboto Mono', 'Roboto Slab', 'Ubuntu Condensed', 'Droid Serif', 'Nunito', 'Quicksand',
  'Work Sans', 'Rubik', 'Karla', 'Cabin', 'Bebas Neue', 'Anton', 'Lobster', 'Pacifico', 'Comfortaa', 'Courier Prime', 'Cutive Mono', 'Segoe Pro', 'Sans Serif Collection'];

const FONT_UNIVERSE = Array.from(new Set([].concat(FONT_SETS.windows, FONT_SETS.macos, FONT_SETS.linux, FONT_SETS.android, FONT_SETS.ios, FONT_EXTRA)));

function parseFontList(text) {
  return Array.from(new Set(String(text || '').split(/[\r\n,;]+/).map(x => x.trim().replace(/^["']|["']$/g, '').trim())
    .filter(x => x && x.length <= 60 && /^[\w .&+'()\-]+$/.test(x)))).slice(0, 300);
}

// Fonts to hide for a given mode. os = the OS the browser claims to run on ('windows','macos','linux','android','ios').
function fontHideList(mode, os, listText) {
  if (!mode || mode === 'off') return [];
  const extra = parseFontList(listText);
  const keep = new Set((mode === 'custom' ? extra : (FONT_SETS[mode === 'common' ? 'common' : os] || FONT_SETS.common).concat(extra)).map(x => x.toLowerCase()));
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-.*|emoji|math|fangsong|inherit|initial)$/i;
  return FONT_UNIVERSE.concat(extra).filter((n, k, a) => a.indexOf(n) === k && !keep.has(n.toLowerCase()) && !generic.test(n));
}

const UA = { detectReal, recommendedProfile, probePage, analyzeProbe, runCheck, renderReport, OS_NAMES, PROFILES, ROTATION_EXTRAS, DEFAULT: DEFAULT_SENTINEL, configure, loadEnv, applyLive, applyApi, apiCount: () => env.apiList.length, generate, pickProfile,
             findRule, parseUA, describe, normalizeHost, fillProfileSelect, parseCustomUAs, validProfileId,
             customAgents: () => env.customList, GPU_PRESETS, FONT_UNIVERSE, FONT_SETS, fontHideList,
             cleanApiList, estimate: { chrome: estChrome, firefox: estFirefox }, chromeMajor, firefoxMajor, esrMajor, safariMajor,
             DEFAULTS, RUNTIME_KEYS, PRIVACY_PRESETS, PRIVACY_PRESET_KEYS, detectPreset,
             PROXY_TYPES, PROXY_PRESETS, cleanProxies, proxyLabel };
