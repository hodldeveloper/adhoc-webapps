(function() {
    // ── State ──
    let feedPosts = [];                 // newest first
    let oldestTimestamp = Infinity;     // for loading older posts
    let newestTimestamp = 0;            // for refreshing new posts
    let isLoadingOlder = false;
    let commentCache = new Map();
    let pendingFetches = new Map();
    const feedContent = document.getElementById('feedContent');

    if (!feedContent) return;

    // ── Infinite scroll observer ──
    const sentinel = document.createElement('div');
    sentinel.id = 'feed-sentinel';
    sentinel.style.height = '1px';
    feedContent.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoadingOlder) {
            loadOlderPosts();
        }
    }, { root: feedContent, threshold: 0.1 });

    observer.observe(sentinel);

    // ── Load initial feed ──
    window.loadFeed = async function() {
        showLoading('Loading BCH feed...');
        feedPosts = [];
        oldestTimestamp = Infinity;
        newestTimestamp = 0;
        feedContent.innerHTML = '';
        feedContent.appendChild(sentinel);

        const relays = CONFIG.relays.slice(0, 5);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], limit: 20 }]);
            const postsMap = new Map();
            rm.onEvent = (ev) => {
                if (ev.kind === 1) {
                    postsMap.set(ev.id, ev);
                    const ts = ev.created_at || 0;
                    if (ts < oldestTimestamp) oldestTimestamp = ts;
                    if (ts > newestTimestamp) newestTimestamp = ts;
                }
            };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => {
                    if (sid === subId) { rm.closeSubscription(subId); resolve(); }
                };
                setTimeout(resolve, 10000);
            });
            feedPosts = [...postsMap.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            if (feedPosts.length > 0) {
                oldestTimestamp = feedPosts[feedPosts.length - 1].created_at;
                newestTimestamp = feedPosts[0].created_at;
            }
            renderFeed(true);
        } catch (err) {
            feedContent.innerHTML = '<div class="card" style="padding:20px; text-align:center; color:var(--red);">Failed to load feed.</div>';
        } finally {
            rm.closeAll();
            hideLoading();
        }
    };

    // ── Load newer posts (refresh button) ──
    window.refreshNewPosts = async function() {
        if (newestTimestamp === 0) return;
        showLoading('Checking for new posts...');
        const relays = CONFIG.relays.slice(0, 5);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], since: newestTimestamp, limit: 20 }]);
            const newPosts = [];
            rm.onEvent = (ev) => {
                if (ev.kind === 1 && !feedPosts.find(p => p.id === ev.id)) {
                    newPosts.push(ev);
                    if (ev.created_at > newestTimestamp) newestTimestamp = ev.created_at;
                }
            };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => {
                    if (sid === subId) { rm.closeSubscription(subId); resolve(); }
                };
                setTimeout(resolve, 8000);
            });
            if (newPosts.length > 0) {
                newPosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                feedPosts = [...newPosts, ...feedPosts];
                renderFeed(false); // prepend mode
            }
        } catch (err) {
            console.error(err);
        } finally {
            rm.closeAll();
            hideLoading();
        }
    };

    // ── Load older posts (infinite scroll) ──
    async function loadOlderPosts() {
        if (isLoadingOlder || oldestTimestamp === Infinity) return;
        isLoadingOlder = true;
        const relays = CONFIG.relays.slice(0, 5);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], until: oldestTimestamp - 1, limit: 20 }]);
            const olderPosts = [];
            rm.onEvent = (ev) => {
                if (ev.kind === 1 && !feedPosts.find(p => p.id === ev.id)) {
                    olderPosts.push(ev);
                    const ts = ev.created_at || 0;
                    if (ts < oldestTimestamp) oldestTimestamp = ts;
                }
            };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => {
                    if (sid === subId) { rm.closeSubscription(subId); resolve(); }
                };
                setTimeout(resolve, 8000);
            });
            if (olderPosts.length > 0) {
                olderPosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                feedPosts = [...feedPosts, ...olderPosts];
                renderFeed(false); // append mode
            }
        } catch (err) {
            console.error(err);
        } finally {
            rm.closeAll();
            isLoadingOlder = false;
        }
    }

    // ── Render feed ──
    function renderFeed(clear = true) {
        if (!feedContent) return;
        if (clear) feedContent.innerHTML = '';
        let html = '';
        for (const post of feedPosts) {
            html += buildPostCard(post);
        }
        feedContent.innerHTML = html;
        feedContent.appendChild(sentinel); // reattach sentinel at end
        observer.observe(sentinel);
        resolveAuthorNamesInFeed();
        attachFeedListeners();
    }

    function buildPostCard(event) {
        const { text, media } = renderMediaFromContent(event.content);
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const isLong = (event.content || '').length > 300;
        const authorShort = event.pubkey ? event.pubkey.substring(0, 10) + '...' : 'unknown';
        return `
        <div class="post-card">
            <div class="post-avatar" onclick="if(typeof investigateUser==='function') investigateUser('${event.pubkey}')">👤</div>
            <div class="post-body">
                <div class="post-header">
                    <span class="post-name author-name" data-pubkey="${event.pubkey || ''}" style="cursor:pointer;" onclick="if(typeof investigateUser==='function') investigateUser('${event.pubkey}')">${escapeHtml(authorShort)}</span>
                    <span class="post-username">@${event.pubkey?.substring(0,8) || 'unknown'}</span>
                    <span class="post-time">· ${time}</span>
                </div>
                <div class="post-content ${isLong ? 'truncated' : ''}">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>
                ${isLong ? '<span class="show-more-btn">Show more</span>' : ''}
                ${media ? `<div class="post-media">${media}</div>` : ''}
                <div class="post-actions">
                    <button class="post-action-btn like-btn" data-event-id="${event.id}">❤️</button>
                    <button class="post-action-btn comment-toggle-btn" data-event-id="${event.id}">💬</button>
                    <button class="post-action-btn boost-btn" data-event-id="${event.id}" data-pubkey="${event.pubkey}" data-kind="${event.kind}">🚀</button>
                    <button class="post-action-btn analyze-btn" data-event-id="${event.id}">🔍</button>
                </div>
                <div class="comments-container" id="comments-${event.id}" style="display:none;"></div>
            </div>
        </div>`;
    }

    async function loadComments(postId) {
        const container = document.getElementById(`comments-${postId}`);
        if (!container) return;
        if (commentCache.has(postId)) {
            renderComments(container, commentCache.get(postId), postId);
            return;
        }
        container.innerHTML = '<p style="color:var(--text2);">Loading comments…</p>';
        if (pendingFetches.has(postId)) return;
        const promise = (async () => {
            const relays = CONFIG.relays.slice(0, 3);
            const rm = new RelayManager(relays);
            try {
                await rm.connectAll(4000);
                const subId = rm.subscribe([{ kinds: [1], '#e': [postId], limit: 50 }]);
                const replies = [];
                rm.onEvent = (ev) => { if (ev.kind === 1) replies.push(ev); };
                await new Promise(resolve => {
                    rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                    setTimeout(resolve, 8000);
                });
                replies.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
                commentCache.set(postId, replies);
                return replies;
            } finally {
                rm.closeAll();
            }
        })();
        pendingFetches.set(postId, promise);
        const replies = await promise;
        pendingFetches.delete(postId);
        renderComments(container, replies, postId);
    }

    function renderComments(container, replies, parentPostId) {
        if (!replies.length) {
            container.innerHTML = '<p style="color:var(--text2);">No comments yet.</p>';
            return;
        }
        let html = '';
        for (const reply of replies) {
            const { text, media } = renderMediaFromContent(reply.content);
            const time = new Date((reply.created_at || 0) * 1000).toLocaleString();
            const authorShort = reply.pubkey ? reply.pubkey.substring(0, 10) + '...' : 'unknown';
            html += `
            <div style="border-left:2px solid var(--border); padding-left:8px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-size:0.7rem;">
                    <span class="event-author author-name" data-pubkey="${reply.pubkey || ''}">${escapeHtml(authorShort)}</span>
                    <span style="color:var(--text2);">${time}</span>
                </div>
                <div style="font-size:0.8rem; margin-top:4px;">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>
                ${media ? `<div style="margin-top:4px;">${media}</div>` : ''}
            </div>`;
        }
        html += `
        <div style="margin-top:8px; display:flex; gap:6px;">
            <input type="text" class="comment-input" id="comment-input-${parentPostId}" placeholder="Write a comment…" style="flex:1; padding:6px; background:var(--surface2); border:1px solid var(--border); color:var(--text); border-radius:6px;">
            <button class="btn btn-sm btn-primary submit-comment-btn" data-parent-id="${parentPostId}">Send</button>
        </div>`;
        container.innerHTML = html;
        resolveAuthorNamesInFeed();
    }

    async function likePost(postId, postPubkey, postKind) {
        if (!currentUser) { window.showToast('Please login first.', 'info'); if (typeof window.showLoginModal === 'function') window.showLoginModal(); return; }
        const eventTemplate = { kind: 7, created_at: Math.floor(Date.now() / 1000), tags: [['e', postId], ['p', postPubkey], ['k', String(postKind || 1)]], content: '❤️' };
        try {
            const signed = await window._signNostrEvent(eventTemplate, currentUser.privateKey);
            if (relayManager) relayManager.publish(signed);
            window.showToast('❤️ Liked!', 'success');
        } catch (e) { window.showToast('Like error: ' + e.message, 'error'); }
    }

    async function submitComment(parentPostId, content, parentPubkey, parentKind) {
        if (!currentUser) { window.showToast('Please login first.', 'info'); if (typeof window.showLoginModal === 'function') window.showLoginModal(); return; }
        const eventTemplate = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [['e', parentPostId], ['p', parentPubkey], ['k', String(parentKind || 1)]], content: content.trim() };
        try {
            const signed = await window._signNostrEvent(eventTemplate, currentUser.privateKey);
            if (relayManager) relayManager.publish(signed);
            window.showToast('Comment posted!', 'success');
            const post = feedPosts.find(p => p.id === parentPostId);
            if (post) { commentCache.delete(parentPostId); loadComments(parentPostId); }
        } catch (e) { window.showToast('Comment error: ' + e.message, 'error'); }
    }

    function attachFeedListeners() {
        document.querySelectorAll('.toggle-comments-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.dataset.eventId;
                const container = document.getElementById(`comments-${postId}`);
                if (container) {
                    const isHidden = container.style.display === 'none';
                    container.style.display = isHidden ? 'block' : 'none';
                    if (isHidden) loadComments(postId);
                }
            });
        });
        document.querySelectorAll('.like-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.dataset.eventId;
                const post = feedPosts.find(p => p.id === postId);
                if (post) likePost(post.id, post.pubkey, post.kind);
            });
        });
        document.querySelectorAll('.boost-feed-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.dataset.eventId;
                const post = feedPosts.find(p => p.id === postId);
                if (post && window.boostEvent) window.boostEvent(post.id, post.pubkey, post.kind);
            });
        });
        document.querySelectorAll('.analyze-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const postId = btn.dataset.eventId;
                if (typeof runAnalysis === 'function') runAnalysis(postId);
            });
        });
        document.getElementById('feedContent').addEventListener('click', (e) => {
            if (e.target.classList.contains('submit-comment-btn')) {
                const parentId = e.target.dataset.parentId;
                const input = document.getElementById(`comment-input-${parentId}`);
                if (input && input.value.trim()) {
                    const parentPost = feedPosts.find(p => p.id === parentId);
                    if (parentPost) submitComment(parentId, input.value.trim(), parentPost.pubkey, parentPost.kind);
                }
            }
        });
    }

    function resolveAuthorNamesInFeed() {
        const elements = feedContent.querySelectorAll('.author-name:not(.resolved)');
        elements.forEach(el => {
            const pubkey = el.dataset.pubkey;
            if (!pubkey) return;
            if (typeof window.quickFetchProfile === 'function') {
                window.quickFetchProfile(pubkey).then(name => {
                    if (name) el.textContent = name;
                    else el.textContent = pubkey.substring(0, 10) + '...';
                    el.classList.add('resolved');
                });
            }
        });
    }

    // ── Init ──
    function initFeed() {
        console.log('📰 BCH Feed with lazy load ready');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFeed);
    else initFeed();
})();