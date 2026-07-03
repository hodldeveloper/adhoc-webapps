// Footer navigation logic
(function() {
    const bottomNav = document.querySelector('.bottom-nav');
    if (!bottomNav) return;

    bottomNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-btn');
        if (!btn) return;
        const screenName = btn.dataset.screen;
        if (typeof switchScreen === 'function') {
            switchScreen(screenName);
        }
    });

    // Highlight active nav button when screen changes
    window.setActiveNav = function(screenName) {
        document.querySelectorAll('.nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.screen === screenName);
        });
    };

    console.log('📱 Bottom nav ready');
})();