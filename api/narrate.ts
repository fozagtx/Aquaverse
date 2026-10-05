import { respond } from './_lib/handlers';

export function GET(request: Request): Promise<Response> {
  return respond('narrate', request);
}

export function POST(request: Request): Promise<Response> {
  return respond('narrate', request);
}
