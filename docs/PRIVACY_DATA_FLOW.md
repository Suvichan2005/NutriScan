# Privacy and data flow

Photos: selected file → local browser Blob → bounded canvas/prepared image → local Tesseract worker/WASM → OCR observations in memory. Worker and English language data and fonts are served from this local installation. Originals are not posted to an API by ordinary scanning. Removed/replaced/new-scan blobs are released. Browser memory is not a secure vault.

Health context: dietary preferences, allergies/intolerances, user-declared health considerations, goals and optional reference details stay in React memory for the session. The profile starts empty, does not ask for meal measurements, is not saved in IndexedDB, and is excluded from JSON exports. Derived calculation assumptions/results may appear in reports. Review reports before sharing. A user must consent before any profile text is sent to Gemini. Public search sends only the search text entered in the research panel. No account, cloud sync or encryption claim.

Saved scans: opt-in IndexedDB on this browser profile, up to20 extracted label records. They include raw OCR text, potentially identifiers printed on packaging and user corrections. They exclude original photos and free-text health context. History can be cleared; exported files are not removed by clearing browser history. Shared browser-profile access can expose saved scans.

Public search: explicit user action sends the visible product/science/recall search terms through this loopback server to fixed public source APIs. The UI warns not to place personal medical details in public terms. Local semantic queries stay on the server machine and use a predownloaded model; they never transmit query text to Hugging Face.

Gemini: default disabled. Requires server-only key, model, explicit enable flag and request consent. Synthesis sends extracted label, question, optional profile, source summaries and image-handle metadata. Browser retains image bytes until a disclosed image-send action. Original/cropped image request is validated against session handles. Image route validates signatures, decodes bounded dimensions and strips metadata before Google transmission. Provider retention/billing policies apply; local-first does not imply private cloud inference.

No raw medical context, photos, keys or conversations are intentionally logged by application code. Development framework logs request paths/compilation status. Request IDs and response metadata are non-content receipts. Public source responses are untrusted and rendered as text, never HTML instructions.

API surface: same-origin local-only POST, fixed remote hosts/no redirects, body/response limits, timeouts and in-process request/concurrency limits. These are local development protections, not authenticated multi-tenant production controls. No Firebase, production writes, public tunnel or deployment.
