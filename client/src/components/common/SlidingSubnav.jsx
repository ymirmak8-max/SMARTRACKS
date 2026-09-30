import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const SlidingSubnav = ({ items, activeKey, onChange, ariaLabel }) => {
  const trackRef = useRef(null);
  const [thumb, setThumb] = useState({ left: 0, width: 0, ready: false });
  const itemSignature = useMemo(
    () => items.map(item => `${item.key}:${item.label}:${item.count || 0}`).join('|'),
    [items],
  );

  const updateThumb = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector('[data-subnav-active="true"]');
    if (!active) return;
    setThumb({
      left: active.offsetLeft,
      width: active.offsetWidth,
      ready: true,
    });
  }, []);

  useLayoutEffect(() => {
    updateThumb();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateThumb);
    observer.observe(track);
    [...track.querySelectorAll('button')].forEach(button => observer.observe(button));
    window.addEventListener('resize', updateThumb);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateThumb);
    };
  }, [activeKey, itemSignature, updateThumb]);

  return (
    <div
      className="workspace-subnav workspace-subnav-scroll workspace-subnav-slider"
      role="tablist"
      aria-label={ariaLabel}
    >
      <div ref={trackRef} className="workspace-subnav-track">
        <span
          className={`workspace-subnav-thumb ${thumb.ready ? 'is-ready' : ''}`}
          aria-hidden="true"
          style={{ transform: `translateX(${thumb.left}px)`, width: `${thumb.width}px` }}
        />
        {items.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={activeKey === item.key}
            data-subnav-active={activeKey === item.key ? 'true' : 'false'}
            className={activeKey === item.key ? 'active' : ''}
            onClick={() => onChange(item.key)}
          >
            {item.icon} {item.label}
            {item.count > 0 && <span className="workspace-subnav-count">{item.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SlidingSubnav;
