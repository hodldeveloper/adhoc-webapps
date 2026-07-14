(function () {
    console.log('📄 account-tab.js loaded (collapsible table with kind tabs + article editor)');

    // ── Fetch and cache the kind registry ──
    let KIND_REGISTRY = null;
    let kindRegistryLoaded = false;
    const REGISTRY_URL = 'https://raw.githubusercontent.com/nostr-protocol/registry-of-kinds/refs/heads/master/schema.yaml';
    const REGISTRY_CACHE_KEY = 'nostrscope_kind_registry';
    const REGISTRY_CACHE_TTL = 24 * 60 * 60 * 1000;

    // ── Cache Keys ──
    const CACHE_KEYS = {
        PROFILE: 'nostrscope_account_profile',
        KIND_COUNTS: 'nostrscope_kind_counts',
        KIND_DATA: 'nostrscope_kind_data_',
        TIMESTAMP: 'nostrscope_account_timestamp',
        PUBKEY: 'nostrscope_account_pubkey',
        NOTIFICATIONS: 'nostrscope_notifications'
    };

    // ── Pagination settings ──
    const PAGE_SIZE = 10;
    let isScanning = false;
    const ACCOUNT_CACHE_TTL = 30 * 60 * 1000;
    const QUICK_SCAN_KINDS = [0, 1, 3, 6, 7, 9734, 9735, 10002, 1808, 30023, 30078, 30311, 1311, 30024];

    // ── Mini player state ──
    let currentAudio = null;
    let currentTrack = null;
    let miniPlayerInitialized = false;

    async function loadKindRegistry() {
        try {
            const cached = localStorage.getItem(REGISTRY_CACHE_KEY);
            if (cached) {
                const data = JSON.parse(cached);
                if (Date.now() - data.timestamp < REGISTRY_CACHE_TTL) {
                    KIND_REGISTRY = data.registry;
                    kindRegistryLoaded = true;
                    console.log('📦 Kind registry loaded from cache');
                    return;
                }
            }
        } catch (e) { }

        try {
            const response = await fetch(REGISTRY_URL);
            if (!response.ok) throw new Error('Failed to fetch registry');
            const yamlText = await response.text();
            KIND_REGISTRY = parseKindRegistry(yamlText);
            kindRegistryLoaded = true;
            try {
                localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    registry: KIND_REGISTRY
                }));
            } catch (e) { }
            console.log('✅ Kind registry loaded from network');
        } catch (e) {
            console.error('Error loading kind registry:', e);
            if (!KIND_REGISTRY) {
                KIND_REGISTRY = getFallbackRegistry();
                kindRegistryLoaded = true;
            }
        }
    }

    function parseKindRegistry(yamlText) {
        const registry = {};
        const lines = yamlText.split('\n');
        let currentKind = null;
        let inKindSection = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('_')) continue;

            const kindMatch = trimmed.match(/^(\d+):\s*$/);
            if (kindMatch) {
                currentKind = parseInt(kindMatch[1]);
                registry[currentKind] = {
                    name: `Kind ${currentKind}`,
                    description: '',
                    in_use: false,
                    category: 'Regular',
                    nip: '',
                    purpose: ''
                };
                inKindSection = true;
                continue;
            }

            if (inKindSection && currentKind !== null) {
                const descMatch = trimmed.match(/^description:\s*(.+)$/);
                if (descMatch) {
                    registry[currentKind].description = descMatch[1];
                    continue;
                }
                const inUseMatch = trimmed.match(/^in_use:\s*(true|false)$/);
                if (inUseMatch) {
                    registry[currentKind].in_use = inUseMatch[1] === 'true';
                    continue;
                }
            }
        }

        for (const kind in registry) {
            const k = registry[kind];
            if (!k.name || k.name === `Kind ${kind}`) {
                k.name = k.description || `Kind ${kind}`;
            }
            if (!k.purpose) {
                k.purpose = k.description || '';
            }
            if (!k.nip) {
                k.nip = 'NIP-??';
            }
            if (parseInt(kind) >= 30000 && parseInt(kind) < 40000) {
                k.category = 'Addressable';
            } else if (parseInt(kind) >= 10000 && parseInt(kind) < 20000) {
                k.category = 'Replaceable';
            } else {
                k.category = 'Regular';
            }
        }
        return registry;
    }

    function getFallbackRegistry() {
        return {
            0: { name: "Profile Metadata", nip: "NIP-01", category: "Replaceable", purpose: "User profile information", in_use: true },
            1: { name: "Short Text Note", nip: "NIP-01", category: "Regular", purpose: "Text notes / posts", in_use: true },
            3: { name: "Contact List", nip: "NIP-02", category: "Replaceable", purpose: "Following list / petnames", in_use: true },
            4: { name: "Encrypted DM", nip: "NIP-04", category: "Regular", purpose: "Encrypted direct messages (legacy)", in_use: true },
            5: { name: "Event Deletion", nip: "NIP-09", category: "Regular", purpose: "Deletion request", in_use: true },
            6: { name: "Repost", nip: "NIP-18", category: "Regular", purpose: "Repost / boost", in_use: true },
            7: { name: "Reaction", nip: "NIP-25", category: "Regular", purpose: "Like / emoji reaction", in_use: true },
            9734: { name: "Zap Request", nip: "NIP-57", category: "Regular", purpose: "Lightning zap request", in_use: true },
            9735: { name: "Zap Receipt", nip: "NIP-57", category: "Regular", purpose: "Proof of payment", in_use: true },
            10002: { name: "Relay List", nip: "NIP-65", category: "Replaceable", purpose: "Preferred relay list", in_use: true },
            30023: { name: "Long-form Article", nip: "NIP-23", category: "Addressable", purpose: "Blog / long-form article", in_use: true },
            30311: { name: "Live Event", nip: "NIP-53", category: "Addressable", purpose: "Live streaming event", in_use: true },
            27235: { name: "HTTP Auth", nip: "NIP-98", category: "Regular", purpose: "HTTP authentication", in_use: true },
            1808: { name: "Audio Header", nip: "NIP-??", category: "Regular", purpose: "Audio track with cover art", in_use: true },
            30078: { name: "Application Data", nip: "NIP-78", category: "Addressable", purpose: "App-specific data", in_use: true },
        };
    }

    function getCachedData(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch { return null; }
    }

    function setCachedData(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch { }
    }

    function getCachedKindData(pubkey, kind) {
        const key = CACHE_KEYS.KIND_DATA + pubkey + '_' + kind;
        const data = getCachedData(key);
        if (data) {
            const age = Date.now() - data.timestamp;
            if (age < 5 * 60 * 1000) {
                return data.events;
            }
        }
        return null;
    }

    function setCachedKindData(pubkey, kind, events) {
        const key = CACHE_KEYS.KIND_DATA + pubkey + '_' + kind;
        setCachedData(key, { timestamp: Date.now(), events });
    }

    async function scanKindCounts(pubkey, onProgress) {
        const relays = CONFIG.relays.slice(0, 5);
        const rm = new RelayManager(relays);
        const counts = {};
        const registry = KIND_REGISTRY || getFallbackRegistry();
        const allKinds = Object.keys(registry).map(Number);
        const MAX_SAMPLE = 100;
        let processed = 0;

        try {
            await rm.connectAll(CONFIG.relayConnectTimeout || 5000);

            const chunks = [];
            for (let i = 0; i < allKinds.length; i += 10) {
                chunks.push(allKinds.slice(i, i + 10));
            }

            for (const chunk of chunks) {
                const subId = rm.subscribe([{
                    kinds: chunk,
                    authors: [pubkey],
                    limit: MAX_SAMPLE
                }]);

                await new Promise(resolve => {
                    let resolved = false;

                    rm.onEvent = (ev) => {
                        if (chunk.includes(ev.kind) && ev.pubkey === pubkey) {
                            counts[ev.kind] = (counts[ev.kind] || 0) + 1;
                        }
                    };

                    rm.onEOSE = (sid) => {
                        if (sid === subId && !resolved) {
                            resolved = true;
                            rm.closeSubscription(subId);
                            processed += chunk.length;
                            if (onProgress) onProgress(processed, allKinds.length);
                            resolve();
                        }
                    };

                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            rm.closeSubscription(subId);
                            processed += chunk.length;
                            if (onProgress) onProgress(processed, allKinds.length);
                            resolve();
                        }
                    }, 3000);
                });
            }
        } catch (e) {
            console.error('Scan error:', e);
        }

        allKinds.forEach(kind => {
            if (!counts[kind]) counts[kind] = 0;
        });

        return counts;
    }

    async function scanKindCountsQuick(pubkey) {
        const relays = CONFIG.relays.slice(0, 3);
        const rm = new RelayManager(relays);
        const counts = {};

        try {
            await rm.connectAll(CONFIG.relayConnectTimeout || 5000);
            const subId = rm.subscribe([{
                kinds: QUICK_SCAN_KINDS,
                authors: [pubkey],
                limit: 120
            }]);

            await new Promise(resolve => {
                let done = false;

                rm.onEvent = (ev) => {
                    if (ev.pubkey === pubkey) {
                        counts[ev.kind] = (counts[ev.kind] || 0) + 1;
                    }
                };

                rm.onEOSE = (sid) => {
                    if (sid === subId && !done) {
                        done = true;
                        rm.closeSubscription(subId);
                        resolve();
                    }
                };

                setTimeout(() => {
                    if (!done) {
                        done = true;
                        rm.closeSubscription(subId);
                        resolve();
                    }
                }, 2500);
            });
        } catch (e) {
            console.error('Quick scan error:', e);
        }

        QUICK_SCAN_KINDS.forEach(kind => {
            if (!counts[kind]) counts[kind] = 0;
        });

        return counts;
    }

    async function backgroundScan() {
        if (isScanning) {
            window._safeToast('⏳ Scan already in progress...', 'info');
            return;
        }
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }

        isScanning = true;
        const scanBtn = document.getElementById('scanBtn');
        const scanStatus = document.getElementById('scanStatus');

        if (scanBtn) {
            scanBtn.textContent = '⏳ Scanning...';
            scanBtn.disabled = true;
            scanBtn.style.opacity = '0.6';
        }
        if (scanStatus) {
            scanStatus.style.display = 'block';
            scanStatus.textContent = 'Starting scan...';
        }

        try {
            const newCounts = await scanKindCounts(currentUser.publicKey, (processed, total) => {
                if (scanStatus) {
                    scanStatus.textContent = `Scanning ${processed}/${total} kinds...`;
                }
            });

            updateCountsInTable(newCounts);
            kindCounts = newCounts;
            setCachedData(CACHE_KEYS.KIND_COUNTS + '_' + currentUser.publicKey, {
                counts: kindCounts,
                timestamp: Date.now()
            });

            if (scanStatus) {
                scanStatus.textContent = `✅ Scan complete! ${Object.keys(newCounts).length} kinds checked.`;
                setTimeout(() => {
                    scanStatus.style.display = 'none';
                }, 3000);
            }

            window._safeToast('✅ Counts updated!', 'success');
        } catch (e) {
            console.error('Scan error:', e);
            if (scanStatus) {
                scanStatus.textContent = '❌ Scan failed. Please try again.';
                scanStatus.style.color = '#ff5d79';
            }
            window._safeToast('❌ Scan failed', 'error');
        } finally {
            isScanning = false;
            if (scanBtn) {
                scanBtn.textContent = '🔄 Scan';
                scanBtn.disabled = false;
                scanBtn.style.opacity = '1';
            }
        }
    }

    function updateCountsInTable(newCounts) {
        const table = document.getElementById('kindTableBody');
        if (!table) return;

        const rows = table.querySelectorAll('tr');
        let totalEvents = 0;

        rows.forEach(row => {
            const kindCell = row.querySelector('td:first-child');
            if (!kindCell) return;

            const kind = parseInt(kindCell.textContent.trim());
            if (isNaN(kind)) return;

            const count = newCounts[kind] || 0;
            totalEvents += count;

            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
                const countCell = cells[2];
                const countSpan = countCell.querySelector('.count-value') || document.createElement('span');
                countSpan.className = 'count-value';
                countSpan.style.cssText = `
                    font-weight: ${count > 0 ? '700' : '400'};
                    color: ${count > 0 ? '#e7e9ea' : '#71767b'};
                    transition: all 0.3s ease;
                `;
                countSpan.textContent = count >= 100 ? '100+' : count;

                countSpan.style.transform = 'scale(1.3)';
                countSpan.style.color = '#4da3ff';
                setTimeout(() => {
                    countSpan.style.transform = 'scale(1)';
                    countSpan.style.color = count > 0 ? '#e7e9ea' : '#71767b';
                }, 300);

                if (!countCell.querySelector('.count-value')) {
                    countCell.innerHTML = '';
                    countCell.appendChild(countSpan);
                }

                if (cells.length >= 5) {
                    const openCell = cells[4];
                    openCell.innerHTML = count > 0 ?
                        `<span style="color:#4da3ff;font-size:0.5rem;">↗</span>` :
                        `<span style="color:#71767b;">—</span>`;
                }
            }
        });

        const totalElements = document.querySelectorAll('.total-count');
        totalElements.forEach(el => {
            el.textContent = totalEvents;
        });

        const noteCount = document.querySelector('.stat-notes .stat-value');
        const articleCount = document.querySelector('.stat-articles .stat-value');
        const mediaCount = document.querySelector('.stat-media .stat-value');
        const zapCount = document.querySelector('.stat-zaps .stat-value');

        if (noteCount) noteCount.textContent = newCounts[1] || 0;
        if (articleCount) articleCount.textContent = newCounts[30023] || 0;
        if (mediaCount) {
            const mediaTotal = (newCounts[30311] || 0) + (newCounts[1311] || 0) + (newCounts[30024] || 0);
            mediaCount.textContent = mediaTotal;
        }
        if (zapCount) {
            const zapTotal = (newCounts[9735] || 0) + (newCounts[9734] || 0);
            zapCount.textContent = zapTotal;
        }
    }

    async function fetchKindEvents(pubkey, kind, limit = 100) {
        const relays = CONFIG.relays.slice(0, 5);
        const rm = new RelayManager(relays);
        const events = [];

        try {
            await rm.connectAll(CONFIG.relayConnectTimeout || 5000);
            const subId = rm.subscribe([{
                kinds: [kind],
                authors: [pubkey],
                limit: limit
            }]);

            await new Promise(resolve => {
                rm.onEvent = (ev) => {
                    if (ev.kind === kind && ev.pubkey === pubkey) {
                        if (!events.find(e => e.id === ev.id)) {
                            events.push(ev);
                        }
                    }
                };
                rm.onEOSE = (sid) => {
                    if (sid === subId) {
                        rm.closeSubscription(subId);
                        resolve();
                    }
                };
                setTimeout(resolve, CONFIG.profileInvestigationTimeout || 8000);
            });
        } catch (e) {
            console.error('Fetch kind events error:', e);
        }

        return events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    let notifications = [];
    let notificationBadge = null;

    function loadNotifications() {
        try {
            const data = localStorage.getItem(CACHE_KEYS.NOTIFICATIONS);
            if (data) {
                notifications = JSON.parse(data);
            }
        } catch { }
        updateNotificationBadge();
    }

    function saveNotifications() {
        try {
            localStorage.setItem(CACHE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
        } catch { }
        updateNotificationBadge();
    }

    function updateNotificationBadge() {
        if (!notificationBadge) {
            const container = document.querySelector('.refresh-btn-container');
            if (container) {
                notificationBadge = document.createElement('span');
                notificationBadge.style.cssText = `
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    background: #ff5d79;
                    color: #fff;
                    border-radius: 50%;
                    padding: 2px 6px;
                    font-size: 0.5rem;
                    font-weight: 700;
                    min-width: 16px;
                    text-align: center;
                    border: 2px solid #16181c;
                `;
                container.style.position = 'relative';
                container.appendChild(notificationBadge);
            }
        }
        if (notificationBadge) {
            const count = notifications.filter(n => !n.read).length;
            notificationBadge.textContent = count > 0 ? count : '';
            notificationBadge.style.display = count > 0 ? 'block' : 'none';
        }
    }

    function addNotification(kind, event, message) {
        const registry = KIND_REGISTRY || getFallbackRegistry();
        const kindInfo = registry[kind] || { name: `Kind ${kind}` };
        const existing = notifications.find(n => n.eventId === event.id);
        if (existing) {
            existing.timestamp = Date.now();
            existing.read = false;
        } else {
            notifications.unshift({
                id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                kind: kind,
                eventId: event.id,
                pubkey: event.pubkey,
                content: event.content || '',
                timestamp: Date.now(),
                read: false,
                message: message || `${kindInfo.name} update`,
                created_at: event.created_at
            });
            if (notifications.length > 100) {
                notifications = notifications.slice(0, 100);
            }
        }
        saveNotifications();
        showNotificationToast(message || `${kindInfo.name} update`);
    }

    function showNotificationToast(message) {
        const toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast toast-info';
        toast.style.cssText = `
            background: linear-gradient(135deg, rgba(77,163,255,0.2), rgba(100,244,214,0.1));
            border: 1px solid rgba(77,163,255,0.3);
            border-radius: 10px;
            padding: 10px 14px;
            font-size: 0.75rem;
            color: #e7e9ea;
            max-width: 320px;
            animation: slideIn 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        toast.innerHTML = `<span style="font-size:1rem;">🔔</span> ${message}`;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    if (typeof window._safeToast !== 'function') {
        window._safeToast = function (msg, type) {
            if (typeof window.showToast === 'function') window.showToast(msg, type);
            else console.log('[Toast]', msg);
        };
    }

    async function fetchUserProfile(pubkey) {
        const relays = (window.activeRelays && window.activeRelays.length ? window.activeRelays : (CONFIG.relays || [])).slice(0, 6);
        const rm = new RelayManager(relays);
        let profile = {};
        let profileEvent = null;

        try {
            await rm.connectAll(CONFIG.relayConnectTimeout || 5000);
            const subId = rm.subscribe([{ kinds: [0], authors: [pubkey], limit: 1 }]);

            await new Promise((resolve) => {
                const pendingRelays = new Set(
                    [...rm.connections.keys()].filter(u => {
                        const conn = rm.connections.get(u);
                        return conn && conn.ws && conn.ws.readyState === WebSocket.OPEN;
                    })
                );

                rm.onEvent = (ev) => {
                    if (ev.kind === 0 && ev.pubkey === pubkey) {
                        try {
                            profile = JSON.parse(ev.content || '{}');
                            profileEvent = ev;
                        } catch (e) {
                            profile = {};
                        }
                    }
                };
                rm.onEOSE = (sid, relayUrl) => {
                    if (sid === subId) {
                        if (relayUrl) {
                            pendingRelays.delete(relayUrl);
                        }
                        if (pendingRelays.size === 0) {
                            rm.closeSubscription(subId);
                            resolve();
                        }
                    }
                };
                setTimeout(() => {
                    rm.closeSubscription(subId);
                    resolve();
                }, CONFIG.profileInvestigationTimeout || 8000);
            });
        } catch (e) {
            console.error('Error fetching profile:', e);
        }
        return { profile, profileEvent };
    }

    function hasMeaningfulProfile(profile) {
        if (!profile || typeof profile !== 'object') return false;
        return Boolean(
            (profile.name && String(profile.name).trim()) ||
            (profile.display_name && String(profile.display_name).trim()) ||
            (profile.about && String(profile.about).trim()) ||
            (profile.picture && String(profile.picture).trim()) ||
            (profile.banner && String(profile.banner).trim()) ||
            (profile.nip05 && String(profile.nip05).trim())
        );
    }

    async function publishEvent(eventTemplate) {
        if (typeof window._signNostrEvent !== 'function') {
            throw new Error('Signing not available');
        }
        const signed = await window._signNostrEvent(eventTemplate, currentUser.privateKey);
        if (relayManager) {
            relayManager.publish(signed);
        } else {
            const relays = CONFIG.relays.slice(0, 3);
            const rm = new RelayManager(relays);
            await rm.connectAll(5000);
            rm.publish(signed);
        }
        return signed;
    }

    let isAccountPageLoading = false;
    let accountPageLoaded = false;
    let kindCounts = {};
    let currentPageData = {};

    async function loadAccountPage(forceRefresh = false) {
        if (isAccountPageLoading) return;
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }

        if (!kindRegistryLoaded) {
            loadKindRegistry().catch(() => { });
        }

        const profileContent = document.getElementById('profileContent');
        if (!profileContent) return;

        const cacheProfileKey = CACHE_KEYS.PROFILE + '_' + currentUser.publicKey;
        const cacheCountsKey = CACHE_KEYS.KIND_COUNTS + '_' + currentUser.publicKey;
        const cachedCounts = getCachedData(cacheCountsKey);
        const cachedProfile = getCachedData(cacheProfileKey);
        const cachedProfileHasData = hasMeaningfulProfile(cachedProfile?.profile);
        const profileAge = cachedProfile ? Date.now() - (cachedProfile.timestamp || 0) : Number.MAX_SAFE_INTEGER;
        const countsAge = cachedCounts ? Date.now() - (cachedCounts.timestamp || 0) : Number.MAX_SAFE_INTEGER;
        const hasCache = Boolean(cachedProfile && cachedCounts);

        if (!forceRefresh && hasCache) {
            kindCounts = cachedCounts.counts || {};
            renderAccountPage(cachedProfile.profile || {}, kindCounts);
            accountPageLoaded = true;
            profileContent.dataset.accountPage = 'loaded';
            loadNotifications();

            if (profileAge < ACCOUNT_CACHE_TTL && countsAge < ACCOUNT_CACHE_TTL && cachedProfileHasData) {
                return;
            }
        }

        isAccountPageLoading = true;

        if (!hasCache || forceRefresh) {
            profileContent.innerHTML = `
            <div style="padding:16px;">
                <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
                    <div style="width:72px;height:72px;border-radius:50%;background:#1d1f23;flex-shrink:0;animation:pulse 1.5s ease-in-out infinite;"></div>
                    <div style="flex:1;">
                        <div style="height:24px;width:200px;background:#1d1f23;border-radius:8px;margin-bottom:8px;animation:pulse 1.5s ease-in-out infinite;"></div>
                        <div style="height:16px;width:150px;background:#1d1f23;border-radius:8px;animation:pulse 1.5s ease-in-out infinite;"></div>
                    </div>
                </div>
                <div style="height:60px;background:#1d1f23;border-radius:8px;margin-bottom:12px;animation:pulse 1.5s ease-in-out infinite;"></div>
                <div style="display:grid;gap:8px;">
                    ${Array(10).fill().map(() => `<div style="height:40px;background:#1d1f23;border-radius:8px;animation:pulse 1.5s ease-in-out infinite;"></div>`).join('')}
                </div>
            </div>
            <style>
                @keyframes pulse {
                    0%, 100% { opacity: 0.4; }
                    50% { opacity: 0.7; }
                }
            </style>
        `;
        }

        try {
            const profilePromise = (forceRefresh || !cachedProfile || profileAge >= ACCOUNT_CACHE_TTL || !cachedProfileHasData)
                ? fetchUserProfile(currentUser.publicKey)
                : Promise.resolve({ profile: cachedProfile.profile || {}, profileEvent: null });

            const countsPromise = (forceRefresh || !cachedCounts || countsAge >= ACCOUNT_CACHE_TTL)
                ? scanKindCountsQuick(currentUser.publicKey)
                : Promise.resolve(cachedCounts.counts || {});

            const [{ profile, profileEvent }, quickCounts] = await Promise.all([profilePromise, countsPromise]);

            if (window._setCachedProfile) {
                window._setCachedProfile({ profile, profileEvent });
            }
            try {
                localStorage.setItem('nostrscope_profile', JSON.stringify(profile));
                setCachedData(cacheProfileKey, { profile, timestamp: Date.now() });
            } catch (e) { }

            kindCounts = {
                ...(cachedCounts?.counts || {}),
                ...(quickCounts || {})
            };

            setCachedData(cacheCountsKey, {
                counts: kindCounts,
                timestamp: Date.now()
            });

            renderAccountPage(profile, kindCounts);
            accountPageLoaded = true;
            profileContent.dataset.accountPage = 'loaded';
            loadNotifications();
        } catch (e) {
            console.error('Error loading account data:', e);
            profileContent.innerHTML = `
                <div style="padding:40px;text-align:center;color:#ff5d79;">
                    <p>❌ Failed to load account data.</p>
                    <button class="btn btn-primary" onclick="window.loadAccountPage(true)" style="margin-top:12px;">Retry</button>
                </div>
            `;
        } finally {
            isAccountPageLoading = false;
        }
    }

    function renderAccountPage(profile, counts) {
        const profileContent = document.getElementById('profileContent');
        if (!profileContent) return;

        const registry = KIND_REGISTRY || getFallbackRegistry();
        const npub = npubFromHex(currentUser.publicKey);
        const picture = profile.picture || '';
        const banner = profile.banner || '';
        const name = profile.name || 'Unnamed';
        const about = profile.about || '';
        const nip05 = profile.nip05 || '';

        let badges = [];
        if (profile.tags && Array.isArray(profile.tags)) {
            badges = [...profile.tags];
        }

        function renderImage(src, alt) {
            if (!src) return '<span style="color:#444;">—</span>';
            return `<img src="${src}" alt="${alt}" style="max-width:200px;max-height:120px;border-radius:8px;border:1px solid #2f3336;object-fit:cover;" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'color:#444;\\'>Failed to load</span>';">`;
        }

        const profileFields = [
            { key: 'name', label: 'Name', value: name },
            { key: 'about', label: 'About', value: about },
            { key: 'picture', label: 'Picture', value: picture },
            { key: 'banner', label: 'Banner', value: banner },
            { key: 'nip05', label: 'NIP-05', value: nip05 },
        ];

        let profileRows = '';
        profileFields.forEach(f => {
            const val = f.value || '';
            if (f.key === 'picture' || f.key === 'banner') {
                profileRows += `<tr><td style="color:#71767b;font-weight:600;vertical-align:top;padding:6px 8px 6px 0;border-bottom:1px solid #2f3336;font-size:0.7rem;">${f.label}</td>
                    <td style="padding:6px 0;border-bottom:1px solid #2f3336;">${renderImage(val, f.label)}</td></tr>`;
            } else {
                profileRows += `<tr><td style="color:#71767b;font-weight:600;vertical-align:top;padding:6px 8px 6px 0;border-bottom:1px solid #2f3336;font-size:0.7rem;">${f.label}</td>
                    <td style="padding:6px 0;word-break:break-word;border-bottom:1px solid #2f3336;font-size:0.7rem;">${escapeHtml(val) || '<span style="color:#444;">—</span>'}</td></tr>`;
            }
        });

        profileRows += `<tr><td style="color:#71767b;font-weight:600;vertical-align:top;padding:6px 8px 6px 0;border-bottom:1px solid #2f3336;font-size:0.7rem;">Badges</td>
            <td style="padding:6px 0;border-bottom:1px solid #2f3336;">${badges.length ? badges.map(t => `<span class="badge badge-blue" style="margin:2px;font-size:0.6rem;">${escapeHtml(t)}</span>`).join(' ') : '<span style="color:#444;">—</span>'}</td></tr>`;

        const allKinds = Object.keys(registry).map(Number).sort((a, b) => a - b);
        const totalEvents = Object.values(counts).reduce((sum, c) => sum + c, 0);

        let kindTableRows = '';
        allKinds.forEach(kind => {
            const kindInfo = registry[kind] || { name: `Kind ${kind}`, nip: 'NIP-??', category: 'Regular' };
            const count = counts[kind] || 0;
            const categoryColor = kindInfo.category === 'Replaceable' ? '#ff9a4e' :
                kindInfo.category === 'Addressable' ? '#64f4d6' : '#4da3ff';
            const categoryIcon = kindInfo.category === 'Replaceable' ? '🔄' :
                kindInfo.category === 'Addressable' ? '📌' : '📄';

            kindTableRows += `
                <tr onclick="window.openKindModal(${kind})" style="cursor:pointer;border-bottom:1px solid #2f3336;transition:background 0.2s;" onmouseover="this.style.background='#162132'" onmouseout="this.style.background='transparent'">
                    <td style="padding:6px 8px;font-size:0.65rem;color:#e7e9ea;font-weight:600;white-space:nowrap;">${kind}</td>
                    <td style="padding:6px 8px;font-size:0.65rem;color:#e7e9ea;">
                        <span style="color:${categoryColor};font-size:0.55rem;">${categoryIcon}</span>
                        ${kindInfo.name}
                        <span style="color:#71767b;font-size:0.55rem;margin-left:4px;">${kindInfo.nip}</span>
                    </td>
                    <td style="padding:6px 8px;font-size:0.65rem;text-align:center;">
                        <span class="count-value" style="font-weight:${count > 0 ? '700' : '400'};color:${count > 0 ? '#e7e9ea' : '#71767b'};">
                            ${count >= 100 ? '100+' : count}
                        </span>
                    </td>
                    <td style="padding:6px 8px;font-size:0.55rem;text-align:center;">
                        ${kindInfo.in_use ? '<span style="color:#35c98b;">✅</span>' : '<span style="color:#71767b;">⏳</span>'}
                    </td>
                    <td style="padding:6px 8px;font-size:0.55rem;text-align:center;">
                        ${count > 0 ? `<span style="color:#4da3ff;font-size:0.5rem;">↗</span>` : '<span style="color:#71767b;">—</span>'}
                    </td>
                </tr>
            `;
        });

        const html = `
            <div style="padding:12px;max-width:100%;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px;">
                    <span style="font-size:0.7rem;color:#71767b;">📊 Account Dashboard</span>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <button onclick="window.showNotifications()" style="background:transparent;border:1px solid #2f3336;color:#71767b;border-radius:6px;padding:4px 8px;font-size:0.65rem;cursor:pointer;display:flex;align-items:center;gap:4px;">
                            🔔
                        </button>
                        <div class="refresh-btn-container" style="display:flex;gap:2px;align-items:center;">
                            <button id="scanBtn" onclick="window.backgroundScan()" style="background:transparent;border:1px solid #4da3ff;color:#4da3ff;border-radius:6px;padding:4px 10px;font-size:0.65rem;cursor:pointer;display:flex;align-items:center;gap:4px;">
                                🔄 Scan
                            </button>
                        </div>
                    </div>
                </div>
                <div id="scanStatus" style="display:none;font-size:0.6rem;color:#4da3ff;text-align:center;margin-bottom:6px;padding:4px;background:#162132;border-radius:4px;"></div>

                ${banner ? `<div style="height:100px;background:linear-gradient(120deg,rgba(77,163,255,0.46),rgba(100,244,214,0.36));border-radius:10px;margin-bottom:10px;overflow:hidden;position:relative;">
                    <img src="${banner}" alt="Banner" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display='none';">
                </div>` : ''}

                <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
                    <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(160deg,#1d1f23,#243854);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;border:2px solid #2f3336;font-size:1.5rem;">
                        ${picture ? `<img src="${picture}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display='none';this.parentElement.textContent='👤';">` : '👤'}
                    </div>
                    <div style="flex:1;min-width:120px;">
                        <h2 style="font-size:1rem;margin:0;color:#e7e9ea;word-break:break-word;">${escapeHtml(name)}</h2>
                        <p style="color:#71767b;font-size:0.65rem;margin:2px 0 0 0;word-break:break-all;">${npub}</p>
                        ${nip05 ? `<p style="color:#35c98b;font-size:0.65rem;margin:2px 0 0 0;">✓ ${escapeHtml(nip05)}</p>` : ''}
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;width:100%;margin-top:4px;">
                        <button class="btn btn-primary btn-sm" onclick="window.openProfileEditPopup(window._cachedProfile ? window._cachedProfile().profile || {} : {})" style="padding:4px 12px;font-size:0.7rem;flex:1;">✏️ Edit</button>
                        <button class="btn btn-outline btn-sm" onclick="window.logout && window.logout()" style="padding:4px 12px;font-size:0.7rem;flex:1;">🚪 Logout</button>
                    </div>
                </div>

                ${about ? `<div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:8px;margin-bottom:10px;">
                    <p style="margin:0;color:#e7e9ea;font-size:0.8rem;white-space:pre-wrap;word-break:break-word;">${escapeHtml(about)}</p>
                </div>` : ''}

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(60px,1fr));gap:4px;margin-bottom:10px;">
                    <div class="stat-notes" style="background:#1d1f23;border:1px solid #2f3336;border-radius:6px;padding:6px;text-align:center;">
                        <div class="stat-value" style="font-size:0.9rem;font-weight:700;color:#e7e9ea;">${counts[1] || 0}</div>
                        <div style="font-size:0.55rem;color:#71767b;">Notes</div>
                    </div>
                    <div class="stat-articles" style="background:#1d1f23;border:1px solid #2f3336;border-radius:6px;padding:6px;text-align:center;">
                        <div class="stat-value" style="font-size:0.9rem;font-weight:700;color:#e7e9ea;">${counts[30023] || 0}</div>
                        <div style="font-size:0.55rem;color:#71767b;">Articles</div>
                    </div>
                    <div class="stat-media" style="background:#1d1f23;border:1px solid #2f3336;border-radius:6px;padding:6px;text-align:center;">
                        <div class="stat-value" style="font-size:0.9rem;font-weight:700;color:#e7e9ea;">${(counts[30311] || 0) + (counts[1311] || 0) + (counts[30024] || 0)}</div>
                        <div style="font-size:0.55rem;color:#71767b;">Media</div>
                    </div>
                    <div class="stat-zaps" style="background:#1d1f23;border:1px solid #2f3336;border-radius:6px;padding:6px;text-align:center;">
                        <div class="stat-value" style="font-size:0.9rem;font-weight:700;color:#e7e9ea;">${(counts[9735] || 0) + (counts[9734] || 0)}</div>
                        <div style="font-size:0.55rem;color:#71767b;">Zaps</div>
                    </div>
                    <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:6px;padding:6px;text-align:center;">
                        <div class="stat-value total-count" style="font-size:0.9rem;font-weight:700;color:#e7e9ea;">${totalEvents}</div>
                        <div style="font-size:0.55rem;color:#71767b;">Total</div>
                    </div>
                </div>

                <details style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;overflow:hidden;margin-bottom:10px;">
                    <summary style="cursor:pointer;padding:8px 12px;font-weight:600;color:#e7e9ea;font-size:0.8rem;list-style:none;display:flex;justify-content:space-between;align-items:center;background:#16181c;">
                        <span>📋 All Registered Kinds (${Object.keys(registry).length})</span>
                        <span style="color:#71767b;font-size:0.6rem;">▼</span>
                    </summary>
                    <div style="padding:8px;overflow-x:auto;max-height:400px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
                        <div style="font-size:0.55rem;color:#71767b;margin-bottom:6px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;">
                            <span>Click row to view data</span>
                            <span>📌Addressable 🔄Replaceable 📄Regular</span>
                        </div>
                        <table style="width:100%;border-collapse:collapse;font-size:0.65rem;">
                            <thead style="position:sticky;top:0;z-index:2;">
                                <tr style="background:#16181c;border-bottom:2px solid #2f3336;">
                                    <th style="padding:6px 8px;text-align:left;color:#71767b;font-weight:600;font-size:0.55rem;">Kind</th>
                                    <th style="padding:6px 8px;text-align:left;color:#71767b;font-weight:600;font-size:0.55rem;">Name</th>
                                    <th style="padding:6px 8px;text-align:center;color:#71767b;font-weight:600;font-size:0.55rem;">Count</th>
                                    <th style="padding:6px 8px;text-align:center;color:#71767b;font-weight:600;font-size:0.55rem;">Status</th>
                                    <th style="padding:6px 8px;text-align:center;color:#71767b;font-weight:600;font-size:0.55rem;">Open</th>
                                </tr>
                            </thead>
                            <tbody id="kindTableBody">${kindTableRows}</tbody>
                        </table>
                    </div>
                </details>

                <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;border-bottom:1px solid #2f3336;padding-bottom:6px;">
                    <button class="btn btn-sm btn-outline kind-tab active" data-kind="profile" style="padding:4px 10px;font-size:0.65rem;">👤 Profile</button>
                    <button class="btn btn-sm btn-outline kind-tab" data-kind="1" style="padding:4px 10px;font-size:0.65rem;">📝 Posts</button>
                    <button class="btn btn-sm btn-outline kind-tab" data-kind="30023" style="padding:4px 10px;font-size:0.65rem;">📄 Blog</button>
                    <button class="btn btn-sm btn-outline kind-tab" data-kind="1808" style="padding:4px 10px;font-size:0.65rem;">🎵 Radio</button>
                    <button class="btn btn-sm btn-outline kind-tab" data-kind="9735" style="padding:4px 10px;font-size:0.65rem;">⚡ Zaps</button>
                    <button class="btn btn-sm btn-outline kind-tab" data-kind="30078" style="padding:4px 10px;font-size:0.65rem;">📦 App Data</button>
                </div>

                <div id="kindTabContent" style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:12px;min-height:100px;">
                    <div id="tabLoading" style="display:none;text-align:center;color:#71767b;padding:20px;">⏳ Loading...</div>
                    <div id="tabContent"></div>
                </div>

                <details style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;overflow:hidden;margin-top:10px;">
                    <summary style="cursor:pointer;padding:8px 12px;font-weight:600;color:#e7e9ea;font-size:0.7rem;list-style:none;display:flex;justify-content:space-between;align-items:center;background:#16181c;">
                        <span>📋 Profile Metadata</span>
                        <span style="color:#71767b;font-size:0.6rem;">▼</span>
                    </summary>
                    <div style="padding:0 8px 8px;overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:0.65rem;">
                            <tbody>${profileRows}</tbody>
                        </table>
                    </div>
                </details>
            </div>
        `;

        profileContent.innerHTML = html;
        notificationBadge = null;
        updateNotificationBadge();
        loadNotifications();

        profileContent.querySelectorAll('.kind-tab').forEach(tab => {
            tab.addEventListener('click', function () {
                profileContent.querySelectorAll('.kind-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                const kind = this.dataset.kind;
                if (kind === 'profile') {
                    renderProfileTab();
                } else {
                    loadKindTab(parseInt(kind));
                }
            });
        });

        renderProfileTab();
    }

    function renderProfileTab() {
        const container = document.getElementById('tabContent');
        const loading = document.getElementById('tabLoading');
        if (loading) loading.style.display = 'none';
        if (!container) return;

        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:10px;">
                <div style="background:#16181c;border:1px solid #2f3336;border-radius:8px;padding:10px;">
                    <p style="margin:0;color:#9ab1d1;font-size:0.75rem;line-height:1.5;">
                        Profile summary is shown above. Use the tabs below to browse your notes, blog posts, media, zaps, and app data.
                    </p>
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" onclick="window.loadKindTab(0)" style="padding:4px 12px;font-size:0.7rem;">📄 View Kind 0 Raw</button>
                    <button class="btn btn-outline btn-sm" onclick="window.showNotifications && window.showNotifications()" style="padding:4px 12px;font-size:0.7rem;">🔔 Notifications</button>
                </div>
                <div style="font-size:0.65rem;color:#71767b;">
                    Tip: use the top ✏️ Edit button to update profile metadata.
                </div>
            </div>
        `;
    }

    window.loadKindTab = async function (kind) {
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }

        const container = document.getElementById('tabContent');
        const loading = document.getElementById('tabLoading');
        if (!container) return;

        if (loading) loading.style.display = 'block';
        container.innerHTML = '';

        const registry = KIND_REGISTRY || getFallbackRegistry();
        const kindInfo = registry[kind] || { name: `Kind ${kind}`, nip: 'NIP-??', category: 'Regular' };

        try {
            let events = getCachedKindData(currentUser.publicKey, kind);
            if (!events) {
                events = await fetchKindEvents(currentUser.publicKey, kind);
                setCachedKindData(currentUser.publicKey, kind, events);
            }

            if (loading) loading.style.display = 'none';

            // ── Add "New Article" button for kind 30023 ──
            if (kind === 30023) {
                const newBtnWrap = document.createElement('div');
                newBtnWrap.style.cssText = 'margin-bottom:10px; display:flex; justify-content:flex-end;';
                newBtnWrap.innerHTML = `<button class="btn btn-primary" id="newArticleBtn" style="padding:6px 12px; font-size:0.75rem;">✏️ New Article</button>`;
                container.prepend(newBtnWrap);
                newBtnWrap.querySelector('#newArticleBtn').addEventListener('click', function () {
                    if (typeof window.openArticleEditor === 'function') {
                        window.openArticleEditor();
                    } else {
                        window._safeToast('Editor not loaded. Please refresh.', 'error');
                    }
                });
            }

            if (events.length === 0) {
                container.insertAdjacentHTML('beforeend', `<div style="text-align:center;padding:20px;color:#71767b;font-size:0.8rem;">No ${kindInfo.name} found.</div>`);
                return;
            }

            let html = '';
            if (kind === 1) {
                html = renderKind1Events(events);
            } else if (kind === 30023) {
                html = renderKind30023Events(events);
            } else if (kind === 1808) {
                html = renderKind1808Events(events);
            } else if (kind === 9735) {
                html = renderKind9735Events(events);
            } else if (kind === 30078) {
                html = renderKind30078Events(events);
            } else {
                html = renderGenericKindEvents(events, kindInfo);
            }

            container.insertAdjacentHTML('beforeend', html);

            // ── Attach edit button listeners (kind 30023) ──
            if (kind === 30023) {
                container.querySelectorAll('.edit-article-btn').forEach(btn => {
                    btn.addEventListener('click', function () {
                        try {
                            const idx = Number(this.dataset.index);
                            const ev = Number.isInteger(idx) && idx >= 0 ? events[idx] : null;
                            if (!ev) {
                                throw new Error('Invalid article selection');
                            }
                            if (typeof window.openArticleEditor === 'function') {
                                window.openArticleEditor(ev);
                            } else {
                                window._safeToast('Editor not loaded. Please refresh.', 'error');
                            }
                        } catch (e) {
                            window._safeToast('Error parsing event data.', 'error');
                        }
                    });
                });
            }

        } catch (e) {
            console.error('Error loading kind tab:', e);
            if (loading) loading.style.display = 'none';
            container.innerHTML = `<div style="text-align:center;padding:20px;color:#ff5d79;font-size:0.8rem;">Error loading data.</div>`;
        }
    };

    // ── Render Kind 1 (Posts) ──
    function renderKind1Events(events) {
        return events.map(ev => {
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            let contentHtml = '';

            let text = ev.content || '';
            const imageUrls = [];
            if (ev.tags) {
                ev.tags.forEach(tag => {
                    if (tag[0] === 'imeta') {
                        const urlMatch = tag.find(t => t.startsWith('url '));
                        if (urlMatch) {
                            imageUrls.push(urlMatch.replace('url ', ''));
                        }
                    }
                });
            }
            const contentImages = text.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)/gi) || [];
            imageUrls.push(...contentImages);

            text = escapeHtml(text);
            text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#4da3ff;">$1</a>');
            text = text.replace(/\n/g, '<br>');
            contentHtml = `<div style="font-size:0.8rem;line-height:1.5;color:#e7e9ea;white-space:pre-wrap;word-break:break-word;">${text}</div>`;

            let imagesHtml = '';
            if (imageUrls.length > 0) {
                imagesHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-top:6px;">
                    ${imageUrls.map(url => `<img src="${url}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;border:1px solid #2f3336;" loading="lazy" onerror="this.style.display='none';">`).join('')}
                </div>`;
            }

            let tagsHtml = '';
            if (ev.tags) {
                const hashtags = ev.tags.filter(t => t[0] === 't').map(t => t[1]);
                if (hashtags.length > 0) {
                    tagsHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
                        ${hashtags.map(t => `<span style="background:#162132;border:1px solid #2f3336;border-radius:4px;padding:2px 8px;font-size:0.55rem;color:#4da3ff;">#${escapeHtml(t)}</span>`).join('')}
                    </div>`;
                }
            }

            return `
                <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
                        <span style="font-size:0.55rem;color:#71767b;">${time}</span>
                        <span style="font-size:0.45rem;color:#71767b;font-family:monospace;">${ev.id.substring(0, 12)}</span>
                    </div>
                    ${contentHtml}
                    ${imagesHtml}
                    ${tagsHtml}
                    <div style="margin-top:6px;display:flex;gap:4px;">
                        <button class="btn btn-sm btn-outline" onclick="window.boostEvent('${ev.id}','${ev.pubkey}','${ev.kind}')" style="padding:2px 8px;font-size:0.5rem;">🚀 Boost</button>
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:2px 8px;font-size:0.5rem;">📄 JSON</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ── Render Kind 30023 (Articles/Blog) with Edit button ──
    function renderKind30023Events(events) {
        function parseMarkdown(text) {
            if (!text) return '';

            let html = escapeHtml(text);

            html = html.replace(/```([\s\S]*?)```/g, function (match, code) {
                return `<pre style="background:#0d1117;border:1px solid #2f3336;border-radius:6px;padding:12px;overflow-x:auto;font-family:monospace;font-size:0.75rem;color:#e7e9ea;margin:8px 0;"><code>${code}</code></pre>`;
            });

            html = html.replace(/`([^`]+)`/g, '<code style="background:#0d1117;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.75rem;color:#e7e9ea;">$1</code>');

            html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left:3px solid #4da3ff;padding:4px 12px;margin:8px 0;background:#162132;border-radius:4px;color:#a0b0c0;">$1</blockquote>');

            html = html.replace(/^###### (.*$)/gim, '<h6 style="font-size:0.7rem;font-weight:700;color:#71767b;margin:12px 0 4px;">$1</h6>');
            html = html.replace(/^##### (.*$)/gim, '<h5 style="font-size:0.75rem;font-weight:700;color:#8a9bb8;margin:12px 0 4px;">$1</h5>');
            html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size:0.85rem;font-weight:700;color:#b0c4de;margin:14px 0 6px;">$1</h4>');
            html = html.replace(/^### (.*$)/gim, '<h3 style="font-size:0.95rem;font-weight:700;color:#d4e4ff;margin:16px 0 8px;">$1</h3>');
            html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:1.1rem;font-weight:700;color:#e7e9ea;margin:20px 0 10px;border-bottom:1px solid #2f3336;padding-bottom:6px;">$1</h2>');
            html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:1.3rem;font-weight:800;color:#f0f4ff;margin:24px 0 12px;border-bottom:2px solid #4da3ff33;padding-bottom:8px;">$1</h1>');

            html = html.replace(/^---$/gim, '<hr style="border:0;border-top:1px solid #2f3336;margin:20px 0;">');

            html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
            html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
            html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
            html = html.replace(/_(.*?)_/g, '<em>$1</em>');

            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#4da3ff;text-decoration:underline;">$1</a>');

            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (match, alt, url) {
                return `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0;border:1px solid #2f3336;" loading="lazy" onerror="this.style.display='none';">`;
            });

            html = html.replace(/^[\*\-] (.*$)/gim, '<li style="padding:2px 0;">$1</li>');
            html = html.replace(/(<li>.*?<\/li>\s*)+/g, function (match) {
                return `<ul style="list-style-type:disc;padding-left:20px;margin:6px 0;">${match}</ul>`;
            });

            html = html.replace(/^\d+\. (.*$)/gim, '<li style="padding:2px 0;">$1</li>');
            html = html.replace(/(<li>.*?<\/li>\s*)+/g, function (match) {
                return `<ol style="list-style-type:decimal;padding-left:20px;margin:6px 0;">${match}</ol>`;
            });

            html = html.replace(/\n/g, '<br>');

            return html;
        }

        return events.map((ev, index) => {
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            let title = 'Untitled';
            let summary = '';
            let image = '';
            let content = ev.content || '';

            if (ev.tags) {
                const titleTag = ev.tags.find(t => t[0] === 'title');
                if (titleTag) title = titleTag[1] || title;
                const summaryTag = ev.tags.find(t => t[0] === 'summary');
                if (summaryTag) summary = summaryTag[1] || '';
                const imageTag = ev.tags.find(t => t[0] === 'image');
                if (imageTag) image = imageTag[1] || '';
            }

            let hashtags = [];
            if (ev.tags) {
                hashtags = ev.tags.filter(t => t[0] === 't').map(t => t[1]);
            }

            const fullContent = parseMarkdown(content);
            const evJson = JSON.stringify(ev).replace(/"/g, '&quot;');

            const shortSummary = summary.length > 120 ? summary.substring(0, 120) + '...' : summary;

            return `
            <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:12px;overflow:hidden;margin-bottom:12px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='#4da3ff33'" onmouseout="this.style.borderColor='#2f3336'">
                ${image ? `<div style="position:relative;height:180px;overflow:hidden;background:#0d1117;">
                    <img src="${image}" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:180px;color:#71767b;font-size:0.8rem;\\'>📷 No image</div>'">
                </div>` : ''}
                
                <div style="padding:14px;">
                    <h3 style="font-size:1rem;font-weight:700;color:#e7e9ea;margin:0 0 4px;line-height:1.3;">${escapeHtml(title)}</h3>
                    
                    ${summary ? `<p style="font-size:0.8rem;color:#a0b0c0;margin:0 0 8px;line-height:1.5;">${escapeHtml(shortSummary)}</p>` : ''}
                    
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2f3336;">
                        <span style="font-size:0.6rem;color:#71767b;">📅 ${time}</span>
                        <span style="font-size:0.5rem;color:#71767b;font-family:monospace;">${ev.id.substring(0, 12)}</span>
                    </div>
                    
                    ${hashtags.length > 0 ? `
                        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
                            ${hashtags.slice(0, 5).map(t => `<span style="background:#162132;border:1px solid #2f3336;border-radius:12px;padding:2px 10px;font-size:0.55rem;color:#4da3ff;">#${escapeHtml(t)}</span>`).join('')}
                            ${hashtags.length > 5 ? `<span style="font-size:0.5rem;color:#71767b;">+${hashtags.length - 5} more</span>` : ''}
                        </div>
                    ` : ''}
                    
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button class="btn btn-sm btn-primary" onclick="window.openBlogModal('blog-${ev.id.substring(0, 12)}', ${evJson})" style="padding:4px 12px;font-size:0.6rem;flex:1;">📖 Read Full Article</button>
                        <button class="btn btn-sm btn-outline" onclick="window.boostEvent('${ev.id}','${ev.pubkey}','${ev.kind}')" style="padding:4px 10px;font-size:0.55rem;">🚀</button>
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${evJson})" style="padding:4px 10px;font-size:0.55rem;">📄</button>
                        <button class="btn btn-sm btn-outline edit-article-btn" data-index="${index}" style="padding:4px 10px;font-size:0.55rem;">✏️ Edit</button>
                    </div>
                </div>
            </div>
        `;
        }).join('');
    }

    // ── Open Blog Modal (unchanged from earlier) ──
    window.openBlogModal = function (blogId, ev) {
        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) return;

        let title = 'Untitled';
        let summary = '';
        let image = '';
        let content = ev.content || '';
        let hashtags = [];
        let client = '';

        content = content
            .replace(/\n{4,}/g, '\n\n')
            .trim()
            .replace(/\n(#+)/g, '\n\n$1')
            .replace(/([^\n])(\n#)/g, '$1\n\n$2');

        if (ev.tags) {
            const titleTag = ev.tags.find(t => t[0] === 'title');
            if (titleTag) title = titleTag[1] || title;
            const summaryTag = ev.tags.find(t => t[0] === 'summary');
            if (summaryTag) summary = summaryTag[1] || '';
            const imageTag = ev.tags.find(t => t[0] === 'image');
            if (imageTag) image = imageTag[1] || '';
            hashtags = ev.tags.filter(t => t[0] === 't').map(t => t[1]);
            const clientTag = ev.tags.find(t => t[0] === 'client');
            if (clientTag) client = clientTag[1] || '';
        }

        function sanitizeMediaUrl(url) {
            if (!url || typeof url !== 'string') return null;
            const trimmed = url.trim();
            if (!/^https?:\/\//i.test(trimmed)) return null;
            return trimmed;
        }

        function extractYouTubeId(url) {
            const safe = sanitizeMediaUrl(url);
            if (!safe) return null;
            const m1 = safe.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i);
            if (m1) return m1[1];
            const m2 = safe.match(/^https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i);
            if (m2) return m2[1];
            const m3 = safe.match(/^https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i);
            if (m3) return m3[1];
            return null;
        }

        function buildVideoEmbedHtml(url) {
            const safe = sanitizeMediaUrl(url);
            if (!safe) return '';
            const ytId = extractYouTubeId(safe);
            if (ytId) {
                return `<iframe src="https://www.youtube.com/embed/${ytId}" title="YouTube video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;min-height:280px;border:0;border-radius:10px;"></iframe>`;
            }
            return `<video src="${safe}" controls style="width:100%;max-width:100%;"></video>`;
        }

        function buildAudioEmbedHtml(url) {
            const safe = sanitizeMediaUrl(url);
            if (!safe) return '';
            return `<audio src="${safe}" controls style="width:100%;"></audio>`;
        }

        function injectMediaEmbeds(rawText) {
            if (!rawText) return { text: '', placeholders: [] };

            const placeholders = [];
            const pushPlaceholder = (html) => {
                const key = `%%MEDIAEMBED${placeholders.length}%%`;
                placeholders.push({ key, html });
                return key;
            };

            let text = rawText;

            text = text.replace(/<iframe[^>]*src=["']([^"']+)["'][^>]*><\/iframe>/gi, (match, src) => {
                const safe = sanitizeMediaUrl(src);
                if (!safe) return '';
                const ytId = extractYouTubeId(safe);
                if (ytId) return pushPlaceholder(buildVideoEmbedHtml(safe));
                return pushPlaceholder(`<iframe src="${safe}" loading="lazy" style="width:100%;min-height:260px;border:0;border-radius:10px;"></iframe>`);
            });

            text = text.replace(/<video[^>]*src=["']([^"']+)["'][^>]*><\/video>/gi, (match, src) => {
                const embed = buildVideoEmbedHtml(src);
                return embed ? pushPlaceholder(embed) : '';
            });

            text = text.replace(/<audio[^>]*src=["']([^"']+)["'][^>]*><\/audio>/gi, (match, src) => {
                const embed = buildAudioEmbedHtml(src);
                return embed ? pushPlaceholder(embed) : '';
            });

            text = text.replace(/(^|\n)(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}[^\s]*|youtu\.be\/[a-zA-Z0-9_-]{11}[^\s]*))(\n|$)/gi, (m, p1, url, p3) => {
                const embed = buildVideoEmbedHtml(url);
                if (!embed) return m;
                return `${p1}${pushPlaceholder(embed)}${p3}`;
            });

            return { text, placeholders };
        }

        function parseMarkdownFull(text) {
            if (!text) return '<p style="color:#71767b;">No content available.</p>';

            const injected = injectMediaEmbeds(text);
            let html = escapeHtml(injected.text);

            html = html.replace(/```([\s\S]*?)```/g, function (match, code) {
                return `<pre style="background:#0d1117;border:1px solid #2f3336;border-radius:6px;padding:14px;overflow-x:auto;font-family:monospace;font-size:0.78rem;color:#e7e9ea;margin:14px 0;white-space:pre-wrap;word-wrap:break-word;"><code style="white-space:pre-wrap;word-wrap:break-word;">${code}</code></pre>`;
            });

            html = html.replace(/`([^`]+)`/g, '<code style="background:#0d1117;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.8rem;color:#e7e9ea;word-wrap:break-word;">$1</code>');

            html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left:4px solid #4da3ff;padding:8px 16px;margin:14px 0;background:#162132;border-radius:4px;color:#c0d0e0;font-style:italic;word-wrap:break-word;">$1</blockquote>');

            html = html.replace(/^###### (.*$)/gim, '<h6 style="font-size:0.85rem;font-weight:700;color:#71767b;margin:16px 0 8px;letter-spacing:0.5px;word-wrap:break-word;">$1</h6>');
            html = html.replace(/^##### (.*$)/gim, '<h5 style="font-size:0.9rem;font-weight:700;color:#8a9bb8;margin:18px 0 8px;word-wrap:break-word;">$1</h5>');
            html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size:1rem;font-weight:700;color:#b0c4de;margin:20px 0 10px;word-wrap:break-word;">$1</h4>');
            html = html.replace(/^### (.*$)/gim, '<h3 style="font-size:1.1rem;font-weight:700;color:#d4e4ff;margin:22px 0 12px;word-wrap:break-word;">$1</h3>');
            html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:1.25rem;font-weight:700;color:#e7e9ea;margin:28px 0 14px;border-bottom:2px solid #2f3336;padding-bottom:8px;word-wrap:break-word;">$1</h2>');
            html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:1.5rem;font-weight:800;color:#f0f4ff;margin:30px 0 16px;border-bottom:3px solid #4da3ff33;padding-bottom:10px;word-wrap:break-word;">$1</h1>');

            html = html.replace(/^---$/gim, '<hr style="border:0;border-top:2px solid #2f3336;margin:28px 0;">');

            html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
            html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
            html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
            html = html.replace(/_(.*?)_/g, '<em>$1</em>');

            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#4da3ff;text-decoration:underline;font-weight:600;word-wrap:break-word;">$1</a>');

            html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (match, alt, url) {
                return `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:12px 0;border:1px solid #2f3336;box-shadow:0 4px 12px rgba(0,0,0,0.3);" loading="lazy" onerror="this.style.display='none';">`;
            });

            html = html.replace(/^[\*\-] (.*$)/gim, '<li style="padding:4px 0;word-wrap:break-word;">$1</li>');
            html = html.replace(/(<li>.*?<\/li>\s*)+/g, function (match) {
                return `<ul style="list-style-type:disc;padding-left:24px;margin:8px 0;">${match}</ul>`;
            });

            html = html.replace(/^\d+\. (.*$)/gim, '<li style="padding:4px 0;word-wrap:break-word;">$1</li>');
            html = html.replace(/(<li>.*?<\/li>\s*)+/g, function (match) {
                return `<ol style="list-style-type:decimal;padding-left:24px;margin:8px 0;">${match}</ol>`;
            });

            html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

            for (const item of injected.placeholders) {
                html = html.split(item.key).join(item.html);
            }

            return html;
        }

        const fullContent = parseMarkdownFull(content);
        const time = new Date((ev.created_at || 0) * 1000).toLocaleString();

        const dTag = ev.tags ? ev.tags.find(t => t[0] === 'd')?.[1] || ev.id : ev.id;
        const authorNpub = npubFromHex(ev.pubkey);

        const html = `
        <div id="blogModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.97);overflow-y:auto;z-index:10000;-webkit-overflow-scrolling:touch;display:flex;justify-content:center;">
            <div style="width:100%;max-width:820px;padding:12px 20px 40px;background:#0d1117;min-height:100%;height:auto;box-sizing:border-box;">
                
                <div style="position:sticky;top:0;z-index:10;padding:10px 0;background:#0d1117;border-bottom:1px solid #2f3336;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:0.7rem;color:#71767b;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📖 ${escapeHtml(title.substring(0, 35))}${title.length > 35 ? '...' : ''}</span>
                    <button onclick="document.getElementById('modalContainer').innerHTML='';" style="background:rgba(255,255,255,0.06);border:1px solid #2f3336;color:#71767b;border-radius:6px;padding:5px 12px;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;gap:4px;transition:all 0.2s;flex-shrink:0;">
                        ✕ Close
                    </button>
                </div>
                
                ${image ? `
                    <div style="margin-bottom:16px;border-radius:10px;overflow:hidden;border:1px solid #2f3336;background:#0d1117;">
                        <img src="${image}" style="width:100%;max-height:350px;object-fit:cover;display:block;" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'padding:30px;text-align:center;color:#71767b;font-size:0.85rem;\\'>📷 Image not available</div>'">
                    </div>
                ` : ''}
                
                <h1 style="font-size:1.5rem;font-weight:800;color:#f0f4ff;margin:0 0 6px;line-height:1.3;word-break:break-word;overflow-wrap:break-word;">${escapeHtml(title)}</h1>
                
                ${summary ? `<p style="font-size:0.9rem;color:#a0b0c0;margin:0 0 12px;line-height:1.6;word-break:break-word;overflow-wrap:break-word;">${escapeHtml(summary)}</p>` : ''}
                
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #2f3336;">
                    <span style="font-size:0.7rem;color:#71767b;">📅 ${time}</span>
                    <span style="font-size:0.6rem;color:#71767b;font-family:monospace;background:#1d1f23;padding:2px 8px;border-radius:4px;word-break:break-all;">${ev.id.substring(0, 12)}...</span>
                    ${client ? `<span style="font-size:0.6rem;color:#71767b;background:#1d1f23;padding:2px 8px;border-radius:4px;word-break:break-all;">📱 ${escapeHtml(client)}</span>` : ''}
                    <div style="display:flex;gap:4px;margin-left:auto;flex-wrap:wrap;">
                        <button class="btn btn-sm btn-primary" onclick="window.boostEvent('${ev.id}','${ev.pubkey}','${ev.kind}')" style="padding:3px 10px;font-size:0.6rem;">🚀 Boost</button>
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:3px 10px;font-size:0.6rem;">📄</button>
                        <button class="btn btn-sm btn-outline" onclick="window.open('https://njump.me/${authorNpub}/${dTag}', '_blank')" style="padding:3px 10px;font-size:0.6rem;">🔗</button>
                    </div>
                </div>
                
                <div class="article-rich-content" style="font-size:0.95rem;line-height:1.85;color:#e7e9ea;word-break:break-word;overflow-wrap:break-word;max-width:100%;padding:0 4px;">
                    ${fullContent}
                </div>
                
                ${hashtags.length > 0 ? `
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:28px;padding-top:18px;border-top:2px solid #2f3336;padding-left:4px;padding-right:4px;">
                        ${hashtags.map(t => `<span style="background:#162132;border:1px solid #2f3336;border-radius:20px;padding:4px 12px;font-size:0.65rem;color:#4da3ff;word-break:break-all;">#${escapeHtml(t)}</span>`).join('')}
                    </div>
                ` : ''}
                
                ${client ? `
                    <div style="margin-top:12px;font-size:0.6rem;color:#71767b;text-align:center;padding-top:12px;border-top:1px solid #2f3336;word-break:break-all;padding-left:4px;padding-right:4px;">
                        Published via ${escapeHtml(client)}
                    </div>
                ` : ''}
                
                <div style="margin-top:20px;display:flex;gap:6px;flex-wrap:wrap;padding-top:14px;border-top:2px solid #2f3336;padding-left:4px;padding-right:4px;">
                    <button onclick="document.getElementById('modalContainer').innerHTML='';" class="btn btn-primary" style="flex:1;padding:10px;font-size:0.8rem;min-height:44px;">✕ Close</button>
                    <button class="btn btn-outline" onclick="window.boostEvent('${ev.id}','${ev.pubkey}','${ev.kind}')" style="padding:10px 14px;font-size:0.8rem;min-height:44px;">🚀</button>
                    <button class="btn btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:10px 14px;font-size:0.8rem;min-height:44px;">📄</button>
                    <button class="btn btn-outline" onclick="window.open('https://njump.me/${authorNpub}/${dTag}', '_blank')" style="padding:10px 14px;font-size:0.8rem;min-height:44px;">🔗</button>
                </div>
            </div>
        </div>
    `;

        modalContainer.innerHTML = html;

        requestAnimationFrame(() => {
            const backdrop = document.getElementById('blogModalBackdrop');
            if (backdrop) {
                backdrop.scrollTop = 0;
            }
            window.scrollTo(0, 0);
        });

        setTimeout(() => {
            const backdrop = document.getElementById('blogModalBackdrop');
            if (backdrop) {
                backdrop.scrollTop = 0;
            }
            window.scrollTo(0, 0);
        }, 100);

        setTimeout(() => {
            const backdrop = document.getElementById('blogModalBackdrop');
            if (backdrop) {
                backdrop.scrollTop = 0;
            }
            window.scrollTo(0, 0);
        }, 300);
    };

    // ── Mini player and other kind renderers (unchanged) ──
    function initMiniPlayer() {
        if (miniPlayerInitialized) return;
        miniPlayerInitialized = true;

        let miniPlayer = document.createElement('div');
        miniPlayer.id = 'miniAudioPlayer';
        miniPlayer.style.cssText = `
            position: fixed;
            bottom: 70px;
            left: 0;
            right: 0;
            background: #16181c;
            border-top: 1px solid #2f3336;
            border-bottom: 1px solid #2f3336;
            padding: 8px 12px;
            display: none;
            z-index: 9999;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            align-items: center;
            gap: 10px;
            box-shadow: 0 -4px 20px rgba(0,0,0,0.5);
        `;

        miniPlayer.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                <div style="width:40px;height:40px;border-radius:4px;background:#1d1f23;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;">
                    <img style="width:100%;height:100%;object-fit:cover;display:none;" id="miniPlayerCoverImg">
                </div>
                <div style="flex:1;min-width:0;">
                    <div id="miniPlayerTitle" style="font-size:0.7rem;color:#e7e9ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Loading...</div>
                    <div id="miniPlayerArtist" style="font-size:0.55rem;color:#71767b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Unknown Artist</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                <button id="miniPlayerPlayBtn" style="background:transparent;border:1px solid #2f3336;color:#e7e9ea;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.borderColor='#4da3ff'" onmouseout="this.style.borderColor='#2f3336'">
                    ▶
                </button>
                <button id="miniPlayerCloseBtn" style="background:transparent;border:none;color:#71767b;font-size:0.8rem;cursor:pointer;padding:4px 6px;" onmouseover="this.style.color='#e7e9ea'" onmouseout="this.style.color='#71767b'">
                    ✕
                </button>
            </div>
            <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:#2f3336;">
                <div id="miniPlayerProgressBar" style="height:100%;width:0%;background:#4da3ff;transition:width 0.1s;"></div>
            </div>
        `;

        document.body.appendChild(miniPlayer);

        // ── Mini player controls ──
        const playBtn = miniPlayer.querySelector('#miniPlayerPlayBtn');
        const closeBtn = miniPlayer.querySelector('#miniPlayerCloseBtn');

        playBtn.addEventListener('click', function () {
            if (currentAudio) {
                if (currentAudio.paused) {
                    currentAudio.play().catch(function (e) {
                        console.log('Play error:', e);
                    });
                    this.textContent = '⏸';
                } else {
                    currentAudio.pause();
                    this.textContent = '▶';
                }
            }
        });

        closeBtn.addEventListener('click', function () {
            if (currentAudio) {
                currentAudio.pause();
                currentAudio = null;
                currentTrack = null;
            }
            miniPlayer.style.display = 'none';
            const playBtn = document.getElementById('miniPlayerPlayBtn');
            if (playBtn) playBtn.textContent = '▶';
            const progress = document.getElementById('miniPlayerProgressBar');
            if (progress) progress.style.width = '0%';
        });
    }

    // ── Show mini player with track info ──
    window.showMiniPlayer = function (trackData, audioElement) {
        initMiniPlayer();

        const miniPlayer = document.getElementById('miniAudioPlayer');
        if (!miniPlayer) return;

        currentAudio = audioElement;
        currentTrack = trackData;

        // Update UI
        const titleEl = document.getElementById('miniPlayerTitle');
        const artistEl = document.getElementById('miniPlayerArtist');
        const coverImg = document.getElementById('miniPlayerCoverImg');
        const playBtn = document.getElementById('miniPlayerPlayBtn');
        const progressBar = document.getElementById('miniPlayerProgressBar');

        if (titleEl) titleEl.textContent = trackData.title || 'Untitled Track';
        if (artistEl) artistEl.textContent = trackData.artist || 'Unknown Artist';

        if (coverImg && trackData.coverArt) {
            coverImg.src = trackData.coverArt;
            coverImg.style.display = 'block';
            coverImg.onerror = function () {
                this.style.display = 'none';
            };
        } else if (coverImg) {
            coverImg.style.display = 'none';
        }

        if (playBtn) playBtn.textContent = '▶';
        if (progressBar) progressBar.style.width = '0%';

        miniPlayer.style.display = 'flex';
        miniPlayer.style.animation = 'slideUp 0.3s ease-out';

        // Remove existing listeners to avoid duplicates
        const newAudio = audioElement.cloneNode(true);
        audioElement.parentNode.replaceChild(newAudio, audioElement);
        currentAudio = newAudio;

        // Audio event listeners for play button sync
        newAudio.addEventListener('play', function () {
            const btn = document.getElementById('miniPlayerPlayBtn');
            if (btn) btn.textContent = '⏸';
        });

        newAudio.addEventListener('pause', function () {
            const btn = document.getElementById('miniPlayerPlayBtn');
            if (btn) btn.textContent = '▶';
        });

        newAudio.addEventListener('timeupdate', function () {
            const progress = document.getElementById('miniPlayerProgressBar');
            if (progress && this.duration) {
                progress.style.width = (this.currentTime / this.duration * 100) + '%';
            }
        });

        newAudio.addEventListener('ended', function () {
            const btn = document.getElementById('miniPlayerPlayBtn');
            if (btn) btn.textContent = '▶';
            const progress = document.getElementById('miniPlayerProgressBar');
            if (progress) progress.style.width = '0%';
        });

        // Auto-play
        newAudio.play().catch(function (e) {
            console.log('Auto-play prevented:', e);
            const btn = document.getElementById('miniPlayerPlayBtn');
            if (btn) btn.textContent = '▶';
        });
    };

    // ── Play track in mini player ──
    window.playTrackInMiniPlayer = function (trackId) {
        const audioElement = document.getElementById(trackId);
        if (!audioElement) {
            console.error('Audio element not found:', trackId);
            window._safeToast('Audio element not found.', 'error');
            return;
        }

        // Extract track data from the card
        let trackData = {};
        const card = audioElement.closest('div[style*="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin-bottom:8px;"]');

        if (card) {
            const titleEl = card.querySelector('h4');
            const artistEl = card.querySelector('p');
            const coverImg = card.querySelector('img');
            const genreEl = card.querySelector('span[style*="background:#162132;padding:2px 8px;border-radius:4px;"]');

            trackData.title = titleEl ? titleEl.textContent : 'Untitled Track';
            trackData.artist = artistEl ? artistEl.textContent : 'Unknown Artist';
            trackData.coverArt = coverImg ? coverImg.src : '';
            trackData.genre = genreEl ? genreEl.textContent : '';
        }

        // Show mini player with this track
        window.showMiniPlayer(trackData, audioElement);
    };
    
    // ── Render Kind 1808 (Audio/BCH Radio) ──
    function renderKind1808Events(events) {
        return events.map(ev => {
            let audioData = {};
            try {
                audioData = JSON.parse(ev.content || '{}');
            } catch (e) { }

            const title = audioData.title || 'Untitled Track';
            const artist = audioData.artist || 'Unknown Artist';
            const coverArt = audioData.coverArt || '';
            const url = audioData.url || '';
            const duration = audioData.duration || 0;
            const genre = audioData.genre || '';

            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;

            const trackId = 'track-' + ev.id.substring(0, 12);

            return `
                <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;gap:12px;flex-wrap:wrap;">
                        ${coverArt ? `<img src="${coverArt}" style="width:80px;height:80px;border-radius:8px;object-fit:cover;border:1px solid #2f3336;" loading="lazy" onerror="this.style.display='none';">` : `<div style="width:80px;height:80px;border-radius:8px;background:#162132;display:flex;align-items:center;justify-content:center;font-size:2rem;">🎵</div>`}
                        <div style="flex:1;min-width:150px;">
                            <h4 style="font-size:0.85rem;margin:0;color:#e7e9ea;">${escapeHtml(title)}</h4>
                            <p style="font-size:0.7rem;color:#71767b;margin:2px 0;">${escapeHtml(artist)}</p>
                            ${genre ? `<span style="font-size:0.55rem;color:#71767b;background:#162132;padding:2px 8px;border-radius:4px;">${escapeHtml(genre)}</span>` : ''}
                            ${duration > 0 ? `<span style="font-size:0.55rem;color:#71767b;margin-left:6px;">⏱ ${minutes}:${String(seconds).padStart(2, '0')}</span>` : ''}
                            ${url ? `
                                <div style="margin-top:6px;">
                                    <audio id="${trackId}" style="width:100%;max-width:300px;height:32px;">
                                        <source src="${url}" type="audio/mpeg">
                                        Your browser does not support the audio element.
                                    </audio>
                                    <button class="btn btn-sm btn-primary" onclick="window.playTrackInMiniPlayer('${trackId}')" style="padding:2px 10px;font-size:0.6rem;margin-top:4px;">
                                        🎵 Play in Mini Player
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div style="margin-top:6px;display:flex;gap:4px;">
                        <button class="btn btn-sm btn-outline" onclick="window.boostEvent('${ev.id}','${ev.pubkey}','${ev.kind}')" style="padding:2px 8px;font-size:0.5rem;">🚀 Boost</button>
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:2px 8px;font-size:0.5rem;">📄 JSON</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderKind9735Events(events) {
        return events.map(ev => {
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            let amount = 0;
            let sender = ev.pubkey || 'unknown';
            let txid = '';

            if (ev.tags) {
                const amountTag = ev.tags.find(t => t[0] === 'amount');
                if (amountTag) amount = parseInt(amountTag[1]) || 0;
                const pTag = ev.tags.find(t => t[0] === 'p');
                if (pTag) sender = pTag[1] || sender;
            }

            try {
                const content = JSON.parse(ev.content || '{}');
                if (content.txid) txid = content.txid;
            } catch (e) { }

            const sats = (amount / 1000).toFixed(2);

            return `
                <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                        <span style="font-size:0.7rem;color:#e7e9ea;">⚡ ${sats} sats</span>
                        <span style="font-size:0.55rem;color:#71767b;">${time}</span>
                    </div>
                    <div style="font-size:0.65rem;color:#71767b;word-break:break-all;">
                        From: <code style="font-size:0.55rem;">${sender.substring(0, 16)}...</code>
                        ${txid ? `<br>TXID: <code style="font-size:0.5rem;">${txid}</code>` : ''}
                    </div>
                    <div style="margin-top:4px;display:flex;gap:4px;">
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:2px 8px;font-size:0.5rem;">📄 JSON</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderKind30078Events(events) {
        return events.map(ev => {
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            let data = {};
            try {
                data = JSON.parse(ev.content || '{}');
            } catch (e) { }

            const isBoost = ev.tags && ev.tags.some(t => t[0] === 't' && t[1] === 'bch-boost');

            let details = '';
            if (isBoost) {
                const amount = ev.tags.find(t => t[0] === 'amount');
                const expires = ev.tags.find(t => t[0] === 'expires');
                const eventId = data.eventId || '';
                details = `
                    <div style="font-size:0.65rem;color:#e7e9ea;">
                        🚀 Boost: ${amount ? `${parseInt(amount[1]) / 1000} sats` : '?'}
                        ${expires ? ` · Expires: ${new Date(parseInt(expires[1]) * 1000).toLocaleString()}` : ''}
                        ${eventId ? ` · Event: <code style="font-size:0.5rem;">${eventId.substring(0, 16)}...</code>` : ''}
                    </div>
                `;
            } else {
                details = `<div style="font-size:0.65rem;color:#e7e9ea;font-family:monospace;white-space:pre-wrap;word-break:break-word;">${escapeHtml(JSON.stringify(data, null, 2))}</div>`;
            }

            return `
                <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
                        <span style="font-size:0.55rem;color:#71767b;">${time}</span>
                        <span style="font-size:0.45rem;color:#71767b;font-family:monospace;">${ev.id.substring(0, 12)}</span>
                    </div>
                    ${details}
                    <div style="margin-top:4px;display:flex;gap:4px;">
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:2px 8px;font-size:0.5rem;">📄 JSON</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderGenericKindEvents(events, kindInfo) {
        return events.map(ev => {
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            let contentPreview = ev.content || '';
            if (contentPreview.length > 200) {
                contentPreview = contentPreview.substring(0, 200) + '...';
            }

            let isJson = false;
            try {
                if (contentPreview && (contentPreview.startsWith('{') || contentPreview.startsWith('['))) {
                    JSON.parse(contentPreview);
                    isJson = true;
                }
            } catch (e) { }

            return `
                <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:8px;padding:10px;margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
                        <span style="font-size:0.55rem;color:#71767b;">${time}</span>
                        <span style="font-size:0.45rem;color:#71767b;font-family:monospace;">${ev.id.substring(0, 12)}</span>
                    </div>
                    <div style="font-size:0.7rem;color:#e7e9ea;white-space:pre-wrap;word-break:break-word;max-height:100px;overflow-y:auto;">
                        ${isJson ? `<pre style="font-size:0.6rem;color:#71767b;margin:0;font-family:monospace;">${escapeHtml(contentPreview)}</pre>` : escapeHtml(contentPreview)}
                    </div>
                    <div style="margin-top:4px;display:flex;gap:4px;">
                        <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${JSON.stringify(ev).replace(/"/g, '&quot;')})" style="padding:2px 8px;font-size:0.5rem;">📄 JSON</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    window.showEventJsonModal = function (ev) {
        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) return;

        const json = JSON.stringify(ev, null, 2);
        const kindLabel = (window.KNOWN_KINDS && window.KNOWN_KINDS[ev.kind]) ? window.KNOWN_KINDS[ev.kind] : `Kind ${ev.kind}`;
        const createdAt = new Date((ev.created_at || 0) * 1000).toLocaleString();
        const shortId = ev.id ? `${ev.id.substring(0, 12)}...` : 'N/A';
        modalContainer.innerHTML = `
            <div class="modal-backdrop" onclick="if(event.target===this)document.getElementById('modalContainer').innerHTML='';" style="padding:0;">
                <div class="modal json-modal" style="margin:0;">
                    <div class="json-modal-header">
                        <div>
                            <h3 class="json-modal-title">Event JSON</h3>
                            <div class="json-modal-meta">
                                <span class="json-chip">${kindLabel}</span>
                                <span class="json-chip">🕒 ${createdAt}</span>
                                <span class="json-chip">🆔 ${shortId}</span>
                            </div>
                        </div>
                        <button onclick="document.getElementById('modalContainer').innerHTML='';" style="background:none;border:none;color:#71767b;font-size:1.2rem;cursor:pointer;">✕</button>
                    </div>
                    <div class="json-modal-body">
                        <div class="json-viewer" style="font-size:0.72rem;max-height:none;height:100%;min-height:0;">${syntaxHighlight(json)}</div>
                    </div>
                    <div class="json-modal-actions">
                        <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(JSON.stringify(window._currentEventData, null, 2)).then(() => window._safeToast('Copied!'));" style="font-size:0.6rem;padding:4px 10px;">Copy</button>
                        <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(window._currentEventData.id || '').then(() => window._safeToast('Event ID copied!'));" style="font-size:0.6rem;padding:4px 10px;">Copy ID</button>
                        <button class="btn btn-sm btn-primary" onclick="window.downloadFile(JSON.stringify(window._currentEventData, null, 2), 'nostr-event-${ev.id.substring(0, 12)}.json');" style="font-size:0.6rem;padding:4px 10px;">Download</button>
                        <button onclick="document.getElementById('modalContainer').innerHTML='';" class="btn btn-sm btn-outline" style="font-size:0.6rem;padding:4px 10px;">Close</button>
                    </div>
                </div>
            </div>
        `;
        window._currentEventData = ev;
    };

    window.openKindModal = async function (kind) {
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }

        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) return;

        const registry = KIND_REGISTRY || getFallbackRegistry();
        const kindInfo = registry[kind] || { name: `Kind ${kind}`, nip: 'NIP-??', category: 'Regular' };

        modalContainer.innerHTML = `
            <div class="modal-backdrop" onclick="if(event.target===this)document.getElementById('modalContainer').innerHTML='';" style="padding:12px;">
                <div class="modal" style="max-width:560px;margin:10px;padding:14px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <h3 style="font-size:0.85rem;margin:0;color:#e7e9ea;">⏳ Loading ${kindInfo.name}...</h3>
                        <button onclick="document.getElementById('modalContainer').innerHTML='';" style="background:none;border:none;color:#71767b;font-size:1.2rem;cursor:pointer;">✕</button>
                    </div>
                    <div style="text-align:center;padding:30px;color:#71767b;">Loading data...</div>
                </div>
            </div>
        `;

        let events = getCachedKindData(currentUser.publicKey, kind);
        if (!events) {
            events = await fetchKindEvents(currentUser.publicKey, kind);
            setCachedKindData(currentUser.publicKey, kind, events);
        }

        currentPageData[kind] = events;
        renderKindModal(kind, kindInfo, events, 0);
    };

    function renderKindModal(kind, kindInfo, events, page) {
        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) return;

        const totalPages = Math.ceil(events.length / PAGE_SIZE);
        const start = page * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, events.length);
        const pageEvents = events.slice(start, end);

        const categoryIcon = kindInfo.category === 'Replaceable' ? '🔄' :
            kindInfo.category === 'Addressable' ? '📌' : '📄';

        let eventsHtml = '';
        if (pageEvents.length === 0) {
            eventsHtml = `<div style="text-align:center;padding:20px;color:#71767b;font-size:0.8rem;">No events found for this kind.</div>`;
        } else {
            eventsHtml = pageEvents.map((ev, index) => {
                return renderSingleEventInModal(ev, start + index + 1);
            }).join('');
        }

        let paginationHtml = '';
        if (totalPages > 1) {
            paginationHtml = `
                <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap;">
                    <button onclick="window.changeKindPage(${kind}, ${Math.max(0, page - 1)})" style="background:transparent;border:1px solid #2f3336;color:#71767b;border-radius:4px;padding:4px 12px;font-size:0.6rem;cursor:pointer;${page === 0 ? 'opacity:0.3;cursor:not-allowed;' : ''}" ${page === 0 ? 'disabled' : ''}>◀</button>
                    <span style="font-size:0.6rem;color:#71767b;">Page ${page + 1} of ${totalPages} (${events.length} events)</span>
                    <button onclick="window.changeKindPage(${kind}, ${Math.min(totalPages - 1, page + 1)})" style="background:transparent;border:1px solid #2f3336;color:#71767b;border-radius:4px;padding:4px 12px;font-size:0.6rem;cursor:pointer;${page === totalPages - 1 ? 'opacity:0.3;cursor:not-allowed;' : ''}" ${page === totalPages - 1 ? 'disabled' : ''}>▶</button>
                    <span style="font-size:0.5rem;color:#71767b;">Showing ${start + 1}-${end}</span>
                </div>
            `;
        }

        modalContainer.innerHTML = `
            <div class="modal-backdrop" onclick="if(event.target===this)document.getElementById('modalContainer').innerHTML='';" style="padding:12px;overflow-y:auto;">
                <div class="modal" style="max-width:560px;margin:10px;padding:14px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;background:#16181c;border:1px solid #2f3336;border-radius:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px;margin-bottom:10px;flex-shrink:0;">
                        <div>
                            <h3 style="font-size:0.85rem;margin:0;color:#e7e9ea;">${categoryIcon} ${kindInfo.name}</h3>
                            <div style="font-size:0.6rem;color:#71767b;margin-top:2px;">Kind ${kind} · ${kindInfo.nip} · ${kindInfo.category} · ${events.length} events</div>
                        </div>
                        <button onclick="document.getElementById('modalContainer').innerHTML='';" style="background:none;border:none;color:#71767b;font-size:1.2rem;cursor:pointer;">✕</button>
                    </div>
                    
                    <div style="overflow-y:auto;flex:1;padding-right:4px;">
                        ${eventsHtml}
                    </div>
                    
                    ${paginationHtml}
                </div>
            </div>
        `;
    }

    window.changeKindPage = function (kind, page) {
        const events = currentPageData[kind] || [];
        const registry = KIND_REGISTRY || getFallbackRegistry();
        const kindInfo = registry[kind] || { name: `Kind ${kind}` };
        renderKindModal(kind, kindInfo, events, page);
    };

    function renderSingleEventInModal(ev, index) {
        const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
        let contentHtml = '';
        let isJson = false;
        let parsedJson = null;

        try {
            if (ev.content && (ev.content.startsWith('{') || ev.content.startsWith('['))) {
                parsedJson = JSON.parse(ev.content);
                isJson = true;
            }
        } catch (e) { }

        if (isJson && parsedJson) {
            contentHtml = `
                <div style="background:#0d1117;border-radius:4px;padding:6px;overflow-x:auto;font-family:monospace;font-size:0.55rem;max-height:150px;overflow-y:auto;">
                    ${syntaxHighlight(JSON.stringify(parsedJson, null, 2))}
                </div>
            `;
        } else {
            let text = escapeHtml(ev.content || '');
            text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#4da3ff;">$1</a>');
            text = text.replace(/\n/g, '<br>');
            contentHtml = `<div style="font-size:0.7rem;line-height:1.5;color:#e7e9ea;white-space:pre-wrap;word-break:break-word;">${text}</div>`;
        }

        let tagsHtml = '';
        if (ev.tags && ev.tags.length > 0) {
            tagsHtml = `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">
                ${ev.tags.slice(0, 8).map(t => `<span style="background:#1d1f23;border:1px solid #2f3336;border-radius:4px;padding:2px 6px;font-size:0.45rem;color:#71767b;font-family:monospace;">${escapeHtml(t.join(','))}</span>`).join('')}
                ${ev.tags.length > 8 ? `<span style="font-size:0.45rem;color:#71767b;">+${ev.tags.length - 8} more</span>` : ''}
            </div>`;
        }

        const evJson = JSON.stringify(ev).replace(/"/g, '&quot;');

        return `
            <div style="background:#1d1f23;border:1px solid #2f3336;border-radius:6px;padding:8px;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="font-size:0.5rem;color:#71767b;background:#0d1117;padding:2px 6px;border-radius:4px;">#${index}</span>
                        <span style="font-size:0.5rem;color:#71767b;">${time}</span>
                        <span style="font-size:0.45rem;color:#71767b;background:#0d1117;padding:2px 6px;border-radius:4px;font-family:monospace;">${ev.id.substring(0, 8)}</span>
                    </div>
                    <button class="btn btn-sm btn-outline" onclick="window.showEventJsonModal(${evJson})" style="padding:2px 6px;font-size:0.45rem;">📄</button>
                </div>
                <div style="margin-top:4px;">${contentHtml}</div>
                ${tagsHtml}
            </div>
        `;
    }

    window.showNotifications = function () {
        const modalContainer = document.getElementById('modalContainer');
        if (!modalContainer) return;

        let html = `
            <div class="modal-backdrop" onclick="if(event.target===this)document.getElementById('modalContainer').innerHTML='';" style="padding:12px;">
                <div class="modal" style="max-width:480px;margin:10px;padding:14px;max-height:80vh;display:flex;flex-direction:column;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
                        <h3 style="font-size:0.9rem;margin:0;">🔔 Notifications</h3>
                        <button onclick="document.getElementById('modalContainer').innerHTML='';" style="background:none;border:none;color:#71767b;font-size:1.2rem;cursor:pointer;">✕</button>
                    </div>
                    <button onclick="window.markAllNotificationsRead();" style="background:transparent;border:1px solid #2f3336;color:#71767b;border-radius:4px;padding:4px 8px;font-size:0.6rem;cursor:pointer;margin-bottom:8px;flex-shrink:0;">Mark all read</button>
                    <div style="overflow-y:auto;flex:1;">
        `;

        if (notifications.length === 0) {
            html += `<p style="color:#71767b;font-size:0.8rem;text-align:center;padding:20px;">No notifications yet.</p>`;
        } else {
            const registry = KIND_REGISTRY || getFallbackRegistry();
            for (const n of notifications.slice(0, 50)) {
                const time = new Date(n.timestamp).toLocaleString();
                const kindInfo = registry[n.kind] || { name: `Kind ${n.kind}` };
                html += `
                    <div style="background:${n.read ? '#1d1f23' : '#162132'};border:1px solid ${n.read ? '#2f3336' : '#4da3ff33'};border-radius:6px;padding:8px;margin:4px 0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
                            <span style="font-size:0.65rem;font-weight:${n.read ? '400' : '700'};color:${n.read ? '#71767b' : '#e7e9ea'};">${n.message}</span>
                            <span style="font-size:0.5rem;color:#71767b;">${time}</span>
                        </div>
                        ${n.content ? `<div style="font-size:0.6rem;color:#71767b;margin-top:4px;word-break:break-word;">${escapeHtml(n.content.substring(0, 100))}</div>` : ''}
                        <div style="margin-top:4px;display:flex;gap:4px;">
                            <button onclick="window.viewNotificationEvent('${n.eventId}')" style="background:transparent;border:1px solid #2f3336;color:#4da3ff;border-radius:4px;padding:2px 8px;font-size:0.5rem;cursor:pointer;">View</button>
                            <button onclick="window.dismissNotification('${n.id}')" style="background:transparent;border:1px solid #2f3336;color:#71767b;border-radius:4px;padding:2px 8px;font-size:0.5rem;cursor:pointer;">Dismiss</button>
                        </div>
                    </div>
                `;
            }
        }

        html += `</div></div></div>`;
        modalContainer.innerHTML = html;
    };

    window.markAllNotificationsRead = function () {
        notifications.forEach(n => n.read = true);
        saveNotifications();
        window.showNotifications();
        updateNotificationBadge();
    };

    window.dismissNotification = function (id) {
        notifications = notifications.filter(n => n.id !== id);
        saveNotifications();
        window.showNotifications();
        updateNotificationBadge();
    };

    window.viewNotificationEvent = function (eventId) {
        for (const kind in currentPageData) {
            const ev = currentPageData[kind].find(e => e.id === eventId);
            if (ev) {
                window.showEventJsonModal(ev);
                return;
            }
        }
        if (typeof window.runAnalysis === 'function') {
            window.runAnalysis(eventId);
        }
    };

    function openProfileEditPopup(profile) {
        const jsonStr = JSON.stringify(profile, null, 2);
        const popupHtml = `
        <div class="modal-backdrop" id="profileEditBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10001;padding:16px;">
            <div class="modal" style="background:#16181c;border:1px solid #2f3336;border-radius:12px;padding:14px;max-width:460px;width:100%;color:#e7e9ea;max-height:90vh;overflow-y:auto;">
                <button class="modal-close" style="float:right;background:none;border:none;color:#71767b;font-size:1.2rem;cursor:pointer;" onclick="document.getElementById('profileEditBackdrop').remove();">✕</button>
                <h3 style="font-size:0.9rem;">✏️ Edit Profile JSON</h3>
                <p style="font-size:0.65rem;color:#71767b;margin-bottom:6px;">Edit your profile metadata. Changes will be published to the network.</p>
                <textarea id="profileJsonEditor" style="width:100%;height:200px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;font-family:monospace;font-size:0.65rem;padding:6px;border-radius:6px;resize:vertical;">${escapeHtml(jsonStr)}</textarea>
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                    <button class="btn btn-primary" id="saveProfileJsonBtn" style="flex:1;padding:6px;font-size:0.75rem;">💾 Save & Publish</button>
                    <button class="btn btn-outline" onclick="document.getElementById('profileEditBackdrop').remove();" style="padding:6px 14px;font-size:0.75rem;">Cancel</button>
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
                window._safeToast('Invalid JSON format.', 'error');
                return;
            }
            const event = { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(newProfile) };
            try {
                const signed = await publishEvent(event);
                if (window._setCachedProfile) window._setCachedProfile({ profile: newProfile, profileEvent: signed });
                try { localStorage.setItem('nostrscope_profile', JSON.stringify(newProfile)); } catch (e) { }
                window._safeToast('✅ Profile updated successfully!', 'success');
                document.getElementById('profileEditBackdrop').remove();
                document.getElementById('profileContent').dataset.accountPage = '';
                loadAccountPage(true);
            } catch (e) {
                window._safeToast('Error: ' + e.message, 'error');
            }
        });
    }

    window.showAccountModal = function (forceRefresh) {
        if (!currentUser) {
            window._safeToast('Please log in first.', 'info');
            return;
        }

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const profileScreen = document.getElementById('profileScreen');
        if (profileScreen) profileScreen.classList.add('active');
        if (typeof setActiveNav === 'function') setActiveNav('profile');

        setTimeout(() => loadAccountPage(forceRefresh || false), 50);
    };

    window.openProfileEditPopup = openProfileEditPopup;
    window.loadAccountPage = loadAccountPage;
    window.backgroundScan = backgroundScan;
    window.showMiniPlayer = showMiniPlayer;
    window.playTrackInMiniPlayer = playTrackInMiniPlayer;

    // ── Override renderMyProfile ──
    const originalRenderMyProfile = window.renderMyProfile;
    if (typeof originalRenderMyProfile === 'function') {
        window.renderMyProfile = function () {
            if (currentUser) {
                const profileScreen = document.getElementById('profileScreen');
                if (profileScreen && profileScreen.classList.contains('active')) {
                    loadAccountPage();
                } else {
                    window.showAccountModal();
                }
            } else {
                const profileContent = document.getElementById('profileContent');
                if (profileContent) {
                    profileContent.innerHTML = `
                        <div style="padding:40px;text-align:center;">
                            <p style="margin-bottom:12px;color:#71767b;">You are not logged in.</p>
                            <button class="btn btn-primary" style="padding:10px 20px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;" onclick="window.showLoginModal();">🔑 Login</button>
                        </div>
                    `;
                }
            }
        };
    }

    loadKindRegistry();

    console.log('✅ account-tab.js with article editor integration');
})();