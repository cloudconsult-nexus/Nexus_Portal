// Global Vitest setup (see vitest.config.js's setupFiles). Ensures the env
// vars route/middleware files read directly from process.env (JWT_SECRET,
// NCC_API_KEY, DB_*) are present before app.js — and anything that imports
// it — is ever loaded, without requiring a committed .env for CI.
//
// This file was missing from the repo (vitest.config.js referenced it, but
// it didn't exist — every test file failed at module resolution before any
// test ran, including ones with no DB/env dependency of their own, like
// errorHandling.test.js). Restored here as a minimal env bootstrap only;
// it intentionally does NOT attempt to rebuild tests/support/fixtures.js or
// tests/support/roleMatrix.js, which tests/roleAudit.test.js also imports
// and which reference the pre-Phase-5.1 5-tier role model — that's a
// separate, larger cleanup left for its own change.
//
// Values below are throwaway test-only defaults, never used outside `npm
// test` — real deployments set these via Secret Manager/Cloud Run env vars
// (see .env.example), never here.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-production-use';
process.env.NCC_API_KEY ??= 'test-ncc-api-key-not-for-production-use';
process.env.DB_HOST ??= 'localhost';
process.env.DB_PORT ??= '5432';
process.env.DB_USER ??= 'oncallpro';
process.env.DB_PASSWORD ??= 'localdevpassword';
process.env.DB_NAME ??= 'oncallpro_test';
