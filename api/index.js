// Vercel serverless function wrapper for the Express backend
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

// Stripe setup
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.warn('Stripe not available; card payments will be simulated.');
  }
}

// Database setup
const dbFile = path.join(__dirname, '../server/db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDb() {
  try {
    await db.read();
    db.data ||= { donations: [], contacts: [], projects: [], events: [] };
    await db.write();
  } catch (e) {
    console.warn('DB init error:', e);
    db.data = { donations: [], contacts: [], projects: [], events: [] };
  }
}

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60*1000, max: 100 }));

// Sanitize helper
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'`]/g, '');
}

// Initialize DB before handling requests
let dbReady = false;
initDb().then(() => { dbReady = true; }).catch(e => console.error('DB init failed:', e));

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    csrfToken: null
  });
});

// Stripe status
app.get('/api/stripe-status', (req, res) => {
  res.json({ enabled: !!stripe, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null });
});

// Get stats
app.get('/api/stats', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const donations = db.data.donations || [];
    const total = donations.reduce((sum, d) => sum + (d.amount || 0), 0);
    const byProject = {};
    donations.forEach(d => {
      const proj = d.project || 'General';
      if (!byProject[proj]) byProject[proj] = { total: 0, count: 0 };
      byProject[proj].total += d.amount || 0;
      byProject[proj].count += 1;
    });
    res.json({ total, count: donations.length, byProject });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get donations
app.get('/api/donations', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const filter = req.query.project;
    let donations = db.data.donations || [];
    if (filter) {
      donations = donations.filter(d => (d.project || '').toLowerCase().includes(filter.toLowerCase()));
    }
    res.json({ donations: donations.slice(-20).reverse() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get projects
app.get('/api/projects', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const projects = db.data.projects || [
      { id: 1, title: 'Literacy for All', tag: 'Education', emoji: '📚', desc: 'Building libraries and schools' },
      { id: 2, title: 'Wells of Hope', tag: 'Water', emoji: '💧', desc: 'Providing clean water access' },
      { id: 3, title: 'Mobile Clinics', tag: 'Healthcare', emoji: '🏥', desc: 'Mobile healthcare units' },
      { id: 4, title: 'Women Lead', tag: 'Women', emoji: '👩', desc: 'Women empowerment programs' }
    ];
    res.json({ projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get events
app.get('/api/events', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const events = db.data.events || [
      { id: 1, date: '2026-04-15', title: 'Spring Benefit Gala', meta: 'New York, USA' },
      { id: 2, date: '2026-05-20', title: 'Health Clinic Outreach', meta: 'Kenya' }
    ];
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Donation endpoint
app.post('/api/donate', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const { first, last, email, amount, paymentMethod, cardNumber, mpesaPhone, anonymous, project } = req.body;
    
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    
    const donation = {
      id: Date.now(),
      first: anonymous ? 'Anonymous' : sanitize(first || ''),
      last: anonymous ? '' : sanitize(last || ''),
      email: anonymous ? '' : sanitize(email || ''),
      project: sanitize(project || 'General'),
      paymentMethod: sanitize(paymentMethod || ''),
      amount: Number(amount),
      timestamp: new Date().toISOString()
    };
    
    db.data.donations = db.data.donations || [];
    db.data.donations.push(donation);
    await db.write();
    
    res.json({ success: true, donation });
  } catch (e) {
    console.error('Donation error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Create payment intent
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, email, project } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    
    if (stripe) {
      try {
        const intent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          receipt_email: email
        });
        res.json({ clientSecret: intent.client_secret });
      } catch (stripeErr) {
        res.status(400).json({ error: stripeErr.message });
      }
    } else {
      // Simulate
      res.json({ clientSecret: 'pi_test_secret_' + Date.now() });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Contact endpoint
app.post('/api/contact', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const { first, last, email, subject, message } = req.body;
    
    if (!first || !last || !email || !subject || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const contact = {
      id: Date.now(),
      first: sanitize(first),
      last: sanitize(last),
      email: sanitize(email),
      subject: sanitize(subject),
      message: sanitize(message),
      timestamp: new Date().toISOString()
    };
    
    db.data.contacts = db.data.contacts || [];
    db.data.contacts.push(contact);
    await db.write();
    
    res.json({ success: true });
  } catch (e) {
    console.error('Contact error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Add/update/delete projects (admin)
app.post('/api/projects', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const { id, title, tag, emoji, desc } = req.body;
    db.data.projects = db.data.projects || [];
    
    if (id) {
      const idx = db.data.projects.findIndex(p => p.id === id);
      if (idx >= 0) db.data.projects[idx] = { id, title, tag, emoji, desc };
    } else {
      const newId = Math.max(0, ...db.data.projects.map(p => p.id || 0)) + 1;
      db.data.projects.push({ id: newId, title, tag, emoji, desc });
    }
    await db.write();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add/update/delete events (admin)
app.post('/api/events', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const { id, date, title, meta } = req.body;
    db.data.events = db.data.events || [];
    
    if (id) {
      const idx = db.data.events.findIndex(e => e.id === id);
      if (idx >= 0) db.data.events[idx] = { id, date, title, meta };
    } else {
      const newId = Math.max(0, ...db.data.events.map(e => e.id || 0)) + 1;
      db.data.events.push({ id: newId, date, title, meta });
    }
    await db.write();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete project
app.delete('/api/projects/:id', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const id = parseInt(req.params.id);
    db.data.projects = (db.data.projects || []).filter(p => p.id !== id);
    await db.write();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete event
app.delete('/api/events/:id', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'DB not ready' });
  try {
    const id = parseInt(req.params.id);
    db.data.events = (db.data.events || []).filter(e => e.id !== id);
    await db.write();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export for Vercel
module.exports = app;
