const TILE_OPTIONS = {
  updateWhenIdle: true,
  updateWhenZooming: false,
  crossOrigin: true,
};

export const createMapLayers = (L, { coarsePointer = false } = {}) => ({
  street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    ...TILE_OPTIONS,
    maxZoom: 19,
    keepBuffer: coarsePointer ? 3 : 5,
    attribution: '&copy; OpenStreetMap contributors',
  }),
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      ...TILE_OPTIONS,
      maxZoom: 19,
      keepBuffer: coarsePointer ? 3 : 5,
      attribution: 'Tiles &copy; Esri',
    },
  ),
});

export const showMapLayer = (map, layers, style) => {
  if (!map || !layers) return;
  Object.values(layers).forEach(layer => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });
  (layers[style] || layers.street).addTo(map);
};
