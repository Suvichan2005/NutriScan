/** Display-only deduplication; does not change the saved identity or its provenance. */
export function reconstructedIdentity(identity: { brand: string | null; name: string | null; variant: string | null }): string {
  return [identity.brand, identity.name, identity.variant].filter((part): part is string => Boolean(part?.trim()))
    .reduce((title, part) => {
      const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const current = normalized(title), next = normalized(part);
      if (` ${current} `.includes(` ${next} `)) return title;
      if (` ${next} `.includes(` ${current} `)) return part;
      return [title, part].filter(Boolean).join(' ');
    }, '');
}
