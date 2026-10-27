import { conversationAnswerBlocks, separateLegacyAnswerNotice } from '@/lib/conversation-answer';
import type { ThreadAgentDiagnostics, ThreadAgentTrace } from '@/lib/thread-presentation';
import styles from './conversation-clarity.module.css';

function TextBlock({ text, kind }: { text: string; kind: 'paragraph' | 'heading' | 'list' }) {
  const lines = text.split('\n');
  if (lines.every(line => /^•\s/.test(line))) return <ul>{lines.map((line, index) => <li key={index}>{line.replace(/^•\s/, '')}</li>)}</ul>;
  return kind === 'heading' ? <p><strong>{text}</strong></p> : <p>{text}</p>;
}

export function ConversationAnswer({ answer, diagnostics, provisional }: { answer: string; diagnostics?: ThreadAgentDiagnostics; provisional?: boolean }) {
  const legacy = separateLegacyAnswerNotice(answer);
  const blocks = conversationAnswerBlocks(legacy.answer);
  const firstContent = blocks.findIndex(block => block.kind !== 'heading');
  const leadCount = firstContent < 0 ? blocks.length : firstContent + 1;
  // Disclosure follows paragraph boundaries only. No semantic selection or generated summary.
  const fold = legacy.answer.length > 900 && blocks.length > leadCount;
  const withheld = Boolean(diagnostics?.withheldQuantitySentences || legacy.withheld);
  const estimated = Boolean(diagnostics?.provisionalReconstructionQuantitySentences || provisional || legacy.provisional);
  return <div className={styles.answer}>
    {(fold ? blocks.slice(0, leadCount) : blocks).map((block, index) => <TextBlock key={index} {...block}/>)}
    {fold && <details className={styles.details}><summary>Read full explanation</summary>{blocks.slice(leadCount).map((block, index) => <TextBlock key={index} {...block}/>)}</details>}
    {(withheld || estimated) && <details className={styles.notes}><summary>{estimated ? 'Label estimates' : 'Answer notes'}{withheld ? ' · some details excluded' : ''}</summary>
      {estimated && <p>Some figures come from unconfirmed label readings. You can inspect or correct them in Package details.</p>}
      {withheld && <p>The application withheld numerical statements that did not match the available values, units or measurement basis. The remaining answer is shown above.</p>}
    </details>}
  </div>;
}

const toolLabels: Record<string, string> = {
  calculate_nutrition: 'Calculated portion', get_nutrition_guidance: 'Checked nutrition guidance',
  resolve_ingredient: 'Checked ingredient identity', get_substance_assessments: 'Looked up scientific assessments',
  inspect_package_image: 'Inspected a label photo', search_knowledge: 'Searched reference sources',
  lookup_product: 'Looked up a product record', search_literature: 'Searched scientific literature',
};

export function ConversationToolActivity({ trace }: { trace?: ThreadAgentTrace[] }) {
  if (!trace?.length) return null;
  const label = (step: ThreadAgentTrace) => toolLabels[step.name] ?? step.name.replace(/_/g, ' ');
  return <details className={styles.activity} aria-label="Tool activity">
    <summary>{trace.slice(0, 2).map(label).join(' · ')}{trace.length > 2 ? ` · +${trace.length - 2} more` : ''}</summary>
    <ol>{trace.map((step, index) => <li key={`${step.name}-${index}`}><span>{label(step)}</span><small>{step.status === 'ok' ? 'Completed' : step.status === 'cached' ? 'Reused recorded result' : step.status} · {step.resultCount} result{step.resultCount === 1 ? '' : 's'} · {step.elapsedMs < 1000 ? '<1 s' : `${(step.elapsedMs / 1000).toFixed(1)} s`}<br/><code>{step.name}</code></small></li>)}</ol>
  </details>;
}
