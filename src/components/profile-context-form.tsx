'use client';

import { hasUserContext, type Profile } from '@/lib/contracts';
import { ChevronDown } from 'lucide-react';
import styles from './profile-context-form.module.css';

type Props = {
  profile: Profile; onChange: (profile: Profile) => void;
  ready: boolean; saving: boolean; sharedWithGemini: boolean;
  remember: boolean; onRemember: (value: boolean) => void;
  onContinue: (share: boolean) => void; onClear?: () => void;
};

const fields: Array<{ key: keyof Profile; label: string; max: number; placeholder: string }> = [
  { key: 'dietaryPattern', label: 'Dietary pattern or preferences', max: 500, placeholder: 'Optional; in your own words' },
  { key: 'avoidedIngredients', label: 'Ingredients or foods to avoid', max: 1000, placeholder: 'Optional; separate entries with commas' },
  { key: 'allergies', label: 'Food allergies', max: 1000, placeholder: 'Optional; exact terms' },
  { key: 'intolerances', label: 'Food intolerances', max: 1000, placeholder: 'Optional' },
  { key: 'portionPreferences', label: 'Portion preferences', max: 500, placeholder: 'How you prefer amounts compared' },
  { key: 'goals', label: 'What are you trying to understand?', max: 1000, placeholder: 'A label, ingredient, food choice or another question' },
];

/** One form serves first-run onboarding and later context edits. All context is optional. */
export function ProfileContextForm(props: Props) {
  const { profile } = props;
  const hasContext = hasUserContext(profile);
  const disabled = !props.ready || props.saving;
  return <><div className={`dialog-body ${styles.form}`}>
    <p className={styles.intro}>Skip anything that does not help. Tell NutriScan what matters to you.</p>
    <div className={styles.grid}>{fields.map(field => <label className="field-label" key={field.key}>{field.label}<textarea
      value={profile[field.key]} rows={2} maxLength={field.max} placeholder={field.placeholder}
      onChange={event => props.onChange({ ...profile, [field.key]: event.target.value })}/></label>)}</div>
    <label className="field-label">Health considerations or professional guidance<textarea value={profile.healthConsiderations} rows={3} maxLength={1500} placeholder="Optional; use your own words" onChange={event => props.onChange({ ...profile, healthConsiderations: event.target.value })}/></label>
    <p className={styles.hint}>Optional, self-reported context. Label text cannot establish individual medical safety or rule out cross-contact.</p>
    <details className="details-block"><summary>More context, only when relevant<ChevronDown size={16} aria-hidden="true"/></summary><div className={styles.grid}>
      {([{ key: 'ageGroup', label: 'Age group', max: 80 }, { key: 'sexOrReferenceGroup', label: 'Sex or reference group', max: 100 }, { key: 'country', label: 'Country', max: 80 }, { key: 'locality', label: 'City or PIN', max: 100 }] as const).map(field => <label className="field-label" key={field.key}>{field.label}<input value={profile[field.key]} maxLength={field.max} placeholder="Optional" onChange={event => props.onChange({ ...profile, [field.key]: event.target.value })}/></label>)}
    </div></details>
    <div className={styles.sharing}><strong>{props.sharedWithGemini && hasContext ? 'This context is included in your Gemini questions' : 'Choose how this context is used'}</strong>
      <p>“Use in AI answers” includes this context with questions sent to Google Gemini. “Keep local” uses it only on this device. Saving this form sends nothing.</p>
    </div>
    <label className={`save-toggle ${styles.remember}`}><input type="checkbox" checked={props.remember} disabled={disabled || (!props.remember && !hasContext)} onChange={event => props.onRemember(event.target.checked)}/>Remember this context on this device</label>
    <details className={styles.storage}><summary>Storage details</summary><p>Otherwise it stays in this tab for the session. Remembered context is stored separately from scans, is not encrypted or synced, and does not grant automatic sharing on future visits.</p></details>
    </div><div className={styles.actions}>
      {hasContext && <small className={styles.actionHint}>AI sharing sends this context to Google Gemini when you ask a question.</small>}
      {props.onClear && <button type="button" className="text-button" disabled={disabled} onClick={props.onClear}>Clear context</button>}
      {hasContext && <button type="button" className="secondary-button" disabled={disabled} onClick={() => props.onContinue(false)}>Keep local</button>}
      <button type="button" className="primary-button" disabled={disabled} onClick={() => props.onContinue(hasContext)}>{props.saving ? 'Saving…' : hasContext ? 'Use in AI answers' : 'Skip for now'}</button>
    </div>
  </>;
}
