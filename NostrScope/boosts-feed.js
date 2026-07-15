(function() {
    let boostEvents = [];
    let boostedTargets = new Map();
    let activeBoostChildTab = 'notes';
    let boostsLastLoadedAt = 0;
    let boostsLoadToken = 0;
    const BOOST_RELAY = 'wss://relay.bchnostr.com';
    const MUSIC_KIND = 1808;
    const BOOST_CHILD_TAB_KEY = 'nostrscope_boost_child_tab';
    const BOOST_CACHE_TTL_MS = 60000;
    const boostsContent = document.getElementById('boostsContent');
    if (!boostsContent) return;

    try {
        const savedBoostChildTab = localStorage.getItem(BOOST_CHILD_TAB_KEY);
        if (savedBoostChildTab === 'music' || savedBoostChildTab === 'notes') {
            activeBoostChildTab = savedBoostChildTab;
        }
    } catch (e) {
        // Ignore localStorage access issues.
    }

    function parseBoostMeta(ev) {
        const tags = Array.isArray(ev.tags) ? ev.tags : [];
        const getTag = (key) => tags.find(t => t[0] === key)?.[1] || '';

        let contentObj = {};
        try {
            contentObj = JSON.parse(ev.content || '{}');
        } catch (e) {
            contentObj = {};
        }

        const amountFromContent = Number(contentObj?.priceSats);
        const amountFromTag = Number(getTag('amount'));
        const amountSats = Number.isFinite(amountFromContent) && amountFromContent > 0
            ? Math.floor(amountFromContent)
            : (Number.isFinite(amountFromTag) && amountFromTag > 0 ? Math.floor(amountFromTag) : 0);

        const expiresFromContent = Number(contentObj?.expiresAt);
        const expiresFromTag = Number(getTag('expires'));
        const expiresAt = Number.isFinite(expiresFromContent) && expiresFromContent > 0
            ? Math.floor(expiresFromContent)
            : (Number.isFinite(expiresFromTag) && expiresFromTag > 0 ? Math.floor(expiresFromTag) : 0);

        const targetEventId = String(contentObj?.eventId || getTag('e') || '');
        const targetKindCandidates = [
            contentObj?.targetKind,
            contentObj?.kind,
            contentObj?.eventKind,
            getTag('k'),
            getTag('kind'),
        ];
        let targetKind = 0;
        for (const rawKind of targetKindCandidates) {
            const parsedKind = Number(rawKind);
            if (Number.isFinite(parsedKind) && parsedKind > 0) {
                targetKind = Math.floor(parsedKind);
                break;
            }
        }
        const now = Math.floor(Date.now() / 1000);
        const isActive = !expiresAt || expiresAt > now;

        return {
            amountSats,
            expiresAt,
            targetEventId,
            targetKind,
            isActive,
        };
    }

    function formatSats(value) {
        return Number(value || 0).toLocaleString();
    }

    function isBoostEvent(ev) {
        if (!ev || ev.kind !== 30078) return false;
        const meta = parseBoostMeta(ev);
        return Boolean(meta.targetEventId && meta.amountSats > 0);
    }

    function escapeHTMLLocal(str) {
        const value = str == null ? '' : String(str);
        if (typeof escapeHtml === 'function') return escapeHtml(value);
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }

    function renderPostContent(content) {
        if (!content) return '<span style="color:var(--text2);">(no text)</span>';
        if (typeof renderMediaFromContent === 'function') {
            const rendered = renderMediaFromContent(content);
            const text = rendered?.text || '';
            const media = rendered?.media || '';
            return `${text}${media ? `<div style="margin-top:8px;">${media}</div>` : ''}`;
        }
        return `<div style="white-space:pre-wrap;word-break:break-word;">${escapeHTMLLocal(content)}</div>`;
    }

    function renderBoostScanState(primaryText, detailText = '') {
        const primary = escapeHTMLLocal(primaryText || 'Scanning boosts...');
        const detail = detailText ? `<div class="boost-scan-detail">${escapeHTMLLocal(detailText)}</div>` : '';
        boostsContent.innerHTML = `<div class="card boost-card boost-scan-state">
            <div class="spinner" aria-hidden="true"></div>
            <div class="boost-scan-title">${primary}</div>
            ${detail}
        </div>`;
    }

    function setActiveBoostChildTab(tab, shouldRender = true) {
        if (tab !== 'notes' && tab !== 'music') return;
        activeBoostChildTab = tab;
        try {
            localStorage.setItem(BOOST_CHILD_TAB_KEY, tab);
        } catch (e) {
            // Ignore localStorage access issues.
        }
        if (shouldRender) renderBoosts();
    }

    function splitBoostEventsByTargetKind() {
        const notes = [];
        const music = [];

        for (const ev of boostEvents) {
            const meta = parseBoostMeta(ev);
            const target = boostedTargets.get(meta.targetEventId) || null;
            const inferredKind = Number(meta.targetKind || 0);
            if (target?.kind === MUSIC_KIND || inferredKind === MUSIC_KIND) music.push(ev);
            else notes.push(ev);
        }

        return { notes, music };
    }

    function renderBoostChildTabs(notesCount, musicCount) {
        const notesActive = activeBoostChildTab === 'notes' ? ' active' : '';
        const musicActive = activeBoostChildTab === 'music' ? ' active' : '';

        return `<div class="boost-child-tabs" role="tablist" aria-label="Boost categories">
            <button class="boost-child-tab-btn${notesActive}" data-boost-child-tab="notes" role="tab" aria-selected="${activeBoostChildTab === 'notes'}">Notes <span class="boost-child-tab-count">${notesCount}</span></button>
            <button class="boost-child-tab-btn${musicActive}" data-boost-child-tab="music" role="tab" aria-selected="${activeBoostChildTab === 'music'}">Music <span class="boost-child-tab-count">${musicCount}</span></button>
        </div>`;
    }

    function bindBoostChildTabs() {
        boostsContent.querySelectorAll('[data-boost-child-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.boostChildTab;
                setActiveBoostChildTab(tab, true);
            });
        });
    }

    async function fetchEventsByIds(relays, ids, timeoutMs = 10000) {
        const validIds = [...new Set((ids || []).filter(Boolean))];
        if (!validIds.length) return new Map();

        const rm = new RelayManager(relays);
        const map = new Map();

        try {
            await rm.connectAll(5000);
            const chunks = [];
            for (let i = 0; i < validIds.length; i += 60) {
                chunks.push(validIds.slice(i, i + 60));
            }

            for (const chunk of chunks) {
                const subId = rm.subscribe([{ ids: chunk, limit: chunk.length }]);
                await new Promise((resolve) => {
                    let done = false;

                    const finish = () => {
                        if (done) return;
                        done = true;
                        rm.closeSubscription(subId);
                        resolve();
                    };

                    rm.onEvent = (ev, url, sid) => {
                        if (sid !== subId) return;
                        if (!ev?.id) return;
                        if (!map.has(ev.id)) map.set(ev.id, ev);
                    };

                    const expectedEOSE = Math.max(rm.connections.size, 1);
                    const eoseRelays = new Set();

                    rm.onEOSE = (sid, url) => {
                        if (sid !== subId) return;
                        if (url) eoseRelays.add(url);
                        if (eoseRelays.size >= expectedEOSE) finish();
                    };

                    setTimeout(finish, timeoutMs);
                });
            }
        } catch (e) {
            // Ignore fetch failures and return whatever we already collected.
        } finally {
            rm.closeAll();
        }

        return map;
    }

    async function collectBoostEvents(rm, filter, timeoutMs = 12000) {
        const collected = [];
        const seenIds = new Set();
        const subId = rm.subscribe([filter]);

        await new Promise((resolve) => {
            let done = false;
            const expectedEOSE = Math.max(rm.connections.size, 1);
            const eoseRelays = new Set();

            const finish = () => {
                if (done) return;
                done = true;
                rm.closeSubscription(subId);
                resolve();
            };

            rm.onEvent = (ev, url, sid) => {
                if (sid !== subId) return;
                if (!isBoostEvent(ev)) return;
                if (seenIds.has(ev.id)) return;
                seenIds.add(ev.id);
                collected.push(ev);
            };

            rm.onEOSE = (sid, url) => {
                if (sid !== subId) return;
                if (url) eoseRelays.add(url);
                if (eoseRelays.size >= expectedEOSE) finish();
            };

            setTimeout(finish, timeoutMs);
        });

        return collected;
    }

    function rankBoostEvents(events) {
        const deduped = [];
        const seen = new Set();
        for (const ev of events || []) {
            if (!ev?.id || seen.has(ev.id)) continue;
            seen.add(ev.id);
            deduped.push(ev);
        }

        return deduped
            .map(ev => ({ ev, meta: parseBoostMeta(ev) }))
            .filter(item => item.meta.amountSats > 0 && item.meta.isActive)
            .sort((a, b) => {
                const amountDiff = (b.meta.amountSats || 0) - (a.meta.amountSats || 0);
                if (amountDiff !== 0) return amountDiff;
                return (b.ev.created_at || 0) - (a.ev.created_at || 0);
            })
            .map(item => item.ev);
    }

    function hasNewBoostIds(existingEvents, nextEvents) {
        const existingIds = new Set((existingEvents || []).map(ev => ev.id));
        return (nextEvents || []).some(ev => ev?.id && !existingIds.has(ev.id));
    }

    function getPreferredBoostRelays(max = 8) {
        const active = Array.isArray(window.activeRelays) ? window.activeRelays : [];
        const feed = Array.isArray(CONFIG.feedRelays) ? CONFIG.feedRelays : [];
        const fallback = Array.isArray(CONFIG.relays) ? CONFIG.relays : [];
        const primary = CONFIG.primaryRelay || BOOST_RELAY;

        const avoid = new Set([
            'wss://relay.damus.io'
        ]);

        const merged = [...new Set([BOOST_RELAY, primary, ...feed, ...active, ...fallback])]
            .filter((url) => {
                if (!url || avoid.has(url)) return false;
                if (typeof window.isRelayInCooldown === 'function' && window.isRelayInCooldown(url)) return false;
                return true;
            });

        const selected = merged.slice(0, Math.max(1, max));
        return selected.length ? selected : [BOOST_RELAY];
    }

    async function scanBoostEvents(relays, options = {}) {
        const taggedTimeoutMs = Number(options.taggedTimeoutMs || 4200);
        const fallbackTimeoutMs = Number(options.fallbackTimeoutMs || 4200);
        const taggedLimit = Number(options.taggedLimit || 1000);
        const fallbackLimit = Number(options.fallbackLimit || 1200);
        const onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

        const rm = new RelayManager(relays);
        try {
            await rm.connectAll(3500);

            if (onStatus) onStatus('Scanning BCH boost events...', 'Pass 1 of 2 (tagged bch-boost)');
            const tagged = await collectBoostEvents(rm, { kinds: [30078], '#t': ['bch-boost'], limit: taggedLimit }, taggedTimeoutMs);

            let fallback = [];
            if (!tagged.length) {
                if (onStatus) onStatus('Scanning fallback boost events...', 'Pass 2 of 2 (all kind 30078)');
                fallback = await collectBoostEvents(rm, { kinds: [30078], limit: fallbackLimit }, fallbackTimeoutMs);
            }

            return rankBoostEvents([...tagged, ...fallback]);
        } catch (e) {
            return [];
        } finally {
            rm.closeAll();
        }
    }

    async function resolveBoostTargets(relays, events, timeoutMs = 3200, limit = 60) {
        const targetIds = (events || [])
            .map(ev => parseBoostMeta(ev).targetEventId)
            .filter(Boolean)
            .slice(0, limit);
        return fetchEventsByIds(relays, targetIds, timeoutMs);
    }

    window.loadBoostsFeed = async function(options = {}) {
        const loadToken = ++boostsLoadToken;
        const force = Boolean(options?.force);
        const background = Boolean(options?.background);
        const hasCache = boostEvents.length > 0;
        const cacheFresh = hasCache && (Date.now() - boostsLastLoadedAt) < BOOST_CACHE_TTL_MS;

        if (hasCache && !force) {
            renderBoosts();
            if (cacheFresh) return;
        }

        const shouldShowOverlay = !background || !hasCache;
        const shouldReplaceContentWithScan = !hasCache || force;
        let overlayHiddenEarly = false;

        if (shouldShowOverlay) showLoading('Loading top boosted posts…');
        if (shouldReplaceContentWithScan) {
            boostEvents = [];
            boostedTargets = new Map();
            boostsContent.innerHTML = '';
        }

        const fullRelays = getPreferredBoostRelays(8);
        const quickRelays = getPreferredBoostRelays(3);

        try {
            if (shouldReplaceContentWithScan) {
                renderBoostScanState('Connecting to relays...', `${quickRelays.length} relay${quickRelays.length === 1 ? '' : 's'}`);
            }

            const quickEvents = await scanBoostEvents(quickRelays, {
                taggedTimeoutMs: 3800,
                fallbackTimeoutMs: 3800,
                onStatus: shouldReplaceContentWithScan ? renderBoostScanState : null,
            });

            if (loadToken !== boostsLoadToken) return;

            if (quickEvents.length || !hasCache || force) {
                boostEvents = quickEvents;
                boostedTargets = new Map();
                boostsLastLoadedAt = Date.now();
                renderBoosts();
            }

            if (shouldShowOverlay) {
                hideLoading();
                overlayHiddenEarly = true;
            }

            // Hydrate target posts after first paint.
            resolveBoostTargets(quickRelays, boostEvents, 3000, 60).then((targetMap) => {
                if (loadToken !== boostsLoadToken) return;
                if (!targetMap || !targetMap.size) return;
                boostedTargets = new Map([...boostedTargets.entries(), ...targetMap.entries()]);
                renderBoosts();
            });

            const shouldEnrich = force || !cacheFresh || quickEvents.length < 10 || fullRelays.length > quickRelays.length;
            if (!shouldEnrich) return;

            const enrichedEvents = await scanBoostEvents(fullRelays, {
                taggedTimeoutMs: 6500,
                fallbackTimeoutMs: 6500,
            });
            if (loadToken !== boostsLoadToken) return;

            if (enrichedEvents.length > boostEvents.length || hasNewBoostIds(boostEvents, enrichedEvents)) {
                boostEvents = enrichedEvents;
                boostsLastLoadedAt = Date.now();
                renderBoosts();
            }

            const enrichedTargets = await resolveBoostTargets(fullRelays, boostEvents, 4200, 90);
            if (loadToken !== boostsLoadToken) return;
            if (enrichedTargets?.size) {
                boostedTargets = new Map([...boostedTargets.entries(), ...enrichedTargets.entries()]);
                renderBoosts();
            }
        } catch (e) {
            boostsContent.innerHTML = '<div class="card boost-card" style="padding:20px;text-align:center;color:var(--red);">Failed to load boosted posts.</div>';
        } finally {
            if (shouldShowOverlay && !overlayHiddenEarly) hideLoading();
        }
    };

    function renderBoosts() {
        const groups = splitBoostEventsByTargetKind();
        if (activeBoostChildTab === 'music' && !groups.music.length && groups.notes.length) {
            activeBoostChildTab = 'notes';
        }

        const activeEvents = activeBoostChildTab === 'music' ? groups.music : groups.notes;
        const emptyLabel = activeBoostChildTab === 'music'
            ? 'No active boosted music found.'
            : 'No active boosted notes found.';

        let html = '';
        html += renderBoostChildTabs(groups.notes.length, groups.music.length);
        html += '<div class="boost-child-panel">';

        if (!activeEvents.length) {
            html += `<div class="card boost-card" style="padding:20px;text-align:center;">${emptyLabel}</div>`;
            html += '</div>';
            boostsContent.innerHTML = html;
            bindBoostChildTabs();
            return;
        }

        for (let i = 0; i < activeEvents.length; i++) {
            const ev = activeEvents[i];
            const meta = parseBoostMeta(ev);
            const target = boostedTargets.get(meta.targetEventId) || null;
            const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
            const expiresText = meta.expiresAt ? new Date(meta.expiresAt * 1000).toLocaleString() : 'N/A';
            const kindName = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
            const displayTargetKind = target?.kind || meta.targetKind || 0;
            const targetKindName = displayTargetKind ? (KNOWN_KINDS[displayTargetKind] || `Kind ${displayTargetKind}`) : 'Unknown';
            const targetTime = target?.created_at ? new Date(target.created_at * 1000).toLocaleString() : '';
            const targetAuthor = target?.pubkey ? `${target.pubkey.substring(0, 16)}...` : 'Unknown';
            const detailId = `boost-detail-${ev.id}`;

            html += `<div class="card boost-card" style="margin-bottom:12px;">
                <div class="event-header boost-card-header">
                    <span class="boost-card-header-main">
                        <span class="boosted-rank">#${i + 1}</span>
                        <span class="badge badge-purple">Boosted ${targetKindName}</span>
                        <span class="badge badge-green">${formatSats(meta.amountSats)} sats</span>
                    </span>
                    <span class="event-time">${time}</span>
                </div>

                <div style="margin-top:8px;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface2);">
                    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px;">
                        <span class="badge badge-blue">Target Post</span>
                        <span class="event-time">${targetTime || 'Unknown time'}</span>
                        <span class="event-author" style="font-size:0.74rem;color:var(--text2);">${escapeHTMLLocal(targetAuthor)}</span>
                    </div>
                    ${target ? renderPostContent(target.content || '') : `<div style="font-size:0.82rem;color:var(--text2);">Target post not found on connected relays.</div>`}
                </div>

                <div class="boost-card-meta">
                    <div><strong>Target:</strong> <code>${meta.targetEventId || 'Unknown'}</code></div>
                    <div><strong>Expires:</strong> ${expiresText}</div>
                    <div><strong>Bidder:</strong> <code>${ev.pubkey}</code></div>
                </div>

                <button class="btn btn-sm btn-outline" data-boost-toggle="${detailId}" style="margin-top:8px;">View boost post</button>

                <details id="${detailId}" style="margin-top:8px;display:none;">
                    <summary style="cursor:pointer;color:var(--accent);">Boost Event JSON (${kindName})</summary>
                    <div class="json-viewer" style="max-height:150px;margin-top:4px;">${syntaxHighlight(JSON.stringify(ev, null, 2))}</div>
                </details>
            </div>`;
        }
        html += '</div>';
        boostsContent.innerHTML = html;

        bindBoostChildTabs();

        boostsContent.querySelectorAll('[data-boost-toggle]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const detailId = btn.getAttribute('data-boost-toggle');
                const detailEl = detailId ? document.getElementById(detailId) : null;
                if (!detailEl) return;
                const hidden = detailEl.style.display === 'none';
                detailEl.style.display = hidden ? 'block' : 'none';
                btn.textContent = hidden ? 'Hide boost post' : 'View boost post';
            });
        });
    }

    function initBoosts() { console.log('🚀 Boosted feed ready'); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBoosts);
    else initBoosts();
})();
