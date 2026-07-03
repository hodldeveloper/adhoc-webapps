(function() {
    // ── DOM caching ────────────────────
    homeScreen = document.getElementById('homeScreen');
    resultsScreen = document.getElementById('resultsScreen');
    homeSearchInput = document.getElementById('homeSearchInput');
    homeAnalyzeBtn = document.getElementById('homeAnalyzeBtn');
    homeClearBtn = document.getElementById('homeClearBtn');
    errorMsg = document.getElementById('errorMsg');
    loadingOverlay = document.getElementById('loadingOverlay');
    loadingText = document.getElementById('loadingText');
    toastContainer = document.getElementById('toastContainer');
    modalContainer = document.getElementById('modalContainer');
    resultsBackBtn = document.getElementById('resultsBackBtn');
    resultsLoginBtn = document.getElementById('resultsLoginBtn');
    resultsAccountBtn = document.getElementById('resultsAccountBtn');
    homeLoginBtn = document.getElementById('homeLoginBtn');
    homeLogoutBtn = document.getElementById('homeLogoutBtn');
    homeUserStatus = document.getElementById('homeUserStatus');
    homeAccountBtn = document.getElementById('homeAccountBtn');
    bottomNav = document.querySelector('.bottom-nav');

    // ── Profile cache & quick fetch ────
    const profileCache = new Map();
    const pendingFetches = new Map();

    function quickFetchProfile(pubkey) {
        if (profileCache.has(pubkey)) return Promise.resolve(profileCache.get(pubkey));
        if (pendingFetches.has(pubkey)) return pendingFetches.get(pubkey);

        const promise = new Promise((resolve) => {
            const relays = activeRelays.slice(0, 3); // first 3 relays for speed
            const rm = new RelayManager(relays);
            let resolved = false;

            rm.connectAll(4000).then(() => {
                const subId = rm.subscribe([{ kinds: [0], authors: [pubkey], limit: 1 }]);
                const timeout = setTimeout(() => {
                    if (!resolved) { resolved = true; rm.closeAll(); resolve(null); }
                }, 3000);

                rm.onEvent = (ev) => {
                    if (ev.pubkey === pubkey && ev.kind === 0) {
                        clearTimeout(timeout);
                        if (!resolved) {
                            resolved = true;
                            rm.closeAll();
                            try {
                                const p = JSON.parse(ev.content);
                                resolve(p.name || p.display_name || null);
                            } catch (e) { resolve(null); }
                        }
                    }
                };
                rm.onEOSE = () => {
                    if (!resolved) { clearTimeout(timeout); resolved = true; rm.closeAll(); resolve(null); }
                };
            }).catch(() => {
                if (!resolved) { resolved = true; resolve(null); }
            });
        });

        pendingFetches.set(pubkey, promise);
        promise.then(name => {
            profileCache.set(pubkey, name);
            pendingFetches.delete(pubkey);
        });
        return promise;
    }

    // ── Resolve author names in a container (throttled) ──
    function resolveAuthorNames(container) {
        const elements = container.querySelectorAll('.author-name:not(.resolved)');
        const fetches = [];
        elements.forEach(el => {
            const pubkey = el.dataset.pubkey;
            if (!pubkey) return;
            fetches.push(
                quickFetchProfile(pubkey).then(name => {
                    if (name) el.textContent = name;
                    else el.textContent = pubkey.substring(0, 10) + '...';
                    el.classList.add('resolved');
                })
            );
        });
    }

    // ── UI Updates ─────────────────────
    function updateUserUI() {
        if (currentUser) {
            const npub = npubFromHex(currentUser.publicKey).substring(0, 12) + '...';
            if (homeUserStatus) homeUserStatus.textContent = npub;
            if (homeLoginBtn) homeLoginBtn.style.display = 'none';
            if (homeLogoutBtn) homeLogoutBtn.style.display = 'inline-block';
            if (homeAccountBtn) homeAccountBtn.style.display = 'inline-block';
            if (resultsLoginBtn) resultsLoginBtn.style.display = 'none';
            if (resultsAccountBtn) resultsAccountBtn.style.display = 'inline-block';
            window._currentUser = currentUser;
        } else {
            if (homeUserStatus) homeUserStatus.textContent = 'Not logged in';
            if (homeLoginBtn) homeLoginBtn.style.display = 'inline-block';
            if (homeLogoutBtn) homeLogoutBtn.style.display = 'none';
            if (homeAccountBtn) homeAccountBtn.style.display = 'none';
            if (resultsLoginBtn) resultsLoginBtn.style.display = 'inline-block';
            if (resultsAccountBtn) resultsAccountBtn.style.display = 'none';
            window._currentUser = null;
        }
    }

    // ── Account Modal ──────────────────
    function showAccountModal() {
        if (!currentUser) return;
        const tmpInvestigator = new UserProfileInvestigator(new RelayManager(activeRelays));
        tmpInvestigator.investigate(currentUser.publicKey, [], { silent: true }).then(() => {
            const profile = tmpInvestigator.profile || {};
            const profileEvent = tmpInvestigator.profileEvent;
            let badges = (profile.tags && Array.isArray(profile.tags)) ? [...profile.tags] : [];
            if (profileEvent && profileEvent.tags) {
                const tTags = profileEvent.tags.filter(t => t[0] === 't' && t[1]).map(t => t[1]);
                badges = [...new Set([...badges, ...tTags])];
            }
            const jsonStr = JSON.stringify(profile, null, 2);
            const name = profile.name || '';
            const about = profile.about || '';
            const picture = profile.picture || '';
            const banner = profile.banner || '';
            const nip05 = profile.nip05 || '';
            const bchAddress = profile.bch_address || '';
            const bchTipWallet = profile.bch_tip_wallet || '';
            let html = `<div class="modal-backdrop" id="accountModalBackdrop" onclick="if(event.target===this)this.remove();"><div class="modal" style="max-width:360px;"><button class="modal-close" style="float:right;background:none;border:none;color:var(--text2);font-size:1.2rem;" onclick="this.closest('.modal-backdrop').remove();">✕</button><h3>👤 My Account</h3><p><strong>Public Key:</strong> <code style="font-size:0.7rem;word-break:break-all;">${currentUser.publicKey}</code></p><p><strong>npub:</strong> <code>${npubFromHex(currentUser.publicKey)}</code></p><hr/><div id="accountEditForm"><label>Name:</label><br/><input type="text" id="editName" value="${escapeHtml(name)}" style="width:100%;"/><br/><label>About:</label><br/><textarea id="editAbout" style="width:100%;" rows="2">${escapeHtml(about)}</textarea><br/><label>Picture URL:</label><br/><input type="text" id="editPicture" value="${escapeHtml(picture)}" style="width:100%;"/><br/><label>Banner URL:</label><br/><input type="text" id="editBanner" value="${escapeHtml(banner)}" style="width:100%;"/><br/><label>NIP-05:</label><br/><input type="text" id="editNip05" value="${escapeHtml(nip05)}" style="width:100%;"/><br/><label>BCH Address:</label><br/><input type="text" id="editBchAddress" value="${escapeHtml(bchAddress)}" style="width:100%;"/><br/><label>BCH Tip Wallet:</label><br/><input type="text" id="editBchTipWallet" value="${escapeHtml(bchTipWallet)}" style="width:100%;"/><br/><div style="margin-top:8px;"><strong>Badges:</strong> ${badges.length > 0 ? badges.map(t => `<span class="badge badge-blue">${escapeHtml(t)}</span>`).join(' ') : '<span style="color:var(--text2);">none</span>'}</div><button class="btn btn-primary" id="saveProfileBtn" style="margin-top:12px;">💾 Save Profile</button></div><hr/><details style="margin-top:12px;"><summary style="cursor:pointer; color:var(--accent2);">📄 Full Profile JSON</summary><div class="json-viewer" style="max-height:200px; margin-top:8px;">${syntaxHighlight(jsonStr)}</div></details></div></div>`;
            modalContainer.innerHTML = html;
            document.getElementById('saveProfileBtn').addEventListener('click', () => {
                const newName = document.getElementById('editName').value.trim();
                const newAbout = document.getElementById('editAbout').value.trim();
                const newPicture = document.getElementById('editPicture').value.trim();
                const newBanner = document.getElementById('editBanner').value.trim();
                const newNip05 = document.getElementById('editNip05').value.trim();
                const newBchAddress = document.getElementById('editBchAddress').value.trim();
                const newBchTipWallet = document.getElementById('editBchTipWallet').value.trim();
                const newProfile = {};
                if (newName) newProfile.name = newName;
                if (newAbout) newProfile.about = newAbout;
                if (newPicture) newProfile.picture = newPicture;
                if (newBanner) newProfile.banner = newBanner;
                if (newNip05) newProfile.nip05 = newNip05;
                if (newBchAddress) newProfile.bch_address = newBchAddress;
                if (newBchTipWallet) newProfile.bch_tip_wallet = newBchTipWallet;
                if (badges.length > 0) newProfile.tags = badges;
                const event = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(newProfile) };
                if (typeof window._signNostrEvent !== 'function') { showToast('Signing function not available.', 'error'); return; }
                window._signNostrEvent(event, currentUser.privateKey).then(signed => {
                    if (relayManager) relayManager.publish(signed);
                    showToast('Profile updated!', 'success');
                    document.getElementById('accountModalBackdrop').remove();
                }).catch(e => showToast('Error: ' + e.message, 'error'));
            });
        });
    }

    // ── Login Modal ────────────────────
    function showLoginModal() {
        modalContainer.innerHTML = `<div class="modal-backdrop" id="loginModalBackdrop"><div class="modal"><h3>🔐 Login with nsec</h3><div class="warning">⚠️ Your private key never leaves this browser.</div><input type="password" id="nsecInput" placeholder="nsec1..." autocomplete="off"><div style="display:flex; gap:8px; margin-top:12px;"><button class="btn btn-primary" id="loginConfirmBtn">Login</button><button class="btn btn-outline" id="loginCancelBtn">Cancel</button></div></div></div>`;
        const backdrop = document.getElementById('loginModalBackdrop');
        backdrop.querySelector('#loginCancelBtn').addEventListener('click', () => backdrop.remove());
        backdrop.querySelector('#loginConfirmBtn').addEventListener('click', () => {
            const nsec = document.getElementById('nsecInput').value.trim();
            if (typeof NostrTools === 'undefined') { showToast('Nostr tools not loaded. Please refresh.', 'error'); return; }
            let privateKey;
            try {
                const { type, data } = NostrTools.nip19.decode(nsec);
                if (type !== 'nsec') throw new Error('Not an nsec');
                privateKey = data;
            } catch (nip19Error) {
                const decoded = bech32Decode(nsec);
                if (!decoded || decoded.hrp !== 'nsec' || decoded.bytes.length !== 32) { showToast('Invalid nsec format.', 'error'); return; }
                privateKey = bytesToHex(decoded.bytes);
            }
            let publicKey;
            try { publicKey = NostrTools.getPublicKey(privateKey); } catch (e) { showToast('Invalid private key.', 'error'); return; }
            currentUser = { privateKey, publicKey };
            saveLogin(privateKey);
            updateUserUI();
            showToast('Logged in as ' + npubFromHex(publicKey).substring(0,12) + '...', 'success');
            backdrop.remove();
        });
    }

    function logout() {
        currentUser = null;
        clearLogin();
        clearSavedInvestigation();
        updateUserUI();
        showToast('Logged out.', 'info');
    }

    // ── Investigation state persistence ──
    function saveInvestigationState(type, identifier) {
        localStorage.setItem('nostrscope_investigation', JSON.stringify({ type, identifier }));
    }

    function clearSavedInvestigation() {
        localStorage.removeItem('nostrscope_investigation');
    }

    function loadSavedInvestigation() {
        const saved = localStorage.getItem('nostrscope_investigation');
        if (saved) {
            try {
                const { type, identifier } = JSON.parse(saved);
                if (type === 'event' && identifier) {
                    // Auto-run analysis after a short delay to let everything settle
                    setTimeout(() => runAnalysis(identifier), 500);
                } else if (type === 'profile' && identifier) {
                    setTimeout(() => runAnalysis(identifier), 500);
                }
                // Clear after auto-running to prevent infinite loop on refresh
                clearSavedInvestigation();
            } catch (e) {}
        }
    }

    // ── Thread View ────────────────────
    function buildThreadCards(eventId, childrenMap, depth, visited) {
        if (visited.has(eventId) && depth > 0) return '';
        visited.add(eventId);
        const event = eventMap.get(eventId);
        if (!event && depth > 0) return '';
        if (threadCollapsed.has(eventId) && depth > 0) {
            return `<div class="tree-collapsed" onclick="window._expandThread('${eventId}')" style="margin-left:${depth*20}px;">[+] Show replies</div>`;
        }
        const isOriginal = eventId === investigationHexId;
        const { text, media } = renderMediaFromContent(event.content);
        const kindName = KNOWN_KINDS[event.kind] || `Kind ${event.kind}`;
        const time = new Date((event.created_at || 0) * 1000).toLocaleString();
        const authorShort = event.pubkey ? event.pubkey.substring(0, 8) + '...' : 'unknown';
        const contentId = 'c-' + event.id;
        const isLong = (event.content || '').length > 250;
        let cardHtml = `<div class="tree-card" style="margin-left:${depth*20}px;"><div class="event-preview"><div class="event-header"><span class="event-kind-badge">${isOriginal ? '★ Original' : kindName}</span><span class="event-time">${time}</span><span class="event-author author-name" data-pubkey="${event.pubkey || ''}">${escapeHtml(authorShort)}</span></div><div class="event-content" id="${contentId}" style="${isLong ? 'max-height:80px;' : ''}">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>${isLong ? `<span class="show-more-btn" onclick="document.getElementById('${contentId}').style.maxHeight='none'; this.style.display='none';">Show more</span>` : ''}${media ? `<div class="media-preview">${media}</div>` : ''}<div class="thread-actions"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${event.id}')">JSON</button>${currentUser ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${event.id}','${event.pubkey}','${event.kind}')">🚀 Boost</button>` : ''}</div></div></div>`;
        let html = cardHtml;
        const children = childrenMap.get(eventId) || [];
        if (children.length > 0) { html += `<div class="tree-branch">`; for (const child of children) { html += buildThreadCards(child.id, childrenMap, depth + 1, new Set(visited)); } html += `</div>`; }
        return html;
    }

    function renderThread(inv) {
        const p = document.getElementById('panel-thread');
        const tree = inv.getThreadTree();
        if (!tree || !tree.rootEvent) { p.innerHTML = '<div class="card"><p>No thread data.</p></div>'; return; }
        let html = '<div class="card"><div class="card-header"><span class="card-title">🌳 Thread View</span><div style="display:flex; gap:6px;"><button class="btn btn-sm btn-outline" onclick="window._expandAll()">Expand</button><button class="btn btn-sm btn-outline" onclick="window._collapseAll()">Collapse</button></div></div><div class="thread-tree-container">';
        html += buildThreadCards(tree.rootId, tree.childrenMap, 0, new Set());
        html += '</div></div>';
        p.innerHTML = html;
        resolveAuthorNames(p);
    }

    // ── Timeline ────────────────────────
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
            if (isOrig) borderClass = 'original-post';
            else if (e.kind === 6) borderClass = 'repost-post';
            html += `<div class="timeline-card ${borderClass}"><span class="timeline-time">${time}</span><span class="timeline-kind"><span class="badge ${isOrig ? 'badge-green' : 'badge-purple'}">${kind}</span>${isOrig ? ' <span class="badge badge-green">★</span>' : ''}</span><div class="timeline-content"><code style="font-size:0.6rem;color:var(--text2);">${e.id.substring(0,10)}...</code><div>${text || ''}</div>${media ? `<div style="margin-top:4px;">${media}</div>` : ''}</div><div class="timeline-actions" style="margin-top:4px;"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">JSON</button>${currentUser ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${e.id}','${e.pubkey}','${e.kind}')">🚀</button>` : ''}</div><span class="event-author author-name" data-pubkey="${e.pubkey || ''}" style="display:none;">${escapeHtml(e.pubkey?.substring(0,8) + '...')}</span></div>`;
        });
        html += '</div></div>';
        p.innerHTML = html;
        resolveAuthorNames(p);
    }

    // ── Statistics ──────────────────────
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

    // ── JSON Viewer ────────────────────
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

    // ── Relays ─────────────────────────
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

    // ── Export ─────────────────────────
    function renderExport() { document.getElementById('panel-export').innerHTML = '<div class="card"><div class="card-header"><span class="card-title">💾 Export</span></div><div class="export-btns"><button class="btn btn-sm btn-outline" onclick="window._exportJSON(\'original\')">📄 Original JSON</button><button class="btn btn-sm btn-outline" onclick="window._exportJSON(\'all\')">📦 All JSON</button><button class="btn btn-sm btn-outline" onclick="window._exportCSV()">📊 CSV</button><button class="btn btn-sm btn-outline" onclick="window._exportMarkdown()">📝 Markdown</button><button class="btn btn-sm btn-outline" onclick="window._exportHTML()">🌐 HTML</button></div></div>'; }

    // ── BCH Payments ───────────────────
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

    // ── Profile Tab ────────────────────
    function renderProfileTab(data, pubkey) {
        const p = document.getElementById('panel-profile');
        const profile = data.profile || {};
        let html = '<div class="card"><div class="card-header"><span class="card-title">👤 User Profile</span></div>';
        html += `<p><strong>npub:</strong> <code>${npubFromHex(pubkey)}</code></p>`;
        if (profile.name) html += `<p><strong>Name:</strong> ${escapeHtml(profile.name)}</p>`;
        if (profile.about) html += `<p><strong>About:</strong> ${escapeHtml(profile.about)}</p>`;
        if (profile.picture) html += `<p><img src="${profile.picture}" alt="Profile" style="max-width:80px;border-radius:50%;"/></p>`;
        if (data.follows.length) html += `<p><strong>Follows (${data.follows.length}):</strong> ${data.follows.map(f => `<code>${f.substring(0,8)}...</code>`).join(', ')}</p>`;
        if (data.relays.length) html += `<p><strong>Relays:</strong> ${data.relays.map(r => `<code>${escapeHtml(r)}</code>`).join(', ')}</p>`;
        if (!profile.name && !profile.about && !profile.picture && !data.follows.length && !data.relays.length) { html += '<p style="color:var(--text2);">No public profile data found.</p>'; }
        html += '</div>';
        p.innerHTML = html;
        switchTab('profile');
    }

    async function investigateUser(pubkey, hints = []) {
        const allUrls = [...new Set([...activeRelays, ...hints])];
        const rm = new RelayManager(allUrls);
        window._relayManager = rm;
        const upi = new UserProfileInvestigator(rm);
        await upi.investigate(pubkey, hints);
        scannedPubkey = pubkey;
        userProfileData = { profile: upi.profile, follows: upi.follows, relays: upi.relays };
        renderProfileTab(userProfileData, pubkey);
        resultsScreen.classList.add('active');
        homeScreen.classList.remove('active');
        saveInvestigationState('profile', pubkey);
    }

    // ── Event JSON Modal ───────────────
    function showEventModal(ev) {
        const json = JSON.stringify(ev, null, 2);
        modalContainer.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)this.remove();"><div class="modal"><button class="modal-close" style="float:right;background:none;border:none;color:var(--text2);font-size:1.2rem;" onclick="this.closest('.modal-backdrop').remove();">✕</button><h3>Event: <code style="font-size:0.7rem;word-break:break-all;">${escapeHtml(ev.id)}</code></h3><p style="color:var(--text2);">Kind: ${KNOWN_KINDS[ev.kind]||ev.kind} | ${new Date((ev.created_at||0)*1000).toLocaleString()}</p><div class="json-viewer" style="max-height:50vh;">${syntaxHighlight(json)}</div><div style="margin-top:12px;display:flex;gap:8px;"><button class="btn btn-sm btn-outline copy-json-btn" data-event-id="${ev.id}">Copy</button><button class="btn btn-sm btn-primary download-json-btn" data-event-id="${ev.id}">Download</button></div></div></div>`;
        const b = modalContainer.querySelector('.modal-backdrop');
        b.querySelector('.copy-json-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(JSON.stringify(eventMap.get(b.querySelector('.copy-json-btn').dataset.eventId), null, 2)).then(() => showToast('Copied!'));
        });
        b.querySelector('.download-json-btn').addEventListener('click', () => {
            const eid = b.querySelector('.download-json-btn').dataset.eventId;
            downloadFile(JSON.stringify(eventMap.get(eid), null, 2), `nostr-event-${eid.substring(0,12)}.json`);
        });
    }

    // ── Exports ────────────────────────
    function exportJSON(type) {
        let data, filename;
        if (type === 'original' && originalEvent) { data = JSON.stringify(originalEvent, null, 2); filename = `nostrscope-original-${investigationHexId?.substring(0,12) || 'event'}.json`; }
        else { data = JSON.stringify({ investigationHexId, originalEvent, allEvents, relayStats: [...relayStats.entries()].map(([u, s]) => ({ url: u, ...s })), exportedAt: new Date().toISOString(), totalEvents: allEvents.length }, null, 2); filename = `nostrscope-investigation-${investigationHexId?.substring(0,12) || 'all'}.json`; }
        downloadFile(data, filename, 'application/json');
        showToast('Exported!');
    }
    function exportCSV() { let csv = 'Event ID,Kind,Kind Name,Author,Created At,Content Preview,Is Original\n'; allEvents.forEach(e => { const kindName = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`; csv += `"${e.id}",${e.kind},"${kindName}","${e.pubkey || ''}","${new Date((e.created_at||0)*1000).toISOString()}","${(e.content||'').replace(/"/g,'""').substring(0,200)}","${e.id===investigationHexId?'Yes':'No'}"\n`; }); downloadFile(csv, `nostrscope-summary-${investigationHexId?.substring(0,12) || 'events'}.csv`, 'text/csv'); }
    function exportMarkdown() { let md = `# NostrScope Investigation Report\n\n**Event ID:** \`${investigationHexId||'N/A'}\`\n**Generated:** ${new Date().toISOString()}\n**Total Events:** ${allEvents.length}\n\n## Statistics\n\n| Metric | Value |\n|---|---|\n| Original Event | ${originalEvent?1:0} |\n| Total Events | ${allEvents.length} |\n| Unique Authors | ${new Set(allEvents.map(e=>e.pubkey)).size} |\n| Replies (Kind 1) | ${allEvents.filter(e=>e.kind===1).length} |\n| Reactions (Kind 7) | ${allEvents.filter(e=>e.kind===7).length} |\n| Reposts (Kind 6) | ${allEvents.filter(e=>e.kind===6).length} |\n| Zaps | ${allEvents.filter(e=>e.kind===9735||e.kind===9734).length} |\n\n## Timeline\n\n`; [...allEvents].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).forEach(e => { md += `- **${new Date((e.created_at||0)*1000).toLocaleString()}** [${KNOWN_KINDS[e.kind]||`Kind ${e.kind}`}] \`${e.id.substring(0,12)}...\` - ${(e.content||'').substring(0,80).replace(/\n/g,' ')}\n`; }); downloadFile(md, `nostrscope-report-${investigationHexId?.substring(0,12) || 'events'}.md`, 'text/markdown'); }
    function exportHTML() { let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NostrScope Report</title><style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:20px;max-width:900px;margin:0 auto;}h1{color:#a78bfa;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #30363d;padding:8px;}</style></head><body><h1>🔍 NostrScope Report</h1><p><strong>Event ID:</strong> <code>${investigationHexId||'N/A'}</code></p><p><strong>Total Events:</strong> ${allEvents.length}</p><table><thead><tr><th>Time</th><th>Kind</th><th>ID</th><th>Content</th></tr></thead><tbody>`; [...allEvents].sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).forEach(e => { h += `<tr><td>${new Date((e.created_at||0)*1000).toLocaleString()}</td><td>${KNOWN_KINDS[e.kind]||`Kind ${e.kind}`}</td><td><code>${e.id.substring(0,14)}...</code></td><td>${escapeHtml((e.content||'').substring(0,120))}</td></tr>`; }); h += '</tbody></table></body></html>'; downloadFile(h, `nostrscope-report-${investigationHexId?.substring(0,12) || 'events'}.html`, 'text/html'); }

    // ── Tab switching ───────────────────
    function switchTab(tabName) {
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${tabName}`)?.classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(b => { b.classList.toggle('active', b.dataset.tab === tabName); });
        if (investigator && tabName === 'relays') renderRelays();
        if (investigator && tabName === 'export') renderExport();
    }

    // ── Helper: inject a newly boosted event ──
    window.injectBoostedEvent = function(event) {
        if (!investigator || !investigator.eventMap) return;
        if (!eventMap.has(event.id)) {
            eventMap.set(event.id, event);
            allEvents.push(event);
            investigator.eventMap.set(event.id, event);
            investigator.events.push(event);
        }
        if (investigator) {
            renderThread(investigator);
            renderTimeline(investigator);
            renderStats(investigator);
            renderJson(investigator);
        }
    };

    // ── Global window functions ─────────
    window._expandThread = (eventId) => { threadCollapsed.delete(eventId); if (investigator) renderThread(investigator); };
    window._expandAll = () => { threadCollapsed.clear(); if (investigator) renderThread(investigator); };
    window._collapseAll = () => { if (investigator) { investigator.eventMap.forEach((_, k) => { if (k !== investigationHexId) threadCollapsed.add(k); }); renderThread(investigator); } };
    window._toggleSortOrder = () => { sortOrder = sortOrder === 'oldest-first' ? 'newest-first' : 'oldest-first'; if (investigator) renderTimeline(investigator); };
    window._inspectEvent = eid => { if (eventMap.has(eid)) showEventModal(eventMap.get(eid)); };
    window._copyEventJson = eid => { if (eventMap.has(eid)) navigator.clipboard.writeText(JSON.stringify(eventMap.get(eid), null, 2)).then(() => showToast('Copied!')); };
    window._downloadEventJson = eid => { if (eventMap.has(eid)) downloadFile(JSON.stringify(eventMap.get(eid), null, 2), `nostr-event-${eid.substring(0,12)}.json`); };
    window._copyAllJson = () => { if (allEvents.length) navigator.clipboard.writeText(JSON.stringify(allEvents, null, 2)).then(() => showToast('Copied!')); };
    window._downloadAllJson = () => exportJSON('all');
    window._toggleJsonBlock = el => { const b = el.nextElementSibling; if (b?.classList.contains('json-block-content')) { const hidden = b.style.display === 'none'; b.style.display = hidden ? 'block' : 'none'; el.textContent = el.textContent.replace(hidden ? '▸' : '▾', hidden ? '▾' : '▸'); } };
    window._searchJson = q => { const c = document.getElementById('jsonAll'); if (!c) return; c.querySelectorAll('.json-block-content').forEach(b => { if (!q) { b.style.display = 'none'; b.previousElementSibling && (b.previousElementSibling.textContent = b.previousElementSibling.textContent.replace('▾', '▸')); } else if (b.textContent.toLowerCase().includes(q.toLowerCase())) { b.style.display = 'block'; b.previousElementSibling && (b.previousElementSibling.textContent = b.previousElementSibling.textContent.replace('▸', '▾')); } }); };
    window._reconnectRelay = async u => { showToast(`Reconnecting ${u}...`); if (relayManager) { await relayManager.reconnect(u); renderRelays(); showToast('Reconnected'); } };
    window._removeRelay = u => { activeRelays = activeRelays.filter(r => r !== u); if (relayManager) relayManager.relayUrls = activeRelays; renderRelays(); showToast('Relay removed'); };
    window._addCustomRelay = () => { const url = prompt('Enter relay WebSocket URL:'); if (url && url.startsWith('ws') && !activeRelays.includes(url)) { activeRelays.push(url); if (relayManager) relayManager.relayUrls = activeRelays; renderRelays(); showToast('Relay added'); } else if (url && activeRelays.includes(url)) showToast('Already in list'); else if (url) showToast('Invalid URL'); };
    window._exportJSON = exportJSON;
    window._exportCSV = exportCSV;
    window._exportMarkdown = exportMarkdown;
    window._exportHTML = exportHTML;
    window.runAnalysis = runAnalysis;

    // ── Main analysis flow (with debounce) ──
    let pendingRender = null;
    function debouncedRender(inv) {
        if (pendingRender) clearTimeout(pendingRender);
        pendingRender = setTimeout(() => {
            renderAll(inv);
            pendingRender = null;
        }, 100);
    }

    async function runAnalysis(inputValue) {
        const input = inputValue || homeSearchInput.value.trim();
        if (!input) { showError('Please enter an event or user identifier.'); return; }
        hideError();
        const parsed = parseInput(input);
        if (parsed.error) { showError(parsed.error); showToast(parsed.error, 'error'); return; }
        if (parsed.pubkey) {
            await investigateUser(parsed.pubkey, parsed.relayHints || []);
            return;
        }
        investigationHexId = parsed.hexId;
        window._investigationHexId = investigationHexId;
        allEvents = []; originalEvent = null; eventMap.clear(); threadCollapsed.clear(); sortOrder = 'oldest-first'; relayStats.clear();
        const allUrls = [...new Set([...activeRelays, ...(parsed.relayHints || [])])];
        relayManager = new RelayManager(allUrls);
        window._relayManager = relayManager;
        investigator = new EventInvestigator(relayManager);
        investigator.onUpdate = inv => debouncedRender(inv);
        investigator.onComplete = inv => {
            debouncedRender(inv);
            hideLoading();
            resultsScreen.classList.add('active');
            homeScreen.classList.remove('active');
            switchTab('thread');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            saveInvestigationState('event', investigationHexId);
        };
        await investigator.investigate(parsed.hexId, parsed.relayHints || []);
    }

    function renderAll(inv) {
        allEvents = inv.events; originalEvent = inv.originalEvent; eventMap = inv.eventMap; investigationHexId = inv.hexId;
        window._originalEvent = originalEvent; window._investigationHexId = investigationHexId;
        if (allEvents.length === 0 && !originalEvent) { resultsScreen.classList.remove('active'); homeScreen.classList.add('active'); return; }
        resultsScreen.classList.add('active'); homeScreen.classList.remove('active');
        renderThread(inv); renderTimeline(inv); renderStats(inv); renderJson(inv); renderRelays(); renderExport(); renderBch(inv);
    }

    // ── Init after DOM ready ───────────
    function initApp() {
        if (typeof NostrTools !== 'undefined') {
            if (loadLogin()) {
                updateUserUI();
                // Show a welcome back toast only if the login was actually restored
                if (currentUser) {
                    const npub = npubFromHex(currentUser.publicKey).substring(0, 12) + '...';
                    showToast('Welcome back, ' + npub, 'info');
                }
            }
        } else {
            setTimeout(initApp, 200);
            return;
        }

        // Bind event listeners
        homeAnalyzeBtn?.addEventListener('click', () => runAnalysis());
        homeClearBtn?.addEventListener('click', () => { homeSearchInput && (homeSearchInput.value = ''); hideError(); });
        homeSearchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });
        homeLoginBtn?.addEventListener('click', showLoginModal);
        homeLogoutBtn?.addEventListener('click', logout);
        homeAccountBtn?.addEventListener('click', showAccountModal);
        resultsBackBtn?.addEventListener('click', () => { resultsScreen.classList.remove('active'); homeScreen.classList.add('active'); homeSearchInput.value = ''; hideError(); });
        resultsLoginBtn?.addEventListener('click', showLoginModal);
        resultsAccountBtn?.addEventListener('click', showAccountModal);
        if (bottomNav) {
            bottomNav.addEventListener('click', e => {
                const btn = e.target.closest('.nav-btn');
                if (btn) switchTab(btn.dataset.tab);
            });
        }

        DEFAULT_RELAYS.forEach(u => relayStats.set(u, { status: 'pending', events: 0, errors: 0, responseTime: null }));

        // Auto‑restore the last investigation if any
        loadSavedInvestigation();

        console.log('🔍 NostrScope ready — session persistent & auto‑resume.');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
    else initApp();
})();
