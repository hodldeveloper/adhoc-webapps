(function() {
    let feedPosts = [];
    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;
    let isLoadingOlder = false;
    let commentCache = new Map();
    let pendingFetches = new Map();
    let lastConnectedRelays = [];
    let feedLastLoadedAt = 0;
    let pendingNewPosts = [];
    let feedDelegateBound = false;
    let newPostsPollTimer = null;
    let notificationPollTimer = null;
    let notificationPanelBound = false;
    let lastNotificationPubkey = null;
    const notificationState = {
        events: [],
        activeType: 'all',
        panelOpen: false,
    };
    const FEED_CACHE_TTL_MS = 45000;
    const FEED_PAGE_SIZE = 20;
    const FEED_RENDER_BATCH = 12;
    const FEED_NOTIFICATION_LIMIT = 120;
    const feedContent = document.getElementById('feedContent');
    if (!feedContent) return;

    function getViewerPubkey() {
        return currentUser?.publicKey || (typeof window._getCurrentUser === 'function' ? window._getCurrentUser()?.publicKey : null) || null;
    }

    function getNotificationSeenKey(pubkey) {
        return `nostrscope_feed_notif_seen_${pubkey}`;
    }

    function getSeenTimestamp(pubkey) {
        if (!pubkey) return Date.now();
        try {
            const raw = Number(localStorage.getItem(getNotificationSeenKey(pubkey)) || 0);
            return Number.isFinite(raw) && raw > 0 ? raw : 0;
        } catch (e) {
            return 0;
        }
    }

    function markNotificationsSeen(pubkey) {
        if (!pubkey) return;
        try {
            localStorage.setItem(getNotificationSeenKey(pubkey), String(Date.now()));
        } catch (e) {
            // ignore storage errors
        }
    }

    function classifyNotification(ev) {
        if (!ev) return null;
        if (ev.kind === 7) return 'like';
        if (ev.kind === 6) return 'repost';
        if (ev.kind === 4) return 'message';
        if (ev.kind === 1) {
            const tags = Array.isArray(ev.tags) ? ev.tags : [];
            const hasEventRef = tags.some((t) => t[0] === 'e' && t[1]);
            return hasEventRef ? 'reply' : 'mention';
        }
        return null;
    }

    function getNotificationTypeMeta(type) {
        const map = {
            all: { label: 'All', icon: '🔔' },
            like: { label: 'Likes', icon: '❤️' },
            reply: { label: 'Replies', icon: '💬' },
            mention: { label: 'Mentions', icon: '@' },
            repost: { label: 'Reposts', icon: '🔁' },
            message: { label: 'Messages', icon: '✉️' },
        };
        return map[type] || map.all;
    }

    function formatNotificationTime(unixSeconds) {
        if (!unixSeconds) return '';
        const date = new Date(unixSeconds * 1000);
        return date.toLocaleString();
    }

    function getNotificationPreview(item) {
        if (!item) return '';
        const content = (item.event?.content || '').trim();
        if (content) return content.length > 160 ? `${content.slice(0, 160)}...` : content;
        const by = item.event?.pubkey ? `${item.event.pubkey.slice(0, 12)}...` : 'Someone';
        switch (item.type) {
            case 'like': return `${by} liked your post`;
            case 'reply': return `${by} replied to your post`;
            case 'mention': return `${by} mentioned you`;
            case 'repost': return `${by} reposted your post`;
            case 'message': return `${by} sent you a message`;
            default: return `${by} interacted with you`;
        }
    }

    function ensureNotificationUi() {
        const actionsWrap = document.querySelector('#feedScreen .feed-header > div:last-child');
        if (!actionsWrap) return;

        let notifyBtn = document.getElementById('feedNotifyBtn');
        if (!notifyBtn) {
            notifyBtn = document.createElement('button');
            notifyBtn.id = 'feedNotifyBtn';
            notifyBtn.type = 'button';
            notifyBtn.className = 'btn btn-icon feed-notify-btn';
            notifyBtn.setAttribute('aria-label', 'Notifications');
            notifyBtn.innerHTML = `🔔<span id="feedNotifyCount" class="feed-notify-count" style="display:none;">0</span>`;

            const refreshBtn = document.getElementById('refreshFeedBtn');
            if (refreshBtn && refreshBtn.parentElement === actionsWrap) {
                actionsWrap.insertBefore(notifyBtn, refreshBtn);
            } else {
                actionsWrap.appendChild(notifyBtn);
            }
        }

        let panel = document.getElementById('feedNotifyPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'feedNotifyPanel';
            panel.className = 'feed-notify-panel';
            panel.style.display = 'none';
            panel.innerHTML = `
                <div class="feed-notify-panel-head">
                    <strong>Notifications</strong>
                    <button type="button" class="feed-notify-refresh" id="feedNotifyRefreshBtn">↻</button>
                </div>
                <div class="feed-notify-kinds" id="feedNotifyKinds"></div>
                <div class="feed-notify-list" id="feedNotifyList"></div>
            `;
            const header = document.querySelector('#feedScreen .feed-header');
            if (header) header.appendChild(panel);
        }

        if (notificationPanelBound) return;
        notificationPanelBound = true;

        notifyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const pubkey = getViewerPubkey();
            if (!pubkey) {
                if (typeof window.showLoginModal === 'function') window.showLoginModal();
                else if (typeof window.showToast === 'function') window.showToast('Please login first.', 'info');
                return;
            }

            notificationState.panelOpen = !notificationState.panelOpen;
            panel.style.display = notificationState.panelOpen ? 'block' : 'none';
            notifyBtn.classList.toggle('active', notificationState.panelOpen);

            if (notificationState.panelOpen) {
                markNotificationsSeen(pubkey);
                renderNotificationPanel();
                updateNotificationBadge();
                await refreshFeedNotifications({ force: true, silent: true });
            }
        });

        panel.addEventListener('click', (e) => {
            e.stopPropagation();
            const kindBtn = e.target.closest('[data-notif-kind]');
            if (kindBtn) {
                notificationState.activeType = kindBtn.dataset.notifKind || 'all';
                renderNotificationPanel();
                return;
            }

            const openBtn = e.target.closest('[data-notif-event-id]');
            if (openBtn) {
                const eventId = openBtn.dataset.notifEventId;
                if (eventId && typeof runAnalysis === 'function') runAnalysis(eventId);
                return;
            }
        });

        const refreshBtn = document.getElementById('feedNotifyRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await refreshFeedNotifications({ force: true, silent: false });
            });
        }

        document.addEventListener('click', (e) => {
            if (!notificationState.panelOpen) return;
            const target = e.target;
            if (!(target instanceof Node)) return;
            if (panel.contains(target)) return;
            if (notifyBtn.contains(target)) return;
            notificationState.panelOpen = false;
            notifyBtn.classList.remove('active');
            panel.style.display = 'none';
        });
    }

    function renderNotificationPanel() {
        const panel = document.getElementById('feedNotifyPanel');
        const kindsEl = document.getElementById('feedNotifyKinds');
        const listEl = document.getElementById('feedNotifyList');
        if (!panel || !kindsEl || !listEl) return;

        const all = notificationState.events || [];
        const counts = {
            all: all.length,
            like: all.filter((i) => i.type === 'like').length,
            reply: all.filter((i) => i.type === 'reply').length,
            mention: all.filter((i) => i.type === 'mention').length,
            repost: all.filter((i) => i.type === 'repost').length,
            message: all.filter((i) => i.type === 'message').length,
        };

        const kindOrder = ['all', 'like', 'reply', 'mention', 'repost', 'message'];
        kindsEl.innerHTML = kindOrder.map((type) => {
            const meta = getNotificationTypeMeta(type);
            const active = notificationState.activeType === type ? ' active' : '';
            return `<button type="button" class="feed-notify-kind${active}" data-notif-kind="${type}">${meta.icon} ${meta.label} <span>${counts[type] || 0}</span></button>`;
        }).join('');

        const filtered = notificationState.activeType === 'all'
            ? all
            : all.filter((item) => item.type === notificationState.activeType);

        if (!filtered.length) {
            listEl.innerHTML = '<div class="feed-notify-empty">No notifications yet.</div>';
            return;
        }

        listEl.innerHTML = filtered.slice(0, 120).map((item) => {
            const meta = getNotificationTypeMeta(item.type);
            const by = item.event?.pubkey ? `${item.event.pubkey.slice(0, 12)}...` : 'Unknown';
            const time = formatNotificationTime(item.event?.created_at || 0);
            const preview = escapeHtml(getNotificationPreview(item));
            const eventId = item.targetEventId || item.event?.id || '';

            return `
                <div class="feed-notify-item">
                    <div class="feed-notify-item-head">
                        <span class="feed-notify-type">${meta.icon} ${meta.label}</span>
                        <span class="feed-notify-time">${time}</span>
                    </div>
                    <div class="feed-notify-by">from ${escapeHtml(by)}</div>
                    <div class="feed-notify-preview">${preview || '(no content)'}</div>
                    ${eventId ? `<button type="button" class="btn btn-sm btn-outline" data-notif-event-id="${eventId}">Open</button>` : ''}
                </div>
            `;
        }).join('');
    }

    function updateNotificationBadge() {
        const badge = document.getElementById('feedNotifyCount');
        const btn = document.getElementById('feedNotifyBtn');
        const pubkey = getViewerPubkey();
        if (!badge || !btn) return;

        if (!pubkey) {
            badge.style.display = 'none';
            btn.classList.remove('has-unread');
            return;
        }

        const seenAt = getSeenTimestamp(pubkey);
        const unread = notificationState.events.filter((item) => ((item.event?.created_at || 0) * 1000) > seenAt).length;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.style.display = unread > 0 ? 'inline-flex' : 'none';
        btn.classList.toggle('has-unread', unread > 0);
    }

    async function fetchInteractionNotifications(pubkey, relays, limit = FEED_NOTIFICATION_LIMIT) {
        const rm = new RelayManager(relays);
        const map = new Map();

        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([
                { kinds: [7], '#p': [pubkey], limit: Math.min(limit, 80) },
                { kinds: [6], '#p': [pubkey], limit: Math.min(limit, 80) },
                { kinds: [4], '#p': [pubkey], limit: 60 },
                { kinds: [1], '#p': [pubkey], limit: Math.min(limit, 120) },
            ]);

            await new Promise((resolve) => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    rm.closeSubscription(subId);
                    resolve();
                };

                rm.onEvent = (ev) => {
                    if (!ev?.id || !ev?.pubkey) return;
                    if (ev.pubkey === pubkey) return;
                    const type = classifyNotification(ev);
                    if (!type) return;

                    const targetEventId = Array.isArray(ev.tags)
                        ? (ev.tags.find((t) => t[0] === 'e' && t[1])?.[1] || '')
                        : '';

                    map.set(ev.id, {
                        id: ev.id,
                        type,
                        event: ev,
                        targetEventId,
                    });
                };

                rm.onEOSE = (sid) => {
                    if (sid === subId) finish();
                };

                setTimeout(finish, 7000);
            });
        } catch (err) {
            // return best-effort events
        } finally {
            rm.closeAll();
        }

        return [...map.values()]
            .sort((a, b) => (b.event?.created_at || 0) - (a.event?.created_at || 0))
            .slice(0, limit);
    }

    async function refreshFeedNotifications(options = {}) {
        const force = Boolean(options?.force);
        const silent = options?.silent !== false;
        const pubkey = getViewerPubkey();

        if (!pubkey) {
            notificationState.events = [];
            renderNotificationPanel();
            updateNotificationBadge();
            return;
        }

        if (!force && lastNotificationPubkey === pubkey && notificationState.events.length > 0) {
            updateNotificationBadge();
            if (notificationState.panelOpen) renderNotificationPanel();
            return;
        }

        const relays = lastConnectedRelays.length ? lastConnectedRelays : getPreferredFeedRelays(4);
        const items = await fetchInteractionNotifications(pubkey, relays, FEED_NOTIFICATION_LIMIT);
        notificationState.events = items;
        lastNotificationPubkey = pubkey;
        updateNotificationBadge();
        if (notificationState.panelOpen) renderNotificationPanel();

        if (!silent && typeof window.showToast === 'function') {
            window.showToast(`Notifications updated (${items.length}).`, 'info');
        }
    }

    function getPreferredFeedRelays(max = 6) {
        const active = Array.isArray(window.activeRelays) ? window.activeRelays : [];
        const feedRelays = Array.isArray(CONFIG.feedRelays) ? CONFIG.feedRelays : [];
        const fallback = Array.isArray(CONFIG.relays) ? CONFIG.relays : [];
        const primary = CONFIG.primaryRelay || 'wss://relay.bchnostr.com';
        const avoid = new Set(['wss://relay.damus.io']);

        const merged = [...new Set([primary, ...feedRelays, ...active, ...fallback])]
            .filter((url) => {
                if (!url || avoid.has(url)) return false;
                if (typeof window.isRelayInCooldown === 'function' && window.isRelayInCooldown(url)) return false;
                return true;
            });

        const selected = merged.slice(0, Math.max(1, max));
        return selected.length ? selected : [primary];
    }

    function setLoadMoreState({ loading = false, done = false, message = '' } = {}) {
        const btn = document.getElementById('feedLoadMoreBtn');
        const status = document.getElementById('feedLoadMoreStatus');
        if (!btn || !status) return;

        if (done) {
            btn.style.display = 'none';
            status.textContent = message || 'No more posts';
            status.style.display = 'block';
            return;
        }

        btn.style.display = 'inline-flex';
        btn.disabled = loading;
        btn.textContent = loading ? 'Loading...' : 'Load more';
        status.style.display = message ? 'block' : 'none';
        status.textContent = message || '';
    }

    function showNewPostsBanner(count) {
        const banner = document.getElementById('feedNewPostsBanner');
        if (!banner) return;
        if (count <= 0) {
            banner.style.display = 'none';
            return;
        }
        banner.textContent = `${count} new post${count === 1 ? '' : 's'} - tap to refresh`;
        banner.style.display = 'block';
    }

    function startNewPostsPolling() {
        if (newPostsPollTimer) clearInterval(newPostsPollTimer);
        newPostsPollTimer = setInterval(() => {
            const feedScreen = document.getElementById('feedScreen');
            if (feedScreen && !feedScreen.classList.contains('active')) return;
            checkForNewPostsPreview();
        }, 30000);
    }

    function startNotificationPolling() {
        if (notificationPollTimer) clearInterval(notificationPollTimer);
        notificationPollTimer = setInterval(() => {
            const feedScreen = document.getElementById('feedScreen');
            if (feedScreen && !feedScreen.classList.contains('active')) return;
            refreshFeedNotifications({ force: true, silent: true });
        }, 45000);
    }

    function mergeNewPostsAtTop(newPosts) {
        if (!Array.isArray(newPosts) || newPosts.length === 0) return 0;
        const existing = new Set(feedPosts.map((p) => p.id));
        const unique = newPosts.filter((p) => p?.id && !existing.has(p.id));
        if (!unique.length) return 0;

        unique.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        feedPosts = [...unique, ...feedPosts];
        newestTimestamp = Math.max(newestTimestamp, unique[0]?.created_at || 0);
        if (feedPosts.length > 0) {
            oldestTimestamp = feedPosts[feedPosts.length - 1]?.created_at || oldestTimestamp;
        }
        feedLastLoadedAt = Date.now();
        return unique.length;
    }

    async function fetchPostsWithFilter(filter, relays, timeoutMs = 8000) {
        const rm = new RelayManager(relays);
        const map = new Map();

        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([filter]);
            await new Promise((resolve) => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    rm.closeSubscription(subId);
                    resolve();
                };

                rm.onEvent = (ev) => {
                    if (ev?.kind !== 1 || !ev?.id) return;
                    map.set(ev.id, ev);
                };

                rm.onEOSE = (sid) => {
                    if (sid === subId) finish();
                };

                setTimeout(finish, timeoutMs);
            });
        } catch (err) {
            // Ignore and return partial results.
        } finally {
            rm.closeAll();
        }

        return [...map.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    async function checkForNewPostsPreview() {
        if (newestTimestamp === 0 || lastConnectedRelays.length === 0) {
            showNewPostsBanner(0);
            return;
        }

        const relays = lastConnectedRelays.length ? lastConnectedRelays : getPreferredFeedRelays(4);
        const incoming = await fetchPostsWithFilter({ kinds: [1], '#t': ['bch'], since: newestTimestamp + 1, limit: FEED_PAGE_SIZE }, relays, 5000);
        const existing = new Set(feedPosts.map((p) => p.id));
        pendingNewPosts = incoming.filter((p) => p?.id && !existing.has(p.id));
        showNewPostsBanner(pendingNewPosts.length);
    }

    function ensureFeedScaffold() {
        feedContent.innerHTML = '';
        feedContent.insertAdjacentHTML('beforeend', `
            <button id="feedNewPostsBanner" type="button" style="display:none;width:100%;margin:0 0 10px 0;padding:10px 12px;border:1px solid var(--accent);background:rgba(100,244,214,0.12);color:var(--accent);border-radius:10px;font-size:0.82rem;font-weight:700;cursor:pointer;">
                New posts available - tap to refresh
            </button>
            <div id="feedPostsList"></div>
            <div id="feedBottomControls" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 0 20px;">
                <button id="feedLoadMoreBtn" type="button" class="btn btn-outline" style="padding:8px 14px;font-size:0.78rem;">Load more</button>
                <div id="feedLoadMoreStatus" style="display:none;color:var(--text2);font-size:0.74rem;"></div>
            </div>
        `);

        const banner = document.getElementById('feedNewPostsBanner');
        if (banner) {
            banner.addEventListener('click', async () => {
                if (pendingNewPosts.length > 0) {
                    const added = mergeNewPostsAtTop(pendingNewPosts);
                    pendingNewPosts = [];
                    showNewPostsBanner(0);
                    if (added > 0) renderFeed(true);
                    return;
                }
                await refreshNewPosts();
            });
        }

        const loadMoreBtn = document.getElementById('feedLoadMoreBtn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                loadOlderPosts();
            });
        }

        setLoadMoreState({ loading: false, done: false });
    }

    // ── Load initial feed ──
    window.loadFeed = async function(options = {}) {
        const force = Boolean(options?.force);
        const hasCache = feedPosts.length > 0;
        const cacheFresh = hasCache && (Date.now() - feedLastLoadedAt) < FEED_CACHE_TTL_MS;

        if (hasCache && !force) {
            renderFeed(true);
            startNewPostsPolling();
            startNotificationPolling();
            refreshFeedNotifications({ force: false, silent: true });
            if (cacheFresh) {
                checkForNewPostsPreview();
                return;
            }

            if (lastConnectedRelays.length > 0) {
                // Keep UI responsive: show cached content instantly and refresh incrementally.
                checkForNewPostsPreview();
                return;
            }
        }

        showLoading('Loading BCH feed...');
        feedPosts = [];
        oldestTimestamp = Infinity;
        newestTimestamp = 0;
        lastConnectedRelays = [];
        pendingNewPosts = [];
        ensureFeedScaffold();

        const relays = getPreferredFeedRelays(4);
        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(5000);
            const connected = [...rm.connections.keys()].filter(u => {
                const conn = rm.connections.get(u);
                return conn && conn.ws && conn.ws.readyState === WebSocket.OPEN;
            });
            lastConnectedRelays = connected;
            if (connected.length === 0) {
                feedContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--red);">No relays available. Please check your connection.</div>';
                return;
            }
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], limit: FEED_PAGE_SIZE }]);
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
                rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                setTimeout(resolve, 10000);
            });
            feedPosts = [...postsMap.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            if (feedPosts.length > 0) {
                oldestTimestamp = feedPosts[feedPosts.length - 1].created_at;
                newestTimestamp = feedPosts[0].created_at;
            }
            feedLastLoadedAt = Date.now();
            renderFeed(true);
            checkForNewPostsPreview();
            startNewPostsPolling();
            startNotificationPolling();
            refreshFeedNotifications({ force: true, silent: true });
        } catch (err) {
            feedContent.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--red);">Failed to load feed. Please try again.</div>';
        } finally {
            hideLoading();
            rm.closeAll();
        }
    };

    // ── Refresh new posts (called by the 🔄 button) ──
    window.refreshNewPosts = async function() {
        if (pendingNewPosts.length > 0) {
            const added = mergeNewPostsAtTop(pendingNewPosts);
            pendingNewPosts = [];
            showNewPostsBanner(0);
            if (added > 0) {
                renderFeed(true);
                if (typeof window.showToast === 'function') window.showToast(`Loaded ${added} new post${added === 1 ? '' : 's'}.`, 'success');
            }
            return;
        }

        // Cold state fallback: do a full refresh so button is never a no-op.
        if (newestTimestamp === 0 || lastConnectedRelays.length === 0) {
            if (typeof window.loadFeed === 'function') {
                await window.loadFeed({ force: true });
            }
            return;
        }

        showLoading('Checking for new posts...');
        const rm = new RelayManager(lastConnectedRelays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], since: newestTimestamp + 1, limit: FEED_PAGE_SIZE }]);
            const newPosts = [];
            rm.onEvent = (ev) => {
                if (ev.kind === 1 && !feedPosts.find(p => p.id === ev.id)) {
                    newPosts.push(ev);
                    if (ev.created_at > newestTimestamp) newestTimestamp = ev.created_at;
                }
            };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                setTimeout(resolve, 8000);
            });
            if (newPosts.length > 0) {
                newPosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                feedPosts = [...newPosts, ...feedPosts];
                feedLastLoadedAt = Date.now();
                renderFeed(true);
                if (typeof window.showToast === 'function') window.showToast(`Loaded ${newPosts.length} new post${newPosts.length === 1 ? '' : 's'}.`, 'success');
            } else {
                if (typeof window.showToast === 'function') window.showToast('No new posts.', 'info');
            }
        } catch (err) {
            console.error('Refresh error:', err);
            if (typeof window.showToast === 'function') window.showToast('Refresh failed. Please try again.', 'error');
        } finally {
            hideLoading();
            showNewPostsBanner(0);
            rm.closeAll();
        }
    };

    // ── Load older posts (infinite scroll) ──
    async function loadOlderPosts() {
        if (isLoadingOlder || oldestTimestamp === Infinity || lastConnectedRelays.length === 0) return;
        isLoadingOlder = true;
        setLoadMoreState({ loading: true, done: false });
        const rm = new RelayManager(lastConnectedRelays);
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds: [1], '#t': ['bch'], until: oldestTimestamp - 1, limit: FEED_PAGE_SIZE }]);
            const olderPosts = [];
            rm.onEvent = (ev) => {
                if (ev.kind === 1 && !feedPosts.find(p => p.id === ev.id)) {
                    olderPosts.push(ev);
                    const ts = ev.created_at || 0;
                    if (ts < oldestTimestamp) oldestTimestamp = ts;
                }
            };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                setTimeout(resolve, 8000);
            });
            if (olderPosts.length > 0) {
                olderPosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                feedPosts = [...feedPosts, ...olderPosts];
                feedLastLoadedAt = Date.now();
                renderFeed(true);
                if (olderPosts.length < FEED_PAGE_SIZE) {
                    setLoadMoreState({ done: true, message: 'No more posts' });
                } else {
                    setLoadMoreState({ loading: false, done: false });
                }
            } else {
                setLoadMoreState({ done: true, message: 'No more posts' });
            }
        } catch (err) {
            console.error('Load older posts error:', err);
            setLoadMoreState({ loading: false, done: false, message: 'Load failed. Tap again.' });
        } finally {
            isLoadingOlder = false;
            rm.closeAll();
        }
    }

    // ── Render feed ──
    function renderFeed(clear = true) {
        if (clear || !document.getElementById('feedPostsList')) ensureFeedScaffold();

        const list = document.getElementById('feedPostsList');
        if (!list) return;

        list.innerHTML = '';
        let index = 0;

        const pump = () => {
            const end = Math.min(index + FEED_RENDER_BATCH, feedPosts.length);
            let html = '';
            for (let i = index; i < end; i++) {
                html += buildPostCard(feedPosts[i]);
            }
            list.insertAdjacentHTML('beforeend', html);
            index = end;

            if (index < feedPosts.length) {
                requestAnimationFrame(pump);
                return;
            }

            resolveAuthorNamesAndAvatars();
            attachFeedListeners();
            setLoadMoreState({ loading: false, done: feedPosts.length === 0, message: feedPosts.length === 0 ? 'No posts found' : '' });
        };

        pump();
    }

    function buildPostCard(event) {
        const { text, media } = renderMediaFromContent(event.content);
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const isLong = (event.content || '').length > 300;
        const authorShort = event.pubkey ? event.pubkey.substring(0, 10) + '...' : 'unknown';
        // Use a placeholder avatar initially; resolved after render
        const avatarHtml = `<div class="post-avatar avatar-placeholder" data-pubkey="${event.pubkey || ''}" style="cursor:pointer;" onclick="if(typeof investigateUser==='function') investigateUser('${event.pubkey}')">👤</div>`;
        const boostBtn = (typeof isLoggedIn === 'function' && isLoggedIn()) 
            ? `<button class="post-action-btn boost-btn" data-event-id="${event.id}" data-pubkey="${event.pubkey}" data-kind="${event.kind}">🚀</button>`
            : '';
        return `
        <div class="post-card">
            ${avatarHtml}
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
                    ${boostBtn}
                    <button class="post-action-btn analyze-btn" data-event-id="${event.id}">🔍</button>
                </div>
                <div class="comments-container" id="comments-${event.id}" style="display:none;"></div>
            </div>
        </div>`;
    }

    // ── Resolve author names and avatars ──
    function resolveAuthorNamesAndAvatars() {
        const elements = feedContent.querySelectorAll('.author-name:not(.resolved), .avatar-placeholder:not(.resolved)');
        const groupedElements = new Map();
        const pubkeys = [];

        elements.forEach(el => {
            const pubkey = el.dataset.pubkey;
            if (!pubkey) return;

            if (!groupedElements.has(pubkey)) {
                groupedElements.set(pubkey, []);
                pubkeys.push(pubkey);
            }
            groupedElements.get(pubkey).push(el);
        });

        if (!pubkeys.length) return;

        if (typeof window.quickFetchProfilesBatch === 'function') {
            window.quickFetchProfilesBatch(pubkeys).then((profilesByPubkey) => {
                pubkeys.forEach((pubkey) => {
                    const data = profilesByPubkey.get(pubkey) || null;
                    const targets = groupedElements.get(pubkey) || [];
                    targets.forEach((el) => updateElement(el, data));
                });
            });
            return;
        }

        // Fallback path when batch helper is unavailable.
        pubkeys.forEach((pubkey) => {
            if (typeof window.quickFetchProfile !== 'function') return;
            window.quickFetchProfile(pubkey).then((data) => {
                const targets = groupedElements.get(pubkey) || [];
                targets.forEach((el) => updateElement(el, data));
            });
        });
    }

    function updateElement(el, data) {
        if (!data) return;
        if (el.classList.contains('author-name')) {
            if (data.name) el.textContent = data.name;
            else el.textContent = el.dataset.pubkey.substring(0, 10) + '...';
            el.classList.add('resolved');
        } else if (el.classList.contains('avatar-placeholder')) {
            if (data.picture) {
                const safePicture = typeof window.normalizeProfileAssetUrl === 'function'
                    ? window.normalizeProfileAssetUrl(data.picture)
                    : data.picture;
                if (safePicture) {
                    el.innerHTML = `<img src="${safePicture}" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
                    const img = el.querySelector('img');
                    if (img) {
                        img.onerror = () => {
                            el.innerHTML = '👤';
                            el.classList.add('resolved');
                        };
                    }
                } else {
                    el.innerHTML = '👤';
                }
            } else {
                el.innerHTML = '👤';
            }
            el.classList.add('resolved');
        }
    }

    // ── Comments (unchanged) ──
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
            const relays = lastConnectedRelays.length > 0 ? lastConnectedRelays : CONFIG.relays.slice(0, 3);
            const rm = new RelayManager(relays);
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
            html += `<div style="border-left:2px solid var(--border); padding-left:8px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-size:0.7rem;">
                    <span class="author-name" data-pubkey="${reply.pubkey || ''}">${escapeHtml(reply.pubkey?.substring(0,10) + '...')}</span>
                    <span style="color:var(--text2);">${time}</span>
                </div>
                <div style="font-size:0.8rem; margin-top:4px;">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>
                ${media ? `<div style="margin-top:4px;">${media}</div>` : ''}
            </div>`;
        }
        html += `<div style="margin-top:8px; display:flex; gap:6px;">
            <input type="text" class="comment-input" id="comment-input-${parentPostId}" placeholder="Write a comment…" style="flex:1; padding:6px; background:var(--surface2); border:1px solid var(--border); color:var(--text); border-radius:6px;">
            <button class="btn btn-sm btn-primary submit-comment-btn" data-parent-id="${parentPostId}">Send</button>
        </div>`;
        container.innerHTML = html;
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
        if (feedDelegateBound) return;
        feedDelegateBound = true;

        document.getElementById('feedContent').addEventListener('click', (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            const actionBtn = target.closest('.post-action-btn, .show-more-btn, .submit-comment-btn');
            if (!actionBtn) return;

            if (actionBtn.classList.contains('comment-toggle-btn')) {
                const postId = actionBtn.dataset.eventId;
                const container = document.getElementById(`comments-${postId}`);
                if (container) {
                    const isHidden = container.style.display === 'none';
                    container.style.display = isHidden ? 'block' : 'none';
                    if (isHidden) loadComments(postId);
                }
                return;
            }

            if (actionBtn.classList.contains('like-btn')) {
                const postId = actionBtn.dataset.eventId;
                const post = feedPosts.find(p => p.id === postId);
                if (post) likePost(post.id, post.pubkey, post.kind);
                return;
            }

            if (actionBtn.classList.contains('boost-btn')) {
                const postId = actionBtn.dataset.eventId;
                const post = feedPosts.find(p => p.id === postId);
                if (post && window.boostEvent) window.boostEvent(post.id, post.pubkey, post.kind);
                return;
            }

            if (actionBtn.classList.contains('analyze-btn')) {
                const postId = actionBtn.dataset.eventId;
                if (typeof runAnalysis === 'function') runAnalysis(postId);
                return;
            }

            if (actionBtn.classList.contains('submit-comment-btn')) {
                const parentId = actionBtn.dataset.parentId;
                const input = document.getElementById(`comment-input-${parentId}`);
                if (input && input.value.trim()) {
                    const parentPost = feedPosts.find(p => p.id === parentId);
                    if (parentPost) submitComment(parentId, input.value.trim(), parentPost.pubkey, parentPost.kind);
                }
            }
        });
    }

    function initFeed() {
        ensureNotificationUi();
        refreshFeedNotifications({ force: false, silent: true });
        startNotificationPolling();
        console.log('📰 BCH Feed with profile pictures ready');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFeed);
    else initFeed();
})();
