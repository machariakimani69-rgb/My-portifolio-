const { handleRequest, initializeApplication } = require('../server.js');

module.exports = async function handler(request, response) {
  try {
    await initializeApplication();
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const routePath = requestUrl.searchParams.get('__vercel_path') || '/';
    requestUrl.searchParams.delete('__vercel_path');
    request.url = `${routePath}${requestUrl.search}`;
    return await handleRequest(request, response);
  } catch (error) {
    console.error('Vercel request could not be handled:', error);
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ error: 'The request could not be completed.' }));
  }
};
