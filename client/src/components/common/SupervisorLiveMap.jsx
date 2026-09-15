import { useCallback, useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { getLiveLocations } from '../../api/dtr';
import { mapIconSvg } from '../../utils/mapIcons';
import VectorIcon from './VectorIcon';
import MapControls from './MapControls';
import { createMapLayers, showMapLayer } from '../../utils/mapLayers';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const validCoordinate = (value, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

const formatTime = (timestamp) => {
  if (!timestamp) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

const markerIcon = (L, icon, color) => L.divIcon({
  html: `<div class="live-map-marker" style="--marker-color:${color}">${mapIconSvg(icon, 18)}</div>`,
  className: 'live-map-marker-wrap',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});

const SupervisorLiveMap = () => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const featuresRef = useRef(new Map());
  const baseLayersRef = useRef(null);
  const boundsRef = useRef([]);
  const fittedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const [locations, setLocations] = useState([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [mapStyle, setMapStyle] = useState('street');

  const loadLocations = useCallback(async (manual = false) => {
    const requestId = ++requestSequenceRef.current;
    if (manual) setRefreshing(true);
    try {
      const response = await getLiveLocations();
      if (requestId !== requestSequenceRef.current) return;
      setLocations(Array.isArray(response.data.locations) ? response.data.locations : []);
      setError('');
    } catch (requestError) {
      if (requestId !== requestSequenceRef.current) return;
      console.error('Failed to load supervisor live map:', requestError);
      setError(requestError.response?.data?.message || 'Live locations could not be loaded.');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLocations();
    const interval = window.setInterval(loadLocations, 15000);
    return () => window.clearInterval(interval);
  }, [loadLocations]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let observer;
    const features = featuresRef.current;

    import('leaflet').then(({ default: L }) => {
      if (disposed || !containerRef.current || mapRef.current) return;
      const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: !coarsePointer,
        touchZoom: true,
        dragging: true,
        bounceAtZoomLimits: false,
        zoomSnap: 0.5,
        preferCanvas: true,
      })
        .setView([10.3157, 123.8854], 13);
      mapRef.current = map;
      leafletRef.current = L;

      baseLayersRef.current = createMapLayers(L, { coarsePointer });
      showMapLayer(map, baseLayersRef.current, 'street');

      let resizeFrame = 0;
      let previousWidth = 0;
      let previousHeight = 0;
      observer = new ResizeObserver(entries => {
        const { width, height } = entries[0]?.contentRect || {};
        if (!width || !height || (width === previousWidth && height === previousHeight)) return;
        previousWidth = width;
        previousHeight = height;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
      });
      observer.observe(containerRef.current);
      window.setTimeout(() => map.invalidateSize({ pan: false }), 80);
      setReady(true);
    }).catch(mapError => {
      console.error('Failed to initialize Leaflet:', mapError);
      if (!disposed) setError('The live map could not be initialized.');
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      features.clear();
      baseLayersRef.current = null;
      leafletRef.current = null;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    showMapLayer(mapRef.current, baseLayersRef.current, mapStyle);
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !L) return;
    const features = featuresRef.current;
    const activeKeys = new Set();
    const bounds = [];
    const companies = new Set();

    const upsertMarker = (key, coordinates, iconName, color, popup) => {
      activeKeys.add(key);
      const existing = features.get(key);
      if (existing) {
        existing.setLatLng(coordinates);
        if (existing._smartrackColor !== color) {
          existing.setIcon(markerIcon(L, iconName, color));
          existing._smartrackColor = color;
        }
        existing.setPopupContent(popup);
      } else {
        const marker = L.marker(coordinates, { icon: markerIcon(L, iconName, color) }).addTo(map).bindPopup(popup);
        marker._smartrackColor = color;
        features.set(key, marker);
      }
    };

    locations.forEach(location => {
      const latitude = validCoordinate(location.latitude, -90, 90);
      const longitude = validCoordinate(location.longitude, -180, 180);
      if (latitude === null || longitude === null) return;
      bounds.push([latitude, longitude]);

      const officeLat = validCoordinate(location.office_lat, -90, 90);
      const officeLng = validCoordinate(location.office_lng, -180, 180);
      if (officeLat !== null && officeLng !== null && !companies.has(location.company_id)) {
        companies.add(location.company_id);
        bounds.push([officeLat, officeLng]);
        upsertMarker(`office:${location.company_id}`, [officeLat, officeLng], 'building', '#2563eb',
          `<b>${escapeHtml(location.company_name)}</b><br>Perimeter: ${Number(location.geo_radius_meters) || 50}m`);

        const circleKey = `perimeter:${location.company_id}`;
        activeKeys.add(circleKey);
        const circle = features.get(circleKey);
        if (circle) {
          circle.setLatLng([officeLat, officeLng]);
          circle.setRadius(Number(location.geo_radius_meters) || 50);
        } else {
          features.set(circleKey, L.circle([officeLat, officeLng], {
            radius: Number(location.geo_radius_meters) || 50,
            color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 2, dashArray: '6',
          }).addTo(map));
        }
      }

      const clockedIn = Boolean(location.is_clocked_in);
      const anomaly = Boolean(location.anomaly_flag);
      const color = anomaly ? '#dc2626' : clockedIn ? '#16a34a' : '#64748b';
      const status = anomaly ? 'Anomaly flagged' : clockedIn ? 'Timed in' : 'Not timed in';
      upsertMarker(`student:${location.student_id}`, [latitude, longitude], 'user', color, `
        <b>${escapeHtml(location.first_name)} ${escapeHtml(location.last_name)}</b><br>
        <span style="color:${color};font-weight:600">${status}</span><br>
        <span>${escapeHtml(location.company_name)}</span>
        ${anomaly ? `<br><span style="color:#dc2626">${escapeHtml(location.anomaly_flag)}</span>` : ''}
        ${Number.isFinite(Number(location.accuracy)) ? `<br><span>GPS accuracy: ${Math.round(Number(location.accuracy))} m</span>` : ''}
        <br><span>Updated: ${formatTime(location.updated_at)}</span>
      `);
    });

    features.forEach((layer, key) => {
      if (!activeKeys.has(key)) {
        map.removeLayer(layer);
        features.delete(key);
      }
    });

    if (!fittedRef.current && bounds.length) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [46, 46], maxZoom: 17, animate: false });
      fittedRef.current = true;
    }
    boundsRef.current = bounds;
  }, [locations, ready]);

  const fitLocations = () => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !boundsRef.current.length) return;
    map.fitBounds(L.latLngBounds(boundsRef.current), { padding: [46, 46], maxZoom: 17 });
  };

  return (
    <div>
      <div className="map-page-head">
        <div>
          <div className="section-title icon-label"><VectorIcon name="map" size={18} /> Live map</div>
          <div className="section-sub">{locations.length} assigned student{locations.length === 1 ? '' : 's'}</div>
        </div>
        <div className="map-header-actions">
          <button type="button" className="action-btn action-btn-primary icon-label" onClick={() => loadLocations(true)} disabled={refreshing}>
            <VectorIcon name="refresh" size={15} /> {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="live-map-error"><VectorIcon name="alert" size={16} /> {error}</div>}

      <div className="live-map-legend" aria-label="Map legend">
        {[
          ['#16a34a', 'Timed in'], ['#64748b', 'Not timed in'],
          ['#dc2626', 'Anomaly'], ['#2563eb', 'Office / perimeter'],
        ].map(([color, label]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
      </div>

      <div className="dashboard-map-shell">
        <div ref={containerRef} className="dashboard-map-canvas" aria-label="Live locations map" />
        <div className="live-map-indicator"><i /> Live</div>
        <MapControls mapStyle={mapStyle} onStyleChange={setMapStyle} onFit={fitLocations} />
      </div>

      <div className="card">
        <div className="card-title">Recently reporting students</div>
        {!locations.length ? (
          <p className="live-map-empty">No assigned students yet. They appear here after a coordinator deploys them to your company.</p>
        ) : locations.map(location => {
          const anomaly = Boolean(location.anomaly_flag);
          const clockedIn = Boolean(location.is_clocked_in);
          return (
            <div className={`live-map-student ${anomaly ? 'has-anomaly' : ''}`} key={location.student_id}>
              <div>
                <strong>{location.first_name} {location.last_name}</strong>
                <small><VectorIcon name="building" size={13} /> {location.company_name}</small>
              </div>
              <div className="live-map-student-status">
                <span className={anomaly ? 'danger' : clockedIn ? 'success' : ''}>
                  {anomaly ? 'Flagged' : clockedIn ? 'Timed in' : location.clock_out ? 'Timed out' : 'Not timed in'}
                </span>
                <small>{formatTime(location.updated_at)}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SupervisorLiveMap;
