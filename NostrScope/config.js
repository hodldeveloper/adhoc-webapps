// NostrScope configuration
const CONFIG = {
    // Primary relay – always used first for all operations
    primaryRelay: 'wss://relay.bchnostr.com',
    
    // Full relay pool – primary relay listed first, then fallbacks
    relays: [
        'wss://relay.bchnostr.com',
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://relay.nostr.band',
        'wss://purplepag.es',
        'wss://relay.snort.social',
        'wss://nostr.wine',
        'wss://relay.ditto.pub'
    ],
    
    // Feed-specific relays – uses primary relay first, then 2 fallbacks for speed
    feedRelays: [
        'wss://relay.bchnostr.com',
        'wss://relay.damus.io',
        'wss://nos.lol'
    ],
    
    // Analysis relay hints – passed to the investigator when scanning
    analysisRelayHints: ['wss://relay.bchnostr.com'],
    
    earlyStopThreshold: 10,
    maxDepth: 4,
    relayConnectTimeout: 8000,
    profileInvestigationTimeout: 15000,
    quickProfileTimeout: 3000,
    investigationSafetyTimeout: 8000,
    relayRetryCooldownMs: 30000
};
