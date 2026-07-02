(function() {
    // ── Constants ────────────────────
    const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const BECH32_ALPHABET_MAP = {};
    for (let i = 0; i < BECH32_ALPHABET.length; i++) BECH32_ALPHABET_MAP[BECH32_ALPHABET[i]] = i;
    const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    const HEX_CHARS = '0123456789abcdef';
    const DEFAULT_RELAYS = [
        'wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol',
        'wss://relay.primal.net', 'wss://purplepag.es', 'wss://relay.nostr.net',
        'wss://bostr.fount.org', 'wss://relay.plebstr.com', 'wss://offchain.pub',
        'wss://relay.snort.social'
    ];
    const KNOWN_KINDS = {
        0: 'Profile Metadata', 1: 'Text Note', 2: 'Recommend Relay', 3: 'Follow List',
        4: 'Encrypted DM', 5: 'Deletion Request', 6: 'Repost', 7: 'Reaction',
        8: 'Badge Award', 16: 'Generic Repost', 40: 'Channel Creation',
        41: 'Channel Metadata', 42: 'Channel Message', 43: 'Channel Hide Message',
        44: 'Channel Mute User', 1984: 'Report', 3000: 'Follow Sets',
        3001: 'Bookmark Sets', 3002: 'Relay Sets', 3003: 'Bookmark Sets v2',
        9734: 'Zap Receipt', 9735: 'Zap Event', 10000: 'Mute List',
        10001: 'Pin List', 10002: 'Relay List Metadata', 13194: 'Wallet Info',
        22242: 'Auth Request', 23194: 'Wallet Request', 23195: 'Wallet Response',
        27235: 'BCH Tip'
    };

    // ── State ─────────────────────────
    let allEvents = [], originalEvent = null, eventMap = new Map(), relayStats = new Map();
    let activeRelays = [...DEFAULT_RELAYS], investigationHexId = null;
    let threadCollapsed = new Set(), sortOrder = 'oldest-first';
    let relayManager = null, investigator = null;
    let currentUser = null;   // { privateKey, publicKey }

    // ── DOM Elements ──────────────────
    const homeScreen = document.getElementById('homeScreen'),
        resultsScreen = document.getElementById('resultsScreen');
    const homeSearchInput = document.getElementById('homeSearchInput'),
        resultsSearchInput = document.getElementById('resultsSearchInput');
    const homeAnalyzeBtn = document.getElementById('homeAnalyzeBtn'),
        homeClearBtn = document.getElementById('homeClearBtn');
    const homeLuckyBtn = document.getElementById('homeLuckyBtn'),
        errorMsg = document.getElementById('errorMsg');
    const loadingOverlay = document.getElementById('loadingOverlay'),
        loadingText = document.getElementById('loadingText');
    const tabsNav = document.getElementById('tabsNav'),
        toastContainer = document.getElementById('toastContainer');
    const modalContainer = document.getElementById('modalContainer');
    const resultsSearchBtn = document.getElementById('resultsSearchBtn');
    const resultsLoginBtn = document.getElementById('resultsLoginBtn'),
        resultsLogoutBtn = document.getElementById('resultsLogoutBtn');
    const resultsUserStatus = document.getElementById('resultsUserStatus');
    const homeLoginBtn = document.getElementById('homeLoginBtn'),
        homeLogoutBtn = document.getElementById('homeLogoutBtn');
    const homeUserStatus = document.getElementById('homeUserStatus');

    // ── Bech32 & Utilities ────────────
    function bech32Polymod(values) {
        let chk = 1;
        for (let i = 0; i < values.length; i++) {
            const top = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ values[i];
            for (let j = 0; j < 5; j++) if ((top >> j) & 1) chk ^= BECH32_GENERATOR[j];
        }
        return chk;
    }
    function bech32HRPExpand(hrp) { const r = []; for (let i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) >> 5);
        r.push(0); for (let i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) & 31); return r; }
    function bech32Decode(str) {
        const sep = str.lastIndexOf('1');
        if (sep < 1 || sep + 7 > str.length) return null;
        const hrp = str.substring(0, sep), data = str.substring(sep + 1), vals = [];
        for (let i = 0; i < data.length; i++) { if (!(data[i] in BECH32_ALPHABET_MAP)) return null;
            vals.push(BECH32_ALPHABET_MAP[data[i]]); }
        const comb = bech32HRPExpand(hrp).concat(vals);
        if (bech32Polymod(comb) !== 1) return null;
        const payload = vals.slice(0, -6), bytes = [];
        let bits = 0, accum = 0;
        for (let i = 0; i < payload.length; i++) { accum = (accum << 5) | payload[i];
            bits += 5; while (bits >= 8) { bits -= 8;
                bytes.push((accum >> bits) & 0xff); } }
        if (bits >= 5 || accum & ((1 << bits) - 1)) return null;
        return { hrp, bytes };
    }
    function bech32Encode(hrp, data) { const combined = bech32HRPExpand(hrp).concat(data); const polymod = bech32Polymod(
            combined) ^ 1; const checksum = []; for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) &
        31); return hrp + '1' + data.map(v => BECH32_ALPHABET[v]).join('') + checksum.map(v => BECH32_ALPHABET[v]).join(
            ''); }
    function hexToBytes(hex) { const bytes = []; for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substring(
            i, i + 2), 16)); return bytes; }
    function bytesToHex(bytes) { let h = ''; for (let i = 0; i < bytes.length; i++) { h += HEX_CHARS[(bytes[i] >> 4) &
            0xf];
            h += HEX_CHARS[bytes[i] & 0xf]; } return h; }
    function isValidHex64(s) { return /^[0-9a-fA-F]{64}$/.test(s); }
    function npubFromHex(pubkeyHex) { const data = [0]; for (const b of hexToBytes(pubkeyHex)) data.push(b); return bech32Encode(
            'npub', data); }
    function escapeHtml(str) { const d = document.createElement('div');
        d.textContent = str; return d.innerHTML; }
    function syntaxHighlight(json) { return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
            /("(\\u[\da-fA-F]{4}|\\[^u]|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
            m => { let c = 'json-number'; if (/^"/.test(m)) c = /:$/.test(m) ? 'json-key' : 'json-string'; else if (
                    /true|false/.test(m)) c = 'json-boolean'; else if (/null/.test(m)) c = 'json-null'; return `<span class="${c}">${m}</span>`; }); }
    function downloadFile(content, filename, mime) { const b = new Blob([content], { type: mime }); const a = document
            .createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a); }

    // ── Input Parser ──────────────────
    function parseInput(input) {
        const t = input.trim(); if (!t) return { error: 'Please enter an event identifier.' }; if (isValidHex64(t))
            return { hexId: t.toLowerCase(), source: 'hex' }; if (t.startsWith('note1')) { const h = decodeNote1(t); if (
                h) return { hexId: h, source: 'note1' }; return { error: 'Invalid note1 identifier.' }; } if (t.startsWith(
                'nevent1')) { const r = decodeNevent1(t); if (r && r.eventId) return { hexId: r.eventId,
                source: 'nevent1', relayHints: r.relayHints || [] }; return { error: 'Invalid nevent1 identifier.' }; } if (
            t.startsWith('npub1') || t.startsWith('nprofile1')) return { error: 'Profile identifier. Use event ID (note/nevent/hex).' };
        const nostrUri = t.match(
            /^nostr:(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)$/i); if (
            nostrUri) return parseInput(nostrUri[1]);
        let m;
        m = t.match(
            /https?:\/\/njump\.me\/(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)/i); if (m) return parseInput(m[1]);
        m = t.match(/https?:\/\/primal\.net\/e\/(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)/i); if (m) return parseInput(m[1]);
        m = t.match(/https?:\/\/bchnostr\.com\/note\/([0-9a-fA-F]{64})/i); if (m) return parseInput(m[1]);
        m = t.match(
            /https?:\/\/snort\.social\/e\/(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)/i); if (m) return parseInput(m[1]);
        m = t.match(
            /https?:\/\/coracle\.social\/(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)/i); if (m) return parseInput(m[1]);
        m = t.match(
            /https?:\/\/iris\.to\/(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)/i); if (m) return parseInput(m[1]);
        m = t.match(
            /https?:\/\/damus\.io\/(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)/i); if (m) return parseInput(m[1]);
        m = t.match(
            /https?:\/\/[^\s]*(note1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{40,}|nevent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{40,})/i); if (m) return parseInput(m[1]);
        m = t.match(/https?:\/\/[^\s]*\/([0-9a-fA-F]{64})(?:\/|\?|#|$)/i); if (m) return parseInput(m[1]);
        return { error: 'Unable to parse input.' };
    }
    function decodeNote1(s) { const d = bech32Decode(s); if (!d || d.hrp !== 'note' || d.bytes.length !== 32) return null;
        return bytesToHex(d.bytes); }
    function decodeNevent1(s) { const d = bech32Decode(s); if (!d || d.hrp !== 'nevent' || d.bytes.length < 32) return null;
        const eid = bytesToHex(d.bytes.slice(0, 32)); const tlvs = []; let idx = 32; while (idx < d.bytes.length) { if (
                idx + 2 > d.bytes.length) break; const t = d.bytes[idx], l = d.bytes[idx + 1];
            idx += 2; if (idx + l > d.bytes.length) break;
            tlvs.push({ type: t, value: d.bytes.slice(idx, idx + l) });
            idx += l; } const hints = tlvs.filter(t => t.type === 1 || t.type === 2).map(t => new TextDecoder().decode(
            new Uint8Array(t.value))); return { eventId: eid, relayHints: hints }; }

    // ── Toast / Loading ────────────────
    function showToast(msg, type = 'info') { const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.textContent = msg;
        toastContainer.appendChild(t);
        setTimeout(() => { t.style.opacity = '0';
            setTimeout(() => t.remove(), 300); }, 3500); }
    function showLoading(text) { loadingText.textContent = text;
        loadingOverlay.classList.add('active'); }
    function hideLoading() { loadingOverlay.classList.remove('active'); }
    function showError(msg) { errorMsg.textContent = msg;
        errorMsg.classList.add('visible'); }
    function hideError() { errorMsg.textContent = '';
        errorMsg.classList.remove('visible'); }

    // ── Relay Manager ──────────────────
    class RelayManager { constructor(urls) { this.relayUrls = urls;
            this.connections = new Map();
            this.subscriptions = new Map();
            this.subIdCounter = 0; } getNextSubId() { return 'sub_' + ++this.subIdCounter; } async connectAll(ms = 8000) { await Promise
                .allSettled(this.relayUrls.map(u => this.connect(u, ms))); } async connect(url, ms = 8000) { if (this.connections
                .has(url)) { const ex = this.connections.get(url); if (ex.ws && ex.ws.readyState === WebSocket.OPEN)
                    return ex.ws; }
            relayStats.set(url, { status: 'connecting', events: 0, errors: 0, responseTime: null,
                startTime: Date.now() }); return new Promise((res, rej) => { try { const ws = new WebSocket(url);
                    const to = setTimeout(() => { ws.close();
                        relayStats.set(url, { status: 'failed', errors: 1 });
                        rej(new Error('timeout')); }, ms);
                    ws.onopen = () => { clearTimeout(to);
                        relayStats.set(url, { status: 'connected', events: 0, errors: 0,
                            responseTime: Date.now() - (relayStats.get(url)?.startTime || Date.now()) });
                        this.connections.set(url, { ws, pendingSubs: new Set() });
                        res(ws); };
                    ws.onerror = () => { clearTimeout(to);
                        relayStats.set(url, { status: 'failed', errors: 1 });
                        rej(new Error('error')); };
                    ws.onclose = () => { const cur = relayStats.get(url) || {}; if (cur.status === 'connecting')
                            relayStats.set(url, { ...cur, status: 'failed', errors: 1 }); else if (cur.status ===
                            'connected') relayStats.set(url, { ...cur, status: 'disconnected' });
                        this.connections.delete(url); };
                    ws.onmessage = m => this.handleMessage(url, m); } catch (e) { relayStats.set(url, { status: 'failed',
                        events: 0, errors: 1, responseTime: null, startTime: Date.now() });
                    rej(e); } }); }
        handleMessage(url, msg) { try { const d = JSON.parse(msg.data); if (d[0] === 'EVENT' && d[1] && d[2]) { const s =
                        relayStats.get(url) || { events: 0 };
                    s.events++;
                    relayStats.set(url, s); if (this.onEvent) this.onEvent(d[2], url, d[1]); } if (d[0] === 'EOSE' && d[
                    1] && this.onEOSE) this.onEOSE(d[1], url); if (d[0] === 'NOTICE') { const s = relayStats.get(
                    url) || { errors: 0 };
                    s.errors++;
                    relayStats.set(url, s); } } catch (e) {} }
        subscribe(filters, url = null) { const subId = this.getNextSubId(), msg = JSON.stringify(['REQ', subId,
                ...filters
            ]); const targets = url ? [url] : this.relayUrls, pending = new Set(); for (const u of targets) { const c = this
                    .connections.get(u); if (c && c.ws && c.ws.readyState === WebSocket.OPEN) { c.ws.send(msg);
                    c.pendingSubs.add(subId);
                    pending.add(u); } }
            this.subscriptions.set(subId, { filters, pendingSubs: pending, createdAt: Date.now() }); return subId; }
        closeSubscription(subId) { for (const [u, c] of this.connections) { if (c.ws && c.ws.readyState === WebSocket
                .OPEN) { c.ws.send(JSON.stringify(['CLOSE', subId]));
                    c.pendingSubs.delete(subId); } }
            this.subscriptions.delete(subId); }
        closeAll() { for (const s of this.subscriptions.keys()) this.closeSubscription(s); for (const [u, c] of this
                .connections) if (c.ws) c.ws.close();
            this.connections.clear();
            this.subscriptions.clear(); }
        reconnect(url) { const c = this.connections.get(url); if (c && c.ws) try { c.ws.close(); } catch (e) {} this.connections
                .delete(url); return this.connect(url); }
        publish(event) { const msg = JSON.stringify(['EVENT', event]); for (const [url, conn] of this.connections) { if (
                    conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.send(msg); } } }

    // ── Event Investigator ──────────────
    class EventInvestigator { constructor(rm) { this.rm = rm;
            this.events = [];
            this.eventMap = new Map();
            this.originalEvent = null;
            this.hexId = null;
            this.pendingSubs = new Set();
            this.allDone = false;
            this.onUpdate = null;
            this.onComplete = null;
            this.investigationDepth = 0;
            this.maxDepth = 4; } async investigate(hexId, hints = []) { this.hexId = hexId;
            this.events = [];
            this.eventMap.clear();
            this.originalEvent = null;
            this.pendingSubs.clear();
            this.allDone = false;
            this.investigationDepth = 0; const allRelays = [...new Set([...activeRelays, ...hints])];
            this.rm.relayUrls = allRelays;
            this.rm.connections.clear();
            this.rm.subscriptions.clear();
            relayStats.clear(); for (const u of allRelays) relayStats.set(u, { status: 'pending', events: 0, errors: 0,
                responseTime: null, startTime: Date.now() });
            this.rm.onEvent = (ev, url, sub) => { this.addEvent(ev); if (this.onUpdate) this.onUpdate(this); };
            this.rm.onEOSE = (subId, url) => { const sub = this.rm.subscriptions.get(subId); if (sub) { sub.pendingSubs
                        .delete(url); if (sub.pendingSubs.size === 0) { this.pendingSubs.delete(subId);
                        this.rm.closeSubscription(subId); if (this.pendingSubs.size === 0) this.onAllEOSE(); } } };
            showLoading('Connecting to relays...'); await this.rm.connectAll(10000); const connected = [...relayStats
                .values()
            ].filter(s => s.status === 'connected').length; if (connected === 0) { hideLoading();
                showToast('No relays connected.', 'error'); if (this.onComplete) this.onComplete(this); return; }
            showLoading(`Fetching event from ${connected} relays...`);
            this.pendingSubs.add(this.rm.subscribe([{ ids: [hexId] }]));
            this.pendingSubs.add(this.rm.subscribe([{ '#e': [hexId], limit: 200 }]));
            this.pendingSubs.add(this.rm.subscribe([{ kinds: [6], '#e': [hexId], limit: 100 }]));
            this.pendingSubs.add(this.rm.subscribe([{ kinds: [7], '#e': [hexId], limit: 200 }]));
            this.pendingSubs.add(this.rm.subscribe([{ kinds: [9735], '#e': [hexId], limit: 100 }]));
            this.pendingSubs.add(this.rm.subscribe([{ kinds: [9734], '#e': [hexId], limit: 100 }]));
            this.pendingSubs.add(this.rm.subscribe([{ kinds: [5], '#e': [hexId], limit: 50 }])); setTimeout(() => { if (
                    this.pendingSubs.size > 0) { for (const s of this.pendingSubs) this.rm.closeSubscription(s);
                    this.pendingSubs.clear();
                    this.onAllEOSE(); } }, 15000); }
        addEvent(ev) { if (this.eventMap.has(ev.id)) return;
            this.eventMap.set(ev.id, ev);
            this.events.push(ev); if (ev.id === this.hexId && !this.originalEvent) this.originalEvent = ev; if (this
                .investigationDepth < this.maxDepth && ev.kind === 1) { const targets = this.extractReplyTargets(
                ev); for (const rid of targets) { if (!this.eventMap.has(rid) && rid !== this.hexId) { this.pendingSubs
                        .add(this.rm.subscribe([{ ids: [rid] }]));
                    this.pendingSubs.add(this.rm.subscribe([{ '#e': [rid], limit: 100 }]));
                    this.investigationDepth++; } } } }
        extractReplyTargets(ev) { const t = []; if (ev.tags) for (const tag of ev.tags) if (tag[0] === 'e' && tag[1] &&
                isValidHex64(tag[1])) t.push(tag[1]); return t; }
        onAllEOSE() { this.allDone = true;
            hideLoading(); const msg = this.originalEvent ?
                `Investigation complete: ${this.events.length} events found.` : (this.events.length > 0 ?
                    `Original not found, but ${this.events.length} related events.` : 'No events found.');
            showToast(msg, this.originalEvent ? 'success' : 'info'); if (this.onComplete) this.onComplete(this); }
        getThreadTree() { if (!this.hexId) return null; const root = this.eventMap.get(this.hexId) || this
            .originalEvent; if (!root && this.events.length === 0) return null; const children = new Map(); for (const e of this
                .events) { if (e.id === this.hexId) continue; const pids = this.getParentIds(e); for (const pid of pids) { if (
                        !children.has(pid)) children.set(pid, []); if (!children.get(pid).find(x => x.id === e.id)) children.get(
                        pid).push(e); } } for (const [pid, c] of children) c.sort((a, b) => (a.created_at || 0) - (b
                .created_at || 0)); return { rootId: this.hexId, rootEvent: root, childrenMap: children }; }
        getParentIds(ev) { const ids = []; if (ev.tags) { const eTags = ev.tags.filter(t => t[0] === 'e' && t[1] &&
                    isValidHex64(t[1])); if (eTags.length > 0) { const reply = eTags.find(t => t[3] === 'reply'), root =
                        eTags.find(t => t[3] === 'root'); if (reply) ids.push(reply[1]); else if (eTags.length === 1) ids
                    .push(eTags[0][1]); else if (eTags.length >= 2) ids.push(eTags[eTags.length - 1][1]); if (root && root[
                        1] !== ids[0]) ids.push(root[1]); } } if (ids.length === 0 && this.hexId && ev.content && ev.content
                .includes(this.hexId)) ids.push(this.hexId); return [...new Set(ids)]; }
        getEventsByKind(k) { return this.events.filter(e => e.kind === k); }
        getUnknownEvents() { return this.events.filter(e => !KNOWN_KINDS[e.kind]); }
        getUniqueAuthors() { return new Set(this.events.map(e => e.pubkey)).size; }
        getMediaCounts() { let im = 0,
                vi = 0,
                at = 0; for (const e of this.events) { if (e.tags) for (const t of e.tags) if (t[0] === 'imeta') { const u = t
                            .find(x => x.startsWith('url ')); if (u) { const url = u.split(' ')[1] || ''; if (/\.(jpg|jpeg|png|gif|webp|svg)/i
                            .test(url)) im++; else if (/\.(mp4|mov|webm|avi)/i.test(url)) vi++; else at++; } } if (e
                        .content) { const m = e.content.match(
                            /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg)/gi); if (m) im += m.length; const v = e.content
                            .match(/https?:\/\/[^\s]+\.(mp4|mov|webm|avi)/gi); if (v) vi += v.length; } } return { images: im,
                    videos: vi, attachments: at }; }
        getHashtags() { const s = new Set(); for (const e of this.events) { if (e.tags) for (const t of e.tags) if (t[0] ===
                    't' && t[1]) s.add(t[1].toLowerCase()); if (e.content) { const m = e.content.match(/#(\w+)/g); if (m) m
                    .forEach(x => s.add(x.slice(1).toLowerCase())); } } return s.size; }
        getLinks() { let c = 0; for (const e of this.events) { if (e.content) { const m = e.content.match(
                    /https?:\/\/[^\s]+/g); if (m) c += m.length; } } return c; }
        getBchPaymentEvents() { const res = []; for (const e of this.events) { if (e.kind === 9735) res.push({ ...e,
                    paymentType: 'zap' }); else if (e.kind === 9734) res.push({ ...e,
                paymentType: 'zap_receipt' }); else if (e.kind === 27235) res.push({ ...e,
                paymentType: 'bch_tip' }); else if (e.tags && e.tags.some(t => t[0] === 'cashtoken' || t[0] ===
                    'bch' || t[0] === 'txid')) res.push({ ...e, paymentType: 'bch_payment' }); else if (e.content &&
                /\b(bch|bitcoincash|cashtoken)\b/i.test(e.content) && /[13][a-km-zA-HJ-NP-Z1-9]{25,34}/.test(e
                .content)) res.push({ ...e, paymentType: 'possible_bch' }); } return res; } }

    // ── Helper: media extraction ─────────
    function renderMediaFromContent(content) { if (!content) return { text: '', media: '' }; const urlRegex =
            /(https?:\/\/[^\s]+)/g;
        let html = escapeHtml(content);
        let mediaHtml = '';
        let match; while ((match = urlRegex.exec(content)) !== null) { const url = match[0]; if (/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i
                .test(url)) { mediaHtml +=
                `<img src="${url}" alt="Image" loading="lazy" style="max-width:100%;max-height:200px;border-radius:4px;display:block;margin:4px 0;" onerror="this.style.display='none'">`; } else if (/\.(mp4|webm|ogg)(\?.*)?$/i
                .test(url)) { mediaHtml +=
                `<video controls preload="metadata" style="max-width:100%;max-height:200px;display:block;margin:4px 0;"><source src="${url}" type="video/mp4"></video>`; } }
        html = html.replace(urlRegex, (u) => { if (/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|ogg)(\?.*)?$/i.test(u))
            return ''; return `<a href="${u}" target="_blank" rel="noopener" style="color:var(--blue);word-break:break-all;">${u}</a>`; });
        return { text: html, media: mediaHtml }; }

    // ── Thread View (tree with cards) ────
    function buildThreadCards(eventId, childrenMap, depth, visited) { if (visited.has(eventId) && depth > 0)
        return ''; visited.add(eventId); const event = eventMap.get(eventId); if (!event && depth > 0) return ''; if (
            threadCollapsed.has(eventId) && depth > 0) { return `<div class="tree-collapsed" onclick="window._expandThread('${eventId}')" style="margin-left:${depth*20}px;">[+] Show replies</div>`; } const isOriginal =
            eventId === investigationHexId; const { text, media } = renderMediaFromContent(event.content); const kindName =
            KNOWN_KINDS[event.kind] || `Kind ${event.kind}`; const time = new Date((event.created_at || 0) * 1000)
            .toLocaleString(); const authorShort = event.pubkey ? event.pubkey.substring(0, 8) + '...' : 'unknown'; const
        contentId = 'c-' + event.id; const isLong = (event.content || '').length > 250;
        let cardHtml = `<div class="tree-card" style="margin-left:${depth*20}px;">
            <div class="event-preview">
                <div class="event-header">
                    <span class="event-kind-badge">${isOriginal ? '★ Original' : kindName}</span>
                    <span class="event-time">${time}</span>
                    <span class="event-author">${authorShort}</span>
                </div>
                <div class="event-content" id="${contentId}" style="${isLong ? 'max-height:100px;' : ''}">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>
                ${isLong ? `<span class="show-more-btn" onclick="document.getElementById('${contentId}').style.maxHeight='none'; this.style.display='none';">Show more</span>` : ''}
                ${media ? `<div class="media-preview">${media}</div>` : ''}
                <div class="thread-actions">
                    <button class="btn btn-small btn-secondary" onclick="window._inspectEvent('${event.id}')">JSON</button>
                    ${currentUser ? `<button class="btn btn-small btn-primary" onclick="window._boostEvent('${event.id}')">🚀 Boost</button>` : ''}
                </div>
            </div>
        </div>`; let html = cardHtml; const children = childrenMap.get(eventId) || []; if (children.length > 0) { html +=
            `<div class="tree-branch">`; for (const child of children) { html += buildThreadCards(child.id, childrenMap,
                depth + 1, new Set(visited)); } html += `</div>`; } return html; }

    function renderThread(inv) { const p = document.getElementById('panel-thread'); const tree = inv.getThreadTree(); if (
            !tree || !tree.rootEvent) { p.innerHTML = '<div class="card"><p>No thread data.</p></div>'; return; }
        let html =
            '<div class="card"><div class="card-header"><span class="card-title">🌳 Thread View</span><div style="display:flex; gap:8px;"><button class="btn btn-small btn-secondary" onclick="window._expandAll()">Expand All</button><button class="btn btn-small btn-secondary" onclick="window._collapseAll()">Collapse All</button></div></div><div class="thread-tree-container">';
        html += buildThreadCards(tree.rootId, tree.childrenMap, 0, new Set());
        html += '</div></div>';
        p.innerHTML = html; }

    // ── Timeline (cards with left border) ──
    function renderTimeline(inv) { const p = document.getElementById('panel-timeline'); const sorted = [...inv.events].sort((
            a, b) => sortOrder === 'newest-first' ? (b.created_at || 0) - (a.created_at || 0) : (a.created_at || 0) - (b
            .created_at || 0)); if (!sorted.length) { p.innerHTML = '<div class="card"><p>No events.</p></div>'; return; }
        let html =
            '<div class="card"><div class="card-header"><span class="card-title">⏱ Timeline</span><button class="btn btn-small btn-secondary" onclick="window._toggleSortOrder()">Sort: ' +
            (sortOrder === 'oldest-first' ? 'Oldest First ▲' : 'Newest First ▼') +
            '</button></div><div class="timeline-list">';
        sorted.forEach(e => { const time = new Date((e.created_at || 0) * 1000).toLocaleTimeString([], { hour: '2-digit',
                minute: '2-digit', second: '2-digit' }); const kind = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`; const
            isOrig = e.id === investigationHexId; const { text, media } = renderMediaFromContent(e.content);
            let borderClass = 'reply-post'; if (isOrig) borderClass = 'original-post'; else if (e.kind === 6) borderClass =
                'repost-post';
            html += `<div class="timeline-card ${borderClass}">
                <span class="timeline-time">${time}</span>
                <span class="timeline-kind"><span class="badge ${isOrig ? 'badge-green' : 'badge-purple'}">${kind}</span>${isOrig ? ' <span class="badge badge-green">★</span>' : ''}</span>
                <div class="timeline-content">
                    <code style="font-size:0.65rem;color:var(--text2);">${e.id.substring(0,10)}...</code>
                    <div>${text || ''}</div>
                    ${media ? `<div class="media-preview">${media}</div>` : ''}
                </div>
                <div class="timeline-actions">
                    <button class="btn btn-small btn-secondary" onclick="window._inspectEvent('${e.id}')">JSON</button>
                    ${currentUser ? `<button class="btn btn-small btn-primary" onclick="window._boostEvent('${e.id}')">🚀</button>` : ''}
                </div>
            </div>`; });
        html += '</div></div>';
        p.innerHTML = html; }

    // ── Statistics ───────────────────────
    function renderStats(inv) { const p = document.getElementById('panel-stats'); const tree = inv.getThreadTree();
        let nested = 0; if (tree && tree.childrenMap) { const count = (eid, d) => { let c = 0; for (const child of (tree
                    .childrenMap.get(eid) || [])) { if (d >= 1) c++;
                    c += count(child.id, d + 1); } return c; };
            nested = count(tree.rootId, 0); } const stats = [{ l: 'Original Event', v: originalEvent ? 1 : 0 }, { l: 'Replies',
                v: inv.getEventsByKind(1).filter(e => e.id !== investigationHexId && inv.getParentIds(e).includes(
                    investigationHexId)).length }, { l: 'Nested Replies', v: nested }, { l: 'Quotes', v: inv.events.filter(
                e => e.kind === 1 && e.content && e.content.includes(investigationHexId || '') && !inv.getParentIds(
                    e).includes(investigationHexId || '')).length }, { l: 'Mentions', v: inv.events.filter(e => e.tags &&
                e.tags.some(t => t[0] === 'e' && t[1] === investigationHexId)).length }, { l: 'Reposts', v: inv
                .getEventsByKind(6).length }, { l: 'Reactions', v: inv.getEventsByKind(7).length }, { l: 'Zap Events',
                v: inv.getEventsByKind(9735).length + inv.getEventsByKind(9734).length }, { l: 'BCH Tips', v: inv
                .getBchPaymentEvents().length }, { l: 'Unknown Events', v: inv.getUnknownEvents().length }, { l: 'Unique Authors',
                v: inv.getUniqueAuthors() }, { l: 'Connected Relays', v: [...relayStats.values()].filter(s => s.status ===
                    'connected').length }, { l: 'Successful Relays', v: [...relayStats.values()].filter(s => s.events > 0)
                .length }, { l: 'Failed Relays', v: [...relayStats.values()].filter(s => s.status === 'failed' || s
                .status === 'disconnected').length }, { l: 'Images', v: inv.getMediaCounts().images }, { l: 'Videos',
                v: inv.getMediaCounts().videos }, { l: 'Attachments', v: inv.getMediaCounts().attachments }, { l: 'Hashtags',
                v: inv.getHashtags() }, { l: 'Links', v: inv.getLinks() }, { l: 'Total Events', v: inv.events.length }, ];
        let h =
            '<div class="card"><div class="card-header"><span class="card-title">📊 Statistics</span></div><div class="stats-grid">';
        stats.forEach(s => h +=
            `<div class="stat-card"><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`);
        h += '</div></div>';
        p.innerHTML = h; }

    // ── JSON Viewer ─────────────────────
    function renderJson(inv) { const p = document.getElementById('panel-json'); let h =
            '<div class="card"><div class="card-header"><span class="card-title">{ } Raw JSON Inspector</span><div><button class="btn btn-small btn-secondary" onclick="window._copyAllJson()">📋 Copy All</button> <button class="btn btn-small btn-green" onclick="window._downloadAllJson()">⬇ Download All</button></div></div>'; if (
            originalEvent) { h += '<h4 style="margin:8px 0;color:var(--green);">★ Original Event</h4><div class="json-viewer">' +
            syntaxHighlight(JSON.stringify(originalEvent, null, 2)) +
            '</div><button class="btn btn-small btn-secondary" onclick="window._copyEventJson(\'' + originalEvent.id +
            '\')">Copy</button> <button class="btn btn-small btn-secondary" onclick="window._downloadEventJson(\'' +
            originalEvent.id + '\')">Download</button>'; }
        h += '<h4 style="margin:16px 0 8px;">All Events (' + inv.events.length +
            ')</h4><input type="text" placeholder="Search within JSON..." style="width:100%;padding:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:8px;font-family:var(--mono);font-size:0.8rem;" oninput="window._searchJson(this.value)"><div class="json-viewer" style="max-height:50vh;">'; for (const e of inv
            .events) { const isOrig = e.id === investigationHexId;
            h +=
            `<div><span style="color:${isOrig ? 'var(--green)' : 'var(--accent2)'};cursor:pointer;" onclick="window._toggleJsonBlock(this)" data-eid="${e.id}">${isOrig ? '★ ' : '▸ '}${e.id.substring(0,12)}... [Kind ${e.kind}]</span><div style="display:none;margin-left:16px;border-left:2px solid var(--border);padding-left:8px;" class="json-block-content">${syntaxHighlight(JSON.stringify(e, null, 2))}<br><button class="btn btn-small btn-secondary" onclick="window._copyEventJson('${e.id}')">Copy</button> <button class="btn btn-small btn-secondary" onclick="window._downloadEventJson('${e.id}')">Download</button></div></div>`; }
        h += '</div></div>';
        p.innerHTML = h; }

    // ── Relays ──────────────────────────
    function renderRelays() { const p = document.getElementById('panel-relays'); let h =
            '<div class="card"><div class="card-header"><span class="card-title">🔗 Relay Inspector</span><button class="btn btn-small btn-primary" onclick="window._addCustomRelay()">+ Add Relay</button></div><div style="overflow-x:auto;"><table class="relay-table"><thead><tr><th>Relay URL</th><th>Status</th><th>Response Time</th><th>Events</th><th>Errors</th><th>Actions</th></tr></thead><tbody>'; [...new Set([...activeRelays, ...relayStats
                .keys()])].forEach(url => { const s = relayStats.get(url) || { status: 'unknown', events: 0, errors: 0,
                responseTime: null }; let cls = 'status-connecting', txt = s.status || 'unknown'; if (s.status ===
                'connected') { cls = 'status-connected';
                txt = 'Connected'; } else if (s.status === 'failed') { cls = 'status-failed';
                txt = 'Failed'; } else if (s.status === 'disconnected') { cls = 'status-failed';
                txt = 'Disconnected'; } const rt = s.responseTime ? `${s.responseTime}ms` : '—';
            h +=
            `<tr><td style="word-break:break-all;"><code style="font-size:0.7rem;">${escapeHtml(url)}</code></td><td><span class="status-dot ${cls}"></span>${txt}</td><td>${rt}</td><td>${s.events || 0}</td><td>${s.errors || 0}</td><td><button class="btn btn-small btn-secondary" onclick="window._reconnectRelay('${escapeHtml(url)}')">Reconnect</button> <button class="btn btn-small btn-danger" onclick="window._removeRelay('${escapeHtml(url)}')">✕</button></td></tr>`; });
        h += '</tbody></table></div></div>';
        p.innerHTML = h; }

    // ── Export ──────────────────────────
    function renderExport() { document.getElementById('panel-export').innerHTML =
            '<div class="card"><div class="card-header"><span class="card-title">💾 Export</span></div><div class="export-btns"><button class="btn btn-secondary" onclick="window._exportJSON(\'original\')">📄 Original JSON</button><button class="btn btn-secondary" onclick="window._exportJSON(\'all\')">📦 All JSON</button><button class="btn btn-secondary" onclick="window._exportCSV()">📊 CSV</button><button class="btn btn-secondary" onclick="window._exportMarkdown()">📝 Markdown</button><button class="btn btn-secondary" onclick="window._exportHTML()">🌐 HTML</button></div></div>'; }

    // ── BCH Payments ────────────────────
    function renderBch(inv) { const p = document.getElementById('panel-bch'); const evs = inv.getBchPaymentEvents(); if (!evs
            .length) { p.innerHTML = '<div class="card"><p>💸 No BCH payment events found.</p></div>'; return; }
        let h = '<div class="card"><div class="card-header"><span class="card-title">💸 BCH Payments</span></div>';
        evs.forEach(e => { const sender = e.pubkey ? e.pubkey.substring(0, 12) + '...' : '?'; const recipient = e.tags ? (e
                .tags.find(t => t[0] === 'p')?.[1]?.substring(0, 12) + '...' || '?') : '?'; const amount = e.tags ? (e.tags
                .find(t => t[0] === 'amount')?.[1] || 'N/A') : 'N/A'; const curr = e.paymentType === 'zap' ? 'BTC (Zap)' :
                e.paymentType === 'bch_tip' ? 'BCH' : '?'; const txid = e.tags ? (e.tags.find(t => t[0] === 'txid' || t[
                    0] === 'cashtoken')?.[1] || 'N/A') : 'N/A';
            h +=
            `<div class="bch-card"><div><strong>Type:</strong> <span class="badge badge-orange">${e.paymentType}</span> | ${new Date((e.created_at||0)*1000).toLocaleString()}</div><div>${sender} → ${recipient}</div><div>Amount: ${amount} ${curr}</div>${txid!=='N/A'?`<div>TXID: <code style="word-break:break-all;">${txid}</code> <a href="https://blockchair.com/bitcoin-cash/transaction/${txid}" target="_blank" style="color:var(--blue);">🔗 Explorer</a></div>`:''}<div>Memo: ${escapeHtml((e.content||'').substring(0,200))}</div><button class="btn btn-small btn-secondary" onclick="window._inspectEvent('${e.id}')">View JSON</button></div>`; });
        h += '</div>';
        p.innerHTML = h; }

    // ── Modal for event JSON ────────────
    function showEventModal(ev) { const json = JSON.stringify(ev, null, 2);
        modalContainer.innerHTML =
            `<div class="modal-backdrop" onclick="if(event.target===this)this.remove();"><div class="modal"><button class="modal-close" onclick="this.closest('.modal-backdrop').remove();">✕</button><h3>Event: <code style="font-size:0.7rem;word-break:break-all;">${escapeHtml(ev.id)}</code></h3><p style="color:var(--text2);">Kind: ${KNOWN_KINDS[ev.kind]||ev.kind} | ${new Date((ev.created_at||0)*1000).toLocaleString()}</p><div class="json-viewer" style="max-height:50vh;">${syntaxHighlight(json)}</div><div style="margin-top:12px;display:flex;gap:8px;"><button class="btn btn-small btn-secondary copy-json-btn" data-event-id="${ev.id}">📋 Copy</button><button class="btn btn-small btn-green download-json-btn" data-event-id="${ev.id}">⬇ Download</button></div></div></div>`;
        const b = modalContainer.querySelector('.modal-backdrop');
        b.querySelector('.copy-json-btn').addEventListener('click', () => { navigator.clipboard.writeText(JSON.stringify(
                eventMap.get(b.querySelector('.copy-json-btn').dataset.eventId), null, 2)).then(() => showToast(
            'Copied!')); });
        b.querySelector('.download-json-btn').addEventListener('click', () => { const eid = b.querySelector(
                '.download-json-btn').dataset.eventId;
            downloadFile(JSON.stringify(eventMap.get(eid), null, 2), `nostr-event-${eid.substring(0,12)}.json`); }); }

    // ── Login Persistence (localStorage) ──
    function saveLogin(privateKey) { localStorage.setItem('nostrscope_privkey', privateKey); }
    function loadLogin() { const saved = localStorage.getItem('nostrscope_privkey'); if (saved && typeof NostrTools !==
            'undefined') { try { const privateKey = saved; const publicKey = NostrTools.getPublicKey(privateKey);
                currentUser = { privateKey, publicKey }; return true; } catch (e) { localStorage.removeItem(
                    'nostrscope_privkey'); } } return false; }
    function clearLogin() { localStorage.removeItem('nostrscope_privkey'); }

    // ── Login / Boost (NostrTools) ──────
    function showLoginModal() { modalContainer.innerHTML =
            `<div class="modal-backdrop" id="loginModalBackdrop"><div class="modal"><h3>🔐 Login with nsec</h3><div class="warning">⚠️ Your private key never leaves this browser.</div><input type="password" id="nsecInput" placeholder="nsec1..." autocomplete="off"><div style="display:flex; gap:8px; margin-top:12px;"><button class="btn btn-primary" id="loginConfirmBtn">Login</button><button class="btn btn-secondary" id="loginCancelBtn">Cancel</button></div></div></div>`;
        const backdrop = document.getElementById('loginModalBackdrop');
        backdrop.querySelector('#loginCancelBtn').addEventListener('click', () => backdrop.remove());
        backdrop.querySelector('#loginConfirmBtn').addEventListener('click', () => { const nsec = document.getElementById(
                'nsecInput').value.trim(); if (typeof NostrTools === 'undefined') { showToast(
                'Nostr tools not loaded.', 'error'); return; } try { const { type, data } = NostrTools.nip19.decode(
                nsec); if (type !== 'nsec') throw new Error('Not an nsec'); const privateKey = data; const publicKey =
                NostrTools.getPublicKey(privateKey);
            currentUser = { privateKey, publicKey };
            saveLogin(privateKey);
            updateUserUI();
            showToast('Logged in as ' + npubFromHex(publicKey).substring(0, 12) + '...', 'success');
            backdrop.remove(); const boostBtn = document.getElementById('boostBtn'); if (boostBtn) boostBtn.disabled =
                false; } catch (e) { showToast('Invalid nsec.', 'error'); } }); }

    function logout() { currentUser = null;
        clearLogin();
        updateUserUI(); const boostBtn = document.getElementById('boostBtn'); if (boostBtn) boostBtn.disabled = true;
        showToast('Logged out.', 'info'); }

    function updateUserUI() { const npub = currentUser ? npubFromHex(currentUser.publicKey).substring(0, 12) + '...' : ''; if (
            currentUser) { homeUserStatus.innerHTML = `<span class="user-npub">${npub}</span>`;
            resultsUserStatus.innerHTML = `<span class="user-npub">${npub}</span>`;
            homeLoginBtn.style.display = 'none';
            homeLogoutBtn.style.display = 'inline-block';
            resultsLoginBtn.style.display = 'none';
            resultsLogoutBtn.style.display = 'inline-block'; } else { homeUserStatus.textContent = 'Not logged in';
            resultsUserStatus.textContent = 'Not logged in';
            homeLoginBtn.style.display = 'inline-block';
            homeLogoutBtn.style.display = 'none';
            resultsLoginBtn.style.display = 'inline-block';
            resultsLogoutBtn.style.display = 'none'; } }

    async function boostOriginalEvent() { if (!originalEvent) { showToast('No original event to boost.', 'error'); return; }
        if (!currentUser) { showToast('Please login first.', 'info');
            showLoginModal(); return; } if (!relayManager) { showToast('No relay connection.', 'error'); return; } if (
            typeof NostrTools === 'undefined') { showToast('Nostr tools not loaded.', 'error'); return; } const eventTemplate = {
            kind: 6,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['e', originalEvent.id],
                ['p', originalEvent.pubkey],
                ['k', String(originalEvent.kind)]
            ],
            content: ''
        }; try { const signedEvent = await NostrTools.signEvent(eventTemplate, currentUser.privateKey);
            relayManager.publish(signedEvent);
            showToast('🚀 Boost published!', 'success');
            setTimeout(() => { if (investigator) runAnalysis(investigationHexId); }, 2000); } catch (e) { showToast(
                'Error: ' + e.message, 'error'); } }

    // ── Exports ─────────────────────────
    function exportJSON(type) { let data, filename; if (type === 'original' && originalEvent) { data = JSON.stringify(
                originalEvent, null, 2);
            filename = `nostrscope-original-${investigationHexId?.substring(0,12) || 'event'}.json`; } else { data = JSON
                .stringify({ investigationHexId, originalEvent, allEvents, relayStats: [...relayStats.entries()].map(([
                        u, s
                    ]) => ({ url: u, ...s })), exportedAt: new Date().toISOString(), totalEvents: allEvents
                    .length }, null, 2);
            filename = `nostrscope-investigation-${investigationHexId?.substring(0,12) || 'all'}.json`; }
        downloadFile(data, filename, 'application/json');
        showToast('Exported!'); }

    function exportCSV() { let csv =
            'Event ID,Kind,Kind Name,Author,Created At,Content Preview,Is Original\n';
        allEvents.forEach(e => { const kindName = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`;
            csv +=
            `"${e.id}",${e.kind},"${kindName}","${e.pubkey || ''}","${new Date((e.created_at||0)*1000).toISOString()}","${(e.content||'').replace(/"/g,'""').substring(0,200)}","${e.id===investigationHexId?'Yes':'No'}"\n`; });
        downloadFile(csv, `nostrscope-summary-${investigationHexId?.substring(0,12) || 'events'}.csv`, 'text/csv'); }

    function exportMarkdown() { let md =
            `# NostrScope Investigation Report\n\n**Event ID:** \`${investigationHexId||'N/A'}\`\n**Generated:** ${new Date().toISOString()}\n**Total Events:** ${allEvents.length}\n\n## Statistics\n\n| Metric | Value |\n|---|---|\n| Original Event | ${originalEvent?1:0} |\n| Total Events | ${allEvents.length} |\n| Unique Authors | ${new Set(allEvents.map(e=>e.pubkey)).size} |\n| Replies (Kind 1) | ${allEvents.filter(e=>e.kind===1).length} |\n| Reactions (Kind 7) | ${allEvents.filter(e=>e.kind===7).length} |\n| Reposts (Kind 6) | ${allEvents.filter(e=>e.kind===6).length} |\n| Zaps | ${allEvents.filter(e=>e.kind===9735||e.kind===9734).length} |\n\n## Timeline\n\n`; [...allEvents]
            .sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).forEach(e => { md +=
                `- **${new Date((e.created_at||0)*1000).toLocaleString()}** [${KNOWN_KINDS[e.kind]||`Kind ${e.kind}`}] \`${e.id.substring(0,12)}...\` - ${(e.content||'').substring(0,80).replace(/\n/g,' ')}\n`; });
        downloadFile(md, `nostrscope-report-${investigationHexId?.substring(0,12) || 'events'}.md`, 'text/markdown'); }

    function exportHTML() { let h =
            `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NostrScope Report</title><style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:20px;max-width:900px;margin:0 auto;}h1{color:#a78bfa;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #30363d;padding:8px;}</style></head><body><h1>🔍 NostrScope Report</h1><p><strong>Event ID:</strong> <code>${investigationHexId||'N/A'}</code></p><p><strong>Total Events:</strong> ${allEvents.length}</p><table><thead><tr><th>Time</th><th>Kind</th><th>ID</th><th>Content</th></tr></thead><tbody>`; [...allEvents]
            .sort((a, b) => (a.created_at || 0) - (b.created_at || 0)).forEach(e => { h +=
                `<tr><td>${new Date((e.created_at||0)*1000).toLocaleString()}</td><td>${KNOWN_KINDS[e.kind]||`Kind ${e.kind}`}</td><td><code>${e.id.substring(0,14)}...</code></td><td>${escapeHtml((e.content||'').substring(0,120))}</td></tr>`; });
        h += '</tbody></table></body></html>';
        downloadFile(h, `nostrscope-report-${investigationHexId?.substring(0,12) || 'events'}.html`, 'text/html'); }

    // ── Tab switching ────────────────────
    function switchTab(tabName) { document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
        document.getElementById(`panel-${tabName}`)?.classList.add('active'); if (investigator && tabName === 'relays')
            renderRelays(); if (investigator && tabName === 'export') renderExport(); }

    // ── Global window functions ──────────
    window._expandThread = (eventId) => { threadCollapsed.delete(eventId); if (investigator) renderThread(investigator); };
    window._expandAll = () => { threadCollapsed.clear(); if (investigator) renderThread(investigator); };
    window._collapseAll = () => { if (investigator) { investigator.eventMap.forEach((_, k) => { if (k !==
                investigationHexId) threadCollapsed.add(k); });
            renderThread(investigator); } };
    window._boostEvent = async (eventId) => { const ev = eventMap.get(eventId); if (!ev) return; if (!currentUser) {
            showToast('Please login first.', 'info');
            showLoginModal(); return; } if (!relayManager) { showToast('No relay connection.', 'error'); return; } if (
            typeof NostrTools === 'undefined') { showToast('Nostr tools not loaded.', 'error'); return; } const
        eventTemplate = { kind: 6, created_at: Math.floor(Date.now() / 1000), tags: [
                ['e', ev.id],
                ['p', ev.pubkey],
                ['k', String(ev.kind)]
            ], content: '' }; try { const signedEvent = await NostrTools.signEvent(eventTemplate, currentUser
            .privateKey);
            relayManager.publish(signedEvent);
            showToast('🚀 Boost sent!', 'success');
            setTimeout(() => { if (investigator) runAnalysis(investigationHexId); }, 2000); } catch (e) { showToast(
                'Error: ' + e.message, 'error'); } };
    window._toggleSortOrder = () => { sortOrder = sortOrder === 'oldest-first' ? 'newest-first' : 'oldest-first'; if (
            investigator) renderTimeline(investigator); };
    window._inspectEvent = eid => { if (eventMap.has(eid)) showEventModal(eventMap.get(eid)); };
    window._copyEventJson = eid => { if (eventMap.has(eid)) navigator.clipboard.writeText(JSON.stringify(eventMap.get(eid),
        null, 2)).then(() => showToast('Copied!')); };
    window._downloadEventJson = eid => { if (eventMap.has(eid)) downloadFile(JSON.stringify(eventMap.get(eid), null, 2),
        `nostr-event-${eid.substring(0,12)}.json`); };
    window._copyAllJson = () => { if (allEvents.length) navigator.clipboard.writeText(JSON.stringify(allEvents, null, 2))
        .then(() => showToast('Copied!')); };
    window._downloadAllJson = () => exportJSON('all');
    window._toggleJsonBlock = el => { const b = el.nextElementSibling; if (b?.classList.contains('json-block-content')) {
            const hidden = b.style.display === 'none';
            b.style.display = hidden ? 'block' : 'none';
            el.textContent = el.textContent.replace(hidden ? '▸' : '▾', hidden ? '▾' : '▸'); } };
    window._searchJson = q => { const c = document.getElementById('jsonAll'); if (!c) return;
        c.querySelectorAll('.json-block-content').forEach(b => { if (!q) { b.style.display = 'none';
                b.previousElementSibling && (b.previousElementSibling.textContent = b.previousElementSibling
                    .textContent.replace('▾', '▸')); } else if (b.textContent.toLowerCase().includes(q.toLowerCase())) { b
                    .style.display = 'block';
                b.previousElementSibling && (b.previousElementSibling.textContent = b.previousElementSibling
                    .textContent.replace('▸', '▾')); } }); };
    window._reconnectRelay = async u => { showToast(`Reconnecting ${u}...`); if (relayManager) { await relayManager
            .reconnect(u);
            renderRelays();
            showToast('Reconnected'); } };
    window._removeRelay = u => { activeRelays = activeRelays.filter(r => r !== u); if (relayManager) relayManager
            .relayUrls = activeRelays;
        renderRelays();
        showToast('Relay removed'); };
    window._addCustomRelay = () => { const url = prompt('Enter relay WebSocket URL:'); if (url && url.startsWith('ws') && !
            activeRelays.includes(url)) { activeRelays.push(url); if (relayManager) relayManager.relayUrls =
                activeRelays;
            renderRelays();
            showToast('Relay added'); } else if (url && activeRelays.includes(url)) showToast('Already in list'); else if (
            url) showToast('Invalid URL'); };
    window._exportJSON = exportJSON;
    window._exportCSV = exportCSV;
    window._exportMarkdown = exportMarkdown;
    window._exportHTML = exportHTML;
    window.showToast = showToast;

    // ── Main analysis flow ───────────────
    async function runAnalysis(inputValue) { const input = inputValue || homeSearchInput.value.trim(); if (!input) {
            showError('Please enter an event identifier.'); return; }
        hideError(); const parsed = parseInput(input); if (parsed.error) { showError(parsed.error);
            showToast(parsed.error, 'error'); return; }
        investigationHexId = parsed.hexId;
        allEvents = [];
        originalEvent = null;
        eventMap.clear();
        threadCollapsed.clear();
        sortOrder = 'oldest-first';
        relayStats.clear(); const allUrls = [...new Set([...activeRelays, ...(parsed.relayHints || [])])];
        relayManager = new RelayManager(allUrls);
        investigator = new EventInvestigator(relayManager);
        investigator.onUpdate = inv => renderAll(inv);
        investigator.onComplete = inv => { renderAll(inv);
            hideLoading();
            resultsScreen.classList.add('active');
            homeScreen.style.display = 'none';
            resultsSearchInput.value = homeSearchInput.value;
            document.querySelector('.tab-btn.active')?.click();
            window.scrollTo({ top: 0, behavior: 'smooth' }); };
        await investigator.investigate(parsed.hexId, parsed.relayHints || []); }

    function renderAll(inv) { allEvents = inv.events;
        originalEvent = inv.originalEvent;
        eventMap = inv.eventMap;
        investigationHexId = inv.hexId; if (allEvents.length === 0 && !originalEvent) { resultsScreen.classList.remove(
                'active');
            homeScreen.style.display = 'flex'; return; }
        resultsScreen.classList.add('active');
        homeScreen.style.display = 'none';
        renderThread(inv);
        renderTimeline(inv);
        renderStats(inv);
        renderJson(inv);
        renderRelays();
        renderExport();
        renderBch(inv); }

    // ── Restore login on startup ──────────
    function initApp() { if (typeof NostrTools !== 'undefined') { if (loadLogin()) { updateUserUI(); } } else { setTimeout(
            initApp, 200); } }

    // ── Event listeners ──────────────────
    homeAnalyzeBtn.addEventListener('click', () => runAnalysis());
    homeClearBtn.addEventListener('click', () => { homeSearchInput.value = '';
        hideError(); });
    homeSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });
    homeLuckyBtn.addEventListener('click', () => { const tips = [
        '6b89af997f24b1d960249b15d95e0c6c6ef40378f2460a8c7e08c675e4f8ac8a' ];
        homeSearchInput.value = tips[Math.floor(Math.random() * tips.length)];
        runAnalysis(); });
    resultsSearchBtn.addEventListener('click', () => runAnalysis(resultsSearchInput.value));
    resultsSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(resultsSearchInput.value); });
    document.getElementById('resultsLogo').addEventListener('click', () => { resultsScreen.classList.remove('active');
        homeScreen.style.display = 'flex';
        homeSearchInput.value = '';
        hideError(); });
    tabsNav.addEventListener('click', e => { const btn = e.target.closest('.tab-btn'); if (btn) switchTab(btn.dataset.tab); });
    homeLoginBtn.addEventListener('click', showLoginModal);
    homeLogoutBtn.addEventListener('click', logout);
    resultsLoginBtn.addEventListener('click', showLoginModal);
    resultsLogoutBtn.addEventListener('click', logout);

    DEFAULT_RELAYS.forEach(u => relayStats.set(u, { status: 'pending', events: 0, errors: 0, responseTime: null }));
    initApp();
    console.log('🔍 NostrScope ready — login persists, boost visible when logged in.');
})();
