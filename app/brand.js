const BRAND_ASSETS = Object.freeze({
  horizontal: {
    src: 'assets/brand/neomes-logo-horizontal.svg',
    width: 816,
    height: 272
  },
  symbol: {
    src: 'assets/brand/neomes-symbol.svg',
    width: 296,
    height: 296
  },
  appIcon: {
    src: 'icons/neomes-app-icon.svg',
    width: 512,
    height: 512
  }
});

function safeSize(value) {
  return ['small', 'medium', 'large'].includes(value) ? value : 'medium';
}

export function brandLogo({
  variant = 'horizontal',
  size = 'medium',
  alt = 'NEOMES',
  className = '',
  priority = false
} = {}) {
  const asset = BRAND_ASSETS[variant] || BRAND_ASSETS.horizontal;
  const classes = ['brand-logo', `brand-logo--${variant}`, `brand-logo--${safeSize(size)}`, className]
    .filter(Boolean)
    .join(' ');
  return `<img class="${classes}" src="${asset.src}" width="${asset.width}" height="${asset.height}" alt="${alt}" draggable="false" decoding="async" ${priority ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
}

export function responsiveBrandLogo({ size = 'medium', alt = 'NEOMES', priority = false } = {}) {
  return `<span class="brand-logo-responsive" aria-label="${alt}">
    ${brandLogo({ variant: 'horizontal', size, alt, priority, className: 'brand-logo-responsive__horizontal' })}
    ${brandLogo({ variant: 'symbol', size, alt: '', priority, className: 'brand-logo-responsive__symbol' })}
  </span>`;
}

export function brandHeader({ subtitle = 'Registro operacional do turno' } = {}) {
  return `<div class="neomes-brand-lockup">
    ${responsiveBrandLogo({ size: 'medium', priority: true })}
    <span class="neomes-brand-subtitle">${subtitle}</span>
  </div>`;
}

export function brandMenuHeader() {
  return `<div class="neomes-menu-branding">
    ${brandLogo({ variant: 'horizontal', size: 'large', alt: 'NEOMES' })}
    <span>Operação industrial</span>
  </div>`;
}

export { BRAND_ASSETS };
