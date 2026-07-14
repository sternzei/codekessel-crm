-- RLS for contact_notes (grants inherited via ALTER DEFAULT PRIVILEGES in 0001).
ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contact_notes FOR ALL TO qcg_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
