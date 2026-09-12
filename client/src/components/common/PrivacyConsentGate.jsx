import { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';
import useAuth from '../../hooks/useAuth';

const List = ({ items }) => (
  <ul>{items?.map(item => <li key={item}>{item}</li>)}</ul>
);

const PrivacyConsentGate = ({ children }) => {
  const { user, acceptPrivacy, logout } = useAuth();
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const loadNotice = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/auth/privacy-notice');
      setNotice(response.data.notice);
    } catch {
      setError('We could not load the privacy notice. Your workspace remains locked so you are not asked to continue without this information.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadNotice();
  }, [loadNotice]);

  if (!user || (!loading && notice && user.privacyNoticeVersion === notice.version)) return children;

  return (
    <main className="privacy-page">
      <section className="privacy-card" aria-labelledby="privacy-title">
        <header className="privacy-header">
          <span className="privacy-eyebrow">Your information, explained clearly</span>
          <h1 id="privacy-title">Privacy notice and acknowledgement</h1>
          <p>This explains what Smartrack records, why it is needed, who can see it, and the choices and rights you have.</p>
          {notice && <small>Notice version {notice.version} · Effective {notice.effectiveDate}</small>}
        </header>

        {loading && <div className="privacy-status" role="status">Loading the privacy notice…</div>}

        {!loading && error && (
          <div className="privacy-load-error" role="alert">
            <strong>Privacy notice unavailable</strong>
            <p>{error}</p>
            <div className="privacy-actions">
              <button type="button" className="btn-primary" onClick={loadNotice}>Try again</button>
              <button type="button" className="btn-secondary" onClick={logout}>Sign out</button>
            </div>
          </div>
        )}

        {!loading && notice && (
          <>
            <div className="privacy-summary" aria-label="Privacy summary">
              <h2>The short version</h2>
              <div className="privacy-summary-grid">
                <div><strong>What is recorded</strong><span>Your profile, OJT activity, attendance, GPS during attendance, selfies, documents, and security logs.</span></div>
                <div><strong>Why it is used</strong><span>To manage your OJT, verify attendance, calculate hours, review issues, and keep the service secure.</span></div>
                <div><strong>Who can see it</strong><span>Only you and authorized school, coordinator, supervisor, and service-provider personnel who need it for their role.</span></div>
                <div><strong>Your key choice</strong><span>This screen records that you received the notice. It is not blanket permission to use your data for unrelated purposes.</span></div>
              </div>
            </div>

            <div className="privacy-details">
              <section>
                <h2>1. Who is responsible for your data?</h2>
                <p><strong>Personal Information Controller:</strong> {notice.controllerName}</p>
                <p><strong>Questions or privacy requests:</strong> {notice.privacyContact}</p>
                <p className="privacy-note">{notice.controllerInstruction}</p>
              </section>

              <section>
                <h2>2. What information does Smartrack use?</h2>
                <List items={notice.dataCategories} />
                <p>Smartrack does not use attendance selfies for facial recognition and does not create biometric face templates.</p>
              </section>

              <section>
                <h2>3. Why is it used?</h2>
                <List items={notice.purposes} />
                <p><strong>Legal basis:</strong> {notice.lawfulBasis}</p>
                <p>{notice.consentExplanation}</p>
              </section>

              <section>
                <h2>4. How do GPS and selfies work?</h2>
                <p><strong>GPS:</strong> {notice.locationPurpose}</p>
                <p><strong>Attendance selfies:</strong> {notice.selfiePurpose}</p>
              </section>

              <section>
                <h2>5. Who receives the information?</h2>
                <List items={notice.recipients} />
                <p>{notice.internationalProcessing}</p>
              </section>

              <section>
                <h2>6. How long is it kept?</h2>
                <p>{notice.retention}</p>
                <p>Attendance selfies are configured for deletion after the OJT deployment has ended and the configured {notice.imageRetentionDays}-day period has passed.</p>
              </section>

              <section>
                <h2>7. Are decisions made automatically?</h2>
                <p>{notice.automatedProcessing}</p>
              </section>

              <section>
                <h2>8. How is it protected?</h2>
                <p>{notice.security}</p>
                <p>No online system can promise zero risk. Report a suspected privacy or security issue promptly using the privacy contact above.</p>
              </section>

              <section>
                <h2>9. What are your rights?</h2>
                <List items={notice.rights} />
                <p>{notice.rightsProcess}</p>
              </section>

              <section>
                <h2>10. What if you do not acknowledge this notice?</h2>
                <p>{notice.declining}</p>
              </section>
            </div>

            <div className="privacy-acknowledgement">
              <strong>This is an acknowledgement, not blanket consent.</strong>
              <p>{notice.notConsent}</p>
              <label>
                <input type="checkbox" checked={acknowledged}
                  onChange={event => setAcknowledged(event.target.checked)} />
                <span>I confirm that I received and had the opportunity to read this privacy notice. I understand how to contact the institution about my data and rights.</span>
              </label>
            </div>

            {error && <div className="auth-alert auth-alert-danger" role="alert">{error}</div>}
            <div className="privacy-actions">
              <button className="btn-primary" disabled={saving || !acknowledged} onClick={async () => {
                setSaving(true);
                setError('');
                try {
                  await acceptPrivacy(notice.version);
                } catch (requestError) {
                  setError(requestError.response?.data?.message || 'Your acknowledgement could not be recorded. Please try again.');
                } finally {
                  setSaving(false);
                }
              }}>{saving ? 'Recording acknowledgement…' : 'Acknowledge and continue'}</button>
              <button type="button" className="btn-secondary" disabled={saving} onClick={logout}>Sign out</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
};

export default PrivacyConsentGate;
