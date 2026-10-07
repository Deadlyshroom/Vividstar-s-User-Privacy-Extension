# Vivid User Privacy for Firefox (v1.0.5)

## Web Workers option (Settings → Spoofing → More spoofing)
- **Web Workers:** *Match the claimed browser* (default, unchanged), *Leave workers alone*, or *Block workers* (`Worker` / `SharedWorker` throw; many sites will break).

## Cross-tab identity leak protection (Settings → Spoofing → More spoofing, off by default)
- **One identity per site across all tabs:** forces the per-site sticky User-Agent on, even if "Keep the same User-Agent while a site is open" is off, so two tabs of one site never see two different browsers.
- **No window links between sites:** a top-level page opened from or reached from another site gets an empty `window.name`, and `window.opener` is set to `null` when the opener is a different site. Follows the Privacy master switch and the "sites to skip" list.
- Limit: some pop-up sign-in flows need `window.opener`; add the site to "sites to skip" if one breaks.




- **Clean links** (Privacy tab and popup): one setting that removes tracking tags (`utm_*`, `fbclid`, `gclid`, `si=` …) from addresses you open and skips click-logging / "you are leaving this site" redirect pages (Google, Facebook, Instagram, YouTube, Steam, Reddit, LinkedIn, Slack, VK, DuckDuckGo, Outlook Safe Links, Tumblr). Replaces the former separate "Skip tracking redirects" and "Strip tracking parameters" options.

## Fix: endless "Verify you are human" loop
- A bot check compares the claimed browser with the real engine, so a Chrome/Safari identity on Firefox loops forever. When a site shows the check, the tab is reloaded once and from then on that site gets a Firefox identity (User-Agent switching stays on, same engine so it passes) and no fingerprint tweaks. The check's own frames are never touched. It only reads response headers; it does not contact any Cloudflare service. Other sites are unaffected.

## Fix: automatic rotation no longer breaks sites
- **Keep the same User-Agent while a site is open** (Settings → Automatic rotation, on by default). Before, a rotation changed the User-Agent in request headers immediately but not in the JavaScript of pages that were already open, so sites saw two different browsers and broke, logged you out or asked for verification. Now each site keeps the User-Agent it first saw until all its tabs are closed (or you change rotation settings); sites you open afterwards get the newest one.
- The page-side script is swapped without a gap, so no page load is missed during a rotation.
- Fresh installs now rotate between **desktop** browsers only (mobile layouts broke many sites). Existing settings are unchanged.


## v1.0.4
- **Block geolocation requests** is now on by default (together with *Block location fully*). Existing installs keep whatever they saved.
- **Upgrade to HTTPS** (Privacy tab, off by default): `http://` pages open as `https://`; local/IP addresses and your skip list are excluded.




## What's new in v1.0.5
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
