import BrandLogo from './BrandLogo';

const LoadingSpinner = ({ message = 'Signing you in' }) => (
  <div className="auth-boot-screen" role="status" aria-live="polite" aria-busy="true">
    <div className="auth-boot-mark">
      <BrandLogo className="smartrack-loader-logo auth-boot-logo" size="lg" />
    </div>
    <p className="auth-boot-message">{message}</p>
    <div className="smartrack-loader-dots" aria-hidden="true">
      <span /><span /><span /><span />
    </div>
  </div>
);

export default LoadingSpinner;
