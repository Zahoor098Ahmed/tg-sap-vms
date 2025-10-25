const http = require('http');

const data = JSON.stringify({ name: 'SMTP Live Test', email: 'zahoorjamali32@gmail.com' });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
    try {
      const parsed = JSON.parse(body);
      console.log('Parsed:', parsed);
    } catch (e) {
      console.error('JSON parse error:', e.message);
    }
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('Request error:', err);
  process.exit(1);
});

req.write(data);
req.end();