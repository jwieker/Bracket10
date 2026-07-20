document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('pwaInstallBanner');
  const installBtn = document.getElementById('pwaInstallBtn');
  const dismissBtn = document.getElementById('pwaDismissBtn');
  const navInstallBtn = document.getElementById('pwaNavInstallBtn');

  if (!banner || !installBtn || !dismissBtn) return;

  // Check if the app is already installed/running in standalone mode
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone;
  if (isStandalone) {
    return; // App is already installed, never show banner
  }

  // Check if the user previously dismissed the banner
  const isDismissed = localStorage.getItem('pwaBannerDismissed') === 'true';
  if (isDismissed) {
    return; // User doesn't want to see it
  }

  // Detect iOS
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  let deferredPrompt;

  // Listen for the beforeinstallprompt event (Android/Chrome)
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Show the banner since we know it's installable
    showBanner();
  });

  // If it's iOS, we don't get a 'beforeinstallprompt' event, so we just show it if they aren't standalone
  if (isIOS) {
    showBanner();
  }

  function showBanner() {
    if (banner) {
      banner.classList.remove('d-none');
      banner.classList.add('d-flex');
    }
    if (navInstallBtn) {
      navInstallBtn.classList.remove('d-none');
      navInstallBtn.classList.add('d-block');
    }
  }

  function hideBanner() {
    if (banner) {
      banner.classList.remove('d-flex');
      banner.classList.add('d-none');
    }
    if (navInstallBtn) {
      navInstallBtn.classList.remove('d-block');
      navInstallBtn.classList.add('d-none');
    }
  }

  dismissBtn.addEventListener('click', () => {
    hideBanner();
    // Remember their choice
    localStorage.setItem('pwaBannerDismissed', 'true');
  });

  async function triggerInstallPrompt() {
    if (isIOS) {
      // Show the custom iOS instructions modal
      let iosModalElement = document.getElementById('iosPwaModal');
      if (iosModalElement && window.bootstrap) {
        const iosModal = new bootstrap.Modal(iosModalElement);
        iosModal.show();
      } else {
        alert(
          "To install the app on iOS, tap the Share icon and select 'Add to Home Screen'.",
        );
      }
    } else if (deferredPrompt) {
      // Trigger the native Android/Chrome prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      // We've used the prompt, and can't use it again, throw it away
      deferredPrompt = null;
      // Hide the banner regardless of choice so it isn't continually sitting there on this session
      hideBanner();
      if (outcome === 'dismissed') {
        localStorage.setItem('pwaBannerDismissed', 'true');
      }
    } else {
      alert(
        "To install the app, tap the options menu in your browser and select 'Install app' or 'Add to Home Screen'.",
      );
    }
  }

  if (installBtn) installBtn.addEventListener('click', triggerInstallPrompt);
  if (navInstallBtn)
    navInstallBtn.addEventListener('click', triggerInstallPrompt);

  // Handle successful installation
  window.addEventListener('appinstalled', () => {
    console.log('App successfully installed');
    hideBanner();
    localStorage.setItem('pwaBannerDismissed', 'true');
  });

  // Initialize the display logic if running in standard mode
  if (!isStandalone && !isDismissed) {
    if (isIOS) {
      showBanner();
    } else {
      // For non-iOS (Android/Chrome), we wait for the beforeinstallprompt event.
      // However, if the event doesn't fire (e.g., they don't meet PWA criteria yet or already installed),
      // the banner stays hidden. If you want a fallback to show it anyway:
      // setTimeout(() => { if (!deferredPrompt && !isDismissed) showBanner(); }, 3000);
    }
  }
});
