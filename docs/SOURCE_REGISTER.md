# Integration source register

Reviewed 21 October 2026 IST. These entries describe API methods and source provenance; static documentation or a dated snapshot does not establish current law or medical advice.

| Source | Primary URL | Use and limits |
| --- | --- | --- |
| Open Food Facts official API guide | https://openfoodfacts.github.io/openfoodfacts-server/api/ | Exact v2 barcode lookup; explicitly says full-text search is not available in v2. Crowdsourced data, not manufacturer verification. |
| Open Food Facts Search-a-licious API | https://openfoodfacts.github.io/search-a-licious/users/ref-openapi/ | Fixed `/search` POST body, selected fields, bounded candidates. India tag plus local filtering; no local stock proof. |
| Europe PMC REST service | https://europepmc.org/RestfulWebService | JSON core search, publication metadata/abstract. Default search relevance does not establish evidence quality or applicability. |
| openFDA food-enforcement overview | https://open.fda.gov/apis/food/enforcement/ | Historical US enforcement records. FDA expressly warns against public-alert/lifecycle use; recorded status may not be updated. Does not establish Indian recalls or brand-wide safety. |
| openFDA endpoint usage | https://open.fda.gov/apis/food/enforcement/how-to-use-the-endpoint/ | Public fixed `/food/enforcement.json` endpoint; no key required for these bounded calls; selected search, limit and sort parameters. |
| openFDA searchable fields | https://open.fda.gov/apis/food/enforcement/searchable-fields/ | Product, firm, reason, classification, report/initiation dates, distribution and lot/code fields. Missing data stays missing. |
| Google GenAI Models SDK reference | https://googleapis.github.io/js-genai/release_docs/classes/models.Models.html | Official `models.generateContent` call; no provider invocation was performed. |
| Google GenAI GenerateContentConfig | https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html | `responseJsonSchema`, `responseMimeType`, bounded output tokens, abort signal, continuation disabled. Client abort cannot guarantee provider cancellation or avoid billing. |
| Google GenAI HttpOptions | https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html | SDK timeout, retry limit and custom bounded HTTPS fetch. Installed SDK types verified these options. |
| FSSAI regulations index | https://www.fssai.gov.in/cms/food-safety-and-standards-regulations.php | Fixed primary-source discovery URL. Actual server retrieval returned a client-rendered shell, so no content or current-law conclusion accepted. |
| FSSAI labelling amendments | https://fssai.gov.in/food-law/regulations/amendments/labelling-display | Fixed amendment-discovery page. Interactive review, Gazette text and effective dates remain necessary. A successful page fetch is not consolidated-law verification. |
| FSSAI Labelling and Display First Amendment Regulations, 2026 | https://www.fssai.gov.in/upload/notifications/2026/04/69cca2b3f3ce9Notification%20dt%2024.03.2026_NRC.pdf | Final Gazette notification dated 24 March 2026; the notification states commencement on 1 July 2027. The FSSAI amendment index lists it as amendment No. 5. Dated research note: [REGULATORY_SNAPSHOT.md](REGULATORY_SNAPSHOT.md). This does not establish consolidated current duties or package compliance. |
| WHO sugars guideline | https://www.who.int/publications/i/item/9789241549028 | Published 4 March 2015; general free-sugar population guidance, not a personal carbohydrate prescription. Live text retrieval succeeded. |
| WHO non-sugar sweeteners guideline | https://www.who.int/publications/i/item/9789240073616 | Published 15 May 2023; population guidance for weight/diet-related outcomes. It is not an individual additive toxicology or maximal-intake assessment. Live text retrieval succeeded. |

The core evidence engine has its own cited knowledge entries. Research discovery results retain retrieval and publication timestamps separately. Abstract excerpts, guideline landing pages and regulatory indexes require review before making a precise package-level conclusion.
