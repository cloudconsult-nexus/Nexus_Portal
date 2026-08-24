// Minimal structured logging for NCC calls (build brief: "Add basic
// structured logging around auth and each call (status, latency, tenant)
// — useful for debugging with Patrick if something doesn't match the
// documented behavior"). No logging library is used elsewhere in this
// codebase (morgan is HTTP-access-log only) — this stays a thin
// single-line-JSON wrapper rather than pulling in a new dependency for
// one adapter module.
export function nccLog(fields) {
  console.log(JSON.stringify({ component: 'ncc-client', at: new Date().toISOString(), ...fields }));
}
