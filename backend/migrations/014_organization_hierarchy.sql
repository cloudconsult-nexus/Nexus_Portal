-- Reintroduces a parent/child relationship on organizations (Customers),
-- explicitly requested by the client after Phase 5.1 flattened the model —
-- see CLAUDE.md for the "why" and the RBAC-scope caveat (visibility scope
-- is unchanged; this is display/data nesting only). Purely additive and
-- nullable: every existing Customer defaults to top-level (no parent)
-- until someone sets one via the app, so this needs no data migration.
ALTER TABLE organizations ADD COLUMN parent_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX idx_organizations_parent_id ON organizations (parent_id) WHERE parent_id IS NOT NULL;
