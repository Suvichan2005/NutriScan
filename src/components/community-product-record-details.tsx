import type { ProductRecord } from '@/lib/contracts';

function displayAllergenTag(tag: string) {
  const label = tag.replace(/^[a-z]{2}:/i, '').replace(/[-_]+/g, ' ').trim();
  return label ? `${label.slice(0, 1).toLocaleUpperCase('en-IN')}${label.slice(1)}` : tag;
}

export function CommunityProductRecordDetails({ product }: { product: ProductRecord }) {
  const ingredients = product.ingredients.trim();
  const allergens = product.allergens.map(displayAllergenTag).filter(Boolean);

  return (
    <details className="details-block product-record-evidence">
      <summary>Ingredients and allergen tags · Open Food Facts</summary>
      <div className="source-content">
        <p>Community-record fields, not text read from this photo. They may be incomplete, outdated, or refer to another regional variant.</p>
        <p><strong>Ingredients listed in the record</strong></p>
        {ingredients ? <p className="record-ingredients">{ingredients}</p> : <p>No ingredient text is listed. This does not establish what the package contains.</p>}
        <p><strong>Allergen tags listed in the record</strong></p>
        {allergens.length ? <ul>{allergens.map((allergen, index) => <li key={`${allergen}-${index}`}>{allergen}</li>)}</ul> : <p>No allergen tags are listed. This does not confirm allergen absence from the package.</p>}
        <p className="fine-print">Check the exact package for current ingredient and allergen information.</p>
        <p className="fine-print">Open Food Facts data: the database is under ODbL and individual contents use the Database Contents License. <a href="https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/" target="_blank" rel="noreferrer">License information ↗</a></p>
      </div>
    </details>
  );
}
