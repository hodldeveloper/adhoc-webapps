(function() {
    async function signNostrEvent(event, privateKey) {
        if (typeof NostrTools === 'undefined') throw new Error('Nostr tools not loaded');
        if (typeof NostrTools.signEvent === 'function') return await NostrTools.signEvent(event, privateKey);
        if (typeof NostrTools.finalizeEvent === 'function') return NostrTools.finalizeEvent(event, privateKey);
        if (typeof NostrTools.getEventHash === 'function' && typeof NostrTools.getSignature === 'function') {
            const id = NostrTools.getEventHash(event);
            const sig = NostrTools.getSignature(id, privateKey);
            event.id = id;
            event.sig = sig;
            return event;
        }
        throw new Error('No signing method available');
    }
    window._signNostrEvent = signNostrEvent;

    // ── BCH‑boost (kind 30078) with optional txid ──
    window.boostWithBCH = function(eventId, eventPubkey) {
        if (!window._currentUser) {
            window.showToast('Please login first.', 'info');
            if (typeof window.showLoginModal === 'function') window.showLoginModal();
            return;
        }
        // Show modal – txid is now optional
        const modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'modal-backdrop';
        modalBackdrop.innerHTML = `
            <div class="modal" style="max-width:360px;">
                <h3>🚀 Boost with BCH</h3>
                <p style="color:var(--text2);font-size:0.8rem;">Enter transaction details (TXID optional).</p>
                <label>Amount (satoshis):</label><br/>
                <input type="number" id="boostAmount" placeholder="1000" style="width:100%;"/><br/>
                <label>TXID (optional):</label><br/>
                <input type="text" id="boostTxid" placeholder="leave blank for placeholder" style="width:100%;"/><br/>
                <label>Expiry (UNIX timestamp, optional):</label><br/>
                <input type="text" id="boostExpiry" placeholder="default 24h" style="width:100%;"/><br/>
                <div style="display:flex; gap:8px; margin-top:12px;">
                    <button class="btn btn-primary" id="confirmBoostBtn">🚀 Boost</button>
                    <button class="btn btn-outline" id="cancelBoostBtn">Cancel</button>
                </div>
            </div>`;
        document.body.appendChild(modalBackdrop);
        modalBackdrop.querySelector('#cancelBoostBtn').addEventListener('click', () => modalBackdrop.remove());
        modalBackdrop.querySelector('#confirmBoostBtn').addEventListener('click', async () => {
            const amount = parseInt(modalBackdrop.querySelector('#boostAmount').value.trim(), 10);
            const txid = modalBackdrop.querySelector('#boostTxid').value.trim() || '0000000000000000000000000000000000000000000000000000000000000000';
            const expiry = modalBackdrop.querySelector('#boostExpiry').value.trim();
            if (isNaN(amount) || amount <= 0) {
                window.showToast('Please enter a valid amount.', 'error');
                return;
            }
            modalBackdrop.remove();

            const dTag = `bchnostr/boost/${eventId}`;
            const now = Math.floor(Date.now() / 1000);
            const expiresAt = expiry ? parseInt(expiry, 10) : (now + 86400);
            const contentObj = {
                eventId,
                tier: 'bid',
                priceSats: amount,
                expiresAt,
                boostedBy: window._currentUser.publicKey,
            };
            const eventTemplate = {
                kind: 30078,
                created_at: now,
                tags: [
                    ['d', dTag],
                    ['t', 'bch-boost'],
                    ['t', 'bch'],
                    ['e', eventId],
                    ['expires', String(expiresAt)],
                    ['amount', String(amount)],
                    ['txid', txid],
                    ['p', eventPubkey || '']
                ],
                content: JSON.stringify(contentObj)
            };
            try {
                const signed = await signNostrEvent(eventTemplate, window._currentUser.privateKey);
                if (window._relayManager) {
                    window._relayManager.publish(signed);
                }
                window.showToast('🚀 Boost published! (txid: ' + (txid === '0000...' ? 'placeholder' : txid) + ')', 'success');
                if (typeof window.injectBoostedEvent === 'function') {
                    window.injectBoostedEvent(signed);
                }
                if (window._investigationHexId) {
                    setTimeout(() => {
                        if (typeof window.runAnalysis === 'function') {
                            window.runAnalysis(window._investigationHexId);
                        }
                    }, 3000);
                }
            } catch (e) {
                window.showToast('Boost error: ' + e.message, 'error');
            }
        });
    };

    // ── Free repost (kind 6) ──
    async function publishBoost(eventId, eventPubkey, eventKind) {
        if (!window._currentUser) {
            window.showToast('Please login first.', 'info');
            if (typeof window.showLoginModal === 'function') window.showLoginModal();
            return;
        }
        if (!window._relayManager) {
            window.showToast('No relay connection.', 'error');
            return;
        }
        const eventTemplate = {
            kind: 6,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['e', eventId],
                ['p', eventPubkey],
                ['k', String(eventKind)]
            ],
            content: ''
        };
        try {
            const signedEvent = await signNostrEvent(eventTemplate, window._currentUser.privateKey);
            window._relayManager.publish(signedEvent);
            if (typeof window.injectBoostedEvent === 'function') {
                window.injectBoostedEvent(signedEvent);
            }
            window.showToast('🚀 Repost sent!', 'success');
            if (typeof window._investigationHexId !== 'undefined' && window._investigationHexId) {
                setTimeout(() => {
                    if (typeof window.runAnalysis === 'function') window.runAnalysis(window._investigationHexId);
                }, 2000);
            }
        } catch (e) { window.showToast('Boost error: ' + e.message, 'error'); }
    }

    window.boostEvent = publishBoost;
})();
