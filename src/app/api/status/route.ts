import { reply } from '@/lib/server/http';
import { providerStatus } from '@/lib/server/gemini';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = () => reply({ status: 'ok', gemini: providerStatus(), publicSources: { products: 'Open Food Facts; explicit search only', science: 'Europe PMC; explicit search only', regulation: 'FSSAI/WHO fixed primary discovery pages; no current-law verdict', recalls: 'US FDA historical food enforcement candidates only; not a live alert or Indian recall service' }, privacy: 'Images and profiles stay in the browser until an explicitly consented remote request. No raw request or provider response logs.', mode: 'local-development' });
