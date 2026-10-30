# Little Oak Kindergarten website

A static site (`index.html`, `success.html`) plus one serverless function (`api/checkout.js`) that opens Stripe Checkout.

## How it works
- Registration: the family fills in the form, then pays $150 registration fee + $500 refundable deposit on Stripe Checkout. The registration details are stored on the Stripe payment (metadata), so a paid registration is a succeeded payment with `type = registration`.
- Tours: the family enters the email they registered with and pays the $25 tour fee. The function checks Stripe for a succeeded registration payment with that email first.
- Payment methods shown at checkout come from your Stripe Dashboard settings (Settings > Payment methods). Turn on cards, Apple Pay, Google Pay, and ACH bank payments there.

## Set up
1. Create a Stripe account and copy your secret key (use a test key `sk_test_...` first).
2. Deploy this folder to Vercel.
3. In the Vercel project, add the environment variable `STRIPE_SECRET_KEY` with your key. Never put the key in the code or share it in chat.
4. Test with Stripe's test card 4242 4242 4242 4242, then switch to the live key.

## Before launch
- Replace the placeholder school name, address, phone, and email in `index.html`.
- Confirm the tour fee ($25 placeholder) in `api/checkout.js` and `index.html`.
- Add refund terms and a privacy notice.
- Child health notes are stored in Stripe metadata. Limit who can see your Stripe Dashboard.
