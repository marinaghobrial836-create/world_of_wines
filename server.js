const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const publicDir = path.join(__dirname, 'public');
const csvPath = path.join(__dirname, 'data', 'products.csv');
const storeEmail = 'worldofwines1@gmail.com';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100000) req.destroy(new Error('Request body is too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function text(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function orderEmail(order, recipientLabel) {
  const itemLines = order.items.map((item) => (
    `<li>${escapeHtml(item.name)} × ${item.quantity} — $${Number(item.unitPrice).toFixed(2)} each — $${Number(item.lineTotal).toFixed(2)} total</li>`
  )).join('');

  return `
    <h2>World of Wines order ${escapeHtml(order.orderId)}</h2>
    <p>Hello ${escapeHtml(recipientLabel)},</p>
    <p>Thank you for your purchase. Your order has been received for <strong>${escapeHtml(order.fulfillment)}</strong>.</p>
    <p><strong>Confirmation number: ${escapeHtml(order.orderId)}</strong></p>
    <h3>Customer</h3>
    <p>${escapeHtml(order.firstName)} ${escapeHtml(order.lastName)}<br>
    ${escapeHtml(order.email)}<br>${escapeHtml(order.phone)}<br>
    ${escapeHtml(order.address)}, ${escapeHtml(order.city)} ${escapeHtml(order.zip)}</p>
    <h3>Items</h3>
    <ul>${itemLines}</ul>
    <p><strong>Subtotal: $${Number(order.subtotal).toFixed(2)}</strong></p>
  `;
}

function orderSms(order) {
  const items = order.items.map((item) => `${item.name} x${item.quantity}`).join(', ');
  return `World of Wines confirmation ${order.orderId}: Thank you for your purchase! ${order.fulfillment} order: ${items}. Total $${Number(order.subtotal).toFixed(2)}.`;
}

async function sendOrderEmails(order) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS.replace(/\s/g, '') },
  });

  const from = process.env.SMTP_FROM || SMTP_USER;
  const customerHtml = orderEmail(order, order.firstName);
  const storeHtml = orderEmail(order, 'World of Wines');

  await Promise.all([
    transporter.sendMail({
      from,
      to: storeEmail,
      replyTo: order.email,
      subject: `New order ${order.orderId}`,
      html: storeHtml,
    }),
    transporter.sendMail({
      from,
      to: order.email,
      subject: `World of Wines order confirmation ${order.orderId}`,
      html: customerHtml,
    }),
  ]);

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
    const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      body: orderSms(order),
      from: TWILIO_FROM_NUMBER,
      to: order.phone,
    });
  } else {
    console.warn('SMS confirmation skipped: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable it.');
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && requestUrl.pathname === '/api/orders') {
    readJsonBody(req)
      .then(async (order) => {
        const required = ['orderId', 'firstName', 'lastName', 'email', 'phone', 'fulfillment', 'address', 'city', 'zip'];
        if (required.some((field) => !text(order[field])) || !['Delivery', 'Pickup'].includes(order.fulfillment) || !Array.isArray(order.items) || !order.items.length) {
          sendJson(res, 400, { error: 'Please provide all checkout details and at least one item.' });
          return;
        }

        await sendOrderEmails(order);
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => {
        console.error('Order email failed:', error.message);
        sendJson(res, 500, { error: 'We could not send the order confirmation. Please try again.' });
      });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/products') {
    fs.readFile(csvPath, (error, content) => {
      if (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unable to load product data');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });
    return;
  }

  let pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  pathname = pathname.replace(/^\/+/, '');
  const safePath = path.normalize(pathname).replace(/^\.(\.|\/)+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  sendFile(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`World of Wines app is running on ${HOST}:${PORT}`);
});
