CREATE TABLE IF NOT EXISTS company_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    geo_radius_meters INT NOT NULL DEFAULT 50 CHECK (geo_radius_meters BETWEEN 10 AND 5000),
    attendance_mode VARCHAR(20) NOT NULL DEFAULT 'fixed'
      CHECK (attendance_mode IN ('fixed', 'field', 'remote')),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_locations_one_primary_idx
ON company_locations (company_id) WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS company_locations_company_active_idx
ON company_locations (company_id, is_active);

INSERT INTO company_locations
  (company_id, name, address, latitude, longitude, geo_radius_meters, attendance_mode, is_primary)
SELECT id, 'Main Worksite', address, latitude, longitude, COALESCE(geo_radius_meters, 50), 'fixed', true
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM company_locations cl WHERE cl.company_id = c.id);

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS primary_location_id UUID REFERENCES company_locations(id) ON DELETE SET NULL;

UPDATE deployments d
SET primary_location_id = cl.id
FROM company_locations cl
WHERE d.primary_location_id IS NULL AND cl.company_id = d.company_id AND cl.is_primary = true;

CREATE TABLE IF NOT EXISTS deployment_locations (
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES company_locations(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (deployment_id, location_id)
);

INSERT INTO deployment_locations (deployment_id, location_id, is_primary)
SELECT id, primary_location_id, true FROM deployments WHERE primary_location_id IS NOT NULL
ON CONFLICT (deployment_id, location_id) DO UPDATE SET is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS deployment_locations_one_primary_idx
ON deployment_locations (deployment_id) WHERE is_primary = true;

ALTER TABLE time_records
  ADD COLUMN IF NOT EXISTS clock_in_location_id UUID REFERENCES company_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clock_out_location_id UUID REFERENCES company_locations(id) ON DELETE SET NULL;
