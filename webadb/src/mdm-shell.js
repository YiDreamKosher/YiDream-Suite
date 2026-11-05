/** Same-origin MDM views hosted inside the Classic administration shell. */
export const MDM_VIEWS = Object.freeze(['home', 'catalog', 'requests', 'pair']);
export const MDM_TITLES = Object.freeze({
  home: 'Accueil',
  catalog: 'Boutique d’applications',
  requests: 'Demandes de sites',
  pair: 'Associer un appareil'
});

export function mdmViewFromHash(hash) {
  const match = /^#mdm-(home|catalog|requests|pair)$/.exec(String(hash || ''));
  return match ? match[1] : null;
}

export function mdmPage(view) {
  return MDM_VIEWS.includes(view) ? (view === 'home' ? 'dashboard' : 'mdm-' + view) : null;
}

export function mdmViewForPage(page) {
  return page === 'dashboard' ? 'home' : mdmViewFromHash('#' + page);
}

export function mdmFrameSource(view, language = 'fr', pathname = typeof location === 'undefined' ? '/admin.html' : location.pathname) {
  if (!MDM_VIEWS.includes(view)) throw new TypeError('Vue MDM inconnue.');
  const params = new URLSearchParams({
    embed: 'classic',
    view,
    lang: ['fr', 'en', 'he', 'yi'].includes(language) ? language : 'fr',
    v: '20261104-classic'
  });
  const prefix = /\/admin(?:\/|\/index\.html)$/.test(pathname) ? '../' : './';
  return prefix + 'mdm-admin.html?' + params;
}

/** A child can resize or navigate only the exact iframe currently mounted. */
export function trustedMdmMessage(event, frame, origin) {
  if (!frame || !frame.contentWindow || event.origin !== origin || event.source !== frame.contentWindow) return null;
  const message = event.data;
  if (!message || typeof message !== 'object') return null;
  if (message.type === 'yidream-mdm:resize') {
    if (typeof message.height !== 'number' || !Number.isFinite(message.height) || message.height <= 0 || message.height > 30000) return null;
    return { type: 'resize', height: Math.max(160, Math.ceil(message.height)) };
  }
  if (message.type === 'yidream-mdm:focus') return { type: 'focus' };
  if (message.type === 'yidream-mdm:navigate' && MDM_VIEWS.includes(message.view)) return { type: 'navigate', view: message.view };
  return null;
}
