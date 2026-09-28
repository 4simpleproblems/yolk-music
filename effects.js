(function() {
    const ScrollGradientEngine = {
        observedElements: new Set(),
        maskHeight: 28,

        init() {
            this.injectBaseStyles();
            this.scanAndBind();
            this.setupObservers();
        },

        injectBaseStyles() {
            const styleId = 'pinpoint-effects-styles';
            if (document.getElementById(styleId)) return;
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                .pinpoint-scrollable {
                    transition: -webkit-mask-image 0.15s ease, mask-image 0.15s ease;
                }
            `;
            if (document.head) {
                document.head.appendChild(style);
            }
        },

        updateMask(el) {
            if (!el || el === document.body || el === document.documentElement) return;
            const scrollHeight = el.scrollHeight;
            const clientHeight = el.clientHeight;
            const scrollTop = el.scrollTop;

            if (scrollHeight <= clientHeight + 4) {
                el.style.maskImage = 'none';
                el.style.webkitMaskImage = 'none';
                return;
            }

            const atTop = scrollTop <= 4;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 4;
            const h = this.maskHeight;

            let mask = '';
            if (atTop && !atBottom) {
                mask = `linear-gradient(to bottom, #000 0%, #000 calc(100% - ${h}px), transparent 100%)`;
            } else if (!atTop && atBottom) {
                mask = `linear-gradient(to bottom, transparent 0%, #000 ${h}px, #000 100%)`;
            } else if (!atTop && !atBottom) {
                mask = `linear-gradient(to bottom, transparent 0%, #000 ${h}px, #000 calc(100% - ${h}px), transparent 100%)`;
            } else {
                mask = 'none';
            }

            el.style.maskImage = mask;
            el.style.webkitMaskImage = mask;
            el.style.maskRepeat = 'no-repeat';
            el.style.webkitMaskRepeat = 'no-repeat';
            el.style.maskSize = '100% 100%';
            el.style.webkitMaskSize = '100% 100%';
        },

        bindElement(el) {
            if (!el || this.observedElements.has(el)) return;
            if (el === document.body || el === document.documentElement) return;
            this.observedElements.add(el);
            el.classList.add('pinpoint-scrollable');

            const onScroll = () => {
                requestAnimationFrame(() => this.updateMask(el));
            };

            el.addEventListener('scroll', onScroll, { passive: true });
            this.updateMask(el);
        },

        isScrollable(el) {
            if (!el || el.nodeType !== 1) return false;
            if (el === document.body || el === document.documentElement) return false;
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            const isScrollType = overflowY === 'auto' || overflowY === 'scroll';
            return isScrollType && el.scrollHeight > el.clientHeight;
        },

        scanAndBind() {
            const allElements = document.querySelectorAll('*');
            allElements.forEach(el => {
                if (this.isScrollable(el)) {
                    this.bindElement(el);
                } else if (this.observedElements.has(el)) {
                    this.updateMask(el);
                }
            });
        },

        setupObservers() {
            const mutationObserver = new MutationObserver(() => {
                this.scanAndBind();
            });

            mutationObserver.observe(document.body || document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });

            if (window.ResizeObserver) {
                const resizeObserver = new ResizeObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.target && this.observedElements.has(entry.target)) {
                            this.updateMask(entry.target);
                        } else if (entry.target && this.isScrollable(entry.target)) {
                            this.bindElement(entry.target);
                        }
                    });
                });
                resizeObserver.observe(document.body || document.documentElement);
                this.observedElements.forEach(el => resizeObserver.observe(el));
            }

            window.addEventListener('resize', () => {
                this.observedElements.forEach(el => this.updateMask(el));
            }, { passive: true });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ScrollGradientEngine.init());
    } else {
        ScrollGradientEngine.init();
    }

    window.ScrollGradientEngine = ScrollGradientEngine;
})();
