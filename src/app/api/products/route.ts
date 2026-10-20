import { input, route } from '@/lib/server/http';
import { lookupProducts, productInput } from '@/lib/server/products';
export const runtime = 'nodejs';
export const POST = (request: Request) => route(request, 'products', async () => lookupProducts(await input(request, productInput, 2000)), 8);
