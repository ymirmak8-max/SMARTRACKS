import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { getLiveLocations } from '../../api/dtr';
import { createWorkplace, getWorkplaces, removeWorkplace, updateWorkplace } from '../../api/supervisor';
import { mapIconSvg } from '../../utils/mapIcons';
import VectorIcon from './VectorIcon';
import MapControls from './MapControls';
import ConfirmDialog from './ConfirmDialog';
import { createMapLayers, showMapLayer } from '../../utils/mapLayers';

const MIN_RADIUS = 10;
const MAX_RADIUS = 5000;
const SLIDER_MAX = 1000;

const STATUS = {
  timed_in: { label: 'Timed in', color: '#16a34a', tone: 'success' },
  timed_out: { label: 'Timed out', color: '#2563eb', tone: 'primary' },
  not_timed_in: { label: 'Not timed in', color: '#64748b', tone: 'gray' },
};
const WORKPLACE_COLOR = '#7c3aed';
const DRAFT_COLOR = '#ea580c';
const FLAG_COLOR = '#dc2626';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const validCoordinate = (value, min, max) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};

const pointOf = (item) => {
  const latitude = validCoordinate(item?.latitude, -90, 90);
  const longitude = validCoordinate(item?.longitude, -180, 180);
  return latitude === null || longitude === null ? null : [latitude, longitude];
};

const relativeTime = (timestamp) => {
  if (!timestamp) return 'No location yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

const clockTime = (value) => (value
  ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
  : '—');

const statusOf = (location) => {
  if (STATUS[location.attendance_status]) return location.attendance_status;
  if (location.clock_out) return 'timed_out';
  if (location.clock_in) return 'timed_in';
  return 'not_timed_in';
};

const initialsOf = (location) => `${location.first_name?.[0] || ''}${location.last_name?.[0] || ''}`.toUpperCase() || '?';

const studentIcon = (L, location, status, flagged) => L.divIcon({
  html: `<div class="live-map-marker supervisor-map-student${flagged ? ' is-flagged' : ''}" style="--marker-color:${STATUS[status].color}">${escapeHtml(initialsOf(location))}</div>`,
  className: 'live-map-marker-wrap',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});

const workplaceIcon = (L, color, primary) => L.divIcon({
  html: `<div class="live-map-marker supervisor-map-workplace${primary ? ' is-primary' : ''}" style="--marker-color:${color}">${mapIconSvg('building', 17)}</div>`,
  className: 'live-map-marker-wrap',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

const clampRadius = (value) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return MIN_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, number));
};

const emptyDraft = (company) => {
  const primary = company?.locations?.find((location) => location.is_primary);
  return {
    id: null,
    companyId: company?.id || '',
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    geoRadiusMeters: 50,
    attendanceMode: 'fixed',
    assignToTrainees: true,
    initialAssign: true,
    anchor: pointOf(primary),
  };
};

const SupervisorLiveMap = ({ onOpenActivity, onToast = () => {} }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const studentLayersRef = useRef(new Map());
  const workplaceLayersRef = useRef(new Map());
  const baseLayersRef = useRef(null);
  const fittedRef = useRef(false);
  const pickModeRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const [locations, setLocations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [workplaceError, setWorkplaceError] = useState('');
  const [mapStyle, setMapStyle] = useState('satellite');
  const [filter, setFilter] = useState('all');
  const [radiusDrafts, setRadiusDrafts] = useState({});
  const [savingId, setSavingId] = useState('');
  const [draft, setDraft] = useState(null);
  const [pickMode, setPickMode] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [activeTab, setActiveTab] = useState('map');
  const [studentQuery, setStudentQuery] = useState('');

  useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);

  const loadLocations = useCallback(async () => {
    const requestId = ++requestSequenceRef.current;
    try {
      const response = await getLiveLocations();
      if (requestId !== requestSequenceRef.current) return;
      setLocations(Array.isArray(response.data.locations) ? response.data.locations : []);
      setError('');
    } catch (requestError) {
      if (requestId !== requestSequenceRef.current) return;
      setError(requestError.response?.data?.message || 'Student locations could not be loaded.');
    }
  }, []);

  const loadWorkplaces = useCallback(async () => {
    try {
      const response = await getWorkplaces();
      setCompanies(Array.isArray(response.data.companies) ? response.data.companies : []);
      setWorkplaceError('');
    } catch (requestError) {
      setWorkplaceError(requestError.response?.data?.message || 'Company workplaces could not be loaded.');
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadLocations(), loadWorkplaces()]);
    setRefreshing(false);
  }, [loadLocations, loadWorkplaces]);

  useEffect(() => {
    loadLocations();
    loadWorkplaces();
    const interval = window.setInterval(loadLocations, 15000);
    return () => window.clearInterval(interval);
  }, [loadLocations, loadWorkplaces]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let observer;
    const studentLayers = studentLayersRef.current;
    const workplaceLayers = workplaceLayersRef.current;

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
      }).setView([10.3157, 123.8854], 13);
      mapRef.current = map;
      leafletRef.current = L;

      baseLayersRef.current = createMapLayers(L, { coarsePointer });
      showMapLayer(map, baseLayersRef.current, 'satellite');

      map.on('click', (event) => {
        if (!pickModeRef.current) return;
        const { lat, lng } = event.latlng;
        setDraft((current) => (current ? { ...current, latitude: lat.toFixed(7), longitude: lng.toFixed(7) } : current));
        setPickMode(false);
      });

      let resizeFrame = 0;
      let previousWidth = 0;
      let previousHeight = 0;
      observer = new ResizeObserver((entries) => {
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
    }).catch(() => {
      if (!disposed) setError('The map could not be initialized.');
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      studentLayers.clear();
      workplaceLayers.clear();
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
    if (activeTab !== 'map') return;
    const t = window.setTimeout(() => mapRef.current?.invalidateSize({ pan: false }), 120);
    return () => window.clearTimeout(t);
  }, [activeTab]);

  const workplaces = useMemo(() => companies.flatMap((company) =>
    (company.locations || []).map((location) => ({ ...location, company_id: company.id, company_name: company.name }))
  ), [companies]);

  const counts = useMemo(() => locations.reduce((result, location) => {
    result[statusOf(location)] += 1;
    return result;
  }, { timed_in: 0, timed_out: 0, not_timed_in: 0 }), [locations]);

  const visibleLocations = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return locations.filter((location) => {
      if (filter !== 'all' && statusOf(location) !== filter) return false;
      if (q && !`${location.first_name} ${location.last_name} ${location.company_name || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filter, locations, studentQuery]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !L) return;
    const layers = workplaceLayersRef.current;
    const active = new Set();

    const upsert = (key, point, radius, color, primary, popup) => {
      const markerKey = `marker:${key}`;
      const circleKey = `circle:${key}`;
      active.add(markerKey);
      active.add(circleKey);
      const marker = layers.get(markerKey);
      const signature = `${color}:${primary}`;
      if (marker) {
        marker.setLatLng(point);
        if (marker._smartrackSignature !== signature) {
          marker.setIcon(workplaceIcon(L, color, primary));
          marker._smartrackSignature = signature;
        }
        marker.setPopupContent(popup);
      } else {
        const created = L.marker(point, { icon: workplaceIcon(L, color, primary), zIndexOffset: -200 }).addTo(map).bindPopup(popup);
        created._smartrackSignature = signature;
        layers.set(markerKey, created);
      }
      const circle = layers.get(circleKey);
      if (circle) {
        circle.setLatLng(point);
        circle.setRadius(radius);
        circle.setStyle({ color, fillColor: color });
      } else {
        layers.set(circleKey, L.circle(point, {
          radius, color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: primary ? null : '6', interactive: false,
        }).addTo(map));
      }
    };

    workplaces.forEach((workplace) => {
      const point = pointOf(workplace);
      if (!point || (draft?.id && draft.id === workplace.id)) return;
      const radius = clampRadius(radiusDrafts[workplace.id] ?? workplace.geo_radius_meters);
      const editing = radiusDrafts[workplace.id] !== undefined && Number(radiusDrafts[workplace.id]) !== Number(workplace.geo_radius_meters);
      upsert(`wp:${workplace.id}`, point, radius, editing ? DRAFT_COLOR : WORKPLACE_COLOR, workplace.is_primary, `
        <b>${escapeHtml(workplace.name)}</b> ${workplace.is_primary ? '(Main)' : '(Sub-workplace)'}<br>
        <span>${escapeHtml(workplace.company_name)}</span><br>
        <span>Geofence: ${radius} m${editing ? ' (unsaved)' : ''}</span>
      `);
    });

    const draftPoint = draft ? pointOf(draft) : null;
    if (draftPoint) {
      upsert('draft', draftPoint, clampRadius(draft.geoRadiusMeters), DRAFT_COLOR, false,
        `<b>${escapeHtml(draft.name || 'New sub-workplace')}</b><br><span>Geofence: ${clampRadius(draft.geoRadiusMeters)} m (not saved)</span>`);
    }

    layers.forEach((layer, key) => {
      if (!active.has(key)) {
        map.removeLayer(layer);
        layers.delete(key);
      }
    });
  }, [draft, radiusDrafts, ready, workplaces]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !L) return;
    const layers = studentLayersRef.current;
    const active = new Set();

    visibleLocations.forEach((location) => {
      const point = pointOf(location);
      if (!point) return;
      const key = location.student_id;
      const status = statusOf(location);
      const flagged = Boolean(location.anomaly_flag);
      const popup = `
        <b>${escapeHtml(location.first_name)} ${escapeHtml(location.last_name)}</b><br>
        <span style="color:${STATUS[status].color};font-weight:700">${STATUS[status].label}</span><br>
        <span>Time in: ${clockTime(location.clock_in)} · Time out: ${clockTime(location.clock_out)}</span>
        ${location.total_hours != null ? `<br><span>Hours today: ${Number(location.total_hours).toFixed(2)}h</span>` : ''}
        <br><span>${escapeHtml(location.company_name || '')}${location.worksite_name ? ` · ${escapeHtml(location.worksite_name)}` : ''}</span>
        ${flagged ? `<br><span style="color:${FLAG_COLOR}">${escapeHtml(String(location.anomaly_flag).replace(/^\[REJECTED\]\s*/, ''))}</span>` : ''}
        ${Number.isFinite(Number(location.accuracy)) && location.accuracy !== null ? `<br><span>GPS accuracy: ${Math.round(Number(location.accuracy))} m</span>` : ''}
        <br><span>Location updated: ${relativeTime(location.updated_at)}</span>
      `;
      active.add(key);
      const existing = layers.get(key);
      const signature = `${status}:${flagged}`;
      if (existing) {
        existing.setLatLng(point);
        if (existing._smartrackSignature !== signature) {
          existing.setIcon(studentIcon(L, location, status, flagged));
          existing._smartrackSignature = signature;
        }
        existing.setPopupContent(popup);
      } else {
        const marker = L.marker(point, { icon: studentIcon(L, location, status, flagged) }).addTo(map).bindPopup(popup);
        marker._smartrackSignature = signature;
        layers.set(key, marker);
      }
    });

    layers.forEach((layer, key) => {
      if (!active.has(key)) {
        map.removeLayer(layer);
        layers.delete(key);
      }
    });
  }, [ready, visibleLocations]);

  const allPoints = useMemo(() => [
    ...locations.map(pointOf),
    ...workplaces.map(pointOf),
  ].filter(Boolean), [locations, workplaces]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !L || fittedRef.current || !allPoints.length) return;
    map.fitBounds(L.latLngBounds(allPoints), { padding: [46, 46], maxZoom: 17, animate: false });
    fittedRef.current = true;
  }, [allPoints, ready]);

  const fitAll = () => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !allPoints.length) return;
    map.fitBounds(L.latLngBounds(allPoints), { padding: [46, 46], maxZoom: 17 });
  };

  const focusPoint = (point, zoom = 17) => {
    if (!point || !mapRef.current) return;
    mapRef.current.flyTo(point, zoom, { duration: 0.6 });
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const focusStudent = (location) => {
    const point = pointOf(location);
    if (!point) return;
    if (filter !== 'all' && statusOf(location) !== filter) setFilter('all');
    setActiveTab('map');
    window.setTimeout(() => focusPoint(point), 80);
    window.setTimeout(() => studentLayersRef.current.get(location.student_id)?.openPopup(), 700);
  };

  const saveRadius = async (workplace) => {
    const radius = clampRadius(radiusDrafts[workplace.id]);
    setSavingId(workplace.id);
    try {
      const response = await updateWorkplace(workplace.id, { geoRadiusMeters: radius });
      onToast(response.data.message || 'Geofence updated.');
      setRadiusDrafts((current) => {
        const next = { ...current };
        delete next[workplace.id];
        return next;
      });
      await Promise.all([loadWorkplaces(), loadLocations()]);
    } catch (requestError) {
      onToast(requestError.response?.data?.message || 'Unable to save the geofence.', 'error');
    } finally { setSavingId(''); }
  };

  const openNewWorkplace = (company) => {
    const next = emptyDraft(company);
    setDraft(next);
    setPickMode(true);
    if (next.anchor) focusPoint(next.anchor, 17);
  };

  const openEditWorkplace = (workplace) => {
    setDraft({
      id: workplace.id,
      companyId: workplace.company_id,
      name: workplace.name || '',
      address: workplace.address || '',
      latitude: workplace.latitude ?? '',
      longitude: workplace.longitude ?? '',
      geoRadiusMeters: Number(workplace.geo_radius_meters) || 50,
      attendanceMode: workplace.attendance_mode || 'fixed',
      assignToTrainees: Number(workplace.my_trainee_count) > 0,
      initialAssign: Number(workplace.my_trainee_count) > 0,
      anchor: pointOf(workplace),
    });
    setPickMode(false);
    focusPoint(pointOf(workplace), 17);
  };

  const cancelDraft = () => {
    setDraft(null);
    setPickMode(false);
  };

  const applyCurrentLocation = () => {
    if (!navigator.geolocation) {
      onToast('This device cannot share its location.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = [position.coords.latitude, position.coords.longitude];
        setDraft((current) => (current ? { ...current, latitude: point[0].toFixed(7), longitude: point[1].toFixed(7) } : current));
        setPickMode(false);
        focusPoint(point, 17);
      },
      () => onToast('Location permission was denied or unavailable.', 'error'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    if (!draft || savingId) return;
    if (!draft.name.trim()) { onToast('Enter a name for the sub-workplace.', 'error'); return; }
    if (draft.attendanceMode === 'fixed' && !pointOf(draft)) {
      onToast('Click the map or use your current location to place the workplace.', 'error');
      return;
    }
    const payload = {
      name: draft.name.trim(),
      address: draft.address.trim(),
      latitude: draft.latitude === '' ? null : Number(draft.latitude),
      longitude: draft.longitude === '' ? null : Number(draft.longitude),
      geoRadiusMeters: clampRadius(draft.geoRadiusMeters),
      attendanceMode: draft.attendanceMode,
    };
    setSavingId(draft.id || 'draft');
    try {
      const response = draft.id
        ? await updateWorkplace(draft.id, {
          ...payload,
          ...(draft.assignToTrainees !== draft.initialAssign ? { assignToTrainees: draft.assignToTrainees } : {}),
        })
        : await createWorkplace({ ...payload, companyId: draft.companyId, assignToTrainees: draft.assignToTrainees });
      onToast(response.data.message || 'Workplace saved.');
      setDraft(null);
      setPickMode(false);
      await loadWorkplaces();
    } catch (requestError) {
      onToast(requestError.response?.data?.message || 'Unable to save the workplace.', 'error');
    } finally { setSavingId(''); }
  };

  const confirmRemove = async () => {
    if (!removeTarget || savingId) return;
    setSavingId(removeTarget.id);
    try {
      const response = await removeWorkplace(removeTarget.id);
      onToast(response.data.message || 'Workplace removed.');
      setRemoveTarget(null);
      if (draft?.id === removeTarget.id) cancelDraft();
      await loadWorkplaces();
    } catch (requestError) {
      onToast(requestError.response?.data?.message || 'Unable to remove the workplace.', 'error');
    } finally { setSavingId(''); }
  };

  const companyNames = companies.map((company) => company.name).join(', ');
  const noLocation = locations.filter((location) => !pointOf(location)).length;

  return (
    <div className="svm">
      <section className="svm-hero" aria-label="Live map summary">
        <div className="svm-hero-glow" aria-hidden="true" />
        <div className="svm-hero-top">
          <div>
            <p className="svm-eyebrow"><VectorIcon name="map" size={12} /> Live map · {companyNames || 'My company'}</p>
            <h1 className="svm-title">Where&apos;s everyone?</h1>
            <p className="svm-sub">
              {locations.length === 0 ? 'No trainees assigned yet' : `${locations.length} trainee${locations.length === 1 ? '' : 's'}${noLocation ? ` · ${noLocation} no signal` : ''}`}
            </p>
          </div>
          <button type="button" className="svm-refresh" onClick={refreshAll} disabled={refreshing} aria-label="Refresh map">
            <VectorIcon name="refresh" size={16} className={refreshing ? 'is-spin' : ''} />
          </button>
        </div>
        <ul className="svm-stats" aria-label="Attendance summary">
          <li className="is-in"><strong>{counts.timed_in}</strong><span>In</span></li>
          <li className="is-out"><strong>{counts.timed_out}</strong><span>Out</span></li>
          <li className="is-away"><strong>{counts.not_timed_in}</strong><span>Away</span></li>
          <li className="is-place"><strong>{workplaces.length}</strong><span>Places</span></li>
        </ul>
      </section>

      {(error || workplaceError) && (
        <div className="svm-alert" role="alert"><VectorIcon name="alert" size={14} /> {error || workplaceError}</div>
      )}

      <div className="svm-tabs" role="tablist" aria-label="Map sections">
        {[
          { v: 'map', label: 'Map' },
          { v: 'students', label: `Students · ${locations.length}` },
          { v: 'places', label: `Places · ${workplaces.length}` },
        ].map((t) => (
          <button key={t.v} role="tab" aria-selected={activeTab === t.v} type="button"
            className={`svm-tab${activeTab === t.v ? ' is-on' : ''}`} onClick={() => setActiveTab(t.v)}>{t.label}</button>
        ))}
      </div>

      <div className="svm-pills" role="group" aria-label="Filter by status">
        <button type="button" className={`svm-pill${filter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>All</button>
        {Object.entries(STATUS).map(([key, value]) => (
          <button key={key} type="button" className={`svm-pill${filter === key ? ' is-on' : ''}`}
            style={{ '--dot': value.color }} onClick={() => setFilter(filter === key ? 'all' : key)}>
            <i />{value.label}
          </button>
        ))}
      </div>

      {draft && (
        <form className="card svm-draft" onSubmit={saveDraft}>
          <div className="svm-draft-head">
            <div>
              <strong>{draft.id ? 'Edit place' : 'New place'}</strong>
              <small>{draft.id ? 'Update the pin and geofence.' : 'Pin it on the map, then set the geofence.'}</small>
            </div>
            <button type="button" className="svm-go is-ghost" onClick={cancelDraft} disabled={Boolean(savingId)}>Close</button>
          </div>
          {companies.length > 1 && !draft.id && (
            <div className="form-group">
              <label htmlFor="svm-company">Company</label>
              <select id="svm-company" value={draft.companyId} onChange={(e) => setDraft({ ...draft, companyId: e.target.value })}>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="svm-name">Name *</label>
            <input id="svm-name" required maxLength={255} value={draft.name} placeholder="e.g. Warehouse"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="svm-pinrow">
            <button type="button" className={`svm-go${pickMode ? ' is-active' : ''}`} onClick={() => { setActiveTab('map'); setPickMode(!pickMode); }}>
              <VectorIcon name="target" size={14} /> {draft.latitude && draft.longitude ? 'Move pin' : 'Pin on map'}
            </button>
            <button type="button" className="svm-go is-ghost" onClick={applyCurrentLocation}>
              <VectorIcon name="map" size={14} /> Use my location
            </button>
          </div>
          {(draft.latitude !== '' || draft.longitude !== '') && (
            <p className="svm-pinmeta">{Number(draft.latitude).toFixed(5)}, {Number(draft.longitude).toFixed(5)} · {clampRadius(draft.geoRadiusMeters)} m</p>
          )}
          <div className="form-group">
            <label htmlFor="svm-radius">Geofence · <b>{clampRadius(draft.geoRadiusMeters)} m</b></label>
            <input id="svm-radius" className="svm-range" type="range" min={MIN_RADIUS} max={SLIDER_MAX} step="5"
              value={Math.min(SLIDER_MAX, clampRadius(draft.geoRadiusMeters))}
              onChange={(e) => setDraft({ ...draft, geoRadiusMeters: Number(e.target.value) })} />
          </div>
          <div className="svm-pinrow">
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="svm-mode">Rule</label>
              <select id="svm-mode" value={draft.attendanceMode} onChange={(e) => setDraft({ ...draft, attendanceMode: e.target.value })}>
                <option value="fixed">Must be inside geofence</option>
                <option value="field">Field work (anywhere)</option>
                <option value="remote">Remote (anywhere)</option>
              </select>
            </div>
            <label className="svm-check">
              <input type="checkbox" checked={draft.assignToTrainees}
                onChange={(e) => setDraft({ ...draft, assignToTrainees: e.target.checked })} />
              Trainees can time in
            </label>
          </div>
          <button type="submit" className="btn-primary" disabled={Boolean(savingId)}>
            {savingId ? 'Saving…' : draft.id ? 'Save changes' : 'Add place'}
          </button>
        </form>
      )}

      <div className="svm-mapwrap" key="map" hidden={activeTab !== 'map'}>
        <div className="dashboard-map-shell svm-shell">
            <div ref={containerRef} className={`dashboard-map-canvas${pickMode ? ' is-picking' : ''}`} aria-label="Live locations map" />
            {pickMode
              ? <button type="button" className="live-map-indicator supervisor-map-picking" onClick={() => setPickMode(false)}>
                  <VectorIcon name="target" size={12} /> Tap the map to pin · tap to cancel
                </button>
              : <div className="live-map-indicator"><i /> Live</div>}
            <MapControls mapStyle={mapStyle} onStyleChange={setMapStyle} onFit={fitAll} privacyLabel={null} />
          </div>
          <p className="svm-hint">
            <i style={{ background: STATUS.timed_in.color }} /> In
            <i style={{ background: STATUS.timed_out.color }} /> Out
            <i style={{ background: STATUS.not_timed_in.color }} /> Away
            <i style={{ background: WORKPLACE_COLOR }} /> Workplace
            <i className="ring" /> Flagged
          </p>
          <label className="svm-search">
            <VectorIcon name="search" size={15} />
            <input type="search" placeholder="Find a trainee…" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} aria-label="Find a trainee" />
            {studentQuery && <button type="button" onClick={() => setStudentQuery('')} aria-label="Clear"><VectorIcon name="x" size={14} /></button>}
          </label>
          <div className="svm-quick">
            {!visibleLocations.length
              ? <p className="live-map-empty">No one matches. Try another filter.</p>
              : visibleLocations.slice(0, 3).map((l) => (
                <button key={l.student_id} type="button" className="svm-quick-item" onClick={() => focusStudent(l)}>
                  <span className="svm-ava" style={{ '--ring': STATUS[statusOf(l)].color }}>{initialsOf(l)}</span>
                  {l.first_name} {l.last_name}
                </button>
              ))}
            {visibleLocations.length > 3 && (
              <button type="button" className="svm-quick-item is-more" onClick={() => setActiveTab('students')}>
                +{visibleLocations.length - 3} more
              </button>
            )}
          </div>
        </div>

      {activeTab === 'students' && (
        <div className="svm-list" key="students">
          <label className="svm-search">
            <VectorIcon name="search" size={15} />
            <input type="search" placeholder="Search trainees…" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} aria-label="Search trainees" />
            {studentQuery && <button type="button" onClick={() => setStudentQuery('')} aria-label="Clear"><VectorIcon name="x" size={14} /></button>}
          </label>
          {!locations.length ? (
            <p className="live-map-empty">No assigned students yet.</p>
          ) : !visibleLocations.length ? (
            <p className="live-map-empty">No students match.</p>
          ) : visibleLocations.map((location) => {
            const status = statusOf(location);
            const point = pointOf(location);
            const flagged = Boolean(location.anomaly_flag);
            return (
              <div className={`svm-row${flagged ? ' is-flag' : ''}`} key={location.student_id}>
                <span className="svm-ava" style={{ '--ring': STATUS[status].color }}>{initialsOf(location)}</span>
                <div className="svm-who">
                  <strong>{location.first_name} {location.last_name}</strong>
                  <small>In {clockTime(location.clock_in)} · Out {clockTime(location.clock_out)}</small>
                  <small>{point ? relativeTime(location.updated_at) : 'No location yet'}{flagged ? ' · Flagged' : ''}</small>
                </div>
                <span className="svm-status" style={{ '--dot': STATUS[status].color }}><i />{STATUS[status].label}</span>
                <div className="svm-rowbtns">
                  <button type="button" className="svm-go" onClick={() => focusStudent(location)} disabled={!point}>Locate</button>
                  {onOpenActivity && (
                    <button type="button" className="svm-go is-ghost" onClick={() => onOpenActivity(location.student_id)}>Activity</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'places' && (
        <div className="svm-list" key="places">
          {companies.map((company) => (
            <section key={company.id} className="svm-company">
              <div className="svm-company-head">
                <div><strong>{company.name}</strong>{company.address && <small>{company.address}</small>}</div>
                <button type="button" className="svm-add" onClick={() => openNewWorkplace(company)} disabled={Boolean(draft)}>
                  <VectorIcon name="plus" size={15} /> Add
                </button>
              </div>
              {(company.locations || []).length === 0 && <p className="live-map-empty">No workplaces yet.</p>}
              {(company.locations || []).map((location) => {
                const workplace = { ...location, company_id: company.id, company_name: company.name };
                const saved = Number(location.geo_radius_meters) || 50;
                const current = radiusDrafts[location.id] ?? saved;
                const changed = clampRadius(current) !== saved;
                const point = pointOf(location);
                return (
                  <div className="svm-place" key={location.id}>
                    <div className="svm-place-head">
                      <span className="svm-place-icon"><VectorIcon name="building" size={15} /></span>
                      <div className="svm-who">
                        <strong>{location.name} {location.is_primary && <em>Main</em>}</strong>
                        <small>{location.address || 'No address'} · {clampRadius(current)} m radius</small>
                      </div>
                      <div className="svm-iconbtns">
                        <button type="button" onClick={() => { setActiveTab('map'); window.setTimeout(() => focusPoint(point), 120); }} disabled={!point} aria-label="Center on map"><VectorIcon name="map" size={15} /></button>
                        {!location.is_primary && (
                          <>
                            <button type="button" onClick={() => openEditWorkplace(workplace)} disabled={Boolean(draft)} aria-label="Edit"><VectorIcon name="pencil" size={15} /></button>
                            <button type="button" className="is-danger" onClick={() => setRemoveTarget(workplace)} aria-label="Remove"><VectorIcon name="trash" size={15} /></button>
                          </>
                        )}
                      </div>
                    </div>
                    <input className="svm-range" type="range" min={MIN_RADIUS} max={Math.max(SLIDER_MAX, saved)} step="5"
                      value={clampRadius(current)} aria-label={`${location.name} radius`}
                      onChange={(e) => setRadiusDrafts((d) => ({ ...d, [location.id]: Number(e.target.value) }))} />
                    {changed && (
                      <div className="svm-radiusbtns">
                        <button type="button" className="svm-go is-ghost" onClick={() => setRadiusDrafts((d) => { const n = { ...d }; delete n[location.id]; return n; })}>Reset</button>
                        <button type="button" className="svm-go" onClick={() => saveRadius(workplace)} disabled={savingId === location.id}>
                          {savingId === location.id ? 'Saving…' : `Save · ${clampRadius(current)} m`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          {!companies.length && <p className="live-map-empty">{workplaceError || 'No company linked yet.'}</p>}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove this sub-workplace?"
        message={removeTarget ? `${removeTarget.name} will be removed and your trainees will no longer be able to time in there.` : ''}
        confirmLabel={savingId ? 'Removing…' : 'Remove'}
        danger
        onCancel={() => !savingId && setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
    </div>
  );
};

export default SupervisorLiveMap;
