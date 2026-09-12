/**
 * Accessibility utilities for WCAG 2.1 compliance
 * Includes ARIA helpers, keyboard navigation support, and accessibility testing
 */

/**
 * Keyboard event handlers for common patterns
 */
export const KeyBindings = {
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  HOME: 'Home',
  END: 'End',
  TAB: 'Tab',
};

/**
 * Handle keyboard navigation for menu/listbox items
 * @param {Event} event - Keyboard event
 * @param {array} items - Array of focusable items
 * @param {number} currentIndex - Current focused item index
 * @returns {number} New focused index or -1 if no change
 */
export const handleMenuKeyboard = (event, items, currentIndex) => {
  if (!items || items.length === 0) return -1;

  const total = items.length;

  switch (event.key) {
    case KeyBindings.ARROW_DOWN:
      event.preventDefault();
      return (currentIndex + 1) % total;

    case KeyBindings.ARROW_UP:
      event.preventDefault();
      return currentIndex === 0 ? total - 1 : currentIndex - 1;

    case KeyBindings.HOME:
      event.preventDefault();
      return 0;

    case KeyBindings.END:
      event.preventDefault();
      return total - 1;

    default:
      return -1;
  }
};

/**
 * Focus management utilities
 */
export const FocusManagement = {
  /**
   * Trap focus within an element
   * @param {HTMLElement} container - Container to trap focus in
   * @param {Event} event - Keyboard event
   */
  trapFocus: (container, event) => {
    if (event.key !== KeyBindings.TAB) return;

    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (activeElement === firstElement) {
        lastElement.focus();
        event.preventDefault();
      }
    } else {
      if (activeElement === lastElement) {
        firstElement.focus();
        event.preventDefault();
      }
    }
  },

  /**
   * Move focus to an element with optional announcement
   * @param {HTMLElement} element - Element to focus
   * @param {string} ariaLiveRegion - ID of aria-live region for announcement
   */
  moveFocus: element => {
    if (!element) return;
    element.focus();
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  /**
   * Get first focusable element
   * @param {HTMLElement} container - Container to search in
   * @returns {HTMLElement|null}
   */
  getFirstFocusable: (container) => {
    return container?.querySelector(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  },

  /**
   * Get all focusable elements
   * @param {HTMLElement} container - Container to search in
   * @returns {NodeList}
   */
  getAllFocusable: (container) => {
    return container?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || [];
  },
};

/**
 * ARIA live region announcements
 */
export const announceMessage = (message, priority = 'polite') => {
  let liveRegion = document.getElementById('aria-live-announcer');

  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'aria-live-announcer';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.position = 'absolute';
    liveRegion.style.left = '-10000px';
    liveRegion.style.width = '1px';
    liveRegion.style.height = '1px';
    liveRegion.style.overflow = 'hidden';
    document.body.appendChild(liveRegion);
  }

  liveRegion.textContent = message;
};

/**
 * Skip link creation for keyboard navigation
 * @returns {object} JSX component properties
 */
export const createSkipLink = () => ({
  href: '#main-content',
  className: 'skip-link',
  children: 'Skip to main content',
  style: {
    position: 'absolute',
    left: '-10000px',
    zIndex: 999,
  },
  onFocus: (e) => {
    e.target.style.left = '0';
    e.target.style.top = '0';
  },
  onBlur: (e) => {
    e.target.style.left = '-10000px';
  },
});

/**
 * Semantic heading hierarchy validator
 * Returns warning if headings are not in proper order
 * @param {HTMLElement} container - Container to validate
 * @returns {array} Array of issues found
 */
export const validateHeadingHierarchy = (container) => {
  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const issues = [];

  let previousLevel = 0;
  headings.forEach((heading, index) => {
    const currentLevel = parseInt(heading.tagName[1]);
    if (index === 0 && currentLevel !== 1) {
      issues.push(`Page should start with H1, found ${heading.tagName}`);
    }
    if (currentLevel - previousLevel > 1) {
      issues.push(`Skipped heading levels from H${previousLevel} to H${currentLevel}`);
    }
    previousLevel = currentLevel;
  });

  return issues;
};

/**
 * Color contrast checker (basic)
 * @param {string} foreground - Foreground color (hex or rgb)
 * @param {string} background - Background color (hex or rgb)
 * @returns {object} { ratio: number, passes: boolean, level: string }
 */
export const checkContrast = (foreground, background) => {
  const getLuminance = (color) => {
    const rgb = color.match(/\d+/g).map(Number);
    const [r, g, b] = rgb.map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const lum1 = getLuminance(foreground);
  const lum2 = getLuminance(background);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio: ratio.toFixed(2),
    passes: ratio >= 4.5, // WCAG AA
    level: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'Fail',
  };
};

/**
 * Initialize axe-core for accessibility audits
 * Use only in development
 */
export const setupAxeAudit = async () => {
  if (!import.meta.env.DEV) return;

  try {
    // Load axe-core from CDN
    if (!window.axe) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.0/axe.min.js';
      script.async = true;
      script.onload = () => {
        console.log('Axe audit setup complete. Run window.axeRunAudit() to test.');
      };
      script.onerror = () => {
        console.warn('Failed to load axe-core from CDN');
      };
      document.head.appendChild(script);
    }

    window.axeRunAudit = () => {
      if (!window.axe) {
        console.warn('Axe-core not available');
        return;
      }
      window.axe.run((error, results) => {
        if (error) throw error;
        console.log('Axe Audit Results:', results);
        console.table(results.violations);
        return results;
      });
    };
  } catch (error) {
    console.warn('Axe-core not available for accessibility testing:', error.message);
  }
};

/**
 * ARIA attributes helper
 */
export const createAriaProps = {
  /**
   * Button with aria-label
   */
  button: (label, pressed = null) => ({
    role: 'button',
    'aria-label': label,
    ...(pressed !== null && { 'aria-pressed': pressed }),
  }),

  /**
   * Heading with aria-level
   */
  heading: (level = 1) => ({
    role: 'heading',
    'aria-level': level,
  }),

  /**
   * Loading state
   */
  loading: (isLoading) => ({
    'aria-busy': isLoading,
    'aria-label': isLoading ? 'Loading...' : undefined,
  }),

  /**
   * Dialog or modal
   */
  dialog: (title, isOpen = true) => ({
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': `dialog-title-${title}`,
    hidden: !isOpen,
  }),

  /**
   * Form field with label
   */
  field: (id, label, required = false) => ({
    'aria-label': label,
    'aria-required': required,
    'aria-describedby': `${id}-help`,
  }),

  /**
   * Status badge
   */
  status: (status) => ({
    'aria-label': `Status: ${status}`,
    role: 'status',
  }),

  /**
   * Sortable column header
   */
  columnHeader: (label, sortDirection = null) => ({
    'aria-label': label,
    'aria-sort': sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none',
  }),

  /**
   * Tab component
   */
  tab: (id, isSelected = false) => ({
    role: 'tab',
    'aria-selected': isSelected,
    'aria-controls': `${id}-panel`,
  }),

  /**
   * Tab panel
   */
  tabPanel: (id, isVisible = true) => ({
    role: 'tabpanel',
    hidden: !isVisible,
    'aria-labelledby': `${id}-tab`,
  }),
};

export default {
  KeyBindings,
  handleMenuKeyboard,
  FocusManagement,
  announceMessage,
  createSkipLink,
  validateHeadingHierarchy,
  checkContrast,
  setupAxeAudit,
  createAriaProps,
};
