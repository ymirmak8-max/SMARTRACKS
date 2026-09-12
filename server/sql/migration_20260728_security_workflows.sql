ALTER TABLE users
  ADD COLUMN IF NOT EXISTS privacy_notice_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_secret TEXT,
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL
    DEFAULT '{"inApp":true,"email":true,"attendance":true,"documents":true,"announcements":true,"quietHoursStart":null,"quietHoursEnd":null}'::jsonb;

CREATE TABLE IF NOT EXISTS backup_verifications (
  id BIGSERIAL PRIMARY KEY,
  file_name VARCHAR(500) NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  backup_created_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL CHECK (status IN ('verified', 'failed')),
  details TEXT
);

CREATE INDEX IF NOT EXISTS backup_verifications_verified_idx
ON backup_verifications (verified_at DESC);

INSERT INTO system_settings (key, value)
VALUES ('privacy_notice', '{
  "version":"2026-07-28.2",
  "controllerName":"The school or institution operating this Smartrack deployment",
  "privacyContact":"Contact your school administrator or designated Data Protection Officer",
  "dataCategories":["Account and profile information","OJT deployment and company assignment","Time-in and time-out records","GPS coordinates and accuracy captured during attendance actions","Attendance selfie images and submitted evidence","Documents, evaluations, correction requests, notifications, and audit events","Device, IP address, and browser information recorded for security and auditing"],
  "purposes":["Administer OJT placements and required hours","Verify attendance at approved worksites","Review exceptions, documents, evaluations, and completion requests","Detect duplicate, inaccurate, late, or out-of-perimeter attendance","Maintain security, accountability, audit history, backups, and service reliability","Generate authorized reports and aggregate performance analytics"],
  "lawfulBasis":"The operating institution must document the applicable lawful basis for each processing purpose, such as performance of an educational or service relationship, compliance with a legal obligation, legitimate interests subject to a balancing assessment, or specific consent where consent is required.",
  "locationPurpose":"GPS is collected when an attendance action is performed and while an active timed-in session uses live-location monitoring. It is used to compare the device position with an approved worksite and identify exceptions.",
  "selfiePurpose":"Time-in and time-out selfies are attendance evidence. Smartrack does not perform facial recognition or biometric-template matching.",
  "recipients":["The student","Authorized Smartrack administrators","The student’s assigned coordinator and supervisor","Authorized service providers for hosting, storage, email, and notifications","Government or regulatory authorities only when disclosure is legally required"],
  "retention":"Account, OJT, attendance, evaluation, document, audit, and report records are retained according to the operating institution’s approved retention schedule and applicable requirements.",
  "imageRetentionDays":90,
  "automatedProcessing":"Smartrack calculates hours, distance, lateness, completion progress, and risk indicators using configured rules. Flags support human review and are not intended to make final disciplinary or academic decisions by themselves. Optional AI summaries may describe authorized aggregate or student performance data.",
  "security":"Safeguards include role-based access, password hashing, protected file links, encrypted transport when deployed over HTTPS, audit logging, rate limits, database constraints, backups, and configurable image deletion.",
  "rights":["Be informed","Request access","Request correction","Object when applicable","Withdraw consent where processing relies on consent","Request erasure or blocking when legally applicable","Obtain portable electronic data when applicable","Lodge a complaint with the National Privacy Commission"],
  "declining":"If you do not acknowledge this notice, Smartrack will not open the authenticated workspace. Contact the institution’s administrator or Data Protection Officer to ask about another attendance process, the applicable lawful basis, or the consequences of not using Smartrack.",
  "internationalProcessing":"Hosting and service providers may process data in locations selected by the operating institution. The institution must disclose applicable providers and cross-border safeguards.",
  "notConsent":"Acknowledging this notice confirms that it was presented to you. It is not blanket consent and does not waive any data-subject right."
}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
