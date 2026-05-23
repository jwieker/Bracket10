document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    const msg = form.dataset.confirm;
    if (!window.confirm(msg)) {
      e.preventDefault();
    }
  });
});
