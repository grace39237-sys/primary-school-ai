# Deploy lesson (2026-11-24)

Every redeploy to the check site (and to origin) MUST bump the version
and the service-worker cache name — `APP_VERSION` in app.js and `CACHE`
in sw.js — even when the change is only a bug fix.

Why: the v2.2 fix round (commit e317da9) kept `APP_VERSION 'v2.2'` and
cache `primary-school-ai-v2.2`, identical to the pre-fix v2.2 (13b2850).
The test browser's installed service worker therefore kept serving the
old shell files, and the version line ('v2.2') could not tell the two
commits apart — the browser re-check showed the same two bugs the fix
had already removed in Node, while curl (which fetches server files,
not the browser's cached copies) could not catch it. The fix was a
pure version bump to v2.2.1, which makes the new service worker install
and replace the old cache.

Rule: a new commit that reaches any deployed site gets a new
`APP_VERSION` and a new `CACHE` name. The version line in the app is
the only way to tell builds apart on a phone or in a test browser.
