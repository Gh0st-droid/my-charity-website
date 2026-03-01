// Simple test script to create and confirm a Stripe PaymentIntent using test keys.
// Usage: copy .env.example to .env, set STRIPE_SECRET_KEY to a test secret, then run:
//   node test-stripe.js

require('dotenv').config();
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('Missing STRIPE_SECRET_KEY in environment. Copy .env.example to .env and add keys.');
  process.exit(1);
}
const Stripe = require('stripe');
const stripe = Stripe(stripeKey);

(async () => {
  try {
    console.log('Creating PaymentIntent for $1 (100 cents) using test payment method pm_card_visa...');
    const pi = await stripe.paymentIntents.create({
      amount: 100,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      capture_method: 'automatic'
    });
    console.log('PaymentIntent created:');
    console.log({ id: pi.id, status: pi.status, amount: pi.amount, currency: pi.currency });
    if (pi.status === 'succeeded') console.log('Test payment succeeded.');
    else console.log('Test payment status:', pi.status);
  } catch (err) {
    console.error('Stripe test failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
