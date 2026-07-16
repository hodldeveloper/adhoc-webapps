/**
 * NostrScope Article Editor (kind 30023)
 * Uses SimpleMDE for rich markdown editing with toolbar.
 */
(function () {
    // ── State ──
    let simplemde = null;
    let editingEvent = null;
    let currentDtag = null;
    let currentEditorTab = 'write';
    let markdownEscapedView = false;

    function getEditorHeightPx(topPx) {
        const actionBar = document.getElementById('editorActionBar');
        const actionBarHeight = actionBar ? Math.ceil(actionBar.getBoundingClientRect().height) : 56;
        const reservedBottom = actionBarHeight + 42;
        const available = Math.floor(window.innerHeight - topPx - reservedBottom);
        return Math.max(260, Math.min(available, 1400));
    }

    function applyEditorHeight() {
        if (simplemde && simplemde.codemirror) {
            const wrapper = simplemde.codemirror.getWrapperElement();
            const top = wrapper ? wrapper.getBoundingClientRect().top : Math.floor(window.innerHeight * 0.22);
            simplemde.codemirror.setSize(null, getEditorHeightPx(top));
            simplemde.codemirror.refresh();
        }

        const rawEl = document.getElementById('articleMarkdownRaw');
        if (rawEl) {
            const top = rawEl.getBoundingClientRect().top;
            const hint = document.getElementById('editorMarkdownHint');
            const hintHeight = hint ? Math.ceil(hint.getBoundingClientRect().height) + 10 : 0;
            rawEl.style.height = `${Math.max(220, getEditorHeightPx(top) - hintHeight)}px`;
        }
    }

    function applyStickyOffsets() {
        const tabRow = document.querySelector('.editor-screen .editor-tab-row');
        const toolbar = editorContent ? editorContent.querySelector('.editor-toolbar') : null;
        if (!toolbar) return;
        const tabRowHeight = tabRow ? Math.ceil(tabRow.getBoundingClientRect().height) : 0;
        toolbar.style.top = `${tabRowHeight}px`;
    }

    function getActiveUser() {
        if (window._currentUser) return window._currentUser;
        if (typeof window._getCurrentUser === 'function') {
            const user = window._getCurrentUser();
            if (user) {
                window._currentUser = user;
                return user;
            }
        }
        return null;
    }

    const editorScreen = document.getElementById('editorScreen');
    const editorContent = document.getElementById('editorContent');
    const editorBackBtn = document.getElementById('editorBackBtn');
    const editorPublishBtn = document.getElementById('editorPublishBtn');
    const editorTitleEl = document.querySelector('.editor-title');

    function sanitizeMediaUrl(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!/^https?:\/\//i.test(trimmed)) return null;
        return trimmed;
    }

    function updateCoverImagePreview() {
        const imageInput = document.getElementById('articleImage');
        const previewWrap = document.getElementById('articleCoverPreviewWrap');
        const previewImg = document.getElementById('articleCoverPreviewImg');
        if (!imageInput || !previewWrap || !previewImg) return;

        const safeUrl = sanitizeMediaUrl(imageInput.value || '');
        if (!safeUrl) {
            previewWrap.style.display = 'none';
            previewImg.removeAttribute('src');
            return;
        }

        previewImg.src = safeUrl;
        previewWrap.style.display = 'block';
    }

    function applyMetaSectionDefaultState() {
        const details = document.getElementById('editorMetaDetails');
        if (!details) return;
        details.open = window.innerWidth > 768;
    }

    function extractYouTubeId(url) {
        const safe = sanitizeMediaUrl(url);
        if (!safe) return null;
        const m1 = safe.match(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i);
        if (m1) return m1[1];
        const m2 = safe.match(/^https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i);
        if (m2) return m2[1];
        const m3 = safe.match(/^https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i);
        if (m3) return m3[1];
        return null;
    }

    function buildVideoEmbedHtml(url) {
        const safe = sanitizeMediaUrl(url);
        if (!safe) return '';
        const ytId = extractYouTubeId(safe);
        if (ytId) {
            return `<iframe src="https://www.youtube.com/embed/${ytId}" title="YouTube video" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="width:100%;min-height:280px;border:0;border-radius:10px;"></iframe>`;
        }
        return `<video src="${safe}" controls style="width:100%;max-width:100%;"></video>`;
    }

    function buildAudioEmbedHtml(url) {
        const safe = sanitizeMediaUrl(url);
        if (!safe) return '';
        return `<audio src="${safe}" controls style="width:100%;"></audio>`;
    }

    function injectMediaEmbeds(rawText) {
        if (!rawText) return { text: '', placeholders: [] };

        const placeholders = [];
        const pushPlaceholder = (html) => {
            const key = `%%MEDIAEMBED${placeholders.length}%%`;
            placeholders.push({ key, html });
            return key;
        };

        let text = rawText;

        // Convert existing raw HTML embeds into safe placeholders before escaping markdown text.
        text = text.replace(/<iframe[^>]*src=["']([^"']+)["'][^>]*><\/iframe>/gi, (match, src) => {
            const safe = sanitizeMediaUrl(src);
            if (!safe) return '';
            const ytId = extractYouTubeId(safe);
            if (ytId) {
                return pushPlaceholder(buildVideoEmbedHtml(safe));
            }
            return pushPlaceholder(`<iframe src="${safe}" loading="lazy" style="width:100%;min-height:260px;border:0;border-radius:10px;"></iframe>`);
        });

        text = text.replace(/<video[^>]*src=["']([^"']+)["'][^>]*><\/video>/gi, (match, src) => {
            const embed = buildVideoEmbedHtml(src);
            return embed ? pushPlaceholder(embed) : '';
        });

        text = text.replace(/<audio[^>]*src=["']([^"']+)["'][^>]*><\/audio>/gi, (match, src) => {
            const embed = buildAudioEmbedHtml(src);
            return embed ? pushPlaceholder(embed) : '';
        });

        // Auto-embed bare YouTube links on their own line.
        text = text.replace(/(^|\n)(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}[^\s]*|youtu\.be\/[a-zA-Z0-9_-]{11}[^\s]*))(\n|$)/gi, (m, p1, url, p3) => {
            const embed = buildVideoEmbedHtml(url);
            if (!embed) return m;
            return `${p1}${pushPlaceholder(embed)}${p3}`;
        });

        return { text, placeholders };
    }

    function getEditorMarkdown() {
        if (simplemde) return simplemde.value() || '';
        const textarea = document.getElementById('articleContent');
        return textarea ? textarea.value || '' : '';
    }

    function decodeHtmlEntities(input) {
        if (!input || typeof input !== 'string') return '';
        const textarea = document.createElement('textarea');
        textarea.innerHTML = input;
        return textarea.value;
    }

    function normalizeMarkdownForPublishing(raw) {
        if (!raw) return '';

        let text = String(raw).replace(/\r\n?/g, '\n');

        // Convert pasted HTML code blocks into fenced markdown blocks.
        text = text.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (match, code) => {
            const decoded = decodeHtmlEntities(code)
                .replace(/^\n+/, '')
                .replace(/\n+$/, '');
            return `\n\`\`\`\n${decoded}\n\`\`\`\n`;
        });

        // Convert inline HTML code tags into markdown inline code.
        text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (match, code) => {
            const decoded = decodeHtmlEntities(code).replace(/`/g, '\\`');
            return `\`${decoded}\``;
        });

        // BCHNostr is more consistent with plain markdown links than raw media tags.
        text = text.replace(/<iframe[^>]*src=["']([^"']+)["'][^>]*><\/iframe>/gi, (match, src) => {
            const safe = sanitizeMediaUrl(src);
            return safe ? `\n[Embedded media](${safe})\n` : '';
        });
        text = text.replace(/<video[^>]*src=["']([^"']+)["'][^>]*><\/video>/gi, (match, src) => {
            const safe = sanitizeMediaUrl(src);
            return safe ? `\n[Video](${safe})\n` : '';
        });
        text = text.replace(/<audio[^>]*src=["']([^"']+)["'][^>]*><\/audio>/gi, (match, src) => {
            const safe = sanitizeMediaUrl(src);
            return safe ? `\n[Audio](${safe})\n` : '';
        });

        text = text.replace(/<br\s*\/?>/gi, '\n');

        // Some clients/renderers preserve accidental doubled blank rows inside fences.
        // Collapse only separator-style double breaks between non-empty lines in code blocks.
        text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (match, lang, body) => {
            let normalizedBody = body;
            let prev = '';
            while (normalizedBody !== prev) {
                prev = normalizedBody;
                normalizedBody = normalizedBody.replace(/([^\n])\n\n(?=[^\n])/g, '$1\n');
            }
            return `\`\`\`${lang}\n${normalizedBody}\`\`\``;
        });

        text = text.replace(/\n{3,}/g, '\n\n').trim();

        return text;
    }

    function renderArticleMarkdownLikeReadFull(text) {
        if (!text) return '<p style="color:#8fa6c7;">Nothing to preview yet. Start writing your article.</p>';

        const injected = injectMediaEmbeds(text);
        let html = escapeHtml(injected.text);

        html = html.replace(/```([\s\S]*?)```/g, function (match, code) {
            return `<pre style="background:#0d1117;border:1px solid #2f3336;border-radius:6px;padding:14px;overflow-x:auto;font-family:monospace;font-size:0.78rem;color:#e7e9ea;margin:14px 0;white-space:pre-wrap;word-wrap:break-word;"><code style="white-space:pre-wrap;word-wrap:break-word;">${code}</code></pre>`;
        });

        html = html.replace(/`([^`]+)`/g, '<code style="background:#0d1117;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:0.8rem;color:#e7e9ea;word-wrap:break-word;">$1</code>');

        html = html.replace(/^&gt; (.*$)/gim, '<blockquote style="border-left:4px solid #4da3ff;padding:8px 16px;margin:14px 0;background:#162132;border-radius:4px;color:#c0d0e0;font-style:italic;word-wrap:break-word;">$1</blockquote>');

        html = html.replace(/^###### (.*$)/gim, '<h6 style="font-size:0.85rem;font-weight:700;color:#71767b;margin:16px 0 8px;letter-spacing:0.5px;word-wrap:break-word;">$1</h6>');
        html = html.replace(/^##### (.*$)/gim, '<h5 style="font-size:0.9rem;font-weight:700;color:#8a9bb8;margin:18px 0 8px;word-wrap:break-word;">$1</h5>');
        html = html.replace(/^#### (.*$)/gim, '<h4 style="font-size:1rem;font-weight:700;color:#b0c4de;margin:20px 0 10px;word-wrap:break-word;">$1</h4>');
        html = html.replace(/^### (.*$)/gim, '<h3 style="font-size:1.1rem;font-weight:700;color:#d4e4ff;margin:22px 0 12px;word-wrap:break-word;">$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2 style="font-size:1.25rem;font-weight:700;color:#e7e9ea;margin:28px 0 14px;border-bottom:2px solid #2f3336;padding-bottom:8px;word-wrap:break-word;">$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1 style="font-size:1.5rem;font-weight:800;color:#f0f4ff;margin:30px 0 16px;border-bottom:3px solid #4da3ff33;padding-bottom:10px;word-wrap:break-word;">$1</h1>');

        html = html.replace(/^---$/gim, '<hr style="border:0;border-top:2px solid #2f3336;margin:28px 0;">');

        html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
        html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');

        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#4da3ff;text-decoration:underline;font-weight:600;word-wrap:break-word;">$1</a>');

        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (match, alt, url) {
            return `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:12px 0;border:1px solid #2f3336;box-shadow:0 4px 12px rgba(0,0,0,0.3);" loading="lazy" onerror="this.style.display='none';">`;
        });

        html = html.replace(/^[\*\-] (.*$)/gim, '<li style="padding:4px 0;word-wrap:break-word;">$1</li>');
        html = html.replace(/(<li>.*?<\/li>\s*)+/g, function (match) {
            return `<ul style="list-style-type:disc;padding-left:24px;margin:8px 0;">${match}</ul>`;
        });

        html = html.replace(/^\d+\. (.*$)/gim, '<li style="padding:4px 0;word-wrap:break-word;">$1</li>');
        html = html.replace(/(<li>.*?<\/li>\s*)+/g, function (match) {
            return `<ol style="list-style-type:decimal;padding-left:24px;margin:8px 0;">${match}</ol>`;
        });

        html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

        // Restore media embeds after markdown parsing.
        for (const item of injected.placeholders) {
            html = html.split(item.key).join(item.html);
        }

        return html;
    }

    function renderPreviewContent() {
        const previewEl = document.getElementById('articlePreviewContent');
        if (!previewEl) return;

        const markdown = normalizeMarkdownForPublishing(getEditorMarkdown());
        previewEl.innerHTML = renderArticleMarkdownLikeReadFull(markdown);
    }

    function syncRawMarkdownFromEditor() {
        const rawEl = document.getElementById('articleMarkdownRaw');
        if (!rawEl) return;

        if (markdownEscapedView) {
            // Show exactly how content looks inside JSON event payload strings.
            rawEl.value = JSON.stringify(getEditorMarkdown());
            rawEl.readOnly = true;
            rawEl.style.opacity = '0.9';
            return;
        }

        rawEl.readOnly = false;
        rawEl.style.opacity = '1';
        rawEl.value = getEditorMarkdown();
    }

    function syncEditorFromRawMarkdown() {
        const rawEl = document.getElementById('articleMarkdownRaw');
        if (!rawEl) return;
        if (markdownEscapedView) return;
        const value = rawEl.value || '';
        if (simplemde) {
            simplemde.value(value);
        } else {
            const textarea = document.getElementById('articleContent');
            if (textarea) textarea.value = value;
        }
    }

    function setMarkdownEscapedView(enabled) {
        markdownEscapedView = !!enabled;
        const toggleBtn = document.getElementById('editorToggleEscaped');
        const hint = document.getElementById('editorMarkdownHint');

        if (toggleBtn) {
            toggleBtn.style.background = markdownEscapedView ? '#1c2f49' : 'transparent';
            toggleBtn.style.color = markdownEscapedView ? '#eaf3ff' : '#9ab1d1';
            toggleBtn.style.borderColor = markdownEscapedView ? '#456792' : '#2f405c';
            toggleBtn.textContent = markdownEscapedView ? 'Escaped View: ON' : 'Escaped View: OFF';
        }

        if (hint) {
            hint.textContent = markdownEscapedView
                ? 'Showing JSON-escaped content (read-only), including literal \\n sequences.'
                : 'Raw markdown view: every character/newline is preserved.';
        }

        syncRawMarkdownFromEditor();
    }

    function parseFlowNodes(raw) {
        if (!raw) return [];
        return String(raw)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }

    function buildVerticalAsciiFlow(nodes, useArrows) {
        if (!nodes.length) return '';
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            out.push(nodes[i]);
            if (i < nodes.length - 1) {
                out.push(' |');
                if (useArrows) out.push(' v');
            }
        }
        return out.join('\n');
    }

    function buildHorizontalAsciiFlow(nodes, useArrows) {
        if (!nodes.length) return '';
        const connector = useArrows ? ' -> ' : ' - ';
        return nodes.join(connector);
    }

    function createAsciiFlowchartFromPrompt() {
        const raw = prompt(
            'Enter flow steps, one per line.\nExample:\nYou\nRelay A\nRelay B\nRelay C',
            'You\nRelay A\nRelay B\nRelay C',
        );
        if (raw === null) return null;

        const nodes = parseFlowNodes(raw);
        if (!nodes.length) return null;

        const layoutRaw = (prompt('Layout: vertical or horizontal?', 'vertical') || '').trim().toLowerCase();
        const layout = layoutRaw === 'horizontal' ? 'horizontal' : 'vertical';

        const arrowRaw = (prompt('Connector: arrow or plain?', 'plain') || '').trim().toLowerCase();
        const useArrows = arrowRaw === 'arrow' || arrowRaw === 'arrows';

        const chart = layout === 'horizontal'
            ? buildHorizontalAsciiFlow(nodes, useArrows)
            : buildVerticalAsciiFlow(nodes, useArrows);

        if (!chart) return null;
        return `\n\`\`\`\n${chart}\n\`\`\`\n`;
    }

    function setEditorTab(tabName) {
        const nextTab = tabName === 'preview' || tabName === 'markdown' ? tabName : 'write';
        if (currentEditorTab === 'markdown' && nextTab !== 'markdown') {
            syncEditorFromRawMarkdown();
        }
        currentEditorTab = nextTab;

        const writeTab = document.getElementById('editorTabWrite');
        const previewTab = document.getElementById('editorTabPreview');
        const markdownTab = document.getElementById('editorTabMarkdown');
        const writeWrap = document.getElementById('editorWriteWrap');
        const previewWrap = document.getElementById('editorPreviewWrap');
        const markdownWrap = document.getElementById('editorMarkdownWrap');

        if (writeTab) {
            writeTab.style.background = currentEditorTab === 'write' ? '#1c2f49' : 'transparent';
            writeTab.style.color = currentEditorTab === 'write' ? '#eaf3ff' : '#9ab1d1';
            writeTab.style.borderColor = currentEditorTab === 'write' ? '#456792' : '#2f405c';
        }
        if (previewTab) {
            previewTab.style.background = currentEditorTab === 'preview' ? '#1c2f49' : 'transparent';
            previewTab.style.color = currentEditorTab === 'preview' ? '#eaf3ff' : '#9ab1d1';
            previewTab.style.borderColor = currentEditorTab === 'preview' ? '#456792' : '#2f405c';
        }
        if (markdownTab) {
            markdownTab.style.background = currentEditorTab === 'markdown' ? '#1c2f49' : 'transparent';
            markdownTab.style.color = currentEditorTab === 'markdown' ? '#eaf3ff' : '#9ab1d1';
            markdownTab.style.borderColor = currentEditorTab === 'markdown' ? '#456792' : '#2f405c';
        }
        if (writeWrap) writeWrap.style.display = currentEditorTab === 'write' ? 'block' : 'none';
        if (previewWrap) previewWrap.style.display = currentEditorTab === 'preview' ? 'block' : 'none';
        if (markdownWrap) markdownWrap.style.display = currentEditorTab === 'markdown' ? 'block' : 'none';

        if (currentEditorTab === 'preview') {
            renderPreviewContent();
        }

        if (currentEditorTab === 'markdown') {
            syncRawMarkdownFromEditor();
        }

        applyEditorHeight();
    }

    function ensureSimpleMDE(textarea) {
        if (!textarea) return;
        if (simplemde) return;

        if (!document.querySelector('link[href*="simplemde"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/simplemde@1.11.2/dist/simplemde.min.css';
            document.head.appendChild(link);
        }
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fontawesome"]')) {
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css';
            document.head.appendChild(faLink);
        }

        if (typeof SimpleMDE === 'undefined') {
            if (!document.querySelector('script[data-editor="simplemde"]')) {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/simplemde@1.11.2/dist/simplemde.min.js';
                script.dataset.editor = 'simplemde';
                script.onload = () => initSimpleMDE(textarea);
                document.head.appendChild(script);
            }
            return;
        }

        initSimpleMDE(textarea);
    }

    // ── Open the editor ──
    window.openArticleEditor = function (existingEvent = null) {
        const user = getActiveUser();
        if (!user) {
            window._safeToast('Please log in first.', 'info');
            return;
        }

        editingEvent = existingEvent;
        // Switch to editor screen
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        editorScreen.classList.add('active');

        // Build the editor UI if not already built
        if (!editorContent.querySelector('.editor-form')) {
            buildEditorUI();
        } else if (!simplemde) {
            ensureSimpleMDE(document.getElementById('articleContent'));
        }

        setEditorTab('write');

        // Populate fields
        if (existingEvent) {
            // Edit mode
            editorTitleEl.textContent = 'Edit Article';
            const titleTag = existingEvent.tags.find(t => t[0] === 'title');
            const summaryTag = existingEvent.tags.find(t => t[0] === 'summary');
            const imageTag = existingEvent.tags.find(t => t[0] === 'image');
            const tags = existingEvent.tags.filter(t => t[0] === 't').map(t => t[1]);
            const dTag = existingEvent.tags.find(t => t[0] === 'd');

            document.getElementById('articleTitle').value = titleTag ? titleTag[1] : '';
            document.getElementById('articleSummary').value = summaryTag ? summaryTag[1] : '';
            document.getElementById('articleImage').value = imageTag ? imageTag[1] : '';
            document.getElementById('articleTags').value = tags.join(', ');
            const articleContentEl = document.getElementById('articleContent');
            if (articleContentEl) articleContentEl.value = existingEvent.content || '';
            currentDtag = dTag ? dTag[1] : null;
            updateCoverImagePreview();
            if (simplemde) {
                simplemde.value(existingEvent.content || '');
            }
        } else {
            // New article
            editorTitleEl.textContent = 'New Article';
            document.getElementById('articleTitle').value = '';
            document.getElementById('articleSummary').value = '';
            document.getElementById('articleImage').value = '';
            document.getElementById('articleTags').value = '';
            const articleContentEl = document.getElementById('articleContent');
            if (articleContentEl) articleContentEl.value = '';
            if (simplemde) {
                simplemde.value('');
            }
            currentDtag = null;
            updateCoverImagePreview();
        }

        if (simplemde) {
            setTimeout(() => simplemde.codemirror.refresh(), 100);
        }
    };

    // ── Build the UI ──
    function buildEditorUI() {
        editorContent.innerHTML = `
            <div class="editor-form" style="padding:12px; max-width:100%; min-height:100%; display:flex; flex-direction:column; gap:10px;">
                <details id="editorMetaDetails" style="margin-bottom:12px;background:#131e2f;border:1px solid #2f405c;border-radius:8px;overflow:hidden;">
                    <summary style="list-style:none;cursor:pointer;padding:10px 12px;font-size:0.8rem;font-weight:700;color:#d8e7ff;display:flex;align-items:center;justify-content:space-between;">
                        <span>Article Details</span>
                        <span style="font-size:0.7rem;color:#9ab1d1;">Title • Summary • Cover • Tags</span>
                    </summary>
                    <div style="display:grid; gap:10px; padding:10px 12px 12px;">
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Title *</label>
                            <input id="articleTitle" type="text" placeholder="Article title" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Summary (optional)</label>
                            <input id="articleSummary" type="text" placeholder="Short summary" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Cover Image URL (optional)</label>
                            <input id="articleImage" type="url" placeholder="https://example.com/image.jpg" style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                        <div id="articleCoverPreviewWrap" style="display:none;">
                            <div style="font-size:0.72rem;color:#8fa6c7;margin-bottom:6px;">Cover Preview</div>
                            <img id="articleCoverPreviewImg" alt="Cover preview" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;border:1px solid #2f3336;display:block;" loading="lazy" onerror="this.parentElement.style.display='none'; this.removeAttribute('src');">
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:#71767b;">Tags (comma separated)</label>
                            <input id="articleTags" type="text" placeholder="bch, bitcoin, ..." style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                        </div>
                    </div>
                </details>
                <div style="display:flex;flex-direction:column;flex:1;min-height:0;">
                    <label style="font-size:0.75rem;color:#71767b;">Content (markdown)</label>
                    <div class="editor-tab-row" style="display:flex;gap:6px;margin:8px 0 10px;">
                        <button type="button" id="editorTabWrite" style="padding:6px 12px;font-size:0.75rem;border:1px solid #2f405c;border-radius:7px;background:#1c2f49;color:#eaf3ff;cursor:pointer;">Write</button>
                        <button type="button" id="editorTabPreview" style="padding:6px 12px;font-size:0.75rem;border:1px solid #2f405c;border-radius:7px;background:transparent;color:#9ab1d1;cursor:pointer;">Preview</button>
                        <button type="button" id="editorTabMarkdown" style="padding:6px 12px;font-size:0.75rem;border:1px solid #2f405c;border-radius:7px;background:transparent;color:#9ab1d1;cursor:pointer;">Markdown Code</button>
                    </div>
                    <div id="editorWriteWrap" style="flex:1;min-height:0;">
                        <textarea id="articleContent" style="width:100%;min-height:220px;padding:10px;background:#0f1724;border:1px solid #2f3336;color:#e7e9ea;border-radius:8px;"></textarea>
                        <div id="simplemde-container"></div>
                    </div>
                    <div id="editorPreviewWrap" style="display:none;background:#0f1724;border:1px solid #2f405c;border-radius:8px;padding:14px;min-height:260px;overflow:auto;">
                        <div id="articlePreviewContent" class="article-rich-content" style="font-size:0.9rem;line-height:1.65;color:#e7efff;"></div>
                    </div>
                    <div id="editorMarkdownWrap" style="display:none;background:#0f1724;border:1px solid #2f405c;border-radius:8px;padding:10px;min-height:260px;overflow:hidden;">
                        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                            <button type="button" id="editorToggleEscaped" style="padding:5px 10px;font-size:0.72rem;border:1px solid #2f405c;border-radius:7px;background:transparent;color:#9ab1d1;cursor:pointer;">Escaped View: OFF</button>
                        </div>
                        <textarea id="articleMarkdownRaw" spellcheck="false" wrap="off" style="width:100%;min-height:320px;padding:12px;background:#0b1422;border:1px solid #2f405c;color:#e7efff;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,monospace;font-size:0.78rem;line-height:1.45;white-space:pre;overflow-x:auto;overflow-y:auto;resize:none;"></textarea>
                        <div id="editorMarkdownHint" style="margin-top:6px;font-size:0.68rem;color:#8fa6c7;">Raw markdown view: every character/newline is preserved.</div>
                    </div>
                </div>
                <div id="editorActionBar" style="position:sticky;bottom:0;z-index:40;display:flex;gap:8px;justify-content:flex-end;padding:10px 0 calc(10px + env(safe-area-inset-bottom));background:linear-gradient(to top,#0b1321 72%,rgba(11,19,33,0));border-top:1px solid rgba(47,64,92,0.7);">
                    <button class="btn btn-outline" id="editorDiscardBtn">Discard</button>
                    <button class="btn btn-primary" id="editorSaveBtn">Publish Article</button>
                </div>
            </div>
        `;

        // ── Initialize SimpleMDE ──
        const textarea = document.getElementById('articleContent');
        ensureSimpleMDE(textarea);

        // ── Buttons ──
        document.getElementById('editorDiscardBtn').addEventListener('click', closeEditor);
        document.getElementById('editorSaveBtn').addEventListener('click', handlePublish);
        document.getElementById('editorTabWrite').addEventListener('click', () => setEditorTab('write'));
        document.getElementById('editorTabPreview').addEventListener('click', () => setEditorTab('preview'));
        document.getElementById('editorTabMarkdown').addEventListener('click', () => setEditorTab('markdown'));
        const escapedToggle = document.getElementById('editorToggleEscaped');
        if (escapedToggle) {
            escapedToggle.addEventListener('click', function () {
                setMarkdownEscapedView(!markdownEscapedView);
            });
        }
        const rawMd = document.getElementById('articleMarkdownRaw');
        if (rawMd) {
            rawMd.addEventListener('input', function () {
                if (currentEditorTab === 'markdown') {
                    if (markdownEscapedView) return;
                    if (simplemde) {
                        simplemde.value(rawMd.value || '');
                    } else {
                        const articleContent = document.getElementById('articleContent');
                        if (articleContent) articleContent.value = rawMd.value || '';
                    }
                }
            });
        }
        const imageInput = document.getElementById('articleImage');
        if (imageInput) {
            imageInput.addEventListener('input', updateCoverImagePreview);
            imageInput.addEventListener('change', updateCoverImagePreview);
        }
        if (editorBackBtn) editorBackBtn.addEventListener('click', closeEditor);
        if (editorPublishBtn) editorPublishBtn.addEventListener('click', handlePublish);

        applyMetaSectionDefaultState();
        updateCoverImagePreview();
        setMarkdownEscapedView(false);

        setEditorTab('write');
        requestAnimationFrame(applyEditorHeight);
    }

    function initSimpleMDE(textarea) {
        if (simplemde) {
            simplemde.toTextArea();
            simplemde = null;
        }
        simplemde = new SimpleMDE({
            element: textarea,
            toolbar: [
                'bold', 'italic', 'heading', '|',
                'quote', 'code', '|',
                'unordered-list', 'ordered-list', '|',
                'link', 'image', '|',
                'preview', 'side-by-side', 'fullscreen', '|',
                {
                    name: 'codeblock',
                    action: function(editor) {
                        const language = (prompt('Code language (optional, e.g. js, json, bash):') || '').trim();
                        const selection = editor.codemirror.getSelection() || 'your code here';
                        const fenceHead = language ? `\`\`\`${language}` : '```';
                        const block = `\n${fenceHead}\n${selection}\n\`\`\`\n`;
                        editor.codemirror.replaceSelection(block);
                    },
                    className: 'fa fa-code',
                    title: 'Insert Code Block',
                },
                {
                    name: 'flowchart',
                    action: function(editor) {
                        const chartBlock = createAsciiFlowchartFromPrompt();
                        if (!chartBlock) {
                            window._safeToast('Flowchart not created.', 'info');
                            return;
                        }
                        editor.codemirror.replaceSelection(chartBlock);
                    },
                    className: 'fa fa-sitemap',
                    title: 'Insert ASCII Flowchart',
                },
                {
                    name: 'video',
                    action: function(editor) {
                        const url = prompt('Enter video URL (MP4, WebM, etc.):');
                        if (url) {
                            const safe = sanitizeMediaUrl(url);
                            if (!safe) {
                                window._safeToast('Please enter a valid http/https video URL.', 'error');
                                return;
                            }
                            editor.codemirror.replaceSelection(`[Video](${safe})`);
                        }
                    },
                    className: 'fa fa-video-camera',
                    title: 'Insert Video',
                },
                {
                    name: 'audio',
                    action: function(editor) {
                        const url = prompt('Enter audio URL (MP3, etc.):');
                        if (url) {
                            const safe = sanitizeMediaUrl(url);
                            if (!safe) {
                                window._safeToast('Please enter a valid http/https audio URL.', 'error');
                                return;
                            }
                            editor.codemirror.replaceSelection(`[Audio](${safe})`);
                        }
                    },
                    className: 'fa fa-music',
                    title: 'Insert Audio',
                }
            ],
            spellChecker: false,
            status: false,
            autosave: false,
            placeholder: 'Write your article in markdown...',
            renderingConfig: {
                singleLineBreaks: false,
                codeSyntaxHighlighting: true,
            },
        });

        simplemde.codemirror.on('change', function () {
            if (currentEditorTab === 'markdown') {
                syncRawMarkdownFromEditor();
            }
            if (currentEditorTab === 'preview') {
                renderPreviewContent();
            }
        });

        applyEditorHeight();

        const toolbar = editorContent.querySelector('.editor-toolbar');
        if (toolbar) {
            toolbar.style.position = 'sticky';
            toolbar.style.zIndex = '20';
            toolbar.style.background = '#101a2a';
        }
        applyStickyOffsets();

        textarea.style.display = 'none';
        setTimeout(() => simplemde.codemirror.focus(), 200);
    }

    window.addEventListener('resize', function () {
        applyEditorHeight();
        applyStickyOffsets();
    });

    async function handlePublish() {
        const user = getActiveUser();
        if (!user) {
            window._safeToast('Please log in first.', 'error');
            return;
        }

        const title = document.getElementById('articleTitle').value.trim();
        const summary = document.getElementById('articleSummary').value.trim();
        const image = document.getElementById('articleImage').value.trim();
        const tagsRaw = document.getElementById('articleTags').value.trim();
        const rawContent = simplemde ? simplemde.value() : '';
        const content = normalizeMarkdownForPublishing(rawContent);

        if (!title) {
            window._safeToast('Title is required.', 'error');
            return;
        }
        if (!content) {
            window._safeToast('Content cannot be empty.', 'error');
            return;
        }

        const tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        const now = Math.floor(Date.now() / 1000);
        const dTag = currentDtag || `bchnostr-blog-${Date.now()}`;

        const eventTemplate = {
            kind: 30023,
            created_at: now,
            tags: [
                ['d', dTag],
                ['title', title],
                ['client', 'BCHNostr'],
            ],
            content: content,
        };

        if (summary) eventTemplate.tags.push(['summary', summary]);
        if (image) eventTemplate.tags.push(['image', image]);
        for (const t of tags) {
            if (t) eventTemplate.tags.push(['t', t]);
        }

        try {
            const signed = await window._signNostrEvent(eventTemplate, user.privateKey);
            const rm = window._relayManager || await ensureRelayManager();
            if (rm) {
                rm.publish(signed);
                window._safeToast('✅ Article published!', 'success');
                closeEditor();
                if (typeof window.loadKindTab === 'function') {
                    setTimeout(() => window.loadKindTab(30023), 500);
                }
            } else {
                window._safeToast('No relay connection.', 'error');
            }
        } catch (e) {
            window._safeToast('Error publishing: ' + e.message, 'error');
        }
    }

    async function ensureRelayManager() {
        if (window._relayManager) return window._relayManager;
        if (typeof RelayManager !== 'function') return null;
        const relays = (window.activeRelays || window.CONFIG?.relays || []).slice(0, 6);
        if (!relays.length) return null;
        const rm = new RelayManager(relays);
        window._relayManager = rm;
        try { await rm.connectAll(4000); } catch (e) {}
        return rm;
    }

    function closeEditor() {
        if (simplemde) {
            simplemde.toTextArea();
            simplemde = null;
        }
        const container = document.getElementById('simplemde-container');
        if (container) container.innerHTML = '';
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const profileScreen = document.getElementById('profileScreen');
        if (profileScreen) profileScreen.classList.add('active');
        if (typeof setActiveNav === 'function') setActiveNav('profile');
        if (typeof window.loadAccountPage === 'function') {
            setTimeout(() => window.loadAccountPage(true), 300);
        }
    }

    window.closeArticleEditor = closeEditor;
    console.log('📝 Article editor ready.');
})();