/** Presentation boundaries only; this makes no judgment about a claim's meaning. */
export function splitProseSentences(text: string): string[] {
  const result: string[] = [];
  let pending = '';
  for (const segment of text.split(/(?<=[.!?])\s+(?=[\p{L}\p{N}"“])/u).filter(Boolean)) {
    pending += (pending ? ' ' : '') + segment;
    let depth = 0;
    for (const character of pending) {
      if ('([{'.includes(character)) depth += 1;
      else if (')]}'.includes(character)) depth -= 1;
    }
    const strongMarkers = (pending.match(/\*\*|__/g) ?? []).length;
    const codeMarkers = (pending.match(/`/g) ?? []).length;
    // A period can occur inside a parenthetical or Markdown
    // label. Never expose only the opening half after the next half is withheld.
    if (depth !== 0 || strongMarkers % 2 !== 0 || codeMarkers % 2 !== 0) continue;
    if (pending.trim()) result.push(pending.trim());
    pending = '';
  }
  if (pending.trim()) result.push(pending.trim());
  return result;
}

/** Remove structural shells emptied by filtering, without writing replacement prose. */
export function removeEmptyProseSections(text:string,originalText?:string):string{
  // A complete bold answer is not an empty section. Only remove its shell
  // when filtering actually removed the body that followed it.
  if(/^\s*\*\*[^*\n]+\*\*\s*$/.test(text)&&(!originalText||text.trim()===originalText.trim()))return text.trim();
  const lines=text.split('\n');
  const heading=(line:string):number|null=>{
    const markdown=line.match(/^\s*(#{1,6})\s+/);if(markdown)return markdown[1].length;
    if(/^\s*[-*+]\s+\*\*[^*]+:?\*\*:?\s*$/.test(line))return 10;
    return /^\s*\*\*[^*]+:?\*\*:?\s*$/.test(line)?6:null;
  };
  const rule=(line:string)=>/^\s*(?:---+|\*\*\*+)\s*$/.test(line);
  return lines.filter((line,index)=>{
    const level=heading(line);if(level===null)return true;
    for(const next of lines.slice(index+1)){
      if(!next.trim()||rule(next))continue;
      const nextLevel=heading(next);if(nextLevel===null)return true;
      if(nextLevel<=level)return false;
    }
    return false;
  }).join('\n').replace(/(?:\n\s*---\s*){2,}/g,'\n---\n').replace(/^\s*---\s*\n/,'').trim();
}
