(() => {
	const cd = document.getElementById('cd');
	const cdCaseButton = document.getElementById('cdCaseButton');
	const audio = document.getElementById('audio');
	const trackTitle = document.getElementById('trackTitle');
	const trackArtist = document.getElementById('trackArtist');
	const timeDisplay = document.getElementById('timeDisplay');
	const songList = document.getElementById('songList');
	const prevBtn = document.getElementById('prevBtn');
	const shuffleBtn = document.getElementById('shuffleBtn');
	const playPauseBtn = document.getElementById('playPauseBtn');
	const nextBtn = document.getElementById('nextBtn');
	const playPauseIcon = document.getElementById('playPauseIcon');
	const likeBtn = document.getElementById('likeBtn');
	const likeIcon = document.getElementById('likeIcon');

	if (!cd || !cdCaseButton || !audio || !trackTitle || !trackArtist || !timeDisplay || !songList || !prevBtn || !playPauseBtn || !nextBtn || !playPauseIcon) return;

	const tracks = [
        'Hurricane_V22.mp3',
		'Brothers_V10.mp3',
		'CyHi_Model_V9.mp3',
		'Ever_Bryan.mp3',
		'Last_Name_V9.mp3',
		'New_Body_V19.mp3',
		'Sky_City_V19.mp3',
		'The_Chakra_V9.mp3',
		'The_Garden_V6.mp3',
		'We_Free.mp3',
		'We_Got_Love_V10.mp3',
		'XXX_The_Storm_V15.mp3',
	];

	let currentTrackIndex = 0;
	let shuffleEnabled = false;
	let shuffleOrder = [];
	let shufflePos = 0;

	// Tunables
	const maxOmegaDegPerSec = 5200; // max speed
	const accelTimeSec = 3.5;      // time to reach max speed
	const decelTimeSec = 3.5;      // time to stop from max speed

	const accelDegPerSec2 = maxOmegaDegPerSec / accelTimeSec;
	const decelDegPerSec2 = maxOmegaDegPerSec / decelTimeSec;

	let isPlaying = false;
	let angleDeg = 0;
	let omegaDegPerSec = 0;
	let targetOmegaDegPerSec = 0;

	let rafId = null;
	let lastTs = null;

	const formatTime = (seconds) => {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const s = Math.floor(seconds);
		const m = Math.floor(s / 60);
		const r = s % 60;
		return `${m}:${String(r).padStart(2, '0')}`;
	};

	const updateTimeUI = () => {
		const cur = formatTime(audio.currentTime);
		const dur = formatTime(audio.duration);
		timeDisplay.textContent = `${cur} / ${dur}`;
	};

	const updatePlayIcon = () => {
		playPauseIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
	};

	const formatTitle = (filename) => {
		const withoutExt = filename.replace(/\.mp3$/i, '');
		return withoutExt.replaceAll('_', ' ').trim();
	};

	const LIKED_TRACKS_KEY = 'yandhi_liked_tracks_v1';
	const readLikedTracks = () => {
		try {
			const raw = localStorage.getItem(LIKED_TRACKS_KEY);
			if (!raw) return new Set();
			const arr = JSON.parse(raw);
			if (!Array.isArray(arr)) return new Set();
			return new Set(arr.filter((x) => typeof x === 'string' && x.length));
		} catch {
			return new Set();
		}
	};
	const writeLikedTracks = (set) => {
		try {
			localStorage.setItem(LIKED_TRACKS_KEY, JSON.stringify(Array.from(set)));
		} catch {
			// Ignore storage errors (private mode/quota).
		}
	};

	let likedTracks = readLikedTracks();
	const isLiked = (filename) => likedTracks.has(filename);
	const updateLikeButtonUI = () => {
		if (!likeBtn || !likeIcon) return;
		const file = tracks[currentTrackIndex];
		const liked = !!file && isLiked(file);
		likeBtn.setAttribute('aria-pressed', String(liked));
		likeBtn.setAttribute('aria-label', liked ? 'Song entliken' : 'Song liken');
		likeIcon.className = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
	};
	const updateSongListLikeIndicators = () => {
		const rows = songList.querySelectorAll('.songlist_row[data-file]');
		rows.forEach((row) => {
			const file = row.dataset.file || '';
			row.classList.toggle('songlist_row--liked', isLiked(file));
		});
	};
	const toggleLikeCurrentTrack = () => {
		const file = tracks[currentTrackIndex];
		if (!file) return;
		likedTracks = new Set(likedTracks);
		if (likedTracks.has(file)) {
			likedTracks.delete(file);
		} else {
			likedTracks.add(file);
		}
		writeLikedTracks(likedTracks);
		updateLikeButtonUI();
		updateSongListLikeIndicators();
	};

	const shuffleArrayInPlace = (arr) => {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	};

	const rebuildShuffleOrder = (startIndex) => {
		const rest = tracks
			.map((_, idx) => idx)
			.filter((idx) => idx !== startIndex);
		shuffleArrayInPlace(rest);
		shuffleOrder = [startIndex, ...rest];
		shufflePos = 0;
	};

	const setShuffleEnabled = (enabled) => {
		shuffleEnabled = enabled;
		shuffleBtn?.setAttribute('aria-pressed', String(shuffleEnabled));
		if (shuffleEnabled) {
			rebuildShuffleOrder(currentTrackIndex);
		} else {
			shuffleOrder = [];
			shufflePos = 0;
		}
	};

	let titleRequestId = 0;
	let titleAbortController = null;
	let titleFallbackTimer = null;
	let marqueeUpdateRaf = null;
	let titleMeasureEl = null;
	let currentTitleValue = '\u00A0';

	const getTitleMeasureEl = () => {
		if (titleMeasureEl) return titleMeasureEl;
		titleMeasureEl = document.createElement('span');
		titleMeasureEl.style.position = 'absolute';
		titleMeasureEl.style.left = '-99999px';
		titleMeasureEl.style.top = '0';
		titleMeasureEl.style.visibility = 'hidden';
		titleMeasureEl.style.whiteSpace = 'nowrap';
		titleMeasureEl.style.pointerEvents = 'none';
		document.body.appendChild(titleMeasureEl);
		return titleMeasureEl;
	};

	const disableTitleMarquee = () => {
		trackTitle.classList.remove('track_title--marquee');
		trackTitle.style.removeProperty('--marquee-translate');
		trackTitle.style.removeProperty('--marquee-duration');
		trackTitle.textContent = currentTitleValue;
	};

	const enableTitleMarquee = (textWidth, thresholdPx) => {
		trackTitle.classList.add('track_title--marquee');
		trackTitle.textContent = '';
		const span = document.createElement('span');
		span.className = 'track_title_text';
		span.textContent = currentTitleValue;
		trackTitle.appendChild(span);

		const containerWidth = trackTitle.clientWidth || thresholdPx;
		const gapPx = 24;
		const distancePx = Math.max(0, textWidth - containerWidth + gapPx);
		if (distancePx <= 1) {
			disableTitleMarquee();
			return;
		}

		// Speed: ~55px/s, clamped to keep it readable.
		const durationSec = Math.max(8, Math.min(24, distancePx / 55));
		trackTitle.style.setProperty('--marquee-translate', `${-distancePx}px`);
		trackTitle.style.setProperty('--marquee-duration', `${durationSec.toFixed(2)}s`);
	};

	const updateTitleMarquee = () => {
		marqueeUpdateRaf = null;
		const trimmed = currentTitleValue?.trim();
		const thresholdPx = Math.floor(window.innerWidth * 0.9);
		if (!thresholdPx || !trimmed || trimmed === '...' || trimmed === '\u00A0') {
			disableTitleMarquee();
			return;
		}

		const measureEl = getTitleMeasureEl();
		const cs = getComputedStyle(trackTitle);
		measureEl.style.fontFamily = cs.fontFamily;
		measureEl.style.fontSize = cs.fontSize;
		measureEl.style.fontWeight = cs.fontWeight;
		measureEl.style.letterSpacing = cs.letterSpacing;
		measureEl.textContent = currentTitleValue;
		const textWidth = measureEl.getBoundingClientRect().width;

		if (textWidth <= thresholdPx) {
			disableTitleMarquee();
			return;
		}

		enableTitleMarquee(textWidth, thresholdPx);
	};

	const scheduleTitleMarqueeUpdate = () => {
		if (marqueeUpdateRaf !== null) cancelAnimationFrame(marqueeUpdateRaf);
		marqueeUpdateRaf = requestAnimationFrame(updateTitleMarquee);
	};

	const setTitleText = (title) => {
		const trimmed = title?.trim();
		currentTitleValue = trimmed || '\u00A0';
		scheduleTitleMarqueeUpdate();
	};
	const setArtistText = (artist) => {
		const trimmed = artist?.trim();
		trackArtist.textContent = trimmed || '\u00A0';
	};

	const updateMediaSessionMetadata = (title, artist) => {
		if (!('mediaSession' in navigator)) return;
		try {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: title || '',
				artist: artist || '',
			});
		} catch {
			// Ignore unsupported contexts.
		}
	};

	const updateTitleFromMetadata = (url, fallbackFilename) => {
		const fallback = formatTitle(fallbackFilename);
		const reqId = ++titleRequestId;

		titleAbortController?.abort();
		if (titleFallbackTimer) clearTimeout(titleFallbackTimer);

		setTitleText('...');
		setArtistText('');
		updateMediaSessionMetadata('', '');

		titleFallbackTimer = setTimeout(() => {
			if (reqId !== titleRequestId) return;
			const current = trackTitle.textContent?.trim();
			if (!current || current === '...') {
				setTitleText(fallback);
				updateMediaSessionMetadata(fallback, trackArtist.textContent?.trim() || '');
			}
		}, 3000);

		const jsmediatags = globalThis.jsmediatags;
		if (!jsmediatags || typeof jsmediatags.Reader !== 'function') return;

		const controller = new AbortController();
		titleAbortController = controller;

		(async () => {
			try {
				const response = await fetch(url, { signal: controller.signal });
				if (!response.ok) return;
				const blob = await response.blob();
				if (controller.signal.aborted || reqId !== titleRequestId) return;

				const result = await new Promise((resolve, reject) => {
					try {
						new jsmediatags.Reader(blob).read({
							onSuccess: resolve,
							onError: reject,
						});
					} catch (e) {
						reject(e);
					}
				});

				if (controller.signal.aborted || reqId !== titleRequestId) return;
				const tags = result?.tags;
				const title = tags?.title?.trim() || '';
				const artist = tags?.artist?.trim() || '';
				if (artist) setArtistText(artist);
				if (title) {
					setTitleText(title);
					updateMediaSessionMetadata(title, artist);
				} else {
					// Keep showing '...' until the 1s fallback triggers.
					updateMediaSessionMetadata('', artist);
				}
			} catch {
				// Fetch/read may be blocked (e.g. file://) or aborted; keep fallback.
			}
		})();
	};

	const setActiveSongListItem = (activeIndex) => {
		const buttons = songList.querySelectorAll('button[data-index]');
		buttons.forEach((btn) => {
			const idx = Number(btn.dataset.index);
			btn.setAttribute('aria-current', String(idx === activeIndex));
		});
	};

	const updateSongListItemFromMetadata = (index, url, fallbackFilename) => {
		const button = songList.querySelector(`button[data-index="${index}"]`);
		if (!button) return;
		const titleEl = button.querySelector('[data-role="title"]');
		const artistEl = button.querySelector('[data-role="artist"]');
		if (!titleEl || !artistEl) return;

		const fallback = formatTitle(fallbackFilename);
		titleEl.textContent = '...';
		artistEl.textContent = '';
		const fallbackTimer = setTimeout(() => {
			if (titleEl.textContent?.trim() === '...') {
				titleEl.textContent = fallback;
			}
		}, 1000);

		const jsmediatags = globalThis.jsmediatags;
		if (!jsmediatags || typeof jsmediatags.Reader !== 'function') return;

		(async () => {
			try {
				const response = await fetch(url);
				if (!response.ok) return;
				const blob = await response.blob();

				const result = await new Promise((resolve, reject) => {
					try {
						new jsmediatags.Reader(blob).read({
							onSuccess: resolve,
							onError: reject,
						});
					} catch (e) {
						reject(e);
					}
				});

				const tags = result?.tags;
				const title = tags?.title?.trim() || '';
				const artist = tags?.artist?.trim() || '';
				if (artist) artistEl.textContent = artist;
				if (title) {
					clearTimeout(fallbackTimer);
					titleEl.textContent = title;
				}
			} catch {
				// Ignore; keep fallback.
			}
		})();
	};

	const buildSongList = () => {
		songList.innerHTML = '';
		tracks.forEach((file, index) => {
			const li = document.createElement('li');
			const row = document.createElement('div');
			row.className = 'songlist_row';
			row.dataset.file = file;
			row.classList.toggle('songlist_row--liked', isLiked(file));

			const likeIndicator = document.createElement('i');
			likeIndicator.className = 'fa-solid fa-heart songlist_like_indicator';
			likeIndicator.setAttribute('aria-hidden', 'true');

			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'songlist_item_btn';
			btn.dataset.index = String(index);
			btn.setAttribute('aria-current', 'false');
			btn.setAttribute('aria-label', `Song abspielen: ${formatTitle(file)}`);

			const title = document.createElement('div');
			title.dataset.role = 'title';
			title.textContent = '...';

			const meta = document.createElement('div');
			meta.className = 'songlist_item_meta';
			meta.dataset.role = 'artist';
			meta.textContent = '';

			btn.appendChild(title);
			btn.appendChild(meta);
			btn.addEventListener('click', () => {
				loadTrack(index, { reseedShuffle: true });
				setActiveSongListItem(index);
				setPlaying(true);
			});

			const url = encodeURI(`music/${file}`);
			const downloadLink = document.createElement('a');
			downloadLink.className = 'songlist_download_btn';
			downloadLink.href = url;
			downloadLink.setAttribute('download', file);
			downloadLink.setAttribute('aria-label', `Download: ${formatTitle(file)}`);
			downloadLink.addEventListener('click', (e) => {
				// Don't trigger play when downloading.
				e.stopPropagation();
			});
			const downloadIcon = document.createElement('i');
			downloadIcon.className = 'fa-solid fa-file-arrow-down';
			downloadIcon.setAttribute('aria-hidden', 'true');
			downloadLink.appendChild(downloadIcon);

			row.appendChild(likeIndicator);
			row.appendChild(btn);
			row.appendChild(downloadLink);
			li.appendChild(row);
			songList.appendChild(li);

			updateSongListItemFromMetadata(index, url, file);
		});
		setActiveSongListItem(currentTrackIndex);
	};

	const loadTrack = (index, { reseedShuffle = false } = {}) => {
		currentTrackIndex = (index + tracks.length) % tracks.length;
		if (shuffleEnabled && reseedShuffle) {
			rebuildShuffleOrder(currentTrackIndex);
		}
		const file = tracks[currentTrackIndex];
		const url = encodeURI(`music/${file}`);
		audio.src = url;
		audio.load();
		updateTitleFromMetadata(url, file);
		setActiveSongListItem(currentTrackIndex);
		updateLikeButtonUI();
		updateSongListLikeIndicators();
		updateTimeUI();
	};

	const playAudio = async () => {
		try {
			await audio.play();
		} catch {
			// Autoplay/gesture restrictions or decoding errors: keep UI consistent without throwing.
		}
	};

	const syncFromAudioState = (playing) => {
		isPlaying = playing;
		targetOmegaDegPerSec = isPlaying ? maxOmegaDegPerSec : 0;
		cdCaseButton.setAttribute('aria-pressed', String(isPlaying));
		updatePlayIcon();

		if (rafId === null) {
			lastTs = null;
			rafId = requestAnimationFrame(step);
		}
	};

	const setPlaying = (nextIsPlaying) => {
		isPlaying = nextIsPlaying;
		targetOmegaDegPerSec = isPlaying ? maxOmegaDegPerSec : 0;
		cdCaseButton.setAttribute('aria-pressed', String(isPlaying));
		updatePlayIcon();

		if (isPlaying) {
			void playAudio();
		} else {
			audio.pause();
		}

		if (rafId === null) {
			lastTs = null;
			rafId = requestAnimationFrame(step);
		}
	};

	const toggle = () => setPlaying(!isPlaying);

	const step = (ts) => {
		if (lastTs === null) lastTs = ts;
		const dt = Math.min((ts - lastTs) / 1000, 0.05);
		lastTs = ts;

		const delta = targetOmegaDegPerSec - omegaDegPerSec;
		const rate = delta > 0 ? accelDegPerSec2 : decelDegPerSec2;
		const maxStep = rate * dt;

		if (Math.abs(delta) <= maxStep) {
			omegaDegPerSec = targetOmegaDegPerSec;
		} else {
			omegaDegPerSec += Math.sign(delta) * maxStep;
		}

		angleDeg = (angleDeg + omegaDegPerSec * dt) % 360;
		cd.style.transform = `rotate(${angleDeg}deg)`;

		const shouldContinue = isPlaying || omegaDegPerSec > 0.05;
		if (shouldContinue) {
			rafId = requestAnimationFrame(step);
		} else {
			omegaDegPerSec = 0;
			rafId = null;
			lastTs = null;
		}
	};

	const nextTrack = () => {
		if (shuffleEnabled && tracks.length) {
			if (!shuffleOrder.length || shuffleOrder[shufflePos] !== currentTrackIndex) {
				rebuildShuffleOrder(currentTrackIndex);
			}
			if (shufflePos >= shuffleOrder.length - 1) {
				rebuildShuffleOrder(currentTrackIndex);
			}
			shufflePos = Math.min(shufflePos + 1, shuffleOrder.length - 1);
			loadTrack(shuffleOrder[shufflePos]);
			if (isPlaying) void playAudio();
			return;
		}
		loadTrack(currentTrackIndex + 1);
		if (isPlaying) void playAudio();
	};

	const prevTrack = () => {
		if (shuffleEnabled && tracks.length) {
			if (!shuffleOrder.length || shuffleOrder[shufflePos] !== currentTrackIndex) {
				rebuildShuffleOrder(currentTrackIndex);
			}
			shufflePos = Math.max(shufflePos - 1, 0);
			loadTrack(shuffleOrder[shufflePos]);
			if (isPlaying) void playAudio();
			return;
		}
		loadTrack(currentTrackIndex - 1);
		if (isPlaying) void playAudio();
	};

	cdCaseButton.addEventListener('click', toggle);
	playPauseBtn.addEventListener('click', toggle);
	prevBtn.addEventListener('click', () => prevTrack());
	nextBtn.addEventListener('click', () => nextTrack());
	likeBtn?.addEventListener('click', () => toggleLikeCurrentTrack());
	shuffleBtn?.addEventListener('click', () => {
		const next = !shuffleEnabled;
		setShuffleEnabled(next);
	});

	audio.addEventListener('loadedmetadata', updateTimeUI);
	audio.addEventListener('timeupdate', updateTimeUI);
	audio.addEventListener('play', () => syncFromAudioState(true));
	audio.addEventListener('playing', () => syncFromAudioState(true));
	audio.addEventListener('pause', () => {
		// When a track ends, browsers may also emit 'pause'.
		if (audio.ended) return;
		syncFromAudioState(false);
	});
	audio.addEventListener('ended', () => {
		if (!tracks.length) return;
		// Keep the player in "playing" state across track boundaries.
		syncFromAudioState(true);
		nextTrack();
	});

	if ('mediaSession' in navigator) {
		try {
			navigator.mediaSession.setActionHandler('play', () => setPlaying(true));
			navigator.mediaSession.setActionHandler('pause', () => setPlaying(false));
			navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
			navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
		} catch {
			// Ignore if the browser blocks handlers in this context.
		}
	}

	buildSongList();
	loadTrack(0, { reseedShuffle: true });
	updatePlayIcon();
	updateLikeButtonUI();
	updateSongListLikeIndicators();
	window.addEventListener('resize', scheduleTitleMarqueeUpdate);
	scheduleTitleMarqueeUpdate();

	// One-time notice after 5 minutes total time on site.
	const VISIT_START_KEY = 'yandhi_visit_start_v1';
	const NOTICE_SHOWN_KEY = 'yandhi_notice_5min_shown_v1';
	const NOTICE_DELAY_MS = 2 * 60 * 1000;
	const NOTICE_VISIBLE_MS = 200 * 1000;

	const getVisitStartMs = () => {
		try {
			const raw = localStorage.getItem(VISIT_START_KEY);
			const parsed = Number(raw);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
			const now = Date.now();
			localStorage.setItem(VISIT_START_KEY, String(now));
			return now;
		} catch {
			return Date.now();
		}
	};

	const hasShownNotice = () => {
		try {
			return localStorage.getItem(NOTICE_SHOWN_KEY) === '1';
		} catch {
			return false;
		}
	};

	const markNoticeShown = () => {
		try {
			localStorage.setItem(NOTICE_SHOWN_KEY, '1');
		} catch {
			// Ignore.
		}
	};

	const showFiveMinuteNotice = () => {
		if (hasShownNotice()) return;
		markNoticeShown();

		const el = document.createElement('div');
		el.className = 'site_notice site_notice--in';
		el.setAttribute('role', 'status');
		el.setAttribute('aria-live', 'polite');
		el.textContent = "Seems like you've been here for a while. Hope you're enjoying the music! ";
		const link = document.createElement('a');
		link.href = 'https://www.paypal.me/claudiuscasparlaur';
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = 'Donate';
		link.addEventListener('click', (e) => {
			// Don't immediately close the toast when the link is clicked.
			e.stopPropagation();
		});
		el.appendChild(link);
		el.appendChild(document.createTextNode(' if you like my project!'));
		document.body.appendChild(el);

		const startHide = () => {
			el.classList.remove('site_notice--in');
			el.classList.add('site_notice--out');
		};

		const cleanup = () => {
			el.remove();
		};

		const hideTimer = setTimeout(startHide, NOTICE_VISIBLE_MS);
		el.addEventListener('click', () => {
			clearTimeout(hideTimer);
			startHide();
		});
		el.addEventListener('animationend', (e) => {
			if (e.animationName === 'site-notice-out') cleanup();
		});
		// Fallback cleanup in case animationend doesn't fire.
		setTimeout(cleanup, NOTICE_VISIBLE_MS + 1000);
	};

	(() => {
		if (hasShownNotice()) return;
		const start = getVisitStartMs();
		const elapsed = Date.now() - start;
		const remaining = NOTICE_DELAY_MS - elapsed;
		setTimeout(showFiveMinuteNotice, Math.max(0, remaining));
	})();
})();
