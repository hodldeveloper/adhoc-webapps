/**
 * NostrScope Boost Module
 * Supports generic boosts and music‑specific boosts (kind 1808)
 */
(function () {
    const FALLBACK_ONE_USD_SATS = 1655;
    const ONE_USD_SATS_CACHE_KEY = 'nostrscope_one_usd_sats';
    const ONE_USD_SATS_CACHE_TTL_MS = 10 * 60 * 1000;
    // Sample TXID for music boosts (placeholder)
    const SAMPLE_TXID = 'f6cd7ce46a31c9374a55ee149ed54aecd7b321d9043a6a4ee0ac15f42444c6db';

    function toSatsPerUsd(bchUsd) {
        const price = Number(bchUsd);
        if (!Number.isFinite(price) || price <= 0) return 0;
        return Math.max(1, Math.round(100000000 / price));
    }

    async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    function readUsdSatsCache() {
        try {
            const raw = localStorage.getItem(ONE_USD_SATS_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            const sats = Number(parsed.sats);
            const ts = Number(parsed.ts);
            if (!Number.isFinite(sats) || sats < 1) return null;
            if (!Number.isFinite(ts) || (Date.now() - ts) > ONE_USD_SATS_CACHE_TTL_MS) return null;
            return sats;
        } catch (e) {
            return null;
        }
    }

    function writeUsdSatsCache(sats) {
        try {
            localStorage.setItem(ONE_USD_SATS_CACHE_KEY, JSON.stringify({ sats, ts: Date.now() }));
        } catch (e) {}
    }

    async function getOneUsdInSats() {
        const cached = readUsdSatsCache();
        if (cached) return cached;

        try {
            const cg = await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd');
            const sats = toSatsPerUsd(cg?.['bitcoin-cash']?.usd);
            if (sats > 0) {
                writeUsdSatsCache(sats);
                return sats;
            }
        } catch (e) {}

        try {
            const cb = await fetchJsonWithTimeout('https://api.coinbase.com/v2/prices/BCH-USD/spot');
            const sats = toSatsPerUsd(cb?.data?.amount);
            if (sats > 0) {
                writeUsdSatsCache(sats);
                return sats;
            }
        } catch (e) {}

        return FALLBACK_ONE_USD_SATS;
    }

    function getKeyVariants(privateKey) {
        if (typeof ensureHexKey === 'function' && typeof getPrivateKeyVariants === 'function') {
            const normalized = ensureHexKey(privateKey);
            return normalized ? getPrivateKeyVariants(normalized) : [privateKey];
        }
        return [privateKey];
    }

    async function signNostrEvent(event, privateKey) {
        if (typeof NostrTools === 'undefined') {
            throw new Error('Nostr tools not loaded');
        }

        const keyVariants = getKeyVariants(privateKey);

        if (typeof NostrTools.signEvent === 'function') {
            for (const key of keyVariants) {
                try {
                    return await NostrTools.signEvent(event, key);
                } catch (e) {}
            }
        }

        if (typeof NostrTools.finalizeEvent === 'function') {
            for (const key of keyVariants) {
                try {
                    return NostrTools.finalizeEvent(event, key);
                } catch (e) {}
            }
        }

        if (typeof NostrTools.getEventHash === 'function' && typeof NostrTools.getSignature === 'function') {
            const id = NostrTools.getEventHash(event);
            for (const key of keyVariants) {
                try {
                    const sig = NostrTools.getSignature(id, key);
                    event.id = id;
                    event.sig = sig;
                    return event;
                } catch (e) {}
            }
        }

        throw new Error('No signing method available in this version of nostr-tools');
    }

    window._signNostrEvent = signNostrEvent;

    async function ensureRelayManagerForBoost() {
        if (window._relayManager) return window._relayManager;
        if (typeof RelayManager !== 'function') return null;

        const primary = 'wss://relay.bchnostr.com';
        let relays = Array.isArray(window.activeRelays) && window.activeRelays.length > 0
            ? window.activeRelays
            : (window.CONFIG?.relays || []);
        if (!relays.includes(primary)) {
            relays = [primary, ...relays];
        }
        relays = [...new Set(relays)].slice(0, 6);

        const rm = new RelayManager(relays);
        window._relayManager = rm;
        try {
            await rm.connectAll(4000);
        } catch (e) {}
        return rm;
    }

    function showBoostModal(eventId, eventPubkey, eventKind) {
        const kindNum = Number(eventKind);
        const isMusic = (kindNum === 1808);

        const modalHost = document.getElementById('modalContainer') || document.body;
        const now = Math.floor(Date.now() / 1000);
        const defaultHours = 24;
        const defaultAmount = readUsdSatsCache() || FALLBACK_ONE_USD_SATS;

        modalHost.innerHTML = `
            <div class="modal-backdrop" id="boostModalBackdrop">
                <div class="modal" style="max-width:460px;">
                    <h3>${isMusic ? '🎵 Boost this Track' : '📝 Boost this Post'}</h3>
                    ${isMusic ? `
                        <div class="boost-music-note">
                            🎵 Music boost – will be published as a <code>bch-radio-promo</code> event for the radio client.
                            <span class="boost-music-note-sub">(txid placeholder: ${SAMPLE_TXID.substring(0, 16)}...)</span>
                        </div>
                    ` : ''}
                    <div class="warning">Set how much sats and how long the boost stays active.</div>
                    <label style="font-size:0.75rem;color:var(--text2);">Target event</label>
                    <input id="boostEventId" type="text" value="${eventId}" readonly>

                    <label style="font-size:0.75rem;color:var(--text2);">Amount (sats)</label>
                    <input id="boostAmountSats" type="number" min="${defaultAmount}" step="1" value="${defaultAmount}">
                    <div id="boostUsdHint" style="font-size:0.72rem;color:var(--text2);margin-top:2px;">Minimum for ~$1: ${defaultAmount} sats</div>

                    <label style="font-size:0.75rem;color:var(--text2);">Duration (hours)</label>
                    <input id="boostDurationHours" type="number" min="1" max="720" step="1" value="${defaultHours}">

                    <label style="font-size:0.75rem;color:var(--text2);">Optional note</label>
                    <textarea id="boostNote" rows="3" placeholder="Why this should be boosted..."></textarea>

                    <div style="display:flex; gap:8px; margin-top:12px; justify-content:flex-end;">
                        <button class="btn btn-outline" id="boostCancelBtn">Cancel</button>
                        <button class="btn btn-primary" id="boostSubmitBtn">${isMusic ? 'Boost Track' : 'Boost Post'}</button>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text2);margin-top:10px;">
                        Expires at: <span id="boostExpiresPreview">${new Date((now + defaultHours * 3600) * 1000).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;

        const backdrop = document.getElementById('boostModalBackdrop');
        const amountInput = document.getElementById('boostAmountSats');
        const durationInput = document.getElementById('boostDurationHours');
        const noteInput = document.getElementById('boostNote');
        const submitBtn = document.getElementById('boostSubmitBtn');
        const cancelBtn = document.getElementById('boostCancelBtn');
        const expiresPreview = document.getElementById('boostExpiresPreview');
        const usdHint = document.getElementById('boostUsdHint');
        let minBoostSats = defaultAmount;

        function closeModal() {
            if (backdrop) backdrop.remove();
            if (modalHost.id === 'modalContainer') modalHost.innerHTML = '';
        }

        function getBoostFormValues() {
            const amountSats = Number(amountInput?.value || 0);
            const durationHours = Number(durationInput?.value || 0);
            const safeAmount = Number.isFinite(amountSats) ? Math.floor(amountSats) : 0;
            const safeHours = Number.isFinite(durationHours) ? Math.floor(durationHours) : 0;
            return { safeAmount, safeHours };
        }

        function refreshExpiryPreview() {
            const { safeHours } = getBoostFormValues();
            const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, safeHours) * 3600;
            if (expiresPreview) expiresPreview.textContent = new Date(expiresAt * 1000).toLocaleString();
        }

        amountInput?.addEventListener('input', refreshExpiryPreview);
        durationInput?.addEventListener('input', refreshExpiryPreview);

        if (usdHint) usdHint.textContent = `Minimum for ~$1: ${minBoostSats} sats`;
        getOneUsdInSats().then((liveSats) => {
            if (!amountInput) return;
            const nextMin = Math.max(1, Number(liveSats) || FALLBACK_ONE_USD_SATS);
            minBoostSats = nextMin;
            amountInput.min = String(nextMin);
            const currentVal = Number(amountInput.value || 0);
            if (!Number.isFinite(currentVal) || currentVal <= defaultAmount) {
                amountInput.value = String(nextMin);
            }
            if (usdHint) usdHint.textContent = `Minimum for ~$1: ${nextMin} sats`;
        });

        cancelBtn?.addEventListener('click', closeModal);
        backdrop?.addEventListener('click', (e) => {
            if (e.target === backdrop) closeModal();
        });

        async function handleSubmit() {
            if (!window._currentUser) {
                window.showToast('Please login first.', 'info');
                if (typeof window.showLoginModal === 'function') {
                    window.showLoginModal();
                }
                return;
            }

            const { safeAmount, safeHours } = getBoostFormValues();
            if (safeAmount < minBoostSats) {
                window.showToast(`Amount must be at least ${minBoostSats} sats (~$1).`, 'error');
                return;
            }
            if (safeHours < 1) {
                window.showToast('Duration must be at least 1 hour.', 'error');
                return;
            }

            const relayManager = await ensureRelayManagerForBoost();
            if (!relayManager) {
                window.showToast('No relay connection available for boost.', 'error');
                return;
            }

            const nowTs = Math.floor(Date.now() / 1000);
            const expiresAt = nowTs + safeHours * 3600;
            const note = (noteInput?.value || '').trim();

            let tags = [];
            let contentObj = {};

            if (isMusic) {
                // ── Music boost format (BCH Radio style) ──
                tags = [
                    ['e', eventId],
                    ['t', 'bch-radio-promo'],
                    ['t', 'bch-radio'],
                    ['d', `bchnostr/radio-promo/song-${eventId}-${nowTs}`],
                ];
                contentObj = {
                    type: 'song',
                    trackId: eventId,
                    expiresAt: expiresAt,
                    paidSats: safeAmount,
                    txid: SAMPLE_TXID  // use the sample txid
                };
                if (note) contentObj.note = note;
            } else {
                // ── Generic boost format ──
                tags = [
                    ['e', eventId],
                    ['p', eventPubkey],
                    ['k', String(kindNum || 1)],
                    ['t', 'bch-boost'],
                    ['client', 'BCHNostr'],
                    ['d', `bchnostr/${eventId}/${nowTs}`],
                    ['amount', String(safeAmount)],
                    ['expires', String(expiresAt)],
                ];
                contentObj = { eventId, priceSats: safeAmount, expiresAt, client: 'BCHNostr' };
                if (note) contentObj.note = note;
            }

            const eventTemplate = {
                kind: 30078,
                created_at: nowTs,
                tags: tags,
                content: JSON.stringify(contentObj),
            };

            try {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Publishing...';
                }
                const signedEvent = await signNostrEvent(eventTemplate, window._currentUser.privateKey);
                relayManager.publish(signedEvent);
                closeModal();
                window.showToast(`Boost published${isMusic ? ' for track' : ''}.`, 'success');
                if (typeof window.loadBoostedFeed === 'function') {
                    setTimeout(() => window.loadBoostedFeed(true), 1200);
                }
            } catch (e) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = isMusic ? 'Boost Track' : 'Boost Post';
                }
                window.showToast('Boost error: ' + e.message, 'error');
            }
        }

        submitBtn?.addEventListener('click', handleSubmit);
        noteInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
        });
        durationInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSubmit();
        });
        amountInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSubmit();
        });
    }

    async function publishBoost(eventId, eventPubkey, eventKind) {
        if (!window._currentUser) {
            window.showToast('Please login first.', 'info');
            if (typeof window.showLoginModal === 'function') {
                window.showLoginModal();
            }
            return;
        }
        showBoostModal(eventId, eventPubkey, eventKind);
    }

    window.boostEvent = publishBoost;
    window.boostOriginalEvent = async () => {
        if (!window._originalEvent) {
            window.showToast('No original event to boost.', 'error');
            return;
        }
        await publishBoost(
            window._originalEvent.id,
            window._originalEvent.pubkey,
            window._originalEvent.kind
        );
    };
})();
