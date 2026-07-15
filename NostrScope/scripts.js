(function () {
    // ── DOM references ──
    const feedScreen = document.getElementById('feedScreen');
    const searchScreen = document.getElementById('searchScreen');
    const profileScreen = document.getElementById('profileScreen');
    const analysisScreen = document.getElementById('analysisScreen');
    const boostsScreen = document.getElementById('boostsScreen');
    const searchInput = document.getElementById('searchInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const errorMsg = document.getElementById('errorMsg');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const toastContainer = document.getElementById('toastContainer');
    const modalContainer = document.getElementById('modalContainer');
    const analysisBackBtn = document.getElementById('analysisBackBtn');
    const refreshFeedBtn = document.getElementById('refreshFeedBtn');
    const feedLoginBtn = document.getElementById('feedLoginBtn');
    const feedAccountBtn = document.getElementById('feedAccountBtn');
    const profileContent = document.getElementById('profileContent');
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    // 🌐 Make modalContainer globally accessible for account-tab.js
    window.modalContainer = modalContainer;

    // ── State ──
    let currentUser = null;
    let cachedProfile = null;               // { profile, profileEvent }
    const profileCache = new Map();          // pubkey -> { name, picture }
    const pendingFetches = new Map();
    const THEME_STORAGE_KEY = 'nostrscope_theme';

    function getPreferredTheme() {
        try {
            const stored = localStorage.getItem(THEME_STORAGE_KEY);
            if (stored === 'light' || stored === 'dark') return stored;
        } catch (e) { }
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function setTheme(theme) {
        const safeTheme = theme === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', safeTheme);
        if (themeToggleBtn) {
            const next = safeTheme === 'dark' ? 'light' : 'dark';
            themeToggleBtn.textContent = safeTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
            themeToggleBtn.title = `Switch to ${next} mode`;
            themeToggleBtn.setAttribute('aria-label', themeToggleBtn.textContent);
        }
        try {
            localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
        } catch (e) { }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        setTheme(current === 'dark' ? 'light' : 'dark');
    }

    // 🔧 Global helpers for account-tab.js
    window._cachedProfile = () => cachedProfile;
    window._setCachedProfile = (val) => { cachedProfile = val; };

    // scripts.js - update isLoggedIn
    function isLoggedIn() {
        // Check both local and global currentUser
        if (currentUser !== null) return true;
        if (typeof window._getCurrentUser === 'function') {
            const globalUser = window._getCurrentUser();
            if (globalUser !== null) {
                currentUser = globalUser; // sync
                return true;
            }
        }
        return false;
    }

    function safeToast(msg, type = 'info') {
        console.log(`[Toast ${type}] ${msg}`);
        try {
            if (typeof window.showToast === 'function') window.showToast(msg, type);
            else if (toastContainer) {
                const t = document.createElement('div');
                t.className = `toast toast-${type}`;
                t.textContent = msg;
                toastContainer.appendChild(t);
                setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
            }
        } catch (e) { alert(msg); }
    }
    window._safeToast = safeToast;

    // ── Screen switching ──
    window.switchScreen = function (screenName) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById(screenName + 'Screen');
        if (screen) screen.classList.add('active');
        if (typeof setActiveNav === 'function') setActiveNav(screenName);

        if (screenName === 'feed' && typeof loadFeed === 'function') loadFeed();
        if (screenName === 'boosts' && typeof loadBoostsFeed === 'function') loadBoostsFeed();
        if (screenName === 'profile') renderMyProfile();
    };

    // ── Extended profile cache (name + picture) ──
    window.quickFetchProfile = function (pubkey) {
        if (profileCache.has(pubkey)) return Promise.resolve(profileCache.get(pubkey));
        if (pendingFetches.has(pubkey)) return pendingFetches.get(pubkey);
        const promise = new Promise((resolve) => {
            const relays = activeRelays.slice(0, 3);
            const rm = new RelayManager(relays);
            let resolved = false;
            rm.connectAll(4000).then(() => {
                const subId = rm.subscribe([{ kinds: [0], authors: [pubkey], limit: 1 }]);
                const timeout = setTimeout(() => { if (!resolved) { resolved = true; rm.closeAll(); resolve({ name: null, picture: null }); } }, CONFIG.quickProfileTimeout);
                rm.onEvent = (ev) => {
                    if (ev.pubkey === pubkey && ev.kind === 0) {
                        clearTimeout(timeout);
                        if (!resolved) { resolved = true; rm.closeAll(); try { const p = JSON.parse(ev.content); resolve({ name: p.name || p.display_name || null, picture: p.picture || null }); } catch (e) { resolve({ name: null, picture: null }); } }
                    }
                };
                rm.onEOSE = () => { if (!resolved) { clearTimeout(timeout); resolved = true; rm.closeAll(); resolve({ name: null, picture: null }); } };
            }).catch(() => { if (!resolved) { resolved = true; resolve({ name: null, picture: null }); } });
        });
        pendingFetches.set(pubkey, promise);
        promise.then(data => { profileCache.set(pubkey, data); pendingFetches.delete(pubkey); });
        return promise;
    };

    // ── UI Updates ──
    function updateUserUI() {
        try {
            if (currentUser) {
                window._currentUser = currentUser;
                if (feedLoginBtn) feedLoginBtn.style.display = 'none';
                if (feedAccountBtn) feedAccountBtn.style.display = 'inline-block';
            } else {
                window._currentUser = null;
                if (feedLoginBtn) feedLoginBtn.style.display = 'inline-block';
                if (feedAccountBtn) feedAccountBtn.style.display = 'none';
            }
        } catch (e) { console.error('updateUserUI error:', e); }
    }

    // ── Login Persistence (improved) ──
    // scripts.js - update processNsecLogin
    window.processNsecLogin = function () {
        const nsecInput = document.getElementById('nsecInput');
        if (!nsecInput) { safeToast('Internal error.', 'error'); return; }
        const nsec = nsecInput.value.trim();
        if (!nsec) { safeToast('Please enter your nsec key.', 'error'); return; }
        let privateKey;
        try {
            const { type, data } = NostrTools.nip19.decode(nsec);
            if (type !== 'nsec') throw new Error('Not an nsec');
            privateKey = typeof data === 'string' ? data : bytesToHex(data);
        } catch (nip19Error) {
            const decoded = bech32Decode(nsec);
            if (!decoded || decoded.hrp !== 'nsec' || decoded.bytes.length !== 32) { safeToast('Invalid nsec format.', 'error'); return; }
            privateKey = bytesToHex(decoded.bytes);
        }
        if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) { safeToast('Invalid private key.', 'error'); return; }
        let publicKey;
        try { publicKey = NostrTools.getPublicKey(privateKey); }
        catch (e1) { try { publicKey = NostrTools.getPublicKey(new Uint8Array(hexToBytes(privateKey))); } catch (e2) { safeToast('Cannot derive public key.', 'error'); return; } }
        if (!publicKey || !isValidHex64(publicKey)) { safeToast('Invalid public key.', 'error'); return; }

        // Set both the local and global currentUser
        currentUser = { privateKey, publicKey };
        if (typeof window._setCurrentUser === 'function') {
            window._setCurrentUser(currentUser);
        }

        saveLogin(privateKey);
        updateUserUI();
        const cachedProfileData = localStorage.getItem('nostrscope_profile');
        if (cachedProfileData) {
            try { cachedProfile = { profile: JSON.parse(cachedProfileData), profileEvent: null }; } catch (e) { cachedProfile = null; }
        }
        safeToast('✅ Logged in as ' + npubFromHex(publicKey).substring(0, 12) + '...', 'success');
        const backdrop = document.getElementById('loginModalBackdrop');
        if (backdrop) backdrop.remove();
        renderMyProfile();
        if (feedScreen.classList.contains('active') && typeof loadFeed === 'function') setTimeout(() => loadFeed(), 300);
    };

    function showLoginModal() {
        if (typeof NostrTools === 'undefined') { safeToast('Nostr tools not loaded.', 'error'); return; }
        if (modalContainer) modalContainer.innerHTML = '';
        modalContainer.innerHTML = `
            <div class="modal-backdrop" id="loginModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10000;">
                <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:24px;max-width:360px;width:90%;color:#e7e9ea;">
                    <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('loginModalBackdrop').remove();">✕</button>
                    <h3>🔐 Login with nsec</h3>
                    <div style="color:#f4212e;font-size:0.75rem;margin-bottom:12px;">⚠️ Your private key never leaves this browser.</div>
                    <input type="password" id="nsecInput" placeholder="nsec1..." autocomplete="off" style="width:100%;padding:12px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-size:0.9rem;margin-bottom:16px;">
                    <div style="display:flex;gap:12px;">
                        <button class="btn btn-primary" style="flex:1;padding:10px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;" onclick="window.processNsecLogin();">Login</button>
                        <button class="btn btn-outline" style="flex:1;padding:10px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;" onclick="document.getElementById('loginModalBackdrop').remove();">Cancel</button>
                    </div>
                </div>
            </div>`;
        setTimeout(() => { const inp = document.getElementById('nsecInput'); if (inp) inp.focus(); }, 200);
    }

    function logout() {
        currentUser = null;
        // Clear persisted login data
        try { clearLogin(); } catch (e) { }
        updateUserUI();
        cachedProfile = null;
        try { renderMyProfile(); } catch (e) { }
        safeToast('Logged out.', 'info');
        // Refresh feed to hide boost buttons
        if (feedScreen.classList.contains('active') && typeof loadFeed === 'function') loadFeed();
    }

    // ── Profile Screen ──
    async function renderMyProfile() {
        if (!profileContent) return;
        if (!currentUser) {
            profileContent.innerHTML = `<div style="padding:20px;text-align:center;"><p style="margin-bottom:12px;color:#71767b;">You are not logged in.</p><button class="btn btn-primary" style="padding:10px 20px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;" onclick="window.showLoginModal();">🔑 Login</button></div>`;
            return;
        }
        // If account-tab.js is loaded, use its enhanced modal
        if (typeof window.showAccountModal === 'function') {
            window.showAccountModal();
            return;
        }
        // Fallback simple profile view
        if (!cachedProfile) {
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) { try { cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; } catch (e) { } }
            if (!cachedProfile) {
                profileContent.innerHTML = '<p style="padding:20px;color:var(--text2);">Loading profile…</p>';
                try {
                    const upi = new UserProfileInvestigator(new RelayManager(activeRelays));
                    await upi.investigate(currentUser.publicKey, [], { silent: true });
                    cachedProfile = { profile: upi.profile || {}, profileEvent: upi.profileEvent };
                    localStorage.setItem('nostrscope_profile', JSON.stringify(cachedProfile.profile));
                } catch (e) { }
                renderMyProfile();
                return;
            }
        }
        const profile = cachedProfile.profile || {};
        const name = profile.name || '';
        const about = profile.about || '';
        const picture = profile.picture || '';
        const npub = npubFromHex(currentUser.publicKey);
        profileContent.innerHTML = `
        <div style="padding:20px;">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
                <div style="width:60px;height:60px;border-radius:50%;background:#1d1f23;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                    ${picture ? `<img src="${picture}" style="width:100%;height:100%;object-fit:cover;">` : '👤'}
                </div>
                <div>
                    <h3 style="font-size:1.2rem;margin:0;color:#e7e9ea;">${escapeHtml(name || 'Unnamed')}</h3>
                    <p style="color:#71767b;font-size:0.8rem;margin:4px 0 0 0;">@${npub.substring(0, 12)}...</p>
                </div>
            </div>
            ${about ? `<p style="margin-bottom:16px;color:#e7e9ea;">${escapeHtml(about)}</p>` : ''}
            <div style="display:flex;gap:8px;">
                <button class="btn" id="editProfileBtn" style="padding:8px 16px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;">Edit Profile</button>
                <button class="btn" id="logoutProfileBtn" style="padding:8px 16px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;">Logout</button>
            </div>
        </div>`;
        document.getElementById('editProfileBtn')?.addEventListener('click', () => {
            if (typeof window.showAccountModal === 'function') window.showAccountModal();
        });
        document.getElementById('logoutProfileBtn')?.addEventListener('click', logout);
    }

    // ── Analysis functions (unchanged) ──
    function buildThreadCards(eventId, childrenMap, depth, visited) {
        if (visited.has(eventId) && depth > 0) return '';
        visited.add(eventId);
        const event = eventMap.get(eventId);
        if (!event && depth > 0) return '';
        if (threadCollapsed.has(eventId) && depth > 0) return `<div class="tree-collapsed" onclick="window._expandThread('${eventId}')" style="margin-left:${depth * 20}px;">[+] Show replies</div>`;
        const isOriginal = eventId === investigationHexId;
        const { text, media } = renderMediaFromContent(event.content);
        const kindName = KNOWN_KINDS[event.kind] || `Kind ${event.kind}`;
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const authorShort = event.pubkey ? event.pubkey.substring(0, 8) + '...' : 'unknown';
        const contentId = 'c-' + event.id;
        const isLong = (event.content || '').length > 250;
        const boostBtn = isLoggedIn() ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${event.id}','${event.pubkey}','${event.kind}')">🚀 Boost</button>` : '';
        let cardHtml = `<div class="tree-card" style="margin-left:${depth * 20}px;"><div class="event-preview"><div class="event-header"><span class="event-kind-badge">${isOriginal ? '★ Original' : kindName}</span><span class="event-time">${time}</span><span class="event-author author-name" data-pubkey="${event.pubkey || ''}">${escapeHtml(authorShort)}</span></div><div class="event-content" id="${contentId}" style="${isLong ? 'max-height:80px;' : ''}">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>${isLong ? `<span class="show-more-btn" onclick="document.getElementById('${contentId}').style.maxHeight='none';this.style.display='none';">Show more</span>` : ''}${media ? `<div class="media-preview">${media}</div>` : ''}<div class="thread-actions"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${event.id}')">JSON</button>${boostBtn}</div></div></div>`;
        let html = cardHtml;
        const children = childrenMap.get(eventId) || [];
        if (children.length > 0) { html += '<div class="tree-branch">'; for (const child of children) html += buildThreadCards(child.id, childrenMap, depth + 1, new Set(visited)); html += '</div>'; }
        return html;
    }

    function renderThread(inv) {
        const p = document.getElementById('panel-thread');
        const tree = inv.getThreadTree();
        if (!tree || !tree.rootEvent) { p.innerHTML = '<div class="card"><p>No thread data.</p></div>'; return; }
        let html = '<div class="card"><div class="card-header"><span class="card-title">🌳 Thread View</span><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-outline" onclick="window._expandAll()">Expand</button><button class="btn btn-sm btn-outline" onclick="window._collapseAll()">Collapse</button></div></div><div class="thread-tree-container">';
        html += buildThreadCards(tree.rootId, tree.childrenMap, 0, new Set());
        html += '</div></div>';
        p.innerHTML = html;
    }

    function renderTimeline(inv) {
        const p = document.getElementById('panel-timeline');
        const sorted = [...inv.events].sort((a, b) => sortOrder === 'newest-first' ? (b.created_at || 0) - (a.created_at || 0) : (a.created_at || 0) - (b.created_at || 0));
        if (!sorted.length) { p.innerHTML = '<div class="card"><p>No events.</p></div>'; return; }
        let html = '<div class="card"><div class="card-header"><span class="card-title">⏱ Timeline</span><button class="btn btn-sm btn-outline" onclick="window._toggleSortOrder()">Sort: ' + (sortOrder === 'oldest-first' ? 'Oldest ▲' : 'Newest ▼') + '</button></div><div class="timeline-list">';
        sorted.forEach(e => {
            const time = new Date((e.created_at || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const kind = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`;
            const isOrig = e.id === investigationHexId;
            const { text, media } = renderMediaFromContent(e.content);
            let borderClass = 'reply-post';
            if (isOrig) borderClass = 'original-post'; else if (e.kind === 6) borderClass = 'repost-post';
            const boostBtn = isLoggedIn() ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${e.id}','${e.pubkey}','${e.kind}')">🚀</button>` : '';
            html += `<div class="timeline-card ${borderClass}"><span class="timeline-time">${time}</span><span class="timeline-kind"><span class="badge ${isOrig ? 'badge-green' : 'badge-purple'}">${kind}</span>${isOrig ? ' <span class="badge badge-green">★</span>' : ''}</span><div class="timeline-content"><code style="font-size:0.6rem;color:var(--text2);">${e.id.substring(0, 10)}...</code><div>${text || ''}</div>${media ? `<div style="margin-top:4px;">${media}</div>` : ''}</div><div class="timeline-actions" style="margin-top:4px;"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">JSON</button>${boostBtn}</div></div>`;
        });
        html += '</div></div>';
        p.innerHTML = html;
    }

    function renderStats(inv) {
        const p = document.getElementById('panel-stats');
        const tree = inv.getThreadTree();
        let nested = 0;
        if (tree && tree.childrenMap) { const count = (eid, d) => { let c = 0; for (const child of (tree.childrenMap.get(eid) || [])) { if (d >= 1) c++; c += count(child.id, d + 1); } return c; }; nested = count(tree.rootId, 0); }
        const stats = [{ l: 'Original', v: originalEvent ? 1 : 0 }, { l: 'Replies', v: inv.getEventsByKind(1).filter(e => e.id !== investigationHexId && inv.getParentIds(e).includes(investigationHexId)).length }, { l: 'Nested', v: nested }, { l: 'Quotes', v: inv.events.filter(e => e.kind === 1 && e.content && e.content.includes(investigationHexId || '') && !inv.getParentIds(e).includes(investigationHexId || '')).length }, { l: 'Mentions', v: inv.events.filter(e => e.tags && e.tags.some(t => t[0] === 'e' && t[1] === investigationHexId)).length }, { l: 'Reposts', v: inv.getEventsByKind(6).length }, { l: 'Reactions', v: inv.getEventsByKind(7).length }, { l: 'Zaps', v: inv.getEventsByKind(9735).length + inv.getEventsByKind(9734).length }, { l: 'BCH Tips', v: inv.getBchPaymentEvents().length }, { l: 'Unknown', v: inv.getUnknownEvents().length }, { l: 'Authors', v: inv.getUniqueAuthors() }, { l: 'Relays', v: [...relayStats.values()].filter(s => s.status === 'connected').length }, { l: 'Success', v: [...relayStats.values()].filter(s => s.events > 0).length }, { l: 'Failed', v: [...relayStats.values()].filter(s => s.status === 'failed' || s.status === 'disconnected').length }, { l: 'Images', v: inv.getMediaCounts().images }, { l: 'Videos', v: inv.getMediaCounts().videos }, { l: 'Files', v: inv.getMediaCounts().attachments }, { l: 'Hashtags', v: inv.getHashtags() }, { l: 'Links', v: inv.getLinks() }, { l: 'Total', v: inv.events.length }];
        let h = '<div class="card"><div class="card-header"><span class="card-title">📊 Statistics</span></div><div class="stats-grid">';
        stats.forEach(s => h += `<div class="stat-card"><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`);
        h += '</div></div>';
        p.innerHTML = h;
    }

    function renderJson(inv) {
        const p = document.getElementById('panel-json');
        let h = '<div class="card"><div class="card-header"><span class="card-title">{ } Raw JSON</span><div><button class="btn btn-sm btn-outline" onclick="window._copyAllJson()">Copy All</button> <button class="btn btn-sm btn-primary" onclick="window._downloadAllJson()">Download</button></div></div>';
        if (originalEvent) {
            h += '<h4 style="margin:8px 0;color:var(--green);">★ Original Event</h4><div class="json-viewer">' + syntaxHighlight(JSON.stringify(originalEvent, null, 2)) + '</div><button class="btn btn-sm btn-outline" onclick="window._copyEventJson(\'' + originalEvent.id + '\')">Copy</button> <button class="btn btn-sm btn-outline" onclick="window._downloadEventJson(\'' + originalEvent.id + '\')">Download</button>';
        }
        h += '<h4 style="margin:16px 0 8px;">All Events (' + inv.events.length + ')</h4><input type="text" placeholder="Search JSON..." style="width:100%;padding:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;margin-bottom:8px;font-family:var(--mono);font-size:0.8rem;" oninput="window._searchJson(this.value)"><div class="json-viewer" style="max-height:50vh;">';
        for (const e of inv.events) {
            const isOrig = e.id === investigationHexId;
            h += `<div><span style="color:${isOrig ? 'var(--green)' : 'var(--accent2)'};cursor:pointer;" onclick="window._toggleJsonBlock(this)" data-eid="${e.id}">${isOrig ? '★ ' : '▸ '}${e.id.substring(0, 12)}... [Kind ${e.kind}]</span><div style="display:none;margin-left:16px;border-left:2px solid var(--border);padding-left:8px;" class="json-block-content">${syntaxHighlight(JSON.stringify(e, null, 2))}<br><button class="btn btn-sm btn-outline" onclick="window._copyEventJson('${e.id}')">Copy</button> <button class="btn btn-sm btn-outline" onclick="window._downloadEventJson('${e.id}')">Download</button></div></div>`;
        }
        h += '</div></div>';
        p.innerHTML = h;
    }

    // scripts.js - add this to fix JSON viewer
    // Make eventMap globally accessible for inspection functions
    window._getEventMap = function () { return eventMap; };
    window._getOriginalEvent = function () { return originalEvent; };
    window._getAllEvents = function () { return allEvents; };

    function renderRelays() {
        const p = document.getElementById('panel-relays');
        let h = '<div class="card"><div class="card-header"><span class="card-title">🔗 Relays</span><button class="btn btn-sm btn-outline" onclick="window._addCustomRelay()">+ Add</button></div><div style="overflow-x:auto;"><table class="relay-table"><thead><tr><th>URL</th><th>Status</th><th>RT</th><th>Events</th><th>Errors</th><th></th></tr></thead><tbody>';
        [...new Set([...activeRelays, ...relayStats.keys()])].forEach(url => {
            const s = relayStats.get(url) || { status: 'unknown', events: 0, errors: 0, responseTime: null };
            let cls = 'status-connecting', txt = s.status || 'unknown';
            if (s.status === 'connected') { cls = 'status-connected'; txt = 'Connected'; } else if (s.status === 'failed') { cls = 'status-failed'; txt = 'Failed'; } else if (s.status === 'disconnected') { cls = 'status-failed'; txt = 'Disconnected'; }
            const rt = s.responseTime ? `${s.responseTime}ms` : '—';
            h += `<tr><td style="word-break:break-all;"><code style="font-size:0.65rem;">${escapeHtml(url)}</code></td><td><span class="status-dot ${cls}"></span>${txt}</td><td>${rt}</td><td>${s.events || 0}</td><td>${s.errors || 0}</td><td><button class="btn btn-sm btn-outline" onclick="window._reconnectRelay('${escapeHtml(url)}')">↻</button></td></tr>`;
        });
        h += '</tbody></table></div></div>';
        p.innerHTML = h;
    }

    function renderBch(inv) {
        const p = document.getElementById('panel-bch');
        const evs = inv.getBchPaymentEvents();
        if (!evs.length) { p.innerHTML = '<div class="card"><p>💸 No BCH payment events found.</p></div>'; return; }
        let h = '<div class="card"><div class="card-header"><span class="card-title">💸 BCH Payments</span></div>';
        evs.forEach(e => {
            const sender = e.pubkey ? e.pubkey.substring(0, 12) + '...' : '?';
            const recipient = e.tags ? (e.tags.find(t => t[0] === 'p')?.[1]?.substring(0, 12) + '...' || '?') : '?';
            const amount = e.tags ? (e.tags.find(t => t[0] === 'amount')?.[1] || 'N/A') : 'N/A';
            const curr = e.paymentType === 'zap' ? 'BTC (Zap)' : e.paymentType === 'bch_tip' ? 'BCH' : '?';
            const txid = e.tags ? (e.tags.find(t => t[0] === 'txid' || t[0] === 'cashtoken')?.[1] || 'N/A') : 'N/A';
            h += `<div class="bch-card" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;"><div><strong>Type:</strong> <span class="badge badge-orange">${e.paymentType}</span> | ${new Date((e.created_at || 0) * 1000).toLocaleString()}</div><div>${sender} → ${recipient}</div><div>Amount: ${amount} ${curr}</div>${txid !== 'N/A' ? `<div>TXID: <code style="word-break:break-all;">${txid}</code> <a href="https://blockchair.com/bitcoin-cash/transaction/${txid}" target="_blank" style="color:var(--blue);">🔗 Explorer</a></div>` : ''}<div>Memo: ${escapeHtml((e.content || '').substring(0, 200))}</div><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">View JSON</button></div>`;
        });
        h += '</div>';
        p.innerHTML = h;
    }

    function renderProfileTab(data, pubkey) {
        const p = document.getElementById('panel-profile');
        const profile = data.profile || {};
        let html = '<div class="card"><div class="card-header"><span class="card-title">👤 User Profile</span></div>';
        html += `<p><strong>npub:</strong> <code>${npubFromHex(pubkey)}</code></p>`;
        if (profile.name) html += `<p><strong>Name:</strong> ${escapeHtml(profile.name)}</p>`;
        if (profile.about) html += `<p><strong>About:</strong> ${escapeHtml(profile.about)}</p>`;
        if (profile.picture) html += `<p><img src="${profile.picture}" alt="Profile" style="max-width:80px;border-radius:50%;"/></p>`;
        if (data.follows.length) {
            if (data.follows.length <= 5) html += `<p><strong>Follows (${data.follows.length}):</strong> ${data.follows.map(f => `<code>${f.substring(0, 8)}...</code>`).join(', ')}</p>`;
            else html += `<details style="margin-top:8px;"><summary>👥 Follows (${data.follows.length})</summary><p style="word-break:break-all;">${data.follows.map(f => `<code>${f.substring(0, 8)}...</code>`).join(', ')}</p></details>`;
        }
        if (data.relays.length) html += `<p><strong>Relays:</strong> ${data.relays.map(r => `<code>${escapeHtml(r)}</code>`).join(', ')}</p>`;
        if (data.otherEvents && data.otherEvents.length) {
            html += `<details style="margin-top:12px;"><summary>📦 Other Events (${data.otherEvents.length})</summary>`;
            data.otherEvents.forEach(ev => {
                const kindName = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
                const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
                html += `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;margin:8px 0;">`;
                if (ev.kind === 30023) {
                    try {
                        const article = JSON.parse(ev.content);
                        const title = article.title || 'Untitled';
                        const summary = article.summary || (article.content || '').substring(0, 150) + '...';
                        const image = article.image || '';
                        const linkTag = ev.tags.find(t => t[0] === 'd' && t[1]) || [];
                        const identifier = linkTag[1] || ev.id;
                        const readUrl = `https://njump.me/${npubFromHex(ev.pubkey)}/${identifier}`;
                        html += `<div><span class="badge badge-purple">${kindName}</span> <span style="font-size:0.7rem;color:var(--text2);">${time}</span></div><strong>${escapeHtml(title)}</strong>`;
                        if (image) html += `<div><img src="${image}" alt="Article image" style="max-width:100%;max-height:150px;border-radius:6px;margin:4px 0;"></div>`;
                        html += `<p style="font-size:0.8rem;margin:4px 0;">${escapeHtml(summary)}</p><a href="${readUrl}" target="_blank" style="color:var(--blue);font-size:0.75rem;">Read full article →</a>`;
                    } catch (e) { html += `<div><span class="badge badge-purple">${kindName}</span> <span style="font-size:0.7rem;color:var(--text2);">${time}</span></div><div class="event-content" style="max-height:80px;overflow-y:auto;">${escapeHtml(ev.content.substring(0, 300))}</div>`; }
                } else {
                    html += `<div><span class="badge badge-purple">${kindName}</span> <span style="font-size:0.7rem;color:var(--text2);">${time}</span></div><details><summary style="font-size:0.75rem;color:var(--accent2);">Show JSON</summary><div class="json-viewer" style="max-height:150px;margin-top:4px;">${syntaxHighlight(JSON.stringify(ev, null, 2))}</div></details>`;
                }
                html += `</div>`;
            });
            html += `</details>`;
        }
        if (!profile.name && !profile.about && !profile.picture && !data.follows.length && !data.relays.length && !data.otherEvents.length) html += '<p style="color:var(--text2);">No public profile data found.</p>';
        html += '</div>';
        p.innerHTML = html;
    }

    async function investigateUser(pubkey, hints = []) {
        const allUrls = [...new Set([...activeRelays, ...hints])];
        const rm = new RelayManager(allUrls);
        window._relayManager = rm;
        const upi = new UserProfileInvestigator(rm);
        await upi.investigate(pubkey, hints);
        scannedPubkey = pubkey;
        userProfileData = { profile: upi.profile, follows: upi.follows, relays: upi.relays, otherEvents: upi.otherEvents };
        renderProfileTab(userProfileData, pubkey);
        analysisScreen.classList.add('active');
        feedScreen.classList.remove('active');
    }

    // scripts.js - update showEventModal
    function showEventModal(ev) {
        const json = JSON.stringify(ev, null, 2);
        const kindLabel = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
        const createdAt = new Date((ev.created_at || 0) * 1000).toLocaleString();
        const shortId = ev.id ? `${ev.id.substring(0, 12)}...` : 'N/A';
        modalContainer.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)this.remove();" style="padding:0;"><div class="modal json-modal" style="margin:0;"><div class="json-modal-header"><div><h3 class="json-modal-title">Event JSON</h3><div class="json-modal-meta"><span class="json-chip">${kindLabel}</span><span class="json-chip">🕒 ${createdAt}</span><span class="json-chip">🆔 ${shortId}</span></div></div><button class="modal-close" style="background:none;border:none;color:var(--text2);font-size:1.2rem;" onclick="this.closest('.modal-backdrop').remove();">✕</button></div><div class="json-modal-body"><div class="json-viewer" style="font-size:0.72rem;max-height:none;height:100%;min-height:0;">${syntaxHighlight(json)}</div></div><div class="json-modal-actions"><button class="btn btn-sm btn-outline copy-json-btn" data-event-id="${ev.id}">Copy</button><button class="btn btn-sm btn-outline copy-json-id-btn" data-event-id="${ev.id}">Copy ID</button><button class="btn btn-sm btn-primary download-json-btn" data-event-id="${ev.id}">Download</button></div></div></div>`;
        const b = modalContainer.querySelector('.modal-backdrop');
        b.querySelector('.copy-json-btn').addEventListener('click', () => {
            const evMap = window._getEventMap ? window._getEventMap() : eventMap;
            const eventData = evMap.get(b.querySelector('.copy-json-btn').dataset.eventId);
            if (eventData) {
                navigator.clipboard.writeText(JSON.stringify(eventData, null, 2)).then(() => safeToast('Copied!'));
            }
        });
        b.querySelector('.copy-json-id-btn').addEventListener('click', () => {
            const eventId = b.querySelector('.copy-json-id-btn').dataset.eventId;
            if (eventId) {
                navigator.clipboard.writeText(eventId).then(() => safeToast('Event ID copied!'));
            }
        });
        b.querySelector('.download-json-btn').addEventListener('click', () => {
            const evMap = window._getEventMap ? window._getEventMap() : eventMap;
            const eventData = evMap.get(b.querySelector('.download-json-btn').dataset.eventId);
            if (eventData) {
                downloadFile(JSON.stringify(eventData, null, 2), `nostr-event-${eventData.id.substring(0, 12)}.json`);
            }
        });
    }

    function exportJSON(type) {
        let data, filename;
        if (type === 'original' && originalEvent) { data = JSON.stringify(originalEvent, null, 2); filename = `nostrscope-original-${investigationHexId?.substring(0, 12) || 'event'}.json`; }
        else { data = JSON.stringify({ investigationHexId, originalEvent, allEvents, relayStats: [...relayStats.entries()].map(([u, s]) => ({ url: u, ...s })), exportedAt: new Date().toISOString(), totalEvents: allEvents.length }, null, 2); filename = `nostrscope-investigation-${investigationHexId?.substring(0, 12) || 'all'}.json`; }
        downloadFile(data, filename, 'application/json');
        safeToast('Exported!');
    }

    // ── Global helpers ──
    window._expandThread = (eventId) => { threadCollapsed.delete(eventId); if (investigator) renderThread(investigator); };
    window._expandAll = () => { threadCollapsed.clear(); if (investigator) renderThread(investigator); };
    window._collapseAll = () => { if (investigator) { investigator.eventMap.forEach((_, k) => { if (k !== investigationHexId) threadCollapsed.add(k); }); renderThread(investigator); } };
    window._toggleSortOrder = () => { sortOrder = sortOrder === 'oldest-first' ? 'newest-first' : 'oldest-first'; if (investigator) renderTimeline(investigator); };
    window._inspectEvent = eid => { if (eventMap.has(eid)) showEventModal(eventMap.get(eid)); };
    window._copyEventJson = eid => { if (eventMap.has(eid)) navigator.clipboard.writeText(JSON.stringify(eventMap.get(eid), null, 2)).then(() => safeToast('Copied!')); };
    window._downloadEventJson = eid => { if (eventMap.has(eid)) downloadFile(JSON.stringify(eventMap.get(eid), null, 2), `nostr-event-${eid.substring(0, 12)}.json`); };
    window._copyAllJson = () => { if (allEvents.length) navigator.clipboard.writeText(JSON.stringify(allEvents, null, 2)).then(() => safeToast('Copied!')); };
    window._downloadAllJson = () => exportJSON('all');
    window._toggleJsonBlock = el => { const b = el.nextElementSibling; if (b?.classList.contains('json-block-content')) { const hidden = b.style.display === 'none'; b.style.display = hidden ? 'block' : 'none'; el.textContent = el.textContent.replace(hidden ? '▸' : '▾', hidden ? '▾' : '▸'); } };
    window._searchJson = q => { const c = document.getElementById('jsonAll'); if (!c) return; c.querySelectorAll('.json-block-content').forEach(b => { if (!q) { b.style.display = 'none'; b.previousElementSibling && (b.previousElementSibling.textContent = b.previousElementSibling.textContent.replace('▾', '▸')); } else if (b.textContent.toLowerCase().includes(q.toLowerCase())) { b.style.display = 'block'; b.previousElementSibling && (b.previousElementSibling.textContent = b.previousElementSibling.textContent.replace('▸', '▾')); } }); };
    window._reconnectRelay = async u => { safeToast(`Reconnecting ${u}...`); if (relayManager) { await relayManager.reconnect(u); renderRelays(); safeToast('Reconnected'); } };
    window._removeRelay = u => { activeRelays = activeRelays.filter(r => r !== u); if (relayManager) relayManager.relayUrls = activeRelays; renderRelays(); safeToast('Relay removed'); };
    window._addCustomRelay = () => { const url = prompt('Enter relay WebSocket URL:'); if (url && url.startsWith('ws') && !activeRelays.includes(url)) { activeRelays.push(url); if (relayManager) relayManager.relayUrls = activeRelays; renderRelays(); safeToast('Relay added'); } else if (url && activeRelays.includes(url)) safeToast('Already in list'); else if (url) safeToast('Invalid URL'); };
    window._exportJSON = exportJSON;
    window._exportCSV = () => { let csv = 'Event ID,Kind,Kind Name,Author,Created At,Content Preview,Is Original\n'; allEvents.forEach(e => { const kindName = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`; csv += `"${e.id}",${e.kind},"${kindName}","${e.pubkey || ''}","${new Date((e.created_at || 0) * 1000).toISOString()}","${(e.content || '').replace(/"/g, '""').substring(0, 200)}","${e.id === investigationHexId ? 'Yes' : 'No'}"\n`; }); downloadFile(csv, `nostrscope-summary-${investigationHexId?.substring(0, 12) || 'events'}.csv`, 'text/csv'); };
    window._exportMarkdown = () => { let md = `# NostrScope Investigation Report\n\n**Event ID:** \`${investigationHexId || 'N/A'}\`\n**Generated:** ${new Date().toISOString()}\n**Total Events:** ${allEvents.length}\n\n## Statistics\n\n| Metric | Value |\n|---|---|\n| Original Event | ${originalEvent ? 1 : 0} |\n| Total Events | ${allEvents.length} |\n| Unique Authors | ${new Set(allEvents.map(e => e.pubkey)).size} |\n| Replies (Kind 1) | ${allEvents.filter(e => e.kind === 1).length} |\n| Reactions (Kind 7) | ${allEvents.filter(e => e.kind === 7).length} |\n| Reposts (Kind 6) | ${allEvents.filter(e => e.kind === 6).length} |\n| Zaps | ${allEvents.filter(e => e.kind === 9735 || e.kind === 9734).length} |\n\n## Timeline\n\n`;[...allEvents].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).forEach(e => { md += `- **${new Date((e.created_at || 0) * 1000).toLocaleString()}** [${KNOWN_KINDS[e.kind] || `Kind ${e.kind}`}] \`${e.id.substring(0, 12)}...\` - ${(e.content || '').substring(0, 80).replace(/\n/g, ' ')}\n`; }); downloadFile(md, `nostrscope-report-${investigationHexId?.substring(0, 12) || 'events'}.md`, 'text/markdown'); };
    window._exportHTML = () => { let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NostrScope Report</title><style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:20px;max-width:900px;margin:0 auto;}h1{color:#a78bfa;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #30363d;padding:8px;}</style></head><body><h1>🔍 NostrScope Report</h1><p><strong>Event ID:</strong> <code>${investigationHexId || 'N/A'}</code></p><p><strong>Total Events:</strong> ${allEvents.length}</p><table><thead><tr><th>Time</th><th>Kind</th><th>ID</th><th>Content</th></tr></thead><tbody>`;[...allEvents].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).forEach(e => { h += `<tr><td>${new Date((e.created_at || 0) * 1000).toLocaleString()}</td><td>${KNOWN_KINDS[e.kind] || `Kind ${e.kind}`}</td><td><code>${e.id.substring(0, 14)}...</code></td><td>${escapeHtml((e.content || '').substring(0, 120))}</td></tr>`; }); h += '</tbody></table></body></html>'; downloadFile(h, `nostrscope-report-${investigationHexId?.substring(0, 12) || 'events'}.html`, 'text/html'); };
    window.injectBoostedEvent = function (event) { if (!investigator || !investigator.eventMap) return; if (!eventMap.has(event.id)) { eventMap.set(event.id, event); allEvents.push(event); investigator.eventMap.set(event.id, event); investigator.events.push(event); } if (investigator) { renderThread(investigator); renderTimeline(investigator); renderStats(investigator); renderJson(investigator); } };
    window.runAnalysis = runAnalysis;

    // scripts.js - add this function
    window.showEventJson = function (ev) {
        // Add event to eventMap if it doesn't exist
        if (!eventMap.has(ev.id)) {
            eventMap.set(ev.id, ev);
            if (!allEvents.find(e => e.id === ev.id)) {
                allEvents.push(ev);
            }
        }
        // Use the existing inspect function
        showEventModal(ev);
    };

    // ── Main analysis flow ──
    async function runAnalysis(inputValue) {
        const input = inputValue || searchInput.value.trim();
        if (!input) { showError('Please enter an event or user identifier.'); return; }
        hideError();
        const parsed = parseInput(input);
        if (parsed.error) { showError(parsed.error); safeToast(parsed.error, 'error'); return; }
        if (parsed.pubkey) { await investigateUser(parsed.pubkey, parsed.relayHints || []); return; }
        if (parsed.source === 'naddr') {
            const filter = { kinds: [parsed.kind], authors: [parsed.pubkey], '#d': [parsed.dTag], limit: 1 };
            const allUrls = [...new Set([...activeRelays, ...(parsed.relayHints || [])])];
            const tempRm = new RelayManager(allUrls);
            window._relayManager = tempRm;
            const tempInv = new EventInvestigator(tempRm);
            
            tempInv.onComplete = (inv) => {
                if (inv.events.length > 0) {
                    const ev = inv.events[0];
                    // ── If it's a community (kind 34550), render community view ──
                    if (parsed.kind === 34550) {
                        renderCommunityView(ev);
                        hideLoading();
                        switchScreen('analysis');
                        return;
                    }
                    // Otherwise, fall back to regular event analysis
                    runAnalysis(ev.id);
                } else {
                    safeToast('No event found for this naddr.', 'error');
                    hideLoading();
                }
            };
            const label = parsed.kind === 34550 ? 'community' : 'event';
            showLoading(`Fetching ${label} by naddr...`);
            await tempInv.rm.connectAll(CONFIG.relayConnectTimeout);
            tempInv.rm.subscribe([filter]);
            return;
        }
        investigationHexId = parsed.hexId;
        window._investigationHexId = investigationHexId;
        allEvents = []; originalEvent = null; eventMap.clear(); threadCollapsed.clear(); sortOrder = 'oldest-first'; relayStats.clear();
        const allUrls = [...new Set([CONFIG.primaryRelay, ...activeRelays, ...(parsed.relayHints || []), ...(CONFIG.analysisRelayHints || [])])];
        relayManager = new RelayManager(allUrls);
        window._relayManager = relayManager;
        investigator = new EventInvestigator(relayManager);
        investigator.onUpdate = inv => debouncedRender(inv);
        investigator.onComplete = inv => { debouncedRender(inv); hideLoading(); };
        await investigator.investigate(parsed.hexId, parsed.relayHints || []);
        switchScreen('analysis');
        document.getElementById('panel-thread')?.classList.add('active');
    }

    function renderCommunityView(communityEvent) {
        // ── Parse community data ──
        const tags = communityEvent.tags || [];
        const name = tags.find(t => t[0] === 'name')?.[1] || 'Unnamed Community';
        const description = tags.find(t => t[0] === 'description')?.[1] || '';
        const image = tags.find(t => t[0] === 'image')?.[1] || '';
        const dTag = tags.find(t => t[0] === 'd')?.[1] || '';
    
        // Parse content (JSON with rules, banner, joinFee)
        let contentData = {};
        try {
            contentData = JSON.parse(communityEvent.content || '{}');
        } catch (e) {}
        const rules = contentData.rules || [];
        const banner = contentData.banner || '';
        const joinFee = contentData.joinFee || null;
        const type = tags.find(t => t[0] === 'type')?.[1] || 'open';
    
        // Moderators
        const moderators = tags.filter(t => t[0] === 'p' && t[3] === 'moderator').map(t => t[1]);
    
        const npub = communityEvent.pubkey ? npubFromHex(communityEvent.pubkey) : '';
    
        // ── Build the community view HTML ──
        const html = `
            <div class="card" style="padding:0; overflow:hidden;">
                ${banner ? `<div style="height:180px; background:url('${banner}') center/cover no-repeat; background-color:#1d1f23;"></div>` : ''}
                <div style="padding:16px;">
                    ${image ? `<img src="${image}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #16181c;margin-top:-40px;display:block;background:#1d1f23;" loading="lazy">` : ''}
                    <h2 style="margin:8px 0 4px; font-size:1.3rem;">${escapeHtml(name)}</h2>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
                        <span class="badge ${type === 'paid' ? 'badge-orange' : 'badge-green'}">${type === 'paid' ? '💰 Paid' : '🔓 Open'}</span>
                        ${joinFee ? `<span class="badge badge-purple">Join Fee: $${escapeHtml(joinFee)}</span>` : ''}
                        <span class="badge badge-blue">${moderators.length} moderators</span>
                    </div>
                    ${description ? `<p style="margin:8px 0; color:#a0b0c0; line-height:1.5;">${escapeHtml(description)}</p>` : ''}
                    ${rules.length ? `
                        <details style="margin:12px 0;">
                            <summary style="cursor:pointer;font-weight:600;color:#4da3ff;">📋 Community Rules (${rules.length})</summary>
                            <ol style="margin:8px 0 0 20px; color:#d0d8e0;">
                                ${rules.map(r => `<li style="margin:4px 0;">${escapeHtml(r)}</li>`).join('')}
                            </ol>
                        </details>
                    ` : ''}
                    <div style="margin:12px 0; padding:10px; background:#1d1f23; border-radius:8px; border:1px solid #2f3336; font-size:0.7rem; color:#71767b; word-break:break-all;">
                        <div><strong>Community ID:</strong> <code>${escapeHtml(dTag)}</code></div>
                        <div><strong>Author:</strong> <code>${escapeHtml(npub)}</code></div>
                        <div><strong>Event ID:</strong> <code>${escapeHtml(communityEvent.id)}</code></div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                        <button class="btn btn-sm btn-primary" onclick="window._inspectEvent('${communityEvent.id}')">📄 View JSON</button>
                        <button class="btn btn-sm btn-outline" onclick="window.boostEvent('${communityEvent.id}','${communityEvent.pubkey}','${communityEvent.kind}')">🚀 Boost</button>
                        <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText('${communityEvent.id}').then(()=>window._safeToast('Copied!'))">📋 Copy ID</button>
                    </div>
                </div>
            </div>
        `;
    
        // ── Inject into the analysis screen ──
        const container = document.getElementById('panel-thread');
        if (container) {
            container.innerHTML = html;
            // Hide other panels
            ['panel-timeline', 'panel-stats', 'panel-json', 'panel-relays', 'panel-bch', 'panel-profile'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
        }
    }

    let pendingRender = null;

    // ── Community Creation ──

    window.createCommunity = function () {
        if (!currentUser) {
            safeToast('Please login first.', 'info');
            return;
        }
        if (typeof window._safeToast === 'function') {
            window._safeToast('📝 Create a new community', 'info');
        }
    
        const modalHtml = `
            <div class="modal-backdrop" id="communityModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10001;padding:16px;">
                <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:12px;padding:20px;max-width:520px;width:100%;color:#e7e9ea;max-height:90vh;overflow-y:auto;">
                    <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('communityModalBackdrop').remove();">✕</button>
                    <h3 style="margin-top:0;">🏘️ Create Community</h3>
                    <div style="display:grid; gap:12px;">
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Community Name *</label>
                            <input id="commName" type="text" placeholder="e.g. Bitcoin Enthusiasts" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Banner Image URL</label>
                            <input id="commBanner" type="url" placeholder="https://example.com/banner.jpg" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Description</label>
                            <textarea id="commDescription" rows="3" placeholder="What is this community about?" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;resize:vertical;"></textarea>
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Rules (one per line)</label>
                            <textarea id="commRules" rows="4" placeholder="1. Be respectful&#10;2. No spam" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;resize:vertical;"></textarea>
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Community Type</label>
                            <select id="commType" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                                <option value="open">Open (anyone can join)</option>
                                <option value="paid">Paid (requires join fee)</option>
                            </select>
                        </div>
                        <div id="paidFields" style="display:none;">
                            <label style="font-size:0.75rem;color:#71767b;">Join Fee (USD) *</label>
                            <input id="commFee" type="number" min="0.01" step="0.01" placeholder="e.g. 5.00" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">d‑Tag (optional – leave blank for auto‑generate)</label>
                            <input id="commDTag" type="text" placeholder="my-community" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; margin-top:16px; justify-content:flex-end;">
                        <button class="btn btn-outline" onclick="document.getElementById('communityModalBackdrop').remove();">Cancel</button>
                        <button class="btn btn-primary" id="publishCommunityBtn">Publish Community</button>
                    </div>
                </div>
            </div>
        `;
    
        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) return;
        modalContainer.innerHTML = modalHtml;
    
        // Show/hide paid fields based on type selection
        const typeSelect = document.getElementById('commType');
        const paidFields = document.getElementById('paidFields');
        typeSelect.addEventListener('change', function() {
            paidFields.style.display = this.value === 'paid' ? 'block' : 'none';
        });
    
        document.getElementById('publishCommunityBtn').addEventListener('click', window.publishCommunity);
    };
    
    window.publishCommunity = async function () {
        const name = document.getElementById('commName').value.trim();
        const banner = document.getElementById('commBanner').value.trim();
        const description = document.getElementById('commDescription').value.trim();
        const rulesRaw = document.getElementById('commRules').value.trim();
        const type = document.getElementById('commType').value;
        const fee = document.getElementById('commFee').value.trim();
        const dTagRaw = document.getElementById('commDTag').value.trim();
    
        if (!name) {
            window._safeToast('Community name is required.', 'error');
            return;
        }
        if (type === 'paid') {
            const feeNum = parseFloat(fee);
            if (!fee || isNaN(feeNum) || feeNum <= 0) {
                window._safeToast('Please enter a valid join fee (USD).', 'error');
                return;
            }
        }
    
        // Build rules array (split by newline, filter empty)
        const rules = rulesRaw ? rulesRaw.split('\n').map(s => s.trim()).filter(Boolean) : [];
    
        const now = Math.floor(Date.now() / 1000);
        const dTag = dTagRaw || `bchnostr-community-${Date.now()}`;
    
        const eventTemplate = {
            kind: 34550,
            created_at: now,
            tags: [
                ['d', dTag],
                ['name', name],
                ['type', type],
                ['client', 'BCHNostr'],
            ],
            content: JSON.stringify({
                description: description || '',
                rules: rules,
                banner: banner || '',
                ...(type === 'paid' ? { joinFee: fee } : {})
            })
        };
    
        try {
            const signed = await window._signNostrEvent(eventTemplate, currentUser.privateKey);
            const rm = window._relayManager || await ensureRelayManager();
            if (rm) {
                rm.publish(signed);
                window._safeToast('✅ Community published!', 'success');
                document.getElementById('communityModalBackdrop').remove();
                // Optionally refresh the feed or community list
            } else {
                window._safeToast('No relay connection.', 'error');
            }
        } catch (e) {
            window._safeToast('Error publishing: ' + e.message, 'error');
        }
    };
    
    // Helper to ensure relay manager (copied from boost.js)
    async function ensureRelayManager() {
        if (window._relayManager) return window._relayManager;
        if (typeof RelayManager !== 'function') return null;
        const relays = (window.activeRelays || window.CONFIG?.relays || []).slice(0, 6);
        if (!relays.length) return null;
        const rm = new RelayManager(relays);
        window._relayManager = rm;
        try { await rm.connectAll(4000); } catch (e) {}
        return rm;
    }
    
    function debouncedRender(inv) { if (pendingRender) clearTimeout(pendingRender); pendingRender = setTimeout(() => { renderAll(inv); pendingRender = null; }, 100); }

    function renderAll(inv) {
        allEvents = inv.events; originalEvent = inv.originalEvent; eventMap = inv.eventMap; investigationHexId = inv.hexId;
        window._originalEvent = originalEvent; window._investigationHexId = investigationHexId;
        if (allEvents.length === 0 && !originalEvent) { analysisScreen.classList.remove('active'); feedScreen.classList.add('active'); return; }
        analysisScreen.classList.add('active');
        renderThread(inv); renderTimeline(inv); renderStats(inv); renderJson(inv); renderRelays(); renderBch(inv);
        document.getElementById('panel-thread')?.classList.add('active');
        ['timeline', 'stats', 'json', 'relays', 'bch', 'profile'].forEach(id => { const el = document.getElementById('panel-' + id); if (el) el.classList.remove('active'); });
    }

    // ── Event binding ──
    function bindEvents() {
        if (analyzeBtn) analyzeBtn.addEventListener('click', () => runAnalysis());
        if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });
        if (analysisBackBtn) analysisBackBtn.addEventListener('click', () => switchScreen('feed'));
        if (refreshFeedBtn) refreshFeedBtn.addEventListener('click', () => { if (typeof refreshNewPosts === 'function') refreshNewPosts(); });
        if (feedLoginBtn) {
            feedLoginBtn.onclick = function (e) { e.preventDefault(); showLoginModal(); return false; };
        }
        if (feedAccountBtn) feedAccountBtn.addEventListener('click', () => switchScreen('profile'));
        if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
    }

    // ── Init: restore login from localStorage ──
    function initApp() {
        console.log('🚀 Initializing NostrScope...');
        if (typeof NostrTools === 'undefined') { setTimeout(initApp, 500); return; }
        setTheme(getPreferredTheme());
        // Restore session
        if (loadLogin()) {
            console.log('🔓 Session restored from localStorage');
            // Sync the local currentUser with the one from utils
            if (typeof window._getCurrentUser === 'function') {
                currentUser = window._getCurrentUser();
            }
            updateUserUI();
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) {
                try {
                    cachedProfile = { profile: JSON.parse(cached), profileEvent: null };
                } catch (e) { }
            }
        }
        if (CONFIG && CONFIG.relays) {
            CONFIG.relays.forEach(u => relayStats.set(u, { status: 'pending', events: 0, errors: 0, responseTime: null }));
        }
        bindEvents();
        switchScreen('feed');
        console.log('✅ NostrScope ready – login persists on refresh');
    }

    // Expose functions globally
    window.processNsecLogin = window.processNsecLogin;
    window.showLoginModal = showLoginModal;
    window.isLoggedIn = isLoggedIn;
    window.logout = logout;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
    else initApp();
})();

