import { useId } from 'react';

const BrandLogo = ({ className = '', alt = 'Smartrack logo', mark = false, size = 'md' }) => {
  const uid = useId().replace(/:/g, '');
  const pinId = `smartrack-pin-${uid}`;
  const plateId = `smartrack-plate-${uid}`;
  const glowId = `smartrack-glow-${uid}`;

  return (
    <span
      className={`brand-lockup brand-lockup-${size} ${mark ? 'brand-lockup-mark' : 'brand-lockup-full'} ${className}`.trim()}
      role="img"
      aria-label={alt}
    >
      <span className="brand-stage" aria-hidden="true">
        <svg className="brand-svg" viewBox="0 0 64 64" fill="none">
          <defs>
            <radialGradient id={glowId} cx="32" cy="30" r="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4DE3FF" stopOpacity="0.55" />
              <stop offset="1" stopColor="#4DE3FF" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={plateId} x1="8" y1="32" x2="56" y2="56" gradientUnits="userSpaceOnUse">
              <stop stopColor="#0A3A72" />
              <stop offset="1" stopColor="#04182F" />
            </linearGradient>
            <linearGradient id={pinId} x1="18" y1="6" x2="46" y2="48" gradientUnits="userSpaceOnUse">
              <stop stopColor="#6AD6FF" />
              <stop offset="1" stopColor="#0094D4" />
            </linearGradient>
          </defs>
          <circle className="brand-svg-glow" cx="32" cy="32" r="28" fill={`url(#${glowId})`} />
          <polygon className="brand-svg-plate" points="8,43 32,31 56,43 32,55" fill={`url(#${plateId})`} />
          <circle className="brand-svg-dot" cx="32" cy="43" r="5.2" fill="#5FD0FF" />
          <path
            className="brand-svg-pin"
            d="M32 7.5c-8.2 0-14.8 6.4-14.8 14.4 0 11 14.8 27.1 14.8 27.1s14.8-16.1 14.8-27.1C46.8 13.9 40.2 7.5 32 7.5zm0 19.4a5.1 5.1 0 1 1 0-10.2 5.1 5.1 0 0 1 0 10.2z"
            fill={`url(#${pinId})`}
          />
        </svg>
      </span>
      {!mark && (
        <span className="brand-wordmark" aria-hidden="true">
          <span className="brand-smart">Smar</span>
          <span className="brand-track">track</span>
        </span>
      )}
    </span>
  );
};

export default BrandLogo;
