(function() {
    console.log('📄 account-tab.js loaded (enhanced)');

    // Safe toast helper
    if (typeof window._safeToast !== 'function') {
        window._safeToast = function(msg, type) {
            if (typeof window.showToast === 'function') window.showToast(msg, type);
            else console.log('[Toast]', msg);
        };
    }

    // ── Fetch events by kind ──
    async function fetchUserEvents(pubkey, kinds, limit = 50) {
        const relays = activeRelays.slice(0, 5);
        const rm = new RelayManager(relays);
        const events = [];
        try {
            await rm.connectAll(5000);
            const subId = rm.subscribe([{ kinds, authors: [pubkey], limit }]);
            rm.onEvent = (ev) => { if (kinds.includes(ev.kind)) events.push(ev); };
            await new Promise(resolve => {
                rm.onEOSE = (sid) => { if (sid === subId) { rm.closeSubscription(subId); resolve(); } };
                setTimeout(resolve, 8000);
            });
        } catch (e) { console.error('fetchUserEvents error:', e); }
        return events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    // ── Load all tabs ──
    async function loadAccountTabs() {
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }
        showLoading('Loading your content…');
        try {
            const notes = await fetchUserEvents(currentUser.publicKey, [1]);
            const articles = await fetchUserEvents(currentUser.publicKey, [30023]);
            const mediaKinds = [30311, 1311, 30024];
            const media = await fetchUserEvents(currentUser.publicKey, mediaKinds);
            renderAccountModal(notes, articles, media);
        } catch (e) {
            console.error(e);
            window._safeToast('Failed to load content.', 'error');
        } finally {
            hideLoading();
        }
    }

    // ── Render the entire account modal ──
    function renderAccountModal(notes, articles, media) {
        const mc = window.modalContainer;
        if (!mc) {
            window._safeToast('UI error. Please refresh.', 'error');
            return;
        }

        const cachedProfile = window._cachedProfile ? window._cachedProfile() : null;
        const profile = cachedProfile ? cachedProfile.profile || {} : {};
        let badges = (profile.tags && Array.isArray(profile.tags)) ? [...profile.tags] : [];
        if (cachedProfile && cachedProfile.profileEvent && cachedProfile.profileEvent.tags) {
            const tTags = cachedProfile.profileEvent.tags.filter(t => t[0] === 't' && t[1]).map(t => t[1]);
            badges = [...new Set([...badges, ...tTags])];
        }

        let html = `<div class="modal-backdrop" id="accountModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10000;">
        <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:20px;max-width:550px;width:95%;max-height:85vh;overflow-y:auto;color:#e7e9ea;">
            <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('accountModalBackdrop').remove();">✕</button>
            <h3>👤 My Account</h3>
            <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-outline account-tab active" data-tab="profile">Profile</button>
                <button class="btn btn-sm btn-outline account-tab" data-tab="notes">Notes (${notes.length})</button>
                <button class="btn btn-sm btn-outline account-tab" data-tab="articles">Articles (${articles.length})</button>
                <button class="btn btn-sm btn-outline account-tab" data-tab="media">Media (${media.length})</button>
            </div>
            <div id="accountTabProfile">${renderProfileTab(profile, badges, cachedProfile)}</div>
            <div id="accountTabNotes" style="display:none;">${renderEventList(notes, 'Notes')}</div>
            <div id="accountTabArticles" style="display:none;">${renderEventList(articles, 'Articles')}</div>
            <div id="accountTabMedia" style="display:none;">${renderEventList(media, 'Media')}</div>
        </div></div>`;

        mc.innerHTML = html;

        // Tab switching
        mc.querySelectorAll('.account-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                mc.querySelectorAll('.account-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                ['profile', 'notes', 'articles', 'media'].forEach(t => {
                    const el = document.getElementById('accountTab' + t.charAt(0).toUpperCase() + t.slice(1));
                    if (el) el.style.display = t === tab ? 'block' : 'none';
                });
            });
        });

        // Attach profile edit button
        const editBtn = document.getElementById('editProfileMetadataBtn');
        if (editBtn) editBtn.addEventListener('click', () => openProfileEditPopup(profile));

        // Attach save handlers etc. (profile save is now in popup)
    }

    // ── Profile tab: show metadata in a table ──
    function renderProfileTab(profile, badges, cachedProfile) {
        const fields = [
            { key: 'name', label: 'Name' },
            { key: 'about', label: 'About' },
            { key: 'picture', label: 'Picture' },
            { key: 'banner', label: 'Banner' },
            { key: 'nip05', label: 'NIP-05' },
            { key: 'bch_address', label: 'BCH Address' },
            { key: 'bch_tip_wallet', label: 'BCH Tip Wallet' },
        ];

        let rows = '';
        fields.forEach(f => {
            const val = profile[f.key] || '';
            rows += `<tr><td style="color:#71767b;font-weight:600;white-space:nowrap;vertical-align:top;padding-right:10px;">${f.label}</td><td style="word-break:break-word;">${escapeHtml(val) || '<span style="color:#444;">—</span>'}</td></tr>`;
        });

        // Badges
        rows += `<tr><td style="color:#71767b;font-weight:600;white-space:nowrap;padding-right:10px;">Badges</td><td>${badges.length ? badges.map(t => `<span class="badge badge-blue">${escapeHtml(t)}</span>`).join(' ') : '<span style="color:#444;">—</span>'}</td></tr>`;

        return `
            <div>
                <p><strong>Public Key:</strong> <code style="font-size:0.7rem;word-break:break-all;">${currentUser.publicKey}</code></p>
                <p><strong>npub:</strong> <code>${npubFromHex(currentUser.publicKey)}</code></p>
                <table style="width:100%;border-collapse:collapse;margin-top:12px;">${rows}</table>
                <div style="margin-top:12px;display:flex;gap:8px;">
                    <button class="btn btn-primary btn-sm" id="editProfileMetadataBtn">✏️ Edit Metadata</button>
                </div>
            </div>`;
    }

    // ── Open popup to edit profile JSON ──
    function openProfileEditPopup(profile) {
        const jsonStr = JSON.stringify(profile, null, 2);
        const popupHtml = `
        <div class="modal-backdrop" id="profileEditBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10001;">
            <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:20px;max-width:500px;width:95%;color:#e7e9ea;">
                <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('profileEditBackdrop').remove();">✕</button>
                <h3>Edit Profile JSON</h3>
                <textarea id="profileJsonEditor" style="width:100%;height:300px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;font-family:monospace;font-size:0.85rem;padding:8px;border-radius:8px;">${escapeHtml(jsonStr)}</textarea>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-primary" id="saveProfileJsonBtn">💾 Save</button>
                    <button class="btn btn-outline" onclick="document.getElementById('profileEditBackdrop').remove();">Cancel</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', popupHtml);
        document.getElementById('saveProfileJsonBtn').addEventListener('click', async () => {
            const newJson = document.getElementById('profileJsonEditor').value.trim();
            let newProfile;
            try {
                newProfile = JSON.parse(newJson);
            } catch (e) {
                window._safeToast('Invalid JSON.', 'error');
                return;
            }
            const event = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(newProfile) };
            if (typeof window._signNostrEvent !== 'function') { window._safeToast('Signing not available.', 'error'); return; }
            try {
                const signed = await window._signNostrEvent(event, currentUser.privateKey);
                if (relayManager) relayManager.publish(signed);
                if (window._setCachedProfile) window._setCachedProfile({ profile: newProfile, profileEvent: null });
                try { localStorage.setItem('nostrscope_profile', JSON.stringify(newProfile)); } catch (e) {}
                window._safeToast('Profile updated!', 'success');
                document.getElementById('profileEditBackdrop').remove();
                // Reload the account modal to reflect changes
                document.getElementById('accountModalBackdrop')?.remove();
                loadAccountTabs();
            } catch (e) {
                window._safeToast('Error: ' + e.message, 'error');
            }
        });
    }

    // ── Render a list of events (notes/articles/media) with formatting ──
    function renderEventList(events, title) {
        if (!events.length) return `<p style="color:#71767b;">No ${title.toLowerCase()} found.</p>`;
        return events.map(e => renderSingleEvent(e)).join('');
    }

    function renderSingleEvent(ev) {
        const kindName = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
        const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
        const boostBtn = (typeof isLoggedIn === 'function' && isLoggedIn())
            ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${ev.id}','${ev.pubkey}','${ev.kind}')">🚀 Boost</button>`
            : '';

        let contentHtml = '';
        if (ev.kind === 1) {
            // Text note: render content with media and links
            const { text, media } = renderMediaFromContent(ev.content);
            contentHtml = text + (media ? `<div class="post-media">${media}</div>` : '');
        } else if (ev.kind === 30023) {
            // Article: parse content JSON
            try {
                const article = JSON.parse(ev.content);
                const title = article.title || 'Untitled';
                const summary = article.summary || '';
                const image = article.image || '';
                const body = article.content || '';
                contentHtml = `<strong>${escapeHtml(title)}</strong>`;
                if (image) contentHtml += `<div><img src="${image}" alt="Article image" style="max-width:100%;max-height:200px;border-radius:8px;margin:8px 0;"></div>`;
                if (summary) contentHtml += `<p style="margin:4px 0;font-size:0.9rem;">${escapeHtml(summary)}</p>`;
                if (body) {
                    const truncated = body.length > 300 ? body.substring(0, 300) + '…' : body;
                    contentHtml += `<div style="margin-top:4px;font-size:0.85rem;white-space:pre-wrap;">${escapeHtml(truncated)}</div>`;
                }
            } catch (e) {
                contentHtml = `<pre style="white-space:pre-wrap;">${escapeHtml(ev.content.substring(0, 300))}</pre>`;
            }
        } else {
            // Media / other: show content preview
            contentHtml = `<pre style="white-space:pre-wrap;font-size:0.8rem;">${escapeHtml(ev.content.substring(0, 300))}</pre>`;
        }

        return `
        <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:12px;margin:8px 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span class="badge badge-purple">${kindName}</span>
                <span style="font-size:0.7rem;color:#71767b;">${time}</span>
            </div>
            <div style="font-size:0.9rem;line-height:1.5;word-break:break-word;">${contentHtml}</div>
            <div style="margin-top:10px;display:flex;gap:6px;">
                ${boostBtn}
                <button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${ev.id}')">JSON</button>
            </div>
        </div>`;
    }

    // ── Override global showAccountModal ──
    window.showAccountModal = function(forceRefresh) {
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }
        loadAccountTabs();
    };

    console.log('✅ account-tab.js enhanced ready');
})();
