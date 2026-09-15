import { useState, useEffect, useCallback } from 'react';
import { getCompanies, updateCompany, createCompanyLocation, updateCompanyLocation, archiveCompanyLocation } from '../../api/deployments';
import { PageHeader } from '../../components/common/DashboardUI';
import VectorIcon from '../../components/common/VectorIcon';
import SkeletonPage from '../../components/common/Skeleton';

const CompanySettingsPage = ({ onBack }) => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({});
  const [formLoading, setFormLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locationTarget, setLocationTarget] = useState(null);
  const [locationForm, setLocationForm] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCompanies();
      setCompanies(res.data.companies);
    } catch {
      showToast('Failed to load companies.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  const openEdit = (company) => {
    setEditTarget(company);
    setForm({
      name: company.name,
      address: company.address || '',
      latitude: company.latitude || '',
      longitude: company.longitude || '',
      geoRadiusMeters: company.geo_radius_meters || 50,
    });
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation)
      return showToast('Geolocation not supported.', 'error');

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm({
          ...form,
          latitude: pos.coords.latitude.toFixed(8),
          longitude: pos.coords.longitude.toFixed(8),
        });
        setGpsLoading(false);
        showToast('Location captured successfully.');
      },
      () => {
        setGpsLoading(false);
        showToast('Failed to get location. Please allow GPS access.', 'error');
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      await updateCompany(editTarget.id, form);
      showToast('Company settings updated successfully.');
      setEditTarget(null);
      fetchCompanies();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to update.', 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const openLocation = (company, location = null) => {
    setLocationTarget({ company, location });
    setLocationForm({
      name: location?.name || '',
      address: location?.address || '',
      latitude: location?.latitude || '',
      longitude: location?.longitude || '',
      geoRadiusMeters: location?.geo_radius_meters || 50,
      attendanceMode: location?.attendance_mode || 'fixed',
      isPrimary: Boolean(location?.is_primary),
    });
  };

  const saveLocation = async (event) => {
    event.preventDefault();
    setFormLoading(true);
    try {
      if (locationTarget.location) await updateCompanyLocation(locationTarget.location.id, locationForm);
      else await createCompanyLocation(locationTarget.company.id, locationForm);
      showToast(locationTarget.location ? 'Worksite updated.' : 'Worksite added.');
      setLocationTarget(null);
      await fetchCompanies();
    } catch (error) {
      showToast(error.response?.data?.message || 'Failed to save worksite.', 'error');
    } finally { setFormLoading(false); }
  };

  const archiveLocation = async () => {
    try {
      await archiveCompanyLocation(locationTarget.location.id);
      showToast('Worksite archived.');
      setLocationTarget(null);
      await fetchCompanies();
    } catch (error) { showToast(error.response?.data?.message || 'Worksite could not be archived.', 'error'); }
  };

  const getRadiusLabel = (radius) => {
    if (radius <= 50) return { label: 'Tight (office only)', color: '#EF4444' };
    if (radius <= 100) return { label: 'Normal (building area)', color: '#D97706' };
    if (radius <= 300) return { label: 'Wide (campus/complex)', color: '#2563EB' };
    return { label: 'Very Wide', color: '#7C3AED' };
  };

  return (
    <div>
      <PageHeader
        className="dashboard-back-header"
        eyebrow="Deployment settings"
        title="Company & Perimeter Settings"
        subtitle="Manage office locations and geofence radius for time-in validation"
        actions={(
          <button className="action-btn action-btn-gray dashboard-back-button icon-label" onClick={onBack}>
            <VectorIcon name="back" size={16} /> Back
          </button>
        )}
      />

      {loading ? (
        <SkeletonPage variant="list" label="Loading companies" />
      ) : companies.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-3)' }}>
          No companies found. Add a company to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {companies.map(company => {
            const radiusInfo = getRadiusLabel(company.geo_radius_meters);
            const isEditing = editTarget?.id === company.id;

            return (
              <div key={company.id} style={{
                background: '#fff', borderRadius: '12px',
                border: isEditing ? '2px solid #2563EB' : '1px solid #E2E8F0',
                padding: '1.5rem',
              }}>
                {/* Company Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isEditing ? '1.5rem' : '0' }}>
                  <div>
                    <h3 style={{ margin: '0 0 0.25rem' }}>{company.name}</h3>
                    <p style={{ color: '#64748B', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                       {company.address || 'No address set'}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.82rem', color: '#64748B' }}>
                        Lat: {company.latitude || '—'} | Lng: {company.longitude || '—'}
                      </span>
                      <span style={{
                        background: radiusInfo.color + '18', color: radiusInfo.color,
                        padding: '0.2rem 0.6rem', borderRadius: '999px',
                        fontSize: '0.78rem', fontWeight: 600,
                      }}>
                        {company.geo_radius_meters}m — {radiusInfo.label}
                      </span>
                    </div>
                  </div>
                  {!isEditing && (
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button onClick={() => openLocation(company)} className="action-btn action-btn-primary">Add Worksite</button>
                    <button onClick={() => openEdit(company)} style={{
                      padding: '0.5rem 1rem', background: '#EFF6FF', color: '#2563EB',
                      border: 'none', borderRadius: '8px', cursor: 'pointer',
                      fontWeight: 500, fontSize: '0.85rem', whiteSpace: 'nowrap',
                    }}>Edit Company</button>
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <div className="worksite-list">
                    {(company.locations || []).map(location => (
                      <button type="button" key={location.id} className="worksite-card" onClick={() => openLocation(company, location)}>
                        <span><strong>{location.name}</strong>{location.is_primary && <span className="badge badge-primary">Primary</span>}</span>
                        <small>{location.address || 'No address'} · {location.attendance_mode === 'fixed'
                          ? `${location.geo_radius_meters}m geofence` : `${location.attendance_mode} attendance`}</small>
                      </button>
                    ))}
                  </div>
                )}

                {/* Edit Form */}
                {isEditing && (
                  <form onSubmit={handleSubmit}>
                    <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>Company Name *</label>
                        <input
                          type="text" required value={form.name}
                          onChange={e => setForm({ ...form, name: e.target.value })}
                          style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.9rem' }}
                        />
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.3rem' }}>Address</label>
                        <input
                          type="text" value={form.address}
                          onChange={e => setForm({ ...form, address: e.target.value })}
                          placeholder="Street, city, and building name"
                          style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.9rem' }}
                        />
                      </div>
                    </div>

                    {/* GPS Section */}
                    <div style={{
                      background: '#F8FAFC', borderRadius: '8px',
                      padding: '1rem', marginBottom: '1rem',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label style={{ fontWeight: 500, fontSize: '0.9rem' }}>Office GPS Coordinates</label>
                        <button type="button" onClick={handleGetCurrentLocation} disabled={gpsLoading} style={{
                          padding: '0.4rem 0.9rem', background: 'var(--primary)', color: 'var(--on-primary)',
                          border: 'none', borderRadius: '6px', cursor: 'pointer',
                          fontSize: '0.8rem', fontWeight: 500,
                        }}>
                          {gpsLoading ? 'Getting location...' : 'Use Current Location'}
                        </button>
                      </div>
                      <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', color: '#64748B', marginBottom: '0.3rem' }}>Latitude</label>
                          <input
                            type="number" step="any" value={form.latitude}
                            onChange={e => setForm({ ...form, latitude: e.target.value })}
                            placeholder="e.g. 14.5995"
                            style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.9rem' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.82rem', color: '#64748B', marginBottom: '0.3rem' }}>Longitude</label>
                          <input
                            type="number" step="any" value={form.longitude}
                            onChange={e => setForm({ ...form, longitude: e.target.value })}
                            placeholder="e.g. 120.9842"
                            style={{ width: '100%', padding: '0.6rem 0.8rem', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '0.9rem' }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Geo-fence Radius */}
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <label style={{ fontWeight: 500, fontSize: '0.9rem' }}>Geo-fence Radius</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.5rem', fontWeight: 700, color: getRadiusLabel(form.geoRadiusMeters).color }}>
                            {form.geoRadiusMeters}m
                          </span>
                          <span style={{
                            background: getRadiusLabel(form.geoRadiusMeters).color + '18',
                            color: getRadiusLabel(form.geoRadiusMeters).color,
                            padding: '0.2rem 0.6rem', borderRadius: '999px',
                            fontSize: '0.78rem', fontWeight: 600,
                          }}>{getRadiusLabel(form.geoRadiusMeters).label}</span>
                        </div>
                      </div>
                      <input
                        type="range" min="20" max="500" step="10"
                        value={form.geoRadiusMeters}
                        onChange={e => setForm({ ...form, geoRadiusMeters: parseInt(e.target.value) })}
                        style={{ width: '100%', accentColor: getRadiusLabel(form.geoRadiusMeters).color }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.25rem' }}>
                        <span>20m (tight)</span>
                        <span>100m</span>
                        <span>200m</span>
                        <span>350m</span>
                        <span>500m (wide)</span>
                      </div>

                      {/* Preset buttons */}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        {[
                          { label: 'Office Only', value: 50 },
                          { label: 'Building', value: 100 },
                          { label: 'Campus', value: 200 },
                          { label: 'Complex', value: 300 },
                        ].map(preset => (
                          <button key={preset.value} type="button"
                            onClick={() => setForm({ ...form, geoRadiusMeters: preset.value })}
                            style={{
                              padding: '0.3rem 0.75rem',
                              background: form.geoRadiusMeters === preset.value ? '#2563EB' : '#F1F5F9',
                              color: form.geoRadiusMeters === preset.value ? '#fff' : '#64748B',
                              border: 'none', borderRadius: '6px', cursor: 'pointer',
                              fontSize: '0.8rem', fontWeight: 500,
                            }}
                          >{preset.label} ({preset.value}m)</button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => setEditTarget(null)} style={{
                        padding: '0.6rem 1.25rem', background: '#F1F5F9',
                        border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 500,
                      }}>Cancel</button>
                      <button type="submit" disabled={formLoading} style={{
                        padding: '0.6rem 1.5rem', background: 'var(--primary)', color: 'var(--on-primary)',
                        border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
                      }}>{formLoading ? 'Saving...' : 'Save Settings'}</button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
      {locationTarget && locationForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-handle" />
            <div className="modal-title">{locationTarget.location ? 'Edit Worksite' : `Add Worksite · ${locationTarget.company.name}`}</div>
            <form onSubmit={saveLocation}>
              <div className="form-group"><label>Worksite name *</label><input required value={locationForm.name}
                onChange={event => setLocationForm({ ...locationForm, name: event.target.value })} placeholder="e.g. Main office or Branch 2" /></div>
              <div className="form-group"><label>Address</label><input value={locationForm.address}
                onChange={event => setLocationForm({ ...locationForm, address: event.target.value })} /></div>
              <div className="grid-2">
                <div className="form-group"><label>Latitude *</label><input type="number" step="any" required value={locationForm.latitude}
                  onChange={event => setLocationForm({ ...locationForm, latitude: event.target.value })} /></div>
                <div className="form-group"><label>Longitude *</label><input type="number" step="any" required value={locationForm.longitude}
                  onChange={event => setLocationForm({ ...locationForm, longitude: event.target.value })} /></div>
              </div>
              <button type="button" className="action-btn action-btn-gray" style={{ marginBottom: '1rem' }} onClick={() => {
                navigator.geolocation?.getCurrentPosition(position => setLocationForm({ ...locationForm,
                  latitude: position.coords.latitude.toFixed(8), longitude: position.coords.longitude.toFixed(8) }),
                () => showToast('Current location could not be captured.', 'error'), { enableHighAccuracy: true });
              }}>Use Current Location</button>
              <div className="grid-2">
                <div className="form-group"><label>Attendance mode</label><select value={locationForm.attendanceMode}
                  onChange={event => setLocationForm({ ...locationForm, attendanceMode: event.target.value })}>
                  <option value="fixed">Fixed worksite</option><option value="field">Field work</option><option value="remote">Remote</option>
                </select></div>
                <div className="form-group"><label>Geofence radius (meters)</label><input type="number" min="10" max="5000"
                  value={locationForm.geoRadiusMeters} onChange={event => setLocationForm({ ...locationForm, geoRadiusMeters: event.target.value })} /></div>
              </div>
              {locationTarget.location && !locationTarget.location.is_primary && (
                <label className="icon-label" style={{ marginBottom: '1rem' }}><input type="checkbox" checked={locationForm.isPrimary}
                  onChange={event => setLocationForm({ ...locationForm, isPrimary: event.target.checked })} /> Make this the company’s primary worksite</label>
              )}
              <div className="grid-2">
                <button type="button" className="action-btn action-btn-gray" onClick={() => setLocationTarget(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={formLoading}>{formLoading ? 'Saving...' : 'Save Worksite'}</button>
              </div>
              {locationTarget.location && !locationTarget.location.is_primary && (
                <button type="button" className="action-btn action-btn-danger" style={{ width: '100%', marginTop: '0.75rem' }} onClick={archiveLocation}>
                  Archive Worksite
                </button>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanySettingsPage;
