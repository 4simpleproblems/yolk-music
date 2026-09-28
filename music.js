const API_BASE_URL = '/api/music-api';
function getDownloadUrl(item) {
    if (!item) return '';
    if (item.source === 'MusicAPI' && item.downloadUrl?.[0]?.link) {
        return getProxyUrl(item.downloadUrl[0].link);
    }
    const rawYtId = item.youtube_id || item.videoId || (item.id && typeof item.id === 'string' && item.id.startsWith('ytm-') && !item.id.startsWith('ytm-gen-') ? item.id.replace('ytm-', '') : null);
    if (rawYtId && rawYtId.length === 11) {
        return `${API_BASE_URL}?endpoint=stream&id=${encodeURIComponent(rawYtId)}`;
    }
    let url = '';
    if (item.downloadUrl && Array.isArray(item.downloadUrl) && item.downloadUrl.length > 0) {
        const b = item.downloadUrl.find(d => d.quality === '96kbps') || 
                  item.downloadUrl.find(d => d.quality === '160kbps') || 
                  item.downloadUrl.find(d => d.quality === '320kbps') || 
                  item.downloadUrl[item.downloadUrl.length - 1];
        url = b.link || b.url;
    }

    if (!url && item.media_url) url = item.media_url;
    if (url) {
        if (url.startsWith('/api/') || url.startsWith('/music-api')) return url;
        return getProxyUrl(url);
    }
    return '';
}
function getProxyUrl(url, size = null) {
    if (!url) return url;
    if (typeof url !== 'string') return url;
    if (url.startsWith('data:')) return url;

    if (url.includes('saavncdn.com')) {
        if (size) {
            url = url.replace(/_([0-9]+x[0-9]+|150|500)\.jpg/i, `_${size}.jpg`);
        } else {
            url = url.replace(/_([0-9]+x[0-9]+|150|500)\.jpg/i, `_500x500.jpg`);
        }
    }

    if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
        const targetSize = (size === '50x50') ? 's50' : 'w1000-h1000-l90-rj';
        if (url.includes('=')) {
            url = url.split('=')[0] + '=' + targetSize;
        } else {
            url += '=' + targetSize;
        }
    }

    if (url.includes('i.ytimg.com')) {
        url = url.replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg/gi, '/0.jpg');
    }

    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/api/proxy') || url.startsWith('/p/')) return url;
    return '/api/proxy?url=' + encodeURIComponent(url);
}

let isInitialized = false;
let currentTrack = null;
let playlist = [];
let originalPlaylist = [];
let shuffledIndices = [];
let shuffledCurrentIndex = 0;
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 'off';
let favorites = [];
let playlists = [];
let player = null;
let progressInterval = null;
let volume = parseInt(localStorage.getItem('velium_v2_volume')) || 70;
let settings = JSON.parse(localStorage.getItem('velium_v2_settings')) || {};

function saveSettings() {
    localStorage.setItem('velium_v2_settings', JSON.stringify(settings));
}

function applySettings() {
    if (window.ThemeManager && typeof window.ThemeManager.applyTheme === 'function') {
        window.ThemeManager.applyTheme();
    }
}

window.showSettingsModal = function() {
    switchView('settings');
};

window.hideSettingsModal = function() {
    switchView('home');
};

window.toggleLightMode = function() {
    if (window.ThemeManager) {
        const currentIsDark = window.ThemeManager.isDark();
        window.ThemeManager.setSetting(currentIsDark ? 'light' : 'dark');
    }
};

window.updateLibraryLimit = function() {};

let preloadedNextTrack = null;
let preloadedPrevTrack = null;
let currentSearchResults = [];
const searchCache = new Map();
const pendingSearches = new Map();

async function getYoutubeId(track) {
    if (!track) return null;
    if (track.youtube_id || track.videoId) return track.youtube_id || track.videoId;
    if (track.id && typeof track.id === 'string' && track.id.startsWith('ytm-') && !track.id.startsWith('ytm-gen-')) {
        const rawId = track.id.replace('ytm-', '');
        track.youtube_id = rawId;
        track.videoId = rawId;
        return rawId;
    }
    
    const uid = getTrackUid(track);
    if (pendingSearches.has(uid)) return pendingSearches.get(uid);

    const promise = (async () => {
        try {
            const query = `${track.title} ${track.artist_name || track.artist || ''}`.trim();
            const response = await fetch(`${API_BASE_URL}?endpoint=youtube-search&q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (data.videoId) {
                track.youtube_id = data.videoId;
                track.videoId = data.videoId;
                saveLibraryData();
                return data.videoId;
            }
        } catch (e) {
            console.error('VELIUM: Search failed', e);
        } finally {
            pendingSearches.delete(uid);
        }
        return null;
    })();

    pendingSearches.set(uid, promise);
    return promise;
}

const popularArtists = [
    'The Weeknd', 'Drake', 'Post Malone', 'Dua Lipa', 'Ed Sheeran',
    'Ariana Grande', 'Travis Scott', 'Olivia Rodrigo', 'Bad Bunny', 'SZA'
];
const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        const img = entry.target;
        if (entry.isIntersecting) {
            if (img.dataset.src) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                observer.unobserve(img);
            }
        }
    });
}, {
    rootMargin: "300px 0px",
    threshold: 0.01
});
function observeImages(container) {
    if (!container) return;
    const images = container.querySelectorAll('img[data-src]');
    if (images.length === 0) return;
    images.forEach(img => imageObserver.observe(img));
}
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const existingToasts = Array.from(container.querySelectorAll('.velium-toast'));
    if (existingToasts.some(t => t.querySelector('.toast-msg')?.textContent === message)) return;

    const toast = document.createElement('div');
    
    let iconClass = 'fa-info-circle text-blue-400';
    let borderColor = 'border-white/10';
    if (type === 'success') {
        iconClass = 'fa-check-circle text-green-400';
        borderColor = 'border-green-500/30';
    } else if (type === 'error') {
        iconClass = 'fa-exclamation-circle text-red-400';
        borderColor = 'border-red-500/30';
    }

    toast.className = `velium-toast flex items-center gap-3 px-5 py-3 rounded-xl backdrop-blur-xl border ${borderColor} shadow-2xl animate-in slide-in-from-right-10 duration-500 pointer-events-auto cursor-pointer`;
    toast.style.backgroundColor = 'var(--toast-bg)';
    toast.style.color = 'var(--toast-text)';
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass} text-lg"></i>
        <div class="toast-msg text-sm font-semibold tracking-wide">${message}</div>
    `;

    toast.onclick = () => {
        toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-10');
        setTimeout(() => toast.remove(), 500);
    };

    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-10');
            setTimeout(() => toast.remove(), 500);
        }
    }, 4000);
}
function getTrackUid(track) {
    if (!track) return null;
    
    if (track.stable_id) return track.stable_id;
    if (track.id && !track.id.includes('gen-')) return track.id;
    if (track.youtube_id) return `ytm-${track.youtube_id}`;
    if (track.videoId) return `ytm-${track.videoId}`;

    const title = (track.title || track.name || '').trim().toLowerCase();
    const artist = (track.artist_name || track.artist || '').trim().toLowerCase();
    const album = (track.album_name || track.album || '').trim().toLowerCase();
    return `f-${title}-${artist}-${album}`.replace(/[^a-z0-9]/g, '');
}
async function preloadTracks() {
    if (playlist.length === 0) return;
    let nextIndex = -1;
    if (isShuffle) {
        if (shuffledCurrentIndex < shuffledIndices.length - 1) nextIndex = shuffledIndices[shuffledCurrentIndex + 1];
        else if (repeatMode === 'all') nextIndex = shuffledIndices[0];
    } else {
        if (currentIndex < playlist.length - 1) nextIndex = currentIndex + 1;
        else if (repeatMode === 'all') nextIndex = 0;
    }
    let prevIndex = -1;
    if (isShuffle) {
        if (shuffledCurrentIndex > 0) prevIndex = shuffledIndices[shuffledCurrentIndex - 1];
        else if (repeatMode === 'all') prevIndex = shuffledIndices[shuffledIndices.length - 1];
    } else {
        if (currentIndex > 0) prevIndex = currentIndex - 1;
        else if (repeatMode === 'all') prevIndex = playlist.length - 1;
    }
    const tasks = [];
    if (nextIndex !== -1 && nextIndex !== currentIndex) {
        tasks.push(preloadSingleTrack(nextIndex, 'next'));
    }
    if (prevIndex !== -1 && prevIndex !== currentIndex && prevIndex !== nextIndex) {
        tasks.push(preloadSingleTrack(prevIndex, 'prev'));
    }
    await Promise.all(tasks);
}
async function preloadSingleTrack(index, type) {
    const track = playlist[index];
    if (!track) return;
    const trackUid = getTrackUid(track);
    const cache = type === 'next' ? preloadedNextTrack : preloadedPrevTrack;
    if (cache && cache.uid === trackUid) return;

    const artworkUrl = track.local_artwork || getProxyUrl(track.artwork_url, '500x500');
    if (artworkUrl) {
        const img = new Image();
        img.src = artworkUrl;
    }

    try {
        const directUrl = getDownloadUrl(track);
        if (directUrl && !directUrl.includes('endpoint=stream')) {
            const data = { index, uid: trackUid, source: 'audio', url: directUrl };
            if (type === 'next') preloadedNextTrack = data; else preloadedPrevTrack = data;
            let preloadElId = type === 'next' ? 'preloadAudioNext' : 'preloadAudioPrev';
            let preloadAudio = document.getElementById(preloadElId);
            if (!preloadAudio) {
                preloadAudio = document.createElement('audio');
                preloadAudio.id = preloadElId;
                preloadAudio.preload = 'auto';
                preloadAudio.style.display = 'none';
                document.body.appendChild(preloadAudio);
            }
            preloadAudio.src = directUrl;
            preloadAudio.load();
        } else {
            const videoId = await getYoutubeId(track);
            if (videoId) {
                const streamUrl = `${API_BASE_URL}?endpoint=stream&id=${encodeURIComponent(videoId)}`;
                const cacheData = { index, uid: trackUid, source: 'audio', url: streamUrl, videoId: videoId };
                if (type === 'next') preloadedNextTrack = cacheData; else preloadedPrevTrack = cacheData;
            }
        }
    } catch (e) { console.warn(`VELIUM: Preload ${type} failed`, e); }
}
async function silentPreloadDurations(tracks) {
    return;
}
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
async function saveTrackDuration(track, duration) {
    if (!track || !duration || duration <= 0) return;
    const durationSec = duration > 10000 ? duration / 1000 : duration;
    if (track.duration && Math.abs(track.duration - durationSec) < 2) return;
    track.duration = durationSec;
    const trackUid = getTrackUid(track);
    const favIndex = favorites.findIndex(f => getTrackUid(f) === trackUid);
    if (favIndex > -1) favorites[favIndex].duration = durationSec;
    playlists.forEach(pl => {
        pl.tracks.forEach(t => {
            if (getTrackUid(t) === trackUid) t.duration = durationSec;
        });
    });
    await saveLibraryData();
}
async function urlToBase64(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
        const response = await fetch(getProxyUrl(url));
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Failed to convert image to base64', e);
        return null;
    }
}
function generateShuffledSequence() {
    if (playlist.length === 0) return;
    let indices = playlist.map((_, i) => i);
    const currentPos = indices.indexOf(currentIndex);
    if (currentPos > -1) indices.splice(currentPos, 1);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < indices.length - 1; i++) {
        if (playlist[indices[i]].artist_name === playlist[indices[i+1]].artist_name) {
            for (let j = i + 2; j < indices.length; j++) {
                if (playlist[indices[j]].artist_name !== playlist[indices[i]].artist_name) {
                    [indices[i+1], indices[j]] = [indices[j], indices[i+1]];
                    break;
                }
            }
        }
    }
    shuffledIndices = [currentIndex, ...indices];
    shuffledCurrentIndex = 0;
}
document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => initApp());
        setTimeout(() => { if (!currentTrack && playlist.length === 0) initApp(); }, 2000);
    } else {
        initApp();
    }
});
async function initApp() {
    if (isInitialized) return;
    isInitialized = true;
    
    if (!window.YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag) firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
    
    await loadLibraryData();
    applySettings();
    setGreeting();
    setupEventListeners();
    loadPopularTracks().then(tracks => {
        if (tracks) silentPreloadDurations(tracks);
    });
    renderLibrary();
    renderBrowseCategories();
    updateVolumeUI();
    initCropper();
    if (favorites.length > 0) {
        silentPreloadDurations(favorites);
    }
    if (window.isAdmin) {
        const adminTab = document.getElementById('admin-test-tab');
        if (adminTab) adminTab.classList.remove('hidden');
    }
}
function setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view) switchView(view);
        });
    });
    const mainView = document.querySelector('.main-view');
    if (mainView) {
        mainView.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = mainView;
            if (scrollHeight - scrollTop - clientHeight < 200) {
                const searchView = document.getElementById('searchView');
                const dynamicView = document.getElementById('dynamicView');
                if (searchView && searchView.classList.contains('active')) {
                    if (searchState.query && !searchState.loading && searchState.hasMoreTracks) {
                        handleSearch(searchState.query, true);
                    }
                }
                else if (dynamicView && dynamicView.classList.contains('active')) {
                    if (artistSearchState.name && !artistSearchState.loading && artistSearchState.hasMore) {
                        loadArtistView(artistSearchState.name, true);
                    }
                }
            }
        });
    }
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query) {
                searchTimeout = setTimeout(() => handleSearch(query, false), 1000);
            } else {
                searchState.query = '';
                searchState.tracksOffset = 0;
                currentSearchResults = [];
                const searchRes = document.getElementById('searchResults');
                if (searchRes) searchRes.classList.add('hidden');
                const browseCat = document.getElementById('browseCategories');
                if (browseCat) browseCat.classList.remove('hidden');
                const tracksGrid = document.getElementById('searchGrid');
                if (tracksGrid) tracksGrid.innerHTML = '';
                const pagination = document.getElementById('searchPagination');
                if (pagination) {
                    pagination.classList.add('hidden');
                    pagination.style.display = 'none';
                }
            }
        });
    }
    const nextBtn = document.getElementById('nextButton');
    const prevBtn = document.getElementById('prevPageBtn');
    if (nextBtn) nextBtn.addEventListener('click', searchNextPage);
    if (prevBtn) prevBtn.addEventListener('click', searchPrevPage);

    const progressTrack = document.getElementById('progressTrack');
    if (progressTrack) {
        progressTrack.addEventListener('click', (e) => {
            const rect = progressTrack.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (activeSource === 'youtube' && player && typeof player.seekTo === 'function') {
                const dur = (typeof player.getDuration === 'function' && player.getDuration() > 0)
                    ? player.getDuration()
                    : (currentTrack && currentTrack.duration ? (currentTrack.duration > 10000 ? currentTrack.duration / 1000 : currentTrack.duration) : 0);
                if (dur > 0) {
                    player.seekTo(dur * percent, true);
                    updateLyricsSync(dur * percent);
                }
            } else {
                const audio = document.getElementById('nativeAudio');
                if (audio && audio.duration) {
                    audio.currentTime = audio.duration * percent;
                    updateLyricsSync(audio.currentTime);
                }
            }
        });
    }

    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            volume = parseInt(e.target.value);
            const audio = document.getElementById('nativeAudio');
            if (audio) audio.volume = volume / 100;
            const volumeBarFill = document.getElementById('volumeBarFill');
            if (volumeBarFill) volumeBarFill.style.width = volume + '%';
            saveToStorage('volume', volume);
        });
    }

    const volumeTrack = document.getElementById('volumeTrack');
    if (volumeTrack) {
        volumeTrack.addEventListener('click', (e) => {
            const rect = volumeTrack.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            volume = Math.round(percent * 100);
            const audio = document.getElementById('nativeAudio');
            if (audio) audio.volume = volume / 100;
            const volumeBarFill = document.getElementById('volumeBarFill');
            if (volumeBarFill) volumeBarFill.style.width = volume + '%';
            saveToStorage('volume', volume);
        });
    }
    const createPlaylistBtn = document.querySelector('.create-playlist-btn');
    if (createPlaylistBtn) createPlaylistBtn.addEventListener('click', showCreatePlaylistModal);
    const savePlBtn = document.getElementById('savePlaylistBtn');
    if (savePlBtn) {
        savePlBtn.addEventListener('click', () => {
            const artPreview = document.getElementById('createPlaylistArtPreview');
            const coverUrl = (artPreview && artPreview.style.display === 'block') ? artPreview.src : '';
            createPlaylist(document.getElementById('playlistNameInput').value.trim(), document.getElementById('playlistDescInput').value.trim(), coverUrl, document.getElementById('createPlaylistColor').value);
            hideCreatePlaylistModal();
        });
    }

    const editPlBtn = document.getElementById('confirmEditPlaylistBtn');
    if (editPlBtn) editPlBtn.addEventListener('click', confirmEditPlaylist);

    const fsProgressTrack = document.getElementById('fsProgressTrack');
    if (fsProgressTrack) {
        fsProgressTrack.addEventListener('click', (e) => {
            const rect = fsProgressTrack.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (activeSource === 'youtube' && player && typeof player.seekTo === 'function') {
                const dur = (typeof player.getDuration === 'function' && player.getDuration() > 0)
                    ? player.getDuration()
                    : (currentTrack && currentTrack.duration ? (currentTrack.duration > 10000 ? currentTrack.duration / 1000 : currentTrack.duration) : 0);
                if (dur > 0) {
                    player.seekTo(dur * percent, true);
                    updateLyricsSync(dur * percent);
                }
            } else {
                const audio = document.getElementById('nativeAudio');
                if (audio && audio.duration) {
                    audio.currentTime = audio.duration * percent;
                    updateLyricsSync(audio.currentTime);
                }
            }
        });
    }
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            const fs = document.getElementById('fsPlayer');
            if (fs && fs.classList.contains('active')) {
                fs.classList.remove('active');
                document.body.style.overflow = '';
            }
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            const active = document.activeElement;
            const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
            if (!isInput) {
                e.preventDefault();
                togglePlayPause();
            }
        }
    });
}
window.toggleFullscreenPlayer = function() {
    const fs = document.getElementById('fsPlayer');
    if (!fs) return;
    
    if (!fs.classList.contains('active')) {
        if (!currentTrack) {
            showToast('No track playing', 'info');
            return;
        }
        fs.classList.add('active');
        document.body.style.overflow = 'hidden';
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
        updateFullscreenUI();
        const fsLyrics = document.querySelector('.fs-lyrics-container');
        if (fsLyrics) fsLyrics._lastActiveIndex = -1;
        setTimeout(adjustLyricsFontSize, 600); 
    } else {
        fs.classList.remove('active');
        document.body.style.overflow = '';
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
};
function closeFullscreenIfNoTrack() {
    const fs = document.getElementById('fsPlayer');
    if (fs && fs.classList.contains('active')) {
        window.toggleFullscreenPlayer();
    }
}
function updateFullscreenUI() {
    if (!currentTrack) return;
    document.getElementById('fsTrackName').textContent = currentTrack.title;
    const artistEl = document.getElementById('fsArtistName');
    artistEl.textContent = currentTrack.artist_name;
    artistEl.classList.add('hover:underline', 'cursor-pointer');
    artistEl.onclick = () => {
        window.toggleFullscreenPlayer();
        loadArtistView(currentTrack.artist_name);
    };
    
    const artworkUrl = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url, '500x500');
    document.getElementById('fsArtwork').src = artworkUrl;
    
    const bgUrl = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url, '50x50');
    const bg = document.getElementById('fsBackground');
    if (bg) {
        bg.style.backgroundImage = `url('${bgUrl}')`;
        bg.style.backgroundSize = 'cover';
        bg.style.backgroundPosition = 'center';
    }

    const fsMain = document.querySelector('.fs-main');
    if (fsMain) {
        if (!parsedLyrics || parsedLyrics.length === 0) {
            fsMain.classList.add('no-lyrics');
        } else {
            fsMain.classList.remove('no-lyrics');
        }
    }
    
    updateFullscreenTint(artworkUrl);
    document.getElementById('fsShuffle').classList.toggle('active', isShuffle);
    updateRepeatUI();
    const fsPlayBtn = document.getElementById('fsPlayPause');
    if (fsPlayBtn) fsPlayBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:4px;"></i>';
}
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
    }
    return [Math.round(h), s, l];
}
function updateFullscreenTint(imageUrl) {
    const fs = document.getElementById('fsPlayer');
    if (!fs || !imageUrl) return;
    const applyColors = (r, g, b, vibR, vibG, vibB) => {
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const isBright = lum > 0.45;
        if (isBright) {
            fs.classList.add('bright-bg');
        } else {
            fs.classList.remove('bright-bg');
        }

        const [h, s] = rgbToHsl(vibR, vibG, vibB);
        const isHighlySaturated = s > 0.35;

        let iconColor, iconHoverColor, progressBg, progressFg, metaTitleColor, metaArtistColor;
        let lyricInactive, lyricActive, dotInactive, dotActive, lyricGlow;

        if (isBright) {
            if (isHighlySaturated) {
                const tintSat = Math.round(Math.min(90, Math.max(40, s * 80)));
                iconColor = `hsla(${h}, ${tintSat}%, 15%, 0.85)`;
                iconHoverColor = `hsl(${h}, ${tintSat}%, 8%)`;
                progressBg = `hsla(${h}, ${tintSat}%, 20%, 0.18)`;
                progressFg = `hsl(${h}, ${tintSat}%, 14%)`;
                metaTitleColor = `hsl(${h}, ${tintSat}%, 10%)`;
                metaArtistColor = `hsla(${h}, ${tintSat}%, 18%, 0.75)`;
                lyricInactive = `hsla(${h}, ${tintSat}%, 22%, 0.45)`;
                lyricActive = `hsl(${h}, ${tintSat}%, 10%)`;
                dotInactive = `hsla(${h}, ${tintSat}%, 25%, 0.25)`;
                dotActive = `hsl(${h}, ${tintSat}%, 10%)`;
                lyricGlow = 'none';
            } else {
                iconColor = 'rgba(0, 0, 0, 0.85)';
                iconHoverColor = '#000000';
                progressBg = 'rgba(0, 0, 0, 0.16)';
                progressFg = 'rgba(0, 0, 0, 0.9)';
                metaTitleColor = '#000000';
                metaArtistColor = 'rgba(0, 0, 0, 0.7)';
                lyricInactive = 'rgba(0, 0, 0, 0.45)';
                lyricActive = '#000000';
                dotInactive = 'rgba(0, 0, 0, 0.25)';
                dotActive = '#000000';
                lyricGlow = 'none';
            }
        } else {
            if (isHighlySaturated) {
                const tintSat = Math.round(Math.min(95, Math.max(50, s * 85)));
                iconColor = `hsla(${h}, ${tintSat}%, 90%, 0.85)`;
                iconHoverColor = `hsl(${h}, 95%, 98%)`;
                progressBg = `hsla(${h}, ${tintSat}%, 60%, 0.24)`;
                progressFg = `hsl(${h}, ${tintSat}%, 82%)`;
                metaTitleColor = `hsl(${h}, 40%, 98%)`;
                metaArtistColor = `hsla(${h}, ${tintSat}%, 86%, 0.8)`;
                lyricInactive = `hsla(${h}, ${tintSat}%, 80%, 0.42)`;
                lyricActive = `hsl(${h}, ${tintSat}%, 92%)`;
                dotInactive = `hsla(${h}, ${tintSat}%, 75%, 0.3)`;
                dotActive = `hsl(${h}, ${tintSat}%, 88%)`;
                lyricGlow = `0 2px 24px hsla(${h}, 90%, 65%, 0.4)`;
            } else {
                iconColor = 'rgba(255, 255, 255, 0.85)';
                iconHoverColor = '#ffffff';
                progressBg = 'rgba(255, 255, 255, 0.22)';
                progressFg = '#ffffff';
                metaTitleColor = '#ffffff';
                metaArtistColor = 'rgba(255, 255, 255, 0.75)';
                lyricInactive = 'rgba(255, 255, 255, 0.45)';
                lyricActive = '#ffffff';
                dotInactive = 'rgba(255, 255, 255, 0.25)';
                dotActive = '#ffffff';
                lyricGlow = '0 2px 20px rgba(0, 0, 0, 0.4)';
            }
        }
        fs.style.setProperty('--fs-icon-color', iconColor);
        fs.style.setProperty('--fs-icon-hover', iconHoverColor);
        fs.style.setProperty('--fs-progress-bg', progressBg);
        fs.style.setProperty('--fs-progress-fg', progressFg);
        fs.style.setProperty('--fs-meta-title', metaTitleColor);
        fs.style.setProperty('--fs-meta-artist', metaArtistColor);
        fs.style.setProperty('--fs-lyric-inactive', lyricInactive);
        fs.style.setProperty('--fs-lyric-active', lyricActive);
        fs.style.setProperty('--fs-dot-inactive', dotInactive);
        fs.style.setProperty('--fs-dot-active', dotActive);
        fs.style.setProperty('--fs-lyric-glow', lyricGlow);
        fs.style.setProperty('--bg-base', `rgb(${r}, ${g}, ${b})`);
    };

    let targetUrl = imageUrl;
    if (typeof targetUrl === 'string' && !targetUrl.startsWith('data:') && !targetUrl.startsWith('/api/proxy') && !targetUrl.startsWith('/p/')) {
        targetUrl = getProxyUrl(targetUrl);
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = targetUrl;
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50; canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0, count = 0;
            let bestScore = -1, vibR = 20, vibG = 20, vibB = 20;
            for (let i = 0; i < data.length; i += 4) {
                const pr = data[i], pg = data[i+1], pb = data[i+2];
                r += pr; g += pg; b += pb; count++;

                const max = Math.max(pr, pg, pb);
                const min = Math.min(pr, pg, pb);
                const delta = max - min;
                const lum = (max + min) / 510;
                if (lum > 0.12 && lum < 0.88) {
                    const score = delta * (1 - Math.abs(lum - 0.5));
                    if (score > bestScore) {
                        bestScore = score;
                        vibR = pr; vibG = pg; vibB = pb;
                    }
                }
            }
            if (count > 0) {
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                if (bestScore < 15) {
                    vibR = r; vibG = g; vibB = b;
                }
                applyColors(r, g, b, vibR, vibG, vibB);
            }
        } catch (e) {
            applyColors(20, 20, 20, 20, 20, 20);
        }
    };
    img.onerror = () => {
        applyColors(20, 20, 20, 20, 20, 20);
    };
}
function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
    
    const targetView = document.getElementById(viewName + 'View') || document.getElementById(viewName);
    if (targetView) {
        targetView.classList.add('active');
        document.querySelector('.main-view')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (navItem) navItem.classList.add('active');

    const mobileNavItem = document.querySelector(`.mobile-nav-item[data-view="${viewName}"]`);
    if (mobileNavItem) mobileNavItem.classList.add('active');
    
    if (viewName === 'favorites') renderFavorites();
    if (viewName === 'library') renderLibrary();
    if (viewName === 'settings' || viewName === 'equalizer') {
        applySettings();
        renderEqSliders();
    }
}
function isExactArtistMatch(track, targetArtist) {
    if (!track || !targetArtist) return false;
    const target = targetArtist.trim().toLowerCase();
    const rawArtist = (track.artist_name || track.artist || track.subtitle || '').trim().toLowerCase();
    if (!rawArtist) return false;
    if (rawArtist === target) return true;
    
    const splitArtists = rawArtist
        .split(/[,&]|(?:\sfeat\.?\s)|(?:\sft\.?\s)|(?:\swith\s)|(?:\sx\s)/i)
        .map(a => a.trim().toLowerCase())
        .filter(Boolean);
        
    return splitArtists.includes(target);
}
let artistSearchState = { name: '', offset: 0, loading: false, hasMore: true, limit: 50 };
async function loadArtistView(artistName, append = false) {
    if (!artistName) return;
    if (!append) {
        switchView('dynamic');
        artistSearchState = { name: artistName, offset: 0, loading: false, hasMore: true, limit: 50 };
        const container = document.getElementById('dynamicView');

        if (typeof window.updateTopBanner === 'function') {
            window.updateTopBanner('artist', { artistName, artwork: null });
            container.innerHTML = `
                <div style="padding: 4px 0 12px;">
                    <div class="track-header">
                        <div class="track-num-col">#</div>
                        <div>TITLE</div>
                        <div>ALBUM</div>
                        <div style="text-align:right;"><i class="fa-regular fa-heart"></i></div>
                        <div style="text-align:right;"><i class="fa-regular fa-clock"></i></div>
                    </div>
                    <div class="track-grid" id="dynamicList"></div>
                </div>
                <div id="artistLoader" style="display: none; text-align: center; padding: 20px 0;">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--gc-text-sub);"></i>
                </div>
            `;
        } else {
            container.innerHTML = `
                <header class="hero-header" style="background: linear-gradient(to bottom, rgba(80,80,80,1) 0%, var(--bg-elevated) 100%);">
                    <div class="artist-img">
                        <i class="fa-solid fa-user"></i>
                    </div>
                    <div class="hero-meta">
                        <h1 class="artist-header">${escapeHtml(artistName)}</h1>
                        <div class="monthly-listeners" id="artistTrackCount">Loading tracks across services...</div>
                    </div>
                </header>
                <div class="action-bar">
                    <button class="btn-play-large" onclick="playAllFromDynamic()"><i class="fa-solid fa-play" style="margin-left: 4px;"></i></button>
                </div>
                <div class="track-section">
                    <div class="track-grid" id="dynamicList"></div>
                </div>
                <div id="artistLoader" style="display: none; text-align: center; padding: 20px 0;">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--text-main);"></i>
                </div>
            `;
        }
    }
    if (artistSearchState.loading || !artistSearchState.hasMore) return;
    artistSearchState.loading = true;
    const loader = document.getElementById('artistLoader');
    if (loader) loader.style.display = 'block';
    try {
        let artistTracks = [];
        let artwork = null;

        try {
            const res = await fetch(`${API_BASE_URL}?endpoint=artist&name=${encodeURIComponent(artistName)}`);
            if (res.ok) {
                const artistData = await res.json();
                if (artistData && Array.isArray(artistData.tracks) && artistData.tracks.length > 0) {
                    artistTracks = artistData.tracks.filter(t => isExactArtistMatch(t, artistName));
                    artwork = artistData.artwork_url;
                }
            }
        } catch (err) {}

        if (artistTracks.length === 0) {
            const response = await fetch(`${API_BASE_URL}?endpoint=search&q=${encodeURIComponent(artistName)}&limit=${artistSearchState.limit}&offset=${artistSearchState.offset}`);
            const data = await response.json();
            const rawTracks = (data.tracks || []).filter(t => (t.artist_name || t.artist || '').trim() !== 'YT Music Artist');
            artistTracks = rawTracks.filter(t => isExactArtistMatch(t, artistName));
        }

        const seenUids = new Set();
        if (append) {
            currentDynamicPlaylist.forEach(t => {
                seenUids.add(getTrackUid(t));
                seenUids.add(`${t.title.toLowerCase()}|${(t.artist_name || '').toLowerCase()}`);
            });
        }
        artistTracks = artistTracks.filter(t => {
            const uid = getTrackUid(t);
            const titleArtist = `${t.title.toLowerCase()}|${(t.artist_name || '').toLowerCase()}`;
            if (seenUids.has(uid) || seenUids.has(titleArtist)) return false;
            seenUids.add(uid);
            seenUids.add(titleArtist);
            return true;
        });

        artistSearchState.hasMore = false;
        if (!artwork && artistTracks.length > 0) {
            artwork = artistTracks[0].local_artwork || getProxyUrl(artistTracks[0].artwork_url);
        }
        if (!append) {
            if (typeof window.updateTopBanner === 'function' && artwork) {
                window.updateTopBanner('artist', { artistName: artistSearchState.name, artwork });
            } else {
                const header = document.querySelector('#dynamicView .hero-header');
                if (header && artwork) {
                    header.style.background = `linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, var(--bg-elevated) 100%), url('${artwork}')`;
                    header.style.backgroundSize = 'cover';
                    header.style.backgroundPosition = 'center';
                    const imgContainer = header.querySelector('.artist-img');
                    if (imgContainer) {
                        imgContainer.innerHTML = `<img src="${artwork}">`;
                    }
                }
            }
            currentDynamicPlaylist = [];
        }
        const list = document.getElementById('dynamicList');
        const startIdx = currentDynamicPlaylist.length;
        currentDynamicPlaylist.push(...artistTracks);
        if (artistTracks.length === 0 && !append) {
            list.innerHTML = '<div style="padding: 40px 0; text-align: center; opacity: 0.5;">No tracks found for this artist.</div>';
        } else {
            artistTracks.forEach((track, index) => {
                list.appendChild(createTrackRow(track, startIdx + index, currentDynamicPlaylist, true));
            });
            observeImages(list);
            silentPreloadDurations(artistTracks);
        }

        const countText = `${currentDynamicPlaylist.length} tracks found across sources`;
        const bannerCount = document.getElementById('bannerArtistTrackCount');
        if (bannerCount) bannerCount.textContent = countText;
        const countEl = document.getElementById('artistTrackCount');
        if (countEl) countEl.textContent = countText;
        artistSearchState.offset += artistSearchState.limit;
        artistSearchState.loading = false;
        if (loader) loader.style.display = 'none';
    } catch (e) {
        console.error("Error loading artist view:", e);
        artistSearchState.loading = false;
        if (loader) loader.style.display = 'none';
        if (!append) {
            document.getElementById('dynamicView').innerHTML = `<div style="padding: 40px 0; text-align: center; color: #ef4444;">Failed to load artist data.</div>`;
        }
    }
}
function setGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour >= 5 && hour < 12) greeting = 'Good morning';
    else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    const el = document.getElementById('greetingText');
    if (el) el.textContent = greeting;
}
async function loadPopularTracks() {
    const grid = document.getElementById('popularTracks');
    if (!grid) return null;
    
    const targetTracks = [
        { title: "FE!N", artist: "Travis Scott" },
        { title: "Not Like Us", artist: "Kendrick Lamar" },
        { title: "Timeless", artist: "The Weeknd & Playboi Carti" },
        { title: "goosebumps", artist: "Travis Scott" },
        { title: "Blinding Lights", artist: "The Weeknd" },
        { title: "God's Plan", artist: "Drake" },
        { title: "Snooze", artist: "SZA" },
        { title: "Circles", artist: "Post Malone" },
        { title: "BIRDS OF A FEATHER", artist: "Billie Eilish" },
        { title: "Espresso", artist: "Sabrina Carpenter" },
        { title: "MILLION DOLLAR BABY", artist: "Tommy Richman" },
        { title: "Back In Black", artist: "AC/DC" },
        { title: "Cruel Summer", artist: "Taylor Swift" },
        { title: "Bohemian Rhapsody", artist: "Queen" }
    ];

    grid.innerHTML = Array(14).fill(`
        <div class="track-card" style="opacity: 0.5; pointer-events: none;">
            <div class="card-thumb" style="background: #333; animation: pulse 1.5s infinite;"></div>
            <div style="height: 16px; background: #333; margin-bottom: 4px; border-radius: 4px; animation: pulse 1.5s infinite;"></div>
            <div style="height: 12px; background: #222; width: 60%; border-radius: 4px; animation: pulse 1.5s infinite;"></div>
        </div>
    `).join('');

    try {
        const popularTracks = (await Promise.all(targetTracks.map(async (track) => {
            const query = `${track.title} ${track.artist}`;
            const res = await fetch(`${API_BASE_URL}?endpoint=search&q=${encodeURIComponent(query)}&limit=5`).catch(() => null);
            
            if (res && res.ok) {
                const data = await res.json();
                if (data.tracks && data.tracks.length > 0) {
                    const exactMatch = data.tracks.find(t => 
                        (t.title || '').toLowerCase().includes(track.title.toLowerCase()) && 
                        (t.artist_name || t.artist || '').toLowerCase().includes(track.artist.toLowerCase())
                    );
                    
                    return exactMatch || data.tracks[0];
                }
            }
            return null;
        }))).filter(Boolean);

        grid.innerHTML = '';
        if (popularTracks.length > 0) {
            renderTrackGrid(popularTracks, grid);
            observeImages(grid);
        } else {
            grid.innerHTML = '<div class="col-span-full py-10 text-center text-gray-500">Failed to load tracks.</div>';
        }
        return popularTracks;
    } catch (e) {
        grid.innerHTML = '<div class="col-span-full py-10 text-center text-red-500">Error loading popular tracks.</div>';
        return [];
    }
}
let searchState = { query: '', tracksOffset: 0, loading: false, hasMoreTracks: true, limit: 25 };
let searchMode = 'songs';

window.setSearchMode = function(mode) {
    searchMode = mode;
    const songsBtn = document.getElementById('searchModeSongs');
    const artistsBtn = document.getElementById('searchModeArtists');
    
    if (songsBtn) {
        songsBtn.classList.toggle('active', mode === 'songs');
        songsBtn.style.background = mode === 'songs' ? 'var(--text-main)' : 'var(--bg-highlight)';
        songsBtn.style.color = mode === 'songs' ? 'var(--bg-base)' : 'var(--text-main)';
    }
    
    if (artistsBtn) {
        artistsBtn.classList.toggle('active', mode === 'artists');
        artistsBtn.style.background = mode === 'artists' ? 'var(--text-main)' : 'var(--bg-highlight)';
        artistsBtn.style.color = mode === 'artists' ? 'var(--bg-base)' : 'var(--text-main)';
    }

    if (searchState.query) handleSearch(searchState.query);
};

let activeSourceFilter = 'all';

function getSourceBadge(source) {
    if (!source || source === 'YTMusic') {
        return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(225,29,72,0.15);color:#fb7185;border:1px solid rgba(225,29,72,0.3);"><i class="fa-brands fa-youtube"></i> YT Music</span>`;
    }
    if (source === 'Argon') {
        return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(234,88,12,0.15);color:#fb923c;border:1px solid rgba(234,88,12,0.3);"><i class="fa-brands fa-soundcloud"></i> SoundCloud</span>`;
    }
    if (source === 'Audius') {
        return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(124,58,237,0.15);color:#c084fc;border:1px solid rgba(124,58,237,0.3);"><i class="fa-solid fa-compact-disc"></i> Audius</span>`;
    }
    return '';
}

function hasValidCover(track) {
    if (!track) return false;
    const url = track.artwork_url || track.image || track.thumbnail || track.cover;
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    return Boolean(trimmed && trimmed !== 'null' && trimmed !== 'undefined' && !trimmed.includes('placeholder'));
}

function hasValidArtist(track) {
    if (!track) return false;
    const artist = (track.artist_name || track.artist || track.author || '').trim();
    if (!artist) return false;
    const lower = artist.toLowerCase();
    return lower !== 'unknown artist' && lower !== 'unknown' && lower !== 'yt music artist' && lower !== '[object object]';
}

function getTrackQualityScore(track) {
    const cover = hasValidCover(track);
    const artist = hasValidArtist(track);
    if (cover && artist) return 0;
    if (cover || artist) return 1;
    return 2;
}

function sortTracksByQuality(trackList) {
    if (!Array.isArray(trackList)) return [];
    return [...trackList].sort((a, b) => getTrackQualityScore(a) - getTrackQualityScore(b));
}

function setSourceFilter(filter) {
    activeSourceFilter = filter;
    const filterButtons = {
        'all': 'sourceFilterAll',
        'YTMusic': 'sourceFilterYT',
        'Argon': 'sourceFilterSoundcloud',
        'Audius': 'sourceFilterAudius'
    };
    Object.entries(filterButtons).forEach(([key, id]) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.toggle('active', key === filter);
            btn.style.background = key === filter ? 'var(--text-main)' : 'var(--bg-highlight)';
            btn.style.color = key === filter ? 'var(--bg-base)' : 'var(--text-main)';
        }
    });

    const tracksGrid = document.getElementById('searchGrid');
    if (!tracksGrid) return;
    tracksGrid.innerHTML = '';
    
    const filtered = sortTracksByQuality((activeSourceFilter === 'all')
        ? currentSearchResults
        : currentSearchResults.filter(t => (t.source || 'YTMusic') === activeSourceFilter));

    if (filtered.length > 0) {
        renderTrackGrid(filtered, tracksGrid, filtered);
        observeImages(tracksGrid);
    } else {
        tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No tracks found for this source.</div>';
    }
}

async function handleSearch(query, append = false, forcedOffset = null) {
    const resultsDiv = document.getElementById('searchResults');
    const categoriesDiv = document.getElementById('browseCategories');
    const tracksGrid = document.getElementById('searchGrid');
    const loader = document.getElementById('searchLoader');
    const pagination = document.getElementById('searchPagination');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (!query || query.trim() === '') {
        if (resultsDiv) resultsDiv.classList.add('hidden');
        if (categoriesDiv) categoriesDiv.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        if (pagination) {
            pagination.classList.add('hidden');
            pagination.style.display = 'none';
        }
        searchState.query = '';
        return;
    }
    if (!append || query !== searchState.query) {
        const startAt = (forcedOffset !== null) ? forcedOffset : 0;
        searchState = { query: query, tracksOffset: startAt, loading: false, hasMoreTracks: true, limit: 25 };
        currentSearchResults = [];
        if (tracksGrid) tracksGrid.innerHTML = '';
        if (loader) loader.classList.add('hidden');
    }
    if (searchState.loading || !searchState.hasMoreTracks) return;
    searchState.loading = true;
    if (append && loader) loader.classList.remove('hidden');
    if (resultsDiv) resultsDiv.classList.remove('hidden');
    if (categoriesDiv) categoriesDiv.classList.add('hidden');
    if (!append && tracksGrid) {
        tracksGrid.innerHTML = '<div class="col-span-full py-20 flex justify-center"><i class="fas fa-circle-notch fa-spin text-3xl text-accent-indigo"></i></div>';
    }
    try {
        const cacheKey = `${query}_${searchState.tracksOffset}_${searchState.limit}_${searchMode}`;
        let data;
        if (searchCache.has(cacheKey)) {
            data = searchCache.get(cacheKey);
        } else {
            const response = await fetch(`${API_BASE_URL}?endpoint=search&q=${encodeURIComponent(query)}&offset=${searchState.tracksOffset}&limit=${searchState.limit}`);
            data = await response.json();
            searchCache.set(cacheKey, data);
        }
        
        if (searchMode === 'artists') {
            const artists = data.artists || [];
            if (!append && tracksGrid) tracksGrid.innerHTML = '';
            if (artists.length > 0) {
                renderArtistGrid(artists, tracksGrid);
            } else if (!append) {
                tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No artists found for this query.</div>';
            }
            searchState.hasMoreTracks = false; 
        } else {
            const newTracks = (data.tracks || []).filter(t => (t.artist_name || t.artist || '').trim() !== 'YT Music Artist');
            currentSearchResults.push(...newTracks);
            if (!append && tracksGrid) tracksGrid.innerHTML = '';
            
            const displayTracks = sortTracksByQuality((activeSourceFilter === 'all')
                ? currentSearchResults
                : currentSearchResults.filter(t => (t.source || 'YTMusic') === activeSourceFilter));

            if (tracksGrid && displayTracks.length > 0) {
                const filteredTracks = displayTracks.filter(track => {
                    const trackUid = getTrackUid(track);
                    return !Array.from(tracksGrid.querySelectorAll('.track-card')).some(card => card.dataset.uid === trackUid);
                });
                renderTrackGrid(filteredTracks, tracksGrid, displayTracks);
                observeImages(tracksGrid);
            } else if (!append && tracksGrid) {
                tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No tracks found for this query.</div>';
            }
            searchState.tracksOffset += newTracks.length;
            searchState.hasMoreTracks = newTracks.length === searchState.limit && newTracks.length > 0;
        }

        if (pagination) {
            if (searchMode === 'songs' && (searchState.tracksOffset > 0 || (data.tracks && data.tracks.length > 0))) {
                pagination.classList.remove('hidden');
                pagination.style.display = 'flex';
                const currentPage = Math.ceil(searchState.tracksOffset / searchState.limit) || 1;
                const pageIndicator = document.getElementById('pageIndicator');
                if (pageIndicator) pageIndicator.textContent = `Page ${currentPage}`;
                if (prevBtn) {
                    if (searchState.tracksOffset <= searchState.limit) prevBtn.style.visibility = 'hidden';
                    else prevBtn.style.visibility = 'visible';
                }
                if (nextBtn) {
                    if (!searchState.hasMoreTracks) nextBtn.style.visibility = 'hidden';
                    else nextBtn.style.visibility = 'visible';
                }
            } else {
                pagination.classList.add('hidden');
                pagination.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Search failed', e);
        if (!append && tracksGrid) tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-red-500">Failed to load search results.</div>';
    } finally {
        searchState.loading = false;
        if (loader) loader.classList.add('hidden');
    }
}

function renderArtistGrid(artists, container) {
    artists.forEach(artist => {
        const card = document.createElement('div');
        card.className = 'track-card';
        const artworkUrl = getProxyUrl(artist.artwork_url);
        card.innerHTML = `
            <div style="position: relative; overflow: hidden; margin-bottom: 16px; border-radius: 50%;">
                <img data-src="${artworkUrl}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="card-thumb" style="aspect-ratio: 1/1; object-fit: cover;">
            </div>
            <div class="card-title text-center">${escapeHtml(artist.name)}</div>
            <div class="card-subtitle text-center">Artist</div>
        `;
        card.onclick = () => loadArtistView(artist.name);
        container.appendChild(card);
    });
    observeImages(container);
}
async function searchNextPage() {
    if (searchState.loading || !searchState.hasMoreTracks) return;
    handleSearch(searchState.query, false, searchState.tracksOffset);
    document.querySelector('.main-view')?.scrollTo({ top: 0, behavior: 'smooth' });
}
async function searchPrevPage() {
    if (searchState.loading || searchState.tracksOffset <= searchState.limit) return;
    const target = searchState.tracksOffset - (searchState.limit * 2);
    handleSearch(searchState.query, false, Math.max(0, target));
    document.querySelector('.main-view')?.scrollTo({ top: 0, behavior: 'smooth' });
}
function formatArtistLinks(artistString) {
    if (!artistString) return '';
    if (typeof artistString !== 'string') return escapeHtml(String(artistString));
    
    const parts = artistString.split(/([,&]|(?:\sfeat\.?\s)|(?:\sft\.?\s)|(?:\swith\s)|(?:\sx\s))/i);
    const result = [];
    
    parts.forEach((part) => {
        const trimmed = part.trim();
        if (!trimmed) return;
        if (/^([,&]|feat\.?|ft\.?|with|x)$/i.test(trimmed)) {
            result.push(escapeHtml(part));
        } else {
            const safeArtist = escapeHtml(trimmed).replace(/'/g, "\\'");
            result.push(`<span class="artist-link hover:underline cursor-pointer" data-artist="${escapeHtml(trimmed)}" onclick="event.stopPropagation(); loadArtistView('${safeArtist}');">${escapeHtml(trimmed)}</span>`);
        }
    });
    
    return result.join('');
}

function renderTrackGrid(tracks, container, parentList = null) {
    if (!container) return;
    const isSearchView = container.id === 'searchGrid';
    const isHomeView = container.id === 'popularTracks';
    
    tracks.forEach((track) => {
        const artist = (track.artist_name || track.artist || '').trim();
        if (artist === 'YT Music Artist') return;

        const trackUid = getTrackUid(track);
        const card = document.createElement('div');
        card.className = 'track-card';
        card.dataset.uid = trackUid;
        const artworkUrl = track.local_artwork || getProxyUrl(track.artwork_url);
        
        const imgHtml = isHomeView 
            ? `<img src="${artworkUrl}" class="card-thumb" style="margin-bottom: 0;">`
            : `<img data-src="${artworkUrl}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="card-thumb" loading="lazy" style="margin-bottom: 0;">`;

        card.innerHTML = `
            <div style="position: relative; overflow: hidden; margin-bottom: 16px;">
                ${imgHtml}
                <div style="position: absolute; bottom: 8px; left: 8px; z-index: 2;">
                    ${getSourceBadge(track.source)}
                </div>
                ${(isSearchView || isHomeView) ? '' : `
                <button class="card-plus-btn" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); border: none; border-radius: 50% !important; width: 30px; height: 30px; color: #fff; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; cursor: pointer;" title="Add to Playlist">
                    <i class="fa-solid fa-plus" style="font-size: 14px;"></i>
                </button>
                `}
            </div>
            <div class="card-title">${escapeHtml(track.title)}</div>
            <div class="card-subtitle">${formatArtistLinks(track.artist_name || track.artist)}</div>
        `;
        
        const plusBtn = card.querySelector('.card-plus-btn');
        if (plusBtn) {
            plusBtn.onclick = (e) => { e.stopPropagation(); showAddToPlaylistModal(track); };
            card.onmouseenter = () => { plusBtn.style.opacity = '1'; };
            card.onmouseleave = () => { plusBtn.style.opacity = '0'; };
        }

        const subtitleEl = card.querySelector('.card-subtitle');
        if (subtitleEl) {
            subtitleEl.onclick = (e) => {
                const link = e.target.closest('.artist-link');
                const artName = link ? (link.getAttribute('data-artist') || link.textContent.trim()) : (track.artist_name || track.artist || '').trim();
                if (artName) {
                    e.stopPropagation();
                    e.preventDefault();
                    loadArtistView(artName);
                }
            };
        }

        card.addEventListener('click', (e) => {
            if (e.target.closest('.artist-link') || e.target.closest('.card-plus-btn') || e.target.closest('.card-subtitle')) {
                return;
            }
            if (container.id === 'searchGrid') {
                playlist = [...currentSearchResults];
                originalPlaylist = [...currentSearchResults];
            } else if (parentList) {
                playlist = parentList;
                originalPlaylist = [...parentList];
            } else {
                playlist = tracks;
                originalPlaylist = [...tracks];
            }
            
            const freshIndex = playlist.findIndex(t => getTrackUid(t) === trackUid);
            if (freshIndex > -1) {
                currentIndex = freshIndex;
                playTrack(currentIndex);
            }
        });
        container.appendChild(card);
    });
    observeImages(container);
}

function renderBrowseCategories() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;
    
    const categories = [
        { title: 'Pop', color: '#E13300', icon: 'fa-music' },
        { title: 'Hip-Hop', color: '#1E3264', icon: 'fa-microphone' },
        { title: 'Rock', color: '#E91429', icon: 'fa-guitar' },
        { title: 'Latin', color: '#E1118C', icon: 'fa-fire' },
        { title: 'Dance/Electronic', color: '#D84000', icon: 'fa-bolt' },
        { title: 'R&B', color: '#DC148C', icon: 'fa-heart' },
        { title: 'Indie', color: '#608108', icon: 'fa-leaf' },
        { title: 'Country', color: '#D84000', icon: 'fa-hat-cowboy' }
    ];
    
    grid.innerHTML = '';
    categories.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.style.backgroundColor = cat.color;
        card.innerHTML = `
            <span class="category-title">${cat.title}</span>
            <i class="fa-solid ${cat.icon} category-icon"></i>
        `;
        card.onclick = () => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = cat.title;
                handleSearch(cat.title);
            }
        };
        grid.appendChild(card);
    });
}
function renderPlaylistGrid(playlistsData, container) {
    if (!container) return;
    container.innerHTML = '';
    playlistsData.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'track-card relative aspect-square p-0 overflow-hidden group';
        card.innerHTML = `
            <img src="${getProxyUrl(pl.artwork_url)}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy">
            <div class="absolute inset-x-0 bottom-0 h-1/3 bg-black/20 backdrop-blur-md border-t border-white/10 flex flex-col justify-center px-4 transition-transform duration-300 translate-y-2 group-hover:translate-y-0">
                <div class="font-bold text-sm truncate text-white mb-0.5">${escapeHtml(pl.name)}</div>
                <div class="text-[10px] text-gray-300 truncate uppercase tracking-wider font-medium">${pl.song_count} songs</div>
            </div>
        `;
        card.addEventListener('click', () => loadOfficialPlaylistDetails(pl.id));
        container.appendChild(card);
    });
}
async function loadOfficialPlaylistDetails(playlistId) {
    switchView('dynamic');
    const container = document.getElementById('dynamicView');
    container.innerHTML = '<div class="py-20 flex justify-center"><i class="fa-solid fa-circle-notch fa-spin text-3xl"></i></div>';
    try {
        const response = await fetch(`${API_BASE_URL}?endpoint=playlist&id=${encodeURIComponent(playlistId)}`);
        const data = await response.json();
        container.innerHTML = `
            <header class="hero-header" style="background: linear-gradient(to bottom, #4f46e5 0%, var(--bg-elevated) 100%);">
                <div class="artist-img" style="border-radius: 0% !important;">
                    <img src="${getProxyUrl(data.artwork_url)}">
                </div>
                <div class="hero-meta">
                    <h1 class="artist-header">${escapeHtml(data.name)}</h1>
                    <div class="monthly-listeners">${escapeHtml(data.description || 'Official Playlist')}</div>
                    <div class="monthly-listeners" style="margin-top: 4px; font-weight: bold;">${data.song_count} songs</div>
                </div>
            </header>
            <div class="action-bar">
                <button class="btn-play-large" onclick="playAllFromDynamic()"><i class="fa-solid fa-play" style="margin-left: 4px;"></i></button>
            </div>
            <div class="track-section">
                <div class="track-grid" id="dynamicList"></div>
            </div>
        `;
        const list = document.getElementById('dynamicList');
        data.tracks.forEach((track, index) => list.appendChild(createTrackRow(track, index, data.tracks, true)));
        currentDynamicPlaylist = data.tracks;
    } catch (e) { console.error('Failed to load playlist details', e); }
}
function renderFavorites() {
    const list = document.getElementById('favoritesList');
    const count = document.getElementById('likedSongsCount');
    if (count) count.textContent = `${favorites.length} songs`;
    if (favorites.length === 0) {
        list.innerHTML = '<div style="padding: 40px 0; text-align: center; opacity: 0.5;">Your liked songs will appear here.</div>';
        return;
    }
    list.innerHTML = '';
    favorites.forEach((track, index) => list.appendChild(createTrackRow(track, index, favorites, true, 'favorites')));
    observeImages(list);
}
function createTrackRow(track, index, trackList, hideEllipsis = false, playlistId = null) {
    const div = document.createElement('div');
    const trackUid = getTrackUid(track);
    const isCurrentlyPlaying = currentTrack && getTrackUid(currentTrack) === trackUid;
    
    div.className = 'track-row' + (isCurrentlyPlaying ? ' is-playing' : '') + (isCurrentlyPlaying && !isPlaying ? ' paused' : '');
    div.dataset.trackUid = trackUid;
    let durationSec = 0;
    if (track.duration) durationSec = track.duration > 10000 ? track.duration / 1000 : track.duration;
    else if (track.duration_seconds) durationSec = track.duration_seconds;
    
    const isPlaylistView = playlistId !== null;

    div.innerHTML = `
        <div class="track-num-col">
            <span class="row-num">${index + 1}</span>
            <i class="fa-solid fa-play row-play"></i>
        </div>
        <div class="track-info">
            <div style="position: relative; width: 40px; height: 40px; flex-shrink: 0;">
                <img data-src="${track.local_artwork || getProxyUrl(track.artwork_url)}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="track-thumb" style="width: 100%; height: 100%;">
                <div class="playing-bars" style="z-index: 6;"><div></div><div></div><div></div></div>
            </div>
            <div class="track-name-stack">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="track-name">${escapeHtml(track.title)}</span>
                    ${getSourceBadge(track.source)}
                </div>
                <span class="np-artist">${formatArtistLinks(track.artist_name)}</span>
            </div>
        </div>
        <div class="track-album">${escapeHtml(track.album_name || track.album || '')}</div>
        <div class="track-plus-col" style="display: flex; align-items: center; gap: 12px; justify-content: flex-end;">
            <button class="track-heart-btn" title="Like Song">
                <i class="fa-regular fa-heart"></i>
            </button>
            ${(isPlaylistView && playlistId !== 'favorites') ? `
            <button class="row-action-btn" style="background: none; border: none; color: var(--text-subdued); cursor: pointer; opacity: 0; transition: opacity 0.2s;" title="Remove from Playlist">
                <i class="fa-solid fa-trash" style="color: #ef4444;"></i>
            </button>
            ` : (isPlaylistView ? `
            <button class="row-action-btn" style="background: none; border: none; color: var(--text-subdued); cursor: pointer; opacity: 0; transition: opacity 0.2s;" title="Add to Playlist">
                <i class="fa-solid fa-plus"></i>
            </button>
            ` : '')}
        </div>
        <div class="track-duration">${formatTime(durationSec)}</div>
    `;

    const heartBtn = div.querySelector('.track-heart-btn');
    if (heartBtn) {
        const isLiked = favorites.some(f => getTrackUid(f) === trackUid);
        if (isLiked) {
            heartBtn.classList.add('active');
            heartBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
        }
        heartBtn.onclick = (e) => {
            e.stopPropagation();
            window.toggleLikeTrack(track, heartBtn);
        };
    }

    const actionBtn = div.querySelector('.row-action-btn');
    if (actionBtn) {
        actionBtn.onclick = (e) => { 
            e.stopPropagation(); 
            if (isPlaylistView && playlistId !== 'favorites') {
                removeFromPlaylist(trackUid, playlistId);
            } else {
                showAddToPlaylistModal(track); 
            }
        };
    }

    div.addEventListener('click', (e) => {
        if (e.target.closest('.np-artist') || e.target.closest('.row-action-btn')) return;
        playlist = trackList;
        originalPlaylist = [...trackList];
        
        const freshIndex = playlist.findIndex(t => getTrackUid(t) === trackUid);
        const isCurrent = currentTrack && getTrackUid(currentTrack) === trackUid;
        if (isCurrent) {
            togglePlayPause();
        } else {
            playTrack(freshIndex > -1 ? freshIndex : index);
        }
    });
    return div;
}

function removeFromPlaylist(trackUid, playlistId) {
    if (playlistId === 'favorites') {
        const track = favorites.find(t => getTrackUid(t) === trackUid);
        if (track) window.toggleLikeTrack(track);
        return;
    }
    const plIndex = playlists.findIndex(p => p.id.toString() === playlistId.toString());
    if (plIndex > -1) {
        playlists[plIndex].tracks = playlists[plIndex].tracks.filter(t => getTrackUid(t) !== trackUid);
        saveLibraryData();
        renderLibrary();
        loadPlaylistView(playlistId);
        showToast('Removed from playlist', 'info');
    }
}
let activeSource = 'youtube';
function setPlaybackLoading(isLoading) {
    const pbControls = document.getElementById('playbackControls');
    const pbLoading = document.getElementById('playbackLoading');
    if (isLoading) {
        if (pbControls) pbControls.classList.add('hidden');
        if (pbLoading) pbLoading.classList.remove('hidden');
    } else {
        if (pbControls) pbControls.classList.remove('hidden');
        if (pbLoading) pbLoading.classList.add('hidden');
    }
}

let currentPlayRequestId = 0;

async function playTrack(index) {
    const playRequestId = ++currentPlayRequestId;
    currentIndex = index;
    currentTrack = playlist[currentIndex];
    vocalDetectedTime = null; 
    
    let nativeAudio = document.getElementById('nativeAudio');
    if (nativeAudio) {
        nativeAudio.pause();
    }
    if (player && typeof player.stopVideo === 'function') {
        try { player.stopVideo(); } catch(e) {}
    }
    
    parsedLyrics = [];
    const panelContent = document.getElementById('panelContent');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    const fsMain = document.querySelector('.fs-main');
    if (fsMain) fsMain.classList.add('no-lyrics');
    const loadingHtml = '<div class="py-10 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = loadingHtml;
    if (fsLyrics) fsLyrics.innerHTML = '';

    setPlaybackLoading(true);

    if (isShuffle) {
        const sIndex = shuffledIndices.indexOf(index);
        if (sIndex > -1) shuffledCurrentIndex = sIndex;
        else generateShuffledSequence();
    }
    
    document.querySelectorAll('.track-row').forEach(row => {
        const isCurrent = row.dataset.trackUid === getTrackUid(currentTrack);
        row.classList.toggle('is-playing', isCurrent);
        if (isCurrent) {
            row.classList.toggle('paused', !isPlaying);
        } else {
            row.classList.remove('paused');
        }
    });

    document.getElementById('currentTrackName').textContent = currentTrack.title;
    const artistNameEl = document.getElementById('currentArtistName');
    artistNameEl.textContent = currentTrack.artist_name;
    artistNameEl.className = 'text-xs text-gray-500 truncate hover:underline hover:text-white cursor-pointer';
    artistNameEl.onclick = () => loadArtistView(currentTrack.artist_name);
    const artwork = document.getElementById('currentArtwork');
    artwork.src = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url);
    artwork.classList.remove('hidden');
    document.getElementById('artworkPlaceholder').classList.add('hidden');
    
    updateLikeButtonStatus();
    if (document.getElementById('fsPlayer').classList.contains('active')) updateFullscreenUI();
    
    fetchLyrics();
    
    if (window.currentPanel === 'queue') renderQueue();
    const initDurSec = (currentTrack && currentTrack.duration) ? (currentTrack.duration > 10000 ? currentTrack.duration / 1000 : currentTrack.duration) : 0;
    const initDurStr = initDurSec > 0 ? formatTime(initDurSec) : '0:00';
    document.getElementById('progressBarFill').style.width = '0%';
    document.getElementById('currentTimeLabel').textContent = '0:00';
    document.getElementById('durationLabel').textContent = initDurStr;
    
    const fsBar = document.getElementById('fsProgressBarFill'); if (fsBar) fsBar.style.width = '0%';
    const fsCurrent = document.getElementById('fsCurrentTime'); if (fsCurrent) fsCurrent.textContent = '0:00';
    const fsDuration = document.getElementById('fsDuration'); if (fsDuration) fsDuration.textContent = initDurStr;
    
    let preloaded = null;
    const currentUid = getTrackUid(currentTrack);
    if (preloadedNextTrack && preloadedNextTrack.uid === currentUid) preloaded = preloadedNextTrack;
    else if (preloadedPrevTrack && preloadedPrevTrack.uid === currentUid) preloaded = preloadedPrevTrack;
    
    if (preloaded) {
        if (playRequestId !== currentPlayRequestId) return;
        if (preloaded.url) loadAudioPlayer(preloaded.url);
        else if (preloaded.videoId) loadAudioPlayer(`${API_BASE_URL}?endpoint=stream&id=${encodeURIComponent(preloaded.videoId)}`);
        preloadedNextTrack = null;
        preloadedPrevTrack = null;
        preloadTracks();
        return;
    }
    const directUrl = getDownloadUrl(currentTrack);
    if (directUrl) {
        if (playRequestId !== currentPlayRequestId) return;
        loadAudioPlayer(directUrl);
        preloadTracks();
        return;
    }
    
    const videoId = await getYoutubeId(currentTrack);
    if (playRequestId !== currentPlayRequestId) return;
    if (videoId) {
        loadAudioPlayer(`${API_BASE_URL}?endpoint=stream&id=${encodeURIComponent(videoId)}`);
        preloadTracks();
        return;
    }

    if (playRequestId !== currentPlayRequestId) return;
    showToast("Playback failed: Song could not be loaded.", "error");
    setPlaybackLoading(false);
}
let audioAnalysisContext = null;
let analyserNode = null;
let audioSourceNode = null;
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
let eqFilters = [];
let eqGains = JSON.parse(localStorage.getItem('velium_eq_gains')) || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass_boost: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
    vocal: [-2, -2, -1, 1, 3, 5, 4, 2, 0, -1],
    electronic: [5, 4, 2, 0, -1, 2, 1, 2, 4, 5],
    rock: [6, 4, 2, 0, -1, -1, 1, 3, 5, 5],
    pop: [-1, 1, 3, 4, 3, 0, -1, -1, 2, 3],
    acoustic: [4, 3, 1, 1, 2, 2, 3, 4, 3, 2]
};

function initAudioAnalysis(audioElement) {
    if (!audioElement || audioElement._analysisInitialized) return;
    try {
        if (!audioAnalysisContext) {
            audioAnalysisContext = new (window.AudioContext || window.webkitAudioContext)();
            analyserNode = audioAnalysisContext.createAnalyser();
            analyserNode.fftSize = 1024; 
            analyserNode.smoothingTimeConstant = 0.6; 

            eqFilters = EQ_FREQUENCIES.map((freq, i) => {
                const filter = audioAnalysisContext.createBiquadFilter();
                if (i === 0) {
                    filter.type = 'lowshelf';
                } else if (i === EQ_FREQUENCIES.length - 1) {
                    filter.type = 'highshelf';
                } else {
                    filter.type = 'peaking';
                    filter.Q.value = 1.4;
                }
                filter.frequency.value = freq;
                filter.gain.value = eqGains[i] || 0;
                return filter;
            });
        }
        
        if (audioSourceNode) {
            try { audioSourceNode.disconnect(); } catch(e) {}
        }
        
        audioSourceNode = audioAnalysisContext.createMediaElementSource(audioElement);
        
        let lastNode = audioSourceNode;
        eqFilters.forEach(f => {
            lastNode.connect(f);
            lastNode = f;
        });
        lastNode.connect(analyserNode);
        analyserNode.connect(audioAnalysisContext.destination);
        audioElement._analysisInitialized = true;
    } catch (e) {
        console.warn("Audio analysis init failed:", e);
    }
}

function renderEqSliders() {
    const container = document.getElementById('eqSlidersContainer');
    if (!container) return;
    container.innerHTML = '';
    const labels = ['32Hz', '64Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
    
    EQ_FREQUENCIES.forEach((freq, i) => {
        const val = eqGains[i] || 0;
        const col = document.createElement('div');
        col.style.display = 'flex';
        col.style.flexDirection = 'column';
        col.style.alignItems = 'center';
        col.style.gap = '12px';
        col.innerHTML = `
            <span id="eqGainVal_${i}" style="font-size: 12px; font-weight: 700; color: var(--text-main); min-height: 18px;">${val > 0 ? '+' + val : val} dB</span>
            <div style="height: 160px; display: flex; align-items: center; justify-content: center;">
                <input type="range" id="eqSlider_${i}" min="-12" max="12" step="0.5" value="${val}" style="writing-mode: vertical-lr; direction: rtl; width: 24px; height: 140px; cursor: pointer;">
            </div>
            <span style="font-size: 11px; font-weight: 600; color: var(--text-subdued);">${labels[i]}</span>
        `;
        const input = col.querySelector('input');
        input.oninput = (e) => {
            const num = parseFloat(e.target.value);
            setEqGain(i, num);
        };
        container.appendChild(col);
    });
}

function setEqGain(index, value) {
    eqGains[index] = value;
    localStorage.setItem('velium_eq_gains', JSON.stringify(eqGains));
    if (eqFilters[index]) {
        eqFilters[index].gain.setValueAtTime(value, audioAnalysisContext ? audioAnalysisContext.currentTime : 0);
    }
    const valLabel = document.getElementById(`eqGainVal_${index}`);
    if (valLabel) {
        valLabel.textContent = (value > 0 ? '+' + value : value) + ' dB';
    }
}

function applyEqPreset(presetName) {
    const preset = EQ_PRESETS[presetName];
    if (!preset) return;
    eqGains = [...preset];
    localStorage.setItem('velium_eq_gains', JSON.stringify(eqGains));
    eqGains.forEach((val, i) => {
        if (eqFilters[i]) {
            eqFilters[i].gain.setValueAtTime(val, audioAnalysisContext ? audioAnalysisContext.currentTime : 0);
        }
        const slider = document.getElementById(`eqSlider_${i}`);
        if (slider) slider.value = val;
        const valLabel = document.getElementById(`eqGainVal_${i}`);
        if (valLabel) valLabel.textContent = (val > 0 ? '+' + val : val) + ' dB';
    });
    const presetBtnIds = ['presetFlat', 'presetBass', 'presetVocal', 'presetElectronic', 'presetRock', 'presetPop', 'presetAcoustic'];
    presetBtnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.classList.remove('active');
    });
    const map = {
        flat: 'presetFlat',
        bass_boost: 'presetBass',
        vocal: 'presetVocal',
        electronic: 'presetElectronic',
        rock: 'presetRock',
        pop: 'presetPop',
        acoustic: 'presetAcoustic'
    };
    if (map[presetName]) {
        const activeBtn = document.getElementById(map[presetName]);
        if (activeBtn) activeBtn.classList.add('active');
    }
}

function resetEqualizer() {
    applyEqPreset('flat');
}

function startVocalDetection() {
    vocalDetectedTime = null;
    analysisCalibration = { noiseFloor: 0, peakVocal: 0, samples: 0, isCalibrated: false };
    
    if (!analyserNode || activeSource !== 'audio') return;
    
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let detectCount = 0;
    
    const check = () => {
        if (vocalDetectedTime || activeSource !== 'audio' || !isPlaying) return;
        
        analyserNode.getByteFrequencyData(dataArray);
        
        let currentEnergy = 0;
        for (let i = 9; i < 58; i++) {
            currentEnergy += dataArray[i];
        }
        currentEnergy /= 49;
        
        const audio = document.getElementById('nativeAudio');
        const currentTime = audio ? audio.currentTime : 0;

        if (!analysisCalibration.isCalibrated && currentTime < 1.5) {
            analysisCalibration.noiseFloor = (analysisCalibration.noiseFloor * analysisCalibration.samples + currentEnergy) / (analysisCalibration.samples + 1);
            analysisCalibration.samples++;
            if (currentTime > 1.2) analysisCalibration.isCalibrated = true;
            requestAnimationFrame(check);
            return;
        }

        const threshold = Math.max(70, analysisCalibration.noiseFloor * 1.4);
        
        if (currentEnergy > threshold) {
            detectCount++;
            if (detectCount >= 8) { 
                vocalDetectedTime = currentTime - 0.15; 
            }
        } else {
            detectCount = Math.max(0, detectCount - 1);
        }
        
        if (!vocalDetectedTime) requestAnimationFrame(check);
    };
    
    requestAnimationFrame(check);
}

function loadAudioPlayer(url) {
    activeSource = 'audio';
    if (player && typeof player.pauseVideo === 'function') {
        try { player.pauseVideo(); } catch (e) {}
    }
    let audio = document.getElementById('nativeAudio');
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'nativeAudio';
        audio.preload = 'auto';
        document.body.appendChild(audio);
    }
    if (!audio._listenersAttached) {
        audio._listenersAttached = true;
        initAudioAnalysis(audio);
        audio.addEventListener('playing', () => { 
            isPlaying = true; 
            audio._isRecovering = false;
            updatePlayPauseUI(); 
            startProgressUpdate(); 
            setPlaybackLoading(false);
            if (audioAnalysisContext && audioAnalysisContext.state === 'suspended') {
                audioAnalysisContext.resume();
            }
            startVocalDetection();
        });
        audio.addEventListener('pause', () => { 
            isPlaying = false; 
            updatePlayPauseUI(); 
            stopProgressUpdate(); 
        });
        audio.addEventListener('waiting', () => setPlaybackLoading(true));
        audio.addEventListener('canplay', () => setPlaybackLoading(false));
        audio.addEventListener('ended', () => playNext());
        
        audio.addEventListener('error', async () => {
            if (!audio.src || audio.src === 'about:blank' || audio.src === window.location.href) return;
            if (!audio.error) return;
            if (audio._isRecovering) {
                if (currentTrack) {
                    const videoId = currentTrack.youtube_id || currentTrack.videoId;
                    if (videoId && typeof loadYouTubePlayer === 'function') {
                        loadYouTubePlayer(videoId);
                        return;
                    }
                }
                showToast("Playback failed: Stream unavailable.", "error");
                setPlaybackLoading(false);
                return;
            }
            audio._isRecovering = true;
            
            if (currentTrack) {
                const videoId = await getYoutubeId(currentTrack);
                if (videoId) {
                    const fallbackUrl = `${API_BASE_URL}?endpoint=stream&id=${encodeURIComponent(videoId)}`;
                    if (!audio.src.includes(encodeURIComponent(videoId))) {
                        loadAudioPlayer(fallbackUrl);
                        return;
                    } else if (typeof loadYouTubePlayer === 'function') {
                        loadYouTubePlayer(videoId);
                        return;
                    }
                }
            }
            showToast("Playback failed: Connection error.", "error");
            setPlaybackLoading(false);
        });
        audio.addEventListener('timeupdate', () => {
            if (activeSource === 'audio' && audio.duration) {
                const percent = (audio.currentTime / audio.duration) * 100;
                document.getElementById('progressBarFill').style.width = percent + '%';
                document.getElementById('currentTimeLabel').textContent = formatTime(audio.currentTime);
                document.getElementById('durationLabel').textContent = formatTime(audio.duration);
                const fsBar = document.getElementById('fsProgressBarFill'); if (fsBar) fsBar.style.width = percent + '%';
                const fsCurrent = document.getElementById('fsCurrentTime'); if (fsCurrent) fsCurrent.textContent = formatTime(audio.currentTime);
                const fsDuration = document.getElementById('fsDuration'); if (fsDuration) fsDuration.textContent = formatTime(audio.duration);
                saveTrackDuration(currentTrack, audio.duration);
                updateLyricsSync(audio.currentTime);
            }
        });
    }

    if (audio.src !== url && !audio.src.endsWith(url)) {
        audio._isRecovering = false;
        audio.src = url;
    }
    audio.volume = volume / 100;
    setPlaybackLoading(true);

    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            if (error.name === 'AbortError') {
                return;
            }
            setPlaybackLoading(false);
            if (error.name === 'NotAllowedError') {
                isPlaying = false;
                updatePlayPauseUI();
                return;
            }
            if (error.name === 'NotSupportedError') {
                if (currentTrack) {
                    const vid = currentTrack.youtube_id || currentTrack.videoId || (currentTrack.id && currentTrack.id.startsWith('ytm-') ? currentTrack.id.replace('ytm-', '') : null);
                    if (vid) {
                        const fallbackUrl = `${API_BASE_URL}?endpoint=stream&id=${encodeURIComponent(vid)}`;
                        if (!audio.src.includes(encodeURIComponent(vid))) {
                            loadAudioPlayer(fallbackUrl);
                            return;
                        }
                    }
                }
            }
        });
    }
}

function loadYouTubePlayer(videoId) {
    activeSource = 'youtube';
    if (currentTrack) {
        currentTrack.youtube_id = videoId;
        currentTrack.videoId = videoId;
    }
    let audio = document.getElementById('nativeAudio');
    if (audio) audio.pause();
    startProgressUpdate();
    if (window.YT && window.YT.Player) {
        if (player && typeof player.loadVideoById === 'function') {
            player.loadVideoById(videoId);
            player.playVideo();
        } else {
            player = new YT.Player('youtubePlayer', {
                height: '0',
                width: '0',
                videoId: videoId,
                playerVars: { autoplay: 1, controls: 0, disablekb: 1, origin: window.location.origin },
                events: { 
                    onReady: (e) => { 
                        e.target.setVolume(volume); 
                        e.target.playVideo(); 
                        startProgressUpdate();
                        const pbControls = document.getElementById('playbackControls');
                        const pbLoading = document.getElementById('playbackLoading');
                        if (pbControls) pbControls.classList.remove('hidden');
                        if (pbLoading) pbLoading.classList.add('hidden');
                    }, 
                    onStateChange: onPlayerStateChange,
                    onError: (e) => {
                        console.warn('YouTube playback error:', e.data);
                        setPlaybackLoading(false);
                    }
                }
            });
        }
    } else {
        if (!document.querySelector('script[src*="iframe_api"]')) {
            const tag = document.createElement('script');
            tag.src = getProxyUrl("https://www.youtube.com/iframe_api");
            const firstScriptTag = document.getElementsByTagName('script')[0];
            if (firstScriptTag) firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }
        window.onYouTubeIframeAPIReady = () => loadYouTubePlayer(videoId);
    }
}
function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) { 
        isPlaying = true; 
        updatePlayPauseUI(); 
        startProgressUpdate(); 
        setPlaybackLoading(false);
    }
    else if (event.data === YT.PlayerState.BUFFERING) {
        setPlaybackLoading(true);
        startProgressUpdate();
    }
    else if (event.data === YT.PlayerState.CUED) {
        startProgressUpdate();
    }
    else if (event.data === YT.PlayerState.PAUSED) { isPlaying = false; updatePlayPauseUI(); stopProgressUpdate(); }
    else if (event.data === YT.PlayerState.ENDED) playNext();
}
function togglePlayPause() {
    if (activeSource === 'audio') {
        const audio = document.getElementById('nativeAudio');
        if (audio) { if (isPlaying) audio.pause(); else audio.play(); }
    } else if (player) {
        if (isPlaying) {
            if (typeof player.pauseVideo === 'function') player.pauseVideo();
            isPlaying = false;
            updatePlayPauseUI();
            stopProgressUpdate();
        } else {
            if (typeof player.playVideo === 'function') player.playVideo();
            isPlaying = true;
            updatePlayPauseUI();
            startProgressUpdate();
        }
    }
}
function updatePlayPauseUI() {
    const btn = document.getElementById('playPauseButton');
    if (btn) btn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:2px;"></i>';
    const mobileBtn = document.getElementById('mobilePlayPause');
    if (mobileBtn) mobileBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:2px;"></i>';
    const fsBtn = document.getElementById('fsPlayPause');
    if (fsBtn) fsBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:4px;"></i>';
    
    document.querySelectorAll('.track-row').forEach(row => {
        if (row.classList.contains('is-playing')) {
            row.classList.toggle('paused', !isPlaying);
        } else {
            row.classList.remove('paused');
        }
    });
}
function playNext() {
    if (playlist.length === 0) {
        closeFullscreenIfNoTrack();
        return;
    }
    if (repeatMode === 'one') { playTrack(currentIndex); return; }
    if (isShuffle) {
        shuffledCurrentIndex++;
        if (shuffledCurrentIndex >= shuffledIndices.length) {
            if (repeatMode === 'all') { generateShuffledSequence(); shuffledCurrentIndex = 0; }
            else {
                closeFullscreenIfNoTrack();
                return;
            }
        }
        playTrack(shuffledIndices[shuffledCurrentIndex]);
    } else {
        let nextIndex = (currentIndex + 1) % playlist.length;
        if (nextIndex === 0 && repeatMode !== 'all') {
            closeFullscreenIfNoTrack();
            return;
        }
        playTrack(nextIndex);
    }
}
function playPrev() {
    if (playlist.length === 0) {
        closeFullscreenIfNoTrack();
        return;
    }
    if (isShuffle) {
        if (shuffledCurrentIndex > 0) { shuffledCurrentIndex--; playTrack(shuffledIndices[shuffledCurrentIndex]); }
        else playTrack(currentIndex);
    } else {
        let prevIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
        playTrack(prevIndex);
    }
}
function toggleShuffle() {
    isShuffle = !isShuffle;
    document.getElementById('shuffleButton').classList.toggle('active', isShuffle);
    document.getElementById('fsShuffle').classList.toggle('active', isShuffle);
    if (isShuffle) generateShuffledSequence();
}
function updateRepeatUI() {
    const configs = [
        { id: 'repeatButton', size: 9 },
        { id: 'fsRepeat', size: 12 }
    ];
    configs.forEach(({ id, size }) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('active', repeatMode !== 'off');
        if (repeatMode === 'one') {
            btn.innerHTML = `<span style="position: relative; display: inline-flex; align-items: center; justify-content: center;"><i class="fa-solid fa-repeat"></i><span class="repeat-one-badge" style="font-size: ${size}px;">1</span></span>`;
        } else {
            btn.innerHTML = '<i class="fa-solid fa-repeat"></i>';
        }
    });
}
function cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    updateRepeatUI();
}
async function loadLibraryData() {
    try {
        if (window.VeliumDB) {
            const lib = await window.VeliumDB.getLibrary();
            favorites = lib.likedSongs || []; playlists = lib.playlists || [];
        } else {
            favorites = JSON.parse(localStorage.getItem('velium_v2_favorites')) || [];
            playlists = JSON.parse(localStorage.getItem('velium_v2_playlists')) || [];
        }
    } catch (e) { console.error("Error loading library", e); }
}
async function saveLibraryData() {
    try {
        if (window.VeliumDB) await window.VeliumDB.saveLibrary({ likedSongs: favorites, playlists: playlists });
        else {
            localStorage.setItem('velium_v2_favorites', JSON.stringify(favorites));
            localStorage.setItem('velium_v2_playlists', JSON.stringify(playlists));
        }
    } catch (e) { console.error("Error saving library", e); }
}

function getTotalLibrarySongs() {
    const allSongs = new Set();
    favorites.forEach(s => allSongs.add(getTrackUid(s)));
    playlists.forEach(pl => pl.tracks.forEach(s => allSongs.add(getTrackUid(s))));
    return allSongs.size;
}

function enforceLibraryLimit() {}

function saveToStorage(key, value) { localStorage.setItem(`velium_v2_${key}`, JSON.stringify(value)); }
window.toggleLikeTrack = async function(track, btnEl) {
    const trackUid = getTrackUid(track);
    const index = favorites.findIndex(t => getTrackUid(t) === trackUid);
    const isLiking = index === -1;

    const originalFavorites = [...favorites];    
    if (isLiking) {
        favorites.push(track);
    } else {
        favorites.splice(index, 1);
    }

    try {
        await saveLibraryData();
        
        updateLikeButtonStatus();
        if (document.getElementById('favoritesView').classList.contains('active')) renderFavorites();
        
        if (isLiking && track.artwork_url && !track.local_artwork) {
            const b64 = await urlToBase64(track.artwork_url);
            if (b64) {
                track.local_artwork = b64;
                const favIdx = favorites.findIndex(t => getTrackUid(t) === trackUid);
                if (favIdx > -1) favorites[favIdx].local_artwork = b64;
                await saveLibraryData();
            }
        }
    } catch (e) {
        console.error("Failed to save like state", e);
        favorites = originalFavorites; 
        showToast('Failed to save like state', 'error');
    }
};
async function toggleLike() {
    if (!currentTrack) return;
    const btn = document.getElementById('likeButton');
    const fsBtn = document.getElementById('fsLike');
    await window.toggleLikeTrack(currentTrack, btn);
}
function updateLikeButtonStatus() {
    if (!currentTrack) return;
    const trackUid = getTrackUid(currentTrack);
    const isLiked = favorites.some(t => getTrackUid(t) === trackUid);
    
    const btn = document.getElementById('likeButton');
    if (btn) {
        btn.innerHTML = isLiked ? '<i class="fa-solid fa-heart" style="color: #ef4444;"></i>' : '<i class="fa-regular fa-heart"></i>';
        btn.classList.toggle('active', isLiked);
        const tip = isLiked ? 'Unfavorite Track' : 'Favorite Track';
        btn.setAttribute('data-tip', tip);
        btn.setAttribute('title', tip);
    }
    
    const fsBtn = document.getElementById('fsLike');
    if (fsBtn) {
        fsBtn.innerHTML = isLiked ? '<i class="fa-solid fa-heart" style="color: #ef4444;"></i>' : '<i class="fa-regular fa-heart"></i>';
        fsBtn.classList.toggle('active', isLiked);
        const fsTip = isLiked ? 'Unfavorite Track' : 'Like';
        fsBtn.setAttribute('title', fsTip);
        fsBtn.setAttribute('data-tip', fsTip);
    }

    document.querySelectorAll('.track-row').forEach(row => {
        const rowUid = row.dataset.trackUid;
        const heartBtn = row.querySelector('.track-heart-btn');
        if (heartBtn) {
            const rowIsLiked = favorites.some(t => getTrackUid(t) === rowUid);
            heartBtn.innerHTML = rowIsLiked ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
            heartBtn.classList.toggle('active', rowIsLiked);
        }
    });
}

function toggleFsLyrics() {
    const fsMain = document.querySelector('.fs-main');
    const toggleBtn = document.getElementById('fsLyricsToggle');
    if (!fsMain || !toggleBtn) return;
    if (fsMain.classList.contains('no-lyrics')) return;
    
    const isHidden = fsMain.classList.toggle('lyrics-hidden');
    toggleBtn.classList.toggle('active', !isHidden);
    localStorage.setItem('velium_fs_lyrics_hidden', isHidden);
}

function renderLibrary() {
    const container = document.getElementById('libraryContent'); if (!container) return;
    container.innerHTML = '';
    const likedCard = document.createElement('div');
    likedCard.className = 'track-card';
    likedCard.innerHTML = `
        <div class="card-thumb" style="background: linear-gradient(135deg, #4f46e5, #8b5cf6); display:flex; align-items:center; justify-content:center; color:#fff; font-size:48px;"><i class="fa-solid fa-heart"></i></div>
        <div class="card-title">Liked Songs</div>
        <div class="card-subtitle">Playlist • ${favorites.length} songs</div>
    `;
    likedCard.onclick = () => switchView('favorites');
    container.appendChild(likedCard);
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'track-card';
        card.innerHTML = `
            <div class="card-thumb" style="display:flex; align-items:center; justify-content:center;">
                ${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fa-solid fa-music" style="font-size:48px; color: var(--text-subdued); opacity:0.4;"></i>`}
            </div>
            <div class="card-title">${escapeHtml(pl.name)}</div>
            <div class="card-subtitle">Playlist • ${pl.tracks.length} songs</div>
        `;
        card.onclick = () => loadPlaylistView(pl.id);
        container.appendChild(card);
    });
}
async function loadPlaylistView(playlistId) {
    const pl = playlists.find(p => p.id === playlistId); if (!pl) return;
    artistSearchState.name = ''; 
    switchView('dynamic');
    
    if (typeof window.updateTopBanner === 'function') {
        window.updateTopBanner('playlist', { playlist: pl });
        const container = document.getElementById('dynamicView');
        container.innerHTML = `
            <div style="padding: 4px 0 12px;">
                <div class="track-header">
                    <div class="track-num-col">#</div>
                    <div>TITLE</div>
                    <div>ALBUM</div>
                    <div style="text-align:right;"><i class="fa-regular fa-heart"></i></div>
                    <div style="text-align:right;"><i class="fa-regular fa-clock"></i></div>
                </div>
                <div id="dynamicList" style="display:flex !important; flex-direction:column !important;"></div>
            </div>
        `;
    } else {
        const container = document.getElementById('dynamicView');
        const playlistColor = pl.color || '#4f46e5';
        container.innerHTML = `
            <header class="hero-header" style="background: linear-gradient(to bottom, ${playlistColor} 0%, var(--bg-elevated) 100%);">
                <div class="artist-img playlist-art-container" style="border-radius: 0% !important; position: relative; overflow: hidden; cursor: pointer;" onclick="showPlaylistCoverUploadModal('${pl.id}')">
                    ${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" class="w-full h-full object-cover">` : `<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%;"><i class="fa-solid fa-music"></i></div>`}
                    <div class="art-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease;">
                        <i class="fas fa-camera text-white text-3xl"></i>
                    </div>
                </div>
                <style>.playlist-art-container:hover .art-overlay { opacity: 1 !important; }</style>
                <div class="hero-meta">
                    <h1 class="artist-header">${escapeHtml(pl.name)}</h1>
                    <div class="monthly-listeners">${escapeHtml(pl.description || 'No description')}</div>
                    <div class="monthly-listeners" style="margin-top: 4px; font-weight: bold;">${pl.tracks.length} songs</div>
                </div>
            </header>
            <div class="action-bar">
                <button class="btn-play-large" onclick="playAllFromDynamic()"><i class="fa-solid fa-play" style="margin-left: 4px;"></i></button>
                <button class="btn-follow" onclick="showEditPlaylistModal('${pl.id}')">Edit</button>
                <button class="btn-follow" style="border-color: #ef4444; color: #ef4444;" onclick="deletePlaylist('${pl.id}')">Delete</button>
            </div>
            <div class="track-section">
                <div class="track-grid" id="dynamicList"></div>
            </div>
        `;
    }
    
    const list = document.getElementById('dynamicList');
    if (pl.tracks.length === 0) list.innerHTML = '<div style="padding: 40px 0; text-align: center; opacity: 0.5;">This playlist is empty. Add some songs!</div>';
    else {
        pl.tracks.forEach((track, index) => list.appendChild(createTrackRow(track, index, pl.tracks, true, pl.id)));
        observeImages(list);
    }
    currentDynamicPlaylist = pl.tracks;
}
let currentDynamicPlaylist = [];
function playAllFromDynamic() { if (currentDynamicPlaylist.length > 0) { playlist = currentDynamicPlaylist; originalPlaylist = [...currentDynamicPlaylist]; preloadedNextTrack = null; playTrack(0); } }
function playAllFavorites() { if (favorites.length > 0) { playlist = favorites; originalPlaylist = [...favorites]; preloadedNextTrack = null; playTrack(0); } }
function createPlaylist(name, description = '', cover_url = '', color = '#4f46e5') {
    const newPlaylist = { id: Date.now().toString(), name: name || 'My Playlist', description: description, tracks: [], cover_url: cover_url, color: color, createdAt: new Date().toISOString() };
    playlists.push(newPlaylist); saveLibraryData(); renderLibrary(); return newPlaylist.id;
}
function updatePlaylist(playlistId, name, description, cover_url, color) {
    const plIndex = playlists.findIndex(p => p.id === playlistId);
    if (plIndex > -1) {
        playlists[plIndex].name = name;
        playlists[plIndex].description = description;
        playlists[plIndex].cover_url = cover_url;
        if (color) playlists[plIndex].color = color;
        saveLibraryData(); renderLibrary();
        if (document.getElementById('dynamicView').classList.contains('active')) {
            loadPlaylistView(playlistId);
        }
        return true;
    }
    return false;
}
function deletePlaylist(playlistId) {
    if (confirm('Are you sure you want to delete this playlist?')) {
        playlists = playlists.filter(pl => pl.id !== playlistId);
        saveLibraryData(); renderLibrary();
        switchView('home');
    }
}
function showCreatePlaylistModal() { 
    document.getElementById('createPlaylistModal').style.display = 'flex'; 
    document.getElementById('playlistNameInput').value = ''; 
    document.getElementById('playlistDescInput').value = ''; 
    document.getElementById('createPlaylistColor').value = '#4f46e5';
    const artPreview = document.getElementById('createPlaylistArtPreview');
    const artPlaceholder = document.getElementById('createPlaylistArtPlaceholder');
    const removeBtn = document.getElementById('removeCreateArtBtn');
    if (artPreview) {
        artPreview.src = '';
        artPreview.style.display = 'none';
    }
    if (artPlaceholder) artPlaceholder.style.display = 'flex';
    if (removeBtn) removeBtn.classList.remove('show');
    renderColorPicker('createPlaylistColorPicker', 'createPlaylistColor', 'createPlaylistColorHex', '#4f46e5', null);
}
function hideCreatePlaylistModal() { document.getElementById('createPlaylistModal').style.display = 'none'; }
function showEditPlaylistModal(playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const modal = document.getElementById('editPlaylistModal');
    modal.style.display = 'flex';
    document.getElementById('editPlaylistId').value = pl.id;
    document.getElementById('editPlaylistNameInput').value = pl.name;
    document.getElementById('editPlaylistDescInput').value = pl.description;
    document.getElementById('editPlaylistColor').value = pl.color || '#4f46e5';
    
    const artPreview = document.getElementById('editPlaylistArtPreview');
    const artPlaceholder = document.getElementById('editPlaylistArtPlaceholder');
    const removeBtn = document.getElementById('removeArtBtn');
    
    if (pl.cover_url) {
        artPreview.src = pl.cover_url;
        artPreview.style.display = 'block';
        artPlaceholder.style.display = 'none';
        removeBtn.classList.add('show');
    } else {
        artPreview.src = '';
        artPreview.style.display = 'none';
        artPlaceholder.style.display = 'flex';
        removeBtn.classList.remove('show');
    }
    
    renderColorPicker('editPlaylistColorPicker', 'editPlaylistColor', 'editPlaylistColorHex', pl.color || '#4f46e5', pl.cover_url);
}
function hideEditPlaylistModal() { document.getElementById('editPlaylistModal').style.display = 'none'; }
async function confirmEditPlaylist() {
    const id = document.getElementById('editPlaylistId').value;
    const name = document.getElementById('editPlaylistNameInput').value.trim();
    const desc = document.getElementById('editPlaylistDescInput').value.trim();
    const color = document.getElementById('editPlaylistColor').value;
    const artPreview = document.getElementById('editPlaylistArtPreview');
    const cover_url = artPreview.style.display === 'block' ? artPreview.src : '';
    
    if (name) {
        updatePlaylist(id, name, desc, cover_url, color);
        hideEditPlaylistModal();
    }
}

function renderColorPicker(containerId, hiddenInputId, hexInputId, activeColor, imageUrl, customColor = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    
    const defaultColors = ['#4f46e5', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
    if (customColor && !defaultColors.includes(customColor)) {
        defaultColors.unshift(customColor);
    }
    
    const hexInput = document.getElementById(hexInputId);
    if (hexInput) {
        hexInput.value = activeColor.toUpperCase();
        hexInput.oninput = (e) => {
            let val = e.target.value.trim();
            if (val && !val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                document.getElementById(hiddenInputId).value = val;
                container.querySelectorAll('.color-option').forEach(el => {
                    const bg = el.style.backgroundColor;
                    if (bg) {
                        const rgbMatch = bg.match(/\d+/g);
                        if (rgbMatch) {
                            const r = parseInt(rgbMatch[0]), g = parseInt(rgbMatch[1]), b = parseInt(rgbMatch[2]);
                            const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
                            if (hex.toLowerCase() === val.toLowerCase()) el.classList.add('active');
                            else el.classList.remove('active');
                        }
                    }
                });
            }
        };
    }

    const render = (allColors) => {
        container.innerHTML = '';
        const uniqueColors = [...new Set(allColors)];
        uniqueColors.forEach(color => {
            const opt = document.createElement('div');
            opt.className = 'color-option' + (color.toLowerCase() === activeColor.toLowerCase() ? ' active' : '');
            opt.style.backgroundColor = color;
            opt.onclick = () => {
                container.querySelectorAll('.color-option').forEach(el => el.classList.remove('active'));
                opt.classList.add('active');
                document.getElementById(hiddenInputId).value = color;
                if (hexInput) hexInput.value = color.toUpperCase();
            };
            container.appendChild(opt);
        });

        const customOpt = document.createElement('div');
        customOpt.className = 'color-option custom-picker-btn' + (customColor && activeColor.toLowerCase() === customColor.toLowerCase() ? ' active' : '');
        customOpt.style.position = 'relative';
        if (customColor) {
            customOpt.style.background = customColor;
        } else {
            customOpt.style.background = 'linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet)';
        }
        customOpt.style.display = 'flex';
        customOpt.style.alignItems = 'center';
        customOpt.style.justifyContent = 'center';
        customOpt.innerHTML = '<i class="fa-solid fa-plus" style="font-size: 12px; color: #fff; pointer-events: none;"></i>';
        
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.style.position = 'absolute';
        colorInput.style.opacity = '0';
        colorInput.style.width = '100%';
        colorInput.style.height = '100%';
        colorInput.style.cursor = 'pointer';
        colorInput.value = activeColor.startsWith('#') && activeColor.length === 7 ? activeColor : '#ffffff';
        
        colorInput.oninput = (e) => {
            const customVal = e.target.value;
            document.getElementById(hiddenInputId).value = customVal;
            if (hexInput) hexInput.value = customVal.toUpperCase();
            customOpt.style.background = customVal;
            container.querySelectorAll('.color-option').forEach(el => {
                if (el !== customOpt) el.classList.remove('active');
            });
            customOpt.classList.add('active');
        };

        colorInput.onchange = (e) => {
            const customVal = e.target.value;
            renderColorPicker(containerId, hiddenInputId, hexInputId, customVal, imageUrl, customVal);
        };

        customOpt.appendChild(colorInput);
        container.appendChild(customOpt);
    };

    if (imageUrl) {
        sampleColorsFromImage(imageUrl).then(sampled => {
            render([...sampled, ...defaultColors]);
        });
    } else {
        render(defaultColors);
    }
}

async function sampleColorsFromImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50; canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            const colorCounts = {};
            for (let i = 0; i < data.length; i += 20) { 
                const r = data[i], g = data[i+1], b = data[i+2];
                const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
                colorCounts[hex] = (colorCounts[hex] || 0) + 1;
            }
            const sorted = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
            resolve(sorted.slice(0, 5).map(e => e[0]));
        };
        img.onerror = () => resolve([]);
    });
}

window.removeCreatePlaylistArt = function() {
    const artPreview = document.getElementById('createPlaylistArtPreview');
    const artPlaceholder = document.getElementById('createPlaylistArtPlaceholder');
    const removeBtn = document.getElementById('removeCreateArtBtn');
    if (artPreview) {
        artPreview.src = '';
        artPreview.style.display = 'none';
    }
    if (artPlaceholder) artPlaceholder.style.display = 'flex';
    if (removeBtn) removeBtn.classList.remove('show');
    renderColorPicker('createPlaylistColorPicker', 'createPlaylistColor', 'createPlaylistColorHex', document.getElementById('createPlaylistColor').value, null);
};

window.removePlaylistArt = function() {
    const artPreview = document.getElementById('editPlaylistArtPreview');
    const artPlaceholder = document.getElementById('editPlaylistArtPlaceholder');
    const removeBtn = document.getElementById('removeArtBtn');
    artPreview.src = '';
    artPreview.style.display = 'none';
    artPlaceholder.style.display = 'flex';
    removeBtn.classList.remove('show');
    renderColorPicker('editPlaylistColorPicker', 'editPlaylistColor', 'editPlaylistColorHex', document.getElementById('editPlaylistColor').value, null);
};
function showAddToPlaylistModal(track) {
    if (!track) track = currentTrack;
    if (!track) {
        showToast('Select a track first', 'info');
        return;
    }
    const modal = document.getElementById('addToPlaylistModal');
    const list = document.getElementById('playlistSelectionList');
    if (!modal || !list) return;
    list.innerHTML = '';
    if (playlists.length === 0) {
        list.innerHTML = '<div class="py-4 text-center text-gray-500">No playlists found. Create one first!</div>';
    } else {
        playlists.forEach(pl => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.style.marginBottom = '8px';
            item.innerHTML = `
                <div class="pl-img" style="${pl.color ? `background: linear-gradient(135deg, ${pl.color}, var(--bg-highlight));` : ''} width: 40px; height: 40px; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    ${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class="fas fa-list" style="color: #666;"></i>`}
                </div>
                <div class="pl-info" style="flex: 1; min-w: 0;">
                    <div class="pl-name" style="font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(pl.name)}</div>
                </div>
            `;
            item.onclick = () => addTrackToPlaylist(track, pl.id);
            list.appendChild(item);
        });
    }
    modal.style.display = 'flex';
}
function hideAddToPlaylistModal() {
    document.getElementById('addToPlaylistModal').style.display = 'none';
}
async function addTrackToPlaylist(track, playlistId) {
    const plIndex = playlists.findIndex(p => p.id.toString() === playlistId.toString());
    if (plIndex > -1) {
        const trackUid = getTrackUid(track);
        if (playlists[plIndex].tracks.some(t => getTrackUid(t) === trackUid)) {
            showToast('Already in playlist', 'info');
            hideAddToPlaylistModal();
            return;
        }

        const trackToSave = JSON.parse(JSON.stringify(track));
        trackToSave.stable_id = trackUid;
        
        let durationSec = 0;
        if (trackToSave.duration) durationSec = trackToSave.duration > 10000 ? trackToSave.duration / 1000 : trackToSave.duration;
        else if (trackToSave.duration_seconds) durationSec = trackToSave.duration_seconds;
        trackToSave.duration = durationSec;

        playlists[plIndex].tracks.push(trackToSave);
        await saveLibraryData();
        renderLibrary();
        
        if (document.getElementById('dynamicView').classList.contains('active')) {
            const currentHeader = document.querySelector('.artist-header');
            if (currentHeader && currentHeader.textContent === playlists[plIndex].name) {
                loadPlaylistView(playlistId);
            }
        }
        showToast('Added to playlist', 'success');
    }
    hideAddToPlaylistModal();
}
let cropperImage = null;
let cropState = { x: 0, y: 0, radius: 100 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
function initCropper() {
    const cropperCanvas = document.getElementById('cropperCanvas');
    if (!cropperCanvas) return;
    const ctx = cropperCanvas.getContext('2d');
    const drawCropper = () => {
        if (!cropperImage) return;
        const w = cropperCanvas.width;
        const h = cropperCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(cropperImage, 0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        const r = cropState.radius;
        const size = r * 2;
        const cornerRadius = size * 0.15;
        if (ctx.roundRect) ctx.roundRect(cropState.x - r, cropState.y - r, size, size, cornerRadius);
        else ctx.rect(cropState.x - r, cropState.y - r, size, size);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cropState.x - r, cropState.y - r, size, size, cornerRadius);
        else ctx.rect(cropState.x - r, cropState.y - r, size, size);
        ctx.stroke();
        ctx.setLineDash([]);
    };
    const handleStart = (x, y) => {
        const r = cropState.radius;
        if (x >= cropState.x - r && x <= cropState.x + r && y >= cropState.y - r && y <= cropState.y + r) {
            isDragging = true;
            dragStart = { x, y };
        }
    };
    const handleMove = (x, y) => {
        if (isDragging) {
            const dx = x - dragStart.x;
            const dy = y - dragStart.y;
            let newX = cropState.x + dx;
            let newY = cropState.y + dy;
            const r = cropState.radius;
            const w = cropperCanvas.width;
            const h = cropperCanvas.height;
            newX = Math.max(r, Math.min(newX, w - r));
            newY = Math.max(r, Math.min(newY, h - r));
            cropState.x = newX;
            cropState.y = newY;
            dragStart = { x, y };
            requestAnimationFrame(drawCropper);
        }
    };
    const handleEnd = () => { isDragging = false; };
    const handleScroll = (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -5 : 5;
        let newRadius = cropState.radius + delta;
        const w = cropperCanvas.width, h = cropperCanvas.height;
        const maxPossibleRadius = Math.min(w, h) / 2;
        newRadius = Math.max(20, Math.min(newRadius, maxPossibleRadius));
        const minX = newRadius, maxX = w - newRadius, minY = newRadius, maxY = h - newRadius;
        cropState.x = Math.max(minX, Math.min(cropState.x, maxX));
        cropState.y = Math.max(minY, Math.min(cropState.y, maxY));
        cropState.radius = newRadius;
        requestAnimationFrame(drawCropper);
    };
    cropperCanvas.addEventListener('mousedown', e => handleStart(e.offsetX, e.offsetY));
    cropperCanvas.addEventListener('mousemove', e => handleMove(e.offsetX, e.offsetY));
    cropperCanvas.addEventListener('mouseup', handleEnd);
    cropperCanvas.addEventListener('mouseleave', handleEnd);
    cropperCanvas.addEventListener('wheel', handleScroll);
    document.getElementById('playlistCoverInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            cropperImage = new Image();
            cropperImage.onload = () => {
                const fixedHeight = 400;
                const scale = fixedHeight / cropperImage.height;
                cropperCanvas.height = fixedHeight;
                cropperCanvas.width = cropperImage.width * scale;
                cropState = {
                    x: cropperCanvas.width / 2,
                    y: cropperCanvas.height / 2,
                    radius: Math.min(cropperCanvas.width, cropperCanvas.height) / 3
                };
                document.getElementById('cropperModal').style.display = 'flex';
                requestAnimationFrame(drawCropper);
            };
            cropperImage.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('cancelCropBtn').addEventListener('click', () => {
        document.getElementById('cropperModal').style.display = 'none';
        document.getElementById('playlistCoverInput').value = '';
    });

    document.getElementById('submitCropBtn').addEventListener('click', async () => {
        const tempCanvas = document.createElement('canvas');
        const size = 512;
        tempCanvas.width = size;
        tempCanvas.height = size;
        const tCtx = tempCanvas.getContext('2d');
        const scale = cropperCanvas.height / cropperImage.height;
        const sourceX = (cropState.x - cropState.radius) / scale;
        const sourceY = (cropState.y - cropState.radius) / scale;
        const sourceSize = (cropState.radius * 2) / scale;
        tCtx.drawImage(cropperImage, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        const base64 = tempCanvas.toDataURL('image/jpeg', 0.8);
        
        const id = document.getElementById('uploadPlaylistId').value;
        if (id) {
            const pl = playlists.find(p => p.id.toString() === id.toString());
            if (pl) {
                updatePlaylist(pl.id, pl.name, pl.description, base64, pl.color);
            }
            document.getElementById('uploadPlaylistId').value = '';
        } else {
            const createModal = document.getElementById('createPlaylistModal');
            if (createModal && createModal.style.display === 'flex') {
                const artPreview = document.getElementById('createPlaylistArtPreview');
                const artPlaceholder = document.getElementById('createPlaylistArtPlaceholder');
                const removeBtn = document.getElementById('removeCreateArtBtn');
                if (artPreview) {
                    artPreview.src = base64;
                    artPreview.style.display = 'block';
                    if (artPlaceholder) artPlaceholder.style.display = 'none';
                    if (removeBtn) removeBtn.classList.add('show');
                    renderColorPicker('createPlaylistColorPicker', 'createPlaylistColor', 'createPlaylistColorHex', document.getElementById('createPlaylistColor').value, base64);
                }
            } else {
                const artPreview = document.getElementById('editPlaylistArtPreview');
                const artPlaceholder = document.getElementById('editPlaylistArtPlaceholder');
                const removeBtn = document.getElementById('removeArtBtn');
                
                if (artPreview) {
                    artPreview.src = base64;
                    artPreview.style.display = 'block';
                    if (artPlaceholder) artPlaceholder.style.display = 'none';
                    if (removeBtn) removeBtn.classList.add('show');
                    renderColorPicker('editPlaylistColorPicker', 'editPlaylistColor', 'editPlaylistColorHex', document.getElementById('editPlaylistColor').value, base64);
                }
            }
        }

        document.getElementById('cropperModal').style.display = 'none';
        document.getElementById('playlistCoverInput').value = '';
    });
}
function showPlaylistCoverUploadModal(id) {
    document.getElementById('uploadPlaylistId').value = id;
    document.getElementById('playlistCoverInput').click();
}
function startProgressUpdate() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (activeSource === 'youtube' && player && typeof player.getCurrentTime === 'function') {
            const current = player.getCurrentTime();
            let total = (typeof player.getDuration === 'function') ? player.getDuration() : 0;
            if (!total || total <= 0) {
                if (currentTrack && currentTrack.duration) {
                    total = currentTrack.duration > 10000 ? currentTrack.duration / 1000 : currentTrack.duration;
                }
            }
            if (total > 0) {
                const percent = Math.min(100, Math.max(0, (current / total) * 100));
                document.getElementById('progressBarFill').style.width = percent + '%';
                document.getElementById('currentTimeLabel').textContent = formatTime(current);
                document.getElementById('durationLabel').textContent = formatTime(total);
                const fsBar = document.getElementById('fsProgressBarFill'); if (fsBar) fsBar.style.width = percent + '%';
                const fsCurrent = document.getElementById('fsCurrentTime'); if (fsCurrent) fsCurrent.textContent = formatTime(current);
                const fsDuration = document.getElementById('fsDuration'); if (fsDuration) fsDuration.textContent = formatTime(total);
                saveTrackDuration(currentTrack, total);
                updateLyricsSync(current);
            } else if (current > 0) {
                document.getElementById('currentTimeLabel').textContent = formatTime(current);
                const fsCurrent = document.getElementById('fsCurrentTime'); if (fsCurrent) fsCurrent.textContent = formatTime(current);
                updateLyricsSync(current);
            }
        } else if (activeSource === 'audio') {
            const audio = document.getElementById('nativeAudio');
            if (audio) updateLyricsSync(audio.currentTime);
        }
    }, 250);
}
function stopProgressUpdate() { clearInterval(progressInterval); }
function updateVolumeUI() { const bar = document.getElementById('volumeBarFill'); if (bar) bar.style.width = volume + '%'; const slider = document.getElementById('volumeSlider'); if (slider) slider.value = volume; }
let parsedLyrics = [];
function parseLyrics(lyricsText, duration) {
    const lines = lyricsText.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/;
    const wordTimeRegex = /<(\d+):(\d+)(?:\.(\d+))?>/g;
    
    let hasTimestamps = false;
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const match = timeRegex.exec(line);
        if (match) {
            hasTimestamps = true;
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = match[3] ? parseFloat('0.' + match[3]) : 0;
            const time = minutes * 60 + seconds + ms;
            
            let text = line.replace(timeRegex, '').trim();
            
            const words = [];
            let lastIdx = 0;
            let wordMatch;
            while ((wordMatch = wordTimeRegex.exec(text)) !== null) {
                const wordText = text.substring(lastIdx, wordMatch.index).trim();
                if (wordText) {
                    const wMin = parseInt(wordMatch[1]);
                    const wSec = parseInt(wordMatch[2]);
                    const wMs = wordMatch[3] ? parseFloat('0.' + wordMatch[3]) : 0;
                    words.push({ text: wordText, time: wMin * 60 + wSec + wMs });
                }
                lastIdx = wordTimeRegex.lastIndex;
            }
            const remainingText = text.substring(lastIdx).trim();
            if (remainingText) words.push({ text: remainingText, time: time + 5 }); 

            const cleanText = text.replace(wordTimeRegex, ' ').replace(/\s+/g, ' ').trim();
            
            parsed.push({ time, text: cleanText, words: words.length > 0 ? words : null });
        } else {
            parsed.push({ time: null, text: line, words: null });
        }
    }

    let validTimestampsCount = 0;
    parsed.forEach(p => {
        if (p.time !== null && !isNaN(p.time) && p.time >= 0) validTimestampsCount++;
    });

    let isChronological = true;
    let lastValidTime = -1;
    for (const p of parsed) {
        if (p.time !== null && !isNaN(p.time)) {
            if (p.time < lastValidTime) {
                isChronological = false;
                break;
            }
            lastValidTime = p.time;
        }
    }

    const isValidTimed = hasTimestamps && isChronological && (validTimestampsCount >= Math.max(1, parsed.length * 0.4));

    if (!isValidTimed) {
        return parsed.map(p => ({
            time: null,
            endTime: null,
            text: p.text,
            words: null,
            type: 'line'
        }));
    }

    const finalParsed = [];
    
    if (parsed.length > 0 && parsed[0].time !== null && parsed[0].time >= 3.0) {
        finalParsed.push({ 
            time: 0, 
            endTime: parsed[0].time,
            type: 'dots', 
            text: '...' 
        });
    }

    for (let i = 0; i < parsed.length; i++) {
        const current = parsed[i];
        const next = parsed[i+1];
        
        let estimatedEnd = current.time !== null ? current.time + 3.5 : null;
        if (next && next.time !== null) {
            current.endTime = next.time;
        } else if (duration) {
            current.endTime = duration;
        } else if (current.time !== null) {
            current.endTime = current.time + 5;
        }

        finalParsed.push(current);

        if (current.time !== null && next && next.time !== null) {
            const rawGap = next.time - current.time;
            const approxLineDuration = current.words ? Math.max(2.5, current.words.length * 0.4) : 3.0;
            const interludeStart = current.time + approxLineDuration;
            const interludeDuration = next.time - interludeStart;

            if (rawGap >= 6.0 && interludeDuration >= 2.0) {
                finalParsed.push({ 
                    time: interludeStart, 
                    endTime: next.time,
                    type: 'dots', 
                    text: '...' 
                });
            }
        }
    }
    return finalParsed;
}
function updateLyricsSync(currentTime) {
    if (!parsedLyrics || parsedLyrics.length === 0) return;
    
    let adjustedTime = currentTime + 0.35;
    
    if (vocalDetectedTime && parsedLyrics.length > 0) {
        const firstLyric = parsedLyrics.find(l => l.type !== 'dots');
        if (firstLyric && Math.abs(vocalDetectedTime - firstLyric.time) < 2.5) {
            const drift = vocalDetectedTime - firstLyric.time;
            
            if (Math.abs(drift) > 0.05) {
                adjustedTime -= (drift * 0.4); 
            }
        }
    }
    
    let activeIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (adjustedTime >= parsedLyrics[i].time && adjustedTime < (parsedLyrics[i].endTime || Infinity)) {
            activeIndex = i;
            break;
        }
    }

    const updateUI = (container, isVisible) => {
        if (!container) return;
        const lines = container.querySelectorAll('.lyric-line');
        let activeLineEl = null;
        lines.forEach((line, index) => {
            if (index === activeIndex) {
                activeLineEl = line;
                line.classList.add('active');
                line.classList.remove('next-up');

                const currentLine = parsedLyrics[index];
                const startTime = currentLine.time;
                const endTime = currentLine.endTime;
                const lineDuration = Math.max(0.1, endTime - startTime);
                const progress = Math.min(100, Math.max(0, ((adjustedTime - startTime) / lineDuration) * 100));
                
                line.style.setProperty('--lyric-progress', `${progress}%`);

                if (currentLine.words) {
                    const wordEls = line.querySelectorAll('.word');
                    currentLine.words.forEach((word, wIdx) => {
                        if (adjustedTime >= word.time) {
                            if (wordEls[wIdx]) wordEls[wIdx].classList.add('highlight');
                        } else {
                            if (wordEls[wIdx]) wordEls[wIdx].classList.remove('highlight');
                        }
                    });
                }

                const dots = line.querySelector('.lyric-dots');
                if (dots) {
                    dots.classList.add('active');
                    const dotEls = dots.querySelectorAll('.lyric-dot');
                    const dotProgress = Math.min(1, Math.max(0, (adjustedTime - startTime) / lineDuration));
                    
                    dotEls.forEach((dot, i) => {
                        const slotStart = i * (1 / 3);
                        const slotEnd = (i + 1) * (1 / 3);
                        const animDuration = (1 / 3) * 0.35;
                        const animStart = slotEnd - animDuration;
                        
                        let scale = 1.0;
                        if (dotProgress >= animStart) {
                            const p = Math.min(1, (dotProgress - animStart) / animDuration);
                            const smoothP = p * p * (3 - 2 * p);
                            scale = 1.0 + (smoothP * 0.45);
                        }
                        
                        dot.style.setProperty('--dot-scale', scale.toFixed(3));
                        if (dotProgress >= animStart + (animDuration * 0.3)) {
                            dot.classList.add('highlight');
                        } else {
                            dot.classList.remove('highlight');
                        }
                    });
                }
            } else {
                line.classList.remove('active');
                line.style.setProperty('--lyric-progress', '0%');
                if (index === activeIndex + 1) {
                    line.classList.add('next-up');
                } else {
                    line.classList.remove('next-up');
                }
                const dots = line.querySelector('.lyric-dots');
                if (dots) {
                    dots.classList.remove('active');
                    const dotEls = dots.querySelectorAll('.lyric-dot');
                    dotEls.forEach(dot => {
                        dot.style.removeProperty('--dot-scale');
                        dot.classList.remove('highlight');
                    });
                }
            }
        });

        if (isVisible && activeLineEl && container._lastActiveIndex !== activeIndex) {
            container._lastActiveIndex = activeIndex;
            const targetScrollTop = activeLineEl.offsetTop - (container.clientHeight / 2) + (activeLineEl.offsetHeight / 2);
            const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
            const boundedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
            container.scrollTo({ top: boundedScrollTop, behavior: 'smooth' });
        }
    };

    const panelContent = document.getElementById('panelContent');
    const isLyricsPanel = currentPanel === 'lyrics';
    updateUI(panelContent, isLyricsPanel);

    const fsPlayer = document.getElementById('fsPlayer');
    const isFsVisible = fsPlayer && fsPlayer.classList.contains('active');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    updateUI(fsLyrics, isFsVisible);
}
function seekToLyrics(time) {
    if (time === null || time === undefined) return;
    const panelContent = document.getElementById('panelContent');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    if (panelContent) panelContent._lastActiveIndex = -1;
    if (fsLyrics) fsLyrics._lastActiveIndex = -1;
    if (activeSource === 'audio') {
        const audio = document.getElementById('nativeAudio');
        if (audio) {
            audio.currentTime = time;
            updateLyricsSync(time);
        }
    } else if (player && typeof player.seekTo === 'function') {
        player.seekTo(time);
        updateLyricsSync(time);
    }
}
function calibrateLyrics(e, index) {
    e.preventDefault();
    if (!currentTrack || !parsedLyrics || parsedLyrics.length === 0) return;
    
    const audio = document.getElementById('nativeAudio');
    let currentTime = 0;
    if (activeSource === 'audio' && audio) {
        currentTime = audio.currentTime;
    } else if (player && typeof player.getCurrentTime === 'function') {
        currentTime = player.getCurrentTime();
    }
    
    if (currentTime <= 0) return;

    const targetTime = currentTime;
    const originalTime = parsedLyrics[index].time;
    const offset = targetTime - originalTime;

    const trackId = getTrackUid(currentTrack);
    const calibrationData = JSON.parse(localStorage.getItem('velium_lyric_calibration') || '{}');
    calibrationData[trackId] = offset;
    localStorage.setItem('velium_lyric_calibration', JSON.stringify(calibrationData));

    showToast(`Lyrics calibrated! Offset: ${offset > 0 ? '+' : ''}${offset.toFixed(2)}s`, 'success');
    
    parsedLyrics.forEach(l => {
        if (l.time !== null) l.time += offset;
        if (l.endTime !== null) l.endTime += offset;
    });
}
window.calibrateLyrics = calibrateLyrics;

function adjustLyricsFontSize() {
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    if (!fsLyrics) return;
    const lines = fsLyrics.querySelectorAll('.lyric-line');
    if (lines.length === 0) return;

    fsLyrics.style.setProperty('--lyric-font-size', '32px');
    lines.forEach(line => {
        line.style.fontSize = '32px';
        line.style.whiteSpace = 'normal';
        line.style.wordBreak = 'break-word';
    });
}

window.addEventListener('resize', adjustLyricsFontSize);

async function fetchLyrics() {
    const panelContent = document.getElementById('panelContent');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    if (!currentTrack) {
        if (panelContent) panelContent.innerHTML = '<div class="py-10 text-center">No track playing</div>';
        return;
    }

    const playingWhenStarted = getTrackUid(currentTrack);
    
    if (currentTrack.lyrics) {
        renderLyricsToUI(currentTrack.lyrics, playingWhenStarted);
        return;
    }

    const loadingHtml = '<div class="py-10 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = loadingHtml;
    if (fsLyrics) fsLyrics.innerHTML = loadingHtml;

    try {
        let lyricsText = null;
        let id = currentTrack.youtube_id || currentTrack.videoId || currentTrack.id || 'track';
        if (typeof id === 'string' && id.startsWith('ytm-')) id = id.replace('ytm-', '');

        const trackName = currentTrack.title || '';
        const artistName = currentTrack.artist_name || currentTrack.artist || '';
        let durationSec = 0;
        if (currentTrack.duration) {
            durationSec = currentTrack.duration > 1000 ? currentTrack.duration / 1000 : currentTrack.duration;
        }

        if (getTrackUid(currentTrack) !== playingWhenStarted) return;

        const response = await fetch(`${API_BASE_URL}?endpoint=lyrics&id=${encodeURIComponent(id)}&title=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&duration=${Math.round(durationSec)}`);
        if (getTrackUid(currentTrack) !== playingWhenStarted) return;

        if (response.ok) {
            const data = await response.json();
            lyricsText = data.lyrics;
            if (lyricsText && currentTrack && getTrackUid(currentTrack) === playingWhenStarted) {
                currentTrack.lyrics = lyricsText;
                saveLibraryData(); 
            }
        }
        renderLyricsToUI(lyricsText, playingWhenStarted);
    } catch (e) {
        renderLyricsToUI(null, playingWhenStarted);
    }
}

function renderLyricsToUI(lyricsText, playingWhenStarted) {
    const panelContent = document.getElementById('panelContent');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    const fsMain = document.querySelector('.fs-main');

    if (getTrackUid(currentTrack) !== playingWhenStarted) return;

    if (lyricsText && lyricsText.trim()) {
        let duration = currentTrack.duration || 0;
        if (!duration) {
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio) duration = audio.duration;
            } else if (player && typeof player.getDuration === 'function') {
                duration = player.getDuration();
            }
        }
        parsedLyrics = parseLyrics(lyricsText, duration);

        if (!parsedLyrics || parsedLyrics.length === 0) {
            if (fsMain) fsMain.classList.add('no-lyrics');
            parsedLyrics = [];
            const html = '<div class="py-10 text-center" style="opacity: 0.5;">No lyrics found for this track.</div>';
            if (panelContent && currentPanel === 'lyrics') {
                panelContent.innerHTML = html;
                closePanel();
                showToast('No lyrics found for this track', 'info');
            }
            if (fsLyrics) fsLyrics.innerHTML = '';
            return;
        }

        if (fsMain) fsMain.classList.remove('no-lyrics');
        
        const trackId = getTrackUid(currentTrack);
        const calibrationData = JSON.parse(localStorage.getItem('velium_lyric_calibration') || '{}');
        const savedOffset = calibrationData[trackId] || 0;
        if (savedOffset !== 0) {
            parsedLyrics.forEach(l => {
                if (l.time !== null) l.time += savedOffset;
                if (l.endTime !== null) l.endTime += savedOffset;
            });
        }

        const html = parsedLyrics.map((line, idx) => {
            if (line.type === 'dots') {
                const contextAttr = (line.time !== null) ? `oncontextmenu="calibrateLyrics(event, ${idx})"` : '';
                return `<div class="lyric-line dots-line" onclick="seekToLyrics(${line.time})" ${contextAttr}>
                    <div class="lyric-dots">
                        <div class="lyric-dot"></div>
                        <div class="lyric-dot"></div>
                        <div class="lyric-dot"></div>
                    </div>
                </div>`;
            }
            
            const contextAttr = (line.time !== null) ? `oncontextmenu="calibrateLyrics(event, ${idx})"` : '';
            const untimedClass = (line.time === null || line.time === undefined) ? 'untimed' : '';
            
            let lineHtml = '';
            if (line.words) {
                lineHtml = line.words.map(w => `<span class="word">${escapeHtml(w.text)}</span>`).join('');
            } else {
                lineHtml = escapeHtml(line.text);
            }

            if (line.time !== null && line.time !== undefined) {
                return `<div class="lyric-line ${untimedClass}" onclick="seekToLyrics(${line.time})" ${contextAttr}>${lineHtml}</div>`;
            } else {
                return `<div class="lyric-line ${untimedClass}" ${contextAttr}>${lineHtml}</div>`;
            }
        }).join('');
        if (panelContent && currentPanel === 'lyrics') {
            panelContent.innerHTML = html;
            panelContent._lastActiveIndex = -1;
        }
        if (fsLyrics) {
            fsLyrics.innerHTML = html;
            fsLyrics._lastActiveIndex = -1;
            setTimeout(adjustLyricsFontSize, 50);
        }
    } else {
        if (fsMain) fsMain.classList.add('no-lyrics');
        parsedLyrics = [];
        const html = '<div class="py-10 text-center" style="opacity: 0.5;">No lyrics found for this track.</div>';
        if (panelContent && currentPanel === 'lyrics') {
            panelContent.innerHTML = html;
            closePanel();
            showToast('No lyrics found for this track', 'info');
        }
        if (fsLyrics) fsLyrics.innerHTML = '';
    }
}
function renderQueue() {
    const panelContent = document.getElementById('panelContent');
    if (!panelContent) return;
    if (!currentTrack) {
        panelContent.innerHTML = '<div class="py-10 text-center">No track playing</div>';
        return;
    }
    let html = `
        <div style="font-weight: 700; margin-bottom: 12px; color: var(--text-main); font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6;">Now Playing</div>
        <div class="queue-item" style="border: none; margin-bottom: 24px; background: var(--bg-highlight); padding: 12px; border-radius: 8px;">
            <img src="${currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url)}" class="q-art" style="width: 48px; height: 48px; border-radius: 4px; object-fit: cover;">
            <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 12px;">
                <span style="font-weight: 700; color: var(--text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(currentTrack.title)}</span>
                <span style="font-size: 12px; color: var(--text-subdued); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(currentTrack.artist_name)}</span>
            </div>
        </div>
        <div style="font-weight: 700; margin-bottom: 12px; color: var(--text-main); font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6;">Next In Queue</div>
    `;
    const upcoming = [];
    const maxItems = 15;
    let count = 0;
    if (isShuffle) {
        for (let i = shuffledCurrentIndex + 1; i < shuffledIndices.length && count < maxItems; i++) {
            upcoming.push(playlist[shuffledIndices[i]]);
            count++;
        }
    } else {
        for (let i = currentIndex + 1; i < playlist.length && count < maxItems; i++) {
            upcoming.push(playlist[i]);
            count++;
        }
    }
    if (upcoming.length === 0) {
        html += '<div class="py-4 text-center" style="font-size: 12px; opacity: 0.5;">Queue is empty.</div>';
    } else {
        upcoming.forEach((track) => {
            html += `
                <div class="queue-item" style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--divider);">
                    <img src="${track.local_artwork || getProxyUrl(track.artwork_url)}" class="q-art" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">
                    <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 12px;">
                        <span style="font-weight: 700; color: var(--text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(track.title)}</span>
                        <span style="font-size: 12px; color: var(--text-subdued); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(track.artist_name)}</span>
                    </div>
                </div>
            `;
        });
    }
    panelContent.innerHTML = html;
}
let currentPanel = null;
window.currentPanel = null;
function togglePanel(type) {
    const body = document.body;
    const panelTitle = document.getElementById('panelTitle');
    const btnLyrics = document.getElementById('btnLyrics');
    const btnQueue = document.getElementById('btnQueue');
    if (currentPanel === type) {
        closePanel();
        return;
    }
    
    currentPanel = type;
    window.currentPanel = type;

    if (btnLyrics) btnLyrics.classList.remove('active');
    if (btnQueue) btnQueue.classList.remove('active');
    
    if (type === 'lyrics') {
        if (panelTitle) panelTitle.innerText = "Lyrics";
        if (btnLyrics) btnLyrics.classList.add('active');
        fetchLyrics();
    } else if (type === 'queue') {
        if (panelTitle) panelTitle.innerText = "Next Up";
        if (btnQueue) btnQueue.classList.add('active');
        renderQueue();
    }
    body.classList.add('panel-active');
}
function closePanel() {
    const body = document.body;
    const btnLyrics = document.getElementById('btnLyrics');
    const btnQueue = document.getElementById('btnQueue');
    body.classList.remove('panel-active');
    currentPanel = null;
    window.currentPanel = null;
    if (btnLyrics) btnLyrics.classList.remove('active');
    if (btnQueue) btnQueue.classList.remove('active');
}
window.togglePanel = togglePanel;
window.closePanel = closePanel;
window.switchView = switchView;
window.showCreatePlaylistModal = showCreatePlaylistModal;
window.hideCreatePlaylistModal = hideCreatePlaylistModal;
window.showPlaylistCoverUploadModal = showPlaylistCoverUploadModal;
window.showEditPlaylistModal = showEditPlaylistModal;
window.confirmEditPlaylist = confirmEditPlaylist;
window.deletePlaylist = deletePlaylist;
window.playAllFromDynamic = playAllFromDynamic;
window.playAllFavorites = playAllFavorites;
window.toggleLike = toggleLike;
window.toggleShuffle = toggleShuffle;
window.playPrev = playPrev;
window.togglePlayPause = togglePlayPause;
window.playNext = playNext;
window.cycleRepeat = cycleRepeat;
window.seekToLyrics = seekToLyrics;

let openedTOSFromInfo = false;
function showInfoModal() {
    document.getElementById('infoModal').style.display = 'flex';
}
function hideInfoModal() {
    document.getElementById('infoModal').style.display = 'none';
}
function showTOSModal(fromInfo = false) {
    openedTOSFromInfo = fromInfo;
    document.getElementById('infoModal').style.display = 'none';
    document.getElementById('tosModal').style.display = 'flex';
}
function hideTOSModal() {
    document.getElementById('tosModal').style.display = 'none';
    if (openedTOSFromInfo) {
        document.getElementById('infoModal').style.display = 'flex';
        openedTOSFromInfo = false;
    }
}
window.showInfoModal = showInfoModal;
window.hideInfoModal = hideInfoModal;
window.showTOSModal = showTOSModal;
window.hideTOSModal = hideTOSModal;
window.setSourceFilter = setSourceFilter;
window.applyEqPreset = applyEqPreset;
window.setEqGain = setEqGain;
window.resetEqualizer = resetEqualizer;
window.loadArtistView = loadArtistView;
window.loadPlaylistView = loadPlaylistView;

document.addEventListener('click', (e) => {
    const link = e.target.closest('.artist-link');
    if (link) {
        const artist = link.getAttribute('data-artist') || link.textContent.trim();
        if (artist) {
            e.stopPropagation();
            e.preventDefault();
            loadArtistView(artist);
        }
    }
}, true);