// NostrScope configuration
const CONFIG = {
    // Relay pool – edit this array to change the relays used by the app
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

    // Event investigation – stop searching after this many events found
    earlyStopThreshold: 10,

    // Maximum depth for thread investigation
    maxDepth: 4,

    // Timeouts (ms)
    relayConnectTimeout: 8000,
    profileInvestigationTimeout: 10000,
    quickProfileTimeout: 3000,
    investigationSafetyTimeout: 8000
};
