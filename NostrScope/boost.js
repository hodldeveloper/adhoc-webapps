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
            // Publish to all connected relays
            window._relayManager.publish(signedEvent);

            // Immediately inject the new event into the UI
            if (typeof window.injectBoostedEvent === 'function') {
                window.injectBoostedEvent(signedEvent);
            }

            window.showToast('🚀 Boost sent!', 'success');

            // Still re-fetch after a few seconds to catch any other events
            if (typeof window._investigationHexId !== 'undefined' && window._investigationHexId) {
                setTimeout(() => {
                    if (typeof window.runAnalysis === 'function') {
                        window.runAnalysis(window._investigationHexId);
                    }
                }, 2000);
            }
        } catch (e) {
            window.showToast('Boost error: ' + e.message, 'error');
        }
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
