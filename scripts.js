// Navbar scroll
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 20);
});


function closeMobile() {
  document.getElementById('mobileMenu').classList.remove('open');
}

// Donation amount selection
let selectedAmount = 25;
function selectAmount(button) {
  document.querySelectorAll('.amount-btn').forEach(btn => btn.classList.remove('active'));
  button.classList.add('active');
  const raw = button.textContent.trim();
  if (raw.toLowerCase() === 'custom') {
    const custom = prompt('Enter custom amount ($):');
    const parsed = (custom || '').replace(/[^0-9.]/g, '').trim();
    selectedAmount = parsed || '25';
    button.textContent = '$' + selectedAmount;
  } else {
    // extract digits from button text like "$25"
    selectedAmount = raw.replace(/[^0-9.]/g, '') || '25';
  }
  const donateBtn = document.querySelector('.btn-primary.donate-submit');
  if (donateBtn) donateBtn.textContent = 'Donate $' + selectedAmount + ' Securely →';
}

// Form validation for donation form
function validateDonationForm() {
  const form = document.getElementById('donationForm');
  const firstName = form.querySelector('input[name="first"]').value.trim();
  const lastName = form.querySelector('input[name="last"]').value.trim();
  const email = form.querySelector('input[name="email"]').value.trim();
  const paymentMethod = (form.querySelector('input[name="paymentMethod"]:checked') || {}).value || 'card';

  if (!firstName || !lastName || !email) {
    alert('Please fill in your name and email.');
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address.');
    return false;
  }

  if (paymentMethod === 'card') {
    const cardNumber = form.querySelector('#cardNumber').value.trim();
    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 13) {
      alert('Please enter a valid card number.');
      return false;
    }
    // Here you would call your card payment flow / tokenization
    alert('Thank you for your donation of $' + selectedAmount + '! Your card payment was processed (simulated).');
    form.reset();
    return false;
  }

  if (paymentMethod === 'mpesa') {
    let phone = form.querySelector('#mpesaPhone').value.trim();
    if (!phone) {
      phone = prompt('Enter your M-Pesa phone number (e.g. 2547XXXXXXXX)');
    }
    const phoneDigits = (phone || '').replace(/[^0-9]/g, '');
    if (phoneDigits.length < 9) {
      alert('Please provide a valid phone number for M-Pesa.');
      return false;
    }
    // Simulate sending an M-Pesa STK push
    alert('An M-Pesa payment request has been sent to +' + phoneDigits + '. Follow the prompts on your phone to complete payment.');
    form.reset();
    return false;
  }
}

// Form validation for contact form
function validateContactForm(event) {
  event.preventDefault();
  const form = event.target;
  const firstName = form.querySelector('input[placeholder="Jane"]').value.trim();
  const lastName = form.querySelector('input[placeholder="Smith"]').value.trim();
  const email = form.querySelector('input[placeholder="jane@example.com"]').value.trim();
  const subject = form.querySelector('input[placeholder="I\'d like to volunteer…"]').value.trim();
  const message = form.querySelector('textarea').value.trim();
  
  if (!firstName || !lastName || !email || !subject || !message) {
    alert('Please fill in all fields.');
    return false;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Please enter a valid email address.');
    return false;
  }
  
  alert('Thank you for reaching out! We\'ll get back to you within 24 hours.');
  form.reset();
  return false;
}

document.addEventListener('DOMContentLoaded', () => {
  // fetch configuration from server (publishable key, possibly CSRF token)
  let stripe = null;
  let cardElement = null;
  fetch('/config')
    .then(r => r.json())
    .then(cfg => {
      // wait a bit for Stripe library to load from CDN
      setTimeout(() => {
        if (cfg.stripePublishableKey && typeof Stripe !== 'undefined') {
          stripe = Stripe(cfg.stripePublishableKey);
          const elements = stripe.elements();
          cardElement = elements.create('card');
          const cardEl = document.getElementById('card-element');
          if (cardEl && cardElement) cardElement.mount('#card-element');
        }
      }, 100);
    })
    .catch(() => { /* ignore config errors */ });

  const hamburger = document.getElementById('hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      document.getElementById('mobileMenu').classList.toggle('open');
    });
  }

  document.querySelectorAll('#mobileMenu a').forEach(link => {
    link.addEventListener('click', closeMobile);
  });

  document.querySelectorAll('.amount-btn').forEach(btn => {
    btn.addEventListener('click', () => selectAmount(btn));
  });

  // initialize selectedAmount from active button (if any)
  const activeBtn = document.querySelector('.amount-btn.active');
  if (activeBtn) {
    const txt = activeBtn.textContent.trim();
    if (txt.toLowerCase() !== 'custom') selectedAmount = txt.replace(/[^0-9.]/g, '') || selectedAmount;
  }

  // exchange rate (USD -> KES). Update to current rate as needed.
  const USD_TO_KES = 150;

  // update payment button labels (Visa in USD, M-Pesa in KSh)
  function updatePaymentButtonsLabel() {
    const visaBtn = document.querySelector('.visa-submit');
    const mpesaBtn = document.querySelector('.mpesa-submit');
    const usd = Number(selectedAmount) || 0;
    const kes = Math.round(usd * USD_TO_KES);
    if (visaBtn) visaBtn.textContent = 'Pay with Visa — $' + usd.toLocaleString('en-US') + ' →';
    if (mpesaBtn) mpesaBtn.textContent = 'Pay with M-Pesa — KSh ' + kes.toLocaleString('en-KE') + ' →';
  }
  updatePaymentButtonsLabel();

  const donationForm = document.getElementById('donationForm');
  // Use separate buttons for Visa / M-Pesa; remove form submit handler
  const visaButton = document.querySelector('.visa-submit');
  const mpesaButton = document.querySelector('.mpesa-submit');
  if (visaButton) visaButton.addEventListener('click', processVisaPayment);
  if (mpesaButton) mpesaButton.addEventListener('click', processMpesaPayment);

  // Payment method toggles (show/hide fields)
  const paymentRadios = document.querySelectorAll('input[name="paymentMethod"]');
  function updatePaymentFields() {
    const mpesaFields = document.querySelector('.mpesa-fields');
    const cardFields = document.querySelector('.card-fields');
    const selected = document.querySelector('input[name="paymentMethod"]:checked');
    if (selected && selected.value === 'mpesa') {
      if (mpesaFields) mpesaFields.style.display = 'block';
      if (cardFields) cardFields.style.display = 'none';
      if (visaButton) visaButton.style.display = 'none';
      if (mpesaButton) mpesaButton.style.display = 'block';
    } else {
      if (mpesaFields) mpesaFields.style.display = 'none';
      if (cardFields) cardFields.style.display = 'block';
      if (visaButton) visaButton.style.display = 'block';
      if (mpesaButton) mpesaButton.style.display = 'none';
    }
  }
  paymentRadios.forEach(r => r.addEventListener('change', updatePaymentFields));
  updatePaymentFields();

  // anonymous tip toggle behavior
  const anonCheckbox = document.getElementById('anonymousTip');
  function updateAnonFields() {
    const form = document.getElementById('donationForm');
    const first = form.querySelector('input[name="first"]');
    const last = form.querySelector('input[name="last"]');
    const email = form.querySelector('input[name="email"]');
    if (anonCheckbox && anonCheckbox.checked) {
      if (first) first.disabled = true;
      if (last) last.disabled = true;
      if (email) email.disabled = true;
    } else {
      if (first) first.disabled = false;
      if (last) last.disabled = false;
      if (email) email.disabled = false;
    }
  }
  if (anonCheckbox) anonCheckbox.addEventListener('change', updateAnonFields);
  updateAnonFields();

  // update labels whenever amount changes
  const amountBtns = document.querySelectorAll('.amount-btn');
  amountBtns.forEach(b => b.addEventListener('click', updatePaymentButtonsLabel));

  // Payment processors
  async function processVisaPayment() {
    const form = document.getElementById('donationForm');
    const anonymous = form.querySelector('#anonymousTip').checked;
    let firstName = form.querySelector('input[name="first"]').value.trim();
    let lastName = form.querySelector('input[name="last"]').value.trim();
    const email = form.querySelector('input[name="email"]').value.trim();
    if (!anonymous) {
      if (!firstName || !lastName || !email) return alert('Please fill in your name and email.');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return alert('Please enter a valid email address.');
    } else {
      firstName = 'Anonymous';
      lastName = '';
    }

    if (stripe && cardElement) {
      // create payment intent via backend
      const intentResp = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: selectedAmount, email: anonymous ? undefined : email })
      });
      const intentData = await intentResp.json();
      if (intentData.error) return alert('Error: ' + intentData.error);
      const clientSecret = intentData.clientSecret;
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: { name: anonymous ? undefined : (firstName + ' ' + lastName), email: anonymous ? undefined : email }
        }
      });
      if (result.error) {
        return alert('Stripe error: ' + result.error.message);
      }
      // success
      showMpesaModal('Visa payment processed via Stripe for $' + Number(selectedAmount).toLocaleString('en-US') + '. Thank you' + (anonymous ? '' : ', ' + firstName) + '!');
      form.reset();
      updatePaymentButtonsLabel();
      return;
    }

    // fallback to previous method (server handles cardNumber directly)
    const cardNumber = form.querySelector('#card-number').value.trim();
    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 13) return alert('Please enter a valid card number.');
    fetch('/api/donate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first: firstName,
        last: lastName,
        email,
        amount: selectedAmount,
        paymentMethod: 'card',
        cardNumber: cardNumber,
        anonymous
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showMpesaModal('Visa payment processed: $' + Number(selectedAmount).toLocaleString('en-US') + '. Thank you' + (anonymous ? '' : ', ' + firstName) + '!');
          form.reset();
          updatePaymentButtonsLabel();
        } else {
          alert('Error: ' + (data.error || 'Unknown'));
        }
      });
  }

  function processMpesaPayment() {
    const form = document.getElementById('donationForm');
    const anonymous = form.querySelector('#anonymousTip').checked;
    let firstName = form.querySelector('input[name="first"]').value.trim();
    let lastName = form.querySelector('input[name="last"]').value.trim();
    const email = form.querySelector('input[name="email"]').value.trim();
    if (!anonymous) {
      if (!firstName || !lastName || !email) return alert('Please fill in your name and email.');
    } else {
      firstName = 'Anonymous'; lastName = '';
    }
    const phoneField = form.querySelector('#mpesaPhone');
    let phone = phoneField ? phoneField.value.trim() : '';
    if (!phone) phone = prompt('Enter your M-Pesa phone number (e.g. 2547XXXXXXXX)');
    const phoneDigits = (phone || '').replace(/[^0-9]/g, '');
    if (phoneDigits.length < 9) return alert('Please provide a valid phone number for M-Pesa.');
    const usd = Number(selectedAmount) || 0;
    const kes = Math.round(usd * USD_TO_KES);
    fetch('/api/donate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first: firstName,
        last: lastName,
        email,
        amount: selectedAmount,
        paymentMethod: 'mpesa',
        mpesaPhone: phoneDigits,
        anonymous
      })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showMpesaModal('M-Pesa STK push initiated to +' + phoneDigits + ' for KSh ' + kes.toLocaleString('en-KE') + '.');
          form.reset();
          updatePaymentButtonsLabel();
        } else {
          alert('Error: ' + (data.error || 'Unknown'));
        }
      });
  }

  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const form = e.target;
      const first = form.querySelector('input[name="first"]').value.trim();
      const last = form.querySelector('input[name="last"]').value.trim();
      const email = form.querySelector('input[name="email"]').value.trim();
      const subject = form.querySelector('input[name="subject"]').value.trim();
      const message = form.querySelector('textarea[name="message"]').value.trim();
      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first, last, email, subject, message })
      })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            alert('Thank you! Your message has been sent.');
            form.reset();
          } else {
            alert('Error: ' + (data.error || 'Unknown'));
          }
        });
    });
  }

  const privacyLink = document.getElementById('privacyPolicyLink');
  if (privacyLink) {
    privacyLink.addEventListener('click', e => {
      e.preventDefault();
      alert('Privacy Policy: YouFundHope is committed to protecting your personal data.');
    });
  }

  const termsLink = document.getElementById('termsLink');
  if (termsLink) {
    termsLink.addEventListener('click', e => {
      e.preventDefault();
      alert('Terms of Service: By using this site, you agree to our terms.');
    });
  }

  // MPesa modal helper
  function showMpesaModal(msg) {
    const modal = document.getElementById('mpesaModal');
    const messageEl = document.getElementById('mpesaModalMessage');
    if (messageEl) messageEl.textContent = msg;
    if (modal) modal.style.display = 'flex';
  }

  // modal close logic
  const modalClose = document.querySelector('.mpesa-modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', () => {
      const modal = document.getElementById('mpesaModal');
      if (modal) modal.style.display = 'none';
    });
  }
  // hide if clicking outside content
  const modal = document.getElementById('mpesaModal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }
});