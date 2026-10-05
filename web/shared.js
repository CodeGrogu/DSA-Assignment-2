/**
 * Food Delivery Suite — Shared JavaScript Library (shared.js)
 * Modern Resilient Networking, Mathematical Projections, Formatters & UI Utilities
 */

// ============================================================================
// 1. ROBUST MULTI-PORT & PROXY NETWORKING
// ============================================================================

/**
 * Resolves candidate URLs in priority order:
 * 1. If on port 8080: /api/${port}${cleanPath}
 * 2. http://localhost:8080/api/${port}${cleanPath}
 * 3. http://127.0.0.1:8080/api/${port}${cleanPath}
 * 4. http://127.0.0.1:${port}${cleanPath}
 * 5. http://localhost:${port}${cleanPath}
 */
function getCandidateUrls(port, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const urls = [];

  const isBrowser = typeof window !== 'undefined' && window.location;
  if (isBrowser) {
    if (window.location.port === '8080') {
      urls.push(`/api/${port}${cleanPath}`);
    }
  }

  // Guaranteed CORS-free proxy candidates on port 8080
  urls.push(`http://localhost:8080/api/${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:8080/api/${port}${cleanPath}`);
  urls.push(`http://localhost:${port}${cleanPath}`);
  urls.push(`http://127.0.0.1:${port}${cleanPath}`);

  return [...new Set(urls)];
}

/**
 * Resolves optimal primary API URL.
 */
function resolveApiUrl(port, path) {
  const candidates = getCandidateUrls(port, path);
  return candidates[0] || `/api/${port}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Resilient API fetch that tries prioritized candidate URLs.
 * Default timeout is 5000ms.
 */
async function apiFetch(port, path, options = {}) {
  const timeoutMs = options.timeoutMs || options.timeout || 5000;
  const urls = getCandidateUrls(port, path);

  let lastError = null;

  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOpts = {
        ...options,
        signal: controller.signal
      };
      delete fetchOpts.timeoutMs;
      delete fetchOpts.timeout;

      const res = await fetch(url, fetchOpts);
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      // Network/Abort error: fall through to next candidate URL
    }
  }

  throw lastError || new Error(`Failed to reach service on port ${port} across all candidate URLs`);
}

/**
 * Checks service health on a specific port.
 * Calls apiFetch(port, '/health') and returns { up: boolean, latencyMs: number, data: object }.
 */
async function probeHealth(port) {
  const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    const res = await apiFetch(port, '/health', { timeoutMs: 5000 });
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const latencyMs = Math.max(1, Math.round(end - start));

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { up: true, latencyMs, data, status: 'UP' };
    }
    const data = await res.json().catch(() => ({}));
    return { up: false, latencyMs, data, status: `HTTP ${res.status}` };
  } catch (err) {
    return { up: false, latencyMs: 0, data: { error: err.message }, status: 'OFFLINE' };
  }
}

// ============================================================================
// 2. MATHEMATICAL SPATIAL MODEL (Windhoek Degree Projection)
// Exact match to customer_service/address_verification.bal
// ============================================================================
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const latDiff = Number(lat1) - Number(lat2);
  const lonDiff = Number(lon1) - Number(lon2);
  const latKm = latDiff * 111.0;
  const lonKm = lonDiff * 102.5;
  return Math.sqrt(latKm * latKm + lonKm * lonKm);
}

function calculateETA(distanceKm) {
  if (distanceKm <= 0.05) return "Arrived";
  const mins = Math.max(1, Math.round((distanceKm / 30.0) * 60));
  return `~${mins} min${mins > 1 ? "s" : ""}`;
}

// ============================================================================
// 3. FORMATTERS & DOM UTILITIES
// ============================================================================
function setText(id, text) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatMoney(amount) {
  if (amount === null || amount === undefined || isNaN(Number(amount))) return "N$ 0.00";
  return "N$ " + Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString();
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Modal Helpers
function openModal(modalId) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(modalId);
  if (el) el.style.display = "flex";
}

function closeModal(modalId) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(modalId);
  if (el) el.style.display = "none";
}

// Generic Tab Switcher
function setupTabNavigation(navContainerSelector, activeClass = "active") {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`${navContainerSelector} .nav-tab-btn`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      if (!targetId) return;

      // Update nav buttons
      document.querySelectorAll(`${navContainerSelector} .nav-tab-btn`).forEach((b) => b.classList.remove(activeClass));
      btn.classList.add(activeClass);

      // Update view panels
      document.querySelectorAll(".view-section").forEach((panel) => panel.classList.remove(activeClass));
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add(activeClass);
    });
  });
}

/**
 * Universal Custom Dropdown Menu Initializer
 * Replaces native OS dropdown popups with a modern, custom-styled floating menu.
 */
function initCustomDropdownMenus(root = document) {
  if (typeof document === 'undefined') return;
  const selects = root.querySelectorAll('select:not([data-custom-dropdown-init="true"])');
  selects.forEach(select => {
    // If the select is already inside a custom-dropdown-root, mark and skip
    if (select.closest('.custom-dropdown-root')) {
      select.setAttribute('data-custom-dropdown-init', 'true');
      return;
    }
    select.setAttribute('data-custom-dropdown-init', 'true');

    // Completely remove any redundant sibling chevron icon in parent wrapper
    if (select.parentElement) {
      select.parentElement.querySelectorAll('.select-chevron-icon, .select-arrow').forEach(icon => {
        icon.remove();
      });
    }

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown-root' + (select.classList.contains('select-sm') ? ' select-sm' : '');
    if (select.id) wrapper.setAttribute('data-target-select', select.id);
    
    // Hide native select visually but keep it accessible for forms and event listeners
    select.classList.add('custom-select-hidden');
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-dropdown-trigger';
    
    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'custom-dropdown-label';
    const activeOpt = select.options[select.selectedIndex];
    triggerLabel.textContent = activeOpt ? activeOpt.text : (select.getAttribute('placeholder') || 'Select option...');

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'custom-dropdown-arrow');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    trigger.appendChild(triggerLabel);
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    // Create floating menu
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.setAttribute('role', 'listbox');

    function rebuildMenu() {
      menu.innerHTML = '';
      if (select.options.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'custom-dropdown-item disabled';
        emptyItem.textContent = 'No options available';
        menu.appendChild(emptyItem);
        return;
      }

      Array.from(select.options).forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'custom-dropdown-item' + (idx === select.selectedIndex ? ' selected' : '') + (opt.disabled ? ' disabled' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', opt.value);
        
        const itemText = document.createElement('span');
        itemText.className = 'item-text';
        itemText.textContent = opt.text;
        item.appendChild(itemText);

        if (idx === select.selectedIndex) {
          const checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          checkIcon.setAttribute('class', 'item-check');
          checkIcon.setAttribute('viewBox', '0 0 24 24');
          checkIcon.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
          item.appendChild(checkIcon);
        }

        if (!opt.disabled) {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            select.selectedIndex = idx;
            select.value = opt.value;
            triggerLabel.textContent = opt.text;
            closeAllDropdowns();
            rebuildMenu();
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
        menu.appendChild(item);
      });
    }

    rebuildMenu();
    wrapper.appendChild(menu);

    // Toggle open/close
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) {
        wrapper.classList.add('open');
      }
    });

    // Listen to native change event in case code changes it programmatically
    select.addEventListener('change', () => {
      const curOpt = select.options[select.selectedIndex];
      if (curOpt) {
        triggerLabel.textContent = curOpt.text;
      }
      rebuildMenu();
    });

    // Mutation observer on select to detect options added/removed dynamically
    const observer = new MutationObserver(() => {
      const curOpt = select.options[select.selectedIndex];
      if (curOpt) triggerLabel.textContent = curOpt.text;
      rebuildMenu();
    });
    observer.observe(select, { childList: true, subtree: true });
  });
}

function closeAllDropdowns() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-dropdown-root.open').forEach(el => el.classList.remove('open'));
}

function closeAllDatePickers() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-datetime-root.open').forEach(el => el.classList.remove('open'));
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown-root')) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
      closeAllDatePickers();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-datetime-root')) {
      closeAllDatePickers();
    }
  });

  // Close modals on backdrop click to ensure no click-blocking overlay ever lingers
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
      e.target.style.display = 'none';
      e.target.classList.remove('open');
      e.target.classList.remove('active');
    }
  });

  // Auto initialize on DOM ready and observe dynamically added selects & date/time inputs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initCustomDropdownMenus();
      initCustomDateTimePickers();
    });
  } else {
    setTimeout(() => {
      initCustomDropdownMenus();
      initCustomDateTimePickers();
    }, 50);
  }

  // Periodic scan to catch selects and date pickers added asynchronously by app templates
  setInterval(() => {
    initCustomDropdownMenus();
    initCustomDateTimePickers();
    document.querySelectorAll('.custom-dropdown-root').forEach(wrap => {
      const sel = wrap.querySelector('select');
      const lbl = wrap.querySelector('.custom-dropdown-label');
      if (sel && lbl && sel.options[sel.selectedIndex]) {
        const expected = sel.options[sel.selectedIndex].text;
        if (lbl.textContent !== expected) {
          lbl.textContent = expected;
        }
      }
    });
    document.querySelectorAll('.custom-datetime-root').forEach(wrap => {
      const inp = wrap.querySelector('input');
      const lbl = wrap.querySelector('.custom-datetime-label');
      if (inp && lbl && typeof inp._customFormatDisplay === 'function') {
        const expected = inp._customFormatDisplay(inp.value);
        if (lbl.textContent !== expected) {
          lbl.textContent = expected;
          if (!inp.value) lbl.classList.add('placeholder');
          else lbl.classList.remove('placeholder');
        }
      }
    });
  }, 500);
}

/**
 * Bespoke Custom Date & Time Picker Initializer
 * Replaces native OS date/time popups with an elegant floating calendar & time selector.
 * Supports:
 * - input[type="date"]
 * - input[type="datetime-local"]
 * - input[type="time"]
 * Includes month navigation, day grid, hour/minute steppers, and preset buttons.
 * Guarantees zero invisible click-blocking overlays.
 */
function initCustomDateTimePickers(root = document) {
  if (typeof document === 'undefined') return;
  const inputs = root.querySelectorAll('input[type="date"]:not([data-custom-datetime-init="true"]), input[type="time"]:not([data-custom-datetime-init="true"]), input[type="datetime-local"]:not([data-custom-datetime-init="true"])');

  inputs.forEach(input => {
    if (input.closest('.custom-datetime-root')) {
      input.setAttribute('data-custom-datetime-init', 'true');
      return;
    }
    input.setAttribute('data-custom-datetime-init', 'true');

    const isTime = input.type === 'time';
    const isDateTime = input.type === 'datetime-local';
    const isDate = input.type === 'date' || isDateTime;

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-datetime-root ' + (input.className || '');
    if (input.id) wrapper.setAttribute('data-target-input', input.id);

    // Hide native input visually but keep accessible
    input.classList.add('custom-input-hidden');
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-datetime-trigger';

    const triggerLeft = document.createElement('div');
    triggerLeft.className = 'custom-datetime-trigger-left';

    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('class', 'custom-datetime-icon');
    iconSvg.setAttribute('viewBox', '0 0 24 24');
    if (isTime) {
      iconSvg.innerHTML = '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>';
    } else {
      iconSvg.innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
    }

    const label = document.createElement('span');
    label.className = 'custom-datetime-label';

    function formatDisplay(val) {
      if (!val) {
        if (input.placeholder) return input.placeholder;
        if (isDateTime) return 'Select date & time...';
        if (isTime) return 'Select time...';
        return 'Select date...';
      }
      if (isTime) {
        return val;
      }
      if (isDateTime) {
        try {
          const [dPart, tPart] = val.split('T');
          if (dPart) {
            const parts = dPart.split('-');
            if (parts.length === 3) {
              const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
              const dateFmt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
              return tPart ? `${dateFmt}, ${tPart}` : dateFmt;
            }
          }
        } catch (_) {}
        return val;
      }
      // isDate
      try {
        const parts = val.split('-');
        if (parts.length === 3) {
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }
      } catch (_) {}
      return val;
    }

    // Attach formatter to input for periodic sync
    input._customFormatDisplay = formatDisplay;

    function updateLabel() {
      const display = formatDisplay(input.value);
      label.textContent = display;
      if (!input.value) label.classList.add('placeholder');
      else label.classList.remove('placeholder');
    }

    updateLabel();

    triggerLeft.appendChild(iconSvg);
    triggerLeft.appendChild(label);
    trigger.appendChild(triggerLeft);

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'custom-dropdown-arrow');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    // Floating card
    const card = document.createElement('div');
    card.className = 'custom-datetime-card';

    // State
    const now = new Date();
    let selectedYear = null;
    let selectedMonth = null;
    let selectedDay = null;
    let selectedHour = 12;
    let selectedMinute = 0;
    let viewingYear = now.getFullYear();
    let viewingMonth = now.getMonth();

    function syncStateFromInput() {
      const val = input.value || '';
      if (!val) {
        selectedYear = null;
        selectedMonth = null;
        selectedDay = null;
        selectedHour = 12;
        selectedMinute = 0;
        viewingYear = now.getFullYear();
        viewingMonth = now.getMonth();
        return;
      }

      if (isTime) {
        const parts = val.split(':');
        selectedHour = Math.max(0, Math.min(23, Number(parts[0]) || 0));
        selectedMinute = Math.max(0, Math.min(59, Number(parts[1]) || 0));
      } else if (isDateTime) {
        const [dPart, tPart] = val.split('T');
        if (dPart) {
          const dParts = dPart.split('-');
          if (dParts.length === 3) {
            selectedYear = Number(dParts[0]);
            selectedMonth = Number(dParts[1]) - 1;
            selectedDay = Number(dParts[2]);
            viewingYear = selectedYear;
            viewingMonth = selectedMonth;
          }
        }
        if (tPart) {
          const tParts = tPart.split(':');
          selectedHour = Math.max(0, Math.min(23, Number(tParts[0]) || 0));
          selectedMinute = Math.max(0, Math.min(59, Number(tParts[1]) || 0));
        }
      } else if (isDate) {
        const dParts = val.split('-');
        if (dParts.length === 3) {
          selectedYear = Number(dParts[0]);
          selectedMonth = Number(dParts[1]) - 1;
          selectedDay = Number(dParts[2]);
          viewingYear = selectedYear;
          viewingMonth = selectedMonth;
        }
      }
    }

    function commitValue(newVal) {
      input.value = newVal;
      updateLabel();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderCard() {
      card.innerHTML = '';

      // Calendar Section
      if (isDate) {
        const header = document.createElement('div');
        header.className = 'calendar-header';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.setAttribute('aria-label', 'Previous Month');
        prevBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          viewingMonth--;
          if (viewingMonth < 0) {
            viewingMonth = 11;
            viewingYear--;
          }
          renderCard();
        });

        const monthTitle = document.createElement('span');
        monthTitle.className = 'calendar-month-title';
        const dRef = new Date(viewingYear, viewingMonth, 1);
        monthTitle.textContent = dRef.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'calendar-nav-btn';
        nextBtn.setAttribute('aria-label', 'Next Month');
        nextBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          viewingMonth++;
          if (viewingMonth > 11) {
            viewingMonth = 0;
            viewingYear++;
          }
          renderCard();
        });

        header.appendChild(prevBtn);
        header.appendChild(monthTitle);
        header.appendChild(nextBtn);
        card.appendChild(header);

        // Weekday names
        const weekdays = document.createElement('div');
        weekdays.className = 'calendar-weekdays';
        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(w => {
          const wd = document.createElement('div');
          wd.textContent = w;
          weekdays.appendChild(wd);
        });
        card.appendChild(weekdays);

        // Days grid
        const grid = document.createElement('div');
        grid.className = 'calendar-days-grid';

        const firstDayIndex = new Date(viewingYear, viewingMonth, 1).getDay();
        const totalDays = new Date(viewingYear, viewingMonth + 1, 0).getDate();

        // Padding before first day
        for (let i = 0; i < firstDayIndex; i++) {
          const emptyCell = document.createElement('div');
          emptyCell.className = 'calendar-day empty';
          grid.appendChild(emptyCell);
        }

        const todayObj = new Date();
        const todayY = todayObj.getFullYear();
        const todayM = todayObj.getMonth();
        const todayD = todayObj.getDate();

        for (let day = 1; day <= totalDays; day++) {
          const dayCell = document.createElement('div');
          dayCell.className = 'calendar-day';
          dayCell.textContent = day;

          if (viewingYear === todayY && viewingMonth === todayM && day === todayD) {
            dayCell.classList.add('today');
          }
          if (viewingYear === selectedYear && viewingMonth === selectedMonth && day === selectedDay) {
            dayCell.classList.add('selected');
          }

          dayCell.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedYear = viewingYear;
            selectedMonth = viewingMonth;
            selectedDay = day;

            const yStr = String(selectedYear).padStart(4, '0');
            const mStr = String(selectedMonth + 1).padStart(2, '0');
            const dStr = String(selectedDay).padStart(2, '0');

            if (isDateTime) {
              const hStr = String(selectedHour).padStart(2, '0');
              const minStr = String(selectedMinute).padStart(2, '0');
              commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
              renderCard();
            } else {
              commitValue(`${yStr}-${mStr}-${dStr}`);
              closeAllDatePickers();
            }
          });

          grid.appendChild(dayCell);
        }
        card.appendChild(grid);
      }

      // Time Section with Steppers
      if (isTime || isDateTime) {
        const timeSec = document.createElement('div');
        timeSec.className = 'custom-time-section';

        const timeLbl = document.createElement('span');
        timeLbl.className = 'custom-time-label';
        timeLbl.textContent = 'Time (24h)';

        const steppersWrap = document.createElement('div');
        steppersWrap.className = 'custom-time-steppers-wrap';

        function applyTimeChange() {
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          if (isTime) {
            commitValue(`${hStr}:${minStr}`);
          } else if (isDateTime) {
            if (selectedYear === null) {
              const dNow = new Date();
              selectedYear = dNow.getFullYear();
              selectedMonth = dNow.getMonth();
              selectedDay = dNow.getDate();
            }
            const yStr = String(selectedYear).padStart(4, '0');
            const mStr = String(selectedMonth + 1).padStart(2, '0');
            const dStr = String(selectedDay).padStart(2, '0');
            commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
            renderCard();
          }
        }

        // Hour Stepper
        const hrStepper = document.createElement('div');
        hrStepper.className = 'custom-stepper-unit';

        const hrUpBtn = document.createElement('button');
        hrUpBtn.type = 'button';
        hrUpBtn.className = 'stepper-btn';
        hrUpBtn.setAttribute('aria-label', 'Increment Hour');
        hrUpBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        hrUpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = (selectedHour + 1) % 24;
          applyTimeChange();
          hrInput.value = String(selectedHour).padStart(2, '0');
        });

        const hrInput = document.createElement('input');
        hrInput.type = 'number';
        hrInput.className = 'custom-time-input-box';
        hrInput.min = '0';
        hrInput.max = '23';
        hrInput.value = String(selectedHour).padStart(2, '0');
        hrInput.addEventListener('click', (e) => e.stopPropagation());
        hrInput.addEventListener('change', () => {
          let v = parseInt(hrInput.value, 10);
          if (isNaN(v)) v = 0;
          selectedHour = Math.max(0, Math.min(23, v));
          hrInput.value = String(selectedHour).padStart(2, '0');
          applyTimeChange();
        });

        const hrDownBtn = document.createElement('button');
        hrDownBtn.type = 'button';
        hrDownBtn.className = 'stepper-btn';
        hrDownBtn.setAttribute('aria-label', 'Decrement Hour');
        hrDownBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        hrDownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = (selectedHour - 1 + 24) % 24;
          applyTimeChange();
          hrInput.value = String(selectedHour).padStart(2, '0');
        });

        hrStepper.appendChild(hrUpBtn);
        hrStepper.appendChild(hrInput);
        hrStepper.appendChild(hrDownBtn);

        // Colon
        const colon = document.createElement('span');
        colon.className = 'custom-time-colon';
        colon.textContent = ':';

        // Minute Stepper
        const minStepper = document.createElement('div');
        minStepper.className = 'custom-stepper-unit';

        const minUpBtn = document.createElement('button');
        minUpBtn.type = 'button';
        minUpBtn.className = 'stepper-btn';
        minUpBtn.setAttribute('aria-label', 'Increment Minute');
        minUpBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"></polyline></svg>';
        minUpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedMinute = (selectedMinute + 5) % 60;
          applyTimeChange();
          minInput.value = String(selectedMinute).padStart(2, '0');
        });

        const minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.className = 'custom-time-input-box';
        minInput.min = '0';
        minInput.max = '59';
        minInput.value = String(selectedMinute).padStart(2, '0');
        minInput.addEventListener('click', (e) => e.stopPropagation());
        minInput.addEventListener('change', () => {
          let v = parseInt(minInput.value, 10);
          if (isNaN(v)) v = 0;
          selectedMinute = Math.max(0, Math.min(59, v));
          minInput.value = String(selectedMinute).padStart(2, '0');
          applyTimeChange();
        });

        const minDownBtn = document.createElement('button');
        minDownBtn.type = 'button';
        minDownBtn.className = 'stepper-btn';
        minDownBtn.setAttribute('aria-label', 'Decrement Minute');
        minDownBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        minDownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedMinute = (selectedMinute - 5 + 60) % 60;
          applyTimeChange();
          minInput.value = String(selectedMinute).padStart(2, '0');
        });

        minStepper.appendChild(minUpBtn);
        minStepper.appendChild(minInput);
        minStepper.appendChild(minDownBtn);

        steppersWrap.appendChild(hrStepper);
        steppersWrap.appendChild(colon);
        steppersWrap.appendChild(minStepper);

        timeSec.appendChild(timeLbl);
        timeSec.appendChild(steppersWrap);
        card.appendChild(timeSec);
      }

      // Presets Bar
      const presets = document.createElement('div');
      presets.className = 'custom-picker-presets';

      const presetLeft = document.createElement('div');
      presetLeft.className = 'picker-preset-group';

      if (isDate && !isDateTime) {
        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'picker-preset-btn';
        todayBtn.textContent = 'Today';
        todayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          const yStr = String(d.getFullYear()).padStart(4, '0');
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}`);
          closeAllDatePickers();
        });
        presetLeft.appendChild(todayBtn);

        const tomorrowBtn = document.createElement('button');
        tomorrowBtn.type = 'button';
        tomorrowBtn.className = 'picker-preset-btn';
        tomorrowBtn.textContent = 'Tomorrow';
        tomorrowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          d.setDate(d.getDate() + 1);
          const yStr = String(d.getFullYear()).padStart(4, '0');
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}`);
          closeAllDatePickers();
        });
        presetLeft.appendChild(tomorrowBtn);

        const yestBtn = document.createElement('button');
        yestBtn.type = 'button';
        yestBtn.className = 'picker-preset-btn';
        yestBtn.textContent = 'Yesterday';
        yestBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          d.setDate(d.getDate() - 1);
          const yStr = String(d.getFullYear()).padStart(4, '0');
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const dStr = String(d.getDate()).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}`);
          closeAllDatePickers();
        });
        presetLeft.appendChild(yestBtn);
      } else if (isDateTime) {
        const nowBtn = document.createElement('button');
        nowBtn.type = 'button';
        nowBtn.className = 'picker-preset-btn';
        nowBtn.textContent = 'Now';
        nowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          selectedYear = d.getFullYear();
          selectedMonth = d.getMonth();
          selectedDay = d.getDate();
          selectedHour = d.getHours();
          selectedMinute = d.getMinutes();
          const yStr = String(selectedYear).padStart(4, '0');
          const mStr = String(selectedMonth + 1).padStart(2, '0');
          const dStr = String(selectedDay).padStart(2, '0');
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
          renderCard();
        });
        presetLeft.appendChild(nowBtn);

        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'picker-preset-btn';
        todayBtn.textContent = 'Today';
        todayBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          selectedYear = d.getFullYear();
          selectedMonth = d.getMonth();
          selectedDay = d.getDate();
          const yStr = String(selectedYear).padStart(4, '0');
          const mStr = String(selectedMonth + 1).padStart(2, '0');
          const dStr = String(selectedDay).padStart(2, '0');
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          commitValue(`${yStr}-${mStr}-${dStr}T${hStr}:${minStr}`);
          renderCard();
        });
        presetLeft.appendChild(todayBtn);
      } else if (isTime) {
        const nowBtn = document.createElement('button');
        nowBtn.type = 'button';
        nowBtn.className = 'picker-preset-btn';
        nowBtn.textContent = 'Now';
        nowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const d = new Date();
          selectedHour = d.getHours();
          selectedMinute = d.getMinutes();
          const hStr = String(selectedHour).padStart(2, '0');
          const minStr = String(selectedMinute).padStart(2, '0');
          commitValue(`${hStr}:${minStr}`);
          renderCard();
        });
        presetLeft.appendChild(nowBtn);

        const noonBtn = document.createElement('button');
        noonBtn.type = 'button';
        noonBtn.className = 'picker-preset-btn';
        noonBtn.textContent = '12:00';
        noonBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = 12;
          selectedMinute = 0;
          commitValue('12:00');
          renderCard();
        });
        presetLeft.appendChild(noonBtn);

        const eveBtn = document.createElement('button');
        eveBtn.type = 'button';
        eveBtn.className = 'picker-preset-btn';
        eveBtn.textContent = '18:00';
        eveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedHour = 18;
          selectedMinute = 0;
          commitValue('18:00');
          renderCard();
        });
        presetLeft.appendChild(eveBtn);
      }

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'picker-preset-btn';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedYear = null;
        selectedMonth = null;
        selectedDay = null;
        commitValue('');
        closeAllDatePickers();
      });
      presetLeft.appendChild(clearBtn);

      presets.appendChild(presetLeft);

      if (isTime || isDateTime) {
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'picker-preset-btn btn-confirm';
        doneBtn.textContent = 'Apply';
        doneBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAllDatePickers();
        });
        presets.appendChild(doneBtn);
      }

      card.appendChild(presets);
    }

    syncStateFromInput();
    renderCard();
    wrapper.appendChild(card);

    // Toggle open
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapper.classList.contains('open');
      closeAllDatePickers();
      closeAllDropdowns();
      if (!isOpen) {
        syncStateFromInput();
        renderCard();
        // Position card appropriately
        const rect = wrapper.getBoundingClientRect();
        if (rect.right + 300 > window.innerWidth && rect.right > 300) {
          card.style.left = 'auto';
          card.style.right = '0';
        } else {
          card.style.left = '0';
          card.style.right = 'auto';
        }
        wrapper.classList.add('open');
      }
    });

    // Native input listeners
    input.addEventListener('change', () => {
      syncStateFromInput();
      updateLabel();
      renderCard();
    });
    input.addEventListener('input', () => {
      syncStateFromInput();
      updateLabel();
      renderCard();
    });
  });
}

function closeAllDatePickers() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.custom-datetime-root.open').forEach(el => el.classList.remove('open'));
}

// ============================================================================
// 4. GOOGLE MAPS PLATFORM INTEGRATION & COORDINATES
// Adhering to Google Maps Platform Best Practices:
// - Explicit container height (CF2)
// - AdvancedMarkerElement with mapId: 'DEMO_MAP_ID' (CF7, CF9)
// - POJO {lat, lng} literals (CF6)
// - Attribution: gmp_git_agentskills_v1
// ============================================================================

const GOOGLE_MAPS_CONFIG = {
  mapId: "DEMO_MAP_ID",
  attributionTag: "gmp_git_agentskills_v1",
  coordinates: {
    windhoekCentral: { lat: -22.5609, lng: 17.0658 },
    restaurantR001: { lat: -22.5609, lng: 17.0658 },
    customerDelivery: { lat: -22.5695, lng: 17.0850 },
    courierLocation: { lat: -22.5700, lng: 17.0800 }
  }
};

let _gmpLoaderPromise = null;

/**
 * Modern Google Maps API Dynamic Script Loader with @googlemaps/js-api-loader fallback pattern.
 * Resolves libraries { Map, AdvancedMarkerElement, PinElement } using importLibrary.
 */
function loadGoogleMapsLibraries(customKey = "") {
  if (typeof window === "undefined") return Promise.reject(new Error("No window context"));
  
  if (_gmpLoaderPromise) return _gmpLoaderPromise;

  _gmpLoaderPromise = new Promise((resolve, reject) => {
    // If already initialized with importLibrary
    if (window.google?.maps?.importLibrary) {
      return Promise.all([
        window.google.maps.importLibrary("maps"),
        window.google.maps.importLibrary("marker")
      ]).then(([mapsLib, markerLib]) => {
        resolve({
          Map: mapsLib.Map,
          AdvancedMarkerElement: markerLib.AdvancedMarkerElement,
          PinElement: markerLib.PinElement
        });
      }).catch(reject);
    }

    const key = customKey || window.GOOGLE_MAPS_API_KEY || localStorage.getItem("google_maps_api_key") || "";

    // Bootstrap dynamic script loader
    const script = document.createElement("script");
    script.id = "gmp-script-loader";
    const params = new URLSearchParams({
      v: "weekly",
      loading: "async"
    });
    if (key) {
      params.set("key", key);
    }
    // Usage attribution tracking
    params.set("client", GOOGLE_MAPS_CONFIG.attributionTag);

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;

    // Timeout after 6 seconds to trigger offline fallback smoothly
    const timeoutId = setTimeout(() => {
      reject(new Error("Google Maps load timeout. Reverting to offline Windhoek vector map."));
    }, 6000);

    script.onload = () => {
      clearTimeout(timeoutId);
      if (window.google?.maps?.importLibrary) {
        Promise.all([
          window.google.maps.importLibrary("maps"),
          window.google.maps.importLibrary("marker")
        ]).then(([mapsLib, markerLib]) => {
          resolve({
            Map: mapsLib.Map,
            AdvancedMarkerElement: markerLib.AdvancedMarkerElement,
            PinElement: markerLib.PinElement
          });
        }).catch(reject);
      } else {
        reject(new Error("Google Maps loaded without importLibrary support"));
      }
    };

    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("Google Maps network request failed. Reverting to offline Windhoek vector map."));
    };

    document.head.appendChild(script);
  });

  return _gmpLoaderPromise;
}

/**
 * Creates custom styled HTML pin elements for AdvancedMarkerElement
 */
function createCustomMarkerElement({ type, title, subtitle }) {
  const wrapper = document.createElement("div");
  wrapper.className = `gmp-advanced-pin-marker gmp-pin-${type}`;

  let iconSvg = "";
  if (type === "driver") {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M5 17h10l3-6H8l-1 3H4"/></svg>`;
  } else if (type === "restaurant") {
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;
  } else {
    // customer destination
    iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  }

  wrapper.innerHTML = `
    <div class="gmp-pin-badge">
      <div class="gmp-pin-icon-wrap">${iconSvg}</div>
      <div class="gmp-pin-text">
        <strong class="gmp-pin-title">${escapeHtml(title)}</strong>
        ${subtitle ? `<span class="gmp-pin-subtitle">${escapeHtml(subtitle)}</span>` : ""}
      </div>
    </div>
    <div class="gmp-pin-arrow"></div>
  `;
  return wrapper;
}

// Browser global export
if (typeof window !== 'undefined') {
  window.GOOGLE_MAPS_CONFIG = GOOGLE_MAPS_CONFIG;
  window.loadGoogleMapsLibraries = loadGoogleMapsLibraries;
  window.createCustomMarkerElement = createCustomMarkerElement;

  window.DSA = {
    getCandidateUrls,
    resolveApiUrl,
    apiFetch,
    probeHealth,
    calculateDistanceKm,
    calculateETA,
    setText,
    formatMoney,
    formatNumber,
    escapeHtml,
    openModal,
    closeModal,
    setupTabNavigation,
    initCustomDropdownMenus,
    closeAllDropdowns,
    initCustomDateTimePickers,
    closeAllDatePickers,
    GOOGLE_MAPS_CONFIG,
    loadGoogleMapsLibraries,
    createCustomMarkerElement
  };
  window.sharedApiFetch = apiFetch;
  window.sharedProbeHealth = probeHealth;
  window.initCustomDropdownMenus = initCustomDropdownMenus;
  window.initCustomDateTimePickers = initCustomDateTimePickers;
}

// Export for Node environments / testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getCandidateUrls,
    resolveApiUrl,
    apiFetch,
    probeHealth,
    calculateDistanceKm,
    calculateETA,
    setText,
    formatMoney,
    formatNumber,
    escapeHtml,
    openModal,
    closeModal,
    setupTabNavigation,
    initCustomDropdownMenus,
    closeAllDropdowns,
    GOOGLE_MAPS_CONFIG,
    loadGoogleMapsLibraries,
    createCustomMarkerElement
  };
}

