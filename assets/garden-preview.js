(() => {
  const form = document.querySelector('#previewRentalForm');
  const total = document.querySelector('#previewSubtotal');
  const result = document.querySelector('#previewQuoteResult');
  function update() {
    const values = ['tables', 'chairs', 'days'].map(name => Number(form.elements[name].value));
    total.textContent = values.every(Number.isFinite) && form.checkValidity()
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((values[0] * 20 + values[1] * 3) * values[2]) : '—';
    result.textContent = '';
  }
  form.addEventListener('input', update);
  form.addEventListener('submit', event => {
    event.preventDefault();
    result.textContent = 'Next, we’d ask for your event date, location, and contact information. This is a design preview; nothing has been sent or reserved.';
  });
  // The copied existing inquiry form must never send a customer message from a design preview.
  document.querySelector('#inquiryForm')?.addEventListener('submit', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    alert('This is a design preview. Please use the original website to send a real inquiry.');
  }, true);
})();
