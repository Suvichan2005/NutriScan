import { reply } from '@/lib/server/http';
import { providerStatus } from '@/lib/server/gemini';
import { geminiDiagnosticsEnabled } from '@/lib/server/gemini-diagnostics';
import { geminiEvaluationCaptureEnabled } from '@/lib/server/gemini-evaluation-recorder';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = () => {
  const localEvaluationMetadataCapture = geminiEvaluationCaptureEnabled();
  return reply({
    status: 'ok',
    gemini: providerStatus(),
    publicSources: { products: 'Open Food Facts; explicit search only', science: 'Europe PMC; explicit search only', regulation: 'FSSAI/WHO fixed primary discovery pages; no current-law verdict', recalls: 'US FDA historical food enforcement candidates only; not a live alert or Indian recall service' },
    privacy: `Images and profiles stay in the browser until an explicitly consented remote request. Operational telemetry omits prompt text, OCR contents, model answers, profile details, tool arguments, image bytes and hidden reasoning. Local development evaluation capture is metadata-only and ${localEvaluationMetadataCapture ? 'enabled by explicit opt-in' : 'disabled'}.`,
    developerDiagnostics: {
      sanitizedOperationalTrace: geminiDiagnosticsEnabled(),
      readableEvaluationCapture: false,
      localEvaluationMetadataCapture,
    },
    mode: 'local-development',
  });
};
