ALTER TABLE contacts ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
CREATE FUNCTION bump_contact_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.version = OLD.version + 1; RETURN NEW; END; $$;
CREATE TRIGGER contacts_version BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION bump_contact_version();
ALTER TABLE import_jobs ADD COLUMN duplicate_count integer NOT NULL DEFAULT 0 CHECK(duplicate_count >= 0);
ALTER TABLE import_jobs ADD COLUMN processed_count integer NOT NULL DEFAULT 0 CHECK(processed_count >= 0);
ALTER TABLE import_jobs ADD CONSTRAINT import_progress_valid CHECK(processed_count <= row_count AND imported_count + error_count + duplicate_count = processed_count);
CREATE TABLE import_chunks (
 job_id uuid NOT NULL REFERENCES import_jobs(id), chunk_index integer NOT NULL CHECK(chunk_index >= 0),
 request_hash text NOT NULL, results jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,chunk_index)
);
CREATE TABLE api_rate_buckets (
 actor text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL DEFAULT 1, PRIMARY KEY(actor,bucket)
);
CREATE INDEX contacts_name_id_idx ON contacts(lower(name),id);
CREATE INDEX contacts_status_idx ON contacts(consent_status,archived_at);
CREATE INDEX imports_actor_idx ON import_jobs(created_by,created_at DESC);
