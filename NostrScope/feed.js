(function() {
    // ── State ──
    let feedPosts = [];                 // newest first
    let oldestTimestamp = Infinity;     // for loading older posts
    let newestTimestamp = 0;            // for refreshing new posts
    let isLoadingOlder = false;
    let commentCache = new Map();
    let pendingFetches = new Map();
    let boostedPosts = [];
    let newestBoostTimestamp = 0;
    let pendingFeedPosts = [];
    let pendingBoostedPosts = [];
    const boostedTargetEvents = new Map();
    let boostActivityCount = 0;
    let boostActivityLabel = '';
    let boostedListenersAttached = false;
    let feedListenersAttached = false;
    let feedCheckerTimer = null;
    let boostsCheckerTimer = null;
    const FEED_MAX_POSTS = 120;
    const BOOST_MAX_POSTS = 300;
    const COMMENT_CACHE_MAX = 100;
    const FEED_CONNECT_TIMEOUT = 2200;
    const FEED_WARMUP_WAIT = 1200;
    const FEED_EOSE_TIMEOUT = 3500;
    const COMMENT_EOSE_TIMEOUT = 3000;
    const FEED_CACHE_KEY = 'nostrscope_feed_cache';
    const BOOST_CACHE_KEY = 'nostrscope_boost_cache';
    const RELAY_SPEED_KEY = 'nostrscope_relay_speed_stats';
    const feedContent = document.getElementById('feedContent');
    const boostsContent = document.getElementById('boostsContent');

    if (!feedContent) return;

    function getPreferredRelays(limit) {
        const base = Array.isArray(activeRelays) && activeRelays.length > 0
            ? activeRelays
            : CONFIG.relays;
        return rankRelaysBySpeed(base.slice(0, limit));
    }

    function getBoostLookupRelays() {
        const common = [
            'wss://relay.damus.io',
            'wss://nos.lol',
            'wss://relay.primal.net',
            'wss://relay.nostr.band',
            'wss://purplepag.es',
            'wss://relay.snort.social',
            'wss://nostr.wine',
        ];
        return rankRelaysBySpeed([
            ...new Set([
                ...(Array.isArray(activeRelays) ? activeRelays : []),
                ...(Array.isArray(CONFIG.relays) ? CONFIG.relays : []),
                ...common,
            ]),
        ]);
    }

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
    function trimFeedMemory() {
        if (feedPosts.length > FEED_MAX_POSTS) {
            feedPosts = feedPosts.slice(0, FEED_MAX_POSTS);
        }
        while (commentCache.size > COMMENT_CACHE_MAX) {
            const firstKey = commentCache.keys().next().value;
            if (!firstKey) break;
            commentCache.delete(firstKey);
        }
    }

    function renderFeedLoadingSkeleton(count = 5) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
            <div class="post-card post-skeleton">
                <div class="post-avatar skeleton-block"></div>
                <div class="post-body">
                    <div class="skeleton-line" style="width:38%;"></div>
                    <div class="skeleton-line" style="width:84%; margin-top:8px;"></div>
                    <div class="skeleton-line" style="width:71%; margin-top:8px;"></div>
                    <div class="media-item media-loading" style="margin-top:10px; height:140px; border-radius:12px;"></div>
                </div>
            </div>`;
        }
        feedContent.innerHTML = html;
        feedContent.appendChild(sentinel);
    }

    function saveFeedCache(posts) {
        try {
            const compact = (posts || []).slice(0, 40).map(p => ({
                id: p.id,
                pubkey: p.pubkey,
                kind: p.kind,
                content: p.content,
                created_at: p.created_at,
                tags: p.tags || []
            }));
            localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(compact));
        } catch (e) {}
    }

    function loadRelaySpeedStats() {
        try {
            const raw = localStorage.getItem(RELAY_SPEED_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveRelaySpeedStats(stats) {
        try {
            localStorage.setItem(RELAY_SPEED_KEY, JSON.stringify(stats));
        } catch (e) {}
    }

    function recordRelaySpeed(url, ms) {
        const stats = loadRelaySpeedStats();
        const prev = stats[url]?.avgMs;
        const avgMs = typeof prev === 'number' ? Math.round(prev * 0.7 + ms * 0.3) : Math.round(ms);
        stats[url] = { avgMs, updatedAt: Date.now() };
        saveRelaySpeedStats(stats);
    }

    function rankRelaysBySpeed(relays) {
        const stats = loadRelaySpeedStats();
        return [...relays].sort((a, b) => {
            const sa = stats[a]?.avgMs ?? 999999;
            const sb = stats[b]?.avgMs ?? 999999;
            return sa - sb;
        });
    }

    function mergeFeedPosts(incomingPosts) {
        const before = feedPosts.length;
        const map = new Map(feedPosts.map(p => [p.id, p]));
        for (const p of incomingPosts) map.set(p.id, p);
        feedPosts = [...map.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        trimFeedMemory();
        if (feedPosts.length > 0) {
            oldestTimestamp = feedPosts[feedPosts.length - 1].created_at;
            newestTimestamp = feedPosts[0].created_at;
            saveFeedCache(feedPosts);
        }
        return feedPosts.length !== before;
    }

    function mergePendingPosts(existing, incoming, existingMain) {
        const seen = new Set((existingMain || []).map(p => p.id));
        const map = new Map((existing || []).map(p => [p.id, p]));
        for (const p of incoming || []) {
            if (!p || !p.id || seen.has(p.id)) continue;
            map.set(p.id, p);
        }
        return [...map.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    function prependUniquePosts(current, incoming) {
        const map = new Map();
        const combined = [...(incoming || []), ...(current || [])];
        for (const p of combined) {
            if (!p || !p.id || map.has(p.id)) continue;
            map.set(p.id, p);
        }
        return [...map.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    function renderNewPostsBanner(kind, count) {
        if (!count || count < 1) return '';
        const noun = count === 1 ? 'post' : 'posts';
        if (kind === 'boosts') {
            return `<div class="new-posts-banner"><button class="new-posts-btn new-boost-posts-btn">${count} new boosted ${noun} · Tap to load</button></div>`;
        }
        return `<div class="new-posts-banner"><button class="new-posts-btn new-feed-posts-btn">${count} new ${noun} · Tap to load</button></div>`;
    }

    function startBoostActivity(label) {
        boostActivityCount += 1;
        boostActivityLabel = label || boostActivityLabel || 'Loading boosted posts...';
    }

    function stopBoostActivity() {
        boostActivityCount = Math.max(0, boostActivityCount - 1);
        if (boostActivityCount === 0) boostActivityLabel = '';
    }

    function renderBoostActivityBar() {
        if (boostActivityCount < 1) return '';
        const label = escapeHtml(boostActivityLabel || 'Loading boosted posts...');
        return `<div class="posts-activity-bar"><div class="posts-activity-meta"><span class="posts-activity-dot"></span>${label}</div><div class="posts-activity-track"><div class="posts-activity-fill"></div></div></div>`;
    }

    function loadFeedCache() {
        try {
            const raw = localStorage.getItem(FEED_CACHE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(p => p && p.id && p.pubkey);
        } catch (e) {
            return [];
        }
    }

    function saveBoostCache(posts) {
        try {
            const compact = (posts || []).slice(0, 50).map(p => ({
                id: p.id,
                pubkey: p.pubkey,
                kind: p.kind,
                content: p.content,
                created_at: p.created_at,
                tags: p.tags || []
            }));
            localStorage.setItem(BOOST_CACHE_KEY, JSON.stringify(compact));
        } catch (e) {}
    }

    function loadBoostCache() {
        try {
            const raw = localStorage.getItem(BOOST_CACHE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(p => p && p.id && p.pubkey && hasBchTag(p));
        } catch (e) {
            return [];
        }
    }

    function getTagValues(event, tagName) {
        return (event?.tags || [])
            .filter(t => Array.isArray(t) && t[0] === tagName && typeof t[1] === 'string')
            .map(t => t[1]);
    }

    function hasBchTag(event) {
        return getTagValues(event, 't').some(v => {
            const t = v.toLowerCase();
            return t === 'bch' || t === 'bitcoincash' || t === 'bch-boost';
        });
    }

    function toPositiveNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function getBoostMeta(event) {
        const tagEventId = getTagValues(event, 'e')[0] || '';
        const tagExpires = getTagValues(event, 'expires')[0] || '';
        const tagAmount = getTagValues(event, 'amount')[0] || '';
        let payload = null;
        try {
            payload = event?.content ? JSON.parse(event.content) : null;
        } catch (e) {}
        const payloadEventId = payload?.eventId || '';
        const payloadExpires = payload?.expiresAt || '';
        const payloadAmount = payload?.priceSats || '';
        // Canonical boosted target is content.eventId; fallback to e-tag for compatibility.
        const targetId = payloadEventId || tagEventId;
        const expiresAt = toPositiveNumber(tagExpires || payloadExpires);
        const amountSats = toPositiveNumber(tagAmount || payloadAmount);
        const isExpired = expiresAt > 0 && expiresAt < Math.floor(Date.now() / 1000);
        return { targetId, expiresAt, amountSats, isExpired };
    }

    function sortBoostedPosts(posts) {
        return [...(posts || [])].sort((a, b) => {
            const ma = getBoostMeta(a);
            const mb = getBoostMeta(b);
            const createdDiff = (b.created_at || 0) - (a.created_at || 0);
            if (createdDiff !== 0) return createdDiff;

            // For same boost time, prioritize active boosts and longer expiry.
            const activeA = ma.isExpired ? 0 : 1;
            const activeB = mb.isExpired ? 0 : 1;
            if (activeA !== activeB) return activeB - activeA;
            if (ma.expiresAt !== mb.expiresAt) return (mb.expiresAt || 0) - (ma.expiresAt || 0);

            // Higher paid sats first as final ranking signal.
            if (ma.amountSats !== mb.amountSats) return mb.amountSats - ma.amountSats;
            return 0;
        });
    }

    function prependUniqueBoosted(current, incoming) {
        const map = new Map();
        const combined = [...(incoming || []), ...(current || [])];
        for (const p of combined) {
            if (!p || !p.id || map.has(p.id)) continue;
            map.set(p.id, p);
        }
        return sortBoostedPosts([...map.values()]);
    }

    async function hydrateBoostTargetEvents(posts, relays) {
        const targetIds = [...new Set((posts || []).map(p => getBoostMeta(p).targetId).filter(Boolean))];
        const missing = targetIds.filter(id => !boostedTargetEvents.has(id));
        if (!missing.length) return false;
        const fetched = await fetchPostsFromRelays(
            relays && relays.length ? relays : getBoostLookupRelays(),
            { ids: missing, kinds: [1, 6, 16, 30023], limit: Math.min(missing.length * 2, 150) },
            2400,
        );
        let changed = false;
        for (const ev of fetched) {
            if (!ev?.id) continue;
            if (!boostedTargetEvents.has(ev.id)) changed = true;
            boostedTargetEvents.set(ev.id, ev);
        }
        return changed;
    }

    function getClientTag(event) {
        const explicitClient = getTagValues(event, 'client')[0] || '';
        if (explicitClient) return explicitClient;

        // Some boost events encode source client in d-tag namespace, e.g. bchnostr/boost/<eventId>
        const dTag = getTagValues(event, 'd')[0] || '';
        const dLower = dTag.toLowerCase();
        if (dLower.startsWith('bchnostr/')) return 'BCHNostr';

        return '';
    }

    function filterBoostedPosts(posts) {
        return (posts || []).filter(p => {
            if (!hasBchTag(p)) return false;
            if ((getClientTag(p) || '').toLowerCase() !== 'bchnostr') return false;
            const meta = getBoostMeta(p);
            return !meta.isExpired;
        });
    }

    function getDisplayablePendingBoosts() {
        return filterBoostedPosts(pendingBoostedPosts || []);
    }

    async function warmConnectRelays(rm, relays) {
        const attempts = relays.map((u) => {
            const start = Date.now();
            return rm.connect(u, FEED_CONNECT_TIMEOUT)
                .then(() => {
                    recordRelaySpeed(u, Date.now() - start);
                    return u;
                })
                .catch(() => null);
        });
        await Promise.race([
            Promise.allSettled(attempts),
            new Promise(resolve => setTimeout(resolve, FEED_WARMUP_WAIT))
        ]);
    }

    async function fetchPostsFromRelays(relays, filter, timeoutMs = FEED_EOSE_TIMEOUT) {
        if (!relays.length) return [];
        const rm = new RelayManager(relays);
        const postsMap = new Map();
        const allowedKinds = Array.isArray(filter?.kinds) ? new Set(filter.kinds) : null;
        try {
            await warmConnectRelays(rm, relays);
            if (rm.connections.size === 0) return [];
            const subId = rm.subscribe([filter]);
            rm.onEvent = (ev) => {
                if (!ev?.id) return;
                if (allowedKinds && !allowedKinds.has(ev.kind)) return;
                postsMap.set(ev.id, ev);
            };
            await new Promise((resolve) => {
                rm.onEOSE = (sid) => {
                    if (sid === subId) {
                        rm.closeSubscription(subId);
                        resolve();
                    }
                };
                setTimeout(resolve, timeoutMs);
            });
        } finally {
            rm.closeAll();
        }
        return [...postsMap.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    function mergeBoostedPosts(incomingPosts) {
        const map = new Map(boostedPosts.map(p => [p.id, p]));
        for (const p of incomingPosts) {
            if (!hasBchTag(p)) continue;
            map.set(p.id, p);
        }
        boostedPosts = sortBoostedPosts([...map.values()]);
        if (boostedPosts.length > BOOST_MAX_POSTS) boostedPosts = boostedPosts.slice(0, BOOST_MAX_POSTS);
        newestBoostTimestamp = boostedPosts[0]?.created_at || newestBoostTimestamp;
        saveBoostCache(boostedPosts);
    }

    function renderBoostedLoadingSkeleton(count = 4) {
        if (!boostsContent) return;
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
            <div class="post-card post-skeleton">
                <div class="post-avatar skeleton-block"></div>
                <div class="post-body">
                    <div class="skeleton-line" style="width:42%;"></div>
                    <div class="skeleton-line" style="width:90%; margin-top:8px;"></div>
                    <div class="skeleton-line" style="width:68%; margin-top:8px;"></div>
                </div>
            </div>`;
        }
        boostsContent.innerHTML = html;
    }

    function buildBoostedCard(event, rank = 0) {
        const meta = getBoostMeta(event);
        const target = meta.targetId ? boostedTargetEvents.get(meta.targetId) : null;
        if (!target) return '';
        const shown = target;
        const parsed = renderMediaFromContent(shown.content || '');
        const authorPubkey = shown.pubkey || event.pubkey;
        const authorShort = authorPubkey ? authorPubkey.substring(0, 10) + '...' : 'unknown';
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const expiresText = meta.expiresAt ? new Date(meta.expiresAt * 1000).toLocaleString() : 'N/A';
        const statusBadge = `<span class="badge ${meta.isExpired ? 'badge-orange' : 'badge-green'}">${meta.isExpired ? 'Expired' : 'Active'}</span>`;
        const kindTag = `<span class="badge badge-purple">kind ${shown.kind}</span>`;
        return `
        <div class="post-card">
            <div class="post-avatar" onclick="if(typeof investigateUser==='function') investigateUser('${authorPubkey}')">👤</div>
            <div class="post-body">
                <div class="boosted-rank">#${rank}</div>
                <div class="post-header">
                    <span class="post-name author-name" data-pubkey="${authorPubkey || ''}" style="cursor:pointer;" onclick="if(typeof investigateUser==='function') investigateUser('${authorPubkey}')">${escapeHtml(authorShort)}</span>
                    <span class="post-time">· ${time}</span>
                    ${kindTag}
                    ${statusBadge}
                </div>
                ${meta.targetId ? `<div style="font-size:0.72rem;color:var(--text2);margin-top:2px;">Boost target: <code>${meta.targetId.substring(0, 16)}...</code></div>` : ''}
                <div style="font-size:0.72rem;color:var(--text2);margin-top:2px;">Expires: ${expiresText}${meta.amountSats ? ` · Amount: ${meta.amountSats} sats` : ''}</div>
                <div class="post-content">${parsed.text || '<span style="color:var(--text2);">(no visible post content)</span>'}</div>
                ${parsed.media ? `<div class="post-media">${parsed.media}</div>` : ''}
                <div class="post-actions">
                    <button class="post-action-btn analyze-btn" data-event-id="${meta.targetId || shown.id || event.id}">🔍 Analyze</button>
                </div>
            </div>
        </div>`;
    }

    function buildUnresolvedBoostedCard(event, rank = 0) {
        const meta = getBoostMeta(event);
        const authorPubkey = event.pubkey || '';
        const authorShort = authorPubkey ? authorPubkey.substring(0, 10) + '...' : 'unknown';
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const expiresText = meta.expiresAt ? new Date(meta.expiresAt * 1000).toLocaleString() : 'N/A';
        const statusBadge = `<span class="badge ${meta.isExpired ? 'badge-orange' : 'badge-green'}">${meta.isExpired ? 'Expired' : 'Active'}</span>`;
        return `
        <div class="post-card">
            <div class="post-avatar" onclick="if(typeof investigateUser==='function') investigateUser('${authorPubkey}')">👤</div>
            <div class="post-body">
                <div class="boosted-rank">#${rank}</div>
                <div class="post-header">
                    <span class="post-name author-name" data-pubkey="${authorPubkey}" style="cursor:pointer;" onclick="if(typeof investigateUser==='function') investigateUser('${authorPubkey}')">${escapeHtml(authorShort)}</span>
                    <span class="post-time">· ${time}</span>
                    <span class="badge badge-purple">target syncing</span>
                    ${statusBadge}
                </div>
                <div style="font-size:0.72rem;color:var(--text2);margin-top:2px;">Boost target: <code>${escapeHtml((meta.targetId || '').substring(0, 20))}${meta.targetId ? '...' : ''}</code></div>
                <div style="font-size:0.72rem;color:var(--text2);margin-top:2px;">Expires: ${expiresText}${meta.amountSats ? ` · Amount: ${meta.amountSats} sats` : ''}</div>
                <div class="post-content"><span style="color:var(--text2);">Boost is valid. Waiting for target post content from relays.</span></div>
                <div class="post-actions">
                    <button class="post-action-btn analyze-btn" data-event-id="${meta.targetId || event.id}">🔍 Analyze target</button>
                </div>
            </div>
        </div>`;
    }

    function renderBoostedFeed() {
        if (!boostsContent) return;
        const filtered = filterBoostedPosts(boostedPosts);
        const activityHtml = renderBoostActivityBar();
        if (!filtered.length) {
            boostsContent.innerHTML = activityHtml + '<div class="card" style="margin:10px;"><p style="color:var(--text2);">No boosted posts yet.</p></div>';
            return;
        }
        const bannerHtml = renderNewPostsBanner('boosts', getDisplayablePendingBoosts().length);
        const visible = filtered;
        const body = visible.map((p, idx) => {
            const targetId = getBoostMeta(p).targetId;
            const resolved = !!(targetId && boostedTargetEvents.has(targetId));
            return resolved ? buildBoostedCard(p, idx + 1) : buildUnresolvedBoostedCard(p, idx + 1);
        }).join('');
        boostsContent.innerHTML = activityHtml + bannerHtml + body;
        resolveAuthorNamesInBoosts();
        attachBoostedListeners();
    }

    function attachBoostedListeners() {
        if (boostedListenersAttached || !boostsContent) return;
        boostedListenersAttached = true;
        boostsContent.addEventListener('click', (e) => {
            const newBoostBtn = e.target.closest('.new-boost-posts-btn');
            if (newBoostBtn) {
                const pendingDisplayable = getDisplayablePendingBoosts();
                const before = boostedPosts.length;
                boostedPosts = prependUniqueBoosted(boostedPosts, pendingDisplayable);
                if (boostedPosts.length > BOOST_MAX_POSTS) boostedPosts = boostedPosts.slice(0, BOOST_MAX_POSTS);
                newestBoostTimestamp = boostedPosts[0]?.created_at || newestBoostTimestamp;
                pendingBoostedPosts = [];
                saveBoostCache(boostedPosts);
                renderBoostedFeed();
                const added = Math.max(0, boostedPosts.length - before);
                if (typeof showToast === 'function') {
                    showToast(added > 0 ? `${added} boosted posts loaded.` : 'No new displayable boosted posts.', 'info');
                }
                startBoostActivity('Resolving boosted targets...');
                hydrateBoostTargetEvents(boostedPosts, getBoostLookupRelays()).then(() => {
                    stopBoostActivity();
                    renderBoostedFeed();
                });
                return;
            }

            const replyLink = e.target.closest('.reply-context-link');
            if (replyLink) {
                e.preventDefault();
                if (typeof runAnalysis === 'function') runAnalysis(replyLink.dataset.parentId);
                return;
            }

            const analyzeBtn = e.target.closest('.analyze-btn');
            if (analyzeBtn && typeof runAnalysis === 'function') {
                runAnalysis(analyzeBtn.dataset.eventId);
            }
        });
    }

    function resolveAuthorNamesInBoosts() {
        if (!boostsContent) return;
        const elements = boostsContent.querySelectorAll('.author-name:not(.resolved)');
        elements.forEach(el => {
            const pubkey = el.dataset.pubkey;
            if (!pubkey) return;
            if (typeof window.quickFetchProfile === 'function') {
                window.quickFetchProfile(pubkey).then(name => {
                    el.textContent = name || (pubkey.substring(0, 10) + '...');
                    el.classList.add('resolved');
                });
            }
        });
    }

    window.loadBoostedFeed = async function(forceRefresh = false) {
        if (!boostsContent) return;
        startBoostActivity(forceRefresh ? 'Refreshing boosted posts...' : 'Loading boosted posts...');
        showLoading('Loading boosted posts...');
        const cached = boostedPosts.length > 0 ? boostedPosts : loadBoostCache();
        if (cached.length > 0) {
            boostedPosts = sortBoostedPosts([...cached].filter(hasBchTag));
            newestBoostTimestamp = boostedPosts[0]?.created_at || 0;
            pendingBoostedPosts = [];
            renderBoostedFeed();
            startBoostActivity('Resolving boosted targets...');
            hydrateBoostTargetEvents(boostedPosts, getBoostLookupRelays()).then(() => {
                stopBoostActivity();
                renderBoostedFeed();
            });
            showLoading('Refreshing boosted posts...');
        } else {
            pendingBoostedPosts = [];
            renderBoostedLoadingSkeleton();
        }

        const relays = getPreferredRelays(6);
        const primaryRelays = relays.slice(0, 3);
        const secondaryRelays = relays.slice(3);

        try {
            startBoostActivity('Fetching boosted posts...');
            const primaryPosts = await fetchPostsFromRelays(
                primaryRelays,
                { kinds: [30078], limit: 80 },
                2500,
            );
            stopBoostActivity();
            if (primaryPosts.length > 0) {
                mergeBoostedPosts(primaryPosts);
                renderBoostedFeed();
            }

            startBoostActivity('Resolving boosted targets...');
            const hydratedPrimary = await hydrateBoostTargetEvents(boostedPosts, getBoostLookupRelays());
            stopBoostActivity();
            if (hydratedPrimary) renderBoostedFeed();

            hideLoading();

            if (secondaryRelays.length > 0) {
                (async () => {
                    startBoostActivity('Backfilling boosted posts...');
                    const secondaryPosts = await fetchPostsFromRelays(
                        secondaryRelays,
                        { kinds: [30078], limit: 120 },
                        FEED_EOSE_TIMEOUT,
                    );
                    if (secondaryPosts.length > 0) {
                        const before = boostedPosts.length;
                        mergeBoostedPosts(secondaryPosts);
                        startBoostActivity('Resolving boosted targets...');
                        const hydratedSecondary = await hydrateBoostTargetEvents(boostedPosts, getBoostLookupRelays());
                        stopBoostActivity();
                        if (boostedPosts.length !== before || hydratedSecondary) renderBoostedFeed();
                    }
                    stopBoostActivity();
                    renderBoostedFeed();
                })();
            }

            // Deep backfill: page older boost events to avoid missing valid boosts outside first window.
            (async () => {
                startBoostActivity('Loading older boosted posts...');
                const pageRelays = getBoostLookupRelays();
                let until = boostedPosts[boostedPosts.length - 1]?.created_at || Math.floor(Date.now() / 1000);
                for (let i = 0; i < 3; i++) {
                    const older = await fetchPostsFromRelays(
                        pageRelays,
                        { kinds: [30078], until: Math.max(0, until - 1), limit: 120 },
                        FEED_EOSE_TIMEOUT,
                    );
                    if (!older.length) break;
                    const before = boostedPosts.length;
                    mergeBoostedPosts(older);
                    startBoostActivity('Resolving boosted targets...');
                    const hydrated = await hydrateBoostTargetEvents(boostedPosts, pageRelays);
                    stopBoostActivity();
                    if (boostedPosts.length !== before || hydrated) renderBoostedFeed();
                    until = older[older.length - 1]?.created_at || until;
                    if (older.length < 120) break;
                }
                stopBoostActivity();
                renderBoostedFeed();
            })();

            if (!boostsCheckerTimer) boostsCheckerTimer = setInterval(checkForNewBoostedPosts, 30000);
        } catch (e) {
            stopBoostActivity();
            if (!boostedPosts.length) {
                boostsContent.innerHTML = '<div class="card" style="margin:10px;"><p style="color:var(--red);">Failed to load boosted posts.</p></div>';
            }
        } finally {
            stopBoostActivity();
            hideLoading();
            renderBoostedFeed();
        }
    };

    window.loadFeed = async function() {
        showLoading('Loading BCH feed...');
        if (typeof window.indicateUserActionLoading === 'function') {
            window.indicateUserActionLoading(700, 'Loading feed...');
        }
        const cachedPosts = loadFeedCache();
        feedPosts = [];
        oldestTimestamp = Infinity;
        newestTimestamp = 0;
        if (cachedPosts.length > 0) {
            feedPosts = [...cachedPosts].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            oldestTimestamp = feedPosts[feedPosts.length - 1]?.created_at || Infinity;
            newestTimestamp = feedPosts[0]?.created_at || 0;
            pendingFeedPosts = [];
            renderFeed(true);
            showLoading('Refreshing feed...');
        } else {
            pendingFeedPosts = [];
            renderFeedLoadingSkeleton();
        }

        const relays = getPreferredRelays(5);
        const primaryRelays = relays.slice(0, 3);
        const secondaryRelays = relays.slice(3);
        try {
            const primaryPosts = await fetchPostsFromRelays(
                primaryRelays,
                { kinds: [1], '#t': ['bch'], limit: 20 },
                2400
            );
            if (primaryPosts.length > 0) {
                mergeFeedPosts(primaryPosts);
                renderFeed(true);
            }

            hideLoading();

            if (secondaryRelays.length > 0) {
                (async () => {
                    const secondaryPosts = await fetchPostsFromRelays(
                        secondaryRelays,
                        { kinds: [1], '#t': ['bch'], limit: 35 },
                        FEED_EOSE_TIMEOUT
                    );
                    if (secondaryPosts.length > 0) {
                        const changed = mergeFeedPosts(secondaryPosts);
                        if (changed) renderFeed(true);
                    }
                })();
            }

            if (!feedCheckerTimer) feedCheckerTimer = setInterval(checkForNewFeedPosts, 28000);
        } catch (err) {
            if (feedPosts.length === 0) {
                feedContent.innerHTML = '<div class="card" style="padding:20px; text-align:center; color:var(--red);">Failed to load feed.</div>';
            }
        } finally {
            hideLoading();
        }
    };

    // ── Load newer posts (refresh button) ──
    window.refreshNewPosts = async function() {
        if (newestTimestamp === 0) return;
        showLoading('Checking for new posts...');
        const relays = getPreferredRelays(5);
        const rm = new RelayManager(relays);
        try {
            await warmConnectRelays(rm, relays);
            if (rm.connections.size === 0) throw new Error('No connected relays');
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
                setTimeout(resolve, FEED_EOSE_TIMEOUT);
            });
            if (newPosts.length > 0) {
                newPosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                feedPosts = [...newPosts, ...feedPosts];
                trimFeedMemory();
                saveFeedCache(feedPosts);
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
        const relays = getPreferredRelays(5);
        const rm = new RelayManager(relays);
        try {
            await warmConnectRelays(rm, relays);
            if (rm.connections.size === 0) throw new Error('No connected relays');
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
                setTimeout(resolve, FEED_EOSE_TIMEOUT);
            });
            if (olderPosts.length > 0) {
                olderPosts.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
                feedPosts = [...feedPosts, ...olderPosts];
                trimFeedMemory();
                saveFeedCache(feedPosts);
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
        let html = renderNewPostsBanner('feed', pendingFeedPosts.length);
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
        const replyTarget = (event.tags || []).find(t => t[0] === 'e' && t[1])?.[1] || '';
        return `
        <div class="post-card">
            <div class="post-avatar" onclick="if(typeof investigateUser==='function') investigateUser('${event.pubkey}')">👤</div>
            <div class="post-body">
                <div class="post-header">
                    <span class="post-name author-name" data-pubkey="${event.pubkey || ''}" style="cursor:pointer;" onclick="if(typeof investigateUser==='function') investigateUser('${event.pubkey}')">${escapeHtml(authorShort)}</span>
                    <span class="post-username">@${event.pubkey?.substring(0,8) || 'unknown'}</span>
                    <span class="post-time">· ${time}</span>
                </div>
                ${replyTarget ? `<div class="reply-context"><a href="#" class="reply-context-link" data-parent-id="${replyTarget}">Replying to ${replyTarget.substring(0, 12)}...</a></div>` : ''}
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
            const relays = getPreferredRelays(3);
            const rm = new RelayManager(relays);
            try {
                await warmConnectRelays(rm, relays);
                if (rm.connections.size === 0) return [];
                const subId = rm.subscribe([{ kinds: [1], '#e': [postId], limit: 50 }]);
                const replies = [];
                rm.onEvent = (ev) => { if (ev.kind === 1) replies.push(ev); };
                await new Promise(resolve => {
                    rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                    setTimeout(resolve, COMMENT_EOSE_TIMEOUT);
                });
                replies.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
                commentCache.set(postId, replies);
                trimFeedMemory();
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
                    <span class="event-author author-name" data-pubkey="${reply.pubkey || ''}" style="cursor:pointer;" onclick="if(typeof investigateUser==='function') investigateUser('${reply.pubkey}')">${escapeHtml(authorShort)}</span>
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
        if (feedListenersAttached) return;
        feedListenersAttached = true;

        feedContent.addEventListener('click', (e) => {
            const newFeedBtn = e.target.closest('.new-feed-posts-btn');
            if (newFeedBtn) {
                feedPosts = prependUniquePosts(feedPosts, pendingFeedPosts);
                trimFeedMemory();
                newestTimestamp = feedPosts[0]?.created_at || newestTimestamp;
                pendingFeedPosts = [];
                saveFeedCache(feedPosts);
                renderFeed(true);
                return;
            }

            const replyLink = e.target.closest('.reply-context-link');
            if (replyLink) {
                e.preventDefault();
                if (typeof runAnalysis === 'function') runAnalysis(replyLink.dataset.parentId);
                return;
            }

            const showMoreBtn = e.target.closest('.show-more-btn');
            if (showMoreBtn) {
                const content = showMoreBtn.previousElementSibling;
                if (content && content.classList.contains('post-content')) {
                    content.classList.remove('truncated');
                    showMoreBtn.remove();
                }
                return;
            }

            const commentToggleBtn = e.target.closest('.comment-toggle-btn');
            if (commentToggleBtn) {
                const postId = commentToggleBtn.dataset.eventId;
                const container = document.getElementById(`comments-${postId}`);
                if (container) {
                    const isHidden = container.style.display === 'none';
                    container.style.display = isHidden ? 'block' : 'none';
                    if (isHidden) loadComments(postId);
                }
                return;
            }

            const likeBtn = e.target.closest('.like-btn');
            if (likeBtn) {
                const postId = likeBtn.dataset.eventId;
                const post = feedPosts.find(p => p.id === postId);
                if (post) likePost(post.id, post.pubkey, post.kind);
                return;
            }

            const boostBtn = e.target.closest('.boost-btn, .boost-feed-btn');
            if (boostBtn) {
                const postId = boostBtn.dataset.eventId;
                const postPubkey = boostBtn.dataset.pubkey;
                const postKind = Number(boostBtn.dataset.kind || 1);
                const post = feedPosts.find(p => p.id === postId);
                const targetId = postId || post?.id;
                const targetPubkey = postPubkey || post?.pubkey;
                const targetKind = Number.isFinite(postKind) ? postKind : (post?.kind || 1);

                if (!targetId || !targetPubkey) {
                    if (typeof window.showToast === 'function') {
                        window.showToast('Unable to boost this post right now.', 'error');
                    }
                    return;
                }

                if (typeof window.boostEvent !== 'function') {
                    if (typeof window.showToast === 'function') {
                        window.showToast('Boost action is unavailable. Please refresh.', 'error');
                    }
                    return;
                }

                window.boostEvent(targetId, targetPubkey, targetKind);
                return;
            }

            const analyzeBtn = e.target.closest('.analyze-btn');
            if (analyzeBtn) {
                const postId = analyzeBtn.dataset.eventId;
                if (typeof runAnalysis === 'function') runAnalysis(postId);
                return;
            }

            const submitCommentBtn = e.target.closest('.submit-comment-btn');
            if (submitCommentBtn) {
                const parentId = submitCommentBtn.dataset.parentId;
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

    async function checkForNewFeedPosts() {
        if (document.hidden || newestTimestamp === 0) return;
        const relays = getPreferredRelays(3);
        try {
            const fresh = await fetchPostsFromRelays(
                relays,
                { kinds: [1], '#t': ['bch'], since: newestTimestamp, limit: 30 },
                1800
            );
            if (!fresh.length) return;
            pendingFeedPosts = mergePendingPosts(pendingFeedPosts, fresh, feedPosts);
            const topTs = fresh[0]?.created_at || 0;
            if (topTs > newestTimestamp) newestTimestamp = topTs;
            renderFeed(true);
        } catch (e) {}
    }

    async function checkForNewBoostedPosts() {
        if (document.hidden || newestBoostTimestamp === 0) return;
        const relays = getPreferredRelays(3);
        try {
            startBoostActivity('Checking for new boosted posts...');
            const fresh = await fetchPostsFromRelays(
                relays,
                { kinds: [30078], since: newestBoostTimestamp, limit: 60 },
                1800
            );
            if (!fresh.length) return;
            pendingBoostedPosts = mergePendingPosts(pendingBoostedPosts, filterBoostedPosts(fresh), boostedPosts);
            startBoostActivity('Resolving boosted targets...');
            await hydrateBoostTargetEvents(pendingBoostedPosts, getBoostLookupRelays());
            stopBoostActivity();
            const topTs = fresh[0]?.created_at || 0;
            if (topTs > newestBoostTimestamp) newestBoostTimestamp = topTs;
            renderBoostedFeed();
        } catch (e) {}
        finally {
            stopBoostActivity();
            renderBoostedFeed();
        }
    }

    // ── Init ──
    function initFeed() {
        console.log('📰 BCH Feed with lazy load ready');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFeed);
    else initFeed();
})();