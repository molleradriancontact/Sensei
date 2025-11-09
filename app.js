// Read config from the global window object
const __firebase_config_str = window.__firebase_config_str || '{}';
const __auth_token = window.__auth_token || null;

// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged,
    setPersistence,
    inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot, 
    collection, 
    query, 
    where, 
    getDocs,
    serverTimestamp,
    writeBatch,
    Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL STATE --- //
let db;
let auth;
let currentUserId = null;
let isFirebaseInitialized = false;

// App ID (for namespacing)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-sensei-hub';
const collections = {
    events: `/artifacts/${appId}/events`,
    socialLinks: `/artifacts/${appId}/socialLinks`,
    vodLibrary: `/artifacts/${appId}/vodLibrary`,
    performanceLog: `/artifacts/${appId}/performanceLog`,
    userProfile: `/artifacts/${appId}/userProfile`
};

// --- APP STATE (with fallbacks for "demo mode") --- //
let currentDate = new Date();
let events = [
    // Pre-loaded tournament
    { id: "tournament-1", title: "RL 1v1 Cash Cup", date: "2025-11-17", type: "tournament" }
];
let socialLinks = [];
let vodLibrary = [];
let performanceLog = [];
let currentLiveSession = null;
let vodNotesDebounceTimer;
let userProfile = {
    gameAccounts: {}, // e.g., { rocketLeague: 'MyUsername' }
    playerCard: {}, // e.g., { rocketLeague: { role: '...', ... } }
};

const games = [
    { id: "rocketLeague", name: "Rocket League", icon: "🚗" },
    { id: "fortnite", name: "Fortnite", icon: "⛏️" },
    { id: "marvelRivals", name: "Marvel Rivals", icon: "🦸" },
    { id: "clashRoyale", name: "Clash Royale", icon: "👑" },
    { id: "clashOfClans", name: "Clash of Clans", icon: "⚔️" },
    { id: "marvelSnap", name: "Marvel Snap", icon: "🃏" }
];

// --- MODIFIED: Removed all AI tabs ---
const navItems = [
    { id: "calendar", name: "Calendar", icon: "📅" },
    { id: "profile", name: "Profile", icon: "👤" },
    { id: "games", name: "My Games", icon: "🎮" },
    { id: "vod", name: "VOD Library", icon: "🎬" },
    { id: "tracker", name: "Tracker", icon: "📊" }
];

let currentTab = "calendar";
let performanceChart = null; // To hold the Chart.js instance

// --- UTILITY FUNCTIONS --- //
function showModal(modalId) {
    document.getElementById(modalId).classList.remove("hidden");
    document.getElementById("modal-backdrop").classList.remove("hidden");
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add("hidden");
    document.getElementById("modal-backdrop").classList.add("hidden");
}

function getGameNameById(gameId) {
    const game = games.find(g => g.id === gameId);
    return game ? game.name : "Unknown Game";
}

function getYouTubeEmbedUrl(url) {
    let videoId = null;
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') {
            videoId = urlObj.pathname.slice(1);
        } else if (urlObj.hostname.includes('youtube.com')) {
            videoId = urlObj.searchParams.get('v');
        }
    } catch (e) {
        console.error("Invalid URL:", e);
        return null;
    }
    
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}

// --- REMOVED: all `callGeminiAPI` functions ---

// --- FIREBASE INITIALIZATION --- //
async function initializeFirebase() {
    let firebaseConfig;
    try {
        firebaseConfig = JSON.parse(__firebase_config_str);
        if (!firebaseConfig.apiKey) {
            throw new Error("Missing Firebase config");
        }
    } catch (e) {
        console.warn("Firebase config not found or invalid. Running in demo mode.");
        isFirebaseInitialized = false;
        // Firebase isn't available, so render with local data
        renderApp();
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        
        // Use in-memory persistence to avoid cross-origin iframe errors in some browsers
        await setPersistence(auth, inMemoryPersistence);

        const authStatusEl = document.getElementById("auth-status");
        authStatusEl.textContent = "Authenticating...";
        
        if (__auth_token) {
            await signInWithCustomToken(auth, __auth_token);
        } else {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUserId = user.uid;
                authStatusEl.textContent = `Online (User: ${user.uid.substring(0, 6)})`;
                isFirebaseInitialized = true;
                // Once authenticated, load all persistent data
                loadAllFirebaseData();
            } else {
                currentUserId = null;
                isFirebaseInitialized = false;
                authStatusEl.textContent = "Offline (Demo Mode)";
                // We're in demo mode, so we need to render with local data
                renderApp();
            }
        });

    } catch (error) {
        console.error("Firebase initialization failed:", error);
        isFirebaseInitialized = false;
        // Firebase failed, so render with local data
        renderApp();
    }
}

function loadAllFirebaseData() {
    if (!isFirebaseInitialized || !db) {
        console.warn("Firebase not ready, skipping data load.");
        renderApp(); // Render with local demo data
        return;
    }

    // Load Events
    try {
        const eventsQuery = collection(db, collections.events);
        onSnapshot(eventsQuery, (snapshot) => {
            events = [
                { id: "tournament-1", title: "RL 1v1 Cash Cup", date: "2025-11-17", type: "tournament" }
            ]; // Start with the hardcoded one
            snapshot.forEach((doc) => {
                events.push({ id: doc.id, ...doc.data() });
            });
            if(currentTab === 'calendar') renderCalendar();
        }, (err) => console.error("Error loading events:", err));
    } catch(e) { console.error("Event listener error:", e)}

    // Load Social Links
    try {
        const socialLinksQuery = collection(db, collections.socialLinks);
        onSnapshot(socialLinksQuery, (snapshot) => {
            socialLinks = [];
            snapshot.forEach((doc) => {
                socialLinks.push({ id: doc.id, ...doc.data() });
            });
            if(currentTab === 'profile') renderProfile();
        }, (err) => console.error("Error loading social links:", err));
    } catch(e) { console.error("Social link listener error:", e)}

    // Load VOD Library
    try {
        const vodLibraryQuery = collection(db, collections.vodLibrary);
        onSnapshot(vodLibraryQuery, (snapshot) => {
            vodLibrary = [];
            snapshot.forEach((doc) => {
                vodLibrary.push({ id: doc.id, ...doc.data() });
            });
            if(currentTab === 'vod') renderVODLibrary();
        }, (err) => console.error("Error loading VODs:", err));
    } catch(e) { console.error("VOD listener error:", e)}

    // Load Performance Log
    try {
        const performanceLogQuery = query(collection(db, collections.performanceLog)); // Add orderBy later
        onSnapshot(performanceLogQuery, (snapshot) => {
            performanceLog = [];
            snapshot.forEach((doc) => {
                performanceLog.push({ id: doc.id, ...doc.data() });
            });
            // Sort in memory (newest first)
            performanceLog.sort((a, b) => {
                const timeA = a.finishedAt?.toMillis ? a.finishedAt.toMillis() : 0;
                const timeB = b.finishedAt?.toMillis ? b.finishedAt.toMillis() : 0;
                return timeB - timeA;
            });
            if(currentTab === 'tracker') renderTracker();
        }, (err) => console.error("Error loading performance log:", err));
    } catch(e) { console.error("Performance log listener error:", e)}

    // Load User Profile (Player Card, Game Accounts)
    try {
        const profileDocRef = doc(db, collections.userProfile, "mainProfile");
        onSnapshot(profileDocRef, (doc) => {
            if (doc.exists()) {
                userProfile = doc.data();
            } else {
                // No profile yet, use default
                userProfile = { gameAccounts: {}, playerCard: {} };
            }
            if(currentTab === 'profile') renderProfile();
        }, (err) => console.error("Error loading profile:", err));
    } catch(e) { console.error("Profile listener error:", e)}
}

// --- CALENDAR LOGIC --- //
function renderCalendar() {
    const calendarGrid = document.getElementById("calendar-grid");
    const monthYear = document.getElementById("month-year");
    if (!calendarGrid) return; // Not on this tab

    calendarGrid.innerHTML = "";
    monthYear.textContent = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startDayOfWeek = firstDay.getDay();
    const totalDays = lastDay.getDate();

    // Add empty cells for days before the 1st
    for (let i = 0; i < startDayOfWeek; i++) {
        calendarGrid.innerHTML += `<div class="calendar-day other-month p-2 h-24 rounded-lg"></div>`;
    }

    // Add cells for each day of the month
    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // Find events for this day
        const dayEvents = events.filter(e => e.date === dateStr);
        let eventDots = '';
        if (dayEvents.length > 0) {
            const eventColors = {
                training: 'bg-blue-400',
                tournament: 'bg-red-400',
                'vod-review': 'bg-green-400',
                personal: 'bg-yellow-400'
            };
            eventDots = `<div class="mt-1 flex justify-center space-x-1">`;
            dayEvents.slice(0, 3).forEach(event => {
                eventDots += `<span class="event-dot ${eventColors[event.type] || 'bg-gray-400'}"></span>`;
            });
            eventDots += `</div>`;
        }

        calendarGrid.innerHTML += `
            <div class="calendar-day p-2 h-24 bg-gray-800 rounded-lg text-white">
                <span class="text-sm font-medium">${day}</span>
                ${eventDots}
            </div>
        `;
    }
}

async function handleAddEvent(e) {
    e.preventDefault();
    const title = document.getElementById("event-title").value;
    const date = document.getElementById("event-date").value;
    const type = document.getElementById("event-type").value;

    const newEvent = { title, date, type };

    if (isFirebaseInitialized) {
        try {
            await addDoc(collection(db, collections.events), newEvent);
        } catch (error) {
            console.error("Error adding event:", error);
        }
    } else {
        events.push({ id: `demo-${Date.now()}`, ...newEvent });
        renderCalendar();
    }

    hideModal("add-event-modal");
    document.getElementById("add-event-form").reset();
}

// --- PROFILE LOGIC --- //
function renderProfile() {
    const socialList = document.getElementById("social-links-list");
    if (!socialList) return; // Not on this tab

    socialList.innerHTML = "";
    if (socialLinks.length === 0) {
        socialList.innerHTML = `<p class="text-gray-400">No linked accounts yet.</p>`;
    }

    const icons = {
        Twitch: '🟣',
        X: '🐦',
        YouTube: '🟥',
        Discord: '💬',
        Steam: '🔷'
    };

    socialLinks.forEach(link => {
        const platformIcon = icons[link.platform] || '🔗';
        socialList.innerHTML += `
            <div class="bg-gray-700 p-3 rounded-lg flex justify-between items-center">
                <span class="font-medium">${platformIcon} ${link.platform}: ${link.username}</span>
                <button data-id="${link.id}" class="unlink-social-btn text-red-400 hover:text-red-300 text-sm">Unlink</button>
            </div>
        `;
    });

    // Add event listeners for new unlink buttons
    document.querySelectorAll('.unlink-social-btn').forEach(btn => {
        btn.onclick = (e) => handleUnlinkSocial(e.target.dataset.id);
    });
    
    // Render Game Accounts
    const gameAccountsContainer = document.getElementById("game-accounts-container");
    if (gameAccountsContainer) {
        gameAccountsContainer.innerHTML = "";
        games.forEach(game => {
            const username = userProfile.gameAccounts?.[game.id] || "";
            gameAccountsContainer.innerHTML += `
                <div>
                    <label for="account-${game.id}" class="block text-sm font-medium text-gray-300">${game.name} Username</label>
                    <input type="text" id="account-${game.id}" data-game-id="${game.id}" class="game-account-input mt-1 block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" value="${username}" placeholder="Your in-game name">
                </div>
            `;
        });
    }
    
    // Render Player Card
    const playerCardContainer = document.getElementById("player-card-container");
    if (playerCardContainer) {
        playerCardContainer.innerHTML = "";
        games.forEach(game => {
            const card = userProfile.playerCard?.[game.id] || { role: '', style: '', availability: '' };
            playerCardContainer.innerHTML += `
                <div class="p-4 bg-gray-700 rounded-lg space-y-3">
                    <h4 class="text-lg font-semibold text-white">${game.name}</h4>
                    <div>
                        <label for="card-role-${game.id}" class="block text-sm font-medium text-gray-300">My Role</label>
                        <input type="text" id="card-role-${game.id}" data-game-id="${game.id}" data-field="role" class="player-card-input mt-1 block w-full bg-gray-600 border-gray-500 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" value="${card.role}" placeholder="e.g., Anchor, IGL, Support">
                    </div>
                    <div>
                        <label for="card-style-${game.id}" class="block text-sm font-medium text-gray-300">Playstyle</label>
                        <input type="text" id="card-style-${game.id}" data-game-id="${game.id}" data-field="style" class="player-card-input mt-1 block w-full bg-gray-600 border-gray-500 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" value="${card.style}" placeholder="e.g., Aggressive, Pass-first">
                    </div>
                    <div>
                        <label for="card-availability-${game.id}" class="block text-sm font-medium text-gray-300">Availability</label>
                        <input type="text" id="card-availability-${game.id}" data-game-id="${game.id}" data-field="availability" class="player-card-input mt-1 block w-full bg-gray-600 border-gray-500 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" value="${card.availability}" placeholder="e.g., Weeknights 8-11 PM SAST">
                    </div>
                </div>
            `;
        });
    }
}

async function handleAddSocial(e) {
    e.preventDefault();
    const platform = document.getElementById("social-platform").value;
    const username = document.getElementById("social-username").value;

    const newLink = { platform, username };

    if (isFirebaseInitialized) {
        try {
            await addDoc(collection(db, collections.socialLinks), newLink);
        } catch (error) {
            console.error("Error adding social link:", error);
        }
    } else {
        socialLinks.push({ id: `demo-${Date.now()}`, ...newLink });
        renderProfile();
    }

    hideModal("add-social-modal");
    document.getElementById("add-social-form").reset();
}

async function handleUnlinkSocial(id) {
    if (isFirebaseInitialized) {
        try {
            await deleteDoc(doc(db, collections.socialLinks, id));
        } catch (error) {
            console.error("Error unlinking social:", error);
        }
    } else {
        socialLinks = socialLinks.filter(link => link.id !== id);
        renderProfile();
    }
}

async function handleSaveProfile(e) {
    e.preventDefault();
    const saveButton = e.target;
    const originalText = saveButton.textContent;
    saveButton.textContent = "Saving...";
    saveButton.disabled = true;

    // Collect Game Accounts
    document.querySelectorAll('.game-account-input').forEach(input => {
        const gameId = input.dataset.gameId;
        if (!userProfile.gameAccounts) userProfile.gameAccounts = {};
        userProfile.gameAccounts[gameId] = input.value.trim();
    });

    // Collect Player Card
    document.querySelectorAll('.player-card-input').forEach(input => {
        const gameId = input.dataset.gameId;
        const field = input.dataset.field;
        if (!userProfile.playerCard) userProfile.playerCard = {};
        if (!userProfile.playerCard[gameId]) userProfile.playerCard[gameId] = {};
        userProfile.playerCard[gameId][field] = input.value.trim();
    });

    if (isFirebaseInitialized) {
        try {
            const profileDocRef = doc(db, collections.userProfile, "mainProfile");
            await setDoc(profileDocRef, userProfile);
        } catch (error) {
            console.error("Error saving profile:", error);
        }
    } else {
        console.log("Profile saved to demo state:", userProfile);
    }

    saveButton.textContent = "Saved!";
    setTimeout(() => {
        saveButton.textContent = originalText;
        saveButton.disabled = false;
    }, 1500);
}

// --- VOD LIBRARY LOGIC --- //
function renderVODLibrary() {
    const listContainer = document.getElementById("vod-clip-list");
    if (!listContainer) return; // Not on this tab
    
    listContainer.innerHTML = "";

    if (vodLibrary.length === 0) {
        listContainer.innerHTML = `<p class="text-gray-400 p-4">Your VOD library is empty. Add a clip to get started!</p>`;
        return;
    }
    
    // Sort by most recently added (if timestamp exists)
    const sortedLibrary = [...vodLibrary].sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
    });

    sortedLibrary.forEach(clip => {
        listContainer.innerHTML += `
            <div class="vod-clip-item flex justify-between items-center p-3 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer" data-clip-id="${clip.id}">
                <div>
                    <h4 class="font-medium text-white">${clip.title}</h4>
                    <span class="text-sm text-gray-400">${getGameNameById(clip.game)}</span>
                </div>
                <button data-id="${clip.id}" class="delete-vod-btn text-red-500 hover:text-red-400 text-xs font-medium">DELETE</button>
            </div>
        `;
    });
    
    // Add event listeners for new items
    document.querySelectorAll('.vod-clip-item').forEach(item => {
        item.onclick = (e) => {
            if (e.target.classList.contains('delete-vod-btn')) {
                handleDeleteVOD(e.target.dataset.id);
            } else {
                loadVODInReviewer(item.dataset.clipId);
            }
        };
    });
}

async function handleAddVOD(e) {
    e.preventDefault();
    const url = document.getElementById("vod-url").value;
    const title = document.getElementById("vod-title").value;
    const game = document.getElementById("vod-game").value;
    
    const embedUrl = getYouTubeEmbedUrl(url);
    if (!embedUrl) {
        console.error("Invalid YouTube URL.");
        return;
    }
    
    const newClip = {
        url,
        embedUrl,
        title,
        game,
        notes: "",
        createdAt: isFirebaseInitialized ? serverTimestamp() : new Date().toISOString()
    };

    if (isFirebaseInitialized) {
        try {
            await addDoc(collection(db, collections.vodLibrary), newClip);
        } catch (error) {
            console.error("Error adding VOD:", error);
        }
    } else {
        vodLibrary.push({ id: `demo-${Date.now()}`, ...newClip });
        renderVODLibrary();
    }

    hideModal("add-vod-modal");
    document.getElementById("add-vod-form").reset();
}

async function handleDeleteVOD(id) {
    if (isFirebaseInitialized) {
        try {
            await deleteDoc(doc(db, collections.vodLibrary, id));
        } catch (error) {
            console.error("Error deleting VOD:", error);
        }
    } else {
        vodLibrary = vodLibrary.filter(clip => clip.id !== id);
        renderVODLibrary();
    }
    
    // Clear review station if the deleted clip was loaded
    const reviewStation = document.getElementById('vod-review-station');
    if (reviewStation.dataset.currentClipId === id) {
        reviewStation.querySelector('iframe').src = "about:blank";
        reviewStation.querySelector('textarea').value = "";
        reviewStation.querySelector('h3').textContent = "Select a clip to review";
        reviewStation.dataset.currentClipId = "";
    }
}

function loadVODInReviewer(id) {
    const clip = vodLibrary.find(c => c.id === id);
    if (!clip) return;
    
    const reviewStation = document.getElementById('vod-review-station');
    reviewStation.dataset.currentClipId = id;
    
    reviewStation.querySelector('h3').textContent = clip.title;
    reviewStation.querySelector('iframe').src = clip.embedUrl || "about:blank";
    reviewStation.querySelector('textarea').value = clip.notes || "";
}

async function handleVODNotesChange(e) {
    const notes = e.target.value;
    const clipId = document.getElementById('vod-review-station').dataset.currentClipId;
    
    if (!clipId) return;

    // Debounce the save
    clearTimeout(vodNotesDebounceTimer);
    vodNotesDebounceTimer = setTimeout(async () => {
        if (isFirebaseInitialized) {
            try {
                const docRef = doc(db, collections.vodLibrary, clipId);
                await updateDoc(docRef, { notes: notes });
            } catch (error) {
                console.error("Error auto-saving VOD notes:", error);
            }
        } else {
            // Update in-memory
            const clip = vodLibrary.find(c => c.id === clipId);
            if (clip) clip.notes = notes;
        }
        
        // Show "saved" indicator
        const saveIndicator = document.getElementById('vod-save-indicator');
        if (saveIndicator) {
            saveIndicator.textContent = "Saved.";
            setTimeout(() => {
                saveIndicator.textContent = "Notes auto-save.";
            }, 1500);
        }

    }, 500); // 500ms delay
}

// --- TRACKER LOGIC --- //
function renderTracker() {
    const liveSessionContainer = document.getElementById("live-session-container");
    const startSessionContainer = document.getElementById("start-session-container");
    const sessionLogContainer = document.getElementById("session-log-container");

    if (!liveSessionContainer) return; // Not on this tab

    // Render Live Session
    if (currentLiveSession) {
        liveSessionContainer.classList.remove("hidden");
        startSessionContainer.classList.add("hidden");
        
        liveSessionContainer.querySelector('h3').textContent = `Live Session: ${getGameNameById(currentLiveSession.game)} (${currentLiveSession.mode})`;
        liveSessionContainer.querySelector('#session-wins').value = currentLiveSession.wins;
        liveSessionContainer.querySelector('#session-losses').value = currentLiveSession.losses;
        
        const notesList = liveSessionContainer.querySelector('#live-notes-list');
        notesList.innerHTML = currentLiveSession.notes.map(note => 
            `<li class="text-gray-300"><span class="text-gray-500 text-xs mr-2">${note.time}</span>${note.text}</li>`
        ).join('');
        
    } else {
        liveSessionContainer.classList.add("hidden");
        startSessionContainer.classList.remove("hidden");
    }

    // Render Session Log
    sessionLogContainer.innerHTML = "";
    if (performanceLog.length === 0) {
        sessionLogContainer.innerHTML = `<p class="text-gray-400">No practice sessions logged yet.</p>`;
    } else {
        performanceLog.forEach(session => {
            const timestamp = session.finishedAt?.toDate ? session.finishedAt.toDate().toLocaleString() : 'someday';
            sessionLogContainer.innerHTML += `
                <div class="bg-gray-800 p-4 rounded-lg">
                    <div class="flex justify-between items-center mb-2">
                        <h4 class="text-lg font-semibold text-white">${getGameNameById(session.game)} - ${session.mode}</h4>
                        <span class="text-sm text-gray-400">${timestamp}</span>
                    </div>
                    <div class="flex space-x-4 mb-3">
                        <span class="font-medium text-green-400">Wins: ${session.wins}</span>
                        <span class="font-medium text-red-400">Losses: ${session.losses}</span>
                        <span class="font-medium text-indigo-400">W/L: ${session.losses > 0 ? (session.wins / (session.wins + session.losses) * 100).toFixed(0) : (session.wins > 0 ? 100 : 0)}%</span>
                    </div>
                    <ul class="list-disc list-inside space-y-1 text-gray-300">
                        ${session.notes.map(note => `<li><span class="text-gray-500 text-xs mr-2">${note.time}</span>${note.text}</li>`).join('')}
                    </ul>
                </div>
            `;
        });
    }
    
    // Render Dashboard
    renderTrackerDashboard();
}

function handleStartSession(e) {
    e.preventDefault();
    const game = document.getElementById("session-game").value;
    const mode = document.getElementById("session-mode").value;

    currentLiveSession = {
        game,
        mode,
        wins: 0,
        losses: 0,
        notes: [],
        startedAt: new Date()
    };
    
    hideModal("start-session-modal");
    document.getElementById("start-session-form").reset();
    renderTracker();
}

function handleAddQuickNote(e) {
    e.preventDefault();
    const noteInput = document.getElementById("quick-note-text");
    const text = noteInput.value;
    if (!text || !currentLiveSession) return;

    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    currentLiveSession.notes.push({ time, text });
    
    noteInput.value = "";
    renderTracker();
}

async function handleFinishSession() {
    if (!currentLiveSession) return;

    const sessionToSave = {
        ...currentLiveSession,
        wins: parseInt(document.getElementById("session-wins").value) || 0,
        losses: parseInt(document.getElementById("session-losses").value) || 0,
        finishedAt: isFirebaseInitialized ? serverTimestamp() : new Date().toISOString()
    };
    
    delete sessionToSave.startedAt; // No longer needed

    if (isFirebaseInitialized) {
        try {
            await addDoc(collection(db, collections.performanceLog), sessionToSave);
        } catch (error) {
            console.error("Error saving session:", error);
        }
    } else {
        performanceLog.unshift({ id: `demo-${Date.now()}`, ...sessionToSave });
    }

    currentLiveSession = null;
    renderTracker();
}

function renderTrackerDashboard() {
    const gameId = document.getElementById('dashboard-game-select').value;
    const statsContainer = document.getElementById('dashboard-stats');
    const chartContainer = document.getElementById('dashboard-chart-container');
    
    if (!statsContainer) return; // Not on this tab
    
    const gameSessions = performanceLog.filter(s => s.game === gameId);
    
    let totalWins = 0;
    let totalLosses = 0;
    
    gameSessions.forEach(s => {
        totalWins += s.wins;
        totalLosses += s.losses;
    });
    
    const totalMatches = totalWins + totalLosses;
    const winRate = totalMatches > 0 ? (totalWins / totalMatches * 100).toFixed(1) : "0";
    
    statsContainer.innerHTML = `
        <div><span class="block text-2xl font-bold text-green-400">${totalWins}</span><span class="text-sm text-gray-400">Total Wins</span></div>
        <div><span class="block text-2xl font-bold text-red-400">${totalLosses}</span><span class="text-sm text-gray-400">Total Losses</span></div>
        <div><span class="block text-2xl font-bold text-indigo-400">${winRate}%</span><span class="text-sm text-gray-400">Win Rate</span></div>
    `;
    
    // Prepare chart data
    const chartLabels = [];
    const chartData = [];
    
    // Go in reverse (oldest to newest)
    [...gameSessions].reverse().forEach((session, index) => {
        const sessionMatches = session.wins + session.losses;
        if (sessionMatches > 0) {
            const sessionWinRate = (session.wins / sessionMatches) * 100;
            chartLabels.push(`Session ${index + 1}`);
            chartData.push(sessionWinRate);
        }
    });
    
    // Destroy old chart if it exists
    if (performanceChart) {
        performanceChart.destroy();
    }
    
    if (chartData.length > 0) {
        chartContainer.innerHTML = `<canvas id="performance-chart"></canvas>`;
        const ctx = document.getElementById('performance-chart').getContext('2d');
        if (ctx) {
            performanceChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: 'Session Win Rate (%)',
                        data: chartData,
                        fill: false,
                        borderColor: 'rgb(129, 140, 248)', // indigo-400
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: { color: '#9ca3af' }, // gray-400
                            grid: { color: '#374151' } // gray-700
                        },
                        x: {
                            ticks: { color: '#9ca3af' }, // gray-400
                            grid: { color: '#374151' } // gray-700
                        }
                    },
                    plugins: {
                        legend: {
                            labels: { color: '#d1d5db' } // gray-300
                        }
                    }
                }
            });
        }
    } else {
        chartContainer.innerHTML = `<p class="text-gray-400 text-center p-8">Log some sessions for this game to see your performance chart.</p>`;
    }
}

// --- APP RENDERING & NAVIGATION --- //
function renderApp() {
    const nav = document.getElementById("main-nav");
    const content = document.getElementById("page-content");
    
    if (!nav || !content) {
        console.error("Core layout elements not found. App cannot render.");
        return;
    }
    
    // 1. Render Navigation
    nav.innerHTML = '<ul class="py-4">';
    navItems.forEach(item => {
        const isActive = item.id === currentTab;
        nav.innerHTML += `
            <li>
                <a href="#" data-tab="${item.id}" class="nav-link flex items-center px-4 py-3 ${isActive ? 'bg-gray-900 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}">
                    <span class="text-xl mr-3">${item.icon}</span>
                    <span>${item.name}</span>
                </a>
            </li>
        `;
    });
    nav.innerHTML += '</ul>';

    // 2. Render Page Content
    content.innerHTML = getPageContent(currentTab);
    
    // 3. Populate any dynamic elements (like game dropdowns)
    populateGameSelects();
    
    // 4. Run the specific render function for the active tab
    switch (currentTab) {
        case "calendar":
            renderCalendar();
            break;
        case "profile":
            renderProfile();
            break;
        case "tracker":
            renderTracker();
            break;
        case "vod":
            renderVODLibrary();
            break;
    }
    
    // 5. (Re)add event listeners for the new page content
    addPageEventListeners();
}

function navigateTo(tabId) {
    currentTab = tabId;
    renderApp();
}

function getPageContent(tabId) {
    switch (tabId) {
        case "calendar":
            return `
                <h1 class="text-3xl font-bold text-white mb-6">Calendar</h1>
                <div class="bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                    <div class="flex justify-between items-center p-4 border-b border-gray-700">
                        <button id="prev-month" class="p-2 rounded-md hover:bg-gray-700">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                        <h2 id="month-year" class="text-xl font-semibold"></h2>
                        <button id="next-month" class="p-2 rounded-md hover:bg-gray-700">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                    </div>
                    <div id="calendar-grid" class="grid grid-cols-7 gap-1 p-4">
                        <!-- Calendar days will be injected here -->
                    </div>
                    <div class="p-4 border-t border-gray-700">
                        <button id="open-add-event-modal" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-md">
                            Add New Event
                        </button>
                    </div>
                </div>
            `;
        case "profile":
            return `
                <h1 class="text-3xl font-bold text-white mb-6">My Profile</h1>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <!-- Social Links -->
                    <div class="bg-gray-800 rounded-lg shadow-xl p-6">
                        <div class="flex justify-between items-center mb-4">
                            <h2 class="text-xl font-semibold text-white">Linked Socials</h2>
                            <button id="open-add-social-modal" class="bg-indigo-600 hover:bg-indigo-500 text-white py-1 px-3 rounded-md text-sm">Add</button>
                        </div>
                        <div id="social-links-list" class="space-y-3">
                            <!-- Social links will be injected here -->
                        </div>
                    </div>
                    
                    <!-- Game Accounts -->
                    <div class="bg-gray-800 rounded-lg shadow-xl p-6">
                        <h2 class="text-xl font-semibold text-white mb-4">Game Accounts</h2>
                        <form id="profile-game-accounts-form" class="space-y-4">
                            <div id="game-accounts-container" class="space-y-4">
                                <!-- Game account inputs will be injected here -->
                            </div>
                        </form>
                    </div>
                    
                    <!-- Player Card -->
                    <div class="bg-gray-800 rounded-lg shadow-xl p-6 lg:col-span-2">
                        <h2 class="text-xl font-semibold text-white mb-4">Pro-Am Player Card</h2>
                        <p class="text-gray-400 mb-4 text-sm">Define your playstyle and availability to help you find teammates.</p>
                        <form id="profile-player-card-form">
                            <div id="player-card-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <!-- Player card inputs will be injected here -->
                            </div>
                        </form>
                    </div>
                </div>
                <!-- Save Button -->
                <div class="mt-6">
                    <button id="save-profile-btn" class="bg-green-600 hover:bg-green-500 text-white py-2 px-6 rounded-md">Save Profile</button>
                </div>
            `;
        case "games":
            return `
                <h1 class="text-3xl font-bold text-white mb-6">My Games</h1>
                <div id="my-games-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <!-- MODIFIED: Removed AI Button -->
                    ${games.map(game => `
                        <div class="bg-gray-800 rounded-lg shadow-xl p-6 flex flex-col justify-between">
                            <div>
                                <span class="text-4xl">${game.icon}</span>
                                <h2 class="text-2xl font-bold text-white mt-4">${game.name}</h2>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        case "vod":
            return `
                <h1 class="text-3xl font-bold text-white mb-6">VOD Library</h1>
                <div class="flex justify-end mb-4">
                    <button id="open-add-vod-modal" class="bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-md">Add VOD Clip</button>
                </div>
                
                <!-- Review Station -->
                <div id="vod-review-station" data-current-clip-id="" class="bg-gray-800 rounded-lg shadow-xl overflow-hidden mb-8">
                    <div class="p-4 border-b border-gray-700">
                        <h3 class="text-xl font-semibold text-white">Select a clip to review</h3>
                    </div>
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
                        <div class="aspect-w-16 aspect-h-9 bg-black rounded-lg overflow-hidden">
                            <iframe id="vod-player" class="w-full h-full" src="about:blank" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                        </div>
                        <div class="flex flex-col">
                            <label for="vod-notes" class="block text-sm font-medium text-gray-300">My Analysis</label>
                            <textarea id="vod-notes" rows="10" class="flex-1 mt-1 block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" placeholder="Write your analysis here..."></textarea>
                            <span id="vod-save-indicator" class="text-xs text-gray-400 mt-1">Notes auto-save.</span>
                            <!-- MODIFIED: Removed AI Buttons -->
                        </div>
                    </div>
                </div>
                
                <!-- Clip Library List -->
                <h2 class="text-2xl font-semibold text-white mb-4">Your Clip Library</h2>
                <div id="vod-clip-list" class="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
                    <!-- VOD clips will be injected here -->
                </div>
            `;
        case "tracker":
            return `
                <h1 class="text-3xl font-bold text-white mb-6">Performance Tracker</h1>
                
                <!-- Dashboard -->
                <div class="bg-gray-800 rounded-lg shadow-xl p-6 mb-8">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-semibold text-white">Dashboard</h2>
                        <select id="dashboard-game-select" class="bg-gray-700 border-gray-600 rounded-md shadow-sm text-white text-sm focus:ring-indigo-500 focus:border-indigo-500">
                            <!-- Options injected by JS -->
                        </select>
                    </div>
                    <div id="dashboard-stats" class="grid grid-cols-3 gap-4 text-center mb-6">
                        <!-- Stats will be injected here -->
                    </div>
                    <div id="dashboard-chart-container" class="chart-container">
                        <canvas id="performance-chart"></canvas>
                    </div>
                    <!-- MODIFIED: Removed Auto-Tracker Button -->
                </div>

                <!-- Live Session -->
                <div id="start-session-container" class="mb-8">
                    <button id="open-start-session-modal" class="w-full bg-green-600 hover:bg-green-500 text-white py-3 px-6 rounded-lg text-lg font-medium">Start New Practice Session</button>
                </div>
                
                <div id="live-session-container" class="bg-gray-800 rounded-lg shadow-xl p-6 mb-8 hidden">
                    <h3 class="text-xl font-semibold text-white mb-4">Live Session: ...</h3>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div>
                            <label for="session-wins" class="block text-sm font-medium text-gray-300">Wins</label>
                            <input type="number" id="session-wins" class="mt-1 block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" min="0" value="0">
                        </div>
                        <div>
                            <label for="session-losses" class="block text-sm font-medium text-gray-300">Losses</label>
                            <input type="number" id="session-losses" class="mt-1 block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" min="0" value="0">
                        </div>
                        <div class="md:col-span-3">
                            <form id="quick-note-form">
                                <label for="quick-note-text" class="block text-sm font-medium text-gray-300">Quick Note</label>
                                <div class="flex space-x-2 mt-1">
                                    <input type="text" id="quick-note-text" class="flex-1 block w-full bg-gray-700 border-gray-600 rounded-md shadow-sm text-white focus:ring-indigo-500 focus:border-indigo-500" placeholder="e.g., Missed easy aerial">
                                    <button type="submit" class="bg-indigo-600 hover:bg-indigo-500 text-white py-2 px-4 rounded-md">Add</button>
                                </div>
                            </form>
                        </div>
                    </div>
                    <ul id="live-notes-list" class="space-y-1 mb-4 max-h-40 overflow-y-auto">
                        <!-- Quick notes will be injected here -->
                    </ul>
                    <button id="finish-session-btn" class="w-full bg-red-600 hover:bg-red-500 text-white py-2 px-4 rounded-md">Finish Session</button>

                </div>
                
                <!-- Session Log -->
                <h2 class="text-2xl font-semibold text-white mb-4">Session Log</h2>
                <div id="session-log-container" class="space-y-4">
                    <!-- Logged sessions will be injected here -->
                </div>
            `;
        default:
            return `<h1 class="text-3xl font-bold text-white">Page Not Found</h1>`;
    }
}

function populateGameSelects() {
    // MODIFIED: Simplified the list of selects
    const gameSelects = document.querySelectorAll('#vod-game, #session-game, #dashboard-game-select');
    gameSelects.forEach(select => {
        if (!select) return;
        select.innerHTML = '';
        games.forEach(game => {
            select.innerHTML += `<option value="${game.id}">${game.name}</option>`;
        });
    });
}

// --- GLOBAL EVENT LISTENERS --- //
function addPageEventListeners() {
    // Calendar
    const prevMonthBtn = document.getElementById("prev-month");
    if (prevMonthBtn) prevMonthBtn.onclick = () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderCalendar();
    };
    
    const nextMonthBtn = document.getElementById("next-month");
    if (nextMonthBtn) nextMonthBtn.onclick = () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderCalendar();
    };

    const addEventForm = document.getElementById("add-event-form");
    if (addEventForm) addEventForm.onsubmit = handleAddEvent;
    
    // Profile
    const addSocialForm = document.getElementById("add-social-form");
    if (addSocialForm) addSocialForm.onsubmit = handleAddSocial;
    
    const saveProfileBtn = document.getElementById("save-profile-btn");
    if (saveProfileBtn) saveProfileBtn.onclick = handleSaveProfile;

    // VOD Library
    const addVodForm = document.getElementById("add-vod-form");
    if (addVodForm) addVodForm.onsubmit = handleAddVOD;

    const vodNotes = document.getElementById("vod-notes");
    if (vodNotes) vodNotes.onkeyup = handleVODNotesChange;

    // Tracker
    const startSessionForm = document.getElementById("start-session-form");
    if (startSessionForm) startSessionForm.onsubmit = handleStartSession;
    
    const quickNoteForm = document.getElementById("quick-note-form");
    if (quickNoteForm) quickNoteForm.onsubmit = handleAddQuickNote;
    
    const finishSessionBtn = document.getElementById("finish-session-btn");
    if (finishSessionBtn) finishSessionBtn.onclick = handleFinishSession;
    
    const dashboardGameSelect = document.getElementById("dashboard-game-select");
    if (dashboardGameSelect) dashboardGameSelect.onchange = renderTrackerDashboard;

    // --- MODIFIED: Removed all AI and Auto-Tracker listeners ---
}


// --- APP STARTUP --- //
document.addEventListener("DOMContentLoaded", () => {
    // Initial render (skeleton)
    renderApp();
    
    // Add event listeners for navigation and static modal buttons
    const nav = document.getElementById("main-nav");
    if (nav) {
        nav.onclick = (e) => {
            const link = e.target.closest('.nav-link');
            if (link) {
                e.preventDefault();
                navigateTo(link.dataset.tab);
            }
        };
    }

    const openAddEventModalBtn = document.getElementById("open-add-event-modal");
    if (openAddEventModalBtn) openAddEventModalBtn.onclick = () => showModal("add-event-modal");
    
    const cancelEventModalBtn = document.getElementById("cancel-event-modal");
    if (cancelEventModalBtn) cancelEventModalBtn.onclick = () => hideModal("add-event-modal");
    
    const openAddSocialModalBtn = document.getElementById("open-add-social-modal");
    if (openAddSocialModalBtn) openAddSocialModalBtn.onclick = () => showModal("add-social-modal");
    
    const cancelSocialModalBtn = document.getElementById("cancel-social-modal");
    if (cancelSocialModalBtn) cancelSocialModalBtn.onclick = () => hideModal("add-social-modal");
        
    const openAddVodModalBtn = document.getElementById("open-add-vod-modal");
    if (openAddVodModalBtn) openAddVodModalBtn.onclick = () => showModal("add-vod-modal");
    
    const cancelVodModalBtn = document.getElementById("cancel-vod-modal");
    if (cancelVodModalBtn) cancelVodModalBtn.onclick = () => hideModal("add-vod-modal");
        
    const openStartSessionModalBtn = document.getElementById("open-start-session-modal");
    if (openStartSessionModalBtn) openStartSessionModalBtn.onclick = () => showModal("start-session-modal");
    
    const cancelSessionModalBtn = document.getElementById("cancel-session-modal");
    if (cancelSessionModalBtn) cancelSessionModalBtn.onclick = () => hideModal("start-session-modal");
    
    // Add event listeners for the default page
    addPageEventListeners();
    
    // Try to connect to Firebase
    initializeFirebase();
});