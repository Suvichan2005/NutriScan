# Regulatory research snapshot: Indian label rules

Checked: 21 October 2026 IST. This is a dated research note, not a legal opinion, a consolidated-code check, or a package-compliance finding. Recheck the official Gazette and FSSAI record before applying it to a product or date.

## Verified primary-source event

FSSAI's labelling-amendment index lists five amendments to the Food Safety and Standards (Labelling and Display) Regulations, 2020. The latest listed entry is Amendment No. 5 dated 24 March 2026. The linked Gazette notification calls itself the **Food Safety and Standards (Labelling and Display) First Amendment Regulations, 2026** and states that it comes into force on **1 July 2027**. This is a final notification with a future commencement date, not a draft and not a basis for saying the amended provisions are already in force on this snapshot date.

The notification text includes changes concerning per-serve RDA and servings-per-pack declarations for defined infant nutrition products; the scope of nutrition-information exemptions for certain minimally processed or single-ingredient foods; notified logos on packages of no more than 100 cm², with information to be given on multi-unit packs; and labeling information for non-retail containers, including traceability and accompanying documents in specified cases. These are topic summaries only. Product-category definitions, the exact amended clauses, other applicable rules, directions, orders, and later changes must be checked against the full Gazette text before making a product-specific statement.

## Source record

- FSSAI labelling and display amendment index: <https://fssai.gov.in/food-law/regulations/amendments/labelling-display>. The indexed page lists amendment dates through 24 March 2026; search indexing is a discovery aid, not a substitute for the Gazette.
- FSSAI Gazette notification, dated 24 March 2026: <https://www.fssai.gov.in/upload/notifications/2026/04/69cca2b3f3ce9Notification%20dt%2024.03.2026_NRC.pdf>. The official document states the 1 July 2027 commencement and sets out the clauses summarized above.
- FSSAI ordinary notifications page: <https://fssai.gov.in/food-law/notifications?notification=ordinary-notification>. The official page identifies the 2026 amendment as a final notification and gives the FSSAI upload date as 30 March 2026.

## ORS naming and case history (separate issue)

FSSAI's 11 April 2022 direction says food businesses must not use “ORS” with a brand name for products that are not compliant with the applicable WHO-recommended ORS formulation. On 14 October 2025, FSSAI withdrew its 14 July 2022 and 2 February 2024 orders that had permitted certain use of “ORS” with brand names; the withdrawal says it has immediate effect. FSSAI's 15 October 2025 clarification directs food businesses to remove “ORS” from food-product names and says the 2022 direction remains in force. These are distinct dated actions; this summary is not a complete consolidated review of all governing rules or subsequent proceedings.

In *Dr Reddy's Laboratories v Union of India*, W.P.(C) 16303/2025, decided 31 October 2025, the Delhi High Court dismissed that petition and did not interdict the challenged FSSAI measures. It directed FSSAI to consider the petitioner's representation concerning existing inventory. That case-specific disposition does not decide every product's composition, labeling, party or legal position, and this snapshot does not establish whether a particular item complies.

- FSSAI direction, 11 April 2022: <https://www.fssai.gov.in/upload/advisories/2022/04/6253ddfde2161Direction_advertisement_ORS_11_04_2022.pdf>.
- FSSAI order, 2 February 2024: <https://www.fssai.gov.in/upload/advisories/2024/02/65c0d35e786e4Order%20dated%2002nd%20Feb%202024_Use%20of%20term%20ORS.pdf>. NutriScan can extract selectable text from this official PDF, but the order is historical: the later 14 October 2025 FSSAI withdrawal says it withdrew this prior permission.
- FSSAI withdrawal, 14 October 2025: <https://www.fssai.gov.in/upload/advisories/2025/10/68ee3ba06bb7eWithdrawal%20of%20Orders%20regarding%20Usage%20of%20the%20term%20ORS%20along%20with%20brand%20names%20dt%2014.10.2025.pdf>.
- FSSAI clarification, 15 October 2025: <https://fssai.gov.in/upload/advisories/2025/10/68ef8cea74223clarification_151025.pdf>.
- Delhi High Court judgment, 31 October 2025: <https://delhihighcourt.nic.in/app/showFileJudgment/58731102025CW163032025_193432.pdf>.

The official FSSAI pages and targeted official-source searches checked on 21 October 2026 did not surface a later ORS-specific item. Search coverage is not proof that no later order, case or product-specific determination exists. A fresh same-origin route and Chrome run retrieved selectable text from the 2022 direction and the superseded 2024 order. The two 2025 FSSAI PDFs still have no usable selectable text in the route; a separate local OCR diagnostic extracted their pages at 81–91% mean confidence with broad token checks, but the output was not manually verified and is not fed into the route. Court-judgment extraction varied across the paired browser attempts. This is historical source retrieval, not a current-law answer. Any product-specific conclusion still requires the exact product/variant, label and question, plus current source verification.

## Limitations and engineering implication

The running `/api/research` implementation discovers these dated official references and performs bounded PDF extraction with a 2 MB per-source limit. It reads the 2022 direction and superseded 2024 order, while the two 2025 FSSAI PDFs require OCR; court-PDF retrieval was inconsistent across the paired browser runs. The reproducible local diagnostic `npm run ocr:evaluate:regulatory-pdf` uses Poppler plus Tesseract.js on these public PDFs and stores only aggregate page metrics in `docs/evidence/regulatory-pdf-ocr-diagnostic.json`. It is not integrated into source retrieval and does not establish a verified transcription or legal interpretation. The route does not automate a current-law conclusion. A product-specific answer still needs the relevant consolidated rule, amendment history, commencement and any later direction or court order matched to product category, market and date. Preserve separate statuses for draft, final notification, published, effective, stayed, superseded and uncertain; publication alone is not the same as commencement.
