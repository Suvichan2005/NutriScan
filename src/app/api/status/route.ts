import { reply } from '@/lib/server/http';
import { providerStatus } from '@/lib/server/gemini';
import { geminiDiagnosticsEnabled } from '@/lib/server/gemini-diagnostics';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = () => reply({
  status: 'ok',
  gemini: providerStatus(),
  publicSources: { products: 'Open Food Facts; explicit search only', science: 'Europe PMC; explicit search only', regulation: 'FSSAI/WHO fixed primary discovery pages; no current-law verdict', recalls: 'US FDA historical food enforcement candidates only; not a live alert or Indian recall service' },
  privacy: geminiDiagnosticsEnabled()
    ? 'A local-development Gemini trace is enabled. It records readable question/OCR and provider text plus returned usage metadata; profile values and prior turns are redacted, image bytes are omitted (hash/size only), and hidden reasoning text is not exposed. Trace files stay in ignored local .data storage; hosted and default builds keep tracing disabled.'
    : 'Images and profiles stay in the browser until an explicitly consented remote request. Gemini diagnostic tracing is disabled unless both local-only opt-in flags are enabled; it never runs in hosted builds.',
  mode: 'local-development',
});
