// NostrScope configuration
const CONFIG = {
    relays: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://relay.nostr.band',
        'wss://purplepag.es',
        'wss://relay.snort.social',
        'wss://nostr.wine',
        'wss://relay.ditto.pub',
        'wss://relay.bchnostr.com'
    ],
    earlyStopThreshold: 10,          // stop event investigation after this many events
    maxDepth: 4,                     // max thread depth
    relayConnectTimeout: 8000,
    profileInvestigationTimeout: 10000,
    quickProfileTimeout: 3000,
    investigationSafetyTimeout: 8000
};
