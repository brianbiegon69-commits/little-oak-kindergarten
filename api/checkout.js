// Creates a Stripe Checkout session for a registration or a tour.
// Registration is saved in Stripe (payment metadata) only once the family pays.
const Stripe = require('stripe');

const REGISTRATION_FEE_CENTS = 15000; // $150
const DEPOSIT_CENTS = 50000;          // $500 enrollment deposit, refundable, paid separately after registration
const TOUR_FEE_CENTS = 2500;          // $25 placeholder

const PROGRAMS = ['Half-day', 'Full-day', 'Full-day plus extended care'];

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function validEmail(email) {
  return /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(email);
}
function lineItem(name, cents) {
  return {
    quantity: 1,
    price_data: { currency: 'usd', unit_amount: cents, product_data: { name } },
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Payments are not set up yet. Please contact the school office.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  try {
    if (body.type === 'registration') {
      const c = body.child || {};
      const g = body.guardian || {};
      const email = clean(g.email, 200).toLowerCase();
      const meta = {
        type: 'registration',
        child_first: clean(c.first, 100),
        child_last: clean(c.last, 100),
        child_dob: clean(c.dob, 10),
        program: PROGRAMS.includes(c.program) ? c.program : 'Full-day',
        guardian_name: clean(g.name, 150),
        guardian_phone: clean(g.phone, 40),
        guardian_email: email,
        emergency_name: clean(g.emergencyName, 150),
        emergency_phone: clean(g.emergencyPhone, 40),
        health_notes: clean(c.allergies, 450),
      };
      if (!meta.child_first || !meta.child_last || !/^\d{4}-\d{2}-\d{2}$/.test(meta.child_dob)) {
        return res.status(400).json({ error: 'Enter your child\'s name and date of birth.' });
      }
      if (!meta.guardian_name || !meta.guardian_phone || !validEmail(email)) {
        return res.status(400).json({ error: 'Enter a parent or guardian name, phone number, and valid email.' });
      }
      if (!meta.emergency_name || !meta.emergency_phone) {
        return res.status(400).json({ error: 'Enter an emergency contact name and phone number.' });
      }
      // The registration fee is always charged. The deposit is optional here.
      const withDeposit = body.includeDeposit === true;
      meta.deposit_paid_with_registration = withDeposit ? 'yes' : 'no';
      const line_items = [lineItem('Registration fee', REGISTRATION_FEE_CENTS)];
      if (withDeposit) { line_items.push(lineItem('Enrollment deposit (refundable)', DEPOSIT_CENTS)); }
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items,
        metadata: meta,
        payment_intent_data: {
          description: `Registration: ${meta.child_first} ${meta.child_last}`,
          metadata: meta,
        },
        success_url: `${origin}/success.html?type=registration`,
        cancel_url: `${origin}/#register`,
      });
      return res.status(200).json({ url: session.url });
    }

    if (body.type === 'enrollment') {
      const email = clean(body.email, 200).toLowerCase();
      const name = clean(body.parent, 150);
      const childFirst = clean(body.childFirst, 100);
      if (!name || !childFirst || !validEmail(email)) {
        return res.status(400).json({ error: 'Enter your name, your child\'s first name, and the email you registered with.' });
      }
      // The registration fee is compulsory: the deposit can only be paid after it.
      const found = await stripe.paymentIntents.search({
        query: `status:'succeeded' AND metadata['type']:'registration' AND metadata['guardian_email']:'${email}'`,
        limit: 1,
      });
      if (!found.data.length) {
        return res.status(403).json({
          error: 'The registration fee must be paid first. Please register, using the same email.',
        });
      }
      const meta = {
        type: 'enrollment',
        guardian_name: name,
        guardian_email: email,
        child_first: childFirst,
      };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [lineItem('Enrollment deposit (refundable)', DEPOSIT_CENTS)],
        metadata: meta,
        payment_intent_data: { description: `Enrollment deposit: ${childFirst}`, metadata: meta },
        success_url: `${origin}/success.html?type=enrollment`,
        cancel_url: `${origin}/#enroll`,
      });
      return res.status(200).json({ url: session.url });
    }

    if (body.type === 'tour') {
      const email = clean(body.email, 200).toLowerCase();
      const name = clean(body.parent, 150);
      if (!name || !validEmail(email)) {
        return res.status(400).json({ error: 'Enter your name and the email you registered with.' });
      }
      // Tours are for registered families: look for a paid registration with this email.
      const found = await stripe.paymentIntents.search({
        query: `status:'succeeded' AND metadata['type']:'registration' AND metadata['guardian_email']:'${email}'`,
        limit: 1,
      });
      if (!found.data.length) {
        return res.status(403).json({
          error: 'Tours are for registered families. Please register and pay first, using the same email.',
        });
      }
      const meta = {
        type: 'tour',
        guardian_name: name,
        guardian_email: email,
        program: PROGRAMS.includes(body.program) ? body.program : 'Full-day',
        note: clean(body.note, 450),
      };
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: [lineItem('Tour fee', TOUR_FEE_CENTS)],
        metadata: meta,
        payment_intent_data: { description: `Tour: ${name}`, metadata: meta },
        success_url: `${origin}/success.html?type=tour`,
        cancel_url: `${origin}/#visit`,
      });
      return res.status(200).json({ url: session.url });
    }

    return res.status(400).json({ error: 'Unknown request.' });
  } catch (err) {
    console.error('checkout error', err && err.message);
    return res.status(500).json({ error: 'Checkout could not start. Please try again in a moment.' });
  }
};
