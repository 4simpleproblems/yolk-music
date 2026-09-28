(function() {
  if (typeof window === 'undefined') return;

  const seenInit = localStorage.getItem('pinpoint_walkthrough_v3') === 'true';
  const activeInit = sessionStorage.getItem('pinpoint_walkthrough_active') === 'true';
  if (!seenInit || activeInit) {
    if (document.documentElement) {
      document.documentElement.classList.add('pinpoint-hide-cursor');
    }
  }

  function initWalkthrough() {
    const path = window.location.pathname.toLowerCase();
    const isMusic = path.includes('music');
    const isClassworkHistory = !isMusic && path.includes('classwork') && (path.includes('history') || path.includes('english'));
    const isHistory = !isMusic && !path.includes('classwork') && (path.includes('history') || path.includes('english'));
    const isAI = !isMusic && path.includes('ai');
    // history handled above
    const isSettings = !isMusic && path.includes('settings');

    const isHome = !isMusic && !isClassworkHistory && !isHistory && !isAI && !isHistory && !isSettings && (
      path === '' || path === '/' ||
      path.endsWith('/index.html') || path.endsWith('/index') || path === 'index.html' ||
      path.endsWith('/pinpoint-edu') || path.endsWith('/pinpoint-edu/')
    );

    const seen = localStorage.getItem('pinpoint_walkthrough_v3') === 'true';
    if (seen) {
      try { localStorage.setItem('pinpoint_walkthrough_completed_ever_v3', 'true'); } catch (e) {}
    }
    const active = sessionStorage.getItem('pinpoint_walkthrough_active') === 'true';
    const step = sessionStorage.getItem('pinpoint_walkthrough_step') || (isHome ? '1' : null);

    if (!seen) {
      const allowedActive = active && (
        (step === '3' && isHistory) ||
        (step === '4' && isClassworkHistory) ||
        (step === '5' && isAI) ||
        (step === '6' && isMusic)
      );
      if (!isHome && !allowedActive) {
        const homeUrl = path.includes('/pages/') ? '../index.html' : './index.html';
        window.location.replace(homeUrl);
        return;
      }
    }

    if (seen && !active) return;
    if (!isHome && !isHistory && !isClassworkHistory && !isAI && !isMusic) return;

    isWalkthroughRunning = true;
    injectStyles();
    hideUserCursor();

    if (isHome && (step === '1' || step === '2' || !seen)) {
      if (step === '2') {
        runStep2Library();
      } else {
        runStep1Clock();
      }
    } else if (isHistory && step === '3') {
      runStep3Classwork();
    } else if (isClassworkHistory && step === '4') {
      runStep4ShowcaseAndFavorites();
    } else if (isAI && step === '5') {
      runStep5Gemini();
    } else if (isMusic && step === '6') {
      runStep6Music();
    }
  }

  function injectStyles() {
    if (document.getElementById('pinpoint-tour-styles')) return;
    const style = document.createElement('style');
    style.id = 'pinpoint-tour-styles';
    style.textContent = `
      html.pinpoint-hide-cursor,
      html.pinpoint-hide-cursor *,
      body.pinpoint-hide-cursor,
      body.pinpoint-hide-cursor * {
        cursor: none !important;
      }
      html.pinpoint-hide-cursor #pinpoint-tour-tooltip,
      html.pinpoint-hide-cursor #pinpoint-tour-tooltip *,
      html.pinpoint-hide-cursor #pinpoint-tour-showcase-bar,
      html.pinpoint-hide-cursor #pinpoint-tour-showcase-bar *,
      body.pinpoint-hide-cursor #pinpoint-tour-tooltip,
      body.pinpoint-hide-cursor #pinpoint-tour-tooltip *,
      body.pinpoint-hide-cursor #pinpoint-tour-showcase-bar,
      body.pinpoint-hide-cursor #pinpoint-tour-showcase-bar * {
        cursor: pointer !important;
      }
      html.pinpoint-hide-cursor #pinpoint-tour-tooltip div,
      html.pinpoint-hide-cursor #pinpoint-tour-tooltip p,
      body.pinpoint-hide-cursor #pinpoint-tour-tooltip div,
      body.pinpoint-hide-cursor #pinpoint-tour-tooltip p {
        cursor: default !important;
      }
      #pinpoint-virtual-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 28px;
        height: 28px;
        z-index: 10000000;
        pointer-events: none;
        user-select: none;
        transform: translate3d(0, 0, 0);
        will-change: transform;
        transition: transform 0.05s ease-out;
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.45));
      }
      #pinpoint-virtual-cursor svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      #pinpoint-virtual-cursor.cursor-clicking {
        transform: scale(0.85);
      }
      .pinpoint-click-ripple {
        position: fixed;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: rgba(26, 115, 232, 0.45);
        border: 2px solid #1a73e8;
        transform: translate(-50%, -50%) scale(0.2);
        animation: pinpointRipple 0.5s ease-out forwards;
        pointer-events: none;
        z-index: 9999999;
      }
      @keyframes pinpointRipple {
        0% {
          opacity: 1;
          transform: translate(-50%, -50%) scale(0.3);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(2.2);
        }
      }
      @keyframes pinpointPulse {
        0% {
          outline-color: rgba(26, 115, 232, 0.9);
          box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.7);
        }
        50% {
          outline-color: rgba(26, 115, 232, 1);
          box-shadow: 0 0 0 6px rgba(26, 115, 232, 0), 0 0 16px rgba(26, 115, 232, 0.85);
        }
        100% {
          outline-color: rgba(26, 115, 232, 0.9);
          box-shadow: 0 0 0 0 rgba(26, 115, 232, 0.7);
        }
      }
      #pinpoint-tour-backdrop {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 999980;
        pointer-events: auto;
      }
      #pinpoint-tour-backdrop svg {
        width: 100%;
        height: 100%;
        display: block;
        pointer-events: auto;
      }
      #pinpoint-tour-backdrop rect.pinpoint-bg {
        fill: rgba(0, 0, 0, 0.65);
        pointer-events: auto;
      }
      #pinpoint-tour-highlight {
        position: fixed;
        z-index: 999990;
        background: rgba(0, 0, 0, 0.001) !important;
        outline: 2px solid #1a73e8;
        outline-offset: 0;
        animation: pinpointPulse 1.4s infinite ease-in-out;
        pointer-events: auto !important;
        box-sizing: border-box;
      }
      #pinpoint-tour-tooltip {
        position: fixed;
        z-index: 999999;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
        padding: 18px 22px;
        width: 320px;
        max-width: calc(100vw - 32px);
        font-family: 'Google Sans', Roboto, Arial, sans-serif;
        box-sizing: border-box;
        pointer-events: auto;
      }
      .pinpoint-tour-badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: #1a73e8;
        margin-bottom: 6px;
      }
      .pinpoint-tour-title {
        font-size: 16px;
        font-weight: 600;
        color: #1f1f1f;
        margin: 0 0 6px 0;
        line-height: 1.3;
      }
      .pinpoint-tour-desc {
        font-size: 14px;
        font-weight: 400;
        color: #444746;
        margin: 0 0 16px 0;
        line-height: 1.5;
      }
      .pinpoint-tour-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
      }
      .pinpoint-tour-btn-skip {
        background: transparent;
        border: none;
        color: #5f6368;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        padding: 8px 14px;
        border-radius: 18px;
        transition: background 0.2s, color 0.2s;
        user-select: none;
      }
      .pinpoint-tour-btn-skip:hover {
        background: #f1f3f4;
        color: #1f1f1f;
      }
      .pinpoint-tour-btn-next {
        background: #8ab4f8;
        border: none;
        color: #ffffff;
        font-size: 13px;
        font-weight: 500;
        cursor: not-allowed;
        opacity: 0.75;
        padding: 8px 18px;
        border-radius: 18px;
        transition: background 0.2s, opacity 0.2s, box-shadow 0.2s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        user-select: none;
      }
      .pinpoint-tour-btn-next.enabled {
        background: #1a73e8;
        cursor: pointer;
        opacity: 1;
      }
      .pinpoint-tour-btn-next.enabled:hover {
        background: #1557b0;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      }
      #pinpoint-tour-showcase-bar {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 999999;
        background: #ffffff;
        border-radius: 28px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
        padding: 12px 24px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: 'Google Sans', Roboto, Arial, sans-serif;
        box-sizing: border-box;
      }
      .pinpoint-showcase-text {
        font-size: 14px;
        font-weight: 500;
        color: #1f1f1f;
      }
      .pinpoint-showcase-skip {
        background: #1a73e8;
        border: none;
        color: #ffffff;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        padding: 6px 14px;
        border-radius: 14px;
        transition: background 0.2s;
        font-family: inherit;
      }
      .pinpoint-showcase-skip:hover {
        background: #1557b0;
      }
    `;
    document.head.appendChild(style);
  }

  let userMouseX = window.innerWidth / 2;
  let userMouseY = window.innerHeight / 2;
  let hasTrackedUserMouse = false;

  window.addEventListener('mousemove', (e) => {
    userMouseX = e.clientX;
    userMouseY = e.clientY;
    hasTrackedUserMouse = true;
  }, { capture: true, passive: true });

  let currentTarget = null;
  let updatePositionHandler = null;
  let countdownTimer = null;
  let activeCursorAnim = null;
  let isWalkthroughRunning = false;
  let isVirtualCursorMoving = false;
  let isShowcaseRunning = false;
  let showcaseCancel = null;

  function blockUserInteraction(e) {
    if (!isWalkthroughRunning) return;
    if (e.target && (e.target.closest('#pinpoint-tour-tooltip') || e.target.closest('#pinpoint-tour-showcase-bar'))) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  const blockedEvents = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu', 'dblclick'];
  blockedEvents.forEach(evtName => {
    window.addEventListener(evtName, blockUserInteraction, { capture: true, passive: false });
  });

  window.addEventListener('keydown', (e) => {
    if (!isWalkthroughRunning) return;
    if (e.target && (e.target.closest('#pinpoint-tour-tooltip') || e.target.closest('#pinpoint-tour-showcase-bar'))) {
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true, passive: false });

  function showUserCursor() {
    document.documentElement.classList.remove('pinpoint-hide-cursor');
    document.body.classList.remove('pinpoint-hide-cursor');
  }

  function hideUserCursor() {
    document.documentElement.classList.add('pinpoint-hide-cursor');
    document.body.classList.add('pinpoint-hide-cursor');
  }

  function createVirtualCursorEl() {
    let cursor = document.getElementById('pinpoint-virtual-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = 'pinpoint-virtual-cursor';
      cursor.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L5.85 2.35a.5.5 0 0 0-.85.35v.51z" fill="#111111" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      `;
      document.body.appendChild(cursor);
    }
    return cursor;
  }

  function removeVirtualCursorEl() {
    if (activeCursorAnim) {
      cancelAnimationFrame(activeCursorAnim);
      activeCursorAnim = null;
    }
    const cursor = document.getElementById('pinpoint-virtual-cursor');
    if (cursor) cursor.remove();
    const ripples = document.querySelectorAll('.pinpoint-click-ripple');
    ripples.forEach(r => r.remove());
  }

  function triggerClickRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'pinpoint-click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    document.body.appendChild(ripple);
    setTimeout(() => {
      if (ripple.parentNode) ripple.remove();
    }, 600);
  }

  function animateVirtualCursorTo(targetX, targetY, options, onComplete) {
    if (activeCursorAnim) {
      cancelAnimationFrame(activeCursorAnim);
      activeCursorAnim = null;
    }

    const opts = options || {};
    const duration = opts.duration || 1350;
    const clickAfter = opts.clickAfter !== false;
    const actionType = opts.actionType || 'click';

    isVirtualCursorMoving = true;
    hideUserCursor();
    const cursor = createVirtualCursorEl();

    let startX = hasTrackedUserMouse ? userMouseX : window.innerWidth * 0.5;
    let startY = hasTrackedUserMouse ? userMouseY : window.innerHeight * 0.8;

    if (cursor.dataset.lastX && cursor.dataset.lastY) {
      startX = parseFloat(cursor.dataset.lastX);
      startY = parseFloat(cursor.dataset.lastY);
    }

    const startTime = performance.now();

    function stepCursor(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const currentX = startX + (targetX - startX) * ease;
      const currentY = startY + (targetY - startY) * ease;

      cursor.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      cursor.dataset.lastX = currentX;
      cursor.dataset.lastY = currentY;

      if (progress < 1) {
        activeCursorAnim = requestAnimationFrame(stepCursor);
      } else {
        activeCursorAnim = null;
        cursor.dataset.lastX = targetX;
        cursor.dataset.lastY = targetY;

        if (clickAfter) {
          cursor.classList.add('cursor-clicking');
          triggerClickRipple(targetX, targetY);

          setTimeout(() => {
            cursor.classList.remove('cursor-clicking');
            if (actionType === 'type') {
              animateTypingAction(cursor, targetX, targetY, () => {
                returnCursorToUser(cursor, targetX, targetY, onComplete);
              });
            } else {
              setTimeout(() => {
                returnCursorToUser(cursor, targetX, targetY, onComplete);
              }, 250);
            }
          }, 220);
        } else {
          returnCursorToUser(cursor, targetX, targetY, onComplete);
        }
      }
    }

    activeCursorAnim = requestAnimationFrame(stepCursor);
  }

  function returnCursorToUser(cursor, fromX, fromY, onComplete) {
    if (!cursor) {
      isVirtualCursorMoving = false;
      showUserCursor();
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    const returnDestX = hasTrackedUserMouse ? userMouseX : fromX;
    const returnDestY = hasTrackedUserMouse ? userMouseY : fromY;
    const returnDuration = 1150;
    const startTime = performance.now();

    function stepReturn(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / returnDuration);
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const currentX = fromX + (returnDestX - fromX) * ease;
      const currentY = fromY + (returnDestY - fromY) * ease;

      cursor.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      cursor.dataset.lastX = currentX;
      cursor.dataset.lastY = currentY;

      if (progress < 1) {
        activeCursorAnim = requestAnimationFrame(stepReturn);
      } else {
        activeCursorAnim = null;
        cursor.style.transition = 'opacity 0.15s ease';
        cursor.style.opacity = '0';
        setTimeout(() => {
          removeVirtualCursorEl();
          isVirtualCursorMoving = false;
          showUserCursor();
          if (typeof onComplete === 'function') onComplete();
        }, 150);
      }
    }

    activeCursorAnim = requestAnimationFrame(stepReturn);
  }

  function animateTypingAction(cursor, x, y, onDone) {
    const input = document.querySelector('#chat-input');
    if (input) {
      input.focus();
      const sampleText = 'Help me study World History';
      let charIndex = 0;
      input.value = '';
      const typeInterval = setInterval(() => {
        charIndex++;
        input.value = sampleText.slice(0, charIndex);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (charIndex >= sampleText.length) {
          clearInterval(typeInterval);
          setTimeout(() => {
            if (onDone) onDone();
          }, 350);
        }
      }, 75);
    } else {
      if (onDone) onDone();
    }
  }

  function createOverlay(targetEl, config) {
    cleanUpUI();

    currentTarget = targetEl;

    const computedStyle = window.getComputedStyle(targetEl);
    const radius = config.radius !== undefined ? config.radius : (parseInt(computedStyle.borderRadius) || 0);

    const backdrop = document.createElement('div');
    backdrop.id = 'pinpoint-tour-backdrop';
    backdrop.innerHTML = `
      <svg>
        <defs>
          <mask id="pinpoint-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect id="pinpoint-mask-hole" x="0" y="0" width="0" height="0" rx="${radius}" ry="${radius}" fill="black" />
          </mask>
        </defs>
        <rect class="pinpoint-bg" x="0" y="0" width="100%" height="100%" mask="url(#pinpoint-mask)" />
      </svg>
    `;
    document.body.appendChild(backdrop);

    const highlight = document.createElement('div');
    highlight.id = 'pinpoint-tour-highlight';
    highlight.style.borderRadius = radius + 'px';
    document.body.appendChild(highlight);

    const hasSeenBefore = localStorage.getItem('pinpoint_walkthrough_completed_ever_v3') === 'true';

    const tooltip = document.createElement('div');
    tooltip.id = 'pinpoint-tour-tooltip';
    tooltip.innerHTML = `
      <div class="pinpoint-tour-badge">${config.badge || ''}</div>
      <div class="pinpoint-tour-title">${config.title || ''}</div>
      <div class="pinpoint-tour-desc">${config.desc || ''}</div>
      <div class="pinpoint-tour-actions">
        ${hasSeenBefore ? '<button class="pinpoint-tour-btn-skip" id="pinpoint-btn-skip">Skip Tour</button>' : ''}
        <button class="pinpoint-tour-btn-next ${hasSeenBefore ? 'enabled' : ''}" id="pinpoint-btn-next">${hasSeenBefore ? config.nextText + ' →' : config.nextText + ' (5s)'}</button>
      </div>
    `;
    document.body.appendChild(tooltip);

    const nextBtn = document.getElementById('pinpoint-btn-next');
    const skipBtn = document.getElementById('pinpoint-btn-skip');
    let timeLeft = 5;
    let timerFinished = hasSeenBefore;
    let cursorAnimFinished = false;

    function evaluateCanProceed() {
      return timerFinished && cursorAnimFinished;
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        completeTour();
      });
    }

    if (!hasSeenBefore) {
      countdownTimer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
          nextBtn.textContent = `${config.nextText} (${timeLeft}s)`;
        } else {
          clearInterval(countdownTimer);
          countdownTimer = null;
          timerFinished = true;
          if (cursorAnimFinished) {
            nextBtn.textContent = `${config.nextText} →`;
            nextBtn.classList.add('enabled');
          }
        }
      }, 1000);
    }

    function handleProceed(e) {
      if (isVirtualCursorMoving || !evaluateCanProceed()) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e) e.stopPropagation();
      if (typeof config.onNext === 'function') config.onNext();
    }

    nextBtn.addEventListener('click', handleProceed);
    highlight.style.pointerEvents = 'auto';

    updatePosition(targetEl, config, radius);

    updatePositionHandler = () => updatePosition(targetEl, config, radius);
    window.addEventListener('resize', updatePositionHandler);
    window.addEventListener('scroll', updatePositionHandler, true);

    const targetRect = targetEl.getBoundingClientRect();
    const destX = targetRect.left + (targetRect.width / 2);
    const destY = targetRect.top + (targetRect.height / 2);

    animateVirtualCursorTo(destX, destY, {
      duration: 1350,
      clickAfter: true,
      actionType: config.cursorAction || 'click'
    }, () => {
      cursorAnimFinished = true;
      if (timerFinished) {
        nextBtn.textContent = `${config.nextText} →`;
        nextBtn.classList.add('enabled');
      }
    });
  }

  function updatePosition(targetEl, config, radius) {
    if (!targetEl) return;
    const hole = document.getElementById('pinpoint-mask-hole');
    const highlight = document.getElementById('pinpoint-tour-highlight');
    const tooltip = document.getElementById('pinpoint-tour-tooltip');
    if (!hole || !highlight || !tooltip) return;

    const rect = targetEl.getBoundingClientRect();
    const x = rect.left;
    const y = rect.top;
    const w = rect.width;
    const h = rect.height;

    hole.setAttribute('x', x);
    hole.setAttribute('y', y);
    hole.setAttribute('width', w);
    hole.setAttribute('height', h);
    hole.setAttribute('rx', radius);
    hole.setAttribute('ry', radius);

    highlight.style.top = y + 'px';
    highlight.style.left = x + 'px';
    highlight.style.width = w + 'px';
    highlight.style.height = h + 'px';
    highlight.style.borderRadius = radius + 'px';

    const tWidth = 320;
    const tHeight = tooltip.offsetHeight || 160;
    const preferSide = config.placement || 'bottom';

    let top = 0;
    let left = 0;

    if (preferSide === 'right') {
      left = x + w + 16;
      top = y + (h / 2) - (tHeight / 2);
      if (left + tWidth > window.innerWidth - 16) {
        left = Math.max(16, x - tWidth - 16);
      }
    } else if (preferSide === 'top') {
      top = y - tHeight - 16;
      left = Math.max(16, Math.min(window.innerWidth - tWidth - 16, x + (w / 2) - (tWidth / 2)));
    } else {
      top = y + h + 16;
      left = Math.max(16, Math.min(window.innerWidth - tWidth - 16, x + (w / 2) - (tWidth / 2)));
      if (top + tHeight > window.innerHeight - 16) {
        top = Math.max(16, y - tHeight - 16);
      }
    }

    top = Math.max(16, Math.min(window.innerHeight - tHeight - 16, top));
    left = Math.max(16, Math.min(window.innerWidth - tWidth - 16, left));

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function cleanUpUI() {
    if (showcaseCancel) {
      showcaseCancel();
      showcaseCancel = null;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (updatePositionHandler) {
      window.removeEventListener('resize', updatePositionHandler);
      window.removeEventListener('scroll', updatePositionHandler, true);
      updatePositionHandler = null;
    }
    removeVirtualCursorEl();
    showUserCursor();
    const b = document.getElementById('pinpoint-tour-backdrop');
    const h = document.getElementById('pinpoint-tour-highlight');
    const t = document.getElementById('pinpoint-tour-tooltip');
    const s = document.getElementById('pinpoint-tour-showcase-bar');
    if (b) b.remove();
    if (h) h.remove();
    if (t) t.remove();
    if (s) s.remove();
  }

  function completeTour() {
    isWalkthroughRunning = false;
    try {
      localStorage.setItem('pinpoint_walkthrough_v3', 'true');
      localStorage.setItem('pinpoint_walkthrough_completed_ever_v3', 'true');
      sessionStorage.removeItem('pinpoint_walkthrough_active');
      sessionStorage.removeItem('pinpoint_walkthrough_step');
    } catch (e) {}
    cleanUpUI();
    showUserCursor();
    const tourStyles = document.getElementById('pinpoint-tour-styles');
    if (tourStyles) tourStyles.remove();
  }

  function runStep1Clock() {
    const startStep1 = () => {
      let attempts = 0;
      const checkEl = setInterval(() => {
        attempts++;
        const el = document.getElementById('nav-clock-display') ||
                   document.querySelector('.static-clock-display');

        if (el) {
          clearInterval(checkEl);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            createOverlay(el, {
              badge: 'Step 1 of 6 • Fullscreen Clock',
              title: 'Live Clock & Battery',
              desc: 'Click the clock anytime to open the distraction-free fullscreen clock & battery monitor. Press Esc to exit fullscreen.',
              nextText: 'Next: Library',
              placement: 'bottom',
              radius: 14,
              cursorAction: 'click',
              onNext: () => {
                try {
                  sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
                  sessionStorage.setItem('pinpoint_walkthrough_step', '2');
                } catch (e) {}
                runStep2Library();
              }
            });
          }, 150);
        } else if (attempts > 30) {
          clearInterval(checkEl);
          runStep2Library();
        }
      }, 60);
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(startStep1).catch(startStep1);
    } else {
      startStep1();
    }
  }

  function runStep2Library() {
    const startStep2 = () => {
      let attempts = 0;
      const checkEl = setInterval(() => {
        attempts++;
        const el = document.querySelector('li[data-course-id="854642477833"]') ||
                   document.querySelector('li.gHz6xd') ||
                   document.querySelector('a[href*="history.html"]');

        if (el) {
          clearInterval(checkEl);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            createOverlay(el, {
              badge: 'Step 2 of 6 • Library',
              title: 'Your Games & Textbooks',
              desc: 'World History is your portal to all interactive textbooks, games, and simulations.',
              nextText: 'Open World History',
              placement: 'bottom',
              radius: 8,
              cursorAction: 'click',
              onNext: () => {
                try {
                  sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
                  sessionStorage.setItem('pinpoint_walkthrough_step', '3');
                } catch (e) {}
                const link = el.querySelector('a[href*="history.html"]') || el.querySelector('a') || el;
                if (link && link.href) {
                  window.location.href = link.href;
                } else {
                  window.location.href = './pages/history.html';
                }
              }
            });
          }, 150);
        } else if (attempts > 30) {
          clearInterval(checkEl);
        }
      }, 60);
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(startStep2).catch(startStep2);
    } else {
      startStep2();
    }
  }

  function runStep3Classwork() {
    let attempts = 0;
    const checkEl = setInterval(() => {
      attempts++;
      const el = document.querySelector('a[href*="classwork-history.html"]') ||
                 document.querySelector('.P6qqFf a[href*="classwork"]') ||
                 document.querySelector('a.wz2Mic[href*="classwork"]');

      if (el) {
        clearInterval(checkEl);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          createOverlay(el, {
            badge: 'Step 3 of 6 • Classwork',
            title: 'Access The Library',
            desc: 'Head over to the Classwork tab to browse all 20+ games and interactive textbooks!',
            nextText: 'Go to Classwork',
            placement: 'bottom',
            radius: 4,
            cursorAction: 'click',
            onNext: () => {
              try {
                sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
                sessionStorage.setItem('pinpoint_walkthrough_step', '4');
              } catch (e) {}
              if (el.href) {
                window.location.href = el.href;
              } else {
                window.location.href = './classwork-history.html';
              }
            }
          });
        }, 150);
      } else if (attempts > 30) {
        clearInterval(checkEl);
      }
    }, 60);
  }

  function runStep4ShowcaseAndFavorites() {
    let attempts = 0;
    const checkList = setInterval(() => {
      attempts++;
      const list = document.getElementById('textbooks-ol') || document.querySelector('.GDXFIe');
      if (list || attempts > 20) {
        clearInterval(checkList);
        startClassworkShowcase();
      }
    }, 60);
  }

  function smoothScrollElement(el, targetY, duration, onFrame, callback) {
    if (!el) {
      if (callback) callback();
      return { cancel: () => {} };
    }
    const startY = el.scrollTop;
    const diff = targetY - startY;
    const startTime = performance.now();
    let animId = null;
    let isCancelled = false;

    function step(currentTime) {
      if (isCancelled) return;
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
      el.scrollTop = startY + diff * ease;
      if (typeof onFrame === 'function') onFrame();
      if (progress < 1) {
        animId = requestAnimationFrame(step);
      } else if (callback && !isCancelled) {
        callback();
      }
    }
    animId = requestAnimationFrame(step);

    return {
      cancel: () => {
        isCancelled = true;
        if (animId) cancelAnimationFrame(animId);
      }
    };
  }

  function startClassworkShowcase() {
    cleanUpUI();
    isShowcaseRunning = true;
    hideUserCursor();

    const hasSeenBefore = localStorage.getItem('pinpoint_walkthrough_completed_ever_v3') === 'true';
    const scrollMenu = document.getElementById('textbooks-ol') ||
                       document.querySelector('[aria-label="Topic Textbooks"]') ||
                       document.querySelector('.KmLLod');

    const backdrop = document.createElement('div');
    backdrop.id = 'pinpoint-tour-backdrop';
    backdrop.innerHTML = `
      <svg>
        <defs>
          <mask id="pinpoint-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect id="pinpoint-mask-hole" x="0" y="0" width="0" height="0" rx="8" ry="8" fill="black" />
          </mask>
        </defs>
        <rect class="pinpoint-bg" x="0" y="0" width="100%" height="100%" mask="url(#pinpoint-mask)" />
      </svg>
    `;
    document.body.appendChild(backdrop);

    function updateScrollHole() {
      const hole = document.getElementById('pinpoint-mask-hole');
      if (!hole || !scrollMenu) return;
      const rect = scrollMenu.getBoundingClientRect();
      hole.setAttribute('x', rect.left);
      hole.setAttribute('y', rect.top);
      hole.setAttribute('width', rect.width);
      hole.setAttribute('height', rect.height);
    }
    updateScrollHole();

    const showcaseBar = document.createElement('div');
    showcaseBar.id = 'pinpoint-tour-showcase-bar';
    showcaseBar.innerHTML = `
      <div class="pinpoint-showcase-text">📚 Showing available textbooks & games...</div>
      ${hasSeenBefore ? '<button class="pinpoint-showcase-skip" id="pinpoint-showcase-skip-btn">Skip →</button>' : ''}
    `;
    document.body.appendChild(showcaseBar);

    let isTerminated = false;
    let activeScrollHandle = null;
    let t1 = null;
    let t2 = null;
    let t3 = null;
    let t4 = null;

    function stopAndProceed() {
      if (isTerminated) return;
      isTerminated = true;
      isShowcaseRunning = false;
      if (activeScrollHandle && activeScrollHandle.cancel) activeScrollHandle.cancel();
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
      if (t4) clearTimeout(t4);
      if (scrollMenu) scrollMenu.scrollTop = 0;
      cleanUpUI();
      runStep4Favorites();
    }

    showcaseCancel = () => {
      isTerminated = true;
      isShowcaseRunning = false;
      if (activeScrollHandle && activeScrollHandle.cancel) activeScrollHandle.cancel();
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
      if (t4) clearTimeout(t4);
    };

    const skipBtn = document.getElementById('pinpoint-showcase-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stopAndProceed();
      });
    }

    t1 = setTimeout(() => {
      if (isTerminated) return;
      if (!scrollMenu) {
        stopAndProceed();
        return;
      }
      const maxScroll = Math.max(0, scrollMenu.scrollHeight - scrollMenu.clientHeight);
      activeScrollHandle = smoothScrollElement(scrollMenu, maxScroll, 850, updateScrollHole, () => {
        if (isTerminated) return;
        t2 = setTimeout(() => {
          if (isTerminated) return;
          activeScrollHandle = smoothScrollElement(scrollMenu, 0, 850, updateScrollHole, () => {
            if (isTerminated) return;
            t3 = setTimeout(() => {
              stopAndProceed();
            }, 250);
          });
        }, 450);
      });
    }, 300);
  }

  function runStep4Favorites() {
    let attempts = 0;
    const checkSidebar = setInterval(() => {
      attempts++;
      const el = document.querySelector('button[onclick*="toggleFav"]') ||
                 document.getElementById('favorites-container') ||
                 document.querySelector('a[data-id="854642477833"]') ||
                 document.querySelector('a[href*="history.html"]');

      if (el) {
        clearInterval(checkSidebar);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          createOverlay(el, {
            badge: 'Step 4 of 6 • Favorites',
            title: 'Star Your Favorites',
            desc: 'Star ⭐ any textbook or game to pin it to your quick-access favorites bar for 1-click launching!',
            nextText: 'Next: Gemini AI',
            placement: 'bottom',
            radius: 12,
            cursorAction: 'click',
            onNext: () => {
              try {
                sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
                sessionStorage.setItem('pinpoint_walkthrough_step', '5');
              } catch (e) {}
              window.location.href = './ai.html';
            }
          });
        }, 150);
      } else if (attempts > 30) {
        clearInterval(checkSidebar);
        runStep5Gemini();
      }
    }, 60);
  }

  function runStep5Gemini() {
    let attempts = 0;
    const checkAI = setInterval(() => {
      attempts++;
      const el = document.querySelector('.input-container') ||
                 document.querySelector('.chat-input-area') ||
                 document.querySelector('#chat-input');

      if (el) {
        clearInterval(checkAI);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          createOverlay(el, {
            badge: 'Step 5 of 6 • Gemini AI',
            title: 'Study with Gemini AI',
            desc: 'Your built-in AI assistant powered by Gemini! Ask questions, solve homework problems, write essays, and get explanations instantly.',
            nextText: 'Next: Music Production',
            placement: 'top',
            radius: 28,
            cursorAction: 'type',
            onNext: () => {
              try {
                sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
                sessionStorage.setItem('pinpoint_walkthrough_step', '6');
              } catch (e) {}
              window.location.href = '../music.html';
            }
          });
        }, 150);
      } else if (attempts > 30) {
        clearInterval(checkAI);
        try {
          sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
          sessionStorage.setItem('pinpoint_walkthrough_step', '6');
        } catch (e) {}
        window.location.href = '../music.html';
      }
    }, 60);
  }

  function runStep6Music() {
    const startStep6 = () => {
      let attempts = 0;
      const checkMusic = setInterval(() => {
        attempts++;
        const searchItem = document.querySelector('.music-nav-item[data-view="search"]');
        const homeItem = document.querySelector('.music-nav-item[data-view="home"]');
        const heroEl = document.querySelector('.hero-content') || document.querySelector('#greetingText');
        const trackSec = document.querySelector('.track-section');
        const mainView = document.querySelector('.main-view');

        const el = (searchItem && searchItem.offsetParent !== null) ? searchItem :
                   (homeItem && homeItem.offsetParent !== null) ? homeItem :
                   (heroEl && heroEl.offsetParent !== null) ? heroEl :
                   (trackSec && trackSec.offsetParent !== null) ? trackSec :
                   (mainView && mainView.offsetParent !== null) ? mainView : null;

        if (el) {
          clearInterval(checkMusic);
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const isSidebarItem = el.classList && el.classList.contains('music-nav-item');
          setTimeout(() => {
            createOverlay(el, {
              badge: 'Step 6 of 6 • Music Production',
              title: 'Pinpoint Audio & Music',
              desc: 'Music Production is now fully working! Stream songs across multiple sources, customize your sound with the 10-band equalizer, create custom playlists, and follow live synchronized lyrics.',
              nextText: 'Finish Tour',
              placement: isSidebarItem ? 'right' : 'bottom',
              radius: isSidebarItem ? 22 : 24,
              cursorAction: 'click',
              onNext: () => {
                completeTour();
              }
            });
          }, 150);
        } else if (attempts > 35) {
          clearInterval(checkMusic);
          completeTour();
        }
      }, 60);
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(startStep6).catch(startStep6);
    } else {
      startStep6();
    }
  }

  window.startPinpointWalkthrough = function() {
    try {
      localStorage.setItem('pinpoint_walkthrough_completed_ever_v3', 'true');
      localStorage.removeItem('pinpoint_walkthrough_v3');
      localStorage.removeItem('pinpoint_intro_seen_v2');
      localStorage.removeItem('pinpoint_tutorial_seen_v2');
      sessionStorage.setItem('pinpoint_walkthrough_active', 'true');
      sessionStorage.setItem('pinpoint_walkthrough_step', '1');
    } catch (e) {}
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/pages/')) {
      window.location.href = '../index.html';
    } else {
      window.location.href = 'index.html';
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWalkthrough);
  } else {
    initWalkthrough();
  }
})();
