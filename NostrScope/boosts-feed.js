(function() {
    let boostEvents = [];
    const boostsContent = document.getElementById('boostsContent');
    if (!boostsContent) return;

    window.loadBoostsFeed = async function() {
        if (!currentUser) {
            boostsContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;"><p>Please login to see your boosted posts.</p></div>';
            return;
        }
        showLoading('Loading boosted posts…');
        boostEvents = [];
        boostsContent.innerHTML = '';
        const relays = CONFIG.relays.slice(0, 3);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            // Fetch kind 30078 events for the current user
            const subId = rm.subscribe([{ kinds: [30078], authors: [currentUser.publicKey], limit: 50 }]);
            rm.onEvent = (ev) => { if (ev.kind === 30078) boostEvents.push(ev); };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                setTimeout(resolve, 10000);
            });
            boostEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            renderBoosts();
        } catch (e) {
            boostsContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--red);">Failed to load boosted posts.</div>';
        } finally {
            hideLoading();
        }
    };

    function renderBoosts() {
        if (!boostEvents.length) {
            boostsContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;">No boosted posts (kind 30078) found.</div>';
            return;
        }
        let html = '';
        for (const ev of boostEvents) {
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            const kindName = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
            html += `<div class="card" style="margin-bottom:12px;">
                <div class="event-header" style="display:flex; justify-content:space-between;">
                    <span class="badge badge-purple">${kindName}</span>
                    <span class="event-time">${time}</span>
                </div>
                <details style="margin-top:8px;">
                    <summary style="cursor:pointer;color:var(--accent);">Show JSON</summary>
                    <div class="json-viewer" style="max-height:150px;margin-top:4px;">${syntaxHighlight(JSON.stringify(ev, null, 2))}</div>
                </details>
            </div>`;
        }
        boostsContent.innerHTML = html;
    }

    function initBoosts() { console.log('🚀 Boosted feed ready'); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBoosts);
    else initBoosts();
})();
