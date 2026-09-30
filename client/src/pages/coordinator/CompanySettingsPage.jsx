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

  const radiusLabel = (radius) => {
    if (radius <= 50) return 'Tight';
    if (radius <= 100) return 'Normal';
    if (radius <= 300) return 'Wide';
    return 'Very wide';
  };

  return (
    <div>
      <PageHeader
        className="dashboard-back-header"
        title="Worksites & perimeter"
        subtitle={`${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}`}
        actions={(
          <button className="action-btn action-btn-gray dashboard-back-button icon-label" onClick={onBack}>
            <VectorIcon name="back" size={16} /> Back
          </button>
        )}
      />

      {loading ? (
        <SkeletonPage variant="list" label="Loading companies" />
      ) : companies.length === 0 ? (
        <div className="card company-settings-empty">No companies yet.</div>
      ) : (
        <div className="company-settings-list">
          {companies.map(company => {
            const isEditing = editTarget?.id === company.id;

            return (
              <section key={company.id} className={`card company-settings-card${isEditing ? ' is-editing' : ''}`}>
                <div className="company-settings-head">
                  <div>
                    <h3>{company.name}</h3>
                    {company.address && <p className="coordinator-muted">{company.address}</p>}
                  </div>
                  {!isEditing && (
                    <div className="company-settings-actions">
                      <button type="button" onClick={() => openLocation(company)} className="action-btn action-btn-primary icon-label"><VectorIcon name="plus" size={15} /> Worksite</button>
                      <button type="button" onClick={() => openEdit(company)} className="action-btn action-btn-gray icon-label"><VectorIcon name="pencil" size={15} /> Edit</button>
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <div className="worksite-list">
                    {(company.locations || []).map(location => (
                      <button type="button" key={location.id} className="worksite-card" onClick={() => openLocation(company, location)}>
                        <span><strong>{location.name}</strong>{location.is_primary && <span className="badge badge-primary">Primary</span>}</span>
                        <small>{location.attendance_mode === 'fixed'
                          ? `${location.geo_radius_meters} m radius` : `${location.attendance_mode} attendance`}</small>
                      </button>
                    ))}
                  </div>
                )}

                {isEditing && (
                  <form onSubmit={handleSubmit} className="company-settings-form">
                    <div className="form-group">
                      <label htmlFor={`company-name-${company.id}`}>Company name *</label>
                      <input id={`company-name-${company.id}`} type="text" required value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`company-address-${company.id}`}>Address</label>
                      <input id={`company-address-${company.id}`} type="text" value={form.address}
                        onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Street, city, building" />
                    </div>

                    <div className="company-settings-gps">
                      <div className="company-settings-gps-head">
                        <span>Office location</span>
                        <button type="button" onClick={handleGetCurrentLocation} disabled={gpsLoading} className="action-btn action-btn-gray icon-label">
                          <VectorIcon name="map" size={15} /> {gpsLoading ? 'Locating…' : 'Use my location'}
                        </button>
                      </div>
                      <div className="grid-2">
                        <div className="form-group">
                          <label htmlFor={`company-lat-${company.id}`}>Latitude</label>
                          <input id={`company-lat-${company.id}`} type="number" step="any" value={form.latitude}
                            onChange={e => setForm({ ...form, latitude: e.target.value })} placeholder="e.g. 14.5995" />
                        </div>
                        <div className="form-group">
                          <label htmlFor={`company-lng-${company.id}`}>Longitude</label>
                          <input id={`company-lng-${company.id}`} type="number" step="any" value={form.longitude}
                            onChange={e => setForm({ ...form, longitude: e.target.value })} placeholder="e.g. 120.9842" />
                        </div>
                      </div>
                    </div>

                    <div className="map-radius-row">
                      <label htmlFor={`company-radius-${company.id}`}>Radius</label>
                      <strong>{form.geoRadiusMeters} m <span className="badge badge-gray">{radiusLabel(form.geoRadiusMeters)}</span></strong>
                    </div>
                    <input id={`company-radius-${company.id}`} type="range" min="20" max="500" step="10"
                      value={form.geoRadiusMeters} className="map-radius-slider"
                      onChange={e => setForm({ ...form, geoRadiusMeters: parseInt(e.target.value, 10) })} />
                    <div className="map-radius-presets">
                      {[50, 100, 200, 300].map(value => (
                        <button key={value} type="button" className={form.geoRadiusMeters === value ? 'is-active' : ''} aria-pressed={form.geoRadiusMeters === value}
                          onClick={() => setForm({ ...form, geoRadiusMeters: value })}>{value} m</button>
                      ))}
                    </div>

                    <div className="company-settings-form-actions">
                      <button type="button" onClick={() => setEditTarget(null)} className="action-btn action-btn-gray">Cancel</button>
                      <button type="submit" disabled={formLoading} className="action-btn action-btn-primary">{formLoading ? 'Saving…' : 'Save'}</button>
                    </div>
                  </form>
                )}
              </section>
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
