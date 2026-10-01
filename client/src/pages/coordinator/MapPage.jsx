import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createCompany, getCompanies, updateCompanyLocation } from '../../api/deployments';
import { getLiveLocations } from '../../api/dtr';
import 'leaflet/dist/leaflet.css';
import VectorIcon from '../../components/common/VectorIcon';
import { mapIconSvg } from '../../utils/mapIcons';
import useTransientToast from '../../hooks/useTransientToast';
import AddCompanyModal from './AddCompanyModal';
import MapControls from '../../components/common/MapControls';
import SkeletonPage from '../../components/common/Skeleton';
import { createMapLayers, showMapLayer } from '../../utils/mapLayers';

const STATUS = {
  timed_in: { label: 'Timed in', color: '#16a34a', badge: 'badge-success' },
  timed_out: { label: 'Timed out', color: '#2563eb', badge: 'badge-primary' },
  not_timed_in: { label: 'Not timed in', color: '#64748b', badge: 'badge-gray' },
};
const FLAG_COLOR = '#dc2626';
const WORKSITE_COLOR = '#7c3aed';
const WORKSITE_MUTED = '#94a3b8';
const RADIUS_PRESETS = [50, 100, 200, 300];

const statusKey = (loc) => {
  if (STATUS[loc.attendance_status]) return loc.attendance_status;
  if (loc.clock_out) return 'timed_out';
  if (loc.clock_in) return 'timed_in';
  return 'not_timed_in';
};

const timeAgo = (ts) => {
  if (!ts) return '—';
  const mins = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const syncStudentMarkers = (map, L, markers, locations) => {
  const active = new Set();
  locations.forEach(loc => {
    const latitude = Number(loc.latitude);
    const longitude = Number(loc.longitude);
    if (loc.latitude == null || loc.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const key = String(loc.student_id);
    active.add(key);
    const status = STATUS[statusKey(loc)];
    const color = loc.anomaly_flag ? FLAG_COLOR : status.color;
    const icon = L.divIcon({
      html: `<div class="live-map-marker" style="--marker-color:${color}">${mapIconSvg('user', 20)}</div>`,
      className: 'live-map-marker-wrap', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20],
    });
    const popup = `<b>${esc(loc.first_name)} ${esc(loc.last_name)}</b><br><span style="color:${color};font-weight:600">${loc.anomaly_flag ? 'Flagged' : status.label}</span><br>${esc(loc.company_name)}<br><small>${timeAgo(loc.updated_at)}</small>`;
    const existing = markers[key];
    if (existing) {
      existing.setLatLng([latitude, longitude]).setPopupContent(popup);
      if (existing._smartrackColor !== color) existing.setIcon(icon);
      existing._smartrackColor = color;
    } else {
      const marker = L.marker([latitude, longitude], { icon }).addTo(map).bindPopup(popup);
      marker._smartrackColor = color;
      markers[key] = marker;
    }
  });
  Object.entries(markers).forEach(([key, marker]) => {
    if (!active.has(key)) {
      map.removeLayer(marker);
      delete markers[key];
    }
  });
};

const MapPage = () => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const leafletRef = useRef(null);
  const baseLayersRef = useRef(null);
  const mapStyleRef = useRef('satellite');
  const markersRef = useRef({});
  const circlesRef = useRef({});
  const editingPerimeterRef = useRef(false);
  const companiesRef = useRef([]);
  const liveLocationsRef = useRef([]);
  const selectedCompanyRef = useRef(null);
  const [companies, setCompanies] = useState([]);
  const [liveLocations, setLiveLocations] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [editingPerimeter, setEditingPerimeter] = useState(false);
  const [newRadius, setNewRadius] = useState(50);
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast, toastType, showToast } = useTransientToast(6000);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [mapStyle, setMapStyle] = useState('satellite');
  const [activeTab, setActiveTab] = useState('map');
  const [filter, setFilter] = useState('all');
  const [studentQuery, setStudentQuery] = useState('');
  const [companyForm, setCompanyForm] = useState({
    name: '', address: '', latitude: '', longitude: '', geoRadiusMeters: 50,
  });
  const [companyError, setCompanyError] = useState('');
  const intervalRef = useRef(null);

  useEffect(() => { companiesRef.current = companies; }, [companies]);
  useEffect(() => { liveLocationsRef.current = liveLocations; }, [liveLocations]);
  useEffect(() => { selectedCompanyRef.current = selectedCompany; }, [selectedCompany]);

  const fetchLiveLocations = useCallback(async () => {
    try {
      const res = await getLiveLocations();
      setLiveLocations(res.data.locations);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load live locations:', error);
      throw error;
    }
  }, []);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await getCompanies();
      const worksites = res.data.companies.flatMap(company => (company.locations || []).map(location => ({
        ...location,
        company_id: company.id,
        company_name: company.name,
        display_name: `${company.name} · ${location.name}`,
      })));
      setCompanies(worksites);
      setSelectedCompany(current => {
        const next = worksites.find(location => location.id === current?.id)
          || worksites[0]
          || null;
        if (!current && next) {
          setNewRadius(next.geo_radius_meters || 50);
          setNewLat(next.latitude || '');
          setNewLng(next.longitude || '');
        }
        return next;
      });
    } catch (error) {
      console.error('Failed to load companies:', error);
      throw error;
    }
  }, []);

  const refreshDashboard = async ({ announce = true } = {}) => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchCompanies(), fetchLiveLocations()]);
      setMapVersion(version => version + 1);
      if (announce) showToast('Map refreshed.');
    } catch {
      if (announce) showToast('Refresh failed. Check the server connection and try again.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateCompany = async event => {
    event.preventDefault();
    setCompanyError('');
    setSaving(true);
    try {
      await createCompany(companyForm);
      setShowCompanyModal(false);
      setCompanyForm({ name: '', address: '', latitude: '', longitude: '', geoRadiusMeters: 50 });
      await refreshDashboard({ announce: false });
      showToast('Company and main worksite added.');
    } catch (error) {
      setCompanyError(error.response?.data?.message || 'Company could not be added.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    editingPerimeterRef.current = editingPerimeter;
  }, [editingPerimeter]);

  useEffect(() => {
    const init = async () => {
      try {
        await Promise.all([fetchCompanies(), fetchLiveLocations()]);
      } catch {
        showToast('Map data could not be loaded.', 'error');
      } finally {
        setLoading(false);
      }
    };
    init();

    intervalRef.current = setInterval(() => fetchLiveLocations().catch(() => {}), 15000);
    return () => clearInterval(intervalRef.current);
  }, [fetchCompanies, fetchLiveLocations, showToast]);

  // Keep Leaflet synchronized with responsive dashboard layout changes.
  useEffect(() => {
    if (!mapRef.current) return undefined;
    const invalidate = () => mapInstanceRef.current?.invalidateSize({ pan: false });
    const observer = new ResizeObserver(invalidate);
    observer.observe(mapRef.current);
    window.addEventListener('resize', invalidate);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', invalidate);
    };
  }, []);

  useEffect(() => {
    if (loading || !mapRef.current) return;

    import('leaflet').then(L => {
      if (mapInstanceRef.current) return;
      delete L.default.Icon.Default.prototype._getIconUrl;
      L.default.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const defaultLat = selectedCompanyRef.current?.latitude ? parseFloat(selectedCompanyRef.current.latitude) : 10.3157;
      const defaultLng = selectedCompanyRef.current?.longitude ? parseFloat(selectedCompanyRef.current.longitude) : 123.8854;

      const map = L.default.map(mapRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([defaultLat, defaultLng], 16);

      mapInstanceRef.current = map;
      leafletRef.current = L.default;
      markersRef.current = {};
      circlesRef.current = {};

      baseLayersRef.current = createMapLayers(L.default, {
        coarsePointer: window.matchMedia?.('(pointer: coarse)').matches,
      });
      showMapLayer(map, baseLayersRef.current, mapStyleRef.current);

      companiesRef.current.forEach(company => {
        if (!company.latitude || !company.longitude) return;
        const isSelected = selectedCompanyRef.current?.id === company.id;
        const color = isSelected ? WORKSITE_COLOR : WORKSITE_MUTED;

        const officeIcon = L.default.divIcon({
          html: `<div class="live-map-marker" style="--marker-color:${color}">${mapIconSvg('building', 19)}</div>`,
          className: 'live-map-marker-wrap', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20],
        });

        L.default.marker(
          [parseFloat(company.latitude), parseFloat(company.longitude)],
          { icon: officeIcon }
        ).addTo(map).bindPopup(`<b>${esc(company.display_name || company.name)}</b><br><small>${company.geo_radius_meters || 50} m radius</small>`);

        circlesRef.current[company.id] = L.default.circle(
          [parseFloat(company.latitude), parseFloat(company.longitude)],
          {
            radius: company.geo_radius_meters || 50,
            color, fillColor: color, fillOpacity: 0.08, weight: 2, dashArray: '6',
          }
        ).addTo(map);
      });

      syncStudentMarkers(map, L.default, markersRef.current, liveLocationsRef.current);

      map.on('click', (e) => {
        if (!editingPerimeterRef.current) return;
        setNewLat(e.latlng.lat.toFixed(8));
        setNewLng(e.latlng.lng.toFixed(8));
        showToast('Location set. Click Save to confirm.');
      });
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      leafletRef.current = null;
      baseLayersRef.current = null;
    };
  }, [loading, mapVersion, showToast]);

  useEffect(() => {
    mapStyleRef.current = mapStyle;
    showMapLayer(mapInstanceRef.current, baseLayersRef.current, mapStyle);
  }, [mapStyle]);

  const fitLocations = () => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    const points = [
      ...companies.map(company => [Number(company.latitude), Number(company.longitude)]),
      ...liveLocations.filter(location => location.latitude != null && location.longitude != null)
        .map(location => [Number(location.latitude), Number(location.longitude)]),
    ].filter(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude));
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [46, 46], maxZoom: 17 });
  };

  // Update student markers without rebuilding the map or reloading satellite tiles.
  // NOTE: these memos must stay above the effects — effect dependency arrays
  // are read during render, so anything they reference has to exist first.
  const visibleLocations = useMemo(
    () => (filter === 'all' ? liveLocations : liveLocations.filter(loc => statusKey(loc) === filter)),
    [filter, liveLocations]
  );

  const listedLocations = useMemo(() => {
    const query = studentQuery.trim().toLowerCase();
    if (!query) return visibleLocations;
    return visibleLocations.filter(loc =>
      `${loc.first_name || ''} ${loc.last_name || ''} ${loc.company_name || ''}`.toLowerCase().includes(query));
  }, [studentQuery, visibleLocations]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    syncStudentMarkers(map, L, markersRef.current, visibleLocations);
  }, [visibleLocations]);

  useEffect(() => {
    if (activeTab !== 'map') return;
    const timer = window.setTimeout(() => mapInstanceRef.current?.invalidateSize({ pan: false }), 120);
    return () => window.clearTimeout(timer);
  }, [activeTab]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedCompany?.latitude || !selectedCompany?.longitude) return;
    map.setView([Number(selectedCompany.latitude), Number(selectedCompany.longitude)], map.getZoom(), { animate: false });
    Object.entries(circlesRef.current).forEach(([companyId, circle]) => {
      const color = String(companyId) === String(selectedCompany.id) ? WORKSITE_COLOR : WORKSITE_MUTED;
      circle.setStyle({ color, fillColor: color });
    });
  }, [selectedCompany]);

  const selectWorksite = (id) => {
    const next = companies.find(company => String(company.id) === String(id));
    if (!next) return;
    setSelectedCompany(next);
    setNewRadius(next.geo_radius_meters || 50);
    setNewLat(next.latitude || '');
    setNewLng(next.longitude || '');
    setEditingPerimeter(false);
  };

  const handleSavePerimeter = async () => {
    if (!selectedCompany) return;
    setSaving(true);
    try {
      await updateCompanyLocation(selectedCompany.id, {
        name: selectedCompany.name,
        address: selectedCompany.address,
        latitude: newLat,
        longitude: newLng,
        geoRadiusMeters: newRadius,
        attendanceMode: selectedCompany.attendance_mode,
        isPrimary: selectedCompany.is_primary,
      });
      showToast('Perimeter updated.');
      setEditingPerimeter(false);
      await fetchCompanies();
    } catch { showToast('Failed to save.', 'error'); }
    finally { setSaving(false); }
  };

  const counts = useMemo(() => liveLocations.reduce((result, loc) => {
    result[statusKey(loc)] += 1;
    if (loc.anomaly_flag) result.flagged += 1;
    return result;
  }, { timed_in: 0, timed_out: 0, not_timed_in: 0, flagged: 0 }), [liveLocations]);

  const companyGroups = useMemo(() => {
    const groups = new Map();
    companies.forEach(site => {
      const key = site.company_id || site.company_name || 'company';
      if (!groups.has(key)) groups.set(key, { id: key, name: site.company_name || 'Company', sites: [] });
      groups.get(key).sites.push(site);
    });
    return [...groups.values()];
  }, [companies]);

  const studentsByCompany = useMemo(() => {
    const tally = {};
    liveLocations.forEach(loc => {
      const key = loc.company_name || 'No company';
      tally[key] = (tally[key] || 0) + 1;
    });
    return tally;
  }, [liveLocations]);

  const focusStudent = (loc) => {
    const map = mapInstanceRef.current;
    if (!map || loc.latitude == null || loc.longitude == null) return;
    if (filter !== 'all' && statusKey(loc) !== filter) setFilter('all');
    setActiveTab('map');
    window.setTimeout(() => {
      map.flyTo([Number(loc.latitude), Number(loc.longitude)], Math.max(map.getZoom(), 16), { duration: 0.6 });
      window.setTimeout(() => markersRef.current[String(loc.student_id)]?.openPopup(), 650);
    }, 80);
  };

  const focusWorksite = (site) => {
    const map = mapInstanceRef.current;
    if (!map || site.latitude == null || site.longitude == null) return;
    setActiveTab('map');
    window.setTimeout(() => {
      map.flyTo([Number(site.latitude), Number(site.longitude)], 17, { duration: 0.6 });
    }, 80);
  };

  const adjustPerimeter = (site) => {
    selectWorksite(site.id);
    setEditingPerimeter(true);
    setActiveTab('map');
  };

  if (loading) return (
    <SkeletonPage variant="map" label="Loading live map" />
  );

  return (
    <div className="svm">
      <section className="svm-hero" aria-label="Live map summary">
        <div className="svm-hero-glow" aria-hidden="true" />
        <div className="svm-hero-top">
          <div>
            <p className="svm-eyebrow"><VectorIcon name="map" size={12} /> Live map</p>
            <h1 className="svm-title">Where&apos;s everyone?</h1>
            <p className="svm-sub">
              {liveLocations.length === 0
                ? 'No deployed students yet'
                : `${counts.timed_in} in · ${liveLocations.length} deployed${lastUpdated ? ` · ${timeAgo(lastUpdated)}` : ''}`}
            </p>
          </div>
          <button type="button" className="svm-refresh" onClick={() => refreshDashboard()} disabled={refreshing} aria-label="Refresh map">
            <VectorIcon name="refresh" size={16} className={refreshing ? 'is-spin' : ''} />
          </button>
        </div>
        <ul className="svm-stats" aria-label="Attendance summary">
          <li className="is-in"><strong>{counts.timed_in}</strong><span>In</span></li>
          <li className="is-out"><strong>{counts.timed_out}</strong><span>Out</span></li>
          <li className="is-away"><strong>{counts.not_timed_in}</strong><span>Away</span></li>
          <li className="is-place"><strong>{companies.length}</strong><span>Sites</span></li>
        </ul>
      </section>

      <div className="svm-tabs" role="tablist" aria-label="Map sections">
        {[
          { v: 'map', label: 'Map' },
          { v: 'students', label: `Students · ${liveLocations.length}` },
          { v: 'companies', label: `Companies · ${companyGroups.length}` },
        ].map(tab => (
          <button key={tab.v} role="tab" aria-selected={activeTab === tab.v} type="button"
            className={`svm-tab${activeTab === tab.v ? ' is-on' : ''}`} onClick={() => setActiveTab(tab.v)}>{tab.label}</button>
        ))}
      </div>

      <div className="svm-pills" role="group" aria-label="Filter by status">
        <button type="button" className={`svm-pill${filter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>All</button>
        {Object.entries(STATUS).map(([key, status]) => (
          <button key={key} type="button" className={`svm-pill${filter === key ? ' is-on' : ''}`}
            style={{ '--dot': status.color }} onClick={() => setFilter(filter === key ? 'all' : key)}>
            <i />{status.label}
          </button>
        ))}
      </div>

      <div className="svm-mapwrap" hidden={activeTab !== 'map'}>
        <div className="dashboard-map-shell svm-shell">
          <div ref={mapRef} className="dashboard-map-canvas" aria-label="Coordinator live attendance map" />
          <div className="live-map-indicator"><i /> Live</div>
          <MapControls mapStyle={mapStyle} onStyleChange={setMapStyle} onFit={fitLocations} privacyLabel={null} />
          {editingPerimeter && selectedCompany && (
            <div className="svm-editbar" role="group" aria-label="Edit worksite perimeter">
              <div className="svm-editbar-top">
                <strong>{selectedCompany.display_name || selectedCompany.name}</strong>
                <span>{newRadius} m</span>
              </div>
              <input
                type="range" min="20" max="500" step="10" value={newRadius}
                onChange={event => setNewRadius(parseInt(event.target.value, 10))}
                className="svm-range" aria-label="Geofence radius in meters"
              />
              <div className="svm-editbar-row">
                {RADIUS_PRESETS.map(value => (
                  <button key={value} type="button" className={newRadius === value ? 'is-active' : ''}
                    onClick={() => setNewRadius(value)}>{value}</button>
                ))}
              </div>
              <p className="svm-pinmeta">Tap the map to move the pin · {newLat && newLng ? `${Number(newLat).toFixed(5)}, ${Number(newLng).toFixed(5)}` : 'pin not placed'}</p>
              <div className="svm-editbar-actions">
                <button type="button" className="svm-go is-ghost" onClick={() => setEditingPerimeter(false)} disabled={saving}>Cancel</button>
                <button type="button" className="svm-go" onClick={handleSavePerimeter} disabled={saving}>
                  {saving ? 'Saving…' : 'Save perimeter'}
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="svm-hint">
          <i style={{ background: STATUS.timed_in.color }} /> In
          <i style={{ background: STATUS.timed_out.color }} /> Out
          <i style={{ background: STATUS.not_timed_in.color }} /> Away
          <i style={{ background: WORKSITE_COLOR }} /> Worksite
          <i className="ring" /> Flagged
        </p>
        <div className="svm-quick">
          {!listedLocations.length
            ? <p className="live-map-empty">No one matches. Try another filter.</p>
            : listedLocations.slice(0, 3).map(loc => (
              <button key={loc.student_id} type="button" className="svm-quick-item" onClick={() => focusStudent(loc)}>
                <span className="svm-ava" style={{ '--ring': STATUS[statusKey(loc)].color }}>
                  {loc.first_name?.[0]}{loc.last_name?.[0]}
                </span>
                {loc.first_name} {loc.last_name}
              </button>
            ))}
          {listedLocations.length > 3 && (
            <button type="button" className="svm-quick-item is-more" onClick={() => setActiveTab('students')}>
              +{listedLocations.length - 3} more
            </button>
          )}
        </div>
      </div>

      {activeTab === 'students' && (
        <div className="svm-list" key="students">
          <label className="svm-search">
            <VectorIcon name="search" size={14} />
            <input type="search" placeholder="Search students…" value={studentQuery} onChange={event => setStudentQuery(event.target.value)} aria-label="Search students" />
            {studentQuery && <button type="button" onClick={() => setStudentQuery('')} aria-label="Clear"><VectorIcon name="x" size={14} /></button>}
          </label>
          {!liveLocations.length ? (
            <p className="live-map-empty">No deployed students.</p>
          ) : !listedLocations.length ? (
            <p className="live-map-empty">No students match.</p>
          ) : listedLocations.map(loc => {
            const status = STATUS[statusKey(loc)];
            const hasPoint = loc.latitude != null && loc.longitude != null;
            return (
              <div className="svm-row" key={loc.student_id}>
                <span className="svm-ava" style={{ '--ring': status.color }}>{loc.first_name?.[0]}{loc.last_name?.[0]}</span>
                <div className="svm-who">
                  <strong>{loc.first_name} {loc.last_name}</strong>
                  <small>{loc.company_name || 'No company'} · {hasPoint ? timeAgo(loc.updated_at) : 'No location yet'}</small>
                </div>
                <span className="svm-status" style={{ '--dot': status.color }}><i />{loc.anomaly_flag ? 'Flagged' : status.label}</span>
                <div className="svm-rowbtns">
                  <button type="button" className="svm-go" onClick={() => focusStudent(loc)} disabled={!hasPoint}>Locate</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'companies' && (
        <div className="svm-list" key="companies">
          <button type="button" className="svm-add-company" onClick={() => { setCompanyError(''); setShowCompanyModal(true); }}>
            <VectorIcon name="plus" size={15} /> Add company
          </button>
          {!companyGroups.length && <p className="live-map-empty">No companies yet.</p>}
          {companyGroups.map(group => (
            <section key={group.id} className="svm-company">
              <div className="svm-company-head">
                <div>
                  <strong>{group.name}</strong>
                  <small>{group.sites.length} {group.sites.length === 1 ? 'worksite' : 'worksites'} · {studentsByCompany[group.name] || 0} students</small>
                </div>
              </div>
              {group.sites.map(site => (
                <div className="svm-place" key={site.id}>
                  <div className="svm-place-head">
                    <span className="svm-place-icon"><VectorIcon name="building" size={15} /></span>
                    <div className="svm-who">
                      <strong>{site.name}</strong>
                      <small>{site.geo_radius_meters || 50} m radius</small>
                    </div>
                    <div className="svm-iconbtns">
                      <button type="button" onClick={() => focusWorksite(site)} disabled={site.latitude == null} aria-label={`Show ${site.name} on map`}>
                        <VectorIcon name="map" size={15} />
                      </button>
                      <button type="button" onClick={() => adjustPerimeter(site)} aria-label={`Edit ${site.name} perimeter`}>
                        <VectorIcon name="pencil" size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {showCompanyModal && (
        <AddCompanyModal
          error={companyError}
          form={companyForm}
          onChange={setCompanyForm}
          onClose={() => setShowCompanyModal(false)}
          onError={setCompanyError}
          onSubmit={handleCreateCompany}
          saving={saving}
        />
      )}

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default MapPage;
