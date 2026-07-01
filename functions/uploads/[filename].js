// 通过 R2 提供已上传文件的访问（替代原 Express 的 /uploads 静态目录）
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const filename = decodeURIComponent(url.pathname.replace('/uploads/', ''));
  const key = `uploads/${filename}`;

  const obj = await env.FILES.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(obj.body, { headers });
}
