console.log('[API FILE LOADED] rep/[slug]');

export default async function handler(request: Request) {
  console.log('[API TEST] entrou no handler');

  return new Response(JSON.stringify({
    ok: true,
    route: '/api/rep/[slug]',
    timestamp: Date.now()
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
