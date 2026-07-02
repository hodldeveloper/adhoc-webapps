/**
 * NostrScope - Nostr Event Explorer
 * Vanilla JS, nostr-tools powered, fully browser-based.
 */

// ---------- Global State ----------
const AppState = {
    relays: [],
    connectedRelays: new Set(),
    originalEvent: null,
    relatedEvents: [],
    profiles: {},   // pubkey -> {name, picture, nip05, ...}
    filter: 'all',
    sort: 'newest',
    pool: null,     // nostr-tools SimplePool
    activeSubs: [],
    searchTimeout: null,
    pendingRequests: 0,
};

// ---------- Default Relays ----------
const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.snort.social',
];

// ---------- Helpers ----------
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTimestamp(ts) {
    const date = new Date(ts * 1000);
    return date.toLocaleString();
}

function truncateId(id, n=8) {
    return id ? id.slice(0, n) + '…' : '';
}

// ---------- Input Parsing ----------
function parseEventReference(input) {
    let hex = null;
    let relayHint = null;
    input = input.trim();

    // URL parsing
    if (input.startsWith('http')) {
        try {
            const url = new URL(input);
            const path = url.pathname.split('/');
            const maybeId = path[path.length-1];
            if (maybeId) return parseEventReference(maybeId);
        } catch(e) {}
    }

    // nostr: prefix
    if (input.startsWith('nostr:')) {
        return parseEventReference(input.slice(6));
    }

    // bech32 entities
    if (input.startsWith('note1') || input.startsWith('nevent1')) {
        try {
            const { type, data } = NostrTools.nip19.decode(input);
            if (type === 'note') {
                hex = data;
            } else if (type === 'nevent') {
                hex = data.id;
                relayHint = data.relays?.[0] || null;
            }
        } catch(e) {
            return null;
        }
    } else if (/^[0-9a-fA-F]{64}$/.test(input)) {
        hex = input;
    }
    return hex ? { id: hex, relayHint } : null;
}

// ---------- UI Helpers ----------
function showStatus(message, progress = null) {
    const section = document.getElementById('statusSection');
    const msgDiv = document.getElementById('statusMessages');
    const bar = document.getElementById('progressBar');
    section.style.display = 'block';
    msgDiv.textContent = message;
    if (progress !== null) {
        bar.value = progress;
    }
}

function hideStatus() {
    document.getElementById('statusSection').style.display = 'none';
}

function showError(message) {
    const section = document.getElementById('errorSection');
    const card = document.getElementById('errorCard');
    section.style.display = 'block';
    card.innerHTML = `<strong>⚠️ Error:</strong> ${escapeHTML(message)}`;
}

function hideError() {
    document.getElementById('errorSection').style.display = 'none';
}

function showResults() {
    document.getElementById('resultsPanel').style.display = 'flex';
}

function hideResults() {
    document.getElementById('resultsPanel').style.display = 'none';
}

// ---------- Relay Connection ----------
async function connectToRelays() {
    if (AppState.pool) {
        AppState.pool.close();
    }
    AppState.pool = new NostrTools.SimplePool();
    AppState.connectedRelays.clear();
    // Use stored or default relays
    const stored = localStorage.getItem('nostrscope_relays');
    const relayUrls = stored ? stored.split('\n').map(u => u.trim()).filter(Boolean) : DEFAULT_RELAYS;
    AppState.relays = relayUrls;
    // Connect (nostr-tools handles connection automatically)
    for (const url of relayUrls) {
        try {
            // Ensure relay is in pool
            AppState.pool.ensureRelay(url);
            AppState.connectedRelays.add(url);
        } catch(e) {
            console.warn('Failed to connect relay', url, e);
        }
    }
    return AppState.pool;
}

// ---------- Fetch Original Event ----------
async function fetchOriginalEvent(eventId) {
    showStatus('Connecting to relays...', 5);
    const pool = await connectToRelays();
    showStatus('Fetching original event...', 10);
    const filter = { ids: [eventId] };
    const events = await pool.querySync(AppState.relays, filter, { maxWait: 5000 });
    if (events.length === 0) {
        throw new Error('Event not found on any connected relay.');
    }
    const event = events[0];
    AppState.originalEvent = event;
    await fetchProfiles([event.pubkey]);
    return event;
}

// ---------- Fetch Profiles ----------
async function fetchProfiles(pubkeys) {
    const missing = pubkeys.filter(pk => !AppState.profiles[pk]);
    if (missing.length === 0) return;
    showStatus('Loading profiles...', 30);
    const filter = { kinds: [0], authors: missing };
    const events = await AppState.pool.querySync(AppState.relays, filter, { maxWait: 5000 });
    for (const ev of events) {
        try {
            const meta = JSON.parse(ev.content);
            AppState.profiles[ev.pubkey] = {
                name: meta.name || meta.display_name || truncateId(ev.pubkey),
                picture: meta.picture || '',
                nip05: meta.nip05 || '',
                username: meta.name || '',
                npub: NostrTools.nip19.npubEncode(ev.pubkey),
            };
        } catch(e) {}
    }
    // Fill missing with npub
    for (const pk of missing) {
        if (!AppState.profiles[pk]) {
            AppState.profiles[pk] = {
                name: truncateId(pk),
                picture: '',
                nip05: '',
                username: truncateId(pk),
                npub: NostrTools.nip19.npubEncode(pk),
            };
        }
    }
}

// ---------- Search Related Events ----------
async function searchRelatedEvents(eventId) {
    showStatus('Searching replies, reactions, reposts, zaps...', 40);
    AppState.relatedEvents = [];
    const filters = [
        { kinds: [1, 6, 7, 9735, 9734, 9372], '#e': [eventId] },
        { kinds: [1, 6, 7], '#e': [eventId] }, // replies, reposts, reactions
        { kinds: [9735, 9734], '#e': [eventId] }, // zaps
    ];
    // We'll use a subscription to stream results
    const sub = AppState.pool.sub(AppState.relays, filters);
    AppState.activeSubs.push(sub);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            sub.unsub();
            resolve(AppState.relatedEvents);
        }, 12000); // 12s timeout

        sub.on('event', (event) => {
            // Deduplicate
            if (!AppState.relatedEvents.some(e => e.id === event.id)) {
                AppState.relatedEvents.push(event);
                // Update UI incrementally if results panel already visible?
                // We'll just collect and render later.
            }
            updateProgress();
        });

        sub.on('eose', () => {
            clearTimeout(timeout);
            resolve(AppState.relatedEvents);
        });
    });
}

function updateProgress() {
    const bar = document.getElementById('progressBar');
    const current = bar.value;
    if (current < 95) {
        bar.value = Math.min(current + 5, 95);
    }
}

// ---------- Categorize Events ----------
function categorizeEvents(events) {
    return {
        replies: events.filter(e => e.kind === 1 && e.tags.some(t => t[0] === 'e' && t[1] === AppState.originalEvent?.id)),
        reactions: events.filter(e => e.kind === 7),
        reposts: events.filter(e => e.kind === 6),
        quotes: events.filter(e => e.kind === 1 && e.tags.some(t => t[0] === 'e' && t[1] === AppState.originalEvent?.id) && e.content.includes('nostr:')),
        payments: events.filter(e => [9735, 9734].includes(e.kind)),
        other: events.filter(e => ![1,6,7,9735,9734].includes(e.kind)),
    };
}

// ---------- UI Rendering ----------
function renderOriginalEvent() {
    const event = AppState.originalEvent;
    if (!event) return;
    const profile = AppState.profiles[event.pubkey] || {};
    const container = document.getElementById('originalEventContent');
    const hashtags = event.tags.filter(t => t[0] === 't').map(t => t[1]);
    const images = event.tags.filter(t => t[0] === 'image').map(t => t[1]);
    container.innerHTML = `
        <div class="event-detail">
            <img class="avatar" src="${escapeHTML(profile.picture || '')}" alt="avatar" onerror="this.style.display='none'">
            <div>
                <strong>${escapeHTML(profile.name)}</strong>
                <div class="event-meta">
                    <span>npub: ${escapeHTML(truncateId(profile.npub, 12))}</span>
                    <span>Kind: ${event.kind}</span>
                    <span>${formatTimestamp(event.created_at)}</span>
                    <span>Relay: ${AppState.relays[0] || 'unknown'}</span>
                </div>
            </div>
        </div>
        <div class="event-content">${escapeHTML(event.content)}</div>
        ${images.length ? '<div class="event-images">' + images.map(url => `<img src="${escapeHTML(url)}" alt="image">`).join('') + '</div>' : ''}
        ${hashtags.length ? '<div class="hashtags">' + hashtags.map(h => `<span class="hashtag">#${escapeHTML(h)}</span>`).join('') + '</div>' : ''}
        <div class="event-actions">
            <button class="btn btn-secondary btn-sm raw-json-btn" data-event='${encodeURIComponent(JSON.stringify(event))}'>Raw JSON</button>
            <button class="btn btn-secondary btn-sm copy-json-btn" data-event='${encodeURIComponent(JSON.stringify(event))}'>Copy JSON</button>
            <button class="btn btn-secondary btn-sm download-json-btn" data-event='${encodeURIComponent(JSON.stringify(event))}'>Download JSON</button>
        </div>
    `;
    attachRawJsonListeners(container);
}

function renderStatistics() {
    const categories = categorizeEvents(AppState.relatedEvents);
    const uniqueAuthors = new Set(AppState.relatedEvents.map(e => e.pubkey)).size;
    document.getElementById('statsGrid').innerHTML = `
        <div class="stat-item"><span class="stat-label">Replies</span><span class="stat-value">${categories.replies.length}</span></div>
        <div class="stat-item"><span class="stat-label">Reposts</span><span class="stat-value">${categories.reposts.length}</span></div>
        <div class="stat-item"><span class="stat-label">Reactions</span><span class="stat-value">${categories.reactions.length}</span></div>
        <div class="stat-item"><span class="stat-label">Quotes</span><span class="stat-value">${categories.quotes.length}</span></div>
        <div class="stat-item"><span class="stat-label">Payments</span><span class="stat-value">${categories.payments.length}</span></div>
        <div class="stat-item"><span class="stat-label">Unique Authors</span><span class="stat-value">${uniqueAuthors}</span></div>
        <div class="stat-item"><span class="stat-label">Relays Connected</span><span class="stat-value">${AppState.connectedRelays.size}</span></div>
        <div class="stat-item"><span class="stat-label">Events Loaded</span><span class="stat-value">${AppState.relatedEvents.length}</span></div>
    `;
}

function renderTimeline() {
    const categories = categorizeEvents(AppState.relatedEvents);
    let filtered = AppState.relatedEvents;
    if (AppState.filter === 'replies') filtered = categories.replies;
    else if (AppState.filter === 'reactions') filtered = categories.reactions;
    else if (AppState.filter === 'reposts') filtered = categories.reposts;
    else if (AppState.filter === 'quotes') filtered = categories.quotes;
    else if (AppState.filter === 'payments') filtered = categories.payments;
    else if (AppState.filter === 'other') filtered = categories.other;

    if (AppState.sort === 'newest') filtered.sort((a,b) => b.created_at - a.created_at);
    else filtered.sort((a,b) => a.created_at - b.created_at);

    document.getElementById('eventCount').textContent = `${filtered.length} events`;
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = filtered.map(event => {
        const profile = AppState.profiles[event.pubkey] || {};
        let categoryClass = '';
        if (categories.replies.includes(event)) categoryClass = 'reply';
        else if (categories.reactions.includes(event)) categoryClass = 'reaction';
        else if (categories.reposts.includes(event)) categoryClass = 'repost';
        else if (categories.quotes.includes(event)) categoryClass = 'quote';
        else if (categories.payments.includes(event)) categoryClass = 'payment';

        return `
            <div class="timeline-item ${categoryClass}">
                <div>
                    <span class="timeline-item-author">${escapeHTML(profile.name)}</span>
                    <span class="timeline-item-time">${formatTimestamp(event.created_at)} · Kind ${event.kind}</span>
                </div>
                <div class="timeline-item-content">${escapeHTML(event.content)}</div>
                <button class="btn btn-secondary btn-sm raw-json-btn" data-event='${encodeURIComponent(JSON.stringify(event))}' style="margin-top:0.3rem">Raw JSON</button>
            </div>
        `;
    }).join('');
    attachRawJsonListeners(timeline);
}

function attachRawJsonListeners(parent) {
    parent.querySelectorAll('.raw-json-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const eventJson = decodeURIComponent(btn.dataset.event);
            openJsonModal(eventJson);
        });
    });
    parent.querySelectorAll('.copy-json-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const eventJson = decodeURIComponent(btn.dataset.event);
            navigator.clipboard.writeText(eventJson).then(() => alert('Copied!'));
        });
    });
    parent.querySelectorAll('.download-json-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const eventJson = decodeURIComponent(btn.dataset.event);
            const blob = new Blob([eventJson], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `event-${AppState.originalEvent.id.slice(0,8)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    });
}

// ---------- Export Functions ----------
function exportOriginalJSON() {
    if (!AppState.originalEvent) return;
    const json = JSON.stringify(AppState.originalEvent, null, 2);
    downloadFile(`original-${AppState.originalEvent.id.slice(0,8)}.json`, json);
}

function exportRelatedJSON() {
    const json = JSON.stringify(AppState.relatedEvents, null, 2);
    downloadFile(`related-${AppState.originalEvent.id.slice(0,8)}.json`, json);
}

function exportCombinedJSON() {
    const combined = {
        original: AppState.originalEvent,
        related: AppState.relatedEvents,
        stats: {
            replies: categorizeEvents(AppState.relatedEvents).replies.length,
            reactions: categorizeEvents(AppState.relatedEvents).reactions.length,
            reposts: categorizeEvents(AppState.relatedEvents).reposts.length,
        }
    };
    downloadFile(`combined-${AppState.originalEvent.id.slice(0,8)}.json`, JSON.stringify(combined, null, 2));
}

function exportCSV() {
    const events = [AppState.originalEvent, ...AppState.relatedEvents];
    let csv = 'id,pubkey,kind,created_at,content\n';
    events.forEach(e => {
        csv += `"${e.id}","${e.pubkey}",${e.kind},${e.created_at},"${e.content.replace(/"/g, '""')}"\n`;
    });
    downloadFile(`nostrscope-${AppState.originalEvent.id.slice(0,8)}.csv`, csv);
}

function downloadFile(filename, content) {
    const blob = new Blob([content], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ---------- JSON Modal ----------
function openJsonModal(jsonStr) {
    document.getElementById('jsonViewer').textContent = jsonStr;
    document.getElementById('jsonModal').style.display = 'flex';
}
function closeJsonModal() {
    document.getElementById('jsonModal').style.display = 'none';
}

// ---------- Relay Settings Modal ----------
function openRelayModal() {
    const textarea = document.getElementById('relayTextarea');
    textarea.value = AppState.relays.join('\n');
    document.getElementById('relayModal').style.display = 'flex';
}
function closeRelayModal() {
    document.getElementById('relayModal').style.display = 'none';
}
function saveRelays() {
    const textarea = document.getElementById('relayTextarea');
    const urls = textarea.value.split('\n').map(u => u.trim()).filter(Boolean);
    localStorage.setItem('nostrscope_relays', urls.join('\n'));
    AppState.relays = urls;
    closeRelayModal();
    // Reconnect on next search
}

// ---------- Main Flow ----------
async function analyzeEvent() {
    hideError();
    hideResults();
    const input = document.getElementById('eventInput').value.trim();
    if (!input) {
        showError('Please enter a Nostr event identifier.');
        return;
    }
    const parsed = parseEventReference(input);
    if (!parsed) {
        showError('Invalid Nostr reference. Use note1, nevent1, hex ID, or URL.');
        return;
    }
    try {
        // Reset state
        AppState.originalEvent = null;
        AppState.relatedEvents = [];
        AppState.profiles = {};
        AppState.activeSubs.forEach(s => s.unsub());
        AppState.activeSubs = [];

        const event = await fetchOriginalEvent(parsed.id);
        showStatus('Searching related events...', 50);
        await searchRelatedEvents(parsed.id);
        showStatus('Complete.', 100);
        setTimeout(() => {
            hideStatus();
            showResults();
            renderAll();
        }, 300);
    } catch (err) {
        hideStatus();
        showError(err.message || 'An unknown error occurred.');
        console.error(err);
    }
}

function renderAll() {
    if (!AppState.originalEvent) return;
    renderOriginalEvent();
    renderStatistics();
    renderTimeline();
}

function clearAll() {
    document.getElementById('eventInput').value = '';
    hideResults();
    hideError();
    hideStatus();
    AppState.originalEvent = null;
    AppState.relatedEvents = [];
    AppState.profiles = {};
    AppState.activeSubs.forEach(s => s.unsub());
    AppState.activeSubs = [];
}

// ---------- Event Listeners ----------
document.addEventListener('DOMContentLoaded', () => {
    // Load stored relays or defaults
    const stored = localStorage.getItem('nostrscope_relays');
    AppState.relays = stored ? stored.split('\n').map(u => u.trim()).filter(Boolean) : DEFAULT_RELAYS;

    // Buttons
    document.getElementById('analyzeBtn').addEventListener('click', analyzeEvent);
    document.getElementById('clearBtn').addEventListener('click', clearAll);
    document.getElementById('copyIdBtn').addEventListener('click', () => {
        const input = document.getElementById('eventInput');
        if (AppState.originalEvent) {
            navigator.clipboard.writeText(AppState.originalEvent.id).then(() => alert('Event ID copied!'));
        } else if (input.value.trim()) {
            const parsed = parseEventReference(input.value.trim());
            if (parsed) navigator.clipboard.writeText(parsed.id).then(() => alert('Event ID copied!'));
            else alert('Could not parse event ID.');
        }
    });

    // Filter chips
    document.getElementById('filterChips').addEventListener('click', (e) => {
        if (e.target.classList.contains('chip')) {
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            AppState.filter = e.target.dataset.filter;
            renderTimeline();
        }
    });

    // Sort order
    document.getElementById('sortOrder').addEventListener('change', (e) => {
        AppState.sort = e.target.value;
        renderTimeline();
    });

    // Export buttons
    document.getElementById('exportOriginalJson').addEventListener('click', exportOriginalJSON);
    document.getElementById('exportRelatedJson').addEventListener('click', exportRelatedJSON);
    document.getElementById('exportCombinedJson').addEventListener('click', exportCombinedJSON);
    document.getElementById('exportCsv').addEventListener('click', exportCSV);

    // Relay settings modal
    document.getElementById('relaySettingsBtn').addEventListener('click', openRelayModal);
    document.getElementById('relaySaveBtn').addEventListener('click', saveRelays);
    document.getElementById('relayResetBtn').addEventListener('click', () => {
        document.getElementById('relayTextarea').value = DEFAULT_RELAYS.join('\n');
        localStorage.setItem('nostrscope_relays', DEFAULT_RELAYS.join('\n'));
        AppState.relays = DEFAULT_RELAYS;
        closeRelayModal();
    });
    document.getElementById('relayCancelBtn').addEventListener('click', closeRelayModal);

    // JSON modal
    document.getElementById('jsonCloseBtn').addEventListener('click', closeJsonModal);
    document.getElementById('jsonCopyBtn').addEventListener('click', () => {
        const text = document.getElementById('jsonViewer').textContent;
        navigator.clipboard.writeText(text).then(() => alert('Copied!'));
    });
    document.getElementById('jsonDownloadBtn').addEventListener('click', () => {
        const text = document.getElementById('jsonViewer').textContent;
        const blob = new Blob([text], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'event.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    // Close modals on overlay click
    document.getElementById('relayModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('relayModal')) closeRelayModal();
    });
    document.getElementById('jsonModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('jsonModal')) closeJsonModal();
    });
});
