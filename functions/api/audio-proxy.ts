/**
 * Cloudflare Pages Function - Audio Proxy
 * Bypass CORS restrictions for music streaming
 */

const ALLOWED_DOMAINS = [
  'music.163.com',
  'y.qq.com',
  'dl.stream.qqmusic.qq.com',
  'kuwo.cn',
  'sycdn.kuwo.cn',
  'kugou.com',
  'bilibili.com',
  'bilivideo.com',
  'migu.cn',
];

interface Env {
  // Add environment variables if needed
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    const targetHost = new URL(decodedUrl).hostname;

    // Validate domain
    const isAllowed = ALLOWED_DOMAINS.some(
      (domain) => targetHost.endsWith(domain) || targetHost === domain
    );

    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Proxy the request
    const response = await fetch(decodedUrl, {
      method: request.method,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: `https://${targetHost}/`,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
      },
      redirect: 'follow',
    });

    // Get content type
    const contentType = response.headers.get('Content-Type') || 'audio/mpeg';

    // Return proxied response
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Content-Length': response.headers.get('Content-Length') || '',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({ error: 'Proxy request failed', details: String(error) }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};
