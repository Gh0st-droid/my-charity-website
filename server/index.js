require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');
const Joi = require('joi');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

// setup stripe only if key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn('Stripe not available; card payments will be simulated.');
  }
}


// Setup LowDB database (file-based)
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDb() {
  await db.read();
  db.data ||= { donations: [], contacts: [], projects: [], events: [] };
  await db.write();
}

initDb();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// rate limiting
app.use(rateLimit({ windowMs: 60*1000, max: 100 }));

// serve static front-end
app.use(express.static(path.join(__dirname, '.')));

// expose a simple status endpoint for Stripe diagnostics (app is initialized at this point)
app.get('/api/stripe-status', (req, res) => {
  res.json({ enabled: !!stripe, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
});

// Dev-only test charge endpoint. Enabled only when ENABLE_STRIPE_TEST_ENDPOINT is truthy in env.
app.post('/api/test-charge', async (req, res) => {
  if (!process.env.ENABLE_STRIPE_TEST_ENDPOINT) return res.status(403).json({ error: 'Test endpoint disabled' });
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured on server' });
  try {
    const amount = Math.max(1, parseInt(req.body.amount || 1, 10));
    // use Stripe test payment method to confirm server-side
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true
    });
    res.json({ success: true, id: pi.id, status: pi.status });
  } catch (err) {
    console.error('test-charge error', err);
    res.status(500).json({ error: err.message || 'Stripe error' });
  }
});

// utility functions
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`]/g, '');
}

// expose a simple config object to the frontend with publishable keys and csrf token
// this should be before CSRF middleware since it serves the token
app.get('/config', (req, res) => {
  let csrfToken = null;
  try {
    if (typeof req.csrfToken === 'function') csrfToken = req.csrfToken();
  } catch (e) {
    csrfToken = null;
  }
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    csrfToken
  });
});

// validation schemas
const donationSchema = Joi.object({
  first: Joi.string().allow('', null),
  last: Joi.string().allow('', null),
  email: Joi.string().email().allow('', null),
  amount: Joi.number().positive().required(),
  paymentMethod: Joi.string().valid('card','mpesa').required(),
  cardNumber: Joi.string().allow('', null),
  mpesaPhone: Joi.string().allow('', null),
  anonymous: Joi.boolean().required(),
  project: Joi.string().allow('', null).default('Where It\'s Needed Most')
});

const projectSchema = Joi.object({
  id: Joi.number().required(),
  title: Joi.string().required(),
  tag: Joi.string().allow('', null),
  desc: Joi.string().allow('', null),
  emoji: Joi.string().allow('', null)
});

const eventSchema = Joi.object({
  id: Joi.number().required(),
  date: Joi.string().required(),
  title: Joi.string().required(),
  meta: Joi.string().allow('', null)
});

// donation endpoint
app.post('/api/donate', async (req, res) => {
  try {
    const { error, value } = donationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { first, last, email, amount, paymentMethod, cardNumber, mpesaPhone, anonymous, project } = value;

    // process payment using real gateways if keys available
    let chargeInfo = null;
    if (paymentMethod === 'card') {
      // stripe integration
      if (stripe) {
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // cents
            currency: 'usd',
            payment_method_types: ['card'],
            receipt_email: anonymous ? undefined : email
          });
          chargeInfo = { id: paymentIntent.id };
        } catch (stripeErr) {
          console.error('Stripe error:', stripeErr);
          chargeInfo = { simulated: true, error: stripeErr.message };
        }
      } else {
        chargeInfo = { simulated: true };
      }
    } else if (paymentMethod === 'mpesa') {
      // placeholder for actual STK push call using safaricom APIs
      chargeInfo = { simulated: true, method: 'mpesa_stk_pending' };
    }

    const donation = {
      id: Date.now(),
      first: anonymous ? 'Anonymous' : sanitize(first),
      last: anonymous ? '' : sanitize(last),
      email: anonymous ? '' : sanitize(email),
      project: sanitize(project),
      paymentMethod: sanitize(paymentMethod),
      amount: amount,
      timestamp: new Date().toISOString(),
      processor: chargeInfo
    };

    // send thank-you email to donor if SMTP configured and not anonymous
    if (!anonymous && email && process.env.SMTP_HOST) {
      try {
        const transporter = require('nodemailer').createTransport({
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT || 587,
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
        transporter.sendMail({
          from: process.env.SMTP_FROM || 'no-reply@youfundhope.org',
          to: email,
          subject: 'Thank you for your donation to YouFundHope',
          text: `Dear ${anonymous ? 'Supporter' : first},\n\nThank you for your generous donation of $${amount} to ${project}. Your contribution makes a real difference.\n\nWith gratitude,\nYouFundHope team`
        });
      } catch (mailErr) {
        console.warn('could not send donor email:', mailErr);
      }
    }

    db.data.donations.push(donation);
    await db.write();

    res.json({ success: true, donation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// public endpoints to retrieve donation data/stats
app.get('/api/donations', async (req, res) => {
  try {
    await db.read();
    let list = (db.data.donations || []);
    // allow filtering by project name via query param
    if (req.query.project) {
      const filter = String(req.query.project).toLowerCase();
      list = list.filter(d => (d.project || '').toLowerCase().includes(filter));
    }
    // return last 100 entries if not filtered explicitly
    if (!req.query.project) list = list.slice(-100);
    res.json({ donations: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// projects API
app.get('/api/projects', async (req, res) => {
  try {
    await db.read();
    res.json({ projects: db.data.projects || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    await db.read();
    const proj = req.body;
    proj.id = Date.now();
    const { error } = projectSchema.validate(proj);
    if (error) return res.status(400).json({ error: error.details[0].message });
    db.data.projects.push({
      id: proj.id,
      title: sanitize(proj.title),
      tag: sanitize(proj.tag),
      desc: sanitize(proj.desc),
      emoji: sanitize(proj.emoji)
    });
    await db.write();
    res.json({ success: true, project: proj });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    await db.read();
    const id = Number(req.params.id);
    const existing = (db.data.projects||[]).find(p=>p.id===id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const update = Object.assign({}, existing, req.body);
    const { error } = projectSchema.validate(update);
    if (error) return res.status(400).json({ error: error.details[0].message });
    Object.assign(existing, {
      title: sanitize(update.title),
      tag: sanitize(update.tag),
      desc: sanitize(update.desc),
      emoji: sanitize(update.emoji)
    });
    await db.write();
    res.json({ success: true, project: existing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await db.read();
    const id = Number(req.params.id);
    db.data.projects = (db.data.projects||[]).filter(p=>p.id!==id);
    await db.write();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// events API
app.get('/api/events', async (req, res) => {
  try {
    await db.read();
    res.json({ events: db.data.events || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    await db.read();
    const ev = req.body;
    ev.id = Date.now();
    const { error } = eventSchema.validate(ev);
    if (error) return res.status(400).json({ error: error.details[0].message });
    db.data.events.push({
      id: ev.id,
      date: sanitize(ev.date),
      title: sanitize(ev.title),
      meta: sanitize(ev.meta)
    });
    await db.write();
    res.json({ success: true, event: ev });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    await db.read();
    const id = Number(req.params.id);
    const existing = (db.data.events||[]).find(e=>e.id===id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const update = Object.assign({}, existing, req.body);
    const { error } = eventSchema.validate(update);
    if (error) return res.status(400).json({ error: error.details[0].message });
    Object.assign(existing, {
      date: sanitize(update.date),
      title: sanitize(update.title),
      meta: sanitize(update.meta)
    });
    await db.write();
    res.json({ success: true, event: existing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    await db.read();
    const id = Number(req.params.id);
    db.data.events = (db.data.events||[]).filter(e=>e.id!==id);
    await db.write();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.get('/api/stats', async (req, res) => {
  try {
    await db.read();
    const all = db.data.donations || [];
    const total = all.reduce((sum, d) => sum + (d.amount || 0), 0);
    const count = all.length;
    const byProject = {};
    all.forEach(d => {
      const proj = d.project || 'Undesignated';
      byProject[proj] = byProject[proj] || { total: 0, count: 0 };
      byProject[proj].total += d.amount || 0;
      byProject[proj].count += 1;
    });
    res.json({ total, count, byProject });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// create stripe payment intent (used by client-side for secure card capture)
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount) || 0;
    if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    
    if (!stripe) {
      // Stripe not configured; return a simulated intent ID
      return res.json({ 
        clientSecret: 'pi_test_' + Date.now(),
        simulated: true
      });
    }
    
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        payment_method_types: ['card'],
        receipt_email: req.body.email || undefined
      });
      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (stripeErr) {
      console.error('Stripe error:', stripeErr);
      res.status(500).json({ error: 'Stripe error: ' + stripeErr.message });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// contact endpoint
const contactSchema = Joi.object({
  first: Joi.string().required(),
  last: Joi.string().required(),
  email: Joi.string().email().required(),
  subject: Joi.string().required(),
  message: Joi.string().required()
});

app.post('/api/contact', async (req, res) => {
  try {
    const { error, value } = contactSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { first, last, email, subject, message } = value;

    const contact = {
      id: Date.now(),
      first: sanitize(first),
      last: sanitize(last),
      email: sanitize(email),
      subject: sanitize(subject),
      message: sanitize(message),
      timestamp: new Date().toISOString()
    };

    db.data.contacts.push(contact);
    await db.write();

    // optionally send email via nodemailer (configure SMTP credentials)
    if (process.env.SMTP_HOST) {
      const transporter = require('nodemailer').createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@youfundhope.org',
        to: process.env.CONTACT_EMAIL || process.env.SMTP_FROM,
        subject: `Contact form: ${subject}`,
        text: `Name: ${first} ${last}\nEmail: ${email}\n\n${message}`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (Stripe ${stripe ? 'configured' : 'not configured'})`);
});
