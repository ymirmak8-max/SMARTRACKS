import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { mapIconSvg } from '../../utils/mapIcons';
import { createMapLayers, showMapLayer } from '../../utils/mapLayers';
import MapControls from './MapControls';

const validCoordinate = (value, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

const markerIcon = (L, name, color) => L.divIcon({
  html: `<div class="live-map-marker" style="--marker-color:${color}">${mapIconSvg(name, 18)}</div>`,
  className: 'live-map-marker-wrap',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});

const LocationMap = ({ studentLat, studentLng, accuracy, officeLat, officeLng, radiusMeters, isInside }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const studentMarkerRef = useRef(null);
  const officeMarkerRef = useRef(null);
  const perimeterRef = useRef(null);
  const accuracyCircleRef = useRef(null);
  const baseLayersRef = useRef(null);
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [mapStyle, setMapStyle] = useState('street');

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let observer;
    let resizeFrame = 0;

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
      }).setView([10.3157, 123.8854], 16);

      mapRef.current = map;
      leafletRef.current = L;

      baseLayersRef.current = createMapLayers(L, { coarsePointer });
      showMapLayer(map, baseLayersRef.current, 'street');

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
    }).catch(error => console.error('Failed to initialize student location map:', error));

    return () => {
      disposed = true;
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      studentMarkerRef.current = null;
      officeMarkerRef.current = null;
      perimeterRef.current = null;
      accuracyCircleRef.current = null;
      baseLayersRef.current = null;
      leafletRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    showMapLayer(mapRef.current, baseLayersRef.current, mapStyle);
  }, [mapStyle]);

  const fitLocations = () => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const studentLatitude = validCoordinate(studentLat, -90, 90);
    const studentLongitude = validCoordinate(studentLng, -180, 180);
    const officeLatitude = validCoordinate(officeLat, -90, 90);
    const officeLongitude = validCoordinate(officeLng, -180, 180);
    if (!map || !L || studentLatitude === null || studentLongitude === null) return;
    if (officeLatitude !== null && officeLongitude !== null) {
      map.fitBounds(L.latLngBounds([studentLatitude, studentLongitude], [officeLatitude, officeLongitude]), {
        padding: [36, 36], maxZoom: 17,
      });
    } else map.setView([studentLatitude, studentLongitude], 16);
  };

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const latitude = validCoordinate(studentLat, -90, 90);
    const longitude = validCoordinate(studentLng, -180, 180);
    if (!ready || !map || !L || latitude === null || longitude === null) return;

    const studentPosition = [latitude, longitude];
    const statusColor = isInside ? '#16a34a' : '#dc2626';
    const studentPopup = `<b>Your Location</b><br>${isInside ? 'Inside perimeter' : 'Outside perimeter'}`;

    if (!studentMarkerRef.current) {
      studentMarkerRef.current = L.marker(studentPosition, {
        icon: markerIcon(L, 'user', statusColor),
        draggable: false,
        keyboard: false,
        autoPan: false,
      }).addTo(map).bindPopup(studentPopup);
      studentMarkerRef.current._smartrackColor = statusColor;
    } else {
      studentMarkerRef.current.setLatLng(studentPosition).setPopupContent(studentPopup);
      if (studentMarkerRef.current._smartrackColor !== statusColor) {
        studentMarkerRef.current.setIcon(markerIcon(L, 'user', statusColor));
        studentMarkerRef.current._smartrackColor = statusColor;
      }
    }

    const accuracyRadius = Number(accuracy);
    if (Number.isFinite(accuracyRadius) && accuracyRadius > 0) {
      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = L.circle(studentPosition, {
          radius: accuracyRadius,
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.08,
          opacity: 0.45,
          weight: 1,
          interactive: false,
        }).addTo(map);
      } else {
        accuracyCircleRef.current.setLatLng(studentPosition).setRadius(accuracyRadius);
      }
    }

    const officeLatitude = validCoordinate(officeLat, -90, 90);
    const officeLongitude = validCoordinate(officeLng, -180, 180);
    if (officeLatitude !== null && officeLongitude !== null) {
      const officePosition = [officeLatitude, officeLongitude];
      if (!officeMarkerRef.current) {
        officeMarkerRef.current = L.marker(officePosition, {
          icon: markerIcon(L, 'building', '#2563eb'),
        }).addTo(map).bindPopup('<b>Office Location</b>');
      } else {
        officeMarkerRef.current.setLatLng(officePosition);
      }

      const perimeterRadius = Number(radiusMeters) || 50;
      if (!perimeterRef.current) {
        perimeterRef.current = L.circle(officePosition, {
          radius: perimeterRadius,
          color: statusColor,
          fillColor: statusColor,
          fillOpacity: 0.08,
          weight: 2,
          dashArray: '6',
        }).addTo(map);
        perimeterRef.current._smartrackColor = statusColor;
      } else {
        perimeterRef.current.setLatLng(officePosition).setRadius(perimeterRadius);
        if (perimeterRef.current._smartrackColor !== statusColor) {
          perimeterRef.current.setStyle({ color: statusColor, fillColor: statusColor });
          perimeterRef.current._smartrackColor = statusColor;
        }
      }

      if (!fittedRef.current) {
        map.fitBounds(L.latLngBounds(studentPosition, officePosition), {
          padding: [36, 36],
          maxZoom: 17,
          animate: false,
        });
        fittedRef.current = true;
      }
    } else if (!fittedRef.current) {
      map.setView(studentPosition, 16, { animate: false });
      fittedRef.current = true;
    }
  }, [studentLat, studentLng, accuracy, officeLat, officeLng, radiusMeters, isInside, ready]);

  return (
    <div className="location-map-shell">
      <div ref={containerRef} className="location-map-canvas" aria-label="Your live location map" />
      <MapControls mapStyle={mapStyle} onStyleChange={setMapStyle} onFit={fitLocations}
        privacyLabel="Location recorded automatically" />
    </div>
  );
};

export default LocationMap;
