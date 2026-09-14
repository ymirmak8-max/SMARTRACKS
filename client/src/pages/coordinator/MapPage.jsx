import { useState, useEffect, useRef, useCallback } from 'react';
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
const MapPage = () => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const leafletRef = useRef(null);
  const baseLayersRef = useRef(null);
  const mapStyleRef = useRef('street');
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
  const [onlineCount, setOnlineCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [mapStyle, setMapStyle] = useState('street');
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
      setOnlineCount(res.data.locations.length);
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
      if (announce) showToast('Map data refreshed.');
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

    // Poll every 15 seconds
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

  // Initialize map
  useEffect(() => {
    if (loading || !mapRef.current) return;

    import('leaflet').then(L => {
      if (mapInstanceRef.current) return;
      // Fix Leaflet default icon paths
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

      baseLayersRef.current = createMapLayers(L.default, {
        coarsePointer: window.matchMedia?.('(pointer: coarse)').matches,
      });
      showMapLayer(map, baseLayersRef.current, mapStyleRef.current);

      // Add company markers + circles
      companiesRef.current.forEach(company => {
        if (!company.latitude || !company.longitude) return;
        const isSelected = selectedCompanyRef.current?.id === company.id;

        const officeIcon = L.default.divIcon({
          html: `<div style="
            width: 40px; height: 40px; border-radius: 50%;
            background: ${isSelected ? '#2563EB' : '#64748B'};
            border: 3px solid #fff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex; align-items: center; justify-content: center;
            font-size: 18px;
          ">${mapIconSvg('building', 19)}</div>`,
          className: '', iconSize: [40, 40], iconAnchor: [20, 20],
        });

        L.default.marker(
          [parseFloat(company.latitude), parseFloat(company.longitude)],
          { icon: officeIcon }
        ).addTo(map).bindPopup(`
          <div style="min-width:180px;">
            <b style="font-size:14px;">${company.display_name || company.name}</b><br/>
            <span style="font-size:12px;color:#64748B;">${company.address || 'No address'}</span><br/>
            <span style="font-size:12px;">Radius: ${company.geo_radius_meters}m</span>
          </div>
        `);

        const circle = L.default.circle(
          [parseFloat(company.latitude), parseFloat(company.longitude)],
          {
            radius: company.geo_radius_meters || 50,
            color: isSelected ? '#2563EB' : '#64748B',
            fillColor: isSelected ? '#2563EB' : '#64748B',
            fillOpacity: 0.08,
            weight: 2,
            dashArray: '6',
          }
        ).addTo(map);

        circlesRef.current[company.id] = circle;
      });

      // Add live student markers
      liveLocationsRef.current.forEach(loc => {
        const isClockedIn = Boolean(loc.is_clocked_in);
        const hasAnomaly = !!loc.anomaly_flag;

        const color = hasAnomaly ? '#DC2626' : isClockedIn ? '#16A34A' : '#64748B';
        const statusIcon = hasAnomaly ? 'alert' : isClockedIn ? 'check' : 'map';

        const studentIcon = L.default.divIcon({
          html: `
            <div style="position:relative;">
              <div style="
                width: 44px; height: 44px; border-radius: 50%;
                background: ${color};
                border: 3px solid #fff;
                box-shadow: 0 2px 12px rgba(0,0,0,0.25);
                display: flex; align-items: center; justify-content: center;
                font-size: 18px;
              ">${mapIconSvg('user', 20)}</div>
              <div style="
                position: absolute; top: -4px; right: -4px;
                width: 16px; height: 16px; border-radius: 50%;
                background: ${color}; border: 2px solid #fff;
                font-size: 8px; display: flex; align-items: center; justify-content: center;
              ">${mapIconSvg(statusIcon, 9)}</div>
              ${isClockedIn ? `<div style="
                position: absolute; top: -2px; right: -2px;
                width: 12px; height: 12px; border-radius: 50%;
                background: #16A34A; border: 2px solid #fff;
                animation: pulse-dot 1.5s infinite;
              "></div>` : ''}
            </div>`,
          className: '', iconSize: [44, 44], iconAnchor: [22, 22],
        });

        const timeAgo = (ts) => {
          const diff = Date.now() - new Date(ts);
          const mins = Math.floor(diff / 60000);
          if (mins < 1) return 'Just now';
          if (mins < 60) return `${mins}m ago`;
          return `${Math.floor(mins / 60)}h ago`;
        };

        const marker = L.default.marker(
          [parseFloat(loc.latitude), parseFloat(loc.longitude)],
          { icon: studentIcon }
        ).addTo(map).bindPopup(`
          <div style="min-width:200px;">
            <b style="font-size:14px;">${loc.first_name} ${loc.last_name}</b><br/>
            <span style="font-size:12px;color:#64748B;">${loc.email}</span><br/>
            <span style="font-size:12px;">${loc.company_name}</span><br/>
            <span style="font-size:12px;color:${color};font-weight:600;">
              ${isClockedIn ? 'Timed In' : 'Off shift'}
            </span><br/>
            ${loc.anomaly_flag ? `<span style="font-size:12px;color:#DC2626;">${loc.anomaly_flag}</span><br/>` : ''}
            <span style="font-size:11px;color:#94A3B8;">Updated: ${timeAgo(loc.updated_at)}</span>
          </div>
        `);

        markersRef.current[loc.student_id] = marker;
      });

      // Click map to set location when editing
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
      ...liveLocations.map(location => [Number(location.latitude), Number(location.longitude)]),
    ].filter(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude));
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [46, 46], maxZoom: 17 });
  };

  // Update student markers without rebuilding the map or reloading satellite tiles.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    const activeStudents = new Set();

    liveLocations.forEach(loc => {
      const latitude = Number(loc.latitude);
      const longitude = Number(loc.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const key = String(loc.student_id);
      activeStudents.add(key);
      const isClockedIn = Boolean(loc.is_clocked_in);
      const hasAnomaly = Boolean(loc.anomaly_flag);
      const color = hasAnomaly ? '#DC2626' : isClockedIn ? '#16A34A' : '#64748B';
      const status = hasAnomaly ? 'Anomaly flagged' : isClockedIn ? 'Timed in' : 'Off shift';
      const icon = L.divIcon({
        html: `<div class="live-map-marker" style="--marker-color:${color}">${mapIconSvg('user', 20)}</div>`,
        className: 'live-map-marker-wrap', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20],
      });
      const accuracyText = Number.isFinite(Number(loc.accuracy)) ? `<br>GPS accuracy: ${Math.round(Number(loc.accuracy))} m` : '';
      const popup = `<b>${loc.first_name} ${loc.last_name}</b><br><span style="color:${color};font-weight:600">${status}</span><br>${loc.company_name || ''}${accuracyText}<br>Updated: ${formatTime(loc.updated_at)}`;
      const existing = markersRef.current[key];
      if (existing) {
        existing.setLatLng([latitude, longitude]).setPopupContent(popup);
        if (existing._smartrackColor !== color) existing.setIcon(icon);
        existing._smartrackColor = color;
      } else {
        const marker = L.marker([latitude, longitude], { icon }).addTo(map).bindPopup(popup);
        marker._smartrackColor = color;
        markersRef.current[key] = marker;
      }
    });

    Object.entries(markersRef.current).forEach(([key, marker]) => {
      if (!activeStudents.has(key)) {
        map.removeLayer(marker);
        delete markersRef.current[key];
      }
    });
  }, [liveLocations]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedCompany?.latitude || !selectedCompany?.longitude) return;
    map.setView([Number(selectedCompany.latitude), Number(selectedCompany.longitude)], map.getZoom(), { animate: false });
    Object.entries(circlesRef.current).forEach(([companyId, circle]) => {
      const selected = String(companyId) === String(selectedCompany.id);
      circle.setStyle({
        color: selected ? '#2563EB' : '#64748B',
        fillColor: selected ? '#2563EB' : '#64748B',
      });
    });
  }, [selectedCompany]);

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
      showToast('Perimeter updated!');
      setEditingPerimeter(false);
      await fetchCompanies();
    } catch { showToast('Failed to save.', 'error'); }
    finally { setSaving(false); }
  };

  const formatTime = (ts) => {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  if (loading) return (
    <SkeletonPage variant="map" label="Loading live map" />
  );

  return (
    <div>
      {/* Header */}
      <div className="map-page-head">
        <div>
          <div className="section-title">Live Map</div>
          <div className="section-sub">
            {onlineCount > 0 ? `${onlineCount} student${onlineCount !== 1 ? 's' : ''} timed in or online` : 'No students timed in'}
            {lastUpdated && ` • Updated ${formatTime(lastUpdated)}`}
          </div>
        </div>
        <div className="map-header-actions">
          <button type="button" onClick={() => { setCompanyError(''); setShowCompanyModal(true); }}
            className="action-btn action-btn-primary icon-label"><VectorIcon name="building" size={15} /> Add company</button>
          <button type="button" onClick={() => refreshDashboard()} disabled={refreshing}
            className="action-btn action-btn-gray icon-label" aria-busy={refreshing}>
            <VectorIcon name="refresh" size={15} /> {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: '0.875rem', flexWrap: 'wrap',
        marginBottom: '0.875rem', padding: '0.75rem 1rem',
        background: 'var(--surface)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', fontSize: '0.78rem',
      }}>
        {[
          { color: '#16A34A', label: 'Timed In' },
          { color: '#64748B', label: 'Not Timed Out' },
          { color: '#DC2626', label: 'Anomaly flagged' },
          { color: '#2563EB', label: 'Office / Perimeter' },
          { color: '#D97706', label: 'GPS accuracy shown in details' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-2)' }}>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Company Selector */}
      {companies.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
          {companies.map(c => (
            <button key={c.id} onClick={() => {
              setSelectedCompany(c);
              setNewRadius(c.geo_radius_meters || 50);
              setNewLat(c.latitude || '');
              setNewLng(c.longitude || '');
              setEditingPerimeter(false);
            }} style={{
              padding: '0.4rem 0.875rem',
              background: selectedCompany?.id === c.id ? 'var(--primary)' : 'var(--surface-2)',
              color: selectedCompany?.id === c.id ? '#fff' : 'var(--text-2)',
              border: 'none', borderRadius: 'var(--radius)',
              cursor: 'pointer', fontWeight: 500, fontSize: '0.82rem',
            }}>{c.display_name || c.name}</button>
          ))}
        </div>
      )}

      {/* Live Map */}
      <div className="dashboard-map-shell">
        <div ref={mapRef} className="dashboard-map-canvas" aria-label="Coordinator live attendance map" />

        <MapControls mapStyle={mapStyle} onStyleChange={setMapStyle} onFit={fitLocations} />

        <div className="live-map-indicator"><i /> Live</div>

        {editingPerimeter && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000,
            background: 'rgba(217, 119, 6, 0.9)', color: '#fff',
            padding: '0.6rem 1rem', fontSize: '0.82rem', fontWeight: 500,
            textAlign: 'center',
          }}>
            Tap on the map to set the new office location
          </div>
        )}
      </div>

      {/* Perimeter Settings */}
      {selectedCompany && (
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{selectedCompany.display_name || selectedCompany.name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: '0.1rem' }}>
                {selectedCompany.address || 'No address set'} • Radius: {selectedCompany.geo_radius_meters}m
              </div>
            </div>
            {!editingPerimeter ? (
              <button onClick={() => setEditingPerimeter(true)} className="action-btn action-btn-primary">
                Edit
              </button>
            ) : (
              <button onClick={() => setEditingPerimeter(false)} className="action-btn action-btn-gray">
                Cancel
              </button>
            )}
          </div>

          {editingPerimeter && (
            <div>
              <div className="grid-2" style={{ marginBottom: '0.875rem' }}>
                <div className="form-group">
                  <label>Latitude</label>
                  <input type="number" step="any" value={newLat}
                    onChange={e => setNewLat(e.target.value)}
                    placeholder="e.g. 14.5995"
                    style={{ background: 'var(--surface)', color: 'var(--text)' }} />
                </div>
                <div className="form-group">
                  <label>Longitude</label>
                  <input type="number" step="any" value={newLng}
                    onChange={e => setNewLng(e.target.value)}
                    placeholder="e.g. 120.9842"
                    style={{ background: 'var(--surface)', color: 'var(--text)' }} />
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Geo-fence Radius
                  </label>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{newRadius}m</span>
                </div>
                <input type="range" min="20" max="500" step="10"
                  value={newRadius}
                  onChange={e => setNewRadius(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--primary)' }}
                />
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Office (50m)', value: 50 },
                    { label: 'Building (100m)', value: 100 },
                    { label: 'Campus (200m)', value: 200 },
                    { label: 'Complex (300m)', value: 300 },
                  ].map(p => (
                    <button key={p.value} type="button" onClick={() => setNewRadius(p.value)} style={{
                      padding: '0.3rem 0.65rem',
                      background: newRadius === p.value ? 'var(--primary)' : 'var(--surface-2)',
                      color: newRadius === p.value ? '#fff' : 'var(--text-2)',
                      border: 'none', borderRadius: '6px', cursor: 'pointer',
                      fontSize: '0.75rem', fontWeight: 500,
                    }}>{p.label}</button>
                  ))}
                </div>
              </div>

              <button onClick={handleSavePerimeter} disabled={saving} className="btn-compact-primary">
                {saving ? 'Saving…' : 'Save perimeter'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Online Students List */}
      <div className="card">
        <div className="card-title">
          Online Students
          <span style={{ marginLeft: '0.5rem', fontWeight: 400, color: 'var(--text-3)', fontSize: '0.82rem' }}>
            (timed in or recently online)
          </span>
        </div>

        {liveLocations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-3)' }}>
            <div style={{ color: 'var(--text-3)', marginBottom: '0.5rem' }}><VectorIcon name="map" size={30} /></div>
            <p style={{ fontSize: '0.875rem' }}>No students timed in right now.</p>
            <p style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>Students appear here after they time in. Their location is recorded automatically from their device.</p>
          </div>
        ) : liveLocations.map(loc => {
          const isClockedIn = loc.clock_in && !loc.clock_out;
          const hasAnomaly = !!loc.anomaly_flag;
          const color = hasAnomaly ? 'var(--danger)' : isClockedIn ? 'var(--success)' : 'var(--text-3)';

          return (
            <div key={loc.student_id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.75rem', background: 'var(--bg)',
              borderRadius: 'var(--radius)', marginBottom: '0.5rem',
              border: hasAnomaly ? '1px solid var(--danger)' : '1px solid transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.82rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {loc.first_name?.[0]}{loc.last_name?.[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {loc.first_name} {loc.last_name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                    {loc.company_name}
                  </div>
                  {hasAnomaly && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.1rem' }}>
                      <span className="icon-label"><VectorIcon name="alert" size={14} /> {loc.anomaly_flag}</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color }}>
                  <span className="icon-label"><VectorIcon name={hasAnomaly ? 'alert' : isClockedIn ? 'success' : 'user'} size={13} /> {hasAnomaly ? 'Flagged' : isClockedIn ? 'Timed In' : 'Offline'}</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: '0.1rem' }}>
                  {formatTime(loc.updated_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
