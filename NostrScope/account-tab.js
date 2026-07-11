(function() {
    console.log('📄 account-tab.js loaded');

    // Ensure global safeToast helper
    if (typeof window._safeToast !== 'function') {
        window._safeToast = function(msg, type) {
            if (typeof window.showToast === 'function') window.showToast(msg, type);
            else console.log('[Toast]', msg);
        };
    }

    // ── Fetch events by kind for a pubkey ──
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

    // ── Load all tabs content ──
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

    // ── Render the full account modal with tabs ──
    function renderAccountModal(notes, articles, media) {
        const cachedProfile = window._cachedProfile ? window._cachedProfile() : null;
        const profile = cachedProfile ? cachedProfile.profile || {} : {};
        let badges = (profile.tags && Array.isArray(profile.tags)) ? [...profile.tags] : [];
        if (cachedProfile && cachedProfile.profileEvent && cachedProfile.profileEvent.tags) {
            const tTags = cachedProfile.profileEvent.tags.filter(t => t[0] === 't' && t[1]).map(t => t[1]);
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

        let html = `<div class="modal-backdrop" id="accountModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10000;">
        <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:20px;max-width:500px;width:95%;max-height:85vh;overflow-y:auto;color:#e7e9ea;">
            <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('accountModalBackdrop').remove();">✕</button>
            <h3>👤 My Account</h3>
            <div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="btn btn-sm btn-outline account-tab active" data-tab="profile">Profile</button>
                <button class="btn btn-sm btn-outline account-tab" data-tab="notes">Notes (${notes.length})</button>
                <button class="btn btn-sm btn-outline account-tab" data-tab="articles">Articles (${articles.length})</button>
                <button class="btn btn-sm btn-outline account-tab" data-tab="media">Media (${media.length})</button>
            </div>
            <div id="accountTabProfile">
                <p><strong>Public Key:</strong> <code style="font-size:0.7rem;word-break:break-all;">${currentUser.publicKey}</code></p>
                <p><strong>npub:</strong> <code>${npubFromHex(currentUser.publicKey)}</code></p><hr/>`;
        for (const [key, val] of Object.entries(fields)) {
            html += `<label>${key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:</label><br/><input type="text" id="edit_${key}" value="${escapeHtml(val)}" style="width:100%;margin-bottom:8px;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;"/><br/>`;
        }
        html += `<div style="margin-top:8px;"><strong>Badges:</strong> ${badges.length ? badges.map(t => `<span class="badge badge-blue">${escapeHtml(t)}</span>`).join(' ') : 'none'}</div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-primary" id="saveProfileBtn">💾 Save</button>
                    <button class="btn btn-outline btn-sm" id="refreshProfileBtn">🔄 Refresh</button>
                </div>
                <details style="margin-top:12px;"><summary>📄 Full JSON</summary><div class="json-viewer" style="max-height:200px;margin-top:8px;background:#000;padding:8px;border-radius:8px;font-size:0.75rem;">${syntaxHighlight(jsonStr)}</div></details>
            </div>
            <div id="accountTabNotes" style="display:none;">${renderEventList(notes, 'Notes')}</div>
            <div id="accountTabArticles" style="display:none;">${renderEventList(articles, 'Articles')}</div>
            <div id="accountTabMedia" style="display:none;">${renderEventList(media, 'Media')}</div>
        </div></div>`;

        modalContainer.innerHTML = html;

        // Tab switching
        modalContainer.querySelectorAll('.account-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                modalContainer.querySelectorAll('.account-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                ['profile', 'notes', 'articles', 'media'].forEach(t => {
                    const el = document.getElementById('accountTab' + t.charAt(0).toUpperCase() + t.slice(1));
                    if (el) el.style.display = t === tab ? 'block' : 'none';
                });
            });
        });

        // Save profile
        document.getElementById('saveProfileBtn').addEventListener('click', () => {
            const newProfile = {};
            for (const key of Object.keys(fields)) {
                const val = document.getElementById('edit_' + key)?.value?.trim();
                if (val) newProfile[key] = val;
            }
            if (badges.length) newProfile.tags = badges;
            const event = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(newProfile) };
            if (typeof window._signNostrEvent !== 'function') { window._safeToast('Signing not available.', 'error'); return; }
            window._signNostrEvent(event, currentUser.privateKey).then(signed => {
                if (relayManager) relayManager.publish(signed);
                if (window._setCachedProfile) window._setCachedProfile({ ...cachedProfile, profile: newProfile });
                try { localStorage.setItem('nostrscope_profile', JSON.stringify(newProfile)); } catch (e) {}
                window._safeToast('Profile updated!', 'success');
            }).catch(e => window._safeToast('Error: ' + e.message, 'error'));
        });

        // Refresh
        document.getElementById('refreshProfileBtn').addEventListener('click', () => {
            document.getElementById('accountModalBackdrop')?.remove();
            loadAccountTabs();
        });
    }

    // ── Render a list of events ──
    function renderEventList(events, title) {
        if (!events.length) return `<p>No ${title.toLowerCase()} found.</p>`;
        return events.map(e => {
            const kindName = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`;
            const time = new Date((e.created_at || 0) * 1000).toLocaleString();
            const boostBtn = (typeof isLoggedIn === 'function' && isLoggedIn())
                ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${e.id}','${e.pubkey}','${e.kind}')">🚀 Boost</button>`
                : '';
            return `<div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin:8px 0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="badge badge-purple">${kindName}</span>
                    <span style="font-size:0.7rem;color:#71767b;">${time}</span>
                </div>
                <div style="margin-top:6px;font-size:0.85rem;">${escapeHtml((e.content || '').substring(0, 200))}</div>
                <div style="margin-top:8px;display:flex;gap:6px;">
                    ${boostBtn}
                    <button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">JSON</button>
                </div>
            </div>`;
        }).join('');
    }

    // ── Override global showAccountModal ──
    window.showAccountModal = function(forceRefresh) {
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }
        loadAccountTabs();
    };

    console.log('✅ account-tab.js ready, showAccountModal defined:', typeof window.showAccountModal);
})();
