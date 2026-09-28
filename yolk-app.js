// yolk-app.js

const API_BASE = '/api/music-api';
let favorites = JSON.parse(localStorage.getItem('yolk_favorites') || '[]');
let pins = JSON.parse(localStorage.getItem('yolk_pins') || '[]');
let currentAudio = new Audio();
let isPlaying = false;
let currentTrack = null;
let searchOffset = 0;
let isLoadingMore = false;
let currentSearchQuery = '';

// Inject dynamic styles that don't mess with user's core CSS
const style = document.createElement('style');
style.innerHTML = `
    .bubbly-hover {
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
    }
    .bubbly-hover:hover {
        transform: scale(1.03) !important;
    }
    
    #loading-spinner-container {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 50;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.5s ease;
    }
    #loading-spinner-container.active {
        opacity: 1;
    }
    .parabola-spin {
        width: 40px;
        height: 40px;
        border: 3px solid transparent;
        border-top-color: #FDE047;
        border-right-color: #FDE047;
        border-radius: 50%;
        animation: spin-parabola 1.5s cubic-bezier(0.16, 1, 0.3, 1) infinite; /* Fast to slow parabola */
    }
    
    @keyframes spin-parabola {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    .hidden-force {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translate(-50%, 150%) !important;
    }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const bottomPlayer = document.getElementById('bottom-player');
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const libraryGrid = document.querySelector('#page-library .grid');

    // Loading spinner
    const spinnerContainer = document.createElement('div');
    spinnerContainer.id = 'loading-spinner-container';
    const spinner = document.createElement('div');
    spinner.className = 'parabola-spin';
    spinnerContainer.appendChild(spinner);
    document.body.appendChild(spinnerContainer);

    // Hide bottom player initially as requested
    bottomPlayer.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
            window.location.hash = '#now-playing';
        }
    });
    bottomPlayer.classList.add('hidden-force');

    // Add bubbly hover to all buttons and interactive elements
    document.querySelectorAll('button, a, .group.cursor-pointer').forEach(el => {
        el.classList.add('bubbly-hover');
    });

    // Search Logic
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.length > 0) {
            document.body.classList.add('is-searching');
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                currentSearchQuery = val;
                searchOffset = 0;
                performSearch(val, true);
            }, 500);
        } else {
            document.body.classList.remove('is-searching');
            searchResults.innerHTML = '<div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest text-left w-full mb-1 pl-5">Top Results</div>';
        }
    });

    // Infinite Scroll
    document.getElementById('page-search').addEventListener('scroll', (e) => {
        const el = e.target;
        if (el.scrollHeight - el.scrollTop <= el.clientHeight + 100) {
            if (!isLoadingMore && currentSearchQuery) {
                searchOffset += 20; // Assuming API returns 20
                performSearch(currentSearchQuery, false);
            }
        }
    });

    async function performSearch(query, clear) {
        isLoadingMore = true;
        if (clear) {
            searchResults.innerHTML = '<div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest text-left w-full mb-1 pl-5">Loading...</div>';
        }
        
        try {
            const res = await fetch(`${API_BASE}?endpoint=search&q=${encodeURIComponent(query)}&limit=20&offset=${searchOffset}`);
            const data = await res.json();
            
            if (clear) {
                searchResults.innerHTML = '<div class="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest text-left w-full mb-1 pl-5">Top Results</div>';
            }
            
            if (data && data.tracks) {
                data.tracks.forEach(track => {
                    const el = createTrackElement(track);
                    searchResults.appendChild(el);
                });
            }
        } catch (e) {
            console.error(e);
            if (clear) searchResults.innerHTML = '<div class="text-xs text-red-400 pl-5">Failed to load results.</div>';
        } finally {
            isLoadingMore = false;
        }
    }

    function createTrackElement(track) {
        const div = document.createElement('div');
        div.className = 'group flex items-center justify-between p-3 rounded-3xl bg-white/80 backdrop-blur-sm border border-zinc-100 hover:border-zinc-200 hover:shadow-md transition-all cursor-pointer bubbly-hover mb-2';
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 bg-zinc-100 rounded-2xl overflow-hidden flex-shrink-0 relative border border-zinc-200/50">
                    ${(track.artwork_url || track.image) ? `<img src="${track.artwork_url || track.image}" class="w-full h-full object-cover">` : ''}
                    <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="ml-0.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </div>
                </div>
                <div class="flex flex-col text-left">
                    <span class="font-medium text-zinc-900 text-sm truncate max-w-[200px]">${track.name || track.title || 'Unknown'}</span>
                    <span class="text-xs text-zinc-500 truncate max-w-[200px]">${track.artist_name || track.artist || 'Unknown'}</span>
                </div>
            </div>
            <button class="favorite-btn text-zinc-300 hover:text-yolk-yellow transition-colors p-2 z-10" data-id="${track.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${isFavorite(track.id) ? '#FDE047' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            </button>
        `;
        
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.favorite-btn')) {
                playTrack(track);
            }
        });
        
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(track, favBtn.querySelector('svg'));
        });
        
        return div;
    }

    // Playback Logic
    async function playTrack(track) {
        // Hide bottom player, show spinner
        bottomPlayer.classList.add('hidden-force');
        spinnerContainer.classList.add('active');
        
        currentTrack = track;
        const resolvedId = track.youtube_id || track.videoId || (track.id ? track.id.replace('ytm-', '') : '');
        const streamUrl = `${API_BASE}?endpoint=stream&id=${encodeURIComponent(resolvedId)}`;
        
        currentAudio.src = streamUrl;
    
    // Fetch lyrics
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer) {
        lyricsContainer.innerHTML = 'Loading lyrics...';
        fetch(`${API_BASE}?endpoint=lyrics&id=${encodeURIComponent(resolvedId)}&title=${encodeURIComponent(track.name || track.title)}&artist=${encodeURIComponent(track.artist_name || track.artist)}`)
            .then(r => r.json())
            .then(data => {
                if (data && data.lyrics) {
                    lyricsContainer.textContent = data.lyrics;
                } else {
                    lyricsContainer.innerHTML = '<i>No lyrics found.</i>';
                }
            })
            .catch(() => {
                lyricsContainer.innerHTML = '';
            });
    }

        currentAudio.load();
        
        currentAudio.oncanplay = () => {
            spinnerContainer.classList.remove('active');
            // Only show bottom player if we aren't on Now Playing
            if (document.body.getAttribute('data-page') !== 'now-playing') {
                bottomPlayer.classList.remove('hidden-force');
            }
            updateBottomPlayerUI(track);
            updateNowPlayingUI(track);
            currentAudio.play();
            isPlaying = true;
        };
        
        currentAudio.onerror = () => {
            spinnerContainer.classList.remove('active');
            alert("Failed to load audio data.");
        };
    }

    function updateBottomPlayerUI(track) {
        const title = bottomPlayer.querySelector('.text-sm.font-semibold');
        const artist = bottomPlayer.querySelector('.player-artist');
        if(title) title.textContent = track.name || track.title;
        if(artist) artist.textContent = track.artist_name || track.artist;
        
        // Update Now Playing Album Art
        const nowPlayingImg = page.querySelector('#now-playing-img');
        const nowPlayingVinyl = page.querySelector('#now-playing-vinyl');
        if (track.artwork_url || track.image) {
            nowPlayingImg.src = track.artwork_url || track.image;
            nowPlayingImg.classList.remove('hidden');
            nowPlayingVinyl.classList.add('hidden');
        } else {
            nowPlayingImg.classList.add('hidden');
            nowPlayingVinyl.classList.remove('hidden');
        }
        
        // Play/Pause button logic
        const playPauseBtn = bottomPlayer.querySelectorAll('button')[1];
        playPauseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
        
        playPauseBtn.onclick = () => {
            if(isPlaying) {
                currentAudio.pause();
                playPauseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="ml-1 transition-transform group-hover:scale-110"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            } else {
                currentAudio.play();
                playPauseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
            }
            isPlaying = !isPlaying;
        };
    }

    function updateNowPlayingUI(track) {
        const page = document.getElementById('page-now-playing');
        const title = page.querySelector('h1');
        const artist = page.querySelector('p');
        if(title) title.textContent = track.name || track.title;
        if(artist) artist.textContent = track.artist_name || track.artist;
        
        // Update Now Playing Album Art
        const nowPlayingImg = page.querySelector('#now-playing-img');
        const nowPlayingVinyl = page.querySelector('#now-playing-vinyl');
        if (track.artwork_url || track.image) {
            nowPlayingImg.src = track.artwork_url || track.image;
            nowPlayingImg.classList.remove('hidden');
            nowPlayingVinyl.classList.add('hidden');
        } else {
            nowPlayingImg.classList.add('hidden');
            nowPlayingVinyl.classList.remove('hidden');
        }
        
        const playPauseBtn = page.querySelectorAll('button')[1];
        playPauseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
        
        playPauseBtn.onclick = () => {
            if(isPlaying) {
                currentAudio.pause();
                playPauseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="ml-1 transition-transform group-hover:scale-110"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
            } else {
                currentAudio.play();
                playPauseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
            }
            isPlaying = !isPlaying;
        };
    }

    // Progress logic
    currentAudio.ontimeupdate = () => {
        const progress = (currentAudio.currentTime / currentAudio.duration) * 100;
        const bars = document.querySelectorAll('.bg-zinc-800'); // the inner progress bar div
        bars.forEach(bar => {
            bar.style.width = `${progress}%`;
        });
    };

    // Favorites Logic
    function isFavorite(id) {
        return favorites.some(f => f.id === id);
    }

    function toggleFavorite(track, svgElement) {
        if (isFavorite(track.id)) {
            favorites = favorites.filter(f => f.id !== track.id);
            svgElement.setAttribute('fill', 'none');
            svgElement.setAttribute('stroke', 'currentColor');
        } else {
            favorites.push(track);
            svgElement.setAttribute('fill', '#FDE047');
            svgElement.setAttribute('stroke', '#FDE047');
        }
        localStorage.setItem('yolk_favorites', JSON.stringify(favorites));
        renderLibrary();
    }

    // Library Logic
    function renderLibrary() {
        if(!libraryGrid) return;
        libraryGrid.innerHTML = '';
        
        // Favorites block
        libraryGrid.innerHTML += `
            <div class="group cursor-pointer bubbly-hover">
                <div class="w-full aspect-square bg-gradient-to-br from-yolk-yellow to-yellow-200 rounded-3xl border border-zinc-200/60 mb-3 relative overflow-hidden flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                </div>
                <h3 class="font-semibold text-sm text-zinc-900">Favorites</h3>
                <p class="text-xs text-zinc-500 mt-1">${favorites.length} tracks</p>
            </div>
        `;
        
        // Custom Playlists & Pins could be mapped here...
        pins.forEach((pin, i) => {
            libraryGrid.innerHTML += `
                <div class="group cursor-pointer bubbly-hover">
                    <div class="w-full aspect-square bg-zinc-100 rounded-3xl border border-zinc-200/60 mb-3 relative overflow-hidden flex items-center justify-center shadow-sm group-hover:shadow-md transition-all">
                        <div class="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px]">
                            <div class="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="ml-1"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            </div>
                        </div>
                    </div>
                    <h3 class="font-semibold text-sm text-zinc-900">${pin.name}</h3>
                    <p class="text-xs text-zinc-500 mt-1">Pinned Playlist</p>
                </div>
            `;
        });
    }
    renderLibrary();
});
