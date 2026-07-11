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
        } catch (e) { 
            console.error('Profile fetch error:', e);
            // Don't block - profile fetch is optional
        }
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
            <div class="modal-backdrop" id="loginModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000;">
                <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:24px;max-width:360px;width:90%;max-height:80vh;overflow-y:auto;color:#e7e9ea;">
                    <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('loginModalBackdrop').remove();">✕</button>
                    <h3 style="margin-bottom:16px;">🔐 Login with nsec</h3>
                    <div style="color:#f4212e;font-size:0.75rem;margin-bottom:12px;">⚠️ Your private key never leaves this browser.</div>
                    <input type="password" id="nsecInput" placeholder="nsec1..." autocomplete="off" style="width:100%;padding:12px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-size:0.9rem;margin-bottom:16px;">
                    <div style="display:flex;gap:12px;">
                        <button class="btn btn-primary" id="loginConfirmBtn" style="flex:1;padding:10px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Login</button>
                        <button class="btn btn-outline" id="loginCancelBtn" style="flex:1;padding:10px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;">Cancel</button>
                    </div>
                </div>
            </div>`;
        
        modalContainer.innerHTML = modalHTML;
        
        const backdrop = document.getElementById('loginModalBackdrop');
        const nsecInput = document.getElementById('nsecInput');
        const confirmBtn = document.getElementById('loginConfirmBtn');
        const cancelBtn = document.getElementById('loginCancelBtn');
        
        if (!backdrop || !nsecInput || !confirmBtn || !cancelBtn) {
            console.error('Failed to create login modal elements');
            return;
        }
        
        cancelBtn.addEventListener('click', () => {
            console.log('Login cancelled');
            backdrop.remove();
        });
        
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
            }
        });
        
        confirmBtn.addEventListener('click', async () => {
            const nsec = nsecInput.value.trim();
            console.log('Login attempt with nsec length:', nsec.length);
            
            if (!nsec) {
                showToast('Please enter your nsec key.', 'error');
                return;
            }
            
            let privateKey;
            
            try {
                const { type, data } = NostrTools.nip19.decode(nsec);
                if (type !== 'nsec') throw new Error('Not an nsec');
                privateKey = typeof data === 'string' ? data : bytesToHex(data);
                console.log('Decoded via nip19');
            } catch (nip19Error) {
                console.warn('nip19 decode failed, trying manual bech32');
                const decoded = bech32Decode(nsec);
                if (!decoded || decoded.hrp !== 'nsec' || decoded.bytes.length !== 32) {
                    showToast('Invalid nsec format. Please check your key.', 'error');
                    return;
                }
                privateKey = bytesToHex(decoded.bytes);
                console.log('Decoded via manual bech32');
            }
            
            if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
                showToast('Invalid private key format.', 'error');
                return;
            }
            
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
            
            // Load cached profile if available
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) {
                try { 
                    cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; 
                } catch (e) {
                    cachedProfile = null;
                }
            }
            
            const npub = npubFromHex(publicKey);
            showToast('✅ Logged in as ' + npub.substring(0, 12) + '...', 'success');
            console.log('✅ Login successful');
            
            // Close modal
            backdrop.remove();
            
            // Update UI
            renderMyProfile();
            
            // Try to fetch profile in background (don't block)
            setTimeout(() => fetchAndCacheProfile(), 500);
            
            // Refresh feed to show boost buttons
            if (feedScreen && feedScreen.classList.contains('active') && typeof loadFeed === 'function') {
                setTimeout(() => loadFeed(), 300);
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
        
        let html = `<div class="modal-backdrop" id="accountModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000;">
        <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:24px;max-width:360px;width:90%;max-height:80vh;overflow-y:auto;color:#e7e9ea;">
            <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.5rem;cursor:pointer;" onclick="document.getElementById('accountModalBackdrop').remove();">✕</button>
            <h3>👤 My Account</h3>
            <p><strong>Public Key:</strong> <code style="font-size:0.7rem;word-break:break-all;">${currentUser.publicKey}</code></p>
            <p><strong>npub:</strong> <code>${npubFromHex(currentUser.publicKey)}</code></p><hr/>`;
        
        for (const [key, val] of Object.entries(fields)) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            html += `<label>${label}:</label><br/><input type="text" id="edit_${key}" value="${escapeHtml(val)}" style="width:100%;margin-bottom:8px;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;"/><br/>`;
        }
        
        html += `<div style="margin-top:8px;"><strong>Badges:</strong> ${badges.length > 0 ? badges.map(t => `<span class="badge badge-blue">${escapeHtml(t)}</span>`).join(' ') : '<span style="color:var(--text2);">none</span>'}</div>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn btn-primary" id="saveProfileBtn" style="padding:10px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">💾 Save</button>
            <button class="btn btn-outline" id="refreshProfileBtn" style="padding:10px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;">🔄 Refresh</button>
        </div><hr/>
        <details style="margin-top:12px;"><summary style="cursor:pointer;color:#1d9bf0;">📄 Full JSON</summary>
        <div class="json-viewer" style="max-height:200px;margin-top:8px;background:#000;padding:8px;border-radius:8px;font-size:0.75rem;">${syntaxHighlight(jsonStr)}</div></details>
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
                <p style="margin-bottom:12px;color:#71767b;">You are not logged in.</p>
                <button class="btn btn-primary" id="loginFromProfileBtn" style="padding:10px 20px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">🔑 Login</button>
            </div>`;
            document.getElementById('loginFromProfileBtn')?.addEventListener('click', showLoginModal);
            return;
        }
        if (!cachedProfile) {
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) { try { cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; } catch (e) { cachedProfile = null; } }
            if (!cachedProfile) {
                profileContent.innerHTML = '<p style="padding:20px;color:#71767b;">Loading profile…</p>';
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
                <div style="width:60px;height:60px;border-radius:50%;background:#1d1f23;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                    ${picture ? `<img src="${picture}" style="width:100%;height:100%;object-fit:cover;">` : '👤'}
                </div>
                <div>
                    <h3 style="font-size:1.2rem;margin:0;color:#e7e9ea;">${escapeHtml(name || 'Unnamed')}</h3>
                    <p style="color:#71767b;font-size:0.8rem;margin:4px 0 0 0;">@${npub.substring(0,12)}...</p>
                </div>
            </div>
            ${about ? `<p style="margin-bottom:16px;color:#e7e9ea;">${escapeHtml(about)}</p>` : ''}
            <div style="display:flex;gap:8px;">
                <button class="btn" id="editProfileBtn" style="padding:8px 16px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;">Edit Profile</button>
                <button class="btn" id="logoutProfileBtn" style="padding:8px 16px;background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;font-weight:600;cursor:pointer;">Logout</button>
            </div>
        </div>`;
        document.getElementById('editProfileBtn')?.addEventListener('click', () => showAccountModal());
        document.getElementById('logoutProfileBtn')?.addEventListener('click', logout);
    }

    // ── Event listeners ──
    function bindEvents() {
        console.log('Binding events...');
        
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', () => runAnalysis());
        }
        
        if (searchInput) {
            searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });
        }
        
        if (analysisBackBtn) {
            analysisBackBtn.addEventListener('click', () => switchScreen('feed'));
        }
        
        if (refreshFeedBtn) {
            refreshFeedBtn.addEventListener('click', () => { if (typeof refreshNewPosts === 'function') refreshNewPosts(); });
        }
        
        if (feedLoginBtn) {
            feedLoginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showLoginModal();
            });
            feedLoginBtn.onclick = () => { showLoginModal(); return false; };
        }
        
        if (feedAccountBtn) {
            feedAccountBtn.addEventListener('click', () => showAccountModal());
        }
    }

    // ── Init ──
    function initApp() {
        console.log('🚀 Initializing NostrScope...');
        
        if (typeof NostrTools === 'undefined') {
            setTimeout(initApp, 500);
            return;
        }
        
        // Restore session
        if (loadLogin()) {
            updateUserUI();
            const cached = localStorage.getItem('nostrscope_profile');
            if (cached) { try { cachedProfile = { profile: JSON.parse(cached), profileEvent: null }; } catch (e) { cachedProfile = null; } }
        }
        
        if (CONFIG && CONFIG.relays) {
            CONFIG.relays.forEach(u => relayStats.set(u, { status: 'pending', events: 0, errors: 0, responseTime: null }));
        }
        
        bindEvents();
        switchScreen('feed');
        
        console.log('✅ NostrScope ready');
    }

    // Expose functions globally
    window.showLoginModal = showLoginModal;
    window.showAccountModal = showAccountModal;
    window.isLoggedIn = isLoggedIn;
    window.logout = logout;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
