const paths = {
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  building: '<path d="M3 21h18M6 21V3h12v18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1"/>',
  alert: '<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  map: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
};

export const mapIconSvg = (name, size = 20, color = 'white') =>
  `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.map}</svg>`;
