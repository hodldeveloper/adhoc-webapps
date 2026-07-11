(function() {
    const boostsContent = document.getElementById('boostsContent');
    if (!boostsContent) return;

    let boostPosts = [];

    window.loadBoostsFeed = async function() {
        if (!boostsContent) return;
        showLoading('Loading boosted posts...');
        boostPosts = [];
        const relays = CONFIG.feedRelays || CONFIG.relays.slice(0, 3);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [6], '#t': ['bch'], limit: 30 }]);
            const postsMap = new Map();
            rm.onEvent = (ev) => { if (ev.kind === 6) postsMap.set(ev.id, ev); };
            await new Promise(resolve => {
                rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                setTimeout(resolve, 10000);
            });
            boostPosts = [...postsMap.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            renderBoosts();
        } catch (e) {
            boostsContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--red);">Failed to load boosted posts.</div>';
        } finally {
            hideLoading();
        }
    };

    function renderBoosts() {
        if (!boostsContent) return;
        if (!boostPosts.length) {
            boostsContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;">No boosted posts yet.</div>';
            return;
        }
        let html = '';
        for (const post of boostPosts) {
            const { text, media } = renderMediaFromContent(post.content);
            const time = new Date((post.created_at || 0) * 1000).toLocaleString();
            const authorShort = post.pubkey ? post.pubkey.substring(0, 10) + '...' : 'unknown';
            html += `
            <div class="post-card">
                <div class="post-avatar" style="width:40px;height:40px;border-radius:50%;background:#1d1f23;display:flex;align-items:center;justify-content:center;">🚀</div>
                <div class="post-body">
                    <div class="post-header">
                        <span class="post-name">${escapeHtml(authorShort)}</span>
                        <span class="post-time">· ${time}</span>
                    </div>
                    <div class="post-content">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>
                    ${media ? `<div class="post-media">${media}</div>` : ''}
                    <div class="post-actions">
                        <button class="post-action-btn analyze-btn" data-event-id="${post.id}">🔍 Analyze</button>
                    </div>
                </div>
            </div>`;
        }
        boostsContent.innerHTML = html;
        boostsContent.querySelectorAll('.analyze-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.dataset.eventId;
                if (typeof runAnalysis === 'function') runAnalysis(postId);
            });
        });
    }

    // Refresh button
    document.getElementById('refreshBoostsBtn')?.addEventListener('click', () => loadBoostsFeed());

    console.log('🚀 Boosts feed ready');
})();
