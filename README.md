# YouFundHope Website

This workspace contains a static charity website plus a simple Node/Express backend for processing donations and contact messages.

## Running locally

1. **Install dependencies**

```powershell
cd "c:\Users\LIVEWAVE\OneDrive\Desktop\My-Website\server"
npm install
```

2. **Environment variables**

Create a `.env` file in `server/` with keys you wish to use:

```
STRIPE_SECRET_KEY=sk_test_...
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
SMTP_HOST=smtp.example.com
SMTP_USER=...
SMTP_PASS=...
CONTACT_EMAIL=contact@youfundhope.org
```

You can also configure HTTPS by providing `SSL_KEY` and `SSL_CERT` paths and modifying `index.js` to use `https` (see Node.js https.createServer). The `csurf` middleware will set a `_csrf` cookie which the front-end reads and sends back in the `CSRF-Token` header for all POST requests.

### Stripe configuration

1. Sign up for a Stripe account and obtain a **publishable key** (`pk_...`) and **secret key** (`sk_...`).
   - The server now exposes a `/config` endpoint returning the publishable key and a fresh CSRF token; the front-end fetches this on load and automatically sets up Stripe and the `CSRF-Token` header.
2. Add `STRIPE_SECRET_KEY=sk_...` (and optionally `STRIPE_PUBLISHABLE_KEY=pk_...`) to your `.env` file. The server reads the secret key for intents; the front‑end can reference the publishable key via a global variable or a small API endpoint.
3. In your front-end, set `window.STRIPE_PUBLISHABLE_KEY='pk_...'` before the main script loads (or modify `scripts.js`).
4. The client will call `/api/create-payment-intent` to obtain a `clientSecret` which Stripe.js uses to complete the payment.

3. **Start server**

```powershell
npm run dev   # requires nodemon, watches files
# or
npm start
```

The server listens on port 3000 by default. The frontend is served statically from the parent directory.

3. **Open in browser**

Navigate to http://localhost:3000/charity-website.html to view the site. Forms will submit to the API endpoints.

## Features implemented

- Donation form with Visa (card) and M-Pesa options
- Anonymous tipping
- Client & server validation
- Transaction and contact storage via lowdb
- Dummy payment processing (stubs for Stripe/MPesa)

## Next steps for production

- Configure real payment gateway credentials (Stripe API key, Safaricom credentials).
- Replace dummy processing in `/api/donate` with real API calls (Stripe, Safaricom M-Pesa STK Push). See the code comments for where to add the logic.
- Secure the server (HTTPS, rate limiting, input sanitization improvements).
- Deploy to hosting platform (e.g. Heroku, Vercel with serverless functions).
- Add logging and error monitoring.
