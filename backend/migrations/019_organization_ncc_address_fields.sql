-- NCC dev/release plan (call with Patrick Hoye and Steve Newell,
-- 2026-09-04), Phase B's open scope item: organizations.address was a
-- single free-text field, so services/ncc-client/index.js#pushOrganizationToNcc
-- (Phase B1/B2, shipped Release 1, 2026-09-07) could only sync
-- name/phone/address to NCC's Create/Update Customer, leaving NCC's
-- structured city/state/zip/country/slaPeriod fields NCC-side-only.
--
-- Captured here as real columns (not folded into the existing free-text
-- `address`) so the Customer create/edit UI can collect them structurally
-- and the NCC push can sync a fuller Customer record. `address` itself is
-- kept as-is (a street address line) — city/state/zip/country are the
-- separate structured pieces NCC's schema wants alongside it.
--
-- sla_period is intentionally TEXT, not an enum/interval: NCC's own field
-- (services/ncc-client/customers.js#createCustomer's `slaPeriod`) has no
-- documented value set (custom object, not a native Thrio type — see the
-- dev/release plan's Section 0) and is only ever passed through, never
-- interpreted by the Portal itself.
ALTER TABLE organizations
  ADD COLUMN city TEXT,
  ADD COLUMN state TEXT,
  ADD COLUMN zip TEXT,
  ADD COLUMN country TEXT,
  ADD COLUMN sla_period TEXT;
