CREATE TABLE contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
 phone_e164 text NOT NULL UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
 consent_status text NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','active','revoked')),
 consent_source text, consent_at timestamptz, opted_out_at timestamptz, opt_out_source text, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (consent_status <> 'active' OR (length(trim(consent_source)) > 0 AND consent_source IS NOT NULL AND consent_at IS NOT NULL AND (opted_out_at IS NULL OR consent_at > opted_out_at)))
);
CREATE TABLE consent_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES contacts(id),
 status text NOT NULL CHECK (status IN ('unknown','active','revoked')), source text NOT NULL CHECK(length(trim(source)) > 0),
 occurred_at timestamptz NOT NULL, actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80));
CREATE TABLE contact_tags (contact_id uuid REFERENCES contacts(id), tag_id uuid REFERENCES tags(id), PRIMARY KEY(contact_id,tag_id));
CREATE TABLE templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id text NOT NULL, name text NOT NULL, language text NOT NULL,
 category text NOT NULL, status text NOT NULL DEFAULT 'UNAVAILABLE', components jsonb NOT NULL DEFAULT '[]',
 synced_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider_id,language)
);
CREATE TABLE campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 template_id uuid REFERENCES templates(id), template_snapshot jsonb, audience_snapshot jsonb, variable_mapping jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','queued','sending','paused','completed','canceled','failed')),
 scheduled_at timestamptz, timezone text NOT NULL DEFAULT 'Asia/Jakarta', created_by text NOT NULL,
 consent_confirmed_by text, consent_confirmed_at timestamptz, started_at timestamptz, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status <> 'scheduled' OR scheduled_at IS NOT NULL)
);
CREATE TABLE campaign_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id), contact_id uuid NOT NULL REFERENCES contacts(id),
 provider_message_id text UNIQUE, status text NOT NULL DEFAULT 'queued'
 CHECK(status IN ('queued','dispatching','accepted','sent','delivered','read','failed','skipped','uncertain')),
 failure_code text, failure_reason text, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
 lease_token uuid, lease_expires_at timestamptz, next_attempt_at timestamptz, dispatch_started_at timestamptz,
 accepted_at timestamptz, sent_at timestamptz, delivered_at timestamptz, read_at timestamptz, failed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,contact_id)
);
CREATE TABLE dispatch_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES campaigns(id),
 dedupe_key text NOT NULL UNIQUE, available_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhook_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, event_type text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, safe_metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE message_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid REFERENCES campaign_recipients(id),
 webhook_event_id uuid NOT NULL REFERENCES webhook_events(id), provider_message_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('sent','delivered','read','failed')), occurred_at timestamptz NOT NULL,
 UNIQUE(webhook_event_id,provider_message_id,status,occurred_at)
);
CREATE TABLE import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by text NOT NULL, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','processing','completed','failed')), row_count integer NOT NULL DEFAULT 0 CHECK(row_count >= 0),
 imported_count integer NOT NULL DEFAULT 0 CHECK(imported_count >= 0), error_count integer NOT NULL DEFAULT 0 CHECK(error_count >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, action text NOT NULL, entity text NOT NULL,
 entity_id text, safe_metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), workspace_name text NOT NULL DEFAULT 'codematt Relay',
 timezone text NOT NULL DEFAULT 'Asia/Jakarta', opt_out_keywords text[] NOT NULL DEFAULT ARRAY['STOP','UNSUBSCRIBE','BERHENTI']
);
INSERT INTO app_settings(id) VALUES(true);
CREATE INDEX campaigns_due_idx ON campaigns(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX recipients_work_idx ON campaign_recipients(campaign_id,status,next_attempt_at);
CREATE INDEX contacts_created_idx ON contacts(created_at DESC);
CREATE INDEX contact_tags_tag_idx ON contact_tags(tag_id);
CREATE INDEX consent_contact_idx ON consent_events(contact_id,occurred_at DESC);
CREATE INDEX outbox_pending_idx ON dispatch_outbox(available_at) WHERE published_at IS NULL;
CREATE INDEX message_events_time_idx ON message_events(occurred_at);
CREATE INDEX audit_time_idx ON audit_logs(created_at DESC);
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER recipients_touch BEFORE UPDATE ON campaign_recipients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
