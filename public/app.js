// Highlight active nav link based on current path
(function(){
  try {
    const path = location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.navbar a').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      const hrefNorm = href.replace(/\/$/, '') || '/';
      if (hrefNorm === path) {
        a.classList.add('active');
      } else {
        a.classList.remove('active');
      }
    });
  } catch (e) {}
})();

// Theme switcher injection
(function themeDropdown(){
  try {
    const root = document.documentElement;
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;

    // Remove pill buttons if they exist
    const oldButtons = navRight.querySelector('.theme-buttons');
    if (oldButtons) oldButtons.remove();

    // Create or reuse wrapper
    let wrap = navRight.querySelector('.theme-switch');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'theme-switch';
    } else {
      wrap.innerHTML = '';
    }

    // Label
    const label = document.createElement('span');
    label.className = 'theme-label';
    label.textContent = 'Theme:';
    label.style.color = 'var(--muted)';

    // Dropdown
    const sel = document.createElement('select');
    sel.className = 'theme-select';
    sel.innerHTML = `
      <option value="blue">Blue</option>
      <option value="emerald">Emerald</option>
      <option value="purple">Purple</option>
      <option value="dark">Dark</option>
    `;

    const saved = localStorage.getItem('vms-theme') || 'blue';
    sel.value = saved;
    root.setAttribute('data-theme', saved);

    sel.addEventListener('change', () => {
      const val = sel.value;
      localStorage.setItem('vms-theme', val);
      root.setAttribute('data-theme', val);
    });

    wrap.appendChild(label);
    wrap.appendChild(sel);

    // Place it right next to Admin link
    const adminLink = navRight.querySelector('a[href="/admin"]')
      || Array.from(navRight.querySelectorAll('a')).find(a => /admin/i.test(a.textContent));

    if (adminLink) {
      adminLink.insertAdjacentElement('afterend', wrap);
    } else {
      navRight.appendChild(wrap);
    }
  } catch (e) {}
})();

// Mobile menu toggle for small screens
(function mobileMenuToggle(){
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;
  const navLeft = navbar.querySelector('.nav-left') || navbar.querySelector('.brand')?.parentElement || navbar;
  const navRight = navbar.querySelector('.nav-right') || navbar.querySelector('.theme-switch')?.parentElement || navbar;

  // Create toggle button only if not present
  if (!navbar.querySelector('.menu-toggle')) {
    const btn = document.createElement('button');
    btn.className = 'menu-toggle';
    btn.setAttribute('aria-label', 'Toggle menu');
    btn.innerHTML = '<span class="bar"></span>';
    // Insert at start of left area
    if (navLeft && navLeft.firstChild) {
      navLeft.insertBefore(btn, navLeft.firstChild);
    } else {
      navbar.insertBefore(btn, navbar.firstChild);
    }

    btn.addEventListener('click', () => {
      navRight.classList.toggle('open');
    });

    // Close menu on link click (mobile)
    navRight.addEventListener('click', (e) => {
      const t = e.target;
      if (t.tagName === 'A') {
        navRight.classList.remove('open');
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!navbar.contains(e.target)) {
        navRight.classList.remove('open');
      }
    });
  }
})();