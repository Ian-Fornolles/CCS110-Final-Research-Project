const PRIMARY_KEYS = {
  customers: 'customer_id', computers: 'computer_id', staff: 'staff_id',
  sessions: 'session_id', billing: 'bill_id', reservation: 'reservation_id'
};

const CURRENCY = '₱';

const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const PAYMENT_METHODS = ['Cash on Hand', 'Card', 'GCash'];

const COMPUTER_TYPES = {
  Standard: { rate: 25, specs: 'Core i3, 8GB RAM, 256GB SSD' },
  Gaming:   { rate: 40, specs: 'Core i7, 16GB RAM, RTX 3060' },
  VIP:      { rate: 60, specs: 'Core i9, 32GB RAM, RTX 4080' }
};

const VIEW_TITLES = { home: 'Home Page', computers: 'Computer Section', customers: 'Customer Section' };
const accounts = {
  owner: { username: '', password: '', contact_number: '', email: '' },
  staff: { username: '', password: '', contact_number: '', email: '' }
};
const db = { customers: [], computers: [], staff: [], sessions: [], billing: [], reservation: [] };
const app = { view: 'home', selectedComputer: null, user: null, role: null, staffId: null, ticks: 0, search: '' };
function assignAccount(role, username, password, contact_number = '', email = '') {
  if (!accounts[role]) throw new Error('Role must be "owner" or "staff".');
  Object.assign(accounts[role], { username: String(username), password: String(password), contact_number: String(contact_number), email: String(email) });
  return `Account assigned for ${role}`;
}
window.assignAccount = assignAccount;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nextId = table => Math.max(0, ...db[table].map(r => r[PRIMARY_KEYS[table]])) + 1;
const pad = n => String(n).padStart(2, '0');
const money = n => pesoFmt.format(Number(n) || 0);   // e.g. ₱1,250.50
const val = (root, id) => root.querySelector('#f_' + id).value;

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const formatDuration = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };

/* DATETIME columns: 'YYYY-MM-DD HH:MM:SS' */
const toDate = v => v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
const toSQL = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const formatDateTime = v => v ? toDate(v).toLocaleString() : '—';

/* reservation INT columns: reservation_date = YYYYMMDD, start_time / end_time = HHMM */
const dateToInt = s => +s.replace(/-/g, '');
const timeToInt = s => +s.replace(':', '');
const dateIntToStr = d => `${Math.floor(d / 10000)}-${pad(Math.floor(d / 100) % 100)}-${pad(d % 100)}`;
const timeIntToStr = t => `${pad(Math.floor(t / 100))}:${pad(t % 100)}`;
const intToDate = (d, t) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100, Math.floor(t / 100), t % 100);

/* Billing: hours_used DECIMAL(5,2), total_amount DECIMAL(10,2) -- all amounts are PHP, rounded to the centavo */
const calcHours = (start, end) => Math.round((toDate(end) - toDate(start)) / 36000) / 100;
const calcTotal = (hours, rate) => round2(hours * rate);

const findCustomer = id => db.customers.find(c => c.customer_id === +id);
const findComputer = id => db.computers.find(c => c.computer_id === +id);
const findSession = id => db.sessions.find(s => s.session_id === +id);
const findStaff = id => db.staff.find(s => s.staff_id === +id);
const computerName = id => findComputer(id) ? `PC-${pad(+id)}` : '—';
const customerName = id => findCustomer(id)?.customer_name ?? 'Unknown';

const activeSessions = () => db.sessions.filter(s => !s.end_time);
const activeReservations = () => db.reservation.filter(r => r.reservation_status === 'Reserved');
const customerTotal = id => round2(db.billing
  .filter(b => findSession(b.session_id)?.customer_id === id)
  .reduce((sum, b) => sum + b.total_amount, 0));

/* ================= Database rows -> app format ================= */
const asId = v => +v || 0;
const asDateTime = v => { if (v == null || v === '') return null; const d = toDate(v); return isNaN(d) ? null : toSQL(d); };
const asDateInt = v => +String(v ?? '').replace(/\D/g, '') || 0;
const asTimeInt = v => { const s = String(v ?? ''); return s.includes(':') ? +s.split(':').slice(0, 2).join('') || 0 : +s || 0; };

/* MySQL returns DECIMAL as strings and DATETIME as strings/ISO, so every row is converted here */
const NORMALIZE = {
  customers: r => ({ customer_id: asId(r.customer_id), customer_name: r.customer_name ?? '', contact_number: r.contact_number ?? '', email: r.email ?? '', age: asId(r.age) }),
  computers: r => ({ computer_id: asId(r.computer_id), computer_type: r.computer_type ?? 'Standard', hourly_rate: +r.hourly_rate || 0, computer_status: r.computer_status ?? 'Available' }),
  staff: r => ({ staff_id: asId(r.staff_id), staff_name: r.staff_name ?? '', contact_number: r.contact_number ?? '', email: r.email ?? '' }),
  sessions: r => ({ session_id: asId(r.session_id), customer_id: asId(r.customer_id), computer_id: asId(r.computer_id), start_time: asDateTime(r.start_time), end_time: asDateTime(r.end_time), hours_used: r.hours_used == null ? null : +r.hours_used }),
  billing: r => ({ bill_id: asId(r.bill_id), session_id: asId(r.session_id), staff_id: asId(r.staff_id), hours_used: +r.hours_used || 0, hourly_rate: +r.hourly_rate || 0, total_amount: +r.total_amount || 0, payment_method: r.payment_method ?? '', payment_status: r.payment_status ?? '' }),
  reservation: r => ({ reservation_id: asId(r.reservation_id), reservation_date: asDateInt(r.reservation_date), customer_id: asId(r.customer_id), computer_id: asId(r.computer_id), start_time: asTimeInt(r.start_time), end_time: asTimeInt(r.end_time), reservation_status: r.reservation_status ?? 'Reserved' })
};

window.exportDatabase = () => JSON.parse(JSON.stringify(db));

/* ================= Search ================= */
const normalize = s => String(s ?? '').toLowerCase();
const searchQuery = () => app.search.trim();
const matches = (...texts) => {
  const q = normalize(searchQuery());
  return !q || texts.some(t => normalize(t).includes(q));
};

/* names of customers currently using or holding a reservation on a computer */
const customersOnComputer = id => [
  ...activeSessions().filter(s => s.computer_id === id).map(s => customerName(s.customer_id)),
  ...activeReservations().filter(r => r.computer_id === id).map(r => customerName(r.customer_id))
];
const computerMatches = c => matches(computerName(c.computer_id), ...customersOnComputer(c.computer_id));
const hl = text => {
  const s = String(text ?? ''), q = searchQuery();
  const i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return esc(s);
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
};

/* ================= Storage ================= */
const createDefaultComputers = () => Object.entries({ Standard: 6, Gaming: 3, VIP: 1 }).flatMap(([type, count]) =>
  Array.from({ length: count }, () => ({ computer_type: type, hourly_rate: COMPUTER_TYPES[type].rate, computer_status: 'Available' }))
).map((pc, i) => ({ computer_id: i + 1, ...pc }));

async function loadFromServer() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('/api/data', { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server returned ' + res.status);
    Object.keys(db).forEach(name => { db[name] = (data[name] || []).map(NORMALIZE[name]); });
    if (!db.computers.length) {          // empty database: seed the default computers
      db.computers = createDefaultComputers();
      saveData();
    }
  } catch (err) {
    console.error(err);
    alert('Cannot load data from the server:\n' + err.message);
  }
}

let pushing = false, dirty = false;
async function pushToServer() {
  if (pushing) { dirty = true; return; }
  pushing = true;
  try {
    do {
      dirty = false;
      const res = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db)
      });
      if (!res.ok) throw new Error('Server returned ' + res.status);
    } while (dirty);
  } catch (err) {
    console.error(err);
    showMessage('Database Error', 'UNITY could not save to the database. Is the server running?', '❌');
  } finally {
    pushing = false;
  }
}

function saveData() {
  db.computers.forEach(c => { c.computer_status = getComputerStatus(c); });
  pushToServer();
}

function openModal({ title, body, buttons = [], width = 420, cls = '' }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="window modal ${cls}" style="width:${width}px">
      <div class="titlebar">
        <span class="tt">${esc(title)}</span>
        <div class="tbtns"><button type="button" class="tb close" title="Close">✕</button></div>
      </div>
      <div class="wbody"><div class="mbody">${body}</div><div class="mfoot"></div></div>
    </div>`;

  const win = $('.modal', overlay);
  const footer = $('.mfoot', overlay);

  buttons.forEach(b => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'xp-btn' + (b.primary ? ' default' : '');
    el.textContent = b.label;
    if (b.primary) el.dataset.primary = '1';
    el.onclick = () => {
      try {
        if (!b.handler || b.handler(overlay) !== false) overlay.remove();
      } catch (err) {
        console.error(err);
        showMessage('Error', 'Something went wrong: ' + err.message, '❌');
      }
    };
    footer.appendChild(el);
  });

  $('.tb.close', overlay).onclick = () => overlay.remove();
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') overlay.remove();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('[data-primary]', overlay)?.click();
  });

  $('.titlebar', overlay).addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    const startX = e.clientX - (win._x || 0), startY = e.clientY - (win._y || 0);
    const move = ev => {
      win._x = ev.clientX - startX;
      win._y = ev.clientY - startY;
      win.style.transform = `translate(${win._x}px, ${win._y}px)`;
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  $('#modalRoot').appendChild(overlay);
  ($('input,select,.xp-btn', $('.mbody', overlay)) || $('.xp-btn', overlay))?.focus();
  return overlay;
}

const showMessage = (title, text, icon = 'ℹ️') => openModal({
  title, width: 380,
  body: `<div class="msg"><span class="mi">${icon}</span><p>${esc(text)}</p></div>`,
  buttons: [{ label: 'OK', primary: true }]
});

const confirmDialog = (title, text, onYes) => openModal({
  title, width: 400,
  body: `<div class="msg"><span class="mi">⚠️</span><p>${esc(text)}</p></div>`,
  buttons: [{ label: 'Yes', primary: true, handler: onYes }, { label: 'No' }]
});

const required = label => v => v.trim() !== '' || `${label} is required.`;

const rules = {
  name: v => v.trim().length < 2
    ? 'Full name is required (at least 2 characters).'
    : /^[A-Za-z][A-Za-z .'\-]*$/.test(v.trim()) || 'Name may only contain letters, spaces, . \' and -.',
  age: v => (/^\d+$/.test(v.trim()) && +v >= 1 && +v <= 120) || 'Enter a valid age between 1 and 120.',
  contact: v => /^\+?[0-9][0-9\s\-()]{6,17}$/.test(v.trim()) || 'Enter a valid contact number (7-15 digits).',
  email: v => v.trim() === '' ? 'Email address is required.'
    : !v.includes('@') ? 'Email must contain an "@" symbol.'
    : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) || 'Enter a complete email address (e.g. name@example.com).'
};

function formHTML(fields, values = {}) {
  return fields.map(f => {
    const value = values[f.id] ?? '';
    const control = f.type === 'select'
      ? `<select id="f_${f.id}">${f.options.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`
      : `<input id="f_${f.id}" type="${f.type}" value="${esc(value)}" ${f.attrs || ''} autocomplete="off">`;
    return `<div class="field" data-id="${f.id}"><label for="f_${f.id}">${f.label}</label>${control}<div class="err"></div></div>`;
  }).join('');
}

function checkField(root, field) {
  const box = root.querySelector(`[data-id="${field.id}"]`);
  const input = box.querySelector('input,select');
  const result = field.rule ? field.rule(input.value, root) : true;
  box.classList.toggle('invalid', result !== true);
  box.querySelector('.err').textContent = result === true ? '' : result;
  return result === true;
}

function wireForm(root, fields) {
  const onChange = e => {
    const box = e.target.closest('.field');
    const field = fields.find(f => f.id === box?.dataset.id);
    if (!field) return;
    checkField(root, field);
    (field.linked || []).forEach(id => {
      const linked = fields.find(f => f.id === id);
      if (linked && val(root, id) !== '') checkField(root, linked);
    });
  };
  root.addEventListener('input', onChange);
  root.addEventListener('change', onChange);
}

function validateForm(root, fields) {
  const values = {};
  let firstInvalid = null;
  fields.forEach(f => {
    if (!checkField(root, f) && !firstInvalid) firstInvalid = f;
    values[f.id] = val(root, f.id).trim();
  });
  if (firstInvalid) {
    root.querySelector('#f_' + firstInvalid.id).focus();
    return null;
  }
  return values;
}

function formModal({ title, fields, values, width = 440, submitLabel = 'OK', onSubmit, intro = '' }) {
  const overlay = openModal({
    title, width,
    body: intro + formHTML(fields, values),
    buttons: [
      { label: submitLabel, primary: true, handler: o => { const v = validateForm($('.mbody', o), fields); return v ? onSubmit(v) : false; } },
      { label: 'Cancel' }
    ]
  });
  wireForm($('.mbody', overlay), fields);
  return overlay;
}

/* ================= Computer status ================= */
const reservationRange = r => [intToDate(r.reservation_date, r.start_time), intToDate(r.reservation_date, r.end_time)];

function getComputerStatus(computer) {
  if (activeSessions().some(s => s.computer_id === computer.computer_id)) return 'Occupied';
  const now = new Date();
  const reserved = activeReservations().some(r => {
    if (r.computer_id !== computer.computer_id) return false;
    const [start, end] = reservationRange(r);
    return now < end && now >= new Date(start.getTime() - 30 * 60000);
  });
  return reserved ? 'Reserved' : 'Available';
}

function purgeExpiredReservations() {
  const now = new Date();
  const expired = activeReservations().filter(r => reservationRange(r)[1] <= now);
  expired.forEach(r => { r.reservation_status = 'Expired'; });
  if (expired.length) saveData();
}

function computerOptions({ onlyAvailable = false } = {}) {
  const list = db.computers.filter(c => !onlyAvailable || getComputerStatus(c) === 'Available');
  return [['', '-- Select a computer --'], ...list.map(c => [c.computer_id, `${computerName(c.computer_id)} (${c.computer_type}, ${money(c.hourly_rate)}/hr)`])];
}

/* ================= Computers ================= */
function computerFields(existingType) {
  const types = [...new Set([...Object.keys(COMPUTER_TYPES), existingType].filter(Boolean))];
  return [
    { id: 'computer_type', label: 'Type:', type: 'select', options: types.map(t => [t, t]) },
    { id: 'hourly_rate', label: `Hourly Rate (${CURRENCY}):`, type: 'number', attrs: 'min="0" step="0.01"',
      rule: v => (v !== '' && +v > 0 && +v <= 1000) || 'Enter an hourly rate greater than 0.' }
  ];
}

function openComputerForm(id) {
  const existing = id ? findComputer(id) : null;
  if (id && !existing) return showMessage('Not Found', 'That computer no longer exists.', '❌');
  formModal({
    title: existing ? 'Edit Computer' : 'Add Computer',
    fields: computerFields(existing?.computer_type),
    values: existing
      ? { computer_type: existing.computer_type, hourly_rate: existing.hourly_rate.toFixed(2) }
      : { computer_type: 'Standard', hourly_rate: COMPUTER_TYPES.Standard.rate.toFixed(2) },
    submitLabel: existing ? 'Save' : 'Add',
    onSubmit: v => {
      const data = { computer_type: v.computer_type, hourly_rate: round2(v.hourly_rate) };
      if (existing) Object.assign(existing, data);
      else db.computers.push({ computer_id: nextId('computers'), ...data, computer_status: 'Available' });
      saveData();
      renderCurrentView();
    }
  });
}

function deleteComputer(id) {
  const pc = findComputer(id);
  if (!pc) return;
  if (activeSessions().some(s => s.computer_id === pc.computer_id)) {
    return showMessage('Cannot Delete', `${computerName(id)} has an active session. End the session first.`, '❌');
  }
  if (db.sessions.some(s => s.computer_id === pc.computer_id)) {
    return showMessage('Cannot Delete', `${computerName(id)} already has session and billing records, so it cannot be deleted.`, '❌');
  }
  confirmDialog('Confirm Delete', `Are you sure you want to delete "${computerName(id)}"?\nIts reservations will also be removed.`, () => {
    db.computers = db.computers.filter(c => c.computer_id !== pc.computer_id);
    db.reservation = db.reservation.filter(r => r.computer_id !== pc.computer_id);
    if (app.selectedComputer === pc.computer_id) app.selectedComputer = null;
    saveData();
    renderCurrentView();
  });
}

/* ================= Customers ================= */
const personFields = () => [
  { id: 'customer_name', label: 'Full Name:', type: 'text', attrs: 'maxlength="60"', rule: rules.name },
  { id: 'age', label: 'Age:', type: 'number', attrs: 'min="1" max="120"', rule: rules.age },
  { id: 'contact_number', label: 'Contact Number:', type: 'tel', attrs: 'maxlength="20"', rule: rules.contact },
  { id: 'email', label: 'Email Address:', type: 'text', attrs: 'maxlength="80"', rule: rules.email }
];

const samePerson = v => db.customers.find(c =>
  c.customer_name.toLowerCase() === v.customer_name.toLowerCase() && c.contact_number === v.contact_number);

const addCustomer = v => {
  const customer = { customer_id: nextId('customers'), customer_name: v.customer_name, contact_number: v.contact_number, email: v.email, age: +v.age };
  db.customers.push(customer);
  return customer;
};
const bookingOf = id => {
  const s = activeSessions().find(x => x.customer_id === id);
  if (s) return { computer: computerName(s.computer_id), type: 'Session Now' };
  const r = activeReservations().find(x => x.customer_id === id);
  return r ? { computer: computerName(r.computer_id), type: 'Reservation' } : { computer: '—', type: '—' };
};

function openCustomerForm(id) {
  const existing = id ? findCustomer(id) : null;
  if (id && !existing) return showMessage('Not Found', 'That customer no longer exists.', '❌');

  formModal({
    title: existing ? 'Edit Customer' : 'Add Customer',
    fields: personFields(),
    values: existing || {},
    submitLabel: existing ? 'Save' : 'Add',
    onSubmit: v => {
      if (existing) Object.assign(existing, { customer_name: v.customer_name, age: +v.age, contact_number: v.contact_number, email: v.email });
      else addCustomer(v);
      saveData();
      renderCurrentView();
    }
  });
}

function viewCustomer(id) {
  const c = findCustomer(id);
  if (!c) return;
  const booking = bookingOf(c.customer_id);
  const rows = [
    ['Customer ID', c.customer_id], ['Full Name', c.customer_name], ['Age', c.age],
    ['Contact Number', c.contact_number], ['Email Address', c.email],
    ['Selected Computer', booking.computer], ['Session Type', booking.type],
    ['Total Billed', money(customerTotal(c.customer_id))]
  ];
  openModal({
    title: 'Customer Details', width: 420,
    body: `<dl class="view">${rows.map(([k, v]) => `<dt>${k}:</dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
    buttons: [{ label: 'Close', primary: true }]
  });
}

function deleteCustomer(id) {
  const c = findCustomer(id);
  if (!c) return;
  if (db.sessions.some(s => s.customer_id === c.customer_id)) {
    return showMessage('Cannot Delete', `${c.customer_name} already has session and billing records, so the customer cannot be deleted.`, '❌');
  }
  confirmDialog('Confirm Delete', `Are you sure you want to delete customer "${c.customer_name}"?\nTheir reservations will also be removed.`, () => {
    db.customers = db.customers.filter(x => x.customer_id !== c.customer_id);
    db.reservation = db.reservation.filter(r => r.customer_id !== c.customer_id);
    saveData();
    renderCurrentView();
  });
}

/* ================= Sessions, reservations, billing ================= */
function openSessionChooser() {
  if (!app.user) return showMessage('Log On Required', 'Please log on to UNITY first.', '🔑');
  const overlay = openModal({
    title: 'Start a Session', width: 440,
    body: `<p style="font-size:12px;margin-top:0">What would you like to do?</p>
           <div class="chooser">
             <button type="button" class="xp-btn big" data-choice="now">▶ Start Session Now</button>
             <button type="button" class="xp-btn big" data-choice="reserve">📅 Reserve Computer</button>
           </div>`,
    buttons: [{ label: 'Cancel' }]
  });
  overlay.addEventListener('click', e => {
    const choice = e.target.closest('[data-choice]')?.dataset.choice;
    if (!choice) return;
    overlay.remove();
    choice === 'now' ? openSessionNowForm() : openReservationForm();
  });
}

function openSessionNowForm() {
  if (!db.computers.length) return showMessage('No Computers', 'Add a computer in the Computer Section first.');
  if (computerOptions({ onlyAvailable: true }).length < 2) return showMessage('No Computers Available', 'Every computer is occupied or reserved right now.');

  const selected = findComputer(app.selectedComputer);
  const prefill = selected && getComputerStatus(selected) === 'Available' ? selected.computer_id : '';
  const fields = [
    ...personFields(),
    { id: 'computer_id', label: 'Computer:', type: 'select', options: computerOptions({ onlyAvailable: true }), rule: required('Computer selection') }
  ];

  formModal({
    title: 'Start Session Now', fields, values: { computer_id: prefill }, submitLabel: 'Start Session',
    onSubmit: v => {
      const pc = findComputer(v.computer_id);
      if (!pc || getComputerStatus(pc) !== 'Available') {
        showMessage('Computer Unavailable', 'That computer is no longer available. Choose another.', '❌');
        return false;
      }
      const known = samePerson(v);
      if (known && activeSessions().some(s => s.customer_id === known.customer_id)) {
        showMessage('Session In Progress', `${known.customer_name} already has an active session.`, '❌');
        return false;
      }
      const customer = known || addCustomer(v);
      db.sessions.push({ session_id: nextId('sessions'), customer_id: customer.customer_id, computer_id: pc.computer_id, start_time: toSQL(new Date()), end_time: null, hours_used: null });
      saveData();
      renderCurrentView();
    }
  });
}

function openReservationForm() {
  if (!db.computers.length) return showMessage('No Computers', 'Add a computer in the Computer Section first.');
  const at = (d, t) => new Date(`${d}T${t}`);

  const fields = [
    ...personFields(),
    { id: 'computer_id', label: 'Computer:', type: 'select', options: computerOptions(), rule: required('Computer selection'), linked: ['end_time'] },
    { id: 'reservation_date', label: 'Reservation Date:', type: 'date', attrs: `min="${todayStr()}"`, linked: ['start_time', 'end_time'],
      rule: v => v === '' ? 'Reservation date is required.' : v < todayStr() ? 'Date cannot be in the past.' : true },
    { id: 'start_time', label: 'Start Time:', type: 'time', linked: ['end_time'],
      rule: (v, root) => v === '' ? 'Start time is required.'
        : (val(root, 'reservation_date') === todayStr() && at(todayStr(), v) < new Date()) ? 'Start time has already passed.' : true },
    { id: 'end_time', label: 'End Time:', type: 'time',
      rule: (v, root) => {
        const start = val(root, 'start_time'), date = val(root, 'reservation_date'), pc = val(root, 'computer_id');
        if (v === '') return 'End time is required.';
        if (start && v <= start) return 'End time must be after the start time.';
        if (start && date && pc) {
          const s = timeToInt(start), e = timeToInt(v);
          const clash = activeReservations().find(r => r.computer_id === +pc && r.reservation_date === dateToInt(date) && s < r.end_time && e > r.start_time);
          if (clash) return `Already reserved ${timeIntToStr(clash.start_time)}-${timeIntToStr(clash.end_time)} on that date.`;
        }
        return true;
      } }
  ];

  const overlay = formModal({
    title: 'Reserve Computer', fields, width: 520, submitLabel: 'Reserve',
    values: { computer_id: app.selectedComputer || '', reservation_date: todayStr() },
    onSubmit: v => {
      const customer = samePerson(v) || addCustomer(v);
      db.reservation.push({
        reservation_id: nextId('reservation'), reservation_date: dateToInt(v.reservation_date),
        customer_id: customer.customer_id, computer_id: +v.computer_id,
        start_time: timeToInt(v.start_time), end_time: timeToInt(v.end_time), reservation_status: 'Reserved'
      });
      saveData();
      renderCurrentView();
    }
  });
  $('.mbody', overlay).classList.add('cols');
}

function endSession(id) {
  const session = findSession(id);
  if (!session || session.end_time) return;

  const pc = findComputer(session.computer_id);
  const endTime = new Date();
  const hours = calcHours(session.start_time, endTime);
  const rate = pc ? pc.hourly_rate : 0;
  const total = calcTotal(hours, rate);
  const used = formatDuration(endTime - toDate(session.start_time));

  const rows = [
    ['Customer', customerName(session.customer_id)], ['Computer', computerName(session.computer_id)],
    ['Time In', formatDateTime(session.start_time)], ['Time Out', formatDateTime(endTime)],
    ['Time Used', `${used} (${hours.toFixed(2)} hrs)`], ['Hourly Rate', `${money(rate)}/hr`]
  ];
  const intro = `<dl class="view">${rows.map(([k, v]) => `<dt>${k}:</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="bill"><span>Total Amount:</span><span>${money(total)}</span></div>`;

  formModal({
    title: 'End Session & Payment', width: 440, intro, submitLabel: 'Confirm Payment',
    fields: [{ id: 'payment_method', label: 'Payment Method:', type: 'select', options: PAYMENT_METHODS.map(m => [m, m]), rule: required('Payment method') }],
    onSubmit: v => {
      Object.assign(session, { end_time: toSQL(endTime), hours_used: hours });
      db.billing.push({
        bill_id: nextId('billing'), session_id: session.session_id, staff_id: app.staffId,
        hours_used: hours, hourly_rate: rate, total_amount: total,
        payment_method: v.payment_method, payment_status: 'Paid'
      });
      saveData();
      renderCurrentView();
      showMessage('Payment Received',
        `Customer: ${customerName(session.customer_id)}\nComputer: ${computerName(session.computer_id)}\nTime used: ${used} (${hours.toFixed(2)} hrs)\nRate: ${money(rate)}/hr\nTotal paid: ${money(total)}\nPayment method: ${v.payment_method}`, '✅');
    }
  });
}

function cancelReservation(id) {
  const r = db.reservation.find(x => x.reservation_id === +id);
  if (!r) return;
  confirmDialog('Cancel Reservation', `Cancel the reservation of ${customerName(r.customer_id)} for ${computerName(r.computer_id)}?`, () => {
    r.reservation_status = 'Cancelled';
    saveData();
    renderCurrentView();
  });
}

function clearHistory() {
  if (!db.billing.length) return;
  confirmDialog('Clear Rental History', 'Permanently delete all billing records and completed sessions?', () => {
    const billed = new Set(db.billing.map(b => b.session_id));
    db.billing = [];
    db.sessions = db.sessions.filter(s => !s.end_time || !billed.has(s.session_id));
    saveData();
    renderCurrentView();
  });
}

/* ================= Views ================= */
const statusBadge = status => `<span class="badge ${status}">${status}</span>`;
const emptyOr = (rows, tableHTML, message) => rows ? tableHTML
  : `<div class="empty">${searchQuery() ? `No results match "${esc(searchQuery())}".` : message}</div>`;

function renderHome() {
  purgeExpiredReservations();
  const counts = { Available: 0, Occupied: 0, Reserved: 0 };
  db.computers.forEach(c => counts[getComputerStatus(c)]++);

  const stat = (label, n) => `<div class="stat"><b>${n}</b>${label}</div>`;

  const cards = db.computers.filter(computerMatches).map(c => {
    const status = getComputerStatus(c);
    return `<div class="pc ${status}${app.selectedComputer === c.computer_id ? ' sel' : ''}" data-act="select-pc" data-id="${c.computer_id}">
      <div class="ico">🖥️</div><b>${hl(computerName(c.computer_id))}</b>
      <small>${esc(c.computer_type)} - ${money(c.hourly_rate)}/hr</small>${statusBadge(status)}
    </div>`;
  }).join('');

  const sessionRows = activeSessions()
    .filter(s => matches(customerName(s.customer_id), computerName(s.computer_id)))
    .map(s => `<tr>
      <td>${hl(customerName(s.customer_id))}</td>
      <td>${hl(computerName(s.computer_id))}</td>
      <td>${new Date(toDate(s.start_time)).toLocaleTimeString()}</td>
      <td data-start="${s.start_time}" data-rate="${findComputer(s.computer_id)?.hourly_rate || 0}"></td>
      <td data-cost></td>
      <td><button class="xp-btn sm" data-act="end-session" data-id="${s.session_id}">End Session</button></td>
    </tr>`).join('');

  const reservationRows = activeReservations()
    .filter(r => matches(customerName(r.customer_id), computerName(r.computer_id)))
    .sort((a, b) => (a.reservation_date * 10000 + a.start_time) - (b.reservation_date * 10000 + b.start_time))
    .map(r => `<tr>
      <td>${hl(customerName(r.customer_id))}</td><td>${hl(computerName(r.computer_id))}</td>
      <td>${dateIntToStr(r.reservation_date)}</td><td>${timeIntToStr(r.start_time)} - ${timeIntToStr(r.end_time)}</td>
      <td><button class="xp-btn sm" data-act="cancel-res" data-id="${r.reservation_id}">Cancel</button></td>
    </tr>`).join('');

  $('#content').innerHTML = `<div class="page">
    <div class="ph"><h2>Home Page</h2><button class="xp-btn default" data-act="start-session">Start a Session</button></div>
    <div class="stats">
      ${stat('Total Computers', db.computers.length)}${stat('Available Computers', counts.Available)}
      ${stat('Occupied Computers', counts.Occupied)}${stat('Reserved Computers', counts.Reserved)}
      ${stat('Active Sessions', activeSessions().length)}
      <div class="stat clock"><b data-clock></b>Current Date and Time</div>
    </div>
    <h3>Computers</h3>
    ${emptyOr(cards, `<div class="pcgrid">${cards}</div>`, 'No computers yet. Open the Computer Section to add one.')}
    <h3>Active Sessions</h3>
    <div class="gridwrap">${emptyOr(sessionRows,
      `<table><tr><th>Customer</th><th>Computer</th><th>Time In</th><th>Elapsed</th><th>Cost so far</th><th></th></tr>${sessionRows}</table>`,
      'No active sessions.')}</div>
    <h3>Reservations</h3>
    <div class="gridwrap">${emptyOr(reservationRows,
      `<table><tr><th>Customer</th><th>Computer</th><th>Date</th><th>Time</th><th></th></tr>${reservationRows}</table>`,
      'No upcoming reservations.')}</div>
  </div>`;
}

function renderComputers() {
  const rows = db.computers.filter(computerMatches).map(c => `<tr>
    <td>${hl(computerName(c.computer_id))}</td><td>${esc(c.computer_type)}</td><td>${esc(COMPUTER_TYPES[c.computer_type]?.specs ?? '—')}</td><td>${money(c.hourly_rate)}</td>
    <td>${statusBadge(getComputerStatus(c))}</td>
    <td>
      <button class="xp-btn sm" data-act="edit-pc" data-id="${c.computer_id}">Edit</button>
      <button class="xp-btn sm" data-act="del-pc" data-id="${c.computer_id}">Delete</button>
    </td>
  </tr>`).join('');

  $('#content').innerHTML = `<div class="page">
    <div class="ph"><h2>Computer Section</h2><button class="xp-btn default" data-act="add-pc">Add Computer</button></div>
    <div class="gridwrap tall">${emptyOr(rows,
      `<table><tr><th>Name</th><th>Type</th><th>Specifications</th><th>Rate</th><th>Status</th><th>Actions</th></tr>${rows}</table>`,
      'No computers yet. Click "Add Computer" to create one.')}</div>
  </div>`;
}

function renderCustomers() {
  const customerRows = db.customers
    .map(c => ({ c, booking: bookingOf(c.customer_id) }))
    .filter(({ c, booking }) => matches(c.customer_name, booking.computer))
    .map(({ c, booking }) => `<tr>
      <td>${hl(c.customer_name)}</td><td>${c.age}</td><td>${esc(c.contact_number)}</td><td>${esc(c.email)}</td>
      <td>${hl(booking.computer)}</td><td>${esc(booking.type)}</td><td>${money(customerTotal(c.customer_id))}</td>
      <td>
        <button class="xp-btn sm" data-act="view-cust" data-id="${c.customer_id}">View</button>
        <button class="xp-btn sm" data-act="edit-cust" data-id="${c.customer_id}">Edit</button>
        <button class="xp-btn sm" data-act="del-cust" data-id="${c.customer_id}">Delete</button>
      </td>
    </tr>`).join('');

  const history = db.billing
    .map(b => {
      const s = findSession(b.session_id);
      return { b, s, customer: customerName(s?.customer_id), computer: computerName(s?.computer_id), staff: findStaff(b.staff_id)?.staff_name ?? '—' };
    })
    .filter(h => matches(h.customer, h.computer, h.b.payment_method))
    .sort((x, y) => String(y.s?.end_time).localeCompare(String(x.s?.end_time)));

  const historyRows = history.map(h => `<tr>
    <td>${hl(h.customer)}</td><td>${hl(h.computer)}</td>
    <td>${formatDateTime(h.s?.start_time)}</td><td>${formatDateTime(h.s?.end_time)}</td>
    <td>${h.b.hours_used.toFixed(2)}</td><td>${money(h.b.hourly_rate)}</td><td>${money(h.b.total_amount)}</td>
    <td>${esc(h.b.payment_method)}</td><td>${esc(h.b.payment_status)}</td><td>${esc(h.staff)}</td>
  </tr>`).join('');

  const totalRevenue = round2(history.reduce((sum, h) => sum + h.b.total_amount, 0));

  $('#content').innerHTML = `<div class="page">
    <div class="ph"><h2>Customer Section</h2>
      <div class="acts">
        <button class="xp-btn default" data-act="start-session">Start a Session</button>
        <button class="xp-btn" data-act="add-cust">Add Customer</button>
      </div>
    </div>
    <div class="gridwrap tall">${emptyOr(customerRows,
      `<table><tr><th>Full Name</th><th>Age</th><th>Contact</th><th>Email</th><th>Computer</th><th>Session Type</th><th>Rental Fee</th><th>Actions</th></tr>${customerRows}</table>`,
      'No customers yet. Click "Add Customer" or start a session.')}</div>

    <div class="h3row"><h3>Rental History</h3>
      <span><span class="total">Total: ${money(totalRevenue)}</span>
        ${db.billing.length ? '<button class="xp-btn sm" data-act="clear-history">Clear History</button>' : ''}</span>
    </div>
    <div class="gridwrap">${emptyOr(historyRows,
      `<table><tr><th>Customer</th><th>Computer</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Rate</th><th>Total</th><th>Payment</th><th>Status</th><th>Handled By</th></tr>${historyRows}</table>`,
      'No completed rentals yet. Ended sessions appear here.')}</div>
  </div>`;
}

const VIEWS = { home: renderHome, computers: renderComputers, customers: renderCustomers };

function renderCurrentView() {
  VIEWS[app.view]();
  updateClocks();
}

function setView(view) {
  app.view = view;
  $$('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#sbLeft').textContent = VIEW_TITLES[view];
  renderCurrentView();
}

/* ================= Clocks ================= */
function updateClocks() {
  const now = new Date();
  $('#trayClock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  $$('[data-clock]').forEach(el => {
    el.textContent = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + now.toLocaleTimeString();
  });
  $$('[data-start]').forEach(el => {
    const start = el.dataset.start;
    el.textContent = formatDuration(now - toDate(start));
    el.parentElement.querySelector('[data-cost]').textContent = money(calcTotal(calcHours(start, now), +el.dataset.rate));
  });
}

function tick() {
  updateClocks();
  app.ticks++;
  if (app.ticks % 30 === 0 && app.user && !$('.overlay')) renderCurrentView();
}

/* ================= Login / window control ================= */
function ensureStaff(username, contact_number = '', email = '') {
  let person = db.staff.find(s => s.staff_name.toLowerCase() === username.toLowerCase());
  if (!person) {
    person = { staff_id: nextId('staff'), staff_name: username, contact_number, email };
    db.staff.push(person);
    saveData();
  } else if ((contact_number && person.contact_number !== contact_number) || (email && person.email !== email)) {
    if (contact_number) person.contact_number = contact_number;
    if (email) person.email = email;
    saveData();
  }
  return person.staff_id;
}

function openLoginModal() {
  if (app.user || $('.login-modal')) return;

  const fields = [
    { id: 'role', label: 'Log on as:', type: 'select', options: [['staff', 'Staff'], ['owner', 'Owner']] },
    { id: 'username', label: 'Username:', type: 'text', attrs: 'maxlength="40"', rule: required('Username') },
    { id: 'password', label: 'Password:', type: 'password', attrs: 'maxlength="60"', rule: required('Password') },
    /* da contact number and email are only asked when the account is being created */
    { id: 'contact_number', label: 'Contact Number:', type: 'tel', attrs: 'maxlength="20"',
      rule: (v, root) => accounts[val(root, 'role')].username ? true : rules.contact(v) },
    { id: 'email', label: 'Email Address:', type: 'text', attrs: 'maxlength="80"',
      rule: (v, root) => accounts[val(root, 'role')].username ? true : rules.email(v) }
  ];

  const showError = (overlay, text) => {
    const err = $('#loginError', overlay);
    err.textContent = text;
    err.classList.remove('hidden');
    return false;
  };

  const login = overlay => {
    const v = validateForm($('.mbody', overlay), fields);
    if (!v) return showError(overlay, 'Please fill in all required fields.');

    const account = accounts[v.role];
    if (!account.username || !account.password) {
      if (v.password.length < 4) return showError(overlay, 'Choose a password of at least 4 characters.');
      assignAccount(v.role, v.username, v.password, v.contact_number, v.email);
    } else if (v.username !== account.username || v.password !== account.password) {
      $('#f_password', overlay).value = '';
      return showError(overlay, 'Incorrect username or password. Please try again.');
    }
    completeLogin(v.username, v.role);
  };

  const overlay = openModal({
    title: 'Log On to UNITY', width: 380, cls: 'login-modal',
    body: `<div class="login-head"><div class="logo small"><div class="flag"><i></i><i></i><i></i><i></i></div><div class="lt"><span class="u">UNITY</span></div></div></div>
           <div class="loginerr hidden" id="loginError"></div><div class="hint" id="loginHint"></div>${formHTML(fields)}`,
    buttons: [
      { label: 'Login', primary: true, handler: login },
      { label: 'Cancel', handler: o => { $('#f_username', o).value = ''; $('#f_password', o).value = ''; } }
    ]
  });
  wireForm($('.mbody', overlay), fields);

  const updateHint = () => {
    const hasAccount = accounts[val(overlay, 'role')].username;
    $('#loginHint', overlay).textContent = hasAccount
      ? 'Enter your username and password to log on.'
      : 'No account exists for this role yet. The details you enter now will be saved for future logins (until you refresh the page).';
    ['contact_number', 'email'].forEach(id => {
      const box = $(`[data-id="${id}"]`, overlay);
      box.classList.toggle('hidden', !!hasAccount);
      if (hasAccount) box.classList.remove('invalid');
    });
  };
  $('#f_role', overlay).addEventListener('change', updateHint);
  updateHint();
}

function completeLogin(username, role) {
  const roleLabel = role === 'owner' ? 'Owner' : 'Staff';
  const acc = accounts[role];
  Object.assign(app, { user: username, role, staffId: ensureStaff(username, acc.contact_number, acc.email) });
  const me = findStaff(app.staffId);

  $('#whoAmI').innerHTML = `Logged on:<br><b>${esc(username)}</b> (${roleLabel})`
    + (me?.contact_number ? `<br>📞 ${esc(me.contact_number)}` : '')
    + (me?.email ? `<br>✉️ ${esc(me.email)}` : '');
  $('#sbUser').textContent = `User: ${username} | Role: ${roleLabel}`;
  $('#smUser').textContent = username;
  $('#appWindow').classList.remove('hidden');
  $('#taskItems').innerHTML = '<button class="taskbtn active" id="taskUnity">🖥️ UNITY</button>';
  $('#taskUnity').onclick = toggleMinimize;
  setView('home');
}

function logout() {
  confirmDialog('Log Off UNITY', 'Are you sure you want to log off?', () => {
    Object.assign(app, { user: null, role: null, staffId: null, selectedComputer: null, search: '' }); $('#searchBox').value = '';
    $('#appWindow').classList.add('hidden');
    $('#taskItems').innerHTML = '';
    $('#smUser').textContent = 'Guest';
    $$('.overlay').forEach(o => o.remove());
    openLoginModal();
  });
}

function toggleMinimize() {
  const win = $('#appWindow');
  const hide = !win.classList.contains('hidden');
  win.classList.toggle('hidden', hide);
  $('#taskUnity')?.classList.toggle('active', !hide);
}

/* ================= Events ================= */
function wireEvents() {
  const actions = {
    'start-session': openSessionChooser,
    'add-pc': () => openComputerForm(),
    'edit-pc': id => openComputerForm(id),
    'del-pc': deleteComputer,
    'select-pc': id => { app.selectedComputer = app.selectedComputer === +id ? null : +id; renderCurrentView(); },
    'add-cust': () => openCustomerForm(),
    'edit-cust': id => openCustomerForm(id),
    'view-cust': viewCustomer,
    'del-cust': deleteCustomer,
    'end-session': endSession,
    'cancel-res': cancelReservation,
    'clear-history': clearHistory
  };

  $('#content').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (btn) actions[btn.dataset.act]?.(btn.dataset.id);
  });

  $$('.navbtn').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  $('#btnMin').onclick = toggleMinimize;
  $('#btnMax').onclick = () => $('#appWindow').classList.toggle('max');
  $('#btnClose').onclick = logout;

  const searchBox = $('#searchBox');
  searchBox.addEventListener('input', () => { app.search = searchBox.value; renderCurrentView(); });
  searchBox.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchBox.value = ''; app.search = ''; renderCurrentView(); }
  });
  $('#searchClear').onclick = () => { searchBox.value = ''; app.search = ''; renderCurrentView(); searchBox.focus(); };

  const openApp = () => app.user ? $('#appWindow').classList.remove('hidden') : openLoginModal();
  $('#iconUnity').addEventListener('dblclick', openApp);
  $('#iconUnity').addEventListener('keydown', e => { if (e.key === 'Enter') openApp(); });

  const startMenu = $('#startMenu');
  $('#startBtn').onclick = e => { e.stopPropagation(); startMenu.classList.toggle('hidden'); };
  document.addEventListener('click', e => { if (!e.target.closest('#startMenu')) startMenu.classList.add('hidden'); });

  const menuActions = {
    session: openSessionChooser,
    open: openApp,
    logoff: () => app.user ? logout() : showMessage('Log Off', 'You are not logged on.'),
    shutdown: () => confirmDialog('Turn Off UNITY', 'Are you sure you want to shut down UNITY?', () => location.reload())
  };
  startMenu.addEventListener('click', e => {
    const item = e.target.closest('[data-sm]');
    if (!item) return;
    startMenu.classList.add('hidden');
    menuActions[item.dataset.sm]();
  });
}

/* ================= Boot ================= */
const startBoot = () => openLoginModal();

document.addEventListener('DOMContentLoaded', async () => {
  await loadFromServer();
  purgeExpiredReservations();
  wireEvents();
  updateClocks();
  setInterval(tick, 1000);
  startBoot();
});
