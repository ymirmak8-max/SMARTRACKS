import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const CollapsibleSection = ({
  title,
  subtitle,
  count,
  defaultOpen = false,
  children,
  className = '',
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`collapse-card ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="collapse-trigger"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
      >
        <span className="collapse-copy">
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </span>
        {count != null && <span className="collapse-count">{count}</span>}
        <ChevronDown className="collapse-chevron" size={18} aria-hidden="true" />
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </section>
  );
};

export default CollapsibleSection;
