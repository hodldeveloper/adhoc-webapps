(function() {
    // ── DOM references ──
    const feedScreen = document.getElementById('feedScreen');
    const searchScreen = document.getElementById('searchScreen');
    const profileScreen = document.getElementById('profileScreen');
    const analysisScreen = document.getElementById('analysisScreen');
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

    // ── State ──
    let currentUser = null;
    let cachedProfile = null;
    const profileCache = new Map();
    const pendingFetches = new Map();

    function isLoggedIn() { return currentUser !== null; }

    // ── Screen switching ──
    window.switchScreen = function(screenName) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById(screenName + 'Screen');
        if (screen) screen.classList.add('active');
        if (typeof setActiveNav === 'function') setActiveNav(screenName);
        if (screenName === 'feed' && typeof loadFeed === 'function') loadFeed();
        if (screenName === 'profile') renderMyProfile();
    };

    // ── Quick profile fetch ──
    window.quickFetchProfile = function(pubkey) {
        if (profileCache.has(pubkey)) return Promise.resolve(profileCache.get(pubkey));
        if (pendingFetches.has(pubkey)) return pendingFetches.get(pubkey);
        const promise = new Promise((resolve) => {
            const relays = activeRelays.slice(0, 3);
            const rm = new RelayManager(relays);
            let resolved = false;
            rm.connectAll(4000).then(() => {
                const subId = rm.subscribe([{ kinds: [0], authors: [pubkey], limit: 1 }]);
                const timeout = setTimeout(() => { if (!resolved) { resolved = true; rm.closeAll(); resolve(null); } }, CONFIG.quickProfileTimeout);
                rm.onEvent = (ev) => {
                    if (ev.pubkey === pubkey && ev.kind === 0) {
                        clearTimeout(timeout);
                        if (!resolved) { resolved = true; rm.closeAll(); try { const p = JSON.parse(ev.content); resolve(p.name || p.display_name || null); } catch (e) { resolve(null); } }
                    }
                };
                rm.onEOSE = () => { if (!resolved) { clearTimeout(timeout); resolved = true; rm.closeAll(); resolve(null); } };
            }).catch(() => { if (!resolved) { resolved = true; resolve(null); } });
        });
        pendingFetches.set(pubkey, promise);
        promise.then(name => { profileCache.set(pubkey, name); pendingFetches.delete(pubkey); });
        return promise;
    };

    // ── UI Updates ──
    function updateUserUI() {
        if (currentUser) {
            window._currentUser = currentUser;
            if (feedLoginBtn) feedLoginBtn.style.display = 'none';
            if (feedAccountBtn) feedAccountBtn.style.display = 'inline-block';
        } else {
            window._currentUser = null;
            if (feedLoginBtn) feedLoginBtn.style.display = 'inline-block';
            if (feedAccountBtn) feedAccountBtn.style.display = 'none';
        }
    }

    async function fetchAndCacheProfile() {
        if (!currentUser) return;
        try {
            const upi = new UserProfileInvestigator(new RelayManager(activeRelays));
            await upi.investigate(currentUser.publicKey, [], { silent: true });
            cachedProfile = { profile: upi.profile || {}, profileEvent: upi.profileEvent };
            if (cachedProfile.profile) localStorage.setItem('nostrscope_profile', JSON.stringify(cachedProfile.profile));
        } catch (e) { console.error('Profile fetch error:', e); }
    }

    // ── Login Modal ──
    function showLoginModal() {
        console.log('🔐 Opening login modal...');
        
        if (typeof NostrTools === 'undefined') {
            console.error('NostrTools not loaded');
            showToast('Nostr tools not loaded. Please refresh the page.', 'error');
            return;
        }
        
        // Clear any existing modal
        if (modalContainer) modalContainer.innerHTML = '';
        
        const modalHTML = `
            <div class="modal-backdrop" id="loginModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;">
                <div class="modal" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:360px;width:90%;max-height:80vh;overflow-y:auto;color:var(--text);">
                    <button class="modal-close" style="float:right;background:none;border:none;color:var(--text2);font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('loginModalBackdrop').remove();">✕</button>
                    <h3 style="margin-bottom:16px;">🔐 Login with nsec</h3>
                    <div style="color:var(--red);font-size:0.75rem;margin-bottom:12px;">⚠️ Your private key never leaves this browser.</div>
                    <input type="password" id="nsecInput" placeholder="nsec1..." autocomplete="off" style="width:100%;padding:12px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;font-size:0.9rem;margin-bottom:16px;">
                    <div style="display:flex;gap:12px;">
                        <button class="btn btn-primary" id="loginConfirmBtn" style="flex:1;">Login</button>
                        <button class="btn btn-outline" id="loginCancelBtn" style="flex:1;">Cancel</button>
                    </div>
                </div>
            </div>`;
        
        modalContainer.innerHTML = modalHTML;
        
        // Get references to the newly created elements
        const backdrop = document.getElementById('loginModalBackdrop');
        const nsecInput = document.getElementById('nsecInput');
        const confirmBtn = document.getElementById('loginConfirmBtn');
        const cancelBtn = document.getElementById('loginCancelBtn');
        
        if (!backdrop || !nsecInput || !confirmBtn || !cancelBtn) {
            console.error('Failed to create login modal elements');
            return;
        }
        
        // Cancel button
        cancelBtn.addEventListener('click', () => {
            console.log('Login cancelled');
            backdrop.remove();
        });
        
        // Also close when clicking backdrop
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
            }
        });
        
        // Confirm button
        confirmBtn.addEventListener('click', async () => {
            const nsec = nsecInput.value.trim();
            console.log('Login attempt with nsec length:', nsec.length);
            
            if (!nsec) {
                showToast('Please enter your nsec key.', 'error');
                return;
            }
            
            let privateKey;
            
            // Try nostr-tools nip19 decoder first
            try {
                const { type, data } = NostrTools.nip19.decode(nsec);
                if (type !== 'nsec') throw new Error('Not an nsec');
                privateKey = typeof data === 'string' ? data : bytesToHex(data);
                console.log('Decoded via nip19');
            } catch (nip19Error) {
                console.warn('nip19 decode failed, trying manual bech32');
                // Fallback to manual bech32 decode
                const decoded = bech32Decode(nsec);
                if (!decoded || decoded.hrp !== 'nsec' || decoded.bytes.length !== 32) {
                    showToast('Invalid nsec format. Please check your key.', 'error');
                    return;
                }
                privateKey = bytesToHex(decoded.bytes);
                console.log('Decoded via manual bech32');
            }
            
            // Validate hex key
            if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
                showToast('Invalid private key format.', 'error');
                return;
            }
            
            // Derive public key
            let publicKey;
            try {
                publicKey = NostrTools.getPublicKey(privateKey);
                if (!isValidHex64(publicKey)) throw new Error('Invalid public key');
            } catch (e) {
                showToast('Unable to derive public key. Check your nsec.', 'error');
                return;
            }
            
            // Success - set user
            currentUser = { privateKey, publicKey };
            saveLogin(privateKey);
            updateUserUI();
            
            // Load cached profile
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) {
                try { 
                    cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; 
                } catch (e) {
                    cachedProfile = null;
                }
            }
            
            // Fetch fresh profile in background
            fetchAndCacheProfile();
            
            const npub = npubFromHex(publicKey);
            showToast('Logged in as ' + npub.substring(0, 12) + '...', 'success');
            console.log('✅ Login successful');
            
            // Close modal
            backdrop.remove();
            
            // Update UI
            renderMyProfile();
            
            // Refresh feed to show boost buttons
            if (feedScreen && feedScreen.classList.contains('active') && typeof loadFeed === 'function') {
                loadFeed();
            }
        });
        
        // Focus the input field
        setTimeout(() => {
            if (nsecInput) nsecInput.focus();
        }, 200);
        
        console.log('✅ Login modal displayed');
    }

    function logout() {
        currentUser = null;
        clearLogin();
        updateUserUI();
        cachedProfile = null;
        renderMyProfile();
        showToast('Logged out.', 'info');
        if (feedScreen && feedScreen.classList.contains('active') && typeof loadFeed === 'function') {
            loadFeed();
        }
    }

    // ── Account Modal ──
    function showAccountModal(forceRefresh) {
        if (!currentUser) return;
        if (forceRefresh || !cachedProfile) {
            fetchAndCacheProfile().then(() => {
                if (cachedProfile) renderAccountModal(cachedProfile.profile, cachedProfile.profileEvent);
            });
        } else {
            renderAccountModal(cachedProfile.profile, cachedProfile.profileEvent);
        }
    }

    function renderAccountModal(profile, profileEvent) {
        profile = profile || {};
        let badges = (profile.tags && Array.isArray(profile.tags)) ? [...profile.tags] : [];
        if (profileEvent && profileEvent.tags) {
            const tTags = profileEvent.tags.filter(t => t[0] === 't' && t[1]).map(t => t[1]);
            badges = [...new Set([...badges, ...tTags])];
        }
        const jsonStr = JSON.stringify(profile, null, 2);
        const fields = {
            name: profile.name || '',
            about: profile.about || '',
            picture: profile.picture || '',
            banner: profile.banner || '',
            nip05: profile.nip05 || '',
            bch_address: profile.bch_address || '',
            bch_tip_wallet: profile.bch_tip_wallet || ''
        };
        
        let html = `<div class="modal-backdrop" id="accountModalBackdrop" onclick="if(event.target===this)this.remove();">
        <div class="modal" style="max-width:360px;">
            <button class="modal-close" style="float:right;background:none;border:none;color:var(--text2);font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('accountModalBackdrop').remove();">✕</button>
            <h3>👤 My Account</h3>
            <p><strong>Public Key:</strong> <code style="font-size:0.7rem;word-break:break-all;">${currentUser.publicKey}</code></p>
            <p><strong>npub:</strong> <code>${npubFromHex(currentUser.publicKey)}</code></p><hr/>`;
        
        for (const [key, val] of Object.entries(fields)) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            html += `<label>${label}:</label><br/><input type="text" id="edit_${key}" value="${escapeHtml(val)}" style="width:100%;margin-bottom:8px;"/><br/>`;
        }
        
        html += `<div style="margin-top:8px;"><strong>Badges:</strong> ${badges.length > 0 ? badges.map(t => `<span class="badge badge-blue">${escapeHtml(t)}</span>`).join(' ') : '<span style="color:var(--text2);">none</span>'}</div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn btn-primary" id="saveProfileBtn">💾 Save</button>
            <button class="btn btn-outline btn-sm" id="refreshProfileBtn">🔄 Refresh</button>
        </div><hr/>
        <details style="margin-top:12px;"><summary style="cursor:pointer;color:var(--accent2);">📄 Full JSON</summary>
        <div class="json-viewer" style="max-height:200px;margin-top:8px;">${syntaxHighlight(jsonStr)}</div></details>
        </div></div>`;
        
        modalContainer.innerHTML = html;
        
        document.getElementById('saveProfileBtn').addEventListener('click', () => {
            const newProfile = {};
            for (const key of Object.keys(fields)) {
                const val = document.getElementById('edit_' + key)?.value?.trim();
                if (val) newProfile[key] = val;
            }
            if (badges.length > 0) newProfile.tags = badges;
            const event = { kind: 0, created_at: Math.floor(Date.now()/1000), tags: [], content: JSON.stringify(newProfile) };
            if (typeof window._signNostrEvent !== 'function') { showToast('Signing not available.', 'error'); return; }
            window._signNostrEvent(event, currentUser.privateKey).then(signed => {
                if (relayManager) relayManager.publish(signed);
                cachedProfile = { profile: newProfile, profileEvent: null };
                localStorage.setItem('nostrscope_profile', JSON.stringify(newProfile));
                showToast('Profile updated!', 'success');
                document.getElementById('accountModalBackdrop')?.remove();
            }).catch(e => showToast('Error: ' + e.message, 'error'));
        });
        
        document.getElementById('refreshProfileBtn').addEventListener('click', () => {
            document.getElementById('accountModalBackdrop')?.remove();
            showAccountModal(true);
        });
    }

    // ── Profile Screen ──
    function renderMyProfile() {
        if (!profileContent) return;
        if (!currentUser) {
            profileContent.innerHTML = `<div style="padding:20px;text-align:center;">
                <p style="margin-bottom:12px;color:var(--text2);">You are not logged in.</p>
                <button class="btn btn-primary" id="loginFromProfileBtn">🔑 Login</button>
            </div>`;
            document.getElementById('loginFromProfileBtn')?.addEventListener('click', showLoginModal);
            return;
        }
        if (!cachedProfile) {
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) { try { cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; } catch (e) { cachedProfile = null; } }
            if (!cachedProfile) {
                profileContent.innerHTML = '<p style="padding:20px;color:var(--text2);">Loading profile…</p>';
                fetchAndCacheProfile().then(renderMyProfile);
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
                <div style="width:60px;height:60px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;overflow:hidden;">
                    ${picture ? `<img src="${picture}" style="width:100%;height:100%;object-fit:cover;">` : '👤'}
                </div>
                <div>
                    <h3 style="font-size:1.2rem;margin:0;">${escapeHtml(name || 'Unnamed')}</h3>
                    <p style="color:var(--text2);font-size:0.8rem;margin:4px 0 0 0;">@${npub.substring(0,12)}...</p>
                </div>
            </div>
            ${about ? `<p style="margin-bottom:16px;color:var(--text);">${escapeHtml(about)}</p>` : ''}
            <div style="display:flex;gap:8px;">
                <button class="btn btn-outline" id="editProfileBtn">Edit Profile</button>
                <button class="btn btn-outline" id="logoutProfileBtn">Logout</button>
            </div>
        </div>`;
        document.getElementById('editProfileBtn')?.addEventListener('click', () => showAccountModal());
        document.getElementById('logoutProfileBtn')?.addEventListener('click', logout);
    }

    // ── Analysis rendering (all functions unchanged from previous versions) ──
    function buildThreadCards(eventId, childrenMap, depth, visited) {
        if (visited.has(eventId) && depth > 0) return '';
        visited.add(eventId);
        const event = eventMap.get(eventId);
        if (!event && depth > 0) return '';
        if (threadCollapsed.has(eventId) && depth > 0) return `<div class="tree-collapsed" onclick="window._expandThread('${eventId}')" style="margin-left:${depth*20}px;">[+] Show replies</div>`;
        const isOriginal = eventId === investigationHexId;
        const { text, media } = renderMediaFromContent(event.content);
        const kindName = KNOWN_KINDS[event.kind] || `Kind ${event.kind}`;
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const authorShort = event.pubkey ? event.pubkey.substring(0, 8) + '...' : 'unknown';
        const contentId = 'c-' + event.id;
        const isLong = (event.content || '').length > 250;
        const boostBtn = isLoggedIn() ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${event.id}','${event.pubkey}','${event.kind}')">🚀 Boost</button>` : '';
        let cardHtml = `<div class="tree-card" style="margin-left:${depth*20}px;"><div class="event-preview"><div class="event-header"><span class="event-kind-badge">${isOriginal ? '★ Original' : kindName}</span><span class="event-time">${time}</span><span class="event-author author-name" data-pubkey="${event.pubkey || ''}">${escapeHtml(authorShort)}</span></div><div class="event-content" id="${contentId}" style="${isLong ? 'max-height:80px;' : ''}">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>${isLong ? `<span class="show-more-btn" onclick="document.getElementById('${contentId}').style.maxHeight='none';this.style.display='none';">Show more</span>` : ''}${media ? `<div class="media-preview">${media}</div>` : ''}<div class="thread-actions"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${event.id}')">JSON</button>${boostBtn}</div></div></div>`;
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
            html += `<div class="timeline-card ${borderClass}"><span class="timeline-time">${time}</span><span class="timeline-kind"><span class="badge ${isOrig ? 'badge-green' : 'badge-purple'}">${kind}</span>${isOrig ? ' <span class="badge badge-green">★</span>' : ''}</span><div class="timeline-content"><code style="font-size:0.6rem;color:var(--text2);">${e.id.substring(0,10)}...</code><div>${text || ''}</div>${media ? `<div style="margin-top:4px;">${media}</div>` : ''}</div><div class="timeline-actions" style="margin-top:4px;"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">JSON</button>${boostBtn}</div></div>`;
        });
        html += '</div></div>';
        p.innerHTML = html;
    }

    function renderStats(inv) {
        const p = document.getElementById('panel-stats');
        const tree = inv.getThreadTree();
        let nested = 0;
        if (tree && tree.childrenMap) { const count = (eid, d) => { let c = 0; for (const child of (tree.childrenMap.get(eid) || [])) { if (d >= 1) c++; c += count(child.id, d + 1); } return c; }; nested = count(tree.rootId, 0); }
        const stats = [ { l: 'Original', v: originalEvent ? 1 : 0 }, { l: 'Replies', v: inv.getEventsByKind(1).filter(e => e.id !== investigationHexId && inv.getParentIds(e).includes(investigationHexId)).length }, { l: 'Nested', v: nested }, { l: 'Quotes', v: inv.events.filter(e => e.kind === 1 && e.content && e.content.includes(investigationHexId || '') && !inv.getParentIds(e).includes(investigationHexId || '')).length }, { l: 'Mentions', v: inv.events.filter(e => e.tags && e.tags.some(t => t[0] === 'e' && t[1] === investigationHexId)).length }, { l: 'Reposts', v: inv.getEventsByKind(6).length }, { l: 'Reactions', v: inv.getEventsByKind(7).length }, { l: 'Zaps', v: inv.getEventsByKind(9735).length + inv.getEventsByKind(9734).length }, { l: 'BCH Tips', v: inv.getBchPaymentEvents().length }, { l: 'Unknown', v: inv.getUnknownEvents().length }, { l: 'Authors', v: inv.getUniqueAuthors() }, { l: 'Relays', v: [...relayStats.values()].filter(s => s.status === 'connected').length }, { l: 'Success', v: [...relayStats.values()].filter(s => s.events > 0).length }, { l: 'Failed', v: [...relayStats.values()].filter(s => s.status === 'failed' || s.status === 'disconnected').length }, { l: 'Images', v: inv.getMediaCounts().images }, { l: 'Videos', v: inv.getMediaCounts().videos }, { l: 'Files', v: inv.getMediaCounts().attachments }, { l: 'Hashtags', v: inv.getHashtags() }, { l: 'Links', v: inv.getLinks() }, { l: 'Total', v: inv.events.length } ];
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
            h += `<div><span style="color:${isOrig ? 'var(--green)' : 'var(--accent2)'};cursor:pointer;" onclick="window._toggleJsonBlock(this)" data-eid="${e.id}">${isOrig ? '★ ' : '▸ '}${e.id.substring(0,12)}... [Kind ${e.kind}]</span><div style="display:none;margin-left:16px;border-left:2px solid var(--border);padding-left:8px;" class="json-block-content">${syntaxHighlight(JSON.stringify(e, null, 2))}<br><button class="btn btn-sm btn-outline" onclick="window._copyEventJson('${e.id}')">Copy</button> <button class="btn btn-sm btn-outline" onclick="window._downloadEventJson('${e.id}')">Download</button></div></div>`;
        }
        h += '</div></div>';
        p.innerHTML = h;
    }

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
            h += `<div class="bch-card" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;"><div><strong>Type:</strong> <span class="badge badge-orange">${e.paymentType}</span> | ${new Date((e.created_at||0)*1000).toLocaleString()}</div><div>${sender} → ${recipient}</div><div>Amount: ${amount} ${curr}</div>${txid!=='N/A'?`<div>TXID: <code style="word-break:break-all;">${txid}</code> <a href="https://blockchair.com/bitcoin-cash/transaction/${txid}" target="_blank" style="color:var(--blue);">🔗 Explorer</a></div>`:''}<div>Memo: ${escapeHtml((e.content||'').substring(0,200))}</div><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">View JSON</button></div>`;
        });
        h += '</div>';
        p.innerHTML = h;
    }

    // ── Event listeners ──
    function bindEvents() {
        console.log('Binding events...');
        
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', () => runAnalysis());
            console.log('Analyze button bound');
        }
        
        if (searchInput) {
            searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });
            console.log('Search input bound');
        }
        
        if (analysisBackBtn) {
            analysisBackBtn.addEventListener('click', () => switchScreen('feed'));
            console.log('Analysis back button bound');
        }
        
        if (refreshFeedBtn) {
            refreshFeedBtn.addEventListener('click', () => { if (typeof refreshNewPosts === 'function') refreshNewPosts(); });
            console.log('Refresh feed button bound');
        }
        
        if (feedLoginBtn) {
            console.log('Binding login button...');
            feedLoginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Login button clicked via event listener');
                showLoginModal();
            });
            feedLoginBtn.onclick = function(e) {
                e.preventDefault();
                console.log('Login button clicked via onclick');
                showLoginModal();
                return false;
            };
            console.log('Login button bound');
        }
        
        if (feedAccountBtn) {
            feedAccountBtn.addEventListener('click', () => showAccountModal());
            console.log('Account button bound');
        }
        
        console.log('All events bound');
    }

    // ── Init ──
    function initApp() {
        console.log('🚀 Initializing NostrScope...');
        
        if (typeof NostrTools === 'undefined') {
            console.error('NostrTools not loaded, retrying...');
            setTimeout(initApp, 500);
            return;
        }
        
        console.log('✅ NostrTools loaded');
        
        // Restore session
        if (loadLogin()) {
            console.log('🔓 Session restored');
            updateUserUI();
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) { try { cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; } catch (e) { cachedProfile = null; } }
            if (!cachedProfile) fetchAndCacheProfile();
        }
        
        // Initialize relay stats
        if (CONFIG && CONFIG.relays) {
            CONFIG.relays.forEach(u => relayStats.set(u, { status: 'pending', events: 0, errors: 0, responseTime: null }));
        }
        
        // Bind all event listeners
        bindEvents();
        
        // Start on feed screen
        switchScreen('feed');
        
        console.log('✅ NostrScope ready');
        console.log('Login function available:', typeof showLoginModal === 'function');
        console.log('Login button exists:', !!feedLoginBtn);
    }

    // Expose functions globally
    window.showLoginModal = showLoginModal;
    window.showAccountModal = showAccountModal;
    window.isLoggedIn = isLoggedIn;
    window.logout = logout;
    window.renderMyProfile = renderMyProfile;
    window.updateUserUI = updateUserUI;

    // Start the app
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
