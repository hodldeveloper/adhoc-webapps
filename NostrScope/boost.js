/**
 * NostrScope Boost Module
 * Provides a free boost (kind 6 repost) and a robust signing helper.
 * Works with NostrTools global (v2.23.9+).
 */
(function () {
    function getKeyVariants(privateKey) {
        if (typeof ensureHexKey === 'function' && typeof getPrivateKeyVariants === 'function') {
            const normalized = ensureHexKey(privateKey);
            return normalized ? getPrivateKeyVariants(normalized) : [privateKey];
        }
        return [privateKey];
    }

    // Robust signing function that tries multiple methods available in nostr-tools
    async function signNostrEvent(event, privateKey) {
        if (typeof NostrTools === 'undefined') {
            throw new Error('Nostr tools not loaded');
        }

        const keyVariants = getKeyVariants(privateKey);

        // Method 1: signEvent (works in many recent versions)
        if (typeof NostrTools.signEvent === 'function') {
            for (const key of keyVariants) {
                try {
                    return await NostrTools.signEvent(event, key);
                } catch (e) {}
            }
        }

        // Method 2: finalizeEvent (used in some builds)
        if (typeof NostrTools.finalizeEvent === 'function') {
            // finalizeEvent modifies the event and returns it
            for (const key of keyVariants) {
                try {
                    return NostrTools.finalizeEvent(event, key);
                } catch (e) {}
            }
        }

        // Method 3: manual signing using getEventHash and getSignature
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

    // Expose the signing function globally so scripts.js can use it
    window._signNostrEvent = signNostrEvent;

    // Free boost function – publishes a kind 6 repost with no payment
    async function publishBoost(eventId, eventPubkey, eventKind) {
        if (!window._currentUser) {
            window.showToast('Please login first.', 'info');
            if (typeof window.showLoginModal === 'function') {
                window.showLoginModal();
            }
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
            window.showToast('🚀 Boost sent! (free kind 6 repost)', 'success');
            // If the global investigator exists, trigger a re-scan after a short delay
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

    // Expose boost functions globally
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
