# Vivid User Privacy for Firefox (v3)

## Web Workers option (Settings → Spoofing → More spoofing)
- **Web Workers:** *Match the claimed browser* (default, unchanged), *Leave workers alone*, or *Block workers* (`Worker` / `SharedWorker` throw; many sites will break).

## Cross-tab identity leak protection (Settings → Spoofing → More spoofing, off by default)
- **One identity per site across all tabs:** forces the per-site sticky User-Agent on, even if "Keep the same User-Agent while a site is open" is off, so two tabs of one site never see two different browsers.
- **No window links between sites:** a top-level page opened from or reached from another site gets an empty `window.name`, and `window.opener` is set to `null` when the opener is a different site. Follows the Privacy master switch and the "sites to skip" list.
- Limit: some pop-up sign-in flows need `window.opener`; add the site to "sites to skip" if one breaks.

## v1.0.15 — Two more spoofing options (Settings → Spoofing → More spoofing, both off by default)
- **Match screen orientation to the claimed device:** `screen.orientation.type` / `angle` report landscape for a desktop User-Agent and portrait for a mobile one. CSS and `matchMedia("(orientation: …)")` still use the real window.
- **Hide hardware video decoding info:** `navigator.mediaCapabilities.decodingInfo()` / `encodingInfo()` keep the real "supported" answer but always report smooth and not power-efficient, so hardware acceleration does not reveal your GPU. Video sites may choose a different quality or codec.

## v1.0.14 — Hide accessibility settings (Settings → Spoofing → More spoofing, off by default)
- Simple `matchMedia()` checks for `forced-colors` (Windows high contrast), `prefers-contrast`, `inverted-colors`, `prefers-reduced-transparency` and `prefers-reduced-data` answer as "not set". These settings can reveal assistive-technology use and are rare enough to help identify a browser. Follows the Privacy master switch and the "sites to skip" list.
- Limit: only what JavaScript reads is changed; CSS `@media` rules inside a site's stylesheet still follow your real setting, and compound queries (`and`, commas, `not`) are left alone.

## v1.0.7 — Random User-Agent by default
- A fresh install starts with **automatic rotation on** (profile: random — any browser/device, new User-Agent every hour) until you choose your own. Applying a User-Agent yourself or pressing *Stop rotation* / *Turn off* turns it off; *Reset all* returns to the default (rotation on). Saved settings are never overwritten.
- **Clear status:** the popup opens with a green “Auto rotation: ON” or red “Auto rotation: OFF” banner (current agent, interval, one-click Turn on/off); the toolbar badge is green for AUTO; Settings shows a matching pill.

- **Clean links** (Privacy tab and popup): one setting that removes tracking tags (`utm_*`, `fbclid`, `gclid`, `si=` …) from addresses you open and skips click-logging / "you are leaving this site" redirect pages (Google, Facebook, Instagram, YouTube, Steam, Reddit, LinkedIn, Slack, VK, DuckDuckGo, Outlook Safe Links, Tumblr). Replaces the former separate "Skip tracking redirects" and "Strip tracking parameters" options.

## Fix: endless "Verify you are human" loop
- A bot check compares the claimed browser with the real engine, so a Chrome/Safari identity on Firefox loops forever. When a site shows the check, the tab is reloaded once and from then on that site gets a Firefox identity (User-Agent switching stays on, same engine so it passes) and no fingerprint tweaks. The check's own frames are never touched. It only reads response headers; it does not contact any Cloudflare service. Other sites are unaffected.

## Fix: automatic rotation no longer breaks sites
- **Keep the same User-Agent while a site is open** (Settings → Automatic rotation, on by default). Before, a rotation changed the User-Agent in request headers immediately but not in the JavaScript of pages that were already open, so sites saw two different browsers and broke, logged you out or asked for verification. Now each site keeps the User-Agent it first saw until all its tabs are closed (or you change rotation settings); sites you open afterwards get the newest one.
- The page-side script is swapped without a gap, so no page load is missed during a rotation.
- Fresh installs now rotate between **desktop** browsers only (mobile layouts broke many sites). Existing settings are unchanged.

## v1.0.10 — Fix: lag and freezes with automatic rotation
- Request headers: the User-Agent is parsed once and reused instead of on every request.
- A rotation tick now only updates the injected User-Agent and the badge instead of rebuilding everything; version-feed refreshes no longer rotate twice.
- Rotation interval minimum is 60 seconds (was 10).

## v1.0.9 — My custom agents in random rotation
- Settings → User-Agent → My custom User-Agents: **Include these in random rotation** (on by default) plus how often one of yours is picked (1 in 10 … always). Works with Random — any / desktop / mobile; your agents are used exactly as typed.

## v1.0.8 — Auto rotation is obvious
- Fresh installs start with a random User-Agent (any browser/device, new one every hour) until you pick your own: applying a User-Agent turns rotation off, and you can turn it back on at any time.
- Bigger, clearer on/off banner in the popup and a larger on/off status in Settings → User-Agent → Automatic rotation (no new buttons).
- Toolbar badge: green **AUTO** (rotating), amber **SET** (the User-Agent you chose), red **OFF** (real Firefox User-Agent).

## v1.0.6 — More spoofing (Settings → Spoofing → More spoofing, all off by default)
- Hide battery status, hide network information, hide gamepads.
- Always report light theme and no reduced motion (simple media queries only).
- Reduce timer precision (`performance.now()` rounded to 100 ms).
- Fake storage quota (`navigator.storage.estimate()` reports 10 GB, 0 used).

## v1.0.4
- **Block geolocation requests** is now on by default (together with *Block location fully*). Existing installs keep whatever they saved.
- **Upgrade to HTTPS** (Privacy tab, off by default): `http://` pages open as `https://`; local/IP addresses and your skip list are excluded.


## v3.6 — Spoofing tab + your own User-Agents
- **New Settings → Spoofing tab** (follows the Privacy master switch and "sites to skip" list):
  - **GPU:** pick a specific card from a list of real WebGL strings (NVIDIA / AMD / Intel / Apple / Adreno / Mali), or type your own unmasked vendor and renderer. Optional **hide WebGPU**.
  - **Screen:** any `WxH`, device pixel ratio, colour depth, and optionally matching `innerWidth` / `outerHeight` / `screenX` … values.
  - **Fonts:** fonts that fingerprinting scripts probe for (~300 names) are made to look *not installed*, either to match the spoofed OS, a small common set, or only your own list. Uses an extension-injected stylesheet, so a page's CSP cannot block it. It can hide fonts, not add ones you do not have.
  - **Time zone:** UTC or any IANA zone (`Europe/Berlin`): offset, `getHours()` etc., `Date#toString`, `toLocale*String`, `Intl.DateTimeFormat`.
  - **Hardware & devices:** CPU cores, `deviceMemory`, hide `enumerateDevices()`, hide speech voices.
- **My custom User-Agents** (Settings → User-Agent, optional): one per line as `Label | User-Agent` or just the string. They show up in the profile lists (global, per-site rules, popup) and as **Random — from my custom agents** for rotation. Used exactly as typed; only printable ASCII is accepted because the value goes into an HTTP header.
- Not changed: language and Do Not Track stay in the Privacy tab. Limits: `new Date(y, m, d)` / `Date.parse` still read input in the real zone; worker and OffscreenCanvas contexts keep real GPU values.

## v3.5 — Online User-Agent list (optional)
- **Settings → User-Agent → "Your own User-Agent list"** (optional, blank by default). Paste an https link to any plain-text file with one User-Agent per line (e.g. a raw GitHub file); it is re-fetched about hourly and nothing is requested from it unless you set a link.
- **Never stale, never broken.** Order: online list → Google/Mozilla version feeds → built-in estimates. A list that is empty, malformed or out of date is ignored and the next source takes over, so generating always works, offline included.
- "Update versions now" refreshes everything and shows exactly what is in use and any error.

## v3.4 — Settings stick + always-current User-Agents
- **Fix: choices no longer reset.** The popup used to start from a fresh profile and a newly generated UA every time it opened. It now remembers your profile, keeps unsaved text (per site) until you apply it, and saves rotation profile/interval the moment you change them. Settings page remembers its profile too.
- **Live versions.** Newest stable Chrome and Firefox (and Firefox ESR) versions are looked up from Google's and Mozilla's version feeds at startup and every few hours (Settings → User-Agent → *Update versions now*). Falls back to built-in estimates if offline or if you turn the lookup off. Manual Chrome/Safari overrides still win.
- **Stays current.** "Apply to all sites" with a generated UA is re-generated automatically when versions change (*Keep this User-Agent up to date*). Rotation always produces fresh UAs. Custom text is never touched.
- **28 profiles** (was 18): ChromeOS, Edge Linux, Firefox ESR, Opera macOS/Linux, Android tablet, Edge & Samsung Internet on Android, Firefox & Edge on iPhone.
- Safari/iOS versions and Samsung Internet are estimated from release cadence (no public feed).

## v3.3 — True browser detection
- **Your real browser, detected for real.** Read from Firefox itself (`getBrowserInfo`, `getPlatformInfo`, unspoofed extension-page UA): exact version, release channel (Nightly / Developer Edition / Beta / Release-ESR), build ID, OS and CPU, and Firefox-based forks (Tor Browser, Mullvad, LibreWolf, Waterfox, Floorp, Zen, …). Shown at the top of the popup and in Settings → **Browser check**. It also notices when *Resist Fingerprinting* is already on (it overrides some spoofed values).
- **"What do sites detect?" self-test.** Runs a site-style "true browser" probe on a tab (popup button, or Settings → Browser check, which can also open example.com in a background tab) and reports ✓ / ✗ per check: JS vs HTTP User-Agent, `navigator.platform`/`vendor`, Client Hints, Firefox/Gecko giveaways (`InstallTrigger`, `-moz-` CSS, `buildID`, `Error.fileName`, stack format…), Chromium-only features, native-looking `toString`, and Web Worker consistency. Ends with a verdict: *Convincing / Mostly convincing / Detectable*.
- **Matches your own OS.** The popup now starts from the Chrome profile for the OS you are really on, and warns when a UA claims a different OS or device type (fonts, GPU and screen would contradict it).
- **Fix: blob workers leaked your real UA.** `new Worker(URL.createObjectURL(...))` bypassed the Worker coverage; blob: workers are now covered too (their source is read immediately, so sites that revoke the blob URL still work).

## v3.2 — Block location fully
Privacy → Fingerprint hardening → **Block location fully** (also part of *Strict*). Geolocation calls always fail with "permission denied", `permissions.query({name:'geolocation'})` reports `denied`, and a `Permissions-Policy: geolocation=()` header makes Firefox itself refuse it for the page and every iframe. For belt-and-braces also set `geo.enabled` = false in `about:config`.
Not covered: location inferred from your **IP address** (use the proxy/Tor feature) and timezone/language hints.

## What's new in v3.1 (engine hiding)
- Spoofed functions now report `[native code]` from `Function.prototype.toString`
- Web Workers / SharedWorkers (classic) get the same `navigator` values, closing the biggest Firefox leak
- Chromium-style `Accept` headers for images and stylesheets
- Extra Chromium-only APIs: `performance.memory`, `webkitRequestFileSystem`, `webkitGetUserMedia`
- Still not hideable from an extension: TLS/JA3 and HTTP/2 fingerprints, header order, font rendering, module workers

## What's new in v3
- **Privacy tab** — one-click *Balanced* / *Strict* levels, plus individual controls:
  - request headers: `DNT`, `Sec-GPC` (Global Privacy Control), referrer policy (site-address only / same-site only / none), reported language (`Accept-Language` + `navigator.languages`)
  - strip tracking parameters (`utm_*`, `fbclid`, `gclid`, `msclkid`, … plus your own list) from visited links
  - fingerprint hardening: CPU core count, screen size, canvas noise, WebGL GPU masking (match the spoofed UA, or a common GPU), geolocation block, `sendBeacon` block
  - Firefox privacy prefs (via the `privacy` API, reverted when you turn them off or uninstall): WebRTC IP handling, cookie policy, Tracking Protection, hyperlink-auditing/`ping`, prefetch/DNS-prefetch, Resist Fingerprinting, First-Party Isolation
  - per-site "skip privacy tweaks" list (also a button in the popup)
- **IP & Proxy tab** — route Firefox through a SOCKS5/SOCKS4/HTTP/HTTPS proxy to hide your IP:
  - one-click presets for **Tor Browser**, the **Tor service**, and an **SSH tunnel** (all free)
  - several proxies, all-sites or only-listed-sites scope, never-proxy list, rotation (timed or fixed-per-site), optional UA change on rotation
  - Tor "separate circuit per site" (stream isolation)
  - DNS through the proxy, automatic WebRTC leak protection, kill switch
  - **Check my IP** and **WebRTC leak test** buttons
  - HTTP proxy username/password support
- Popup gets Privacy and "Hide my IP" cards. Badge shows `PRX` / `ON+P` / `A+P` when a proxy is active.

## About hiding your IP "for free"
A browser extension cannot hide your IP on its own; your traffic has to leave through another machine. Vivid User Privacy does the routing and leak-proofing, but you must supply the exit point. Free options that are actually trustworthy:
1. **Tor** — run Tor Browser (or the `tor` service) in the background, click *+ Tor Browser (9150)* in Settings → IP & Proxy, tick *Route traffic through the selected proxy*. 
2. **Your own server** — `ssh -D 1080 user@your-server`, then *+ SSH tunnel (1080)*. Any cheap/free-tier VPS works.
3. A SOCKS5/HTTP proxy or VPN endpoint you already have.

Avoid public "free proxy lists": the operator can read and modify unencrypted traffic and many log everything.

### Leak checklist
- Press **Check my IP** (uses `api.ipify.org` by default, only when you click; change it in Settings) and compare with and without the proxy.
- Run the **WebRTC leak test**.
- Firefox only lets add-ons handle **private windows** if you enable *Run in Private Windows* for Vivid User Privacy in `about:addons`. Otherwise private-window traffic is **not** proxied.
- Tor Browser itself is a far stronger anonymity tool than any add-on; using Tor through Vivid User Privacy in regular Firefox hides your IP but your browser fingerprint is still Firefox-like.
- The kill switch is best-effort: after the proxy fails it blocks proxied traffic for 10 s at a time. Verify with the IP check rather than assuming.
- Proxy credentials are saved unencrypted in the extension's local storage; exports never include passwords.

## User-Agent features (unchanged)
- 18 profiles: Chrome / Edge / Firefox / Safari / Opera on Windows, macOS, Linux; Android & iOS/iPad browsers; Googlebot, Bingbot
- Custom User-Agent, per-site rules (subdomains covered, most specific wins), "Firefox default" per site
- Automatic rotation (10 s – 24 h) over one profile, or random desktop / mobile / any
- Consistent spoofing: HTTP `User-Agent` **and** `navigator.userAgent`, `appVersion`, `platform`, `vendor`, `oscpu`, `maxTouchPoints`, `userAgentData`, plus `Sec-CH-UA*` headers for Chromium UAs
- Deep stealth (hide Firefox-only APIs, add Chromium-only ones)

## Install (temporary)
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `manifest.json`.
For permanent install, sign it via addons.mozilla.org (unlisted) or use Firefox Developer/Nightly with `xpinstall.signatures.required = false`.
New permissions in v3: `proxy` (routing) and `privacy` (Firefox privacy prefs).

## Precedence
UA: site rule → automatic rotation (if on) → global UA → Firefox's real UA.
Privacy tweaks apply everywhere except the "skip" list. Proxy: never-proxy list → scope → proxy choice.

## Notes & limits
- Changes apply to *new* page loads; the popup can reload the tab for you.
- Page-level privacy features only change what JavaScript reads. Web Workers keep Firefox's real values. Canvas noise can upset image editors/games — use the skip list.
- Screen-size spoofing doesn't change `innerWidth/outerWidth` or `devicePixelRatio`.
- Timezone spoofing isn't implemented; Firefox's *Resist Fingerprinting* option (Advanced) sets UTC but also changes many other behaviours and overrides some Vivid User Privacy values.
- A proxy sees the destination of every connection, and plain-HTTP content. Use HTTPS.
- Chrome/Edge/Safari version numbers are estimated offline; override them in Settings → User-Agent → Version overrides.
- Deep stealth cannot make Firefox byte-identical to Chrome (TLS/HTTP2 fingerprints, fonts, engine-evaluated CSS, etc. remain).
- Firefox blocks extensions on some pages (about:*, addons.mozilla.org, etc.).
