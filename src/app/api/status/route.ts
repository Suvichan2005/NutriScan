import { reply } from '@/lib/server/http';
import { providerStatus } from '@/lib/server/gemini';
import { geminiDiagnosticsEnabled } from '@/lib/server/gemini-diagnostics';
import { geminiEvaluationCaptureEnabled } from '@/lib/server/gemini-evaluation-recorder';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = () => {
  const readableEvaluationCapture = geminiEvaluationCaptureEnabled();
  return reply({
    status: 'ok',
    gemini: providerStatus(),
    publicSources: { products: 'Open Food Facts; explicit search only', science: 'Europe PMC; explicit search only', regulation: 'FSSAI/WHO fixed primary discovery pages; no current-law verdict', recalls: 'US FDA historical food enforcement candidates only; not a live alert or Indian recall service' },
    privacy: `Images and profiles stay in the browser until an explicitly consented remote request. Sanitized operational telemetry omits prompt text, OCR contents, model answers, profile details, tool arguments, image bytes and hidden reasoning. Readable evaluation transcripts are ${readableEvaluationCapture ? 'enabled only by explicit opt-in in local development' : 'disabled'} and are written to ignored local storage with image bytes, credentials and hidden reasoning omitted.`,
    developerDiagnostics: {
      sanitizedOperationalTrace: geminiDiagnosticsEnabled(),
      readableEvaluationCapture,
    },
    mode: 'local-development',
  });
};
