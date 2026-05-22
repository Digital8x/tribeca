// Modal System
function openModal(title, subtitle) {
  const overlay = document.getElementById('leadModal');
  document.getElementById('modalTitle').textContent = title || 'Get Exclusive Details';
  document.getElementById('modalSubtitle').textContent = subtitle || 'Fill in your details and our team will reach out shortly.';
  overlay.dataset.source = title || 'Website';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('leadModal').classList.remove('active');
  document.body.style.overflow = '';
}
document.getElementById('leadModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// Initialize International Telephone Input
const itiInstances = [];
// Allowed countries: India + key NRI markets matching server whitelist
const ALLOWED_COUNTRIES = ['in','ae','us','gb','ca','sg','om','qa','sa','kw','bh','au'];
document.querySelectorAll('input[type="tel"]').forEach(input => {
  const iti = window.intlTelInput(input, {
    initialCountry: "auto",
    onlyCountries: ALLOWED_COUNTRIES,
    preferredCountries: ["in", "ae", "us", "gb", "ca"],
    geoIpLookup: function(success, failure) {
      fetch("https://ipapi.co/json")
        .then(res => res.json())
        .then(data => {
          const cc = (data.country_code || 'in').toLowerCase();
          success(ALLOWED_COUNTRIES.includes(cc) ? cc : 'in');
        })
        .catch(() => success("in"));
    },
    utilsScript: "https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/18.2.1/js/utils.js",
    separateDialCode: true
  });
  itiInstances.push({ input, iti });
});

// Form Submission
document.querySelectorAll('.lead-form').forEach(form => {
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = this.querySelector('button');
    const origText = btn.textContent;
    
    // Find the ITI instance for this form
    const telInput = this.querySelector('input[type="tel"]');
    const itiData = itiInstances.find(i => i.input === telInput);
    
    if (itiData && !itiData.iti.isValidNumber()) {
      alert("Please enter a valid phone number for the selected country.");
      return;
    }

    btn.textContent = 'Submitting...';
    btn.disabled = true;

    const inputs = this.querySelectorAll('input, select');
    const data = {
      name: '',
      phone: itiData ? itiData.iti.getNumber() : telInput.value,
      email: '',
      source: document.getElementById('leadModal')?.dataset?.source || 'Contact Form',
      config: ''
    };
    
    inputs.forEach(inp => {
      const ph = (inp.placeholder || '').toLowerCase();
      const type = inp.type;
      if (ph.includes('name')) data.name = inp.value;
      else if (ph.includes('email') || type === 'email') data.email = inp.value;
      else if (inp.tagName === 'SELECT' && inp.value) data.config = inp.value;
    });

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (result.success) {
        btn.textContent = '✓ Thank You!';
        btn.style.background = 'linear-gradient(135deg, #2d8a4e, #1a6b35)';
        if (data.source === 'Unlock Drone Walkthrough') {
          unlockDroneVideo();
        }
        setTimeout(() => {
          btn.textContent = origText;
          btn.style.background = '';
          btn.disabled = false;
          this.reset();
          closeModal();
        }, 2000);
      } else {
        alert(result.error || "Submission failed");
        btn.textContent = 'Error — Try Again';
        btn.style.background = 'linear-gradient(135deg, #e74c3c, #c0392b)';
        setTimeout(() => { btn.textContent = origText; btn.style.background = ''; btn.disabled = false; }, 2000);
      }
    } catch (err) {
      console.error(err);
      btn.textContent = 'Network Error';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    }
  });
});

// PRELOADER
window.addEventListener('load', () => {
  const preloader = document.getElementById('preloader');
  const bar = document.querySelector('.preloader-bar');
  if (bar) bar.style.width = '100%';
  setTimeout(() => {
    preloader?.classList.add('loaded');
  }, 1000);
});

// CUSTOM CURSOR
const cursorDot = document.querySelector('.cursor-dot');
const cursorOutline = document.querySelector('.cursor-outline');

if (cursorDot && cursorOutline && window.matchMedia("(hover: hover)").matches) {
  window.addEventListener('mousemove', (e) => {
    const posX = e.clientX;
    const posY = e.clientY;
    cursorDot.style.left = `${posX}px`;
    cursorDot.style.top = `${posY}px`;
    cursorOutline.animate({
      left: `${posX}px`,
      top: `${posY}px`
    }, { duration: 500, fill: "forwards" });
  });

  document.querySelectorAll('a, button, .gallery-item, .price-card, .highlight-card').forEach(el => {
    el.addEventListener('mouseenter', () => cursorOutline.classList.add('hovered'));
    el.addEventListener('mouseleave', () => cursorOutline.classList.remove('hovered'));
  });
}

// NAVBAR SCROLL
const navbar = document.querySelector('.navbar');
window.addEventListener('scroll', () => {
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// Hamburger Menu
const hamburger = document.querySelector('.hamburger');
const navLinks = document.querySelector('.nav-links');
hamburger?.addEventListener('click', () => {
  navLinks?.classList.toggle('open');
});

// Stat Counter
const stats = document.querySelectorAll('.stat-value');
const statsObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const target = entry.target;
      const countValue = target.getAttribute('data-count');
      const count = parseFloat(countValue);
      if (isNaN(count)) {
        target.innerText = countValue;
        return;
      }
      
      let current = 0;
      const duration = 2000; // 2 seconds
      const stepTime = 20;
      const steps = duration / stepTime;
      const increment = count / steps;
      
      const timer = setInterval(() => {
        current += increment;
        if (current >= count) {
          target.innerText = countValue;
          clearInterval(timer);
        } else {
          target.innerText = countValue.includes('.') ? current.toFixed(1) : Math.floor(current);
        }
      }, stepTime);
      
      statsObserver.unobserve(target);
    }
  });
}, { threshold: 0.5 });
stats.forEach(s => statsObserver.observe(s));

// Scroll Animations
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-up').forEach(el => revealObserver.observe(el));

// Smooth scroll for nav links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const t = document.querySelector(a.getAttribute('href'));
    if (t) {
      const offset = 80;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = t.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
      navLinks?.classList.remove('open');
    }
  });
});

// Day/Night Toggle Handler
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtns = document.querySelectorAll('.day-night-toggle .toggle-btn');
  const dayImg = document.getElementById('aboutImgDay');
  const nightImg = document.getElementById('aboutImgNight');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (view === 'day') {
        dayImg?.classList.add('active');
        nightImg?.classList.remove('active');
      } else {
        nightImg?.classList.add('active');
        dayImg?.classList.remove('active');
      }
    });
  });
});

// Drone Walkthrough Vimeo Player Logic
let vimeoPlayer = null;
let hasUnlocked = localStorage.getItem('tribeca_video_unlocked') === 'true';

function initDroneVideo() {
  const iframe = document.getElementById('drone-video');
  if (!iframe) return;

  // Initialize Vimeo Player
  vimeoPlayer = new Vimeo.Player(iframe);
  const overlay = document.getElementById('videoOverlay');

  // If already unlocked, hide overlay
  if (hasUnlocked && overlay) {
    overlay.classList.remove('active');
  }

  let promptTriggered = false;

  vimeoPlayer.on('timeupdate', function(data) {
    // If play duration exceeds 5 seconds and not unlocked
    if (data.seconds >= 5 && !hasUnlocked && !promptTriggered) {
      promptTriggered = true;
      vimeoPlayer.pause().then(() => {
        if (overlay) {
          overlay.classList.add('active');
        }
        triggerVideoLeadModal();
      }).catch(err => {
        console.error('Error pausing video:', err);
      });
    }
  });

  // Also, when the video is played, check lock status
  vimeoPlayer.on('play', function() {
    vimeoPlayer.getCurrentTime().then(seconds => {
      if (seconds >= 5 && !hasUnlocked) {
        vimeoPlayer.pause();
        if (overlay) overlay.classList.add('active');
        triggerVideoLeadModal();
      }
    });
  });
}

function unlockDroneVideo() {
  hasUnlocked = true;
  localStorage.setItem('tribeca_video_unlocked', 'true');
  const overlay = document.getElementById('videoOverlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
  if (vimeoPlayer) {
    vimeoPlayer.play().catch(err => console.log('Failed to resume video:', err));
  }
}

function triggerVideoLeadModal() {
  openModal('Unlock Drone Walkthrough', 'Enter your details to unlock and continue the drone walkthrough of Tribeca The Everett.');
}

// Call initDroneVideo on load
document.addEventListener('DOMContentLoaded', initDroneVideo);

// ══════════════════════════════════════════════════════════════
//  CONTENT PROTECTION
// ══════════════════════════════════════════════════════════════

// 1. Disable Right-Click context menu
document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  return false;
});

// 2. Disable F12, Ctrl+Shift+I/J, Ctrl+U, Ctrl+S, Ctrl+A
document.addEventListener('keydown', function(e) {
  const key = e.key;
  const ctrl = e.ctrlKey || e.metaKey; // covers Cmd on Mac too
  const shift = e.shiftKey;

  // F12 — DevTools
  if (key === 'F12') { e.preventDefault(); return false; }

  // Ctrl+Shift+I — Inspect Element
  if (ctrl && shift && (key === 'I' || key === 'i')) { e.preventDefault(); return false; }

  // Ctrl+Shift+J — JS Console
  if (ctrl && shift && (key === 'J' || key === 'j')) { e.preventDefault(); return false; }

  // Ctrl+Shift+C — Element Picker
  if (ctrl && shift && (key === 'C' || key === 'c')) { e.preventDefault(); return false; }

  // Ctrl+U — View Source
  if (ctrl && (key === 'U' || key === 'u')) { e.preventDefault(); return false; }

  // Ctrl+S — Save Page
  if (ctrl && (key === 'S' || key === 's')) { e.preventDefault(); return false; }

  // Ctrl+A — Select All
  if (ctrl && (key === 'A' || key === 'a')) { e.preventDefault(); return false; }
});

// 3. Block copy and cut clipboard events (outside form inputs)
document.addEventListener('copy', function(e) {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') {
    e.preventDefault();
    return false;
  }
});
document.addEventListener('cut', function(e) {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') {
    e.preventDefault();
    return false;
  }
});

// 4. Prevent drag-start on images
document.querySelectorAll('img').forEach(img => {
  img.addEventListener('dragstart', e => e.preventDefault());
});
