# e2e fixtures

- `encrypted-e2e-pass.pdf` — one-page PDF whose text contains `password-removal-e2e`, AES-256 encrypted with user password `e2e-pass` (owner password `e2e-owner`). Regenerate with `buildMinimalPdf("password-removal-e2e")` and `qpdf --encrypt e2e-pass e2e-owner 256 -- in.pdf out.pdf` (qpdf ships in the Paperless image). The e2e container accepts byte-identical re-uploads, so reusing the file across runs is fine there; a Paperless instance configured to reject duplicates refuses the second upload (`duplicate_of`), so live test scripts need a second fixture with different bytes.
