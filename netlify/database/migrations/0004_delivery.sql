ALTER TABLE campaigns ADD COLUMN delivery_mode text CHECK(delivery_mode IN ('live','demo'));
ALTER TABLE campaigns ADD COLUMN source_waba text;
ALTER TABLE campaigns ADD COLUMN sender_id text;
ALTER TABLE campaigns ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN parent_id uuid REFERENCES campaigns(id);
ALTER TABLE campaigns ADD COLUMN pause_reason text;
ALTER TABLE campaign_recipients ADD COLUMN message_parameters jsonb;
ALTER TABLE campaign_recipients ADD COLUMN phone_snapshot text;
ALTER TABLE dispatch_outbox ADD COLUMN generation integer NOT NULL DEFAULT 1;
ALTER TABLE dispatch_outbox ADD COLUMN lease_token uuid;
ALTER TABLE dispatch_outbox ADD COLUMN lease_expires_at timestamptz;
CREATE UNIQUE INDEX outbox_campaign_idx ON dispatch_outbox(campaign_id);
CREATE INDEX message_events_unmatched_idx ON message_events(provider_message_id) WHERE recipient_id IS NULL;
CREATE TABLE delivery_control (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), lease_token uuid, lease_expires_at timestamptz,
 next_send_at timestamptz NOT NULL DEFAULT now(), last_scheduler_at timestamptz,
 last_worker_at timestamptz, last_webhook_at timestamptz
);
INSERT INTO delivery_control(id) VALUES(true);
ALTER TABLE message_events ADD COLUMN source_waba text;
ALTER TABLE message_events ADD COLUMN sender_id text;
CREATE TABLE contact_suppressions (
 phone_e164 text PRIMARY KEY, opted_out_at timestamptz NOT NULL
);
