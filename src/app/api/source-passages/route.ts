import { input, route } from '@/lib/server/http';
import { passageQuerySchema, retrieveSourcePassages } from '@/lib/server/source-passages';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return route(request,'source-passages',async()=>{const body=await input(request,passageQuerySchema,2000);return retrieveSourcePassages(body.query);},20);}
