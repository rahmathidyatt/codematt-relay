ALTER TABLE templates ADD COLUMN source_waba text;
ALTER TABLE templates ADD COLUMN parameter_format text NOT NULL DEFAULT 'POSITIONAL';
CREATE TABLE template_sync_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), source_waba text, synced_at timestamptz
);
INSERT INTO template_sync_state(id) VALUES(true);
ALTER TABLE campaigns ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE campaigns ADD COLUMN audience_rules jsonb NOT NULL DEFAULT '{"mode":"all","tags":[],"match":"any","ids":[],"q":""}';
CREATE INDEX campaigns_updated_idx ON campaigns(updated_at DESC,id);
CREATE INDEX templates_name_idx ON templates(name,language);
