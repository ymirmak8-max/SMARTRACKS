const MapControls = ({ mapStyle, onStyleChange, onFit, privacyLabel = 'Authorized access only' }) => (
  <div className="map-overlay-tools" aria-label="Map controls">
    <div className="map-style-toggle" role="group" aria-label="Map appearance">
      <button type="button" className={mapStyle === 'street' ? 'active' : ''}
        aria-pressed={mapStyle === 'street'} onClick={() => onStyleChange('street')}>
        <span>Map</span>
      </button>
      <button type="button" className={mapStyle === 'satellite' ? 'active' : ''}
        aria-pressed={mapStyle === 'satellite'} onClick={() => onStyleChange('satellite')}>
        <span>Satellite</span>
      </button>
    </div>
    {onFit && <button type="button" className="map-fit-button" onClick={onFit}>Fit locations</button>}
    {privacyLabel && <span className="map-privacy-label">{privacyLabel}</span>}
  </div>
);

export default MapControls;
