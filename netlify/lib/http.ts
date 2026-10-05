export function success(data: unknown) {
  return Response.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}
export function failure(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
