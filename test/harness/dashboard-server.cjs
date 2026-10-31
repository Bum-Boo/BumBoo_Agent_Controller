// Minimal stand-in for the Hermes dashboard: answers 200 on every path.
const http = require('node:http');

const port = Number(process.argv[2]);
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('fake hermes dashboard');
}).listen(port, '127.0.0.1');
