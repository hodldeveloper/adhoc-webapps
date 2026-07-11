(function() {
    let feedPosts = [], oldestTimestamp = Infinity, newestTimestamp = 0, isLoadingOlder = false;
    let commentCache = new Map(), pendingFetches = new Map(), lastConnectedRelays = [];
    const feedContent = document.getElementById('feedContent');
    if (!feedContent) return;

    const sentinel = document.createElement('div'); sentinel.id = 'feed-sentinel'; sentinel.style.height = '1px';
    feedContent.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoadingOlder && oldestTimestamp < Infinity && lastConnectedRelays.length > 0) loadOlderPosts();
    }, { root: feedContent, rootMargin: '200px', threshold: 0.1 });
    observer.observe(sentinel);

    // Add “New posts” button to the feed header
    function injectNewPostsIndicator() {
        const header = document.querySelector('.feed-header');
        if (!header) return;
        if (!document.getElementById('newPostsBadge')) {
            const badge = document.createElement('span');
            badge.id = 'newPostsBadge';
            badge.style.cssText = 'background:#1d9bf0;color:#fff;border-radius:12px;padding:2px 8px;font-size:0.75rem;margin-left:8px;cursor:pointer;display:none;';
            badge.onclick = () => { if (typeof window.loadNewPosts === 'function') window.loadNewPosts(); };
            header.appendChild(badge);
        }
    }

    window.loadFeed = async function() {
        showLoading('Loading BCH feed...');
        feedPosts = []; oldestTimestamp = Infinity; newestTimestamp = 0; lastConnectedRelays = [];
        feedContent.innerHTML = ''; feedContent.appendChild(sentinel);
        injectNewPostsIndicator();
        const relays = CONFIG.feedRelays || CONFIG.relays.slice(0, 3);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            const connected = [...rm.connections.keys()].filter(u => { const c = rm.connections.get(u); return c && c.ws && c.ws.readyState === WebSocket.OPEN; });
            lastConnectedRelays = connected;
            if (connected.length === 0) { feedContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--red);">No relays available.</div>'; return; }
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], limit: 20 }]);
            const postsMap = new Map();
            rm.onEvent = (ev) => { if (ev.kind === 1) { postsMap.set(ev.id, ev); const ts = ev.created_at||0; if (ts < oldestTimestamp) oldestTimestamp = ts; if (ts > newestTimestamp) newestTimestamp = ts; } };
            await new Promise(resolve => { rm.onEOSE = sid => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } }; setTimeout(resolve, 10000); });
            feedPosts = [...postsMap.values()].sort((a, b) => (b.created_at||0) - (a.created_at||0));
            if (feedPosts.length > 0) { oldestTimestamp = feedPosts[feedPosts.length-1].created_at; newestTimestamp = feedPosts[0].created_at; }
            renderFeed(true);
        } catch (err) { feedContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--red);">Failed to load feed.</div>'; }
        finally { hideLoading(); }
    };

    window.refreshNewPosts = async function() {
        if (newestTimestamp === 0 || lastConnectedRelays.length === 0) return;
        showLoading('Checking for new posts...');
        const rm = new RelayManager(lastConnectedRelays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], since: newestTimestamp, limit: 20 }]);
            const newPosts = [];
            rm.onEvent = (ev) => { if (ev.kind === 1 && !feedPosts.find(p => p.id === ev.id)) { newPosts.push(ev); if (ev.created_at > newestTimestamp) newestTimestamp = ev.created_at; } };
            await new Promise(resolve => { rm.onEOSE = sid => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } }; setTimeout(resolve, 8000); });
            if (newPosts.length > 0) {
                newPosts.sort((a, b) => (b.created_at||0) - (a.created_at||0));
                feedPosts = [...newPosts, ...feedPosts];
                renderFeed(false);
                if (typeof window.showNewPostsIndicator === 'function') window.showNewPostsIndicator(0);
            }
        } catch (err) { console.error(err); }
        finally { hideLoading(); }
    };

    async function loadOlderPosts() {
        if (isLoadingOlder || oldestTimestamp === Infinity || lastConnectedRelays.length === 0) return;
        isLoadingOlder = true;
        const rm = new RelayManager(lastConnectedRelays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], until: oldestTimestamp - 1, limit: 20 }]);
            const olderPosts = [];
            rm.onEvent = (ev) => { if (ev.kind === 1 && !feedPosts.find(p => p.id === ev.id)) { olderPosts.push(ev); const ts = ev.created_at||0; if (ts < oldestTimestamp) oldestTimestamp = ts; } };
            await new Promise(resolve => { rm.onEOSE = sid => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } }; setTimeout(resolve, 8000); });
            if (olderPosts.length > 0) { olderPosts.sort((a, b) => (b.created_at||0) - (a.created_at||0)); feedPosts = [...feedPosts, ...olderPosts]; renderFeed(false); }
        } catch (err) { console.error(err); }
        finally { isLoadingOlder = false; }
    }

    function renderFeed(clear = true) {
        if (!feedContent) return;
        if (clear) feedContent.innerHTML = '';
        let html = '';
        for (const post of feedPosts) html += buildPostCard(post);
        feedContent.innerHTML = html;
        feedContent.appendChild(sentinel);
        observer.observe(sentinel);
        resolveAuthorNamesInFeed();
        attachFeedListeners();
    }

    function buildPostCard(event) {
        const { text, media } = renderMediaFromContent(event.content);
        const time = new Date((event.created_at||0)*1000).toLocaleString();
        const authorShort = event.pubkey ? event.pubkey.substring(0,10)+'...' : 'unknown';
        const boostBtn = (typeof isLoggedIn === 'function' && isLoggedIn()) ? `<button class="post-action-btn boost-btn" data-event-id="${event.id}" data-pubkey="${event.pubkey}" data-kind="${event.kind}">🚀</button>` : '';
        return `
        <div class="post-card">
            <div class="post-avatar author-avatar" data-pubkey="${event.pubkey||''}" style="width:40px;height:40px;border-radius:50%;background:#1d1f23;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">👤</div>
            <div class="post-body">
                <div class="post-header">
                    <span class="post-name author-name" data-pubkey="${event.pubkey||''}" style="cursor:pointer;">${escapeHtml(authorShort)}</span>
                    <span class="post-username">@${event.pubkey?.substring(0,8)||'unknown'}</span>
                    <span class="post-time">· ${time}</span>
                </div>
                <div class="post-content ${(event.content||'').length>300?'truncated':''}">${text||'<span style="color:var(--text2);">(no text)</span>'}</div>
                ${(event.content||'').length>300?'<span class="show-more-btn">Show more</span>':''}
                ${media?`<div class="post-media">${media}</div>`:''}
                <div class="post-actions">
                    <button class="post-action-btn like-btn" data-event-id="${event.id}">❤️</button>
                    <button class="post-action-btn comment-toggle-btn" data-event-id="${event.id}">💬</button>
                    ${boostBtn}
                    <button class="post-action-btn analyze-btn" data-event-id="${event.id}">🔍</button>
                </div>
                <div class="comments-container" id="comments-${event.id}" style="display:none;"></div>
            </div>
        </div>`;
    }

    async function loadComments(postId) { /* unchanged */ }
    function renderComments(container, replies, parentPostId) { /* unchanged */ }
    async function likePost(postId, postPubkey, postKind) { /* unchanged */ }
    async function submitComment(parentPostId, content, parentPubkey, parentKind) { /* unchanged */ }
    function attachFeedListeners() { /* unchanged */ }

    function resolveAuthorNamesInFeed() {
        const elements = feedContent.querySelectorAll('.author-name:not(.resolved), .author-avatar:not(.resolved)');
        elements.forEach(el => {
            const pubkey = el.dataset.pubkey;
            if (!pubkey) return;
            if (typeof window.quickFetchProfile === 'function') {
                window.quickFetchProfile(pubkey).then(data => {
                    if (el.classList.contains('author-name')) {
                        el.textContent = data?.name || pubkey.substring(0,10)+'...';
                    } else if (el.classList.contains('author-avatar')) {
                        if (data?.picture) el.innerHTML = `<img src="${data.picture}" style="width:100%;height:100%;object-fit:cover;">`;
                    }
                    el.classList.add('resolved');
                });
            }
        });
    }

    function initFeed() { console.log('📰 BCH Feed ready'); injectNewPostsIndicator(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFeed);
    else initFeed();
})();
