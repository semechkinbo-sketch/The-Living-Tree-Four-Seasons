/* Compatibility update: safe startup, bounded canvas memory, touch and keyboard controls.
   Season buttons enter a season without pausing its living cycle.
   Buds, leaves, flowers, leaf fall and snow develop continuously. */
(function () {
let livingTreeStarted = false;
function startLivingTree() {
if (livingTreeStarted) return;
/* The Living Tree: Four Seasons
   An interactive living painting: a detailed tree, four seasons in a loop,
   day and night, rain, snow, wind, drifting blossom petals in spring.
   Everything is drawn in code, no external files. */
'use strict';

/* ---------- Seeded randomness: the tree is always the same ---------- */
function mulberry32(seed) {
	return function () {
		seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
let rng = mulberry32(20261105);
function reseed(s) { rng = mulberry32(s); }
function rand(a, b) { return a + (b - a) * rng(); }

/* ---------- URL parameters (for testing) ---------- */
let query = '';
try {
 query = window.FORCED_PARAMS || location.search || '';
} catch (e) {
 query = '';
}
const params = { get(key) { const m = new RegExp('(?:^|[?&])' + key + '=([^&]*)').exec(query); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; }, has(key) { return this.get(key) !== null; } };
const paramSeason = params.get('season');		   // spring|summer|autumn|winter
const paramTime = params.get('time');			   // day|night
const paramWeather = params.get('weather');		 // rain|snow|storm|clear
const speedMul = Math.max(0.1, parseFloat(params.get('speed') || '1') || 1);

/* ---------- Canvas ---------- */
const canvas = document.getElementById('scene');
if (!canvas) return;
livingTreeStarted = true;
let ctx = canvas.getContext('2d');
if (!ctx) { const note = document.createElement('p'); note.textContent = 'Canvas is unavailable. Please open this project in an up-to-date browser.'; document.getElementById('stage').appendChild(note); return; }
const mainCtx = ctx;
const treeCv = document.createElement('canvas');
const treeCtx = treeCv.getContext('2d');
let treeCacheT = -1, TREE_INTERVAL = 0.05, cacheOn = true;
let W = 0, H = 0, DPR = 1, groundY = 0;

/* ---------- World state ---------- */
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_SECONDS = 80;				 // one season in the automatic cycle
let yearT = 1.15;						  // 0..4 - continuous time of year
if (paramSeason) {
	const i = SEASON_IDS.indexOf(paramSeason);
	if (i >= 0) yearT = i + 0.02;
}
let previousSeason = currentSeason(); // detect natural boundaries without freezing the year
let dayNight = paramTime === 'night' ? 1 : 0;   // 0 - day, 1 - night
let dayNightTarget = dayNight;
let windSmooth = 0.4, gust = 0, gustTarget = 0, gustTimer = 4;
let precipMode = 'off';					// off|rain|snow|storm
let precipLevel = 0, rainVisibility = 0, snowVisibility = 0;					   // smooth precipitation strength 0..1
if (paramWeather && paramWeather !== 'clear') precipMode = paramWeather;
let snowAmount = 0;   // snow on branches and ground
let autoWeatherTimer = rand(22, 38);
let prevPrecipMode = 'off';
let autoDN = paramTime ? false : true, dnTimer = 55;   /* automatic day/night cycle; tapping the sun/moon switches manually */
let lightning = 0, lightningTimer = rand(14, 26);

/* ---------- Sound (synthesized, like in Forest House) ---------- */
const Sound = {
	ctx: null, master: null, started: false, windGain: null, rainGain: null,
	ensure() {
		if (!this.ctx) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return null;
			try { this.ctx = new AC(); } catch (_) { return null; }
			this.master = this.ctx.createGain();
			this.master.gain.value = 1;
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended') { const resumed = this.ctx.resume(); if (resumed && resumed.catch) resumed.catch(() => {}); }
		return this.ctx;
	},
	start() {
		if (this.started) return;
		const ctx = this.ensure(); if (!ctx) return;
		this.started = true;
		this.windGain = this.noiseLoop('lowpass', 320, 0.04);
		this.rainGain = this.noiseLoop('bandpass', 1400, 0.0001);
	},
	noiseLoop(type, freq, gainVal) {
		const ctx = this.ctx;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const out = buf.getChannelData(0);
		for (let i = 0; i < len; i++) out[i] = Math.random() * 2 - 1;
		const src = ctx.createBufferSource();
		src.buffer = buf; src.loop = true;
		const filt = ctx.createBiquadFilter();
		filt.type = type; filt.frequency.value = freq; filt.Q.value = 0.6;
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(gainVal, ctx.currentTime);
		src.connect(filt); filt.connect(g); g.connect(this.master);
		src.start();
		return g;
	},
	setWind(v) {
		if (!this.windGain || !this.ctx) return;
		this.windGain.gain.setTargetAtTime(0.015 + v * 0.15, this.ctx.currentTime, 0.4);
	},
	setRain(v) {
		if (!this.rainGain || !this.ctx) return;
		this.rainGain.gain.setTargetAtTime(v > 0.02 ? 0.03 + v * 0.11 : 0.0001, this.ctx.currentTime, 0.6);
	},
	blip(fA, fB, dur, vol, type, at) {
		const ctx = this.ensure(); if (!ctx) return;
		const now = ctx.currentTime + (at || 0);
		const osc = ctx.createOscillator(), g = ctx.createGain();
		osc.type = type || 'sine';
		osc.frequency.setValueAtTime(fA, now);
		osc.frequency.exponentialRampToValueAtTime(Math.max(fB, 1), now + dur);
		g.gain.setValueAtTime(vol, now);
		g.gain.exponentialRampToValueAtTime(0.001, now + dur);
		osc.connect(g); g.connect(this.master);
		osc.start(now); osc.stop(now + dur + 0.05);
	},
	bird() {
		const base = rand(1900, 2700);
		for (let i = 0; i < 3; i++) this.blip(base + rand(-300, 500), base + rand(200, 700), 0.09, 0.03, 'sine', i * 0.13);
	},
	owl() {
		this.blip(340, 300, 0.25, 0.05, 'sine', 0);
		this.blip(320, 280, 0.35, 0.05, 'sine', 0.4);
	},
	cricket() {
		for (let i = 0; i < 4; i++) this.blip(4200, 4300, 0.03, 0.012, 'square', i * 0.07);
	},
	thunder() {
		const ctx = this.ensure(); if (!ctx) return;
		const now = ctx.currentTime;
		const osc = ctx.createOscillator(), g = ctx.createGain();
		osc.type = 'sawtooth';
		osc.frequency.setValueAtTime(90, now);
		osc.frequency.exponentialRampToValueAtTime(30, now + 0.9);
		g.gain.setValueAtTime(0.22, now);
		g.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
		osc.connect(g); g.connect(this.master);
		osc.start(now); osc.stop(now + 1.05);
		const len = ctx.sampleRate * 0.5;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const out = buf.getChannelData(0);
		for (let i = 0; i < len; i++) out[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const src = ctx.createBufferSource(); src.buffer = buf;
		const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 220;
		const g2 = ctx.createGain(); g2.gain.value = 0.12;
		src.connect(filt); filt.connect(g2); g2.connect(this.master);
		src.start();
	}
};

/* ---------- Colors and palettes ---------- */
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(c1, c2, t) {
	return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function css(c, a) {
	return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
}
const SKY = {
	day: {
		spring: [[126,186,232],[178,214,240],[222,238,248]],
		summer: [[70,140,215],[140,195,238],[215,238,250]],
		autumn: [[96,140,180],[158,188,212],[226,232,236]],
		winter: [[120,150,180],[172,196,216],[224,234,240]]
	},
	dusk:  [[68,60,110],[186,110,90],[248,180,120]],
	night: [[6,12,32],[16,28,58],[38,54,86]]
};
const GRASS = { spring: [110,168,84], summer: [86,150,66], autumn: [148,132,70], winter: [196,204,212] };

function seasonWeights() {
	const w = [0, 0, 0, 0];
	const t = ((yearT % 4) + 4) % 4;
	const i = Math.floor(t), f = t - i;
	const blend = smoothstep(0.70, 1, f);   /* blend in the last 25% of the season */
	w[i] += 1 - blend; w[(i + 1) % 4] += blend;
	return w;
}
function seasonProgress() {
	const t = ((yearT % 4) + 4) % 4;
	return t - Math.floor(t);
}
function currentSeason() { return Math.floor(((yearT % 4) + 4) % 4); }

function skyPalette() {
	const w = seasonWeights();
	const top = [0,0,0], mid = [0,0,0], hor = [0,0,0];
	for (let i = 0; i < 4; i++) {
		const p = SKY.day[SEASON_IDS[i]];
		for (let k = 0; k < 3; k++) {
			top[k] += p[0][k] * w[i]; mid[k] += p[1][k] * w[i]; hor[k] += p[2][k] * w[i];
		}
	}
	const mix = (dayC, duskC, nightC, t) =>
		t < 0.5 ? lerpC(dayC, duskC, t * 2) : lerpC(duskC, nightC, (t - 0.5) * 2);
	return {
		top: mix(top, SKY.dusk[0], SKY.night[0], dayNight),
		mid: mix(mid, SKY.dusk[1], SKY.night[1], dayNight),
		hor: mix(hor, SKY.dusk[2], SKY.night[2], dayNight)
	};
}

/* ---------- The tree ---------- */
const MAX_DEPTH = 9;
let segments = [];
let roots = [];
let mossSpots = [];
let leaves = [];
let treeCX = 0, treeBase = 0, treeScale = 1;

function buildTree() {
	reseed(20261105);   /* the same tree at any resize */
	segments = []; leaves = []; roots = [];
	treeCX = W * 0.5;
	treeBase = groundY + H * 0.012;
	treeScale = Math.min(H * 0.68, W * 0.84) / 100;
	function normA(a) { while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832; return a; }
	function addSeg(parent, depth, ang, len, w1, w2, bend, piece) {
		const idx = segments.length;
		const seg = {
			parent, depth, len, w: w1, w2, angAbs: ang, bend,
			phase: rand(0, Math.PI * 2),
			flex: 0.0016 * Math.pow(depth, 1.7),
			x1: 0, y1: 0, cx: 0, cy: 0, x2: 0, y2: 0, sway: 0, drawAng: ang, endAng: ang + bend, tex: null
		};
		if (depth <= 3) {
			seg.tex = [];
			const n = depth === 0 ? 34 : (depth === 1 ? 20 : 10);
			for (let i = 0; i < n; i++) seg.tex.push({ t: rand(0.02, 0.95), o: rand(-0.42, 0.42), l: rand(0.08, 0.28), d: rng() < 0.7 ? 0 : 1 });
		}
		segments.push(seg);
		return idx;
	}
	function addLeaves(idx, depth) {
		const n = depth >= 6 ? 4 : 3;
		for (let l = 0; l < n; l++) {
			leaves.push({
				seg: idx, t: rand(0.2, 1.0), off: rand(-4.6, 4.6),
				size: rand(4.4, 7.0), phase: rand(0, Math.PI * 2),
				rot0: rand(0, Math.PI * 2),
				grow: rand(0, 0.55),
				colDelay: rand(0, 0.45),
				fallAt: rand(0.14, 0.97),
				hue: rng(),
				winterKeep: rng() < 0.03,
				state: 'attached', fx: 0, fy: 0, fvx: 0, fvy: 0, frot: 0, fspin: 0
			});
		}
	}
	function reach0(v) { return v < 10 ? rand(0.6, 1.6) : (v < 16 ? rand(2.0, 2.8) : rand(3.0, 3.8)); }
	function grow(parent, depth, ang, len, w1) {
		const up = -Math.PI / 2;
		const toUp = normA(up - ang);
		let bend = toUp * (depth < 5 ? 0.28 : -0.12) + rand(-0.26, 0.26);
		if (depth >= 6) bend += rand(-0.2, 0.2);
		const w2 = w1 * rand(0.62, 0.76);
		const idx = addSeg(parent, depth, ang, len, w1, w2, bend);
		const endAng = ang + bend;
		if (depth < MAX_DEPTH && len > 2.2 && w1 > 0.2) {
			const kids = depth < 2 ? 3 : (rng() < 0.78 ? 2 : 3);
			for (let k = 0; k < kids; k++) {
				const dir = (k / (kids - 1)) * 2 - 1;
				const spread = dir * rand(0.3, 0.62) + rand(-0.12, 0.12);
				grow(idx, depth + 1, endAng + spread, len * rand(0.64, 0.78), w2 * rand(0.78, 0.9));
			}
		}
		if (depth >= 4) addLeaves(idx, depth);
	}
	/* trunk of three segments with a slight S-curve, tapering upward; side branches grow from the middle */
	let prev = -1, ang = -Math.PI / 2 + 0.05;
	const tw = [9.6, 7.9, 6.4, 5.3];
	const bends = [-0.12, 0.2, -0.1];
	for (let i = 0; i < 3; i++) {
		const idx = addSeg(prev, 0, ang, 9.5, tw[i], tw[i + 1], bends[i]);
		ang += bends[i];
		if (i === 0) {
			grow(idx, 1, ang + 1.12, 17, 3.7);
			grow(idx, 1, ang - 1.2, 16, 3.4);
		}
		if (i === 1) {
			grow(idx, 1, ang - 0.95, 15, 3.0);
			grow(idx, 1, ang + 0.9, 15.5, 3.1);
		}
		prev = idx;
	}
	const kids = 3;
	for (let k = 0; k < kids; k++) {
		const dir = k - 1;
		grow(prev, 1, ang + dir * 0.5 + rand(-0.08, 0.08), 21 * rand(0.92, 1.05), 4.2);
	}
	/* roots: spread wide from the trunk, bend and dive into the ground */
	const rdefs = [[-1, 22, 5.2], [-1, 13, 4.2], [-1, 7, 3.2], [1, 7, 3.2], [1, 14, 4.3], [1, 23, 5.3]];
	for (const r of rdefs) {
		const side = r[0], reach = r[1] + rand(-2, 2), w = r[2];
		const sx = side * (reach0(r[1]) );
		roots.push({ sx, sy: -9, ex: side * reach, ey: rand(0.5, 2.5), w, c: rand(0.2, 0.5), tw: [] });
		if (reach > 14) {
			const rr = roots[roots.length - 1];
			for (let k = 0; k < 2; k++) rr.tw.push({ t: rand(0.45, 0.7), dx: side * rand(5, 9), dy: rand(0.5, 2.5), w: w * 0.38 });
		}
	}
	/* after a rebuild (screen rotation, URL bar) compute geometry at once and keep the season's foliage stage */
	updateTree(0);
	{
		const t4b = ((yearT % 4) + 4) % 4, spb = seasonProgress();
		for (const lf of leaves) {
			if (t4b >= 3 && !lf.winterKeep) lf.state = 'gone';
			else if (t4b >= 2 && t4b < 3 && spb > lf.fallAt && !lf.winterKeep) lf.state = 'gone';
		}
	}
	/* moss on the north side (visible in spring and summer) */
	mossSpots = [];
	for (let i = 0; i < 14; i++) mossSpots.push({ t: rand(0.05, 0.95), o: rand(-0.4, -0.05), r: rand(0.5, 1.2) });
}

/* Leaf sprites in several colors */
const LEAF_COLORS = [
	[150, 200, 90],   // 0 spring light
	[102, 172, 68],   // 1 summer
	[72, 142, 56],	// 2 summer dark
	[222, 192, 70],   // 3 yellow
	[226, 152, 52],   // 4 orange
	[198, 90, 44],	// 5 red
	[150, 96, 52]	 // 6 dry
];
let leafSprites = [];
function buildLeafSprites() {
	leafSprites = LEAF_COLORS.map(c => {
		const s = document.createElement('canvas');
		s.width = s.height = 32;
		const g = s.getContext('2d');
		g.translate(16, 16);
		const grad = g.createLinearGradient(0, -12, 0, 12);
		grad.addColorStop(0, css([c[0] + 26, c[1] + 26, c[2] + 20]));
		grad.addColorStop(1, css([c[0] - 22, c[1] - 22, c[2] - 14]));
		g.fillStyle = grad;
		g.beginPath();
		g.moveTo(0, -13);
		g.bezierCurveTo(9, -7, 9, 6, 0, 13);
		g.bezierCurveTo(-9, 6, -9, -7, 0, -13);
		g.fill();
		g.strokeStyle = css([c[0] - 45, c[1] - 45, c[2] - 30], 0.8);
		g.lineWidth = 1;
		g.beginPath(); g.moveTo(0, -11); g.lineTo(0, 12); g.stroke();
		return s;
	});
}

/* pre-rotated sprite copies: a leaf is drawn without changing the transform, noticeably cheaper */
const ROT_STEPS = 24;
let rotSprites = [];
function buildRotSprites() {
	rotSprites = leafSprites.map(sp => {
		const arr = [];
		for (let k = 0; k < ROT_STEPS; k++) {
			const c = document.createElement('canvas');
			c.width = c.height = 40;
			const g = c.getContext('2d');
			g.translate(20, 20);
			g.rotate(k * Math.PI * 2 / ROT_STEPS);
			g.drawImage(sp, -16, -16);
			arr.push(c);
		}
		return arr;
	});
}

/* ---------- Spring blossom petals ---------- */
const PETAL_COLORS = [
	[255, 230, 238],   // pale, almost white
	[250, 196, 212],   // light pink
	[243, 168, 190]	// deeper pink
];
let petalSprites = [];
function buildPetalSprites() {
	petalSprites = PETAL_COLORS.map(c => {
		const s = document.createElement('canvas');
		s.width = s.height = 24;
		const g = s.getContext('2d');
		g.translate(12, 12);
		const grad = g.createLinearGradient(0, -9, 0, 9);
		grad.addColorStop(0, css([c[0], Math.min(255, c[1] + 16), Math.min(255, c[2] + 12)]));
		grad.addColorStop(1, css([c[0] - 12, c[1] - 24, c[2] - 18]));
		g.fillStyle = grad;
		g.beginPath();
		g.moveTo(0, -9);
		g.bezierCurveTo(6.5, -6, 6.5, 5, 0, 9);
		g.bezierCurveTo(-6.5, 5, -6.5, -6, 0, -9);
		g.fill();
		return s;
	});
}

/* ---------- Far background, ground, stars (pre-render) ---------- */
let hillsCanvas = null, groundCanvas = null, starsCanvas = null;
function buildBackground() {
	hillsCanvas = document.createElement('canvas');
	hillsCanvas.width = W * DPR; hillsCanvas.height = H * DPR;
	const g = hillsCanvas.getContext('2d');
	g.scale(DPR, DPR);
	for (let layer = 0; layer < 2; layer++) {
		const baseY = groundY - H * (layer === 0 ? 0.10 : 0.045);
		const amp = H * (layer === 0 ? 0.06 : 0.035);
		g.beginPath();
		g.moveTo(0, H);
		for (let x = 0; x <= W + 12; x += 8) {
			const y = baseY + Math.sin(x * 0.004 + layer * 2.4) * amp * 0.5
				+ Math.sin(x * 0.011 + layer * 5.1) * amp * 0.28;
			g.lineTo(x, y);
		}
		g.lineTo(W + 20, H); g.closePath();
		g.fillStyle = layer === 0 ? '#5a7250' : '#47603f';
		g.fill();
		if (layer === 1) {
			g.fillStyle = '#3c5436';
			for (let i = 0; i < 26; i++) {
				const tx = (i / 26) * W + rand(-14, 14);
				const ty = baseY + Math.sin(tx * 0.004 + 2.4) * amp * 0.5 + Math.sin(tx * 0.011 + 5.1) * amp * 0.28;
				const th = rand(10, 26);
				g.beginPath();
				g.moveTo(tx, ty - th);
				g.lineTo(tx + th * 0.32, ty);
				g.lineTo(tx - th * 0.32, ty);
				g.closePath(); g.fill();
			}
		}
	}
	groundCanvas = document.createElement('canvas');
	groundCanvas.width = W * DPR; groundCanvas.height = H * DPR;
	const gg = groundCanvas.getContext('2d');
	gg.scale(DPR, DPR);
	const grad = gg.createLinearGradient(0, groundY - 10, 0, H);
	grad.addColorStop(0, '#6a9950');
	grad.addColorStop(0.25, '#578541');
	grad.addColorStop(1, '#3d5c2e');
	gg.fillStyle = grad;
	gg.beginPath();
	gg.moveTo(0, groundY + 6);
	for (let x = 0; x <= W + 12; x += 10) gg.lineTo(x, groundY + Math.sin(x * 0.02) * 3 + Math.sin(x * 0.006 + 2) * 5);
	gg.lineTo(W + 20, H); gg.lineTo(0, H); gg.closePath();
	gg.fill();
	gg.strokeStyle = 'rgba(0,0,0,0.10)';
	gg.lineWidth = 1;
	for (let i = 0; i < 700; i++) {
		const x = rand(0, W), y = rand(groundY + 4, H);
		gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + rand(-2, 2), y - rand(2, 6)); gg.stroke();
	}
	starsCanvas = document.createElement('canvas');
	starsCanvas.width = W * DPR; starsCanvas.height = H * DPR;
	const sg = starsCanvas.getContext('2d');
	sg.scale(DPR, DPR);
	for (let i = 0; i < 130; i++) {
		const x = rand(0, W), y = rand(0, groundY * 0.75), r = rand(0.4, 1.4);
		sg.fillStyle = 'rgba(255,255,255,' + rand(0.3, 0.95).toFixed(2) + ')';
		sg.beginPath(); sg.arc(x, y, r, 0, 7); sg.fill();
	}
}

/* ---------- Particles ---------- */
let rainDrops = [], snowFlakes = [], groundLeaves = [], fireflies = [], flowers = [], birdsFly = [], petals = [];
let birdTimer = 6;
function newPetal(scattered) {
	return {
		x: treeCX + rand(-46, 46) * treeScale,
		y: scattered ? rand(treeBase - 96 * treeScale, groundY - 10) : treeBase - rand(28, 96) * treeScale,
		v: rand(14, 26), swayAmp: rand(10, 26), ph: rand(0, 6.28),
		rot: rand(0, 6.28), spin: rand(-1.6, 1.6),
		size: rand(5.5, 9), c: Math.floor(rand(0, 2.99)), land: 0
	};
}
function buildParticles() {
	rainDrops = []; snowFlakes = []; fireflies = []; groundLeaves = [];
	flowers = [];
	for (let i = 0; i < 46; i++) {
		flowers.push({ x: rand(0, W), y: rand(groundY + 8, H - 8), c: [[255,255,255],[250,220,90],[240,150,200],[180,160,250]][i % 4], s: rand(1.4, 2.6), ph: rand(0, 6.28) });
	}
	for (let i = 0; i < 240; i++) rainDrops.push({ x: rand(0, W), y: rand(-H, 0), v: rand(900, 1250), len: rand(12, 22) });
	for (let i = 0; i < 420; i++) snowFlakes.push({ x: rand(0, W), y: rand(-H, H), v: rand(35, 75), r: rand(1.0, 2.1), ph: rand(0, 6.28) });
	for (let i = 0; i < 18; i++) fireflies.push({ x: rand(0, W), y: rand(groundY - H * 0.3, groundY), ph: rand(0, 6.28), sp: rand(0.2, 0.6) });
	petals = [];
	for (let i = 0; i < 22; i++) petals.push(newPetal(true));
}

/* ---------- Clouds ---------- */
const clouds = [];
for (let i = 0; i < 4; i++) clouds.push({ x: rng(), y: rand(0.06, 0.2), s: rand(0.7, 1.4), v: rand(0.004, 0.01) });
const bigCloud = { x: 0.16, y: 0.10, s: 1.5 };

/* ---------- Seasonal values ---------- */
function leafStage() {
	const t = ((yearT % 4) + 4) % 4;
	if (t < 1) return Math.min(1, seasonProgress() * 1.5);   // spring: growing out
	if (t < 3) return 1;									 // summer and autumn
	return 0;												// winter
}
function autumnColorMix() {
	const t = ((yearT % 4) + 4) % 4;
	if (t < 2) return 0;
	if (t < 3) return Math.min(1, seasonProgress() * 1.35);
	return 1;
}

/* ---------- Tree geometry with sway ---------- */
function segPt(s, t, out) {
	const u = 1 - t;
	out.x = u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2;
	out.y = u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2;
	const tx = 2 * u * (s.cx - s.x1) + 2 * t * (s.x2 - s.cx);
	const ty = 2 * u * (s.cy - s.y1) + 2 * t * (s.y2 - s.cy);
	const l = Math.hypot(tx, ty) || 1;
	out.nx = -ty / l; out.ny = tx / l;
	return out;
}
const _pt = { x: 0, y: 0, nx: 0, ny: 1 };
function updateTree(time) {
	const swayGlobal = 0.25 + windSmooth * 1.5;
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		let px = treeCX, py = treeBase, pSway = 0;
		if (s.parent >= 0) {
			const p = segments[s.parent];
			px = p.x2; py = p.y2; pSway = p.sway;
		}
		const sway = pSway + swayGlobal * s.flex * 60 * Math.sin(time * (0.9 + s.depth * 0.16) + s.phase);
		const ang = s.angAbs + sway * 0.02;
		s.sway = sway;
		s.x1 = px; s.y1 = py;
		const L = s.len * treeScale;
		const mid = ang + s.bend * 0.5;
		s.x2 = px + Math.cos(mid) * L;
		s.y2 = py + Math.sin(mid) * L;
		s.cx = px + Math.cos(ang) * L * 0.52;
		s.cy = py + Math.sin(ang) * L * 0.52;
		s.drawAng = ang;
	}
}

/* ---------- Rendering ---------- */
function drawSky() {
	const p = skyPalette();
	const grad = ctx.createLinearGradient(0, 0, 0, groundY);
	grad.addColorStop(0, css(p.top));
	grad.addColorStop(0.62, css(p.mid));
	grad.addColorStop(1, css(p.hor));
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, W, groundY + 2);
	if (dayNight > 0.25) {
		ctx.save();
		ctx.globalAlpha = (dayNight - 0.25) / 0.75;
		ctx.drawImage(starsCanvas, 0, 0, W, H);
		ctx.restore();
	}
}

function drawCelestial(time) {
	const arcX = W * (0.5 + 0.33 * Math.cos(time * 0.02));
	const dayY = H * 0.16 + Math.sin(time * 0.02) * H * 0.03;
	const nightY = H * 0.14;
	ctx.save();
	ctx.globalAlpha = 1 - dayNight;
	const sg = ctx.createRadialGradient(arcX, dayY, 4, arcX, dayY, 60);
	sg.addColorStop(0, 'rgba(255,244,190,0.95)');
	sg.addColorStop(0.35, 'rgba(255,214,110,0.55)');
	sg.addColorStop(1, 'rgba(255,200,90,0)');
	ctx.fillStyle = sg;
	ctx.beginPath(); ctx.arc(arcX, dayY, 60, 0, 7); ctx.fill();
	ctx.fillStyle = '#fff3c4';
	ctx.beginPath(); ctx.arc(arcX, dayY, 16, 0, 7); ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.globalAlpha = dayNight;
	const mx = W - arcX;
	const mg = ctx.createRadialGradient(mx, nightY, 3, mx, nightY, 46);
	mg.addColorStop(0, 'rgba(235,240,255,0.9)');
	mg.addColorStop(0.4, 'rgba(200,215,245,0.35)');
	mg.addColorStop(1, 'rgba(190,205,240,0)');
	ctx.fillStyle = mg;
	ctx.beginPath(); ctx.arc(mx, nightY, 46, 0, 7); ctx.fill();
	ctx.fillStyle = '#e8edf7';
	ctx.beginPath(); ctx.arc(mx, nightY, 13, 0, 7); ctx.fill();
	ctx.fillStyle = 'rgba(160,170,195,0.5)';
	ctx.beginPath(); ctx.arc(mx - 4, nightY - 3, 2.6, 0, 7); ctx.fill();
	ctx.beginPath(); ctx.arc(mx + 5, nightY + 4, 1.8, 0, 7); ctx.fill();
	ctx.restore();
	return { sunX: arcX, sunY: dayY, moonX: mx, moonY: nightY };
}

function drawCloudShape(x, y, s, shade, alpha) {
	ctx.save();
	ctx.globalAlpha = alpha;
	for (let i = 0; i < 5; i++) {
		const ox = (i - 2) * 22 * s, oy = (i % 2 === 0 ? -7 : 3) * s, r = (26 - Math.abs(i - 2) * 5) * s;
		const grad = ctx.createRadialGradient(x + ox, y + oy, r * 0.15, x + ox, y + oy, r);
		grad.addColorStop(0, css(shade, 0.85));
		grad.addColorStop(0.7, css(shade, 0.5));
		grad.addColorStop(1, css(shade, 0));
		ctx.fillStyle = grad;
		ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, 7); ctx.fill();
	}
	ctx.restore();
}
function drawClouds(dt) {
	const dark = precipLevel;
	const dayC = lerpC([255, 255, 255], [120, 126, 138], dark);
	const nightC = lerpC([150, 160, 185], [70, 76, 92], dark);
	const c = lerpC(dayC, nightC, dayNight);
	for (const cl of clouds) {
		cl.x += cl.v * (0.3 + windSmooth) * dt * 6;
		if (cl.x > 1.25) cl.x = -0.25;
		drawCloudShape(cl.x * W, cl.y * H, cl.s, c, 0.45 + dark * 0.35);
	}
	const bc = lerpC([245, 248, 252], [86, 92, 106], Math.max(dark, 0.12));
	drawCloudShape(bigCloud.x * W, bigCloud.y * H, bigCloud.s, bc, 0.92);
	return { x: bigCloud.x * W, y: bigCloud.y * H, r: 62 * bigCloud.s };
}

function drawHills() {
	const w = seasonWeights();
	let gc = [0, 0, 0];
	for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) gc[k] += GRASS[SEASON_IDS[i]][k] * w[i];
	ctx.drawImage(hillsCanvas, 0, 0, W, H);
	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = 0.5;
	ctx.fillStyle = css(lerpC(gc, [255, 255, 255], 0.35));
	ctx.fillRect(0, groundY - H * 0.2, W, H - groundY + H * 0.2);
	ctx.restore();
	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = dayNight * 0.55;
	ctx.fillStyle = '#1c2c4c';
	ctx.fillRect(0, 0, W, H);
	ctx.restore();
}

function drawGround() {
	const w = seasonWeights();
	let gc = [0, 0, 0];
	for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) gc[k] += GRASS[SEASON_IDS[i]][k] * w[i];
	ctx.drawImage(groundCanvas, 0, 0, W, H);
	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = 0.55;
	ctx.fillStyle = css(lerpC(gc, [255, 255, 255], 0.25));
	ctx.fillRect(0, groundY - 14, W, H - groundY + 14);
	ctx.restore();
	if (dayNight > 0.05) {
		ctx.save();
		ctx.globalCompositeOperation = 'multiply';
		ctx.globalAlpha = dayNight * 0.5;
		ctx.fillStyle = '#203050';
		ctx.fillRect(0, groundY - 14, W, H - groundY + 14);
		ctx.restore();
	}
	/* fallen leaves */
	for (const gl of groundLeaves) {
		const gc = Math.cos(gl.rot) * DPR, gs = Math.sin(gl.rot) * DPR;
		ctx.setTransform(gc, gs, -gs, gc, gl.x * DPR, gl.y * DPR);
		ctx.globalAlpha = Math.max(0, Math.min(1, gl.life * 1.4));
		ctx.drawImage(leafSprites[gl.life < 0.55 ? 6 : gl.color], -gl.size, -gl.size, gl.size * 2, gl.size * 2);
	}
	ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	ctx.globalAlpha = 1;	/* snow cover */
	if (snowAmount > 0.02) {
		ctx.save();
		ctx.globalAlpha = Math.min(1, snowAmount * 1.25);
		ctx.fillStyle = dayNight > 0.5 ? '#c8d2e4' : '#eef3f8';
		ctx.beginPath();
		ctx.moveTo(0, H);
		const sh = 5 + snowAmount * 20;
		for (let x = 0; x <= W; x += 12) {
			ctx.lineTo(x, groundY - sh + Math.sin(x * 0.03 + 1) * 3 + Math.sin(x * 0.008) * 5);
		}
		ctx.lineTo(W + 12, groundY - sh + Math.sin((W + 12) * 0.03 + 1) * 3 + Math.sin((W + 12) * 0.008) * 5);
		ctx.lineTo(W + 12, H);
		ctx.closePath(); ctx.fill();
		ctx.restore();
	}
	/* tree shadow by day */
	const sunA = 1 - dayNight;
	if (sunA > 0.05) {
		ctx.save();
		ctx.globalAlpha = 0.15 * sunA;
		ctx.fillStyle = '#0a2010';
		ctx.beginPath();
		ctx.ellipse(treeCX + 44, treeBase + 6, 120 * treeScale / 2.4, 11, 0.05, 0, 7);
		ctx.fill();
		ctx.restore();
	}
}

function barkRGB(depth) {
	return lerpC([62, 44, 32], [104, 80, 58], Math.min(1, depth / 6));
}
function barkColor(depth) {
	return css(lerpC(barkRGB(depth), [24, 32, 52], dayNight * 0.55));
}
function shadeBark(rgb, k) {
	return css(lerpC([rgb[0] * k, rgb[1] * k, rgb[2] * k], [20, 28, 48], dayNight * 0.55));
}
/* outline of a tapering curved branch; sub = number of segments */
function branchPath(s, sub, grow, circ) {
	const w1 = Math.max(0.5, s.w * treeScale) + grow, w2 = Math.max(0.4, s.w2 * treeScale) + grow;
	const lx = [], ly = [], rx = [], ry = [];
	for (let i = 0; i <= sub; i++) {
		const t = i / sub;
		segPt(s, t, _pt);
		const hw = (w1 + (w2 - w1) * t) / 2;
		lx.push(_pt.x + _pt.nx * hw); ly.push(_pt.y + _pt.ny * hw);
		rx.push(_pt.x - _pt.nx * hw); ry.push(_pt.y - _pt.ny * hw);
	}
	ctx.moveTo(lx[0], ly[0]);
	for (let i = 1; i <= sub; i++) ctx.lineTo(lx[i], ly[i]);
	for (let i = sub; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
	ctx.closePath();
	if (circ) { ctx.moveTo(s.x2 + w2 / 2, s.y2); ctx.arc(s.x2, s.y2, w2 / 2, 0, 6.2832, false); }
}
function drawRoot(r, grow) {
	const sx = treeCX + r.sx * treeScale, sy = treeBase + r.sy * treeScale;
	const ex = treeCX + r.ex * treeScale, ey = treeBase + r.ey * treeScale;
	const cx = sx + (ex - sx) * 0.1, cy = ey - 0.2 * treeScale;
	const w1 = r.w * treeScale + grow, w2 = Math.max(0.8, r.w * 0.1 * treeScale);
	const lx = [], ly = [], rx = [], ry = [];
	const N = 8;
	for (let i = 0; i <= N; i++) {
		const t = i / N, u = 1 - t;
		const x = u * u * sx + 2 * u * t * cx + t * t * ex;
		const y = u * u * sy + 2 * u * t * cy + t * t * ey;
		const tx = 2 * u * (cx - sx) + 2 * t * (ex - cx), ty = 2 * u * (cy - sy) + 2 * t * (ey - cy);
		const l = Math.hypot(tx, ty) || 1;
		const hw = (w1 * Math.pow(1 - t, 0.85) + w2 * t) / 2;
		lx.push(x - ty / l * hw); ly.push(y + tx / l * hw);
		rx.push(x + ty / l * hw); ry.push(y - tx / l * hw);
	}
	ctx.moveTo(lx[0], ly[0]);
	for (let i = 1; i <= N; i++) ctx.lineTo(lx[i], ly[i]);
	for (let i = N; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
	ctx.closePath();
}
function drawTree() {
	const tmp = { x: 0, y: 0, nx: 0, ny: 1 };
	const bk = (d) => barkRGB(d);
	/* roots: dark outline first, then the main color */
	ctx.fillStyle = shadeBark(bk(0), 0.55);
	ctx.beginPath(); for (const r of roots) drawRoot(r, 1.4); ctx.fill();
	ctx.fillStyle = barkColor(0);
	ctx.beginPath(); for (const r of roots) drawRoot(r, 0); ctx.fill();
	/* branches: dark outline first, then the body by depth */
	for (let d = 0; d <= MAX_DEPTH; d++) {
		ctx.fillStyle = shadeBark(bk(d), 0.55);
		ctx.beginPath();
		for (let i = 0; i < segments.length; i++) { const s = segments[i]; if (s.depth === d) branchPath(s, d < 3 ? 6 : (d < 6 ? 3 : 2), d < 5 ? 1.2 : 0.5, false); }
		ctx.fill();
		ctx.beginPath();
		for (let i = 0; i < segments.length; i++) { const s = segments[i]; if (s.depth === d) { const g = d < 5 ? 1.2 : 0.5; const rr = Math.max(0.4, s.w2 * treeScale + g) / 2; ctx.moveTo(s.x2 + rr, s.y2); ctx.arc(s.x2, s.y2, rr, 0, 6.2832, false); } }
		ctx.fill();
	}
	for (let d = 0; d <= MAX_DEPTH; d++) {
		ctx.fillStyle = barkColor(d);
		ctx.beginPath();
		for (let i = 0; i < segments.length; i++) { const s = segments[i]; if (s.depth === d) branchPath(s, d < 3 ? 6 : (d < 6 ? 3 : 2), 0, false); }
		ctx.fill();
		ctx.beginPath();
		for (let i = 0; i < segments.length; i++) { const s = segments[i]; if (s.depth === d) { const rr = Math.max(0.4, s.w2 * treeScale) / 2; ctx.moveTo(s.x2 + rr, s.y2); ctx.arc(s.x2, s.y2, rr, 0, 6.2832, false); } }
		ctx.fill();
	}
	/* bark relief on thick parts: dark grooves, light rim on the left, knots */
	ctx.lineCap = 'round';
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (!s.tex) continue;
		const wpx = s.w * treeScale;
		if (wpx < 3) continue;
		ctx.strokeStyle = shadeBark(bk(s.depth), 0.42);
		ctx.globalAlpha = 0.75;
		ctx.lineWidth = Math.max(0.7, wpx * 0.045);
		ctx.beginPath();
		for (const m of s.tex) {
			const t0 = m.t, t1 = Math.min(1, m.t + m.l);
			segPt(s, t0, tmp);
			const wl = (s.w + (s.w2 - s.w) * t0) * treeScale;
			const ax = tmp.x + tmp.nx * m.o * wl, ay = tmp.y + tmp.ny * m.o * wl;
			segPt(s, (t0 + t1) / 2, tmp);
			const wm = (s.w + (s.w2 - s.w) * (t0 + t1) / 2) * treeScale;
			const mx = tmp.x + tmp.nx * (m.o + (m.d ? 0.04 : -0.04)) * wm, my = tmp.y + tmp.ny * (m.o + (m.d ? 0.04 : -0.04)) * wm;
			segPt(s, t1, tmp);
			const wr = (s.w + (s.w2 - s.w) * t1) * treeScale;
			const bx = tmp.x + tmp.nx * m.o * wr, by = tmp.y + tmp.ny * m.o * wr;
			ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
		}
		ctx.stroke();
		/* light from the left side */
		ctx.globalAlpha = 0.5;
		ctx.strokeStyle = shadeBark(bk(s.depth), 1.45);
		ctx.lineWidth = Math.max(0.8, wpx * 0.12);
		ctx.beginPath();
		for (let k = 0; k <= 6; k++) {
			segPt(s, k / 6, tmp);
			const w = (s.w + (s.w2 - s.w) * (k / 6)) * treeScale;
			const px = tmp.x + tmp.nx * w * 0.3, py = tmp.y + tmp.ny * w * 0.3;
			if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.stroke();
		/* shadow on the right side */
		ctx.globalAlpha = 0.4;
		ctx.strokeStyle = shadeBark(bk(s.depth), 0.35);
		ctx.beginPath();
		for (let k = 0; k <= 6; k++) {
			segPt(s, k / 6, tmp);
			const w = (s.w + (s.w2 - s.w) * (k / 6)) * treeScale;
			const px = tmp.x - tmp.nx * w * 0.33, py = tmp.y - tmp.ny * w * 0.33;
			if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
	/* roots: grooves and light */
	ctx.globalAlpha = 0.5;
	ctx.strokeStyle = shadeBark(bk(0), 1.4);
	ctx.lineWidth = Math.max(1, treeScale * 0.35);
	ctx.beginPath();
	for (const r of roots) {
		const sx = treeCX + r.sx * treeScale, sy = treeBase + r.sy * treeScale;
		const ex = treeCX + r.ex * treeScale, ey = treeBase + r.ey * treeScale;
		ctx.moveTo(sx, sy + 2 * treeScale);
		ctx.quadraticCurveTo(sx + (ex - sx) * 0.1, ey - 0.2 * treeScale, sx + (ex - sx) * 0.7, ey - 0.6 * treeScale);
	}
	ctx.stroke();
	ctx.globalAlpha = 1;
	/* hollow: scarred bark around, deep shadow inside */
	const hs = segments[1];
	segPt(hs, 0.45, tmp);
	const hx = tmp.x + tmp.nx * hs.w * treeScale * 0.12, hy = tmp.y + tmp.ny * hs.w * treeScale * 0.12;
	const hr = treeScale;
	ctx.save();
	ctx.translate(hx, hy);
	ctx.rotate(hs.drawAng + hs.bend * 0.5 + Math.PI / 2);
	ctx.fillStyle = shadeBark(bk(0), 0.7);
	ctx.beginPath(); ctx.ellipse(0, 0, 2.5 * hr, 4.6 * hr, 0, 0, 6.2832); ctx.fill();
	const g = ctx.createRadialGradient(0.2 * hr, 0.8 * hr, 0.3 * hr, 0, 0.5 * hr, 3.4 * hr);
	g.addColorStop(0, dayNight > 0.5 ? '#000' : '#050302');
	g.addColorStop(0.55, dayNight > 0.5 ? '#06090f' : '#1a0f08');
	g.addColorStop(1, dayNight > 0.5 ? '#10151f' : '#33200f');
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.moveTo(0, -3.9 * hr);
	ctx.bezierCurveTo(1.9 * hr, -2.6 * hr, 2.1 * hr, 1.6 * hr, 0.3 * hr, 3.8 * hr);
	ctx.bezierCurveTo(-1.8 * hr, 2.2 * hr, -1.9 * hr, -2.4 * hr, 0, -3.9 * hr);
	ctx.fill();
	ctx.strokeStyle = shadeBark(bk(1), 1.35);
	ctx.globalAlpha = 0.55;
	ctx.lineWidth = Math.max(1, 0.35 * hr);
	ctx.beginPath(); ctx.arc(0, 0, 3.0 * hr, Math.PI * 1.05, Math.PI * 1.9); ctx.stroke();
	ctx.restore();
	ctx.globalAlpha = 1;
	/* moss: green patches on the trunk's shadow side in spring/summer */
	const w = seasonWeights();
	const mossA = Math.min(1, w[0] * 0.7 + w[1] + w[2] * 0.5);
	if (mossA > 0.05) {
		ctx.fillStyle = css(lerpC([86, 124, 56], [20, 40, 40], dayNight * 0.6), 0.55 * mossA);
		for (const m of mossSpots) {
			const s = segments[m.t < 0.5 ? 0 : 1];
			segPt(s, (m.t % 0.5) * 2 * 0.9 + 0.05, tmp);
			const ww = s.w * treeScale;
			ctx.beginPath(); ctx.ellipse(tmp.x + tmp.nx * m.o * ww * 1.4, tmp.y + tmp.ny * m.o * ww * 1.4, m.r * treeScale * 0.9, m.r * treeScale * 0.55, 0.6, 0, 6.2832); ctx.fill();
		}
	}
	/* snow caps: along the top side of branches, drawn above all branches */
	if (snowAmount > 0.03) {
		ctx.strokeStyle = dayNight > 0.5 ? 'rgba(206,216,234,0.95)' : 'rgba(244,249,252,0.95)';
		ctx.lineCap = 'round'; ctx.lineJoin = 'round';
		const cov = 0.3 + snowAmount * 0.7;
		const a0 = (1 - cov) / 2;
		for (let i = 3; i < segments.length; i++) {
			const s = segments[i];
			const wpx = (s.w + s.w2) / 2 * treeScale;
			const hdx = Math.abs(s.x2 - s.x1), hl = Math.hypot(hdx, s.y2 - s.y1) || 1;
			const hz = hdx / hl;
			if (s.depth < 4 && hz < 0.3) continue;   /* snow does not hold on nearly vertical branches */
			ctx.lineWidth = Math.min(Math.max(1.1, wpx * 0.3), 4.2) * (0.4 + snowAmount * 0.6) * (0.55 + 0.45 * hz);
			ctx.beginPath();
			for (let k = 0; k <= 3; k++) {
				const t = a0 + (1 - 2 * a0) * (k / 3);
				segPt(s, t, tmp);
				const w = (s.w + (s.w2 - s.w) * t) * treeScale;
				let nx = tmp.nx, ny = tmp.ny;
				if (ny > 0) { nx = -nx; ny = -ny; }
				const off = w * 0.4 + ctx.lineWidth * 0.3;
				if (k === 0) ctx.moveTo(tmp.x + nx * off, tmp.y + ny * off); else ctx.lineTo(tmp.x + nx * off, tmp.y + ny * off);
			}
			ctx.stroke();
		}
		/* snow on roots and at the base */
		ctx.fillStyle = dayNight > 0.5 ? 'rgba(206,216,234,0.9)' : 'rgba(244,249,252,0.92)';
		ctx.globalAlpha = Math.min(1, snowAmount * 1.3);
		ctx.beginPath();
		ctx.ellipse(treeCX, treeBase + 0.5 * treeScale, 17 * treeScale, 1.6 * treeScale, 0, 0, 6.2832);
		ctx.fill();
		ctx.globalAlpha = 1;
	}
}

/* Continuous leaf colour weights. Each boundary has matching end points. */
function leafColors(leaf, t) {
 const green = leaf.hue < 0.5 ? 1 : 2;
 const autumn = leaf.hue < 0.4 ? 3 : leaf.hue < 0.75 ? 4 : 5;
 if (t < 1) return [0, green, smoothstep(0.68, 1, t)];
 if (t < 2) return [green, green, 0];
 if (t < 3) {
  const progress = t - 2;
  const color = smoothstep(leaf.colDelay * 0.65, leaf.colDelay * 0.65 + 0.42, progress);
  if (leaf.winterKeep && progress > 0.80) return [autumn, 6, smoothstep(0.80, 1, progress)];
  return [green, autumn, color];
 }
 return [6, 6, 0];
}

/* Cache gradual colour blends so each leaf still needs only one draw call. */
const blendedLeaves = [];
function blendedLeaf(a, b, mix, rotation) {
 const level = Math.round(mix * 16);
 if (level === 0 || a === b) return rotSprites[a][rotation];
 if (level === 16) return rotSprites[b][rotation];
 const key = (((a * 7 + b) * 17 + level) * ROT_STEPS + rotation);
 if (blendedLeaves[key]) return blendedLeaves[key];
 const image = document.createElement('canvas'); image.width = image.height = 40;
 const g = image.getContext('2d');
 g.globalAlpha = 1 - level / 16; g.drawImage(rotSprites[a][rotation], 0, 0);
 g.globalCompositeOperation = 'lighter'; g.globalAlpha = level / 16;
 g.drawImage(rotSprites[b][rotation], 0, 0);
 blendedLeaves[key] = image; return image;
}

let leafSkip = 1, slowAcc = 0, slowN = 0, adaptOff = false;
function drawLeaves(time, mode) {
	
	const t4 = ((yearT % 4) + 4) % 4;
	const sp = seasonProgress();
	const nightDim = 1 - dayNight * 0.45;
	let li = -1;
	ctx.globalAlpha = nightDim;
	for (const leaf of leaves) {
		li++;
		if (leaf.state === 'gone') continue;
		if (mode === 'static' && leaf.state === 'falling') continue;
		if (mode === 'falling' && leaf.state !== 'falling') continue;
		if (leafSkip > 1 && leaf.state !== 'falling' && (li % leafSkip) !== 0) continue;
		if (leaf.state === 'falling') {
            ctx.globalAlpha = nightDim;
			/* Reuse the rotated sprites in flight too: no canvas transform per leaf. */
			let ri = Math.round(leaf.frot * (ROT_STEPS / 6.2832)) % ROT_STEPS;
			if (ri < 0) ri += ROT_STEPS;
			const color = leaf.hue < 0.4 ? 3 : leaf.hue < 0.75 ? 4 : 5;
			ctx.drawImage(rotSprites[color][ri], leaf.fx - leaf.size, leaf.fy - leaf.size, leaf.size * 2, leaf.size * 2);
			continue;
		}
		const s = segments[leaf.seg];
		segPt(s, leaf.t, _pt);
		const x = _pt.x + _pt.nx * leaf.off * treeScale;
		const y = _pt.y + _pt.ny * leaf.off * treeScale;
		/* Buds emerge from invisible points after winter. Retained dry leaves
           fade before the spring boundary, so no full crown appears in one frame. */
        let scale = 1, opacity = 1;
        if (t4 < 1) {
            scale = smoothstep(leaf.grow / 1.6, (leaf.grow + 0.5) / 1.6, sp);
            const bud = smoothstep(0, 0.12 + leaf.grow * 0.12, sp) * (1 - smoothstep(0.02, 0.22, scale));
            if (bud > 0.001) {
                ctx.globalAlpha = nightDim * bud;
                ctx.fillStyle = css(lerpC([120,90,60], [150,200,110], sp), 0.9);
                ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill();
            }
            if (scale <= 0.001) continue;
        } else if (t4 >= 3) {
            if (!leaf.winterKeep) continue;
            scale = 0.55;
            opacity = 1 - smoothstep(0.72, 1, sp);
        } else if (t4 >= 2 && leaf.winterKeep) {
            scale = 1 - 0.45 * smoothstep(0.80, 1, sp);
        }

		const flut = Math.sin(time * (2.2 + leaf.hue) + leaf.phase) * (0.12 + windSmooth * 0.55);
		let ri = Math.round((leaf.rot0 + flut) * (ROT_STEPS / 6.2832)) % ROT_STEPS;
		if (ri < 0) ri += ROT_STEPS;
		const sz = leaf.size * scale * (leafSkip > 1 ? 0.95 * Math.sqrt(leafSkip) : 1) * 1.25;
		const colors = leafColors(leaf, t4);
        ctx.globalAlpha = nightDim * opacity;
        ctx.drawImage(blendedLeaf(colors[0], colors[1], colors[2], ri), x - sz, y - sz, sz * 2, sz * 2);
        ctx.globalAlpha = nightDim;
	}
	ctx.globalAlpha = 1;
}

/* ---------- Precipitation and effects ---------- */
function drawRain(dt) {
	if (rainVisibility <= 0.002) return;
	const slant = windSmooth * 260;
	ctx.strokeStyle = 'rgba(190,205,228,0.55)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	const n = Math.ceil(rainDrops.length * rainVisibility);
 ctx.save(); ctx.globalAlpha = Math.min(1, rainVisibility * 2);
	for (let i = 0; i < n; i++) {
		const d = rainDrops[i];
		ctx.moveTo(d.x, d.y);
		ctx.lineTo(d.x - slant * 0.02 * d.len * 0.1, d.y + d.len);
	}
	ctx.stroke();
 ctx.restore();
	for (let i = 0; i < n; i++) {
		const d = rainDrops[i];
		d.y += d.v * dt * (0.6 + precipLevel * 0.6);
		d.x -= slant * dt;
		if (d.y > groundY + rand(0, 20)) { d.y = rand(-40, -5); d.x = rand(-50, W + 80); }
	}
	/* light haze near the ground */
	const mg = ctx.createLinearGradient(0, groundY - 30, 0, groundY + 10);
	mg.addColorStop(0, 'rgba(180,195,210,0)');
	mg.addColorStop(1, 'rgba(180,195,210,' + (0.18 * rainVisibility).toFixed(2) + ')');
	ctx.fillStyle = mg;
	ctx.fillRect(0, groundY - 30, W, 44);
}

let snowDrawn = 0;
function drawSnow(dt, time) {
	const snowing = snowVisibility > 0.002;
	if (!snowing) return;
	snowDrawn++;
	ctx.save(); ctx.globalAlpha = Math.min(1, snowVisibility * 2);
 ctx.fillStyle = dayNight > 0.5 ? 'rgba(225,232,245,0.9)' : 'rgba(255,255,255,0.92)';
	const n = Math.ceil(snowFlakes.length * snowVisibility);
	for (let i = 0; i < n; i++) {
		const f = snowFlakes[i];
		f.y += f.v * dt * (0.7 + precipLevel * 0.5);
		f.x += Math.sin(time * 1.3 + f.ph) * 14 * dt + windSmooth * 40 * dt;
		if (f.y > groundY - snowAmount * 18) { f.y = rand(-30, -5); f.x = rand(-20, W + 20); }
		ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
	}
ctx.restore();
}

let petalFade = 0;					  /* smooth visibility of the blossom drift */
function drawPetals(dt, time) {
	/* petals drift only in mid and late spring; they ease in and out with the season */
	const t4 = ((yearT % 4) + 4) % 4;
	let target = 0;
	if (t4 < 1) {
		const sp = seasonProgress();
		target = Math.min(Math.min(1, Math.max(0, (sp - 0.22) / 0.13)), Math.min(1, Math.max(0, (1 - sp) / 0.12)));
	}
	petalFade += (target - petalFade) * Math.min(1, dt * 1.6);
	if (petalFade <= 0.02) return;
	const rainCut = precipMode === 'rain' || precipMode === 'storm' ? 1 - precipLevel * 0.55 : 1;
	const n = Math.ceil(petals.length * petalFade * rainCut);
	const dim = (1 - dayNight * 0.45) * 0.96;
	for (let i = 0; i < petals.length; i++) {
		const p = petals[i];
		if (p.land > 0) {
			/* a landed petal rests on the ground for a moment, then a fresh one starts from the crown */
			p.land -= dt;
			if (p.land <= 0 || petalFade < 0.2) { Object.assign(p, newPetal(false)); continue; }
			ctx.globalAlpha = Math.min(1, p.land) * 0.55 * dim;
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.drawImage(petalSprites[p.c], -p.size, -p.size * 0.5, p.size * 2, p.size);
			ctx.restore();
			continue;
		}
		if (i >= n) continue;
		p.rot += p.spin * dt;
		p.y += p.v * dt * (0.8 + 0.4 * Math.sin(time * 1.1 + p.ph));
		p.x += (Math.sin(time * 0.9 + p.ph) * p.swayAmp + windSmooth * 30) * dt;
		if (p.x > W + 20) p.x = -10; else if (p.x < -20) p.x = W + 10;
		if (p.y >= groundY - 2 - snowAmount * 16) { p.land = rand(0.8, 1.8); p.y = groundY - 2 - snowAmount * 16; }
		const tumble = 0.7 + 0.3 * Math.sin(time * 2.3 + p.ph * 2);
		ctx.globalAlpha = dim;
		ctx.save();
		ctx.translate(p.x, p.y);
		ctx.rotate(p.rot);
		ctx.drawImage(petalSprites[p.c], -p.size, -p.size * tumble, p.size * 2, p.size * 2 * tumble);
		ctx.restore();
	}
	ctx.globalAlpha = 1;
}

function drawFireflies(time) {
	const summerGlow = seasonWeights()[1] * smoothstep(0.5, 0.8, dayNight);
 if (summerGlow < 0.002) return;
	for (const f of fireflies) {
		const glow = Math.max(0, Math.sin(time * f.sp * 2 + f.ph));
		if (glow < 0.25) continue;
		f.x += Math.sin(time * 0.4 + f.ph) * 0.25;
		f.y += Math.cos(time * 0.33 + f.ph * 2) * 0.18;
		ctx.save();
		ctx.globalAlpha = glow * 0.85 * summerGlow;
		const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 6);
		g.addColorStop(0, 'rgba(220,255,150,0.9)');
		g.addColorStop(1, 'rgba(220,255,150,0)');
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, 7); ctx.fill();
		ctx.restore();
	}
}

function drawFlowers(time) {
	const s = currentSeason(), sp = seasonProgress();
	const growth = s === 0 ? Math.min(1, Math.max(0, (sp - 0.12) / 0.62)) : s === 1 ? 1 : s === 2 ? Math.max(0, 1 - sp / 0.20) : 0;
	const snowCut = 1 - Math.min(1, snowAmount * 4);
	if (growth <= 0.01 || snowCut <= 0) return;
	ctx.save();
	for (let n = 0; n < flowers.length; n++) {
		const f = flowers[n];
		const stagger = (f.ph / 6.28) * 0.25;
		const scale = Math.min(1, Math.max(0, (growth - stagger) / (1 - stagger))) * snowCut;
		if (scale <= 0.01) continue;
		const sway = Math.sin(time * 1.8 + f.ph) * windSmooth * 2;
		const x = f.x + sway, y = f.y - (4 + f.s * 2) * scale, r = f.s * scale;
		ctx.globalAlpha = (1 - dayNight * 0.55) * Math.min(1, scale * 2);
		ctx.strokeStyle = '#527e35'; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(f.x, f.y + 2); ctx.quadraticCurveTo(f.x - sway, y + 4, x, y); ctx.stroke();
		const seedHead = n % 4 === 0 && (s === 1 || s === 2);
		const seedProgress = seedHead ? (s === 2 ? 1 : smoothstep(0.22 + stagger, 0.72 + stagger, sp)) : 0;
		if (!seedHead || seedProgress < 1) {
            const flowerAlpha = ctx.globalAlpha; ctx.globalAlpha *= 1 - smoothstep(0.35, 0.65, seedProgress);
			ctx.fillStyle = n % 4 === 0 ? '#f4d33a' : css(f.c);
			for (let p = 0; p < (n % 4 === 0 ? 9 : 5); p++) {
				const a = p / (n % 4 === 0 ? 9 : 5) * Math.PI * 2 + f.ph;
				ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, 0, 7); ctx.fill();
			}
			ctx.fillStyle = '#f8d348'; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, 7); ctx.fill();
            ctx.globalAlpha = flowerAlpha;
		}
        if (seedHead && seedProgress > 0.35) {
			/* Ripened dandelions release tiny parachutes into a gust. */
			ctx.strokeStyle = 'rgba(250,250,238,0.85)'; ctx.lineWidth = 0.65;
			for (let p = 0; p < 10; p++) {
				const a = p / 10 * Math.PI * 2;
				const drift = Math.max(0, seedProgress - 0.67 - p * 0.025) * 120;
				const dx = drift * (0.35 + windSmooth), dy = -drift * 0.32;
				ctx.globalAlpha = (1 - dayNight * 0.55) * Math.max(0, 1 - drift / 55) * smoothstep(0.35, 0.65, seedProgress) * (1 - smoothstep(0.85, 1, seedProgress));
				const tx = x + Math.cos(a) * r * 1.8 + dx, ty = y + Math.sin(a) * r * 1.8 + dy;
				ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(tx, ty); ctx.stroke();
				ctx.beginPath(); ctx.arc(tx, ty, 0.7, 0, 7); ctx.stroke();
			}
		}
	}
	ctx.restore();
}
function drawBirds(dt, time) {
	const birdVisibility = (1 - seasonWeights()[3]) * (1 - smoothstep(0.30, 0.55, dayNight)) * (1 - smoothstep(0.30, 0.65, precipLevel));
 ctx.save(); ctx.globalAlpha = birdVisibility;
	birdTimer -= dt;
	if (birdTimer <= 0 && birdsFly.length < 3 && birdVisibility > 0.2) {
		birdsFly.push({ x: -30, y: rand(H * 0.15, H * 0.4), vx: rand(40, 70), ph: rand(0, 6.28) });
		birdTimer = rand(9, 22);
	}
	ctx.strokeStyle = dayNight > 0.2 ? '#2a3040' : '#20262e';
	ctx.lineWidth = 1.6;
	ctx.lineCap = 'round';
	for (let i = birdsFly.length - 1; i >= 0; i--) {
		const b = birdsFly[i];
		b.x += b.vx * dt * (0.6 + windSmooth * 0.5);
		if (b.x > W + 40) { birdsFly.splice(i, 1); continue; }
		const flap = Math.sin(time * 9 + b.ph) * 5;
		ctx.beginPath();
		ctx.moveTo(b.x - 7, b.y + flap * 0.4);
		ctx.quadraticCurveTo(b.x - 3, b.y - 3 - flap, b.x, b.y);
		ctx.quadraticCurveTo(b.x + 3, b.y - 3 - flap, b.x + 7, b.y + flap * 0.4);
		ctx.stroke();
	}
 ctx.restore();
}
let lightningCount = 0, boltPts = [], boltBranches = [];
function makeBolt() {
	let x = W * rand(0.15, 0.85), y = H * 0.06;
	boltPts = [[x, y]]; boltBranches = [];
	const endY = groundY + 4;
	while (y < endY) {
		y += rand(H * 0.025, H * 0.06);
		x += rand(-W * 0.035, W * 0.035);
		boltPts.push([x, Math.min(y, endY)]);
		if (rng() < 0.28) {
			const br = [[x, y]];
			let bx = x, by = y;
			const dir = rng() < 0.5 ? -1 : 1;
			for (let k = 0; k < 3; k++) { bx += dir * rand(W * 0.01, W * 0.04); by += rand(H * 0.02, H * 0.05); br.push([bx, by]); }
			boltBranches.push(br);
		}
	}
}
function drawLightning() {
	if (lightning <= 0.01) return;
	ctx.save();
	if (lightning > 0.35 && boltPts.length) {
		const a = Math.min(1, (lightning - 0.35) / 0.4);
		ctx.lineJoin = 'round'; ctx.lineCap = 'round';
		const stroke = (pts, w, col, al) => {
			ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
			ctx.lineWidth = w; ctx.strokeStyle = col; ctx.globalAlpha = al; ctx.stroke();
		};
		stroke(boltPts, 9, 'rgba(170,200,255,1)', a * 0.35);
		for (const br of boltBranches) stroke(br, 5, 'rgba(170,200,255,1)', a * 0.3);
		stroke(boltPts, 2.6, '#ffffff', a);
		for (const br of boltBranches) stroke(br, 1.4, '#ffffff', a * 0.9);
	}
	ctx.globalAlpha = Math.min(0.6, lightning * 0.65);
	ctx.fillStyle = '#e6eeff';
	ctx.fillRect(0, 0, W, H);
	ctx.restore();
}

/* ---------- World update ---------- */
let cloudHit = { x: 0, y: 0, r: 60 };
let celHit = { sunX: 0, sunY: 0, moonX: 0, moonY: 0 };
const chips = Array.from(document.querySelectorAll('.chip'));
let shownSeason = -1;

function updateWorld(dt, time) {
	/* the seasonal cycle */
	yearT = (yearT + dt * speedMul / SEASON_SECONDS) % 4;
	const seasonNow = currentSeason();
	if (seasonNow !== previousSeason) {
		previousSeason = seasonNow;
		if (seasonNow === 3) {
			/* A winter begins bare, then fresh snowfall gradually settles. */
			if (paramWeather !== 'clear') {
				precipMode = 'snow'; autoWeatherOff = true; precipModeUntil = 35;
			}
			autoWeatherTimer = 12;
		} else if (precipMode === 'snow') {
			/* Spring keeps the settled cover, but stops the winter snowfall. */
			precipMode = 'off'; autoWeatherOff = false; autoWeatherTimer = 16;
		}
		if (seasonNow === 0) {
			for (const leaf of leaves) leaf.state = 'attached';
		}
	}
	/* day/night */
	if (autoDN) {
		dnTimer -= dt;
		if (dnTimer <= 0) {
			dayNightTarget = dayNightTarget > 0.5 ? 0 : 1;
			dnTimer = dayNightTarget > 0.5 ? rand(26, 36) : rand(52, 70);
		}
	}
	const dnSpeed = dt / 5;
	if (dayNight < dayNightTarget) dayNight = Math.min(dayNightTarget, dayNight + dnSpeed);
	else if (dayNight > dayNightTarget) dayNight = Math.max(dayNightTarget, dayNight - dnSpeed);
	/* wind: slow base + gusts */
	gustTimer -= dt;
	if (gustTimer <= 0) {
		gustTarget = rand(0, 1);
		gustTimer = rand(5, 14);
	}
	gust += (gustTarget - gust) * Math.min(1, dt * 0.8);
	const target = 0.18 + gust * 0.82;
	windSmooth += (target - windSmooth) * Math.min(1, dt * 1.2);
	Sound.setWind(windSmooth * (0.5 + precipLevel * 0.5));
	/* auto weather: downpours in spring and autumn, snowfalls in winter, rare in summer */
	autoWeatherTimer -= dt;
	if (autoWeatherTimer <= 0 && precipMode === 'off') {
		const s = currentSeason();
		if (s === 3) { precipMode = 'snow'; autoWeatherTimer = rand(18, 34); }
		else if (s === 0 || s === 2) { precipMode = rng() < 0.3 ? 'storm' : 'rain'; autoWeatherTimer = rand(12, 24); }
		else if (rng() < 0.45) { precipMode = 'rain'; autoWeatherTimer = rand(10, 18); }
		else autoWeatherTimer = rand(14, 26);
		precipModeUntil = autoWeatherTimer;
		autoWeatherOff = true;
	}
	if (autoWeatherOff) {
		precipModeUntil -= dt;
		if (precipModeUntil <= 0) {
			precipMode = 'off';
			autoWeatherOff = false;
			autoWeatherTimer = rand(25, 50);
		}
	}
	/* smooth precipitation strength */
	const pTarget = precipMode === 'off' ? 0 : (precipMode === 'storm' ? 1 : 0.7);
	precipLevel += (pTarget - precipLevel) * Math.min(1, dt * 0.8);
 rainVisibility += (((precipMode === 'rain' || precipMode === 'storm') ? precipLevel : 0) - rainVisibility) * Math.min(1, dt * 0.65);
 snowVisibility += ((precipMode === 'snow' ? precipLevel : 0) - snowVisibility) * Math.min(1, dt * 0.65);
	Sound.setRain(precipMode === 'rain' || precipMode === 'storm' ? precipLevel : 0);
	/* Seasonal settling continues even between snow showers. At the year boundary
	   the old cover remains and melts; only a manual season jump clears it. */
	if (seasonNow === 3) {
		const winterTarget = Math.min(1, seasonProgress() / 0.72);
		snowAmount += (winterTarget - snowAmount) * Math.min(1, dt * 0.7);
	} else if (seasonNow === 0) {
		snowAmount = Math.max(0, snowAmount - dt * speedMul / (SEASON_SECONDS * 0.30));
	} else snowAmount = Math.max(0, snowAmount - dt * 0.10);
	/* storm: flashes and thunder */
	if (precipMode === 'storm' && prevPrecipMode !== 'storm') lightningTimer = Math.min(lightningTimer, rand(3, 7));
	prevPrecipMode = precipMode;
	if (precipMode === 'storm' && precipLevel > 0.5) {
		lightningTimer -= dt;
		if (lightningTimer <= 0) {
			lightning = 1; lightningCount++; makeBolt();
			lightningTimer = rand(6, 18);
			setTimeout(() => Sound.thunder(), rand(600, 1600));
		}
	}
	lightning = Math.max(0, lightning - dt * 2.2);
	/* leaf fall in autumn */
	const t4 = ((yearT % 4) + 4) % 4;
	const sp = seasonProgress();
	if (t4 >= 2 && t4 < 3) {
		for (const leaf of leaves) {
			if (leaf.state === 'attached' && !leaf.winterKeep && sp > leaf.fallAt) {
				const s = segments[leaf.seg];
				leaf.state = 'falling';
				segPt(s, leaf.t, _pt);
				leaf.fx = _pt.x + _pt.nx * leaf.off * treeScale;
				leaf.fy = _pt.y + _pt.ny * leaf.off * treeScale;
				leaf.fvx = rand(-8, 8); leaf.fvy = rand(4, 16);
				leaf.frot = rand(0, 6.28); leaf.fspin = rand(-3, 3);
			}
		}
	}
	if (t4 < 2) {
		/* in spring and summer all leaves stay in place */
		for (const leaf of leaves) if (leaf.state !== 'attached') leaf.state = 'attached';
	}
	/* flight of falling leaves */
	for (const leaf of leaves) {
		if (leaf.state !== 'falling') continue;
		leaf.fvy = Math.min(70, leaf.fvy + 55 * dt);
		leaf.fx += (leaf.fvx + windSmooth * 55 + Math.sin(time * 3 + leaf.phase) * 22) * dt;
		leaf.fy += leaf.fvy * dt * (0.6 + 0.4 * Math.sin(time * 2.2 + leaf.phase));
		leaf.frot += leaf.fspin * dt;
		if (leaf.fy >= groundY - 2 - snowAmount * 16) {
			leaf.state = 'gone';
			if (groundLeaves.length < 700) {
				const gy = groundY + 4 + Math.pow(rng(), 1.4) * (H - groundY) * 0.5;
				groundLeaves.push({ x: leaf.fx + rand(-30, 30) * (0.5 + (gy - groundY) / 60), y: gy, rot: rand(0, 6.28), size: leaf.size * (0.8 + (gy - groundY) / (H - groundY) * 1.1), color: [3, 4, 4, 5, 6][Math.floor(rng() * 5)], life: 1 });
			}
		}
	}
	/* dry leaves on the ground melt and rot away */
	for (let i = groundLeaves.length - 1; i >= 0; i--) {
		if (!(t4 >= 2 && t4 < 3)) groundLeaves[i].life -= dt / (t4 >= 3 ? 30 : 20);
		if (groundLeaves[i].life <= 0) groundLeaves.splice(i, 1);
	}

	/* highlight of the active season */
	const cs = currentSeason();
	if (cs !== shownSeason) {
		shownSeason = cs;
		chips.forEach(c => { c.classList.toggle('active', +c.dataset.season === cs); c.setAttribute('aria-pressed', String(+c.dataset.season === cs)); });
	}
}
let precipModeUntil = 0, autoWeatherOff = false;
if (currentSeason() === 3 && !paramWeather) { precipMode = 'snow'; autoWeatherOff = true; precipModeUntil = 35; }

/* ---------- Main loop ---------- */
let lastT = 0;
const off = {};
function frame(ms) {
	if (document.hidden) { lastT = ms / 1000; requestAnimationFrame(frame); return; }
 const time = ms / 1000;
	let dt = Math.min(0.05, time - lastT || 0.016);
	if (!adaptOff && leafSkip < 2) { slowAcc += (time - lastT) || 0; slowN++; if (slowN >= 40) { if (slowAcc / slowN > 0.045) leafSkip++; slowAcc = 0; slowN = 0; } }
	lastT = time;
	updateWorld(dt, time);
	updateTree(time);
	if (!off.sky) drawSky();
	if (!off.cel) celHit = drawCelestial(time);
	if (!off.hills) drawHills();
	if (!off.clouds) cloudHit = drawClouds(dt);
	if (!off.ground) drawGround();
	if (cacheOn) {
		/* crown and trunk: the layer redraws ~20 times a second, everything else every frame */
		if (treeCacheT < 0 || time - treeCacheT >= TREE_INTERVAL || (treeCv.width !== canvas.width || treeCv.height !== canvas.height)) {
			treeCacheT = time;
			if (treeCv.width !== canvas.width || treeCv.height !== canvas.height) { treeCv.width = canvas.width; treeCv.height = canvas.height; }
			ctx = treeCtx;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, treeCv.width, treeCv.height);
			ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
			if (!off.tree) drawTree();
			if (!off.leaves) drawLeaves(time, 'static');
			ctx = mainCtx;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(treeCv, 0, 0);
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		if (!off.leaves) drawLeaves(time, 'falling');
	} else {
		if (!off.tree) drawTree();
		if (!off.leaves) drawLeaves(time);
	}
	if (dayNight > 0.03 && !off.night) {
		/* night darkening of foliage and trunk */
		ctx.save();
		ctx.globalCompositeOperation = 'multiply';
		ctx.globalAlpha = dayNight * 0.38;
		ctx.fillStyle = '#22355c';
		ctx.fillRect(0, 0, W, H);
		ctx.restore();
	}
	if (!off.rain) drawRain(dt);
	if (!off.snow) drawSnow(dt, time);
	if (!off.petals) drawPetals(dt, time);
	if (!off.flowers) drawFlowers(time);
	if (!off.birds) drawBirds(dt, time);
	if (!off.fireflies) drawFireflies(time);
	drawLightning();
	requestAnimationFrame(frame);
}

/* ---------- Interaction ---------- */
const hintEl = document.getElementById('hint');
setTimeout(() => hintEl.classList.add('faded'), 12000);

function onTap(x, y) {
	try { Sound.start(); } catch (_) { /* Sound must never block interaction. */ }
	hintEl.classList.add('faded');
	/* storm cloud */
	const dc = Math.hypot(x - cloudHit.x, y - cloudHit.y);
	if (dc < cloudHit.r) {
		const winter = currentSeason() === 3;
		if (precipMode === 'off') precipMode = winter ? 'snow' : 'rain';
		else if (precipMode === 'rain') precipMode = 'storm';
		else precipMode = 'off';
		autoWeatherOff = false;
		autoWeatherTimer = rand(30, 55);
		return;
	}
	/* sun / moon */
	const cx = dayNight < 0.5 ? celHit.sunX : celHit.moonX;
	const cy = dayNight < 0.5 ? celHit.sunY : celHit.moonY;
	if (Math.hypot(x - cx, y - cy) < 46) {
		dayNightTarget = dayNightTarget > 0.5 ? 0 : 1;
		dnTimer = dayNightTarget > 0.5 ? rand(26, 36) : rand(52, 70);
		return;
	}
	/* anything else - a gust of wind */
	gustTarget = 1;
	gustTimer = rand(1.2, 2.2);
}

function tapCanvas(e) {
 const p = e.touches ? e.touches[0] : e;
 const r = canvas.getBoundingClientRect();
 onTap((p.clientX - r.left) * W / r.width, (p.clientY - r.top) * H / r.height);
}
if (window.PointerEvent) canvas.addEventListener('pointerdown', tapCanvas);
else {
 let lastTouch = 0;
 canvas.addEventListener('touchstart', e => { lastTouch = Date.now(); tapCanvas(e); }, {passive:true});
 canvas.addEventListener('mousedown', e => { if (Date.now() - lastTouch > 700) tapCanvas(e); });
}

/* Manual choices restart the chosen story, never the clock. Rebuild only state,
   not geometry, so winter-to-autumn also restores a full living crown. */
function enterSeason(i) {
	yearT = i + 0.02;
	previousSeason = i;
	for (const leaf of leaves) leaf.state = i === 3 && !leaf.winterKeep ? 'gone' : 'attached';
	groundLeaves.length = 0;
	petalFade = 0;
	snowAmount = 0;
	autoWeatherOff = false;
	autoWeatherTimer = i === 3 ? 7 : rand(22, 35);
	if (i === 3) {
		precipMode = 'snow'; precipLevel = 0;
		autoWeatherOff = true; precipModeUntil = 35;
	} else if (precipMode === 'snow') {
		precipMode = 'off'; precipLevel = 0; rainVisibility = 0; snowVisibility = 0;
	}
	treeCacheT = -1;
	shownSeason = -1;
	chips.forEach(x => { x.classList.toggle('active', +x.dataset.season === i); x.setAttribute('aria-pressed', String(+x.dataset.season === i)); });
}

chips.forEach(c => c.addEventListener('click', e => {
	e.stopPropagation();
	try { Sound.start(); } catch (_) { /* Sound must never block interaction. */ }
	const i = +c.dataset.season;
	enterSeason(i);

}));

/* ---------- Scheduled nature sounds ---------- */
setInterval(() => {
	if (!Sound.started) return;
	const s = currentSeason();
	if (dayNight > 0.6) {
		if (s === 1 && rng() < 0.5) Sound.cricket();
		else if (rng() < 0.22) Sound.owl();
	} else if ((s === 0 || s === 1) && rng() < 0.4) {
		Sound.bird();
	}
}, 4200);

/* ---------- Size and startup ---------- */
function resize() {
	W = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 390);
 H = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 600);
 /* Five full-size canvas layers share a bounded pixel budget. */
 DPR = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2000000 / (W * H)), 4096 / W, 4096 / H);
	canvas.width = W * DPR; canvas.height = H * DPR;
	ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	groundY = H * 0.78;
	[hillsCanvas, groundCanvas, starsCanvas].forEach(c => { if (c) { c.width = 1; c.height = 1; } });
 treeCv.width = canvas.width; treeCv.height = canvas.height; treeCacheT = -1;
 buildBackground();
	buildTree();
	buildParticles();
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
buildLeafSprites();
buildRotSprites();
buildPetalSprites();
resize();
requestAnimationFrame(frame);

/* Control handle for state testing */
window.__scene = {
	setSeason(i, p) { enterSeason(i); yearT = i + (p === undefined ? 0.02 : p); },
	setNight(v) { autoDN = false; dayNightTarget = v ? 1 : 0; dayNight = dayNightTarget; },
	setWeather(m) { precipMode = m; precipLevel = m === 'off' ? 0 : 0.75; autoWeatherOff = false; autoWeatherTimer = 9999; },
	setSnow(v) { snowAmount = v; },
	gust() { gustTarget = 1; gustTimer = 2; },
	step(sec) { const t0 = performance.now() / 1000; for (let i = 0; i < sec / 0.05; i++) updateWorld(0.05, t0 + i * 0.05); },
	setAuto(v) { autoDN = v; },
	dn() { return [+dayNight.toFixed(2), dayNightTarget, +dnTimer.toFixed(1), leafSkip]; },
	off(n, v) { off[n] = v; },
	cache(v) { cacheOn = v; },
	interval(v) { TREE_INTERVAL = v; },
	noAdapt() { adaptOff = true; leafSkip = 1; },
	perf() { const r = {}; const m = (n, f) => { const t = performance.now(); for (let i = 0; i < 5; i++) f(); r[n] = +((performance.now() - t) / 5).toFixed(1); }; m('tree', drawTree); m('leaves', () => drawLeaves(1)); m('ground', drawGround); m('sky', drawSky); m('hills', drawHills); m('rain', () => drawRain(0.016)); m('snow', () => drawSnow(0.016, 1)); return r; },
	strike() { lightning = 1; lightningCount++; makeBolt(); },
	snap() {
		let att = 0, fall = 0;
		for (const l of leaves) { if (l.state === 'attached') att++; else if (l.state === 'falling') fall++; }
		return { yearT, cycling: true, season: currentSeason(), sp: +seasonProgress().toFixed(2), dayNight: +dayNight.toFixed(2), precipMode, precipLevel: +precipLevel.toFixed(2), snow: +snowAmount.toFixed(2), segs: segments.length, leaves: leaves.length, attached: att, falling: fall, ground: groundLeaves.length, wind: +windSmooth.toFixed(2), flakes: snowFlakes.length, f0: snowFlakes[0] ? [snowFlakes[0].x | 0, snowFlakes[0].y | 0] : null, snowDrawn, lightningCount, lightning: +lightning.toFixed(2) };
	}
};

 setTimeout(resize, 150);
 setTimeout(resize, 500);
}

function boot() {
 if (document.getElementById('scene')) {
  startLivingTree();
 } else {
  setTimeout(boot, 30);
 }
}
boot();
})();
