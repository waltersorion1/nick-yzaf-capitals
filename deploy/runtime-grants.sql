-- Run as migration owner AFTER migrations. Create LOGIN roles/passwords separately using protected provisioning.
-- These grants belong only to the pilot database, never an unrelated PostgreSQL cluster/database.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE nycap TO nycap_app, nycap_backup;
GRANT USAGE ON SCHEMA public TO nycap_app, nycap_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO nycap_app, nycap_backup;
GRANT INSERT, UPDATE ON companies, share_classes, users, shareholders, shareholdings,
  announcements, valuation_snapshots, dividend_records, opening_import_batches, sessions TO nycap_app;
GRANT INSERT ON holding_events, audit_logs TO nycap_app;
GRANT DELETE ON companies, share_classes, shareholders, sessions TO nycap_app;
-- No UPDATE/DELETE audits/events, no TRUNCATE, DDL, ownership, role creation or migration writes.
-- Functions use invoker permissions; holding-event triggers need shareholding UPDATE/audit INSERT above.
