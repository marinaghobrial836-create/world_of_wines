const nodemailer = require('nodemailer');
const twilio = require('twilio');

const storeEmail = 'worldofwines1@gmail.com';

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
    `<li>${escapeHtml(item.name)} x ${item.quantity} - $${Number(item.unitPrice).toFixed(2)} each - $${Number(item.lineTotal).toFixed(2)} total</li>`
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
    <p><strong>Total: $${Number(order.subtotal).toFixed(2)}</strong></p>
  `;
}

async function sendNotifications(order) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('Email service is not configured.');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const from = process.env.SMTP_FROM || SMTP_USER;

  await Promise.all([
    transporter.sendMail({
      from,
      to: storeEmail,
      replyTo: order.email,
      subject: `New order ${order.orderId}`,
      html: orderEmail(order, 'World of Wines'),
    }),
    transporter.sendMail({
      from,
      to: order.email,
      subject: `World of Wines order confirmation ${order.orderId}`,
      html: orderEmail(order, order.firstName),
    }),
  ]);

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const items = order.items.map((item) => `${item.name} x${item.quantity}`).join(', ');
    await client.messages.create({
      body: `World of Wines confirmation ${order.orderId}: Thank you for your purchase! ${order.fulfillment} order: ${items}. Total $${Number(order.subtotal).toFixed(2)}.`,
      from: TWILIO_FROM_NUMBER,
      to: order.phone,
    });
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const order = req.body || {};
  const required = ['orderId', 'firstName', 'lastName', 'email', 'phone', 'fulfillment', 'address', 'city', 'zip'];
  if (required.some((field) => !text(order[field])) || !['Delivery', 'Pickup'].includes(order.fulfillment) || !Array.isArray(order.items) || !order.items.length) {
    res.status(400).json({ error: 'Please provide all checkout details and at least one item.' });
    return;
  }

  try {
    await sendNotifications(order);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Order notification failed:', error.message);
    res.status(500).json({ error: 'We could not send the order confirmation. Please try again.' });
  }
};