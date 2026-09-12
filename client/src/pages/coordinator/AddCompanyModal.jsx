const AddCompanyModal = ({
  error,
  form,
  onChange,
  onClose,
  onError,
  onSubmit,
  saving,
}) => {
  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      onError('GPS is not supported on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      onChange({
        ...form,
        latitude: position.coords.latitude.toFixed(8),
        longitude: position.coords.longitude.toFixed(8),
      });
      onError('');
    }, () => onError('Location could not be captured. Allow GPS access or enter coordinates.'), {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  };

  const update = (field) => (event) => onChange({ ...form, [field]: event.target.value });

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-handle" />
        <div className="modal-title">Add Company</div>
        <p style={{ color: 'var(--text-3)', fontSize: '.82rem', marginBottom: '1rem' }}>
          This creates the company and its first approved worksite.
        </p>
        <form onSubmit={onSubmit}>
          <div className="form-group"><label>Company name *</label>
            <input required autoFocus value={form.name} onChange={update('name')} placeholder="e.g. Acme Corporation" />
          </div>
          <div className="form-group"><label>Main worksite address</label>
            <input value={form.address} onChange={update('address')} placeholder="Street, city, and building name" />
          </div>
          <div className="grid-2">
            <div className="form-group"><label>Latitude *</label>
              <input type="number" step="any" required value={form.latitude} onChange={update('latitude')} placeholder="e.g. 14.5995" />
            </div>
            <div className="form-group"><label>Longitude *</label>
              <input type="number" step="any" required value={form.longitude} onChange={update('longitude')} placeholder="e.g. 120.9842" />
            </div>
          </div>
          <button type="button" className="action-btn action-btn-gray" style={{ marginBottom: '1rem' }}
            onClick={useCurrentLocation}>Use Current Location</button>
          <div className="form-group"><label>Geofence radius (meters)</label>
            <input type="number" min="10" max="5000" value={form.geoRadiusMeters}
              onChange={update('geoRadiusMeters')} placeholder="How far students can clock in, e.g. 50" />
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="grid-2">
            <button type="button" className="action-btn action-btn-gray" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Adding...' : 'Add Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddCompanyModal;
