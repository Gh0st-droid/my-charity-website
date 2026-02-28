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
  db.data ||= { donations: [], contacts: [] };
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

// expose /config endpoint (CSRF will be added back in production)
app.get('/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null
  });
});

// utility functions
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`]/g, '');
}

// expose a simple config object to the frontend with publishable keys and csrf token
// this should be before CSRF middleware since it serves the token
app.get('/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    csrfToken: req.csrfToken()
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
  anonymous: Joi.boolean().required()
});

// donation endpoint
app.post('/api/donate', async (req, res) => {
  try {
    const { error, value } = donationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { first, last, email, amount, paymentMethod, cardNumber, mpesaPhone, anonymous } = value;

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
      paymentMethod: sanitize(paymentMethod),
      amount: amount,
      timestamp: new Date().toISOString(),
      processor: chargeInfo
    };

    db.data.donations.push(donation);
    await db.write();

    res.json({ success: true, donation });
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
  console.log(`Server running on port ${PORT}`);
});
