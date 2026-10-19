ALTER TABLE mops.form_sync_config ADD COLUMN IF NOT EXISTS composite_match boolean NOT NULL DEFAULT false;
UPDATE mops.form_sync_config SET composite_match = true, message_field = 'how_can_we_help_you', preflight_requested = true
WHERE property_id = 'a5f7eeea-dfe6-4ec2-a9eb-895d99c0c465';