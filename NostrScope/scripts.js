(function () {
  // ── DOM references ──
  const feedScreen = document.getElementById("feedScreen");
  const searchScreen = document.getElementById("searchScreen");
  const profileScreen = document.getElementById("profileScreen");
  const analysisScreen = document.getElementById("analysisScreen");
  const searchInput = document.getElementById("searchInput");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const errorMsg = document.getElementById("errorMsg");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");
  const toastContainer = document.getElementById("toastContainer");
  const modalContainer = document.getElementById("modalContainer");
  const analysisBackBtn = document.getElementById("analysisBackBtn");
  const refreshFeedBtn = document.getElementById("refreshFeedBtn");
  const refreshBoostsBtn = document.getElementById("refreshBoostsBtn");
  const feedLoginBtn = document.getElementById("feedLoginBtn");
  const feedAccountBtn = document.getElementById("feedAccountBtn");
  const profileContent = document.getElementById("profileContent");
  const analysisContent = document.getElementById("analysisContent");

  // ── State ──
  let currentUser = null;
  let cachedProfile = null;
  const profileCache = new Map();
  const pendingFetches = new Map();
  const wallState = {
    pubkey: null,
    hints: [],
    posts: [],
    oldestTs: null,
    hasMore: false,
    loadingMore: false,
  };
  let wallAutoLoadObserver = null;
  const ACTIVE_SCREEN_KEY = "nostrscope_active_screen";

  function setSessionUser(user) {
    currentUser = user;
    window.currentUser = user;
    window._currentUser = user;
  }
  const PROFILE_FETCH_CONCURRENCY = 2;
  let activeProfileFetches = 0;
  const profileFetchQueue = [];

  function enqueueProfileFetch(task) {
    return new Promise((resolve) => {
      profileFetchQueue.push(async () => {
        try {
          resolve(await task());
        } catch (e) {
          resolve(null);
        }
      });
      drainProfileFetchQueue();
    });
  }

  function drainProfileFetchQueue() {
    while (
      activeProfileFetches < PROFILE_FETCH_CONCURRENCY &&
      profileFetchQueue.length > 0
    ) {
      const next = profileFetchQueue.shift();
      activeProfileFetches++;
      Promise.resolve()
        .then(next)
        .finally(() => {
          activeProfileFetches--;
          drainProfileFetchQueue();
        });
    }
  }

  // ── Screen switching (global) ──
  window.switchScreen = function (screenName) {
    document
      .querySelectorAll(".screen")
      .forEach((s) => s.classList.remove("active"));
    const screen = document.getElementById(screenName + "Screen");
    if (screen) screen.classList.add("active");
    if (["feed", "boosts", "search", "profile"].includes(screenName)) {
      try {
        localStorage.setItem(ACTIVE_SCREEN_KEY, screenName);
      } catch (e) {}
    }
    if (typeof setActiveNav === "function") setActiveNav(screenName);
    if (screenName === "feed" && typeof loadFeed === "function") loadFeed();
    if (screenName === "boosts" && typeof loadBoostedFeed === "function")
      loadBoostedFeed();
    if (screenName === "profile") renderMyProfile();
  };

  // ── Quick profile fetch (global) ──
  window.quickFetchProfile = function (pubkey) {
    if (profileCache.has(pubkey))
      return Promise.resolve(profileCache.get(pubkey));
    if (pendingFetches.has(pubkey)) return pendingFetches.get(pubkey);
    const promise = enqueueProfileFetch(() =>
      new Promise((resolve) => {
        const relays = activeRelays
          .filter(
            (u) =>
              typeof window.isRelayInCooldown !== "function" ||
              !window.isRelayInCooldown(u),
          )
          .slice(0, 3);
        if (relays.length === 0) {
          resolve(null);
          return;
        }
        const rm = new RelayManager(relays);
        let resolved = false;
        rm.connectAll(4000)
          .then(() => {
            const subId = rm.subscribe([
              { kinds: [0], authors: [pubkey], limit: 1 },
            ]);
            const timeout = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                rm.closeAll();
                resolve(null);
              }
            }, CONFIG.quickProfileTimeout);
            rm.onEvent = (ev) => {
              if (ev.pubkey === pubkey && ev.kind === 0) {
                clearTimeout(timeout);
                if (!resolved) {
                  resolved = true;
                  rm.closeAll();
                  try {
                    const p = JSON.parse(ev.content);
                    resolve(p.name || p.display_name || null);
                  } catch (e) {
                    resolve(null);
                  }
                }
              }
            };
            rm.onEOSE = () => {
              if (!resolved) {
                clearTimeout(timeout);
                resolved = true;
                rm.closeAll();
                resolve(null);
              }
            };
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                rm.closeAll();
                resolve(null);
              }
            }, CONFIG.quickProfileTimeout + 1000);
          })
          .catch(() => {
            if (!resolved) {
              resolved = true;
              rm.closeAll();
              resolve(null);
            }
          });
      }),
    );
    pendingFetches.set(pubkey, promise);
    promise.then((name) => {
      profileCache.set(pubkey, name);
      pendingFetches.delete(pubkey);
    });
    return promise;
  };

  // ── UI Updates ──
  function updateUserUI() {
    if (currentUser) {
      window.currentUser = currentUser;
      window._currentUser = currentUser;
      feedLoginBtn.style.display = "none";
      feedAccountBtn.style.display = "inline-block";
    } else {
      window.currentUser = null;
      window._currentUser = null;
      feedLoginBtn.style.display = "inline-block";
      feedAccountBtn.style.display = "none";
    }
  }

  async function fetchAndCacheProfile() {
    if (!currentUser) return;
    const upi = new UserProfileInvestigator(new RelayManager(activeRelays));
    await upi.investigate(currentUser.publicKey, [], { silent: true });
    cachedProfile = { profile: upi.profile, profileEvent: upi.profileEvent };
    if (cachedProfile.profile)
      localStorage.setItem(
        "nostrscope_profile",
        JSON.stringify(cachedProfile.profile),
      );
  }

  // ── Login Modal ──
  function showLoginModal() {
    modalContainer.innerHTML = `<div class="modal-backdrop" id="loginModalBackdrop"><div class="modal"><h3>🔐 Login with nsec</h3><div class="warning">⚠️ Your private key never leaves this browser.</div><input type="password" id="nsecInput" placeholder="nsec1..." autocomplete="off"><div style="display:flex; gap:8px; margin-top:12px;"><button class="btn btn-primary" id="loginConfirmBtn">Login</button><button class="btn btn-outline" id="loginCancelBtn">Cancel</button></div></div></div>`;
    const backdrop = document.getElementById("loginModalBackdrop");
    backdrop
      .querySelector("#loginCancelBtn")
      .addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#loginConfirmBtn").addEventListener("click", () => {
      const rawInput = document.getElementById("nsecInput").value.trim();
      const nsec = rawInput.replace(/^nostr:/i, "").toLowerCase();
      if (typeof NostrTools === "undefined") {
        showToast("Nostr tools not loaded. Please refresh.", "error");
        return;
      }
      let privateKey;
      if (/^[0-9a-fA-F]{64}$/.test(rawInput)) {
        privateKey = rawInput.toLowerCase();
      } else {
        try {
          const { type, data } = NostrTools.nip19.decode(nsec);
          if (type !== "nsec") throw new Error("Not an nsec");
          privateKey = ensureHexKey(data);
          if (!privateKey) throw new Error("Invalid decoded nsec");
        } catch (nip19Error) {
          const decoded = bech32Decode(nsec);
          if (
            !decoded ||
            decoded.hrp !== "nsec" ||
            decoded.bytes.length !== 32
          ) {
            showToast("Invalid nsec format.", "error");
            return;
          }
          privateKey = bytesToHex(decoded.bytes);
        }
      }
      if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
        showToast("Invalid private key.", "error");
        return;
      }
      const publicKey = derivePublicKeyFromPrivateKey(privateKey);
      if (!publicKey) {
        showToast("Invalid private key.", "error");
        return;
      }
      setSessionUser({ privateKey, publicKey });
      saveLogin(privateKey);
      updateUserUI();
      const cached = localStorage.getItem("nostrscope_profile");
      if (cached) {
        try {
          cachedProfile = { profile: JSON.parse(cached), profileEvent: null };
        } catch (e) {}
      }
      if (!cachedProfile) fetchAndCacheProfile();
      showToast(
        "Logged in as " + npubFromHex(publicKey).substring(0, 12) + "...",
        "success",
      );
      backdrop.remove();
      renderMyProfile();
      if (
        feedScreen.classList.contains("active") &&
        typeof loadFeed === "function"
      )
        loadFeed();
    });
  }

  function logout() {
    setSessionUser(null);
    clearLogin();
    updateUserUI();
    cachedProfile = null;
    renderMyProfile();
    showToast("Logged out.", "info");
  }

  // ── Account Modal ──
  function showAccountModal(forceRefresh = false) {
    if (!currentUser) return;
    if (forceRefresh || !cachedProfile) {
      fetchAndCacheProfile().then(() =>
        renderAccountModal(cachedProfile.profile, cachedProfile.profileEvent),
      );
    } else {
      renderAccountModal(cachedProfile.profile, cachedProfile.profileEvent);
    }
  }

  function renderAccountModal(profile, profileEvent) {
    const COMMON_RELAYS = [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.primal.net",
      "wss://relay.nostr.band",
      "wss://purplepag.es",
      "wss://relay.snort.social",
      "wss://nostr.wine",
    ];
    let badges =
      profile.tags && Array.isArray(profile.tags) ? [...profile.tags] : [];
    if (profileEvent && profileEvent.tags) {
      const tTags = profileEvent.tags
        .filter((t) => t[0] === "t" && t[1])
        .map((t) => t[1]);
      badges = [...new Set([...badges, ...tTags])];
    }
    const jsonStr = JSON.stringify(profile, null, 2);
    const name = profile.name || "";
    const about = profile.about || "";
    const picture = profile.picture || "";
    const banner = profile.banner || "";
    const nip05 = profile.nip05 || "";
    const bchAddress = profile.bch_address || "";
    const bchTipWallet = profile.bch_tip_wallet || "";
    const currentRelays =
      typeof window.getActiveRelays === "function"
        ? window.getActiveRelays()
        : activeRelays;
    const relayText = (currentRelays || []).join("\n");
    let html = `<div class="modal-backdrop" id="accountModalBackdrop" onclick="if(event.target===this)this.remove();">
            <div class="modal account-modal" style="max-width:460px;">
                <button class="modal-close" style="float:right;background:none;border:none;color:var(--text2);font-size:1.2rem;" onclick="this.closest('.modal-backdrop').remove();">✕</button>
                <h3>👤 My Account</h3>
                <div class="account-meta-block">
                    <p><strong>Public Key</strong></p>
                    <code style="font-size:0.7rem;word-break:break-all;">${currentUser.publicKey}</code>
                    <p style="margin-top:6px;"><strong>npub</strong></p>
                    <code style="font-size:0.7rem;word-break:break-all;">${npubFromHex(currentUser.publicKey)}</code>
                </div>

                <div id="accountEditForm" class="account-form-grid" style="margin-top:12px;">
                    <label>Name</label>
                    <input type="text" id="editName" value="${escapeHtml(name)}" />

                    <label>About</label>
                    <textarea id="editAbout" rows="2">${escapeHtml(about)}</textarea>

                    <label>Picture URL</label>
                    <input type="text" id="editPicture" value="${escapeHtml(picture)}" />

                    <label>Banner URL</label>
                    <input type="text" id="editBanner" value="${escapeHtml(banner)}" />

                    <label>NIP-05</label>
                    <input type="text" id="editNip05" value="${escapeHtml(nip05)}" />

                    <label>BCH Address</label>
                    <input type="text" id="editBchAddress" value="${escapeHtml(bchAddress)}" />

                    <label>BCH Tip Wallet</label>
                    <input type="text" id="editBchTipWallet" value="${escapeHtml(bchTipWallet)}" />

                    <div class="account-badges"><strong>Badges:</strong> ${badges.length > 0 ? badges.map((t) => `<span class="badge badge-blue">${escapeHtml(t)}</span>`).join(" ") : '<span style="color:var(--text2);">none</span>'}</div>

                    <div style="display:flex; gap:8px; margin-top:4px;">
                        <button class="btn btn-primary" id="saveProfileBtn">💾 Save Profile</button>
                        <button class="btn btn-outline btn-sm" id="refreshProfileBtn">🔄 Refresh</button>
                    </div>
                </div>

                  <div class="account-meta-block" style="margin-top:12px;">
                    <p><strong>Relay Settings</strong></p>
                    <p style="font-size:0.75rem; color:var(--text2); margin-top:4px;">One relay per line. Only wss:// relays are saved.</p>
                    <textarea id="editRelays" rows="7" style="margin-top:8px; width:100%;">${escapeHtml(relayText)}</textarea>
                    <div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
                      <button class="btn btn-outline btn-sm" id="saveRelaysBtn">💾 Save Relays</button>
                      <button class="btn btn-outline btn-sm" id="useCommonRelaysBtn">✨ Use Common</button>
                      <button class="btn btn-outline btn-sm" id="resetDefaultRelaysBtn">↺ Reset Default</button>
                    </div>
                  </div>

                <div class="account-preview" style="margin-top:14px;">
                    <div class="account-preview-title">Preview</div>
                    <div class="account-preview-card">
                        <div class="account-preview-banner" id="accountPreviewBanner"></div>
                        <div class="account-preview-body">
                            <div class="account-preview-avatar" id="accountPreviewAvatarWrap">
                                <img id="accountPreviewAvatar" alt="Profile" style="display:none;" />
                                <span id="accountPreviewAvatarFallback">👤</span>
                            </div>
                            <div class="account-preview-text">
                                <div class="account-preview-name" id="accountPreviewName">${escapeHtml(name || "Unnamed")}</div>
                                <div class="account-preview-handle">@${npubFromHex(currentUser.publicKey).substring(0, 12)}...</div>
                                <div class="account-preview-about" id="accountPreviewAbout">${escapeHtml(about || "No bio yet.")}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <details style="margin-top:12px;">
                    <summary style="cursor:pointer; color:var(--accent2);">📄 Full Profile JSON</summary>
                    <div class="json-viewer" style="max-height:200px; margin-top:8px;">${syntaxHighlight(jsonStr)}</div>
                </details>
            </div>
        </div>`;
    modalContainer.innerHTML = html;

    const previewBanner = document.getElementById("accountPreviewBanner");
    const previewAvatar = document.getElementById("accountPreviewAvatar");
    const previewAvatarFallback = document.getElementById(
      "accountPreviewAvatarFallback",
    );
    const previewName = document.getElementById("accountPreviewName");
    const previewAbout = document.getElementById("accountPreviewAbout");

    const safePreviewUrl = (url) => {
      const u = (url || "").trim();
      if (!u) return "";
      if (/^javascript:/i.test(u)) return "";
      return u;
    };

    const updateAccountPreview = () => {
      const liveName = document.getElementById("editName").value.trim();
      const liveAbout = document.getElementById("editAbout").value.trim();
      const livePicture = safePreviewUrl(
        document.getElementById("editPicture").value,
      );
      const liveBanner = safePreviewUrl(
        document.getElementById("editBanner").value,
      );

      previewName.textContent = liveName || "Unnamed";
      previewAbout.textContent = liveAbout || "No bio yet.";

      if (liveBanner) {
        previewBanner.style.backgroundImage = `url("${encodeURI(liveBanner)}")`;
      } else {
        previewBanner.style.backgroundImage = "none";
      }

      if (livePicture) {
        previewAvatar.src = livePicture;
        previewAvatar.style.display = "block";
        previewAvatarFallback.style.display = "none";
      } else {
        previewAvatar.removeAttribute("src");
        previewAvatar.style.display = "none";
        previewAvatarFallback.style.display = "inline";
      }
    };

    previewAvatar.addEventListener("error", () => {
      previewAvatar.removeAttribute("src");
      previewAvatar.style.display = "none";
      previewAvatarFallback.style.display = "inline";
    });

    [
      "editName",
      "editAbout",
      "editPicture",
      "editBanner",
      "editNip05",
      "editBchAddress",
      "editBchTipWallet",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", updateAccountPreview);
    });

    updateAccountPreview();

    document.getElementById("saveProfileBtn").addEventListener("click", () => {
      const newName = document.getElementById("editName").value.trim();
      const newAbout = document.getElementById("editAbout").value.trim();
      const newPicture = document.getElementById("editPicture").value.trim();
      const newBanner = document.getElementById("editBanner").value.trim();
      const newNip05 = document.getElementById("editNip05").value.trim();
      const newBchAddress = document
        .getElementById("editBchAddress")
        .value.trim();
      const newBchTipWallet = document
        .getElementById("editBchTipWallet")
        .value.trim();
      const newProfile = {};
      if (newName) newProfile.name = newName;
      if (newAbout) newProfile.about = newAbout;
      if (newPicture) newProfile.picture = newPicture;
      if (newBanner) newProfile.banner = newBanner;
      if (newNip05) newProfile.nip05 = newNip05;
      if (newBchAddress) newProfile.bch_address = newBchAddress;
      if (newBchTipWallet) newProfile.bch_tip_wallet = newBchTipWallet;
      if (badges.length > 0) newProfile.tags = badges;
      const event = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(newProfile),
      };
      if (typeof window._signNostrEvent !== "function") {
        showToast("Signing function not available.", "error");
        return;
      }
      window
        ._signNostrEvent(event, currentUser.privateKey)
        .then((signed) => {
          if (relayManager) relayManager.publish(signed);
          cachedProfile = { profile: newProfile, profileEvent: null };
          localStorage.setItem(
            "nostrscope_profile",
            JSON.stringify(newProfile),
          );
          showToast("Profile updated!", "success");
          document.getElementById("accountModalBackdrop").remove();
        })
        .catch((e) => showToast("Error: " + e.message, "error"));
    });
    document
      .getElementById("refreshProfileBtn")
      .addEventListener("click", () => {
        document.getElementById("accountModalBackdrop").remove();
        showAccountModal(true);
      });

    const parseRelaysFromTextarea = () => {
      const raw = document.getElementById("editRelays").value || "";
      return raw
        .split(/\r?\n|,/) 
        .map((r) => r.trim())
        .filter((r) => /^wss:\/\//i.test(r));
    };

    document.getElementById("saveRelaysBtn").addEventListener("click", () => {
      const parsed = [...new Set(parseRelaysFromTextarea())];
      if (!parsed.length) {
        showToast("Please enter at least one valid wss:// relay.", "error");
        return;
      }
      if (typeof window.setActiveRelays === "function") {
        window.setActiveRelays(parsed);
      } else {
        globalThis.activeRelays = parsed;
      }
      showToast(`Saved ${parsed.length} relays.`, "success");
      if (feedScreen.classList.contains("active") && typeof loadFeed === "function") loadFeed();
      if (document.getElementById("boostsScreen")?.classList.contains("active") && typeof loadBoostedFeed === "function") loadBoostedFeed(true);
    });

    document
      .getElementById("useCommonRelaysBtn")
      .addEventListener("click", () => {
        const relayInput = document.getElementById("editRelays");
        relayInput.value = COMMON_RELAYS.join("\n");
      });

    document
      .getElementById("resetDefaultRelaysBtn")
      .addEventListener("click", () => {
        const defaults =
          typeof window.resetActiveRelays === "function"
            ? window.resetActiveRelays()
            : [...CONFIG.relays];
        const relayInput = document.getElementById("editRelays");
        relayInput.value = defaults.join("\n");
        showToast("Relays reset to default list.", "info");
      });
  }

  // ── Profile Screen ──
  function renderMyProfile() {
    if (!currentUser) {
      profileContent.innerHTML = `<div class="card" style="margin:20px; text-align:center;">
                <p style="margin-bottom:12px;">You are not logged in.</p>
                <button class="btn btn-primary" id="loginFromProfile">🔑 Login</button>
            </div>`;
      document
        .getElementById("loginFromProfile")
        ?.addEventListener("click", showLoginModal);
      return;
    }
    investigateUser(currentUser.publicKey, [], {
      seedProfile: cachedProfile,
      initialPostsLimit: 80,
    });
  }

  async function fetchUserPosts(pubkey, hints = [], limit = 30, untilTs = null) {
    const relays = [...new Set([...activeRelays, ...hints])];
    const rm = new RelayManager(relays);
    const postsMap = new Map();
    try {
      await rm.connectAll(5000);
      const filter = {
        kinds: [1, 6, 16, 30023, 30078],
        authors: [pubkey],
        limit,
      };
      if (typeof untilTs === "number" && untilTs > 0) {
        filter.until = untilTs;
      }
      const subId = rm.subscribe([filter]);
      rm.onEvent = (ev) => {
        if (ev.pubkey === pubkey) postsMap.set(ev.id, ev);
      };
      await new Promise((resolve) => {
        rm.onEOSE = (sid) => {
          if (sid === subId) {
            rm.closeSubscription(subId);
            resolve();
          }
        };
        setTimeout(resolve, 9000);
      });
    } catch (e) {
    } finally {
      rm.closeAll();
    }
    return [...postsMap.values()].sort(
      (a, b) => (b.created_at || 0) - (a.created_at || 0),
    );
  }

  function sanitizeMediaUrl(url) {
    if (!url || typeof url !== "string") return "";
    const clean = url.trim();
    if (!clean) return "";
    if (/^javascript:/i.test(clean)) return "";
    if (/^(https?:|data:image\/|blob:|\/\/)/i.test(clean)) return clean;
    return "";
  }

  function mergeProfileWithFallback(primary = {}, fallback = {}) {
    const merged = { ...(fallback || {}), ...(primary || {}) };
    const keys = [
      "name",
      "display_name",
      "about",
      "picture",
      "banner",
      "nip05",
      "bch_address",
      "bch_tip_wallet",
      "website",
      "lud16",
      "lud06",
    ];
    keys.forEach((key) => {
      const value = primary?.[key];
      if (typeof value === "string") {
        if (value.trim()) merged[key] = value;
        else if (fallback?.[key]) merged[key] = fallback[key];
      }
    });

    if (Array.isArray(primary?.tags) && primary.tags.length > 0) {
      merged.tags = [...new Set(primary.tags)];
    } else if (Array.isArray(fallback?.tags) && fallback.tags.length > 0) {
      merged.tags = [...new Set(fallback.tags)];
    }

    return merged;
  }

  function renderUserWallLoading(pubkey, seedProfile = null) {
    const handle = npubFromHex(pubkey).substring(0, 16) + "...";
    const profile = seedProfile?.profile || {};
    const name = profile.name || profile.display_name || "";
    const picture = sanitizeMediaUrl(profile.picture || "");
    const banner = sanitizeMediaUrl(profile.banner || "");
    const about = profile.about || "";
    const bannerStyle = banner ? `background-image:url("${encodeURI(banner)}");` : "";
    if (!name && !picture && !banner && !about) {
      profileContent.innerHTML = `<div class="user-wall"><div class="user-wall-header card user-wall-skeleton"><div class="user-wall-banner user-wall-skeleton-block"></div><div class="user-wall-profile"><div class="user-wall-avatar user-wall-skeleton-block"></div><div class="user-wall-meta"><div class="user-wall-skeleton-line" style="width:160px;"></div><div class="user-wall-skeleton-line" style="width:120px; margin-top:8px;"></div></div></div><p class="user-wall-about"><span class="user-wall-skeleton-line" style="width:92%;"></span><span class="user-wall-skeleton-line" style="width:80%; margin-top:8px;"></span></p><div class="user-wall-stats"><span><strong>...</strong> posts</span><span><strong>...</strong> follows</span><span><strong>...</strong> relays</span></div></div><div class="card" style="margin-top:12px;"><p style="color:var(--text2);">Loading wall for @${handle}</p></div></div>`;
      return;
    }
    profileContent.innerHTML = `<div class="user-wall"><div class="user-wall-header card"><div class="user-wall-banner" style="${bannerStyle}"></div><div class="user-wall-profile"><div class="user-wall-avatar">${picture ? `<img src="${picture}" alt="avatar" data-fallback-emoji="👤"/>` : "👤"}</div><div class="user-wall-meta"><h3 class="user-wall-name">${escapeHtml(name || "Unnamed")}</h3><div class="user-wall-handle">@${handle}</div></div></div><p class="user-wall-about">${escapeHtml(about || "Loading profile...")}</p><div class="user-wall-stats"><span><strong>...</strong> posts</span><span><strong>...</strong> follows</span><span><strong>...</strong> relays</span></div></div><div class="card" style="margin-top:12px;"><p style="color:var(--text2);">Loading wall for @${handle}</p></div></div>`;
  }

  function renderUserWall(pubkey, data, posts) {
    const profile = data.profile || {};
    const displayName = profile.name || profile.display_name || "Unnamed";
    const handle = npubFromHex(pubkey).substring(0, 16) + "...";
    const about = profile.about || "No bio yet.";
    const picture = sanitizeMediaUrl(profile.picture || "");
    const banner = sanitizeMediaUrl(profile.banner || "");
    const nip05 = profile.nip05 || "";
    const isMyWall = !!currentUser && currentUser.publicKey === pubkey;
    const bannerStyle = banner ? `background-image:url("${encodeURI(banner)}");` : "";

    let postsHtml = "";
    if (!posts.length) {
      postsHtml =
        '<div class="card" style="margin-top:12px;"><p style="color:var(--text2);">No posts found yet.</p></div>';
    } else {
      postsHtml = posts
        .map((post) => {
          const time = new Date((post.created_at || 0) * 1000).toLocaleString();
          const parsed = renderMediaFromContent(post.content || "");
          const isLong = (post.content || "").length > 320;
          const replyTarget = (post.tags || []).find((t) => t[0] === "e" && t[1])?.[1] || "";
          return `<div class="post-card user-wall-post" data-event-id="${post.id}"><div class="post-avatar">${picture ? `<img src="${picture}" alt="avatar" data-fallback-emoji="👤"/>` : "👤"}</div><div class="post-body"><div class="post-header"><span class="post-name">${escapeHtml(displayName)}</span><span class="post-username">@${handle}</span><span class="post-time">· ${time}</span></div>${replyTarget ? `<div class="reply-context"><a href="#" class="reply-context-link" data-parent-id="${replyTarget}">Replying to ${replyTarget.substring(0, 12)}...</a></div>` : ""}<div class="post-content ${isLong ? "truncated" : ""}">${parsed.text || '<span style="color:var(--text2);">(no text)</span>'}</div>${isLong ? '<span class="show-more-btn">Show more</span>' : ""}${parsed.media ? `<div class="post-media">${parsed.media}</div>` : ""}<div class="post-actions"><button class="post-action-btn analyze-btn" data-event-id="${post.id}">🔍 Analyze</button>${currentUser ? `<button class="post-action-btn" data-boost-id="${post.id}">🚀 Boost</button>` : ""}</div></div></div>`;
        })
        .join("");
    }

    const autoLoadStatus = wallState.loadingMore
      ? '<div class="wall-auto-load-status"><span class="wall-auto-load-dot"></span>Auto-loading older posts...</div>'
      : "";
    const loadMoreCta = wallState.hasMore
      ? `${autoLoadStatus}<div id="wallAutoLoadSentinel" style="height:1px;"></div><div class="card" style="margin-top:10px; text-align:center;"><button class="btn btn-outline" id="wallLoadMoreBtn">${wallState.loadingMore ? "Loading..." : "Load older posts"}</button></div>`
      : "";

    profileContent.innerHTML = `<div class="user-wall"><div class="user-wall-header card"><div class="user-wall-banner" style="${bannerStyle}"></div><div class="user-wall-profile"><div class="user-wall-avatar">${picture ? `<img src="${picture}" alt="avatar" data-fallback-emoji="👤"/>` : "👤"}</div><div class="user-wall-meta"><h3 class="user-wall-name">${escapeHtml(displayName)}</h3><div class="user-wall-handle">@${handle}</div>${nip05 ? `<div class="user-wall-nip05">${escapeHtml(nip05)}</div>` : ""}</div></div><p class="user-wall-about">${escapeHtml(about)}</p><div class="user-wall-stats"><span><strong>${posts.length}</strong> posts</span><span><strong>${(data.follows || []).length}</strong> follows</span><span><strong>${(data.relays || []).length}</strong> relays</span></div>${isMyWall ? '<div class="user-wall-owner-actions" style="padding:0 14px 14px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-outline btn-sm" id="wallEditAccountBtn">Edit Account</button><button class="btn btn-outline btn-sm" id="wallLogoutBtn">Logout</button></div>' : ""}</div><div class="user-wall-feed">${postsHtml}${loadMoreCta}</div></div>`;

    profileContent.querySelectorAll("img[data-fallback-emoji]").forEach((img) => {
      img.addEventListener("error", () => {
        const holder = img.parentElement;
        if (holder) holder.textContent = img.dataset.fallbackEmoji || "👤";
      });
    });

    profileContent.querySelectorAll(".show-more-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const content = btn.previousElementSibling;
        if (content?.classList.contains("post-content")) {
          content.classList.remove("truncated");
          btn.remove();
        }
      });
    });

    profileContent.querySelectorAll(".analyze-btn").forEach((btn) => {
      btn.addEventListener("click", () => runAnalysis(btn.dataset.eventId));
    });

    profileContent.querySelectorAll(".reply-context-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        runAnalysis(link.dataset.parentId);
      });
    });

    profileContent.querySelectorAll("[data-boost-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const post = posts.find((p) => p.id === btn.dataset.boostId);
        if (post && typeof window.boostEvent === "function") {
          window.boostEvent(post.id, post.pubkey, post.kind);
        }
      });
    });

    if (isMyWall) {
      document
        .getElementById("wallEditAccountBtn")
        ?.addEventListener("click", () => showAccountModal());
      document.getElementById("wallLogoutBtn")?.addEventListener("click", logout);
    }

    document.getElementById("wallLoadMoreBtn")?.addEventListener("click", () => {
      loadMoreWallPosts();
    });

    bindWallAutoLoader();
  }

  function bindWallAutoLoader() {
    if (wallAutoLoadObserver) {
      wallAutoLoadObserver.disconnect();
      wallAutoLoadObserver = null;
    }
    const sentinel = document.getElementById("wallAutoLoadSentinel");
    if (!sentinel || !wallState.hasMore) return;
    wallAutoLoadObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreWallPosts();
        }
      },
      {
        root: profileContent,
        rootMargin: "200px 0px",
        threshold: 0.01,
      },
    );
    wallAutoLoadObserver.observe(sentinel);
  }

  async function loadMoreWallPosts() {
    if (wallState.loadingMore || !wallState.hasMore || !wallState.pubkey) return;
    wallState.loadingMore = true;
    renderUserWall(wallState.pubkey, userProfileData || {}, wallState.posts);
    try {
      const untilTs = (wallState.oldestTs || 0) - 1;
      const older = await fetchUserPosts(wallState.pubkey, wallState.hints, 120, untilTs > 0 ? untilTs : null);
      const map = new Map(wallState.posts.map((p) => [p.id, p]));
      for (const p of older) map.set(p.id, p);
      wallState.posts = [...map.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      wallState.oldestTs = wallState.posts[wallState.posts.length - 1]?.created_at || wallState.oldestTs;
      wallState.hasMore = older.length >= 120;
    } catch (e) {
      showToast("Could not load older posts.", "error");
    } finally {
      wallState.loadingMore = false;
      renderUserWall(wallState.pubkey, userProfileData || {}, wallState.posts);
    }
  }

  // ── Analysis rendering (full versions from previous scripts.js) ──
  function buildThreadCards(eventId, childrenMap, depth, visited) {
    if (visited.has(eventId) && depth > 0) return "";
    visited.add(eventId);
    const event = eventMap.get(eventId);
    if (!event && depth > 0) return "";
    if (threadCollapsed.has(eventId) && depth > 0) {
      return `<div class="tree-collapsed" onclick="window._expandThread('${eventId}')" style="margin-left:${depth * 20}px;">[+] Show replies</div>`;
    }
    const isOriginal = eventId === investigationHexId;
    const { text, media } = renderMediaFromContent(event.content);
    const kindName = KNOWN_KINDS[event.kind] || `Kind ${event.kind}`;
    const time = new Date((event.created_at || 0) * 1000).toLocaleString();
    const authorShort = event.pubkey
      ? event.pubkey.substring(0, 8) + "..."
      : "unknown";
    const contentId = "c-" + event.id;
    const isLong = (event.content || "").length > 250;
    let cardHtml = `<div class="tree-card" style="margin-left:${depth * 20}px;"><div class="event-preview"><div class="event-header"><span class="event-kind-badge">${isOriginal ? "★ Original" : kindName}</span><span class="event-time">${time}</span><span class="event-author author-name" data-pubkey="${event.pubkey || ""}">${escapeHtml(authorShort)}</span></div><div class="event-content" id="${contentId}" style="${isLong ? "max-height:80px;" : ""}">${text || '<span style="color:var(--text2);">(no text)</span>'}</div>${isLong ? `<span class="show-more-btn" onclick="document.getElementById('${contentId}').style.maxHeight='none'; this.style.display='none';">Show more</span>` : ""}${media ? `<div class="media-preview">${media}</div>` : ""}<div class="thread-actions"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${event.id}')">JSON</button>${currentUser ? `<button class="btn btn-sm btn-primary" onclick="window.boostEvent('${event.id}','${event.pubkey}','${event.kind}')">🚀 Boost</button>` : ""}</div></div></div>`;
    let html = cardHtml;
    const children = childrenMap.get(eventId) || [];
    if (children.length > 0) {
      html += `<div class="tree-branch">`;
      for (const child of children) {
        html += buildThreadCards(
          child.id,
          childrenMap,
          depth + 1,
          new Set(visited),
        );
      }
      html += `</div>`;
    }
    return html;
  }

  function renderThread(inv) {
    const p = document.getElementById("panel-thread");
    const tree = inv.getThreadTree();
    if (!tree || !tree.rootEvent) {
      p.innerHTML = '<div class="card"><p>No thread data.</p></div>';
      return;
    }
    const rows = [];
    const seen = new Set();
    const pushNode = (eventId, depth) => {
      if (!eventId || seen.has(eventId)) return;
      seen.add(eventId);
      const ev = eventMap.get(eventId);
      if (!ev) return;
      const isOriginal = eventId === investigationHexId;
      const kindName = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
      const authorShort = ev.pubkey ? `${ev.pubkey.substring(0, 8)}...` : "unknown";
      const time = new Date((ev.created_at || 0) * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const textPreview = escapeHtml(
        ((ev.content || "").replace(/\s+/g, " ").trim() || "(no text)").substring(
          0,
          90,
        ),
      );
      rows.push(`
        <div class="thread-map-row" style="margin-left:${depth * 12}px;">
          <div class="thread-map-main">
            <div class="thread-map-meta">
              <span class="badge ${isOriginal ? "badge-green" : "badge-blue"}">${isOriginal ? "★ Original" : escapeHtml(kindName)}</span>
              <span class="thread-map-author">${escapeHtml(authorShort)}</span>
              <span class="thread-map-time">${escapeHtml(time)}</span>
            </div>
            <div class="thread-map-text">${textPreview}${(ev.content || "").length > 90 ? "..." : ""}</div>
          </div>
          <div class="thread-actions">
            <button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${ev.id}')">JSON</button>
          </div>
        </div>
      `);
      const children = tree.childrenMap.get(eventId) || [];
      for (const child of children) pushNode(child.id, depth + 1);
    };
    pushNode(tree.rootId, 0);

    let html =
      '<div class="card"><div class="card-header"><span class="card-title">🌳 Thread Map</span></div><div class="thread-tree-container thread-map-simple">';
    html += rows.join("") || '<p style="color:var(--text2);">No thread nodes found.</p>';
    html += "</div></div>";
    p.innerHTML = html;
  }

  function renderTimeline(inv) {
    const p = document.getElementById("panel-timeline");
    const sorted = [...inv.events].sort((a, b) =>
      sortOrder === "newest-first"
        ? (b.created_at || 0) - (a.created_at || 0)
        : (a.created_at || 0) - (b.created_at || 0),
    );
    if (!sorted.length) {
      p.innerHTML = '<div class="card"><p>No events.</p></div>';
      return;
    }
    let html =
      '<div class="card"><div class="card-header"><span class="card-title">⏱ Timeline (Chronological)</span><button class="btn btn-sm btn-outline" onclick="window._toggleSortOrder()">Sort: ' +
      (sortOrder === "oldest-first" ? "Oldest ▲" : "Newest ▼") +
      '</button></div><div class="timeline-list timeline-compact-list">';
    sorted.forEach((e) => {
      const time = new Date((e.created_at || 0) * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const kind = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`;
      const isOrig = e.id === investigationHexId;
      const authorShort = e.pubkey ? `${e.pubkey.substring(0, 8)}...` : "unknown";
      html += `<div class="timeline-compact-row"><span class="timeline-time">${time}</span><span class="timeline-kind"><span class="badge ${isOrig ? "badge-green" : "badge-purple"}">${kind}</span>${isOrig ? ' <span class="badge badge-green">★</span>' : ""}</span><span class="timeline-compact-author">${escapeHtml(authorShort)}</span><code class="timeline-compact-id">${e.id.substring(0, 10)}...</code><div class="timeline-actions"><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">JSON</button></div></div>`;
    });
    html += "</div></div>";
    p.innerHTML = html;
  }

  function renderStats(inv) {
    const p = document.getElementById("panel-stats");
    const tree = inv.getThreadTree();
    let nested = 0;
    if (tree && tree.childrenMap) {
      const count = (eid, d) => {
        let c = 0;
        for (const child of tree.childrenMap.get(eid) || []) {
          if (d >= 1) c++;
          c += count(child.id, d + 1);
        }
        return c;
      };
      nested = count(tree.rootId, 0);
    }
    const interactionGroup = {
      textNotes: inv.getEventsByKind(1).length,
      reactions: inv.getEventsByKind(7).length,
      zapped: inv.getEventsByKind(9735).length + inv.getEventsByKind(9734).length,
      boosts: inv.getEventsByKind(6).length,
    };
    const stats = [
      { l: "Original", v: originalEvent ? 1 : 0 },
      {
        l: "Replies",
        v: inv
          .getEventsByKind(1)
          .filter(
            (e) =>
              e.id !== investigationHexId &&
              inv.getParentIds(e).includes(investigationHexId),
          ).length,
      },
      { l: "Nested", v: nested },
      {
        l: "Quotes",
        v: inv.events.filter(
          (e) =>
            e.kind === 1 &&
            e.content &&
            e.content.includes(investigationHexId || "") &&
            !inv.getParentIds(e).includes(investigationHexId || ""),
        ).length,
      },
      {
        l: "Mentions",
        v: inv.events.filter(
          (e) =>
            e.tags &&
            e.tags.some((t) => t[0] === "e" && t[1] === investigationHexId),
        ).length,
      },
      { l: "BCH Tips", v: inv.getBchPaymentEvents().length },
      { l: "Unknown", v: inv.getUnknownEvents().length },
      { l: "Authors", v: inv.getUniqueAuthors() },
      {
        l: "Relays",
        v: [...relayStats.values()].filter((s) => s.status === "connected")
          .length,
      },
      {
        l: "Success",
        v: [...relayStats.values()].filter((s) => s.events > 0).length,
      },
      {
        l: "Failed",
        v: [...relayStats.values()].filter(
          (s) => s.status === "failed" || s.status === "disconnected",
        ).length,
      },
      { l: "Images", v: inv.getMediaCounts().images },
      { l: "Videos", v: inv.getMediaCounts().videos },
      { l: "Files", v: inv.getMediaCounts().attachments },
      { l: "Hashtags", v: inv.getHashtags() },
      { l: "Links", v: inv.getLinks() },
      { l: "Total", v: inv.events.length },
    ];
    let h =
      '<div class="card"><div class="card-header"><span class="card-title">📊 Statistics</span></div>' +
      '<div class="analysis-interaction-group">' +
      `<span class="interaction-pill">TextNote <strong>${interactionGroup.textNotes}</strong></span>` +
      `<span class="interaction-pill">Reaction <strong>${interactionGroup.reactions}</strong></span>` +
      `<span class="interaction-pill">Zapped <strong>${interactionGroup.zapped}</strong></span>` +
      `<span class="interaction-pill">Boost <strong>${interactionGroup.boosts}</strong></span>` +
      '</div><div class="stats-grid">';
    stats.forEach(
      (s) =>
        (h += `<div class="stat-card"><div class="stat-value">${s.v}</div><div class="stat-label">${s.l}</div></div>`),
    );
    h += "</div></div>";
    p.innerHTML = h;
  }

  function renderJson(inv) {
    const p = document.getElementById("panel-json");
    let h =
      '<div class="card"><div class="card-header"><span class="card-title">{ } JSON (Formatted)</span><div><button class="btn btn-sm btn-outline" onclick="window._copyAllJson()">Copy All</button> <button class="btn btn-sm btn-primary" onclick="window._downloadAllJson()">Download</button></div></div>';
    if (originalEvent) {
      h +=
        '<h4 style="margin:8px 0;color:var(--green);">★ Original Event</h4><pre class="json-viewer json-plain">' +
        escapeHtml(JSON.stringify(originalEvent, null, 2)) +
        '</pre><button class="btn btn-sm btn-outline" onclick="window._copyEventJson(\'' +
        originalEvent.id +
        '\')">Copy</button> <button class="btn btn-sm btn-outline" onclick="window._downloadEventJson(\'' +
        originalEvent.id +
        "')\">Download</button>";
    }
    h +=
      '<h4 style="margin:16px 0 8px;">All Events (' +
      inv.events.length +
      ')</h4><input type="text" placeholder="Search JSON..." style="width:100%;padding:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:8px;margin-bottom:8px;font-family:var(--mono);font-size:0.8rem;" oninput="window._searchJson(this.value)"><div class="json-viewer" id="jsonAll" style="max-height:50vh;">';
    for (const e of inv.events) {
      const isOrig = e.id === investigationHexId;
      const pretty = JSON.stringify(e, null, 2);
      h += `<div><span style="color:${isOrig ? "var(--green)" : "var(--accent2)"};cursor:pointer;" onclick="window._toggleJsonBlock(this)" data-eid="${e.id}">${isOrig ? "★ " : "▸ "}${e.id.substring(0, 12)}... [Kind ${e.kind}]</span><div style="display:none;margin-left:16px;border-left:2px solid var(--border);padding-left:8px;" class="json-block-content"><pre class="json-viewer json-plain" style="max-height:none;margin-top:8px;">${escapeHtml(pretty)}</pre><button class="btn btn-sm btn-outline" onclick="window._copyEventJson('${e.id}')">Copy</button> <button class="btn btn-sm btn-outline" onclick="window._downloadEventJson('${e.id}')">Download</button></div></div>`;
    }
    h += "</div></div>";
    p.innerHTML = h;
  }

  function renderRelays() {
    const p = document.getElementById("panel-relays");
    let h =
      '<div class="card"><div class="card-header"><span class="card-title">🔗 Relays</span><button class="btn btn-sm btn-outline" onclick="window._addCustomRelay()">+ Add</button></div><div style="overflow-x:auto;"><table class="relay-table"><thead><tr><th>URL</th><th>Status</th><th>RT</th><th>Events</th><th>Errors</th><th></th></tr></thead><tbody>';
    [...new Set([...activeRelays, ...relayStats.keys()])].forEach((url) => {
      const s = relayStats.get(url) || {
        status: "unknown",
        events: 0,
        errors: 0,
        responseTime: null,
      };
      let cls = "status-connecting",
        txt = s.status || "unknown";
      if (s.status === "connected") {
        cls = "status-connected";
        txt = "Connected";
      } else if (s.status === "failed") {
        cls = "status-failed";
        txt = "Failed";
      } else if (s.status === "disconnected") {
        cls = "status-failed";
        txt = "Disconnected";
      }
      const rt = s.responseTime ? `${s.responseTime}ms` : "—";
      h += `<tr><td style="word-break:break-all;"><code style="font-size:0.65rem;">${escapeHtml(url)}</code></td><td><span class="status-dot ${cls}"></span>${txt}</td><td>${rt}</td><td>${s.events || 0}</td><td>${s.errors || 0}</td><td><button class="btn btn-sm btn-outline" onclick="window._reconnectRelay('${escapeHtml(url)}')">↻</button></td></tr>`;
    });
    h += "</tbody></table></div></div>";
    p.innerHTML = h;
  }

  function renderBch(inv) {
    const p = document.getElementById("panel-bch");
    const evs = inv.getBchPaymentEvents();
    if (!evs.length) {
      p.innerHTML =
        '<div class="card"><p>💸 No BCH payment events found.</p></div>';
      return;
    }
    let h =
      '<div class="card"><div class="card-header"><span class="card-title">💸 BCH Payments</span></div>';
    evs.forEach((e) => {
      const sender = e.pubkey ? e.pubkey.substring(0, 12) + "..." : "?";
      const recipient = e.tags
        ? e.tags.find((t) => t[0] === "p")?.[1]?.substring(0, 12) + "..." || "?"
        : "?";
      const amount = e.tags
        ? e.tags.find((t) => t[0] === "amount")?.[1] || "N/A"
        : "N/A";
      const curr =
        e.paymentType === "zap"
          ? "BTC (Zap)"
          : e.paymentType === "bch_tip"
            ? "BCH"
            : "?";
      const txid = e.tags
        ? e.tags.find((t) => t[0] === "txid" || t[0] === "cashtoken")?.[1] ||
          "N/A"
        : "N/A";
      h += `<div class="bch-card" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;"><div><strong>Type:</strong> <span class="badge badge-orange">${e.paymentType}</span> | ${new Date((e.created_at || 0) * 1000).toLocaleString()}</div><div>${sender} → ${recipient}</div><div>Amount: ${amount} ${curr}</div>${txid !== "N/A" ? `<div>TXID: <code style="word-break:break-all;">${txid}</code> <a href="https://blockchair.com/bitcoin-cash/transaction/${txid}" target="_blank" style="color:var(--blue);">🔗 Explorer</a></div>` : ""}<div>Memo: ${escapeHtml((e.content || "").substring(0, 200))}</div><button class="btn btn-sm btn-outline" onclick="window._inspectEvent('${e.id}')">View JSON</button></div>`;
    });
    h += "</div>";
    p.innerHTML = h;
  }

  function renderProfileTab(data, pubkey) {
    const p = document.getElementById("panel-profile");
    const profile = data.profile || {};
    let html =
      '<div class="card"><div class="card-header"><span class="card-title">👤 User Profile</span></div>';
    html += `<p><strong>npub:</strong> <code>${npubFromHex(pubkey)}</code></p>`;
    if (profile.name)
      html += `<p><strong>Name:</strong> ${escapeHtml(profile.name)}</p>`;
    if (profile.about)
      html += `<p><strong>About:</strong> ${escapeHtml(profile.about)}</p>`;
    if (profile.picture)
      html += `<p><img src="${profile.picture}" alt="Profile" style="max-width:80px;border-radius:50%;"/></p>`;
    if (data.follows.length) {
      if (data.follows.length <= 5) {
        html += `<p><strong>Follows (${data.follows.length}):</strong> ${data.follows.map((f) => `<code>${f.substring(0, 8)}...</code>`).join(", ")}</p>`;
      } else {
        html += `<details style="margin-top:8px;"><summary style="cursor:pointer; color:var(--accent2);">👥 Follows (${data.follows.length})</summary>`;
        html += `<p style="word-break:break-all;">${data.follows.map((f) => `<code>${f.substring(0, 8)}...</code>`).join(", ")}</p>`;
        html += `</details>`;
      }
    }
    if (data.relays.length)
      html += `<p><strong>Relays:</strong> ${data.relays.map((r) => `<code>${escapeHtml(r)}</code>`).join(", ")}</p>`;
    if (data.otherEvents && data.otherEvents.length) {
      html += `<details style="margin-top:12px;"><summary style="cursor:pointer; color:var(--accent2);">📦 Other Events (${data.otherEvents.length})</summary>`;
      data.otherEvents.forEach((ev) => {
        const kindName = KNOWN_KINDS[ev.kind] || `Kind ${ev.kind}`;
        const time = new Date((ev.created_at || 0) * 1000).toLocaleString();
        html += `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;margin:8px 0;">`;
        if (ev.kind === 30023) {
          try {
            const article = JSON.parse(ev.content);
            const title = article.title || "Untitled";
            const summary =
              article.summary ||
              (article.content || "").substring(0, 150) + "...";
            const image = article.image || "";
            const linkTag = ev.tags.find((t) => t[0] === "d" && t[1]) || [];
            const identifier = linkTag[1] || ev.id;
            const readUrl = `https://njump.me/${npubFromHex(ev.pubkey)}/${identifier}`;
            html += `<div><span class="badge badge-purple">${kindName}</span> <span style="font-size:0.7rem;color:var(--text2);">${time}</span></div>`;
            html += `<strong>${escapeHtml(title)}</strong>`;
            if (image)
              html += `<div><img src="${image}" alt="Article image" style="max-width:100%;max-height:150px;border-radius:6px;margin:4px 0;"></div>`;
            html += `<p style="font-size:0.8rem;margin:4px 0;">${escapeHtml(summary)}</p>`;
            html += `<a href="${readUrl}" target="_blank" style="color:var(--blue);font-size:0.75rem;">Read full article →</a>`;
          } catch (e) {
            html += `<div><span class="badge badge-purple">${kindName}</span> <span style="font-size:0.7rem;color:var(--text2);">${time}</span></div>`;
            html += `<div class="event-content" style="max-height:80px;overflow-y:auto;">${escapeHtml(ev.content.substring(0, 300))}</div>`;
          }
        } else {
          html += `<div><span class="badge badge-purple">${kindName}</span> <span style="font-size:0.7rem;color:var(--text2);">${time}</span></div>`;
          html += `<details><summary style="font-size:0.75rem;color:var(--accent2);">Show JSON</summary>
                    <div class="json-viewer" style="max-height:150px;margin-top:4px;">${syntaxHighlight(JSON.stringify(ev, null, 2))}</div></details>`;
        }
        html += `</div>`;
      });
      html += `</details>`;
    }
    if (
      !profile.name &&
      !profile.about &&
      !profile.picture &&
      !data.follows.length &&
      !data.relays.length &&
      !data.otherEvents.length
    ) {
      html +=
        '<p style="color:var(--text2);">No public profile data found.</p>';
    }
    html += "</div>";
    p.innerHTML = html;
  }

  function ensureAnalysisLayout() {
    if (!analysisContent) return;
    analysisContent.innerHTML = `
      <div class="analysis-overview-wrap" id="analysisOverviewWrap">
        <div id="panel-overview"></div>
      </div>

      <details class="analysis-section" open>
        <summary>🌳 Thread Map (Simple)</summary>
        <div id="panel-thread"></div>
      </details>

      <details class="analysis-section" open>
        <summary>⏱ Timeline (Chronological)</summary>
        <div id="panel-timeline"></div>
      </details>

      <details class="analysis-section" open>
        <summary>📊 Statistics</summary>
        <div id="panel-stats"></div>
      </details>

      <details class="analysis-section" open>
        <summary>💸 BCH Payments</summary>
        <div id="panel-bch"></div>
      </details>

      <details class="analysis-section">
        <summary>🔗 Relays</summary>
        <div id="panel-relays"></div>
      </details>

      <details class="analysis-section">
        <summary>{ } JSON (Formatted)</summary>
        <div id="panel-json"></div>
      </details>
    `;
  }

  function renderOverview(inv) {
    const p = document.getElementById("panel-overview");
    if (!p) return;
    const root = inv.originalEvent;
    const rootKind = root ? KNOWN_KINDS[root.kind] || `Kind ${root.kind}` : "Unknown";
    const rootTime = root
      ? new Date((root.created_at || 0) * 1000).toLocaleString()
      : "N/A";
    const author = root?.pubkey ? `${root.pubkey.substring(0, 12)}...` : "unknown";
    const replies = inv
      .getEventsByKind(1)
      .filter(
        (e) =>
          e.id !== investigationHexId &&
          inv.getParentIds(e).includes(investigationHexId),
      ).length;
    const reposts = inv.getEventsByKind(6).length;
    const reactions = inv.getEventsByKind(7).length;
    const textNotes = inv.getEventsByKind(1).length;
    const zapped = inv.getEventsByKind(9735).length + inv.getEventsByKind(9734).length;
    const tips = inv.getBchPaymentEvents().length;
    const preview = root?.content
      ? escapeHtml(root.content.substring(0, 220)) + (root.content.length > 220 ? "..." : "")
      : "No text content";

    p.innerHTML = `
      <div class="card analysis-overview-card">
        <div class="card-header">
          <span class="card-title">Post Detail Summary</span>
          <span class="badge badge-blue">${escapeHtml(rootKind)}</span>
        </div>
        <div class="analysis-overview-meta">
          <div><strong>Event:</strong> <code>${escapeHtml((investigationHexId || "").substring(0, 20))}...</code></div>
          <div><strong>Author:</strong> ${escapeHtml(author)}</div>
          <div><strong>Created:</strong> ${escapeHtml(rootTime)}</div>
        </div>
        <p class="analysis-overview-preview">${preview}</p>
        <div class="analysis-interaction-group">
          <span class="interaction-pill">TextNote <strong>${textNotes}</strong></span>
          <span class="interaction-pill">Reaction <strong>${reactions}</strong></span>
          <span class="interaction-pill">Zapped <strong>${zapped}</strong></span>
          <span class="interaction-pill">Boost <strong>${reposts}</strong></span>
        </div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-value">${inv.events.length}</div><div class="stat-label">Total Events</div></div>
          <div class="stat-card"><div class="stat-value">${replies}</div><div class="stat-label">Replies</div></div>
          <div class="stat-card"><div class="stat-value">${tips}</div><div class="stat-label">BCH Tips</div></div>
          <div class="stat-card"><div class="stat-value">${inv.getUniqueAuthors()}</div><div class="stat-label">Authors</div></div>
        </div>
      </div>
    `;
  }

  async function investigateUser(pubkey, hints = [], options = {}) {
    document
      .querySelectorAll(".screen")
      .forEach((s) => s.classList.remove("active"));
    profileScreen.classList.add("active");
    feedScreen.classList.remove("active");
    analysisScreen.classList.remove("active");
    if (typeof setActiveNav === "function") setActiveNav("profile");

    const seedProfileData =
      options.seedProfile?.profile ||
      (pubkey === currentUser?.publicKey ? cachedProfile?.profile : null) ||
      null;

    renderUserWallLoading(pubkey, seedProfileData ? { profile: seedProfileData } : null);
    showLoading("Opening user wall...");

    const allUrls = [...new Set([...activeRelays, ...hints])];
    const rm = new RelayManager(allUrls);
    window._relayManager = rm;
    try {
      const upi = new UserProfileInvestigator(rm);
      const profilePromise = upi.investigate(pubkey, hints, { silent: true });
      const firstBatchLimit = options.initialPostsLimit || 80;
      const postsPromise = fetchUserPosts(pubkey, hints, firstBatchLimit);
      const [, firstPosts] = await Promise.all([profilePromise, postsPromise]);

      const profileRelayHints = Array.isArray(upi.relays)
        ? upi.relays.filter((r) => /^wss:\/\//i.test(r)).slice(0, 12)
        : [];
      const commonRelayHints = [
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.primal.net",
        "wss://relay.nostr.band",
        "wss://purplepag.es",
        "wss://relay.snort.social",
        "wss://nostr.wine",
      ];
      let posts = firstPosts;
      if (profileRelayHints.length > 0) {
        const backfillPosts = await fetchUserPosts(
          pubkey,
          [...hints, ...profileRelayHints],
          firstBatchLimit,
        );
        const merged = new Map(firstPosts.map((p) => [p.id, p]));
        backfillPosts.forEach((p) => merged.set(p.id, p));
        posts = [...merged.values()].sort(
          (a, b) => (b.created_at || 0) - (a.created_at || 0),
        );
      }

      // If we still have too few posts, do deeper pagination over a wider relay universe.
      const deepHints = [
        ...new Set([
          ...(hints || []),
          ...profileRelayHints,
          ...commonRelayHints,
          ...CONFIG.relays,
        ]),
      ];
      if (posts.length < 20) {
        let untilTs = posts[posts.length - 1]?.created_at || Math.floor(Date.now() / 1000);
        for (let i = 0; i < 3; i++) {
          const older = await fetchUserPosts(pubkey, deepHints, 120, untilTs - 1);
          if (!older.length) break;
          const map = new Map(posts.map((p) => [p.id, p]));
          older.forEach((p) => map.set(p.id, p));
          posts = [...map.values()].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          untilTs = posts[posts.length - 1]?.created_at || untilTs;
          if (older.length < 120) break;
        }
      }

      scannedPubkey = pubkey;
      const mergedProfile = mergeProfileWithFallback(upi.profile || {}, seedProfileData || {});
      userProfileData = {
        profile: mergedProfile,
        follows: upi.follows,
        relays: upi.relays,
        otherEvents: upi.otherEvents,
      };
      if (pubkey === currentUser?.publicKey && mergedProfile && Object.keys(mergedProfile).length > 0) {
        cachedProfile = { profile: mergedProfile, profileEvent: null };
        try {
          localStorage.setItem("nostrscope_profile", JSON.stringify(mergedProfile));
        } catch (e) {}
      }
      wallState.pubkey = pubkey;
      wallState.hints = deepHints;
      wallState.posts = posts;
      wallState.oldestTs = posts[posts.length - 1]?.created_at || null;
      wallState.hasMore = posts.length >= firstBatchLimit;
      wallState.loadingMore = false;
      renderUserWall(pubkey, userProfileData, wallState.posts);
    } catch (e) {
      if (seedProfileData && Object.keys(seedProfileData).length > 0) {
        const fallbackData = {
          profile: seedProfileData,
          follows: [],
          relays: [],
          otherEvents: [],
        };
        renderUserWall(pubkey, fallbackData, wallState.posts || []);
        showToast("Loaded cached profile details. Live refresh failed.", "info");
      } else {
        profileContent.innerHTML =
          '<div class="card"><p style="color:var(--red);">Failed to load user wall.</p></div>';
        showToast("Failed to load user wall.", "error");
      }
    } finally {
      hideLoading();
    }
  }

  function showEventModal(ev) {
    const json = JSON.stringify(ev, null, 2);
    modalContainer.innerHTML = `<div class="modal-backdrop" onclick="if(event.target===this)this.remove();"><div class="modal"><button class="modal-close" style="float:right;background:none;border:none;color:var(--text2);font-size:1.2rem;" onclick="this.closest('.modal-backdrop').remove();">✕</button><h3>Event: <code style="font-size:0.7rem;word-break:break-all;">${escapeHtml(ev.id)}</code></h3><p style="color:var(--text2);">Kind: ${KNOWN_KINDS[ev.kind] || ev.kind} | ${new Date((ev.created_at || 0) * 1000).toLocaleString()}</p><pre class="json-viewer json-plain" style="max-height:50vh;">${escapeHtml(json)}</pre><div style="margin-top:12px;display:flex;gap:8px;"><button class="btn btn-sm btn-outline copy-json-btn" data-event-id="${ev.id}">Copy</button><button class="btn btn-sm btn-primary download-json-btn" data-event-id="${ev.id}">Download</button></div></div></div>`;
    const b = modalContainer.querySelector(".modal-backdrop");
    b.querySelector(".copy-json-btn").addEventListener("click", () => {
      navigator.clipboard
        .writeText(
          JSON.stringify(
            eventMap.get(b.querySelector(".copy-json-btn").dataset.eventId),
            null,
            2,
          ),
        )
        .then(() => showToast("Copied!"));
    });
    b.querySelector(".download-json-btn").addEventListener("click", () => {
      const eid = b.querySelector(".download-json-btn").dataset.eventId;
      downloadFile(
        JSON.stringify(eventMap.get(eid), null, 2),
        `nostr-event-${eid.substring(0, 12)}.json`,
      );
    });
  }

  // ── Global window functions ──
  window._expandThread = (eventId) => {
    threadCollapsed.delete(eventId);
    if (investigator) renderThread(investigator);
  };
  window._expandAll = () => {
    threadCollapsed.clear();
    if (investigator) renderThread(investigator);
  };
  window._collapseAll = () => {
    if (investigator) {
      investigator.eventMap.forEach((_, k) => {
        if (k !== investigationHexId) threadCollapsed.add(k);
      });
      renderThread(investigator);
    }
  };
  window._toggleSortOrder = () => {
    sortOrder = sortOrder === "oldest-first" ? "newest-first" : "oldest-first";
    if (investigator) renderTimeline(investigator);
  };
  window._inspectEvent = (eid) => {
    if (eventMap.has(eid)) showEventModal(eventMap.get(eid));
  };
  window._copyEventJson = (eid) => {
    if (eventMap.has(eid))
      navigator.clipboard
        .writeText(JSON.stringify(eventMap.get(eid), null, 2))
        .then(() => showToast("Copied!"));
  };
  window._downloadEventJson = (eid) => {
    if (eventMap.has(eid))
      downloadFile(
        JSON.stringify(eventMap.get(eid), null, 2),
        `nostr-event-${eid.substring(0, 12)}.json`,
      );
  };
  window._copyAllJson = () => {
    if (allEvents.length)
      navigator.clipboard
        .writeText(JSON.stringify(allEvents, null, 2))
        .then(() => showToast("Copied!"));
  };
  window._downloadAllJson = () => exportJSON("all");
  window._toggleJsonBlock = (el) => {
    const b = el.nextElementSibling;
    if (b?.classList.contains("json-block-content")) {
      const hidden = b.style.display === "none";
      b.style.display = hidden ? "block" : "none";
      el.textContent = el.textContent.replace(
        hidden ? "▸" : "▾",
        hidden ? "▾" : "▸",
      );
    }
  };
  window._searchJson = (q) => {
    const c = document.getElementById("jsonAll");
    if (!c) return;
    c.querySelectorAll(".json-block-content").forEach((b) => {
      const haystack = (b.dataset.jsonText || b.textContent || "").toLowerCase();
      if (!q) {
        b.style.display = "none";
        b.previousElementSibling &&
          (b.previousElementSibling.textContent =
            b.previousElementSibling.textContent.replace("▾", "▸"));
      } else if (haystack.includes(q.toLowerCase())) {
        b.style.display = "block";
        b.previousElementSibling &&
          (b.previousElementSibling.textContent =
            b.previousElementSibling.textContent.replace("▸", "▾"));
      }
    });
  };
  window._reconnectRelay = async (u) => {
    showToast(`Reconnecting ${u}...`);
    if (relayManager) {
      await relayManager.reconnect(u);
      renderRelays();
      showToast("Reconnected");
    }
  };
  window._removeRelay = (u) => {
    activeRelays = activeRelays.filter((r) => r !== u);
    if (relayManager) relayManager.relayUrls = activeRelays;
    renderRelays();
    showToast("Relay removed");
  };
  window._addCustomRelay = () => {
    const url = prompt("Enter relay WebSocket URL:");
    if (url && url.startsWith("ws") && !activeRelays.includes(url)) {
      activeRelays.push(url);
      if (relayManager) relayManager.relayUrls = activeRelays;
      renderRelays();
      showToast("Relay added");
    } else if (url && activeRelays.includes(url)) showToast("Already in list");
    else if (url) showToast("Invalid URL");
  };
  window.injectBoostedEvent = function (event) {
    if (!investigator || !investigator.eventMap) return;
    if (!eventMap.has(event.id)) {
      eventMap.set(event.id, event);
      allEvents.push(event);
      investigator.eventMap.set(event.id, event);
      investigator.events.push(event);
    }
    if (investigator) {
      renderThread(investigator);
      renderTimeline(investigator);
      renderStats(investigator);
      renderJson(investigator);
    }
  };
  window.investigateUser = investigateUser;
  window.runAnalysis = runAnalysis;

  // ── Exports ──
  function exportJSON(type) {
    let data, filename;
    if (type === "original" && originalEvent) {
      data = JSON.stringify(originalEvent, null, 2);
      filename = `nostrscope-original-${investigationHexId?.substring(0, 12) || "event"}.json`;
    } else {
      data = JSON.stringify(
        {
          investigationHexId,
          originalEvent,
          allEvents,
          relayStats: [...relayStats.entries()].map(([u, s]) => ({
            url: u,
            ...s,
          })),
          exportedAt: new Date().toISOString(),
          totalEvents: allEvents.length,
        },
        null,
        2,
      );
      filename = `nostrscope-investigation-${investigationHexId?.substring(0, 12) || "all"}.json`;
    }
    downloadFile(data, filename, "application/json");
    showToast("Exported!");
  }
  window._exportJSON = exportJSON;
  window._exportCSV = () => {
    let csv =
      "Event ID,Kind,Kind Name,Author,Created At,Content Preview,Is Original\n";
    allEvents.forEach((e) => {
      const kindName = KNOWN_KINDS[e.kind] || `Kind ${e.kind}`;
      csv += `"${e.id}",${e.kind},"${kindName}","${e.pubkey || ""}","${new Date((e.created_at || 0) * 1000).toISOString()}","${(e.content || "").replace(/"/g, '""').substring(0, 200)}","${e.id === investigationHexId ? "Yes" : "No"}"\n`;
    });
    downloadFile(
      csv,
      `nostrscope-summary-${investigationHexId?.substring(0, 12) || "events"}.csv`,
      "text/csv",
    );
  };
  window._exportMarkdown = () => {
    let md = `# NostrScope Investigation Report\n\n**Event ID:** \`${investigationHexId || "N/A"}\`\n**Generated:** ${new Date().toISOString()}\n**Total Events:** ${allEvents.length}\n\n## Statistics\n\n| Metric | Value |\n|---|---|\n| Original Event | ${originalEvent ? 1 : 0} |\n| Total Events | ${allEvents.length} |\n| Unique Authors | ${new Set(allEvents.map((e) => e.pubkey)).size} |\n| Replies (Kind 1) | ${allEvents.filter((e) => e.kind === 1).length} |\n| Reactions (Kind 7) | ${allEvents.filter((e) => e.kind === 7).length} |\n| Reposts (Kind 6) | ${allEvents.filter((e) => e.kind === 6).length} |\n| Zaps | ${allEvents.filter((e) => e.kind === 9735 || e.kind === 9734).length} |\n\n## Timeline\n\n`;
    [...allEvents]
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      .forEach((e) => {
        md += `- **${new Date((e.created_at || 0) * 1000).toLocaleString()}** [${KNOWN_KINDS[e.kind] || `Kind ${e.kind}`}] \`${e.id.substring(0, 12)}...\` - ${(e.content || "").substring(0, 80).replace(/\n/g, " ")}\n`;
      });
    downloadFile(
      md,
      `nostrscope-report-${investigationHexId?.substring(0, 12) || "events"}.md`,
      "text/markdown",
    );
  };
  window._exportHTML = () => {
    let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NostrScope Report</title><style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:20px;max-width:900px;margin:0 auto;}h1{color:#a78bfa;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #30363d;padding:8px;}</style></head><body><h1>🔍 NostrScope Report</h1><p><strong>Event ID:</strong> <code>${investigationHexId || "N/A"}</code></p><p><strong>Total Events:</strong> ${allEvents.length}</p><table><thead><tr><th>Time</th><th>Kind</th><th>ID</th><th>Content</th></tr></thead><tbody>`;
    [...allEvents]
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
      .forEach((e) => {
        h += `<tr><td>${new Date((e.created_at || 0) * 1000).toLocaleString()}</td><td>${KNOWN_KINDS[e.kind] || `Kind ${e.kind}`}</td><td><code>${e.id.substring(0, 14)}...</code></td><td>${escapeHtml((e.content || "").substring(0, 120))}</td></tr>`;
      });
    h += "</tbody></table></body></html>";
    downloadFile(
      h,
      `nostrscope-report-${investigationHexId?.substring(0, 12) || "events"}.html`,
      "text/html",
    );
  };

  // ── Main analysis flow ──
  async function runAnalysis(inputValue) {
    const input = inputValue || searchInput.value.trim();
    if (!input) {
      showError("Please enter an event or user identifier.");
      return;
    }
    showLoading("Analyzing...");
    hideError();
    const parsed = parseInput(input);
    if (parsed.error) {
      showError(parsed.error);
      showToast(parsed.error, "error");
      hideLoading();
      return;
    }
    if (parsed.pubkey) {
      try {
        await investigateUser(parsed.pubkey, parsed.relayHints || []);
      } finally {
        hideLoading();
      }
      return;
    }

    if (parsed.source === 'naddr') {
      // Fetch replaceable event by coordinate
      const filter = { kinds: [parsed.kind], authors: [parsed.pubkey], '#d': [parsed.dTag], limit: 1 };
      const allUrls = [...new Set([...activeRelays, ...(parsed.relayHints || [])])];
      relayManager = new RelayManager(allUrls);
      window._relayManager = relayManager;
      investigator = new EventInvestigator(relayManager);
      investigator.onComplete = inv => {
          if (inv.events.length > 0) {
            // Treat the first matching event as the original and continue investigation
            const event = inv.events[0];
            investigationHexId = event.id;
            window._investigationHexId = event.id;
            runAnalysis(event.id); // recursive call with the hex ID
        } else {
            showToast('No event found for this naddr.', 'error');
            hideLoading();
        }
      };
      showLoading('Fetching event by naddr...');
      await investigator.rm.connectAll(CONFIG.relayConnectTimeout);
      investigator.rm.subscribe([filter]);
      return;
    }

    
    investigationHexId = parsed.hexId;
    window._investigationHexId = investigationHexId;
    allEvents = [];
    originalEvent = null;
    eventMap.clear();
    threadCollapsed.clear();
    sortOrder = "oldest-first";
    relayStats.clear();
    const allUrls = [
      ...new Set([...activeRelays, ...(parsed.relayHints || [])]),
    ];
    relayManager = new RelayManager(allUrls);
    window._relayManager = relayManager;
    investigator = new EventInvestigator(relayManager);
    investigator.onUpdate = (inv) => debouncedRender(inv);
    investigator.onComplete = (inv) => {
      debouncedRender(inv);
      hideLoading();
    };
    try {
      await investigator.investigate(parsed.hexId, parsed.relayHints || []);
      switchScreen("analysis");
      document.getElementById("panel-thread").classList.add("active");
    } catch (e) {
      showToast("Failed to analyze this event.", "error");
      hideLoading();
    }
  }

  let pendingRender = null;
  function debouncedRender(inv) {
    if (pendingRender) clearTimeout(pendingRender);
    pendingRender = setTimeout(() => {
      renderAll(inv);
      pendingRender = null;
    }, 100);
  }

  function renderAll(inv) {
    allEvents = inv.events;
    originalEvent = inv.originalEvent;
    eventMap = inv.eventMap;
    investigationHexId = inv.hexId;
    window._originalEvent = originalEvent;
    window._investigationHexId = investigationHexId;
    if (allEvents.length === 0 && !originalEvent) {
      analysisScreen.classList.remove("active");
      feedScreen.classList.add("active");
      return;
    }
    analysisScreen.classList.add("active");
    ensureAnalysisLayout();
    renderOverview(inv);
    renderThread(inv);
    renderTimeline(inv);
    renderStats(inv);
    renderJson(inv);
    renderRelays();
    renderBch(inv);
  }

  // ── Event listeners ──
  analyzeBtn.addEventListener("click", () => runAnalysis());
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runAnalysis();
  });
  analysisBackBtn.addEventListener("click", () => switchScreen("feed"));
  refreshFeedBtn.addEventListener("click", () => {
    if (typeof refreshNewPosts === "function") refreshNewPosts();
  });
  refreshBoostsBtn?.addEventListener("click", () => {
    if (typeof loadBoostedFeed === "function") loadBoostedFeed();
  });
  feedLoginBtn.addEventListener("click", () => showLoginModal());
  feedAccountBtn.addEventListener("click", () => {
    switchScreen("profile");
    renderMyProfile();
  });

  // ── Init ──
  function initApp() {
    if (typeof NostrTools !== "undefined") {
      if (loadLogin()) {
        setSessionUser(window.currentUser || window._currentUser || null);
        updateUserUI();
        const cached = localStorage.getItem("nostrscope_profile");
        if (cached) {
          try {
            cachedProfile = { profile: JSON.parse(cached), profileEvent: null };
          } catch (e) {}
        }
        if (!cachedProfile) fetchAndCacheProfile();
      }
    } else {
      setTimeout(initApp, 200);
      return;
    }
    CONFIG.relays.forEach((u) =>
      relayStats.set(u, {
        status: "pending",
        events: 0,
        errors: 0,
        responseTime: null,
      }),
    );

    document.addEventListener(
      "click",
      (e) => {
        const interactive = e.target.closest(
          "button, a, [role='button'], .nav-btn",
        );
        if (!interactive) return;
        if (
          interactive.closest("[data-no-loading]") ||
          interactive.classList.contains("modal-close")
        )
          return;
        if (typeof window.indicateUserActionLoading === "function") {
          window.indicateUserActionLoading(450, "Loading...");
        }
      },
      true,
    );

    let initialScreen = "feed";
    try {
      const saved = localStorage.getItem(ACTIVE_SCREEN_KEY);
      if (["feed", "boosts", "search", "profile"].includes(saved)) {
        initialScreen = saved;
      }
    } catch (e) {}
    switchScreen(initialScreen);
  }

  window.showLoginModal = showLoginModal;
  window.showAccountModal = showAccountModal;

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initApp);
  else initApp();
})();
