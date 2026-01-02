/*
  Ocure Analytics — Cookie Consent (Drop‑in JS)
  -------------------------------------------------
  Add this to *every page* once and it will:
   • Inject a banner on first visit and a preferences modal.
   • Store consent in localStorage (key: "ocure.cookieConsent.v1").
   • Re‑enable blocked scripts marked with type="text/plain" and data-consent="analytics|marketing".
   • Expose a small API: window.ocureConsent
       - get(): returns consent object or null
       - open(): opens the preferences modal
       - require(kind, fn): runs fn now if consent allows, otherwise runs when user enables it
  Usage:
    <script defer src="/js/ocure-consent.js"></script>
    <!-- Gate your non‑essential scripts: -->
    <script type="text/plain" data-consent="analytics" src="https://www.googletagmanager.com/gtag/js?id=GA-XXXX"></script>
    <script type="text/plain" data-consent="analytics">/* your GA init * /</script>

  Optional: any element with [data-open-cookie-prefs] will open the modal when clicked.
*/
(function () {
  if (window.__ocureConsentLoaded) return; // idempotent
  window.__ocureConsentLoaded = true;

  const LS_KEY = 'ocure.cookieConsent.v1';
  const lang = (document.documentElement.getAttribute('lang') || 'en').toLowerCase().startsWith('hu') ? 'hu' : 'en';

  const i18n = {
    en: {
      title: 'Cookies on this site',
      desc: 'We use essential cookies. With your consent, we may also use analytics and marketing cookies to improve your experience.',
      acceptAll: 'Accept all',
      rejectAll: 'Reject non‑essential',
      manage: 'Manage',
      modalTitle: 'Cookie preferences',
      modalDesc: 'Essential cookies are always on to keep the site working. You can choose the rest.',
      analytics: 'Analytics',
      marketing: 'Marketing',
      cancel: 'Cancel',
      save: 'Save'
    },
    hu: {
      title: 'Sütik ezen az oldalon',
      desc: 'Alapvető sütiket használunk. Hozzájárulás esetén analitikai és marketing sütiket is alkalmazhatunk a jobb élményért.',
      acceptAll: 'Összes elfogadása',
      rejectAll: 'Csak alapvetők',
      manage: 'Beállítások',
      modalTitle: 'Süti beállítások',
      modalDesc: 'Az alapvető sütik mindig engedélyezve vannak a működéshez. A többit Ön választhatja ki.',
      analytics: 'Analitika',
      marketing: 'Marketing',
      cancel: 'Mégse',
      save: 'Mentés'
    }
  }[lang];

  // Helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'style') Object.assign(e.style, v); else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }

  function getConsent() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; }
  }
  function setConsent(v) { localStorage.setItem(LS_KEY, JSON.stringify(v)); dispatchEvent(new CustomEvent('ocure:consent', { detail: v })); }

  // Inject minimal styles (uses your CSS variables)
  (function injectStyles(){
    if ($('#ocure-consent-style')) return;
    const css = `
      .ocure-banner{position:fixed;inset:auto 1rem 1rem 1rem;z-index:10000;display:none;gap:.9rem;align-items:center;justify-content:space-between;flex-wrap:wrap;background:color-mix(in oklab,var(--surface) 92%,transparent);border:1px solid color-mix(in oklab,var(--muted) 55%,transparent);border-radius:1rem;padding:1rem}
      .ocure-actions{display:flex;gap:.5rem;flex-wrap:wrap}
      .ocure-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem .8rem;border-radius:.6rem;border:1px solid color-mix(in oklab,var(--accent) 35%,transparent);background:linear-gradient(180deg,color-mix(in oklab,var(--accent) 18%,transparent) 0%,transparent);color:var(--text);font-weight:600}
      .ocure-btn.secondary{border-color:color-mix(in oklab,var(--muted) 60%,transparent);background:transparent;color:var(--text-dim)}
      .ocure-btn.link{border:none;background:none;padding:.2rem .3rem;color:var(--accent)}
      .ocure-backdrop{position:fixed;inset:0;background:color-mix(in oklab,#000 60%,transparent);display:none;z-index:10001}
      .ocure-modal{position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);width:min(680px,92vw);display:none;background:var(--surface);border:1px solid var(--muted);border-radius:1rem;padding:1rem;z-index:10002}
      .ocure-switch{display:flex;align-items:center;gap:.5rem;margin:.3rem 0}
      .ocure-pill{display:inline-flex;align-items:center;padding:.25rem .5rem;border:1px solid color-mix(in oklab,var(--muted) 55%,transparent);border-radius:.6rem;color:var(--text-dim)}
    `;
    const style = el('style', { id: 'ocure-consent-style' }, css);
    document.head.append(style);
  })();

  // Build UI (only if not already present)
  const BANNER = $('#cookieBanner') || (function(){
    const b = el('div', { id: 'cookieBanner', class: 'ocure-banner', role: 'dialog', 'aria-live': 'polite' },
      el('div', { style: 'flex:1;min-width:240px' },
        el('strong', null, i18n.title),
        el('p', { style: 'margin:.2rem 0 0;color:var(--text-dim)' }, i18n.desc)
      ),
      el('div', { class: 'ocure-actions' },
        el('button', { id: 'rejectAll', class: 'ocure-btn secondary' }, i18n.rejectAll),
        el('button', { id: 'acceptAll', class: 'ocure-btn' }, i18n.acceptAll),
        el('button', { id: 'manage', class: 'ocure-btn link' }, i18n.manage)
      )
    );
    document.body.append(b); return b;
  })();

  const BACK = $('#modalBackdrop') || el('div', { id: 'modalBackdrop', class: 'ocure-backdrop', 'aria-hidden': 'true' });
  const MODAL = $('#prefsModal') || (function(){
    const m = el('div', { id: 'prefsModal', class: 'ocure-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'prefsTitle' },
      el('div', null,
        el('div', { class: 'ocure-pill', style: 'margin-bottom:.4rem' }, 'Consent v1'),
        el('h3', { id: 'prefsTitle', style: 'margin:.2rem 0 .6rem' }, i18n.modalTitle),
        el('p', { style: 'color:var(--text-dim)' }, i18n.modalDesc),
        el('div', { class: 'ocure-switch' }, el('input', { type: 'checkbox', id: 'analyticsOpt' }), el('label', { for: 'analyticsOpt' }, i18n.analytics)),
        el('div', { class: 'ocure-switch' }, el('input', { type: 'checkbox', id: 'marketingOpt' }), el('label', { for: 'marketingOpt' }, i18n.marketing)),
        el('div', { style: 'margin-top:1rem;display:flex;gap:.5rem;justify-content:flex-end' },
          el('button', { id: 'cancelPrefs', class: 'ocure-btn secondary' }, i18n.cancel),
          el('button', { id: 'savePrefs', class: 'ocure-btn' }, i18n.save)
        )
      )
    );
    return m;
  })();
  if (!$('#modalBackdrop')) document.body.append(BACK);
  if (!$('#prefsModal')) document.body.append(MODAL);

  // Elements
  const A = $('#analyticsOpt', MODAL);
  const M = $('#marketingOpt', MODAL);

  // Modal helpers
  function openModal(){ BACK.style.display='block'; MODAL.style.display='block'; }
  function closeModal(){ BACK.style.display='none'; MODAL.style.display='none'; }

  // Consent apply + script unblocking
  function applyFromConsent(c){
    A.checked = !!c.analytics; M.checked = !!c.marketing;
    // Unblock any deferred scripts that match consent
    $$('script[type="text/plain"][data-consent]').forEach(s => {
      const kind = s.getAttribute('data-consent');
      if (!kind || !c[kind]) return;
      const clone = document.createElement('script');
      // Copy attributes except type/data-consent
      for (const { name, value } of Array.from(s.attributes)) {
        if (name === 'type' || name === 'data-consent') continue;
        clone.setAttribute(name, value);
      }
      clone.type = 'text/javascript';
      if (s.textContent && !s.src) clone.textContent = s.textContent;
      s.replaceWith(clone);
    });
  }

  // Buttons
  $('#acceptAll', BANNER).onclick = () => {
    const c = { essential:true, analytics:true, marketing:true, ts:Date.now() };
    setConsent(c); hideBanner(); applyFromConsent(c);
  };
  $('#rejectAll', BANNER).onclick = () => {
    const c = { essential:true, analytics:false, marketing:false, ts:Date.now() };
    setConsent(c); hideBanner(); applyFromConsent(c);
  };
  $('#manage', BANNER).onclick = openModal;
  $('#cancelPrefs', MODAL).onclick = closeModal;
  $('#savePrefs', MODAL).onclick = () => {
    const c = { essential:true, analytics:A.checked, marketing:M.checked, ts:Date.now() };
    setConsent(c); closeModal(); hideBanner(); applyFromConsent(c);
  };

  // Footer/links opener
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-cookie-prefs]');
    if (t) { e.preventDefault(); openModal(); }
  });

  function showBanner(){ BANNER.style.display = 'flex'; }
  function hideBanner(){ BANNER.style.display = 'none'; }

  // First load
  const existing = getConsent();
  if (!existing) showBanner(); else applyFromConsent(existing);

  // Public API
  window.ocureConsent = {
    get: getConsent,
    open: openModal,
    require(kind, fn){
      const c = getConsent();
      if (c && c[kind]) return void fn();
      addEventListener('ocure:consent', (ev) => { if (ev.detail && ev.detail[kind]) fn(); }, { once:false });
    }
  };
})();
