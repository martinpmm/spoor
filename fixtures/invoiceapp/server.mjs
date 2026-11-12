// Fake web app for Spoor's end to end tests and manual checks.
// Pages: invoice list, detail, edit form, login (password), payment (card), one time code,
// file upload and a single page app section. No dependencies.
//
//   node fixtures/invoiceapp/server.mjs [port]     (default 4321)
import http from 'node:http';

const layout = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · InvoiceApp</title>
<style>
  body{font:15px system-ui,sans-serif;margin:0;background:#f5f5f4;color:#1c1917}
  nav{background:#1c1917;padding:10px 20px;display:flex;gap:16px}
  nav a{color:#fafaf9;text-decoration:none}
  main{max-width:720px;margin:24px auto;background:#fff;padding:24px;border-radius:10px}
  label{display:block;margin:12px 0 4px;font-weight:600}
  input,select,textarea{font:inherit;padding:6px 8px;width:100%;box-sizing:border-box}
  input[type=checkbox]{width:auto}
  button{font:inherit;padding:8px 14px;margin-top:16px;cursor:pointer}
  table{width:100%;border-collapse:collapse} td,th{padding:6px;border-bottom:1px solid #e7e5e4;text-align:left}
</style></head>
<body><nav><a href="/invoices">Invoices</a><a href="/login">Login</a><a href="/pay">Pay</a><a href="/verify">Verify</a><a href="/upload">Upload</a><a href="/app/inbox">Mail app</a></nav>
<main>${body}</main></body></html>`;

const invoices = [
  { id: 1001, customer: 'Acme Corp', amount: '1200.00', iban: 'ES91 2100 0418 4502 0005 1332' },
  { id: 1002, customer: 'Globex', amount: '640.50', iban: 'DE89 3704 0044 0532 0130 00' },
];

const pages = {
  '/invoices': () =>
    layout(
      'Invoices',
      `<h1>Invoices</h1>
      <table><tr><th>#</th><th>Customer</th><th>Amount</th></tr>
      ${invoices.map((i) => `<tr><td><a href="/invoices/${i.id}">${i.id}</a></td><td>${i.customer}</td><td>${i.amount}</td></tr>`).join('')}
      </table>
      <button id="new-invoice" type="button" onclick="location.href='/invoices/new'">New invoice</button>`,
    ),
  '/invoices/new': () => layout('New invoice', '<h1>New invoice</h1><p>Not implemented.</p>'),
  '/login': () =>
    layout(
      'Login',
      `<h1>Sign in</h1>
      <form id="login" action="/invoices" method="get">
        <label for="username">User name</label><input id="username" name="username" autocomplete="username">
        <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
        <label for="newpw">New password</label><input id="newpw" name="np" autocomplete="new-password">
        <input type="hidden" name="csrf" value="HIDDEN-CSRF-VALUE">
        <button type="submit">Sign in</button>
      </form>`,
    ),
  '/pay': () =>
    layout(
      'Payment',
      `<h1>Pay invoice</h1>
      <form id="pay" action="/invoices" method="get">
        <label for="ref">Billing reference</label><input id="ref" name="reference">
        <label for="cc">Card number</label><input id="cc" name="ccnum" autocomplete="cc-number" inputmode="numeric">
        <label for="ccname">Name on card</label><input id="ccname" name="holder" autocomplete="cc-name">
        <label for="exp">Expiry</label><input id="exp" name="exp" autocomplete="cc-exp">
        <label for="cvv">CVV</label><input id="cvv" name="cvv">
        <label for="pin">PIN</label><input id="pin" name="pin">
        <label for="clave">Clave de firma</label><input id="clave" name="firma">
        <button type="submit">Pay now</button>
      </form>`,
    ),
  '/verify': () =>
    layout(
      'Verify',
      `<h1>Enter the code we sent you</h1>
      <form id="verify" action="/invoices" method="get">
        <label for="otp">Code</label><input id="otp" name="code" autocomplete="one-time-code">
        <label for="apitoken">API token</label><input id="apitoken" name="t">
        <button type="submit">Verify</button>
      </form>`,
    ),
  '/upload': () =>
    layout(
      'Upload',
      `<h1>Attach a document</h1>
      <label for="file">Attachment</label><input id="file" type="file">`,
    ),
};

function detail(inv) {
  return layout(
    `Invoice ${inv.id}`,
    `<h1>Invoice ${inv.id}</h1>
    <p>Customer: <strong>${inv.customer}</strong></p>
    <p>IBAN: <span id="iban">${inv.iban}</span></p>
    <p>Amount: ${inv.amount}</p>
    <a id="edit" href="/invoices/${inv.id}/edit">Edit invoice</a>`,
  );
}

function edit(inv) {
  return layout(
    `Edit invoice ${inv.id}`,
    `<h1>Edit invoice ${inv.id}</h1>
    <form id="edit-form" action="/invoices/${inv.id}" method="get">
      <label for="customer">Customer</label><input id="customer" name="customer" value="${inv.customer}">
      <label for="amount">Amount</label><input id="amount" name="amount" type="number" step="0.01" value="${inv.amount}">
      <label for="status">Status</label><select id="status" name="status"><option>Draft</option><option>Sent</option><option>Paid</option></select>
      <label><input id="paid" type="checkbox" name="paid"> Mark as paid</label>
      <label for="notes">Notes</label><textarea id="notes" name="notes"></textarea>
      <button type="submit">Save invoice</button>
    </form>`,
  );
}

const spa = layout(
  'Mail',
  `<h1 id="view-title">Inbox</h1>
  <button id="go-inbox" type="button">Inbox</button>
  <button id="go-archive" type="button">Archive</button>
  <button id="go-message" type="button">Open message</button>
  <script>
    const show = (path, title) => { history.pushState({}, '', path); document.getElementById('view-title').textContent = title; document.title = title + ' · Mail'; };
    document.getElementById('go-inbox').onclick = () => show('/app/inbox', 'Inbox');
    document.getElementById('go-archive').onclick = () => show('/app/archive', 'Archive');
    document.getElementById('go-message').onclick = () => show('/app/message/8c2f1d9e-0b7a-4c55-9a51-2f3e4d5c6b7a', 'Message');
  </script>`,
);

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let html = null;
    const p = url.pathname.replace(/\/$/, '') || '/';
    if (p === '/') {
      res.writeHead(302, { location: '/invoices' });
      return res.end();
    }
    if (pages[p]) html = pages[p]();
    let m;
    if ((m = /^\/invoices\/(\d+)$/.exec(p))) {
      const inv = invoices.find((i) => i.id === Number(m[1]));
      if (inv) html = detail(inv);
    }
    if ((m = /^\/invoices\/(\d+)\/edit$/.exec(p))) {
      const inv = invoices.find((i) => i.id === Number(m[1]));
      if (inv) html = edit(inv);
    }
    if (p.startsWith('/app/')) html = spa;
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 4321);
  createServer().listen(port, '127.0.0.1', () => console.log(`InvoiceApp on http://localhost:${port}`));
}
