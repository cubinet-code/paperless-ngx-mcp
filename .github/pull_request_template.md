## Summary

<!-- What does this PR do, and why? Link any related issues with "Fixes #123". -->

## Changes

<!-- Bullet list of the actual changes. -->
-

## Testing

<!-- How did you verify this works? -->
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npm run test:e2e` passes against the Paperless-ngx 3.2.1 container (`npm run test:e2e:up` first)
- [ ] Any new or changed request/response shape has an e2e test that round-trips against the container — unit tests with mocks alone don't count

## Checklist

- [ ] Tool descriptions in `src/tools/*.ts` are still accurate after this change
- [ ] No secrets, real Paperless URLs, or personal data in the diff
- [ ] If this changes the public tool surface, the README's "Available Tools" list (and the allowlist table, for a new verb) still matches
- [ ] New Paperless endpoints are in `WRAPPED` or `SKIPPED` (with a reason) in `tests/e2e/schema_coverage.e2e.test.ts`
- [ ] `CHANGELOG.md` has an entry for the change
