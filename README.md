# YouFundHope Website

This workspace contains a static charity website plus a simple Node/Express backend for processing donations and contact messages.

## Running locally

### Admin interface
A simple admin page (`admin.html`) is included for browsing donation records and managing site content (projects + events).
Launch the server and open <http://localhost:3000/admin.html> in your browser. You can filter donations by project,
add or remove projects and events, and any changes will automatically appear on the public site.



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
# optional SMTP settings; if provided the server will send a thank-you email to donors
SMTP_HOST=smtp.example.com
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=no-reply@youfundhope.org
CONTACT_EMAIL=contact@youfundhope.org
```

You can also configure HTTPS by providing `SSL_KEY` and `SSL_CERT` paths and modifying `index.js` to use `https` (see Node.js https.createServer). The `csurf` middleware will set a `_csrf` cookie which the front-end reads and sends back in the `CSRF-Token` header for all POST requests.

### Stripe configuration

1. Sign up for a Stripe account and obtain a **publishable key** (`pk_...`) and **secret key** (`sk_...`).
   - The server now exposes a `/config` endpoint returning the publishable key and a fresh CSRF token; the front-end fetches this on load and automatically sets up Stripe and the `CSRF-Token` header.
2. Add `STRIPE_SECRET_KEY=sk_...` (and optionally `STRIPE_PUBLISHABLE_KEY=pk_...`) to your `.env` file. The server reads the secret key for intents; the front‑end can reference the publishable key via a global variable or a small API endpoint.
3. In your front-end, set `window.STRIPE_PUBLISHABLE_KEY='pk_...'` before the main script loads (or modify `scripts.js`).
4. The client will call `/api/create-payment-intent` to obtain a `clientSecret` which Stripe.js uses to complete the payment.

### Quick local Stripe test

1. Add your test keys to `server/.env` (or copy `.env.example`).
2. Start the server: `npm start`.
3. Check Stripe status:

```powershell
curl http://localhost:3000/api/stripe-status
```

4. Create a test payment intent (server will simulate if Stripe not configured):

```powershell
curl -X POST http://localhost:3000/api/create-payment-intent -H "Content-Type: application/json" -d "{\"amount\":1}"
```

The response should include a `clientSecret` (simulated value when Stripe is not configured) that the frontend can use with Stripe.js for confirming card payments.

### Running the automated Stripe test (server-side)

If you have set `STRIPE_SECRET_KEY` in `server/.env` with a Stripe test secret key, you can run a small server-side test that creates and confirms a PaymentIntent using Stripe's test payment method `pm_card_visa`.

```powershell
cd server
npm run test-stripe
```

This will log the created PaymentIntent and its status. If the project is running without Stripe keys, the CLI test will abort and explain how to configure keys.

### Dev-only test-charge HTTP endpoint

If you want a quick server-side HTTP test (useful for verifying server->Stripe calls), enable the dev endpoint by setting `ENABLE_STRIPE_TEST_ENDPOINT=1` in `server/.env` (DO NOT enable in production). Then POST to `/api/test-charge` with a JSON body `{ "amount": 1 }`.

Example using PowerShell:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/test-charge -Method Post -Body (ConvertTo-Json @{ amount = 1 }) -ContentType 'application/json'
```

This will create and confirm a PaymentIntent using Stripe's test payment method `pm_card_visa` when Stripe keys are configured on the server.

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
- Ability to choose a specific project or "Where It's Needed Most" when donating
 - Ability to choose a specific project or "Where It's Needed Most" when donating (projects managed via admin dashboard)
- Anonymous tipping
- Client & server validation (including project field)
- Transaction and contact storage via lowdb
- Simple public API endpoints for donations and statistics (`GET /api/donations` & `/api/stats`). `/api/donations` accepts an optional `project` query parameter to filter results.
- Dummy payment processing (stubs for Stripe/MPesa)
- Dummy payment processing (stubs for Stripe/MPesa)
 - Dynamic project and event loading on the public site via backend APIs
   - Example records can be added directly to `server/db.json` or via the admin dashboard. A project entry looks like:
      ```json
      {"id":1620000000000,"title":"Literacy for All","tag":"Education","desc":"Providing quality education...","emoji":"📚"}
      ```
      and an event entry like:
      ```json
      {"id":1620000001000,"date":"2026-03-15","title":"Fundraiser Gala","meta":"Downtown Conference Center"}
      ```

## Next steps for production

- Configure real payment gateway credentials (Stripe API key, Safaricom credentials).
- Replace dummy processing in `/api/donate` with real API calls (Stripe, Safaricom M-Pesa STK Push). See the code comments for where to add the logic.
- Secure the server (HTTPS, rate limiting, input sanitization improvements).
- Deploy to hosting platform (e.g. Heroku, Vercel with serverless functions).
- Add logging and error monitoring.  - Optionally expose donation statistics or admin UI using the new API endpoints.
- Add logging and error monitoring.
- Optionally expose donation statistics or admin UI using the new API endpoints.
- Manage projects and events via the administrator dashboard. The backend provides `/api/projects` and
   `/api/events` endpoints (GET/POST/PUT/DELETE) so you can update the public site content.