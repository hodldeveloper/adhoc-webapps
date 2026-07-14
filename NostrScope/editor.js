/**
 * NostrScope Article Editor (kind 30023)
 * Uses SimpleMDE for rich markdown editing with toolbar.
 */
(function () {
    // ── State ──
    let simplemde = null;
    let editingEvent = null;          // the event we're editing (null = new)
    let currentDtag = null;

    const editorScreen = document.getElementById('editorScreen');
    const editorContent = document.getElementById('editorContent');
    const editorBackBtn = document.getElementById('editorBackBtn');
    const editorPublishBtn = document.getElementById('editorPublishBtn');
    const editorTitleEl = document.querySelector('.editor-title');

    // ── Open the editor ──
    window.openArticleEditor = function (existingEvent = null) {
        if (!window._currentUser) {
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
        }

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
            currentDtag = dTag ? dTag[1] : null;
            // Set content
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
            if (simplemde) {
                simplemde.value('');
            }
            currentDtag = null;
        }

        // Refresh SimpleMDE to adjust height
        if (simplemde) {
            setTimeout(() => simplemde.codemirror.refresh(), 100);
        }
    };

    // ── Build the UI (called once) ──
    function buildEditorUI() {
        editorContent.innerHTML = `
            <div class="editor-form" style="padding:12px; max-width:100%;">
                <div style="display:grid; gap:10px; margin-bottom:12px;">
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
                    <div>
                        <label style="font-size:0.75rem;color:#71767b;">Tags (comma separated)</label>
                        <input id="articleTags" type="text" placeholder="bch, bitcoin, ..." style="width:100%;padding:8px;background:#1d1f23;border:1px solid #2f3336;color:#e7e9ea;border-radius:6px;">
                    </div>
                </div>
                <div>
                    <label style="font-size:0.75rem;color:#71767b;">Content (markdown)</label>
                    <textarea id="articleContent" style="display:none;"></textarea>
                    <div id="simplemde-container"></div>
                </div>
                <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
                    <button class="btn btn-outline" id="editorDiscardBtn">Discard</button>
                    <button class="btn btn-primary" id="editorSaveBtn">Publish Article</button>
                </div>
            </div>
        `;

        // ── Initialize SimpleMDE ──
        const container = document.getElementById('simplemde-container');
        const textarea = document.getElementById('articleContent');

        // Load SimpleMDE CSS and JS if not already loaded
        if (!document.querySelector('link[href*="simplemde"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/simplemde@1.11.2/dist/simplemde.min.css';
            document.head.appendChild(link);
        }
        if (typeof SimpleMDE === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/simplemde@1.11.2/dist/simplemde.min.js';
            script.onload = () => initSimpleMDE(textarea, container);
            document.head.appendChild(script);
        } else {
            initSimpleMDE(textarea, container);
        }

        // ── Buttons ──
        document.getElementById('editorDiscardBtn').addEventListener('click', closeEditor);
        document.getElementById('editorSaveBtn').addEventListener('click', handlePublish);
        editorBackBtn.addEventListener('click', closeEditor);
        editorPublishBtn.addEventListener('click', handlePublish);
    }

    function initSimpleMDE(textarea, container) {
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
                    name: 'video',
                    action: function(editor) {
                        const url = prompt('Enter video URL (MP4, WebM, etc.):');
                        if (url) {
                            const embed = `<video src="${url}" controls style="max-width:100%;"></video>`;
                            editor.codemirror.replaceSelection(embed);
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
                            const embed = `<audio src="${url}" controls style="width:100%;"></audio>`;
                            editor.codemirror.replaceSelection(embed);
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
        // Insert the container after the textarea
        container.appendChild(simplemde.codemirror.getWrapperElement());
        // Remove the original textarea from DOM (it's hidden)
        textarea.style.display = 'none';
        // Focus
        setTimeout(() => simplemde.codemirror.focus(), 200);
    }

    // ── Publish handler ──
    async function handlePublish() {
        if (!window._currentUser) {
            window._safeToast('Please log in first.', 'error');
            return;
        }

        const title = document.getElementById('articleTitle').value.trim();
        const summary = document.getElementById('articleSummary').value.trim();
        const image = document.getElementById('articleImage').value.trim();
        const tagsRaw = document.getElementById('articleTags').value.trim();
        const content = simplemde ? simplemde.value() : '';

        if (!title) {
            window._safeToast('Title is required.', 'error');
            return;
        }
        if (!content) {
            window._safeToast('Content cannot be empty.', 'error');
            return;
        }

        // Build tags array
        const tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

        const now = Math.floor(Date.now() / 1000);
        const dTag = currentDtag || `bchnostr-blog-${Date.now()}`; // use timestamp as fallback

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
            const signed = await window._signNostrEvent(eventTemplate, window._currentUser.privateKey);
            // Publish to relays
            const rm = window._relayManager || await ensureRelayManager();
            if (rm) {
                rm.publish(signed);
                window._safeToast('✅ Article published!', 'success');
                closeEditor();
                // Refresh the kind 30023 tab if it's open
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

    // ── Close editor ──
    function closeEditor() {
        if (simplemde) {
            simplemde.toTextArea();
            simplemde = null;
        }
        // Clear the container
        const container = document.getElementById('simplemde-container');
        if (container) container.innerHTML = '';
        // Switch back to profile screen
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const profileScreen = document.getElementById('profileScreen');
        if (profileScreen) profileScreen.classList.add('active');
        if (typeof setActiveNav === 'function') setActiveNav('profile');
        // Reload account page to refresh the kind list
        if (typeof window.loadAccountPage === 'function') {
            setTimeout(() => window.loadAccountPage(true), 300);
        }
    }

    // ── Expose ──
    window.closeArticleEditor = closeEditor;

    // ── Override renderKind30023Events to add Edit button ──
    // (We'll patch it later in account-tab.js)
    console.log('📝 Article editor ready.');
})();
