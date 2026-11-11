// sound presets, part 2, and the drum kit voicings
// mellow is one program split over the files in this folder: they share one global scope and load in numbered order (see index.html)
/* eslint-disable no-undef, no-unused-vars -- uses names that live in the other files of the folder; offers names the other files use */

// ---- end of block 3 ----
XP.push(
	/* AUTHOR 4 */
	// analog (w1/w2: 0 saw 1 square 2 tri 3 sine)
	{
		n: "VELVET SAW",
		c: "PAD",
		e: "ANA",
		p: { w1: 0, w2: 2, cut: 76, res: 14, det: 16, atk: 70, rel: 74 },
	},
	{
		n: "TAPE STRGS",
		c: "PAD",
		e: "ANA",
		p: { w1: 0, w2: 0, cut: 104, res: 10, det: 24, atk: 48, rel: 55 },
		d: 1,
	},
	{
		n: "HALO SINE",
		c: "AMBIENT",
		e: "ANA",
		p: { w1: 3, w2: 2, cut: 96, res: 6, det: 8, atk: 80, rel: 90 },
	},
	{
		n: "DRIFT SEA",
		c: "AMBIENT",
		e: "ANA",
		p: { w1: 0, w2: 2, cut: 56, res: 30, det: 55, atk: 90, rel: 99 },
	},
	{
		n: "RES SWELL",
		c: "PAD",
		e: "ANA",
		p: { w1: 0, w2: 0, cut: 60, res: 50, det: 12, atk: 75, rel: 60 },
	},
	{
		n: "SOFT BRASS",
		c: "KEYS",
		e: "ANA",
		p: { w1: 0, w2: 0, cut: 90, res: 16, det: 6, atk: 12, rel: 25 },
	},
	{
		n: "SUB HUM",
		c: "BASS",
		e: "ANA",
		p: { w1: 3, w2: 2, cut: 44, res: 6, det: 3, atk: 0, rel: 14 },
		d: 1,
	},
	{
		n: "MOSS BASS",
		c: "BASS",
		e: "ANA",
		p: { w1: 0, w2: 2, cut: 46, res: 24, det: 8, atk: 0, rel: 18 },
	},
	{
		n: "ZEN PLUCK",
		c: "KEYS",
		e: "ANA",
		p: { w1: 2, w2: 3, cut: 74, res: 60, det: 2, atk: 0, rel: 4 },
	},
	{
		n: "TAPE LEAD",
		c: "LOFI",
		e: "ANA",
		p: { w1: 0, w2: 2, cut: 54, res: 22, det: 20, atk: 6, rel: 30 },
	},
	{
		n: "PILLOW LD",
		c: "KEYS",
		e: "ANA",
		p: { w1: 2, w2: 1, cut: 88, res: 8, det: 9, atk: 6, rel: 35 },
	},
	{
		n: "LOW DRONE",
		c: "AMBIENT",
		e: "ANA",
		p: { w1: 0, w2: 2, cut: 46, res: 36, det: 25, atk: 99, rel: 99 },
	},
	{
		n: "WOW KEYS",
		c: "LOFI",
		e: "ANA",
		p: { w1: 2, w2: 2, cut: 70, res: 5, det: 35, atk: 12, rel: 42 },
		d: 1,
	},
	{
		n: "SUNDOWN PD",
		c: "PAD",
		e: "ANA",
		p: { w1: 0, w2: 1, cut: 94, res: 20, det: 10, atk: 60, rel: 85 },
	},
	// wavetable (pos 0-127 odd harmonics, warp even, drv push, tone brightness)
	{ n: "SOFT SINE", c: "AMBIENT", e: "WAVE", p: { pos: 0, warp: 0, drv: 0, tone: 55 } },
	{ n: "OCTAVE AIR", c: "AMBIENT", e: "WAVE", p: { pos: 0, warp: 74, drv: 0, tone: 91 } },
	{ n: "GLASS HARP", c: "AMBIENT", e: "WAVE", p: { pos: 118, warp: 0, drv: 98, tone: 82 } },
	{ n: "SOFT REED", c: "KEYS", e: "WAVE", p: { pos: 127, warp: 0, drv: 10, tone: 40 } },
	{ n: "OOH FORM", c: "PAD", e: "WAVE", p: { pos: 83, warp: 0, drv: 83, tone: 10 }, d: 1 },
	{ n: "AHH FORM", c: "PAD", e: "WAVE", p: { pos: 110, warp: 15, drv: 90, tone: 58 } },
	{ n: "DUSK ORGAN", c: "KEYS", e: "WAVE", p: { pos: 31, warp: 99, drv: 1, tone: 55 } },
	{ n: "SAW HAZE", c: "PAD", e: "WAVE", p: { pos: 127, warp: 83, drv: 10, tone: 35 } },
	{ n: "DIGI DEW", c: "KEYS", e: "WAVE", p: { pos: 113, warp: 37, drv: 37, tone: 85 } },
	{ n: "TINSEL", c: "AMBIENT", e: "WAVE", p: { pos: 91, warp: 97, drv: 1, tone: 96 } },
	{ n: "BOX KEYS", c: "LOFI", e: "WAVE", p: { pos: 14, warp: 12, drv: 3, tone: 17 } },
	{ n: "TAPE WAVE", c: "LOFI", e: "WAVE", p: { pos: 26, warp: 78, drv: 21, tone: 25 } },
	{ n: "DEEP WAVE", c: "BASS", e: "WAVE", p: { pos: 2, warp: 89, drv: 9, tone: 13 } },
	{ n: "WOOD BASS", c: "BASS", e: "WAVE", p: { pos: 64, warp: 11, drv: 43, tone: 25 } },
	// sampler (slice 0-7 of the factory loop: even = chord stabs Cmaj7 Am7 Fmaj7 G7, odd = kick snare hat open hat)
	{ n: "TAPE MAJ7", c: "LOFI", e: "SMP", p: { slice: 0, st: 0, pitch: -2, dir: 0 } },
	{ n: "SLO MIN7", c: "LOFI", e: "SMP", p: { slice: 2, st: 0, pitch: -12, dir: 0 } },
	{ n: "BLOOM REV", c: "AMBIENT", e: "SMP", p: { slice: 4, st: 10, pitch: 0, dir: 1 }, d: 1 },
	{ n: "TIDE REV", c: "AMBIENT", e: "SMP", p: { slice: 6, st: 0, pitch: -12, dir: 1 } },
	{ n: "PING DOM7", c: "KEYS", e: "SMP", p: { slice: 6, st: 20, pitch: 5, dir: 2 } },
	{ n: "THUD SUB", c: "BASS", e: "SMP", p: { slice: 1, st: 12, pitch: -7, dir: 0 } },
	{ n: "SOFT TAIL", c: "AMBIENT", e: "SMP", p: { slice: 2, st: 40, pitch: -7, dir: 0 } },
	{ n: "MUSIC TIN", c: "KEYS", e: "SMP", p: { slice: 0, st: 25, pitch: 12, dir: 0 } },
);

// ---- end of block 4 ----
XP.push(
	/* AUTHOR 5 */
	{
		n: "BOOMBAP",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [50, 46, 50, 48, 46, 50, 50, 36],
			dec: [46, 34, 12, 30, 30, 10, 22, 28],
			crush: [64, 60, 38, 40, 52, 50, 36, 48],
			vo: [
				[7, 10, 0, 6, 5, 4, 8, 8],
				[7, 9, 6, 8, 3, 8, 8, 10],
				[11, 5, 8, 0, 7, 8, 8, 9],
				[9, 4, 9, 0, 6, 9, 8, 8],
				[8, 8, 5, 6, 9, 4, 6, 11],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[6, 6, 12, 10, 5, 0, 8, 8],
				[6, 8, 10, 6, 4, 8, 8, 11],
			],
		},
		d: 1,
	}, // boom-bap: long round kick, dull top  [voiced: BOOM LOFI LOFI DARK DARK SOFT SOFT CONGA]
	{
		n: "SAMPLE 12",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [66, 72, 44, 40, 58, 64, 46, 54],
			dec: [36, 12, 8, 70, 8, 8, 8, 10],
			crush: [62, 60, 30, 32, 62, 50, 30, 58],
			vo: [
				[9, 4, 1, 6, 11, 9, 3, 9],
				[9, 6, 10, 10, 12, 5, 5, 11],
				[6, 11, 4, 0, 10, 12, 8, 12],
				[13, 9, 10, 2, 8, 6, 9, 9],
				[5, 5, 9, 9, 5, 7, 9, 12],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[13, 4, 8, 2, 10, 12, 0, 8],
			],
		},
	}, // snappy 12-bit sampler: punchy snare, long open hat  [voiced: PUNCH CRACK TICK SIZZ TIGHT CLICK TIGHT CLICK]
	{
		n: "VINYL BOP",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [42, 64, 52, 48, 40, 56, 50, 44],
			dec: [80, 8, 4, 20, 18, 8, 10, 52],
			crush: [56, 58, 24, 26, 50, 46, 22, 52],
			vo: [
				[6, 8, 0, 6, 4, 3, 4, 9],
				[7, 7, 7, 6, 4, 9, 9, 13],
				[9, 4, 9, 0, 6, 8, 8, 9],
				[9, 4, 9, 0, 6, 9, 8, 7],
				[8, 8, 5, 6, 9, 4, 6, 11],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[6, 6, 12, 10, 5, 0, 8, 8],
				[4, 11, 8, 4, 2, 6, 9, 11],
			],
		},
	}, // slow, dark and warm  [voiced: LOFI SOFT DARK DARK DARK SOFT SOFT TOM]
	{
		n: "CRATE DIG",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [70, 58, 66, 62, 68, 60, 64, 46],
			dec: [14, 44, 16, 56, 34, 6, 34, 36],
			crush: [60, 50, 34, 36, 48, 48, 30, 46],
			vo: [
				[8, 6, 0, 10, 9, 10, 3, 8],
				[8, 10, 8, 8, 6, 5, 4, 11],
				[7, 10, 3, 2, 9, 13, 8, 13],
				[8, 9, 5, 0, 9, 4, 10, 14],
				[3, 3, 10, 11, 4, 11, 10, 10],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[7, 12, 4, 7, 6, 5, 10, 4],
				[9, 7, 9, 5, 6, 9, 9, 9],
			],
		},
	}, // tight, bright swung kit  [voiced: TIGHT DRY SNAP SHORT SNAP CLICK SEED BONGO]
	{
		n: "TAPE SAT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [48, 48, 50, 46, 34, 52, 40, 44],
			dec: [26, 74, 30, 40, 80, 12, 58, 50],
			crush: [70, 66, 34, 36, 60, 56, 32, 56],
			vo: [
				[6, 7, 0, 12, 3, 3, 5, 8],
				[6, 11, 6, 9, 6, 11, 9, 6],
				[11, 5, 8, 0, 7, 8, 8, 7],
				[11, 5, 8, 0, 7, 8, 8, 9],
				[9, 10, 8, 6, 13, 8, 6, 4],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[8, 8, 6, 8, 8, 7, 8, 1],
				[6, 8, 10, 6, 4, 8, 8, 10],
			],
		},
	}, // fat tape: short kick, long snare and clap  [voiced: TAPE FAT LOFI LOFI ROOM SOFT DOUBLE CONGA]
	{
		n: "OLD CASSET",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [36, 30, 24, 22, 28, 30, 30, 20],
			dec: [56, 52, 16, 44, 40, 10, 32, 40],
			crush: [78, 80, 44, 46, 78, 70, 36, 76],
			vo: [
				[4, 8, 0, 8, 2, 3, 4, 9],
				[7, 9, 6, 8, 3, 8, 8, 10],
				[9, 4, 9, 0, 6, 8, 8, 7],
				[11, 5, 8, 0, 7, 8, 8, 8],
				[7, 9, 6, 7, 8, 5, 7, 12],
				[4, 4, 7, 12, 2, 11, 2, 8],
				[6, 6, 12, 10, 5, 0, 8, 8],
				[4, 11, 8, 4, 2, 6, 9, 13],
			],
		},
	}, // worn tape, pitched low and wobbly  [voiced: LOFI LOFI DARK LOFI LOFI TOCK SOFT TOM]
	{
		n: "REEL ROOM",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [44, 40, 30, 28, 40, 46, 36, 34],
			dec: [64, 54, 30, 84, 56, 12, 40, 50],
			crush: [62, 48, 36, 38, 46, 44, 34, 48],
			vo: [
				[0, 11, 0, 5, 4, 4, 6, 9],
				[6, 11, 6, 9, 6, 11, 9, 7],
				[10, 6, 8, 0, 7, 8, 8, 7],
				[11, 7, 12, 3, 7, 13, 8, 3],
				[9, 10, 8, 6, 13, 8, 6, 5],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[5, 5, 13, 13, 4, 0, 8, 5],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // slow reel, long smeared tails  [voiced: DUB FAT SOFT WASH ROOM SOFT BRUSH TOM]
	{
		n: "SOFT 808",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [36, 36, 70, 66, 48, 78, 74, 72],
			dec: [80, 40, 6, 36, 46, 10, 10, 40],
			crush: [72, 34, 12, 18, 26, 20, 12, 22],
			vo: [
				[4, 9, 0, 4, 2, 5, 12, 8],
				[7, 12, 9, 6, 7, 7, 4, 9],
				[4, 8, 8, 3, 8, 10, 8, 12],
				[4, 8, 9, 4, 8, 8, 10, 12],
				[5, 5, 9, 9, 5, 7, 9, 11],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[11, 6, 5, 3, 4, 10, 0, 6],
			],
		},
		d: 1,
	}, // sub kick, low snare, tick hats  [voiced: K808 S808 H808 H808 TIGHT CLICK TIGHT BLOCK]
	{
		n: "SUB HEART",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [28, 26, 56, 50, 30, 60, 54, 44],
			dec: [98, 22, 5, 30, 70, 10, 8, 86],
			crush: [60, 44, 28, 30, 38, 34, 26, 36],
			vo: [
				[4, 13, 1, 2, 6, 4, 12, 8],
				[7, 7, 7, 6, 4, 9, 9, 13],
				[10, 6, 8, 0, 7, 8, 8, 10],
				[9, 4, 9, 0, 6, 9, 8, 7],
				[8, 8, 5, 6, 9, 4, 6, 10],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[6, 6, 12, 10, 5, 0, 8, 9],
				[4, 11, 8, 4, 2, 6, 9, 10],
			],
		},
	}, // enormous soft sub, hushed top  [voiced: SOFT SOFT SOFT DARK DARK SOFT SOFT TOM]
	{
		n: "808 RAIN",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [56, 50, 84, 80, 58, 94, 96, 90],
			dec: [30, 16, 8, 40, 22, 8, 14, 30],
			crush: [72, 44, 10, 12, 34, 22, 6, 14],
			vo: [
				[4, 9, 0, 5, 4, 5, 6, 9],
				[7, 12, 9, 6, 7, 7, 4, 9],
				[4, 8, 8, 3, 8, 10, 8, 13],
				[3, 8, 9, 9, 8, 10, 8, 13],
				[5, 5, 9, 9, 5, 7, 9, 11],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[7, 12, 4, 7, 6, 5, 10, 6],
				[13, 4, 8, 2, 10, 12, 0, 5],
			],
		},
	}, // raindrop hats and shakers  [voiced: K808 S808 H808 RING TIGHT CLAVE SEED CLICK]
	{
		n: "SOFT 909",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [64, 66, 56, 56, 50, 60, 58, 58],
			dec: [40, 22, 24, 40, 52, 10, 24, 20],
			crush: [46, 24, 8, 12, 20, 18, 10, 16],
			vo: [
				[14, 3, 1, 5, 6, 9, 3, 10],
				[8, 8, 8, 8, 8, 8, 8, 9],
				[14, 8, 7, 0, 8, 8, 8, 9],
				[13, 9, 10, 2, 8, 6, 9, 10],
				[11, 12, 7, 5, 11, 9, 5, 4],
				[8, 8, 9, 8, 8, 10, 8, 6],
				[10, 10, 3, 5, 10, 0, 8, 10],
				[11, 6, 5, 3, 4, 10, 0, 8],
			],
		},
	}, // tamed four-on-floor  [voiced: PUNCH STD NOISE SIZZ WIDE RIM TIGHT BLOCK]
	{
		n: "GLASS 909",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [76, 80, 86, 82, 72, 78, 76, 68],
			dec: [18, 18, 10, 30, 26, 8, 12, 18],
			crush: [58, 4, 0, 0, 4, 4, 0, 4],
			vo: [
				[10, 0, 1, 8, 14, 12, 3, 9],
				[9, 6, 10, 10, 12, 5, 5, 9],
				[6, 11, 4, 0, 10, 12, 8, 11],
				[13, 9, 10, 2, 8, 6, 9, 11],
				[3, 3, 10, 11, 4, 11, 10, 9],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // bright, clean, hardly any crush  [voiced: CLICKY CRACK TICK SIZZ SNAP CLICK TIGHT CLICK]
	{
		n: "HOUSE MILK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [56, 48, 68, 64, 70, 56, 76, 38],
			dec: [46, 10, 12, 92, 12, 10, 64, 22],
			crush: [80, 38, 14, 12, 28, 26, 10, 24],
			vo: [
				[5, 7, 1, 5, 4, 9, 6, 9],
				[7, 7, 7, 6, 4, 9, 9, 13],
				[10, 6, 8, 0, 7, 8, 8, 9],
				[11, 7, 12, 3, 7, 13, 8, 3],
				[11, 12, 7, 5, 11, 9, 5, 6],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[8, 8, 6, 8, 8, 7, 8, 2],
				[6, 8, 10, 6, 4, 8, 8, 11],
			],
		},
	}, // long open hat and rolling shaker  [voiced: PUNCH SOFT SOFT WASH WIDE SOFT DOUBLE CONGA]
	{
		n: "SMOKE BAR",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [74, 32, 38, 36, 42, 44, 30, 36],
			dec: [12, 60, 22, 54, 32, 8, 46, 34],
			crush: [62, 58, 36, 38, 60, 56, 34, 52],
			vo: [
				[3, 11, 1, 3, 6, 4, 0, 11],
				[8, 2, 10, 11, 0, 4, 13, 1],
				[10, 6, 8, 0, 7, 8, 8, 8],
				[3, 8, 9, 9, 8, 10, 8, 11],
				[7, 9, 6, 7, 8, 5, 7, 11],
				[5, 6, 6, 11, 3, 13, 0, 8],
				[5, 5, 13, 13, 4, 0, 8, 5],
				[9, 7, 9, 5, 6, 9, 9, 10],
			],
		},
		d: 1,
	}, // brushed snare, small jazz kick, ride-ish open hat  [voiced: SOFT BRUSH SOFT RING LOFI WOOD BRUSH BONGO]
	{
		n: "BRUSHWORK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [80, 10, 12, 14, 24, 30, 24, 22],
			dec: [4, 99, 50, 80, 30, 8, 99, 30],
			crush: [88, 40, 26, 28, 60, 64, 24, 60],
			vo: [
				[5, 5, 1, 4, 7, 6, 1, 10],
				[8, 2, 10, 11, 0, 4, 13, 0],
				[10, 6, 8, 0, 7, 8, 8, 4],
				[11, 7, 12, 3, 7, 13, 8, 2],
				[8, 8, 5, 6, 9, 4, 6, 12],
				[6, 6, 5, 8, 2, 8, 5, 14],
				[5, 5, 13, 13, 4, 0, 8, 4],
				[4, 11, 8, 4, 2, 6, 9, 14],
			],
		},
	}, // whispering brush swirls  [voiced: WOODK BRUSH SOFT WASH DARK SOFT BRUSH TOM]
	{
		n: "LATE JAZZ",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [62, 60, 70, 62, 50, 60, 48, 24],
			dec: [18, 30, 44, 92, 24, 10, 36, 56],
			crush: [52, 46, 26, 28, 52, 50, 26, 40],
			vo: [
				[7, 5, 1, 6, 10, 5, 2, 9],
				[8, 10, 8, 8, 6, 5, 4, 11],
				[3, 9, 9, 10, 9, 8, 8, 15],
				[3, 8, 9, 9, 8, 10, 8, 11],
				[7, 9, 6, 7, 8, 5, 7, 11],
				[5, 6, 6, 11, 3, 13, 0, 7],
				[7, 12, 4, 7, 6, 5, 10, 3],
				[4, 11, 8, 4, 2, 6, 9, 13],
			],
		},
	}, // stick ride and floor tom  [voiced: SLAP DRY RING RING LOFI WOOD SEED TOM]
	{
		n: "8 BIT NAP",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [72, 82, 50, 48, 70, 76, 56, 78],
			dec: [12, 14, 5, 14, 10, 6, 8, 10],
			crush: [94, 84, 34, 36, 90, 84, 32, 86],
			vo: [
				[14, 2, 4, 13, 12, 11, 0, 7],
				[12, 7, 11, 10, 11, 5, 5, 12],
				[14, 8, 7, 0, 8, 8, 8, 13],
				[11, 5, 8, 0, 7, 8, 8, 9],
				[5, 5, 9, 9, 5, 7, 9, 14],
				[10, 10, 10, 4, 6, 4, 11, 13],
				[10, 10, 3, 5, 10, 0, 8, 12],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // crushed to dust, bright ticks on top  [voiced: BLIP TICK NOISE LOFI TIGHT CLICK TIGHT CLICK]
	{
		n: "BROKEN DSC",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [52, 48, 24, 22, 40, 50, 22, 30],
			dec: [16, 16, 6, 18, 14, 6, 10, 16],
			crush: [99, 95, 44, 46, 92, 90, 44, 95],
			vo: [
				[0, 8, 0, 14, 6, 6, 4, 9],
				[7, 9, 6, 8, 3, 8, 8, 12],
				[9, 4, 9, 0, 6, 8, 8, 8],
				[9, 4, 9, 0, 6, 9, 8, 8],
				[8, 8, 5, 6, 9, 4, 6, 13],
				[4, 4, 7, 12, 2, 11, 2, 7],
				[6, 6, 12, 10, 5, 0, 8, 9],
				[4, 11, 8, 4, 2, 6, 9, 14],
			],
		},
	}, // skipping disc, muffled and deep  [voiced: LOFI LOFI DARK DARK DARK TOCK SOFT TOM]
	{
		n: "GRIT WALK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [64, 46, 68, 64, 50, 70, 68, 54],
			dec: [36, 18, 8, 14, 26, 8, 44, 24],
			crush: [80, 78, 28, 30, 72, 70, 26, 74],
			vo: [
				[8, 4, 2, 11, 8, 8, 0, 8],
				[6, 11, 6, 9, 6, 11, 9, 9],
				[14, 8, 7, 0, 8, 8, 8, 13],
				[13, 9, 10, 2, 8, 6, 9, 13],
				[7, 9, 6, 7, 8, 5, 7, 11],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[7, 12, 4, 7, 6, 5, 10, 4],
				[9, 7, 9, 5, 6, 9, 9, 9],
			],
		},
	}, // gritty walk: short kick, long snare, bright hats  [voiced: GRIT FAT NOISE SIZZ LOFI CLICK SEED BONGO]
	{
		n: "WOOD BLOCK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [80, 58, 58, 52, 86, 90, 66, 94],
			dec: [28, 14, 5, 12, 4, 8, 8, 6],
			crush: [64, 32, 20, 22, 30, 24, 18, 16],
			vo: [
				[5, 5, 1, 4, 7, 6, 1, 10],
				[11, 12, 9, 5, 11, 3, 3, 9],
				[6, 11, 4, 0, 10, 12, 8, 13],
				[8, 9, 5, 0, 9, 4, 10, 12],
				[3, 3, 10, 11, 4, 11, 10, 10],
				[5, 6, 6, 11, 3, 13, 0, 7],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[11, 6, 5, 3, 4, 10, 0, 7],
			],
		},
	}, // hollow wood and clicks  [voiced: WOODK RIM TICK SHORT SNAP WOOD TIGHT BLOCK]
	{
		n: "CONGA DAY",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [58, 26, 70, 66, 40, 80, 74, 66],
			dec: [20, 44, 6, 28, 14, 8, 40, 34],
			crush: [50, 26, 16, 20, 30, 24, 14, 24],
			vo: [
				[2, 9, 1, 2, 9, 3, 2, 10],
				[8, 10, 8, 8, 6, 5, 4, 10],
				[10, 6, 8, 0, 7, 8, 8, 10],
				[8, 9, 5, 0, 9, 4, 10, 12],
				[7, 9, 6, 7, 8, 5, 7, 12],
				[5, 6, 6, 11, 3, 13, 0, 7],
				[6, 6, 12, 10, 5, 0, 8, 7],
				[6, 8, 10, 6, 4, 8, 8, 9],
			],
		},
		d: 1,
	}, // low congas, light shaker  [voiced: FOLK DRY SOFT SHORT LOFI WOOD SOFT CONGA]
	{
		n: "TABLA MIST",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [88, 60, 30, 28, 50, 62, 40, 86],
			dec: [24, 44, 8, 20, 22, 8, 18, 58],
			crush: [66, 26, 40, 42, 32, 26, 44, 18],
			vo: [
				[7, 12, 1, 3, 3, 2, 6, 8],
				[4, 13, 5, 4, 4, 10, 6, 8],
				[10, 6, 8, 0, 7, 8, 8, 9],
				[11, 7, 12, 3, 7, 13, 8, 5],
				[8, 8, 5, 6, 9, 4, 6, 11],
				[4, 4, 7, 12, 2, 11, 2, 7],
				[6, 6, 12, 10, 5, 0, 8, 9],
				[9, 7, 9, 5, 6, 9, 9, 7],
			],
		},
	}, // pitched hand drums that ring  [voiced: BAYA TOMSN SOFT WASH DARK TOCK SOFT BONGO]
	{
		n: "BELL TREE",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [42, 26, 64, 60, 38, 74, 36, 99],
			dec: [28, 22, 8, 30, 20, 10, 50, 82],
			crush: [64, 30, 14, 16, 24, 20, 12, 8],
			vo: [
				[11, 5, 1, 4, 5, 11, 4, 9],
				[11, 12, 9, 5, 11, 3, 3, 9],
				[3, 9, 9, 10, 9, 8, 8, 15],
				[3, 8, 9, 9, 8, 10, 8, 11],
				[5, 5, 9, 9, 5, 7, 9, 12],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[11, 11, 5, 9, 11, 9, 6, 1],
				[10, 12, 12, 12, 2, 10, 8, 1],
			],
		},
	}, // bell perc, tambourine shaker  [voiced: WOODK RIM RING RING TIGHT CLAVE TAMB BELL]
	{
		n: "RIMSHOT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [50, 66, 54, 50, 52, 22, 52, 48],
			dec: [28, 26, 12, 50, 30, 8, 28, 34],
			crush: [72, 64, 30, 32, 64, 18, 28, 64],
			vo: [
				[7, 5, 1, 6, 10, 5, 2, 10],
				[8, 10, 8, 8, 6, 5, 4, 11],
				[8, 8, 8, 0, 8, 8, 8, 11],
				[8, 9, 5, 0, 9, 4, 10, 12],
				[5, 5, 9, 9, 5, 7, 9, 12],
				[8, 8, 9, 8, 8, 10, 8, 7],
				[10, 10, 3, 5, 10, 0, 8, 10],
				[11, 6, 5, 3, 4, 10, 0, 8],
			],
		},
	}, // rim up front, dry short snare  [voiced: SLAP DRY STD SHORT TIGHT RIM TIGHT BLOCK]
	{
		n: "CLAPBACK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [46, 30, 52, 50, 66, 60, 54, 40],
			dec: [38, 20, 8, 26, 90, 8, 14, 30],
			crush: [66, 50, 22, 26, 20, 38, 20, 38],
			vo: [
				[9, 4, 1, 6, 7, 9, 0, 10],
				[7, 7, 7, 6, 4, 9, 9, 13],
				[11, 5, 8, 0, 7, 8, 8, 9],
				[11, 5, 8, 0, 7, 8, 8, 8],
				[11, 12, 7, 5, 11, 9, 5, 3],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[6, 6, 12, 10, 5, 0, 8, 8],
				[6, 8, 10, 6, 4, 8, 8, 11],
			],
		},
	}, // big soft clap on the two  [voiced: PUNCH SOFT LOFI LOFI WIDE SOFT SOFT CONGA]
	{
		n: "FINGERS",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [44, 30, 92, 88, 96, 98, 90, 66],
			dec: [30, 10, 3, 14, 4, 5, 6, 14],
			crush: [60, 40, 6, 8, 12, 14, 6, 22],
			vo: [
				[6, 3, 1, 5, 11, 12, 0, 10],
				[12, 6, 11, 7, 10, 5, 5, 14],
				[6, 11, 4, 0, 10, 12, 8, 11],
				[8, 9, 5, 0, 9, 4, 10, 14],
				[2, 2, 11, 12, 3, 12, 11, 11],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[10, 10, 3, 5, 10, 0, 8, 12],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // finger snaps and ticks  [voiced: CLICKY TICK TICK SHORT FINGER CLICK TIGHT CLICK]
	{
		n: "TICK TOCK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [90, 94, 96, 90, 92, 99, 86, 98],
			dec: [4, 3, 2, 6, 3, 3, 3, 8],
			crush: [54, 10, 4, 6, 8, 6, 4, 8],
			vo: [
				[10, 3, 1, 8, 14, 12, 0, 9],
				[12, 6, 11, 7, 10, 5, 5, 11],
				[7, 10, 3, 2, 9, 13, 8, 10],
				[8, 9, 5, 0, 9, 4, 10, 14],
				[2, 2, 11, 12, 3, 12, 11, 11],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[10, 10, 3, 5, 10, 0, 8, 12],
				[13, 4, 8, 2, 10, 12, 0, 6],
			],
		},
		d: 1,
	}, // clocks and clicks  [voiced: CLICKY TICK SNAP SHORT FINGER CLAVE TIGHT CLICK]
	{
		n: "SOFT TOMS",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [38, 10, 34, 30, 26, 30, 34, 16],
			dec: [60, 66, 5, 32, 24, 8, 18, 72],
			crush: [58, 36, 30, 32, 38, 36, 28, 28],
			vo: [
				[3, 6, 1, 2, 8, 3, 0, 11],
				[4, 13, 5, 4, 4, 10, 6, 9],
				[10, 6, 8, 0, 7, 8, 8, 9],
				[9, 4, 9, 0, 6, 9, 8, 7],
				[8, 8, 5, 6, 9, 4, 6, 12],
				[4, 4, 7, 12, 2, 11, 2, 8],
				[6, 6, 12, 10, 5, 0, 8, 8],
				[4, 11, 8, 4, 2, 6, 9, 13],
			],
		},
	}, // rolling low toms, whisper hats  [voiced: TOM TOMSN SOFT DARK DARK TOCK SOFT TOM]
	{
		n: "DRIP KIT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [96, 76, 70, 66, 60, 94, 80, 92],
			dec: [24, 14, 6, 30, 12, 8, 10, 64],
			crush: [58, 18, 10, 12, 16, 12, 8, 12],
			vo: [
				[15, 6, 0, 8, 6, 8, 0, 5],
				[12, 6, 11, 7, 10, 5, 5, 12],
				[3, 9, 9, 10, 9, 8, 8, 15],
				[3, 8, 9, 9, 8, 10, 8, 12],
				[5, 5, 9, 9, 5, 7, 9, 12],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[7, 12, 4, 7, 6, 5, 10, 4],
				[10, 12, 12, 12, 2, 10, 8, 2],
			],
		},
	}, // water drop pitches  [voiced: ZAP TICK RING RING TIGHT CLAVE SEED BELL]
	{
		n: "CAVE KIT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [30, 22, 30, 26, 24, 30, 28, 20],
			dec: [90, 86, 32, 94, 78, 12, 74, 92],
			crush: [68, 64, 52, 54, 60, 56, 50, 60],
			vo: [
				[2, 12, 1, 2, 2, 3, 9, 8],
				[4, 13, 5, 4, 4, 10, 6, 9],
				[9, 4, 9, 0, 6, 8, 8, 6],
				[9, 4, 9, 0, 6, 9, 8, 7],
				[8, 8, 5, 6, 9, 4, 6, 10],
				[4, 4, 7, 12, 2, 11, 2, 8],
				[5, 5, 13, 13, 4, 0, 8, 5],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // sparse, low and hollow  [voiced: TOM TOMSN DARK DARK DARK TOCK BRUSH TOM]
	{
		n: "SLOW DRIFT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [60, 66, 70, 66, 60, 70, 76, 76],
			dec: [70, 62, 52, 99, 60, 12, 88, 98],
			crush: [56, 6, 2, 4, 8, 6, 2, 8],
			vo: [
				[5, 10, 0, 6, 5, 4, 8, 8],
				[7, 7, 7, 6, 4, 9, 9, 10],
				[12, 10, 10, 4, 8, 11, 8, 6],
				[11, 7, 12, 3, 7, 13, 8, 3],
				[9, 10, 8, 6, 13, 8, 6, 4],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[5, 5, 13, 13, 4, 0, 8, 3],
				[10, 12, 12, 12, 2, 10, 8, 1],
			],
		},
	}, // airy, high and drifting  [voiced: BOOM SOFT SIZZ WASH ROOM SOFT BRUSH BELL]
	{
		n: "SNAPBACK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [60, 62, 36, 32, 56, 68, 36, 48],
			dec: [9, 12, 5, 9, 6, 5, 5, 6],
			crush: [66, 12, 6, 6, 14, 10, 6, 10],
			vo: [
				[8, 3, 0, 10, 9, 10, 0, 10],
				[9, 6, 10, 10, 12, 5, 5, 10],
				[7, 10, 3, 2, 9, 13, 8, 7],
				[8, 9, 5, 0, 9, 4, 10, 10],
				[3, 3, 10, 11, 4, 11, 10, 10],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[13, 4, 8, 2, 10, 12, 0, 8],
			],
		},
	}, // short, bright and upfront  [voiced: TIGHT CRACK SNAP SHORT SNAP CLICK TIGHT CLICK]
	{
		n: "KNOCKOUT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [30, 24, 30, 28, 20, 30, 30, 20],
			dec: [18, 16, 6, 12, 10, 6, 5, 14],
			crush: [60, 38, 30, 32, 40, 34, 28, 34],
			vo: [
				[7, 4, 1, 11, 9, 6, 0, 10],
				[8, 10, 8, 8, 6, 5, 4, 11],
				[9, 4, 9, 0, 6, 8, 8, 8],
				[8, 9, 5, 0, 9, 4, 10, 11],
				[5, 5, 9, 9, 5, 7, 9, 13],
				[4, 4, 7, 12, 2, 11, 2, 8],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[4, 11, 8, 4, 2, 6, 9, 15],
			],
		},
	}, // dry, low and heavy  [voiced: HEAVY DRY DARK SHORT TIGHT TOCK TIGHT TOM]
	{
		n: "HALL KIT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [44, 36, 66, 60, 38, 50, 66, 30],
			dec: [76, 82, 30, 90, 84, 12, 64, 84],
			crush: [60, 14, 6, 6, 12, 12, 6, 14],
			vo: [
				[4, 9, 0, 5, 5, 5, 6, 9],
				[6, 10, 7, 10, 9, 14, 13, 2],
				[10, 6, 8, 0, 7, 8, 8, 7],
				[11, 7, 12, 3, 7, 13, 8, 2],
				[9, 10, 8, 6, 13, 8, 6, 4],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[6, 6, 12, 10, 5, 0, 8, 6],
				[4, 11, 8, 4, 2, 6, 9, 11],
			],
		},
	}, // big drums in a big room  [voiced: K808 GATED SOFT WASH ROOM SOFT SOFT TOM]
	{
		n: "ARENA DUST",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [30, 72, 40, 36, 64, 40, 44, 26],
			dec: [99, 70, 16, 60, 88, 12, 44, 90],
			crush: [70, 64, 36, 38, 66, 60, 34, 70],
			vo: [
				[5, 10, 0, 6, 5, 4, 10, 8],
				[6, 10, 7, 10, 9, 14, 13, 2],
				[11, 5, 8, 0, 7, 8, 8, 8],
				[11, 5, 8, 0, 7, 8, 8, 8],
				[9, 10, 8, 6, 13, 8, 6, 4],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[5, 5, 13, 13, 4, 0, 8, 5],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // huge, dusty, gated snare  [voiced: BOOM GATED LOFI LOFI ROOM SOFT BRUSH TOM]
	{
		n: "DEEP FOLK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [26, 30, 50, 44, 30, 56, 70, 26],
			dec: [70, 30, 10, 28, 22, 8, 50, 40],
			crush: [36, 40, 28, 30, 38, 34, 22, 36],
			vo: [
				[2, 9, 1, 2, 9, 3, 2, 10],
				[4, 13, 5, 4, 4, 10, 6, 9],
				[10, 6, 8, 0, 7, 8, 8, 9],
				[9, 4, 9, 0, 6, 9, 8, 7],
				[7, 9, 6, 7, 8, 5, 7, 12],
				[5, 6, 6, 11, 3, 13, 0, 7],
				[7, 12, 4, 7, 6, 5, 10, 4],
				[6, 8, 10, 6, 4, 8, 8, 12],
			],
		},
	}, // frame drum and shakers  [voiced: FOLK TOMSN SOFT DARK LOFI WOOD SEED CONGA]
);

// ---- end of block 5 ----
XP.push(
	/* AUTHOR 6: drum voicings (more kits; the kit data is tune, dec, crush and vo, 8 pads x 8 nibbles, see drumHit) */
	{
		n: "808 DEEP",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [32, 40, 70, 64, 48, 60, 66, 36],
			dec: [82, 30, 8, 34, 28, 8, 12, 36],
			crush: [30, 28, 10, 12, 20, 16, 10, 18],
			vo: [
				[8, 9, 0, 5, 5, 5, 10, 8],
				[7, 12, 9, 6, 7, 7, 4, 9],
				[4, 8, 8, 3, 8, 10, 8, 11],
				[4, 8, 9, 4, 8, 8, 10, 12],
				[5, 5, 9, 9, 5, 7, 9, 11],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // deep 808: long sine boom with a sub, tonal snare, metal hats
	{
		n: "PUNCHY",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [60, 52, 58, 56, 52, 60, 58, 56],
			dec: [20, 26, 6, 24, 24, 8, 14, 20],
			crush: [22, 22, 8, 10, 14, 14, 8, 12],
			vo: [
				[9, 4, 1, 6, 8, 9, 0, 10],
				[9, 6, 10, 10, 12, 5, 5, 9],
				[6, 11, 4, 0, 10, 12, 8, 11],
				[8, 9, 5, 0, 9, 4, 10, 11],
				[3, 3, 10, 11, 4, 11, 10, 10],
				[10, 10, 10, 4, 6, 4, 11, 11],
				[10, 10, 3, 5, 10, 0, 8, 10],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // tight punchy electronic: fast pitch drop, bright beater click
	{
		n: "LOFI CRSH",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [44, 46, 40, 38, 42, 44, 40, 40],
			dec: [34, 38, 12, 36, 34, 10, 24, 30],
			crush: [92, 88, 70, 72, 86, 80, 64, 80],
			vo: [
				[8, 8, 0, 6, 4, 3, 4, 9],
				[7, 9, 6, 8, 3, 8, 8, 11],
				[11, 5, 8, 0, 7, 8, 8, 12],
				[11, 5, 8, 0, 7, 8, 8, 12],
				[7, 9, 6, 7, 8, 5, 7, 12],
				[4, 4, 7, 12, 2, 11, 2, 8],
				[6, 6, 12, 10, 5, 0, 8, 10],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // dusty lo-fi, crushed hard: round kick, dull top
	{
		n: "SOFT THUMP",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [46, 36, 50, 46, 36, 50, 50, 34],
			dec: [30, 40, 8, 30, 40, 8, 22, 40],
			crush: [34, 30, 14, 16, 26, 22, 14, 20],
			vo: [
				[3, 9, 1, 0, 6, 4, 3, 10],
				[7, 7, 7, 6, 4, 9, 9, 11],
				[10, 6, 8, 0, 7, 8, 8, 9],
				[9, 4, 9, 0, 6, 9, 8, 6],
				[8, 8, 5, 6, 9, 4, 6, 10],
				[6, 6, 5, 8, 2, 8, 5, 13],
				[6, 6, 12, 10, 5, 0, 8, 7],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // acoustic-ish: a soft thump of a kick with almost no pitch drop
	{
		n: "HARD TECH",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [50, 56, 66, 62, 56, 64, 62, 56],
			dec: [34, 24, 8, 22, 20, 8, 12, 22],
			crush: [24, 20, 6, 6, 12, 10, 6, 8],
			vo: [
				[11, 5, 2, 13, 12, 10, 0, 8],
				[9, 6, 10, 10, 12, 5, 5, 9],
				[14, 8, 7, 0, 8, 8, 8, 11],
				[13, 9, 10, 2, 8, 6, 9, 10],
				[3, 3, 10, 11, 4, 11, 10, 10],
				[10, 10, 10, 4, 6, 4, 11, 11],
				[10, 10, 3, 5, 10, 0, 8, 10],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // hard techno: clipped square kick, noisy hats
	{
		n: "ELECTRO",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [54, 50, 68, 64, 50, 62, 64, 60],
			dec: [24, 22, 7, 26, 22, 8, 14, 22],
			crush: [38, 32, 14, 16, 26, 22, 14, 22],
			vo: [
				[12, 3, 4, 10, 12, 11, 0, 7],
				[9, 6, 10, 10, 12, 5, 5, 10],
				[4, 8, 8, 3, 8, 10, 8, 11],
				[4, 8, 9, 4, 8, 8, 10, 12],
				[3, 3, 10, 11, 4, 11, 10, 10],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[9, 7, 9, 5, 6, 9, 9, 9],
			],
		},
	}, // electro: clicky blip kick, metal hats, clave
	{
		n: "DUB SUB",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [28, 34, 50, 44, 34, 52, 50, 30],
			dec: [99, 40, 10, 50, 44, 8, 24, 50],
			crush: [26, 30, 18, 20, 26, 22, 18, 24],
			vo: [
				[2, 13, 0, 3, 2, 4, 15, 8],
				[7, 12, 9, 6, 7, 7, 4, 9],
				[9, 4, 9, 0, 6, 8, 8, 7],
				[9, 4, 9, 0, 6, 9, 8, 6],
				[9, 10, 8, 6, 13, 8, 6, 5],
				[4, 4, 7, 12, 2, 11, 2, 7],
				[6, 6, 12, 10, 5, 0, 8, 7],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // dub: a huge sub kick that rings, dark top
	{
		n: "GABBA",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [46, 54, 70, 66, 52, 66, 64, 56],
			dec: [56, 26, 6, 26, 22, 8, 12, 22],
			crush: [18, 16, 6, 6, 10, 8, 6, 8],
			vo: [
				[10, 7, 3, 15, 10, 9, 0, 9],
				[9, 6, 10, 10, 12, 5, 5, 9],
				[14, 8, 7, 0, 8, 8, 8, 12],
				[13, 9, 10, 2, 8, 6, 9, 10],
				[5, 5, 9, 9, 5, 7, 9, 11],
				[10, 10, 10, 4, 6, 4, 11, 11],
				[10, 10, 3, 5, 10, 0, 8, 10],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // gabber: a saw kick driven flat
	{
		n: "FLOOR TOM",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [42, 40, 60, 56, 44, 56, 56, 26],
			dec: [60, 50, 8, 36, 40, 8, 22, 70],
			crush: [40, 34, 16, 18, 28, 24, 16, 22],
			vo: [
				[3, 8, 1, 2, 10, 5, 3, 9],
				[4, 13, 5, 4, 4, 10, 6, 9],
				[10, 6, 8, 0, 7, 8, 8, 9],
				[9, 4, 9, 0, 6, 9, 8, 7],
				[8, 8, 5, 6, 9, 4, 6, 10],
				[5, 6, 6, 11, 3, 13, 0, 7],
				[6, 6, 12, 10, 5, 0, 8, 7],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // tom kit: triangle-bodied kick, tom snare
	{
		n: "CLICK POP",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [66, 64, 76, 72, 60, 72, 70, 66],
			dec: [10, 14, 4, 12, 12, 6, 8, 12],
			crush: [18, 14, 4, 4, 8, 6, 4, 6],
			vo: [
				[10, 3, 1, 8, 14, 12, 0, 8],
				[12, 6, 11, 7, 10, 5, 5, 12],
				[7, 10, 3, 2, 9, 13, 8, 10],
				[8, 9, 5, 0, 9, 4, 10, 12],
				[2, 2, 11, 12, 3, 12, 11, 10],
				[10, 10, 10, 4, 6, 4, 11, 11],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // micro house: tiny clicks and pops
	{
		n: "TRAP 808",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [30, 48, 86, 80, 50, 70, 80, 44],
			dec: [96, 26, 3, 22, 26, 6, 8, 30],
			crush: [28, 24, 6, 8, 14, 12, 6, 12],
			vo: [
				[4, 9, 0, 4, 1, 5, 15, 8],
				[7, 12, 9, 6, 7, 7, 4, 9],
				[6, 11, 4, 0, 10, 12, 8, 11],
				[4, 8, 9, 4, 8, 8, 10, 13],
				[3, 3, 10, 11, 4, 11, 10, 9],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[10, 10, 3, 5, 10, 0, 8, 11],
				[13, 4, 8, 2, 10, 12, 0, 7],
			],
		},
	}, // trap: very long 808 sub, ticking hats
	{
		n: "ZAP KICK",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [48, 60, 72, 68, 56, 66, 66, 64],
			dec: [30, 22, 6, 24, 22, 8, 12, 24],
			crush: [26, 22, 10, 10, 16, 14, 10, 14],
			vo: [
				[15, 6, 0, 8, 6, 8, 0, 8],
				[11, 12, 9, 5, 11, 3, 3, 9],
				[3, 9, 9, 10, 9, 8, 8, 15],
				[3, 8, 9, 9, 8, 10, 8, 12],
				[5, 5, 9, 9, 5, 7, 9, 11],
				[12, 11, 8, 3, 0, 15, 0, 4],
				[7, 12, 4, 7, 6, 5, 10, 4],
				[10, 12, 12, 12, 2, 10, 8, 4],
			],
		},
	}, // laser kick: a huge pitch drop, ringing metal
	{
		n: "ROOM KIT",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [50, 44, 54, 50, 44, 52, 52, 36],
			dec: [56, 56, 16, 60, 50, 10, 30, 60],
			crush: [24, 20, 8, 8, 14, 12, 8, 12],
			vo: [
				[8, 8, 1, 3, 6, 5, 7, 9],
				[6, 11, 6, 9, 6, 11, 9, 6],
				[8, 8, 8, 0, 8, 8, 8, 8],
				[11, 7, 12, 3, 7, 13, 8, 3],
				[9, 10, 8, 6, 13, 8, 6, 4],
				[8, 8, 9, 8, 8, 10, 8, 6],
				[8, 8, 6, 8, 8, 7, 8, 1],
				[4, 11, 8, 4, 2, 6, 9, 12],
			],
		},
	}, // a live-room kit: slap kick, fat snare, long wash
	{
		n: "BREAKS",
		c: "DRUMS",
		e: "DRUM",
		p: {
			tune: [54, 58, 62, 60, 56, 60, 58, 50],
			dec: [30, 28, 8, 30, 26, 8, 16, 26],
			crush: [60, 56, 36, 38, 50, 44, 34, 44],
			vo: [
				[8, 4, 2, 11, 8, 8, 0, 9],
				[9, 6, 10, 10, 12, 5, 5, 10],
				[11, 5, 8, 0, 7, 8, 8, 11],
				[11, 5, 8, 0, 7, 8, 8, 10],
				[7, 9, 6, 7, 8, 5, 7, 11],
				[10, 10, 10, 4, 6, 4, 11, 12],
				[7, 12, 4, 7, 6, 5, 10, 4],
				[9, 7, 9, 5, 6, 9, 9, 10],
			],
		},
	}, // chopped breaks: gritty kick, cracking snare
);

const BRUSHVO = [
	[3, 11, 1, 2, 3, 4, 0, 11],
	[8, 2, 10, 9, 0, 4, 13, 5],
	[10, 6, 8, 0, 7, 8, 8, 8],
	[9, 4, 9, 0, 6, 9, 8, 7],
	[7, 9, 6, 7, 8, 5, 7, 11],
	[6, 6, 5, 8, 2, 8, 5, 13],
	[5, 5, 13, 13, 4, 0, 8, 6],
	[4, 11, 8, 4, 2, 6, 9, 13],
];
// BRUSH KIT's voicing (the kit has no DRUMP entry: it is set in applyPreset0)

XP.forEach((x) => {
	PRESETS.push(x.e === "FM" ? [x.n, x.c, "FM", x.p[0]] : [x.n, x.c, x.e]);
	if (x.e === "FM") {
		FMP[x.n] = x.p;
	} else if (x.e === "ANA") {
		ANAP[x.n] = x.p;
	} else if (x.e === "WAVE") {
		WTP[x.n] = x.p;
	} else if (x.e === "SMP") {
		SMPP[x.n] = x.p;
	} else {
		DRUMP[x.n] = x.p;
	}
	if (!x.d) {
		PHONEP.add(x.n);
	}
});

function applyPreset(i) {
	applyPreset0(i);
	snapBase();
}

function applyPreset0(i) {
	const p = PRESETS[i],
		nm = p[0],
		en = p[2];
	if (p[1] === "USER") {
		const u = USERP[nm];
		if (!u || !userOk(nm, u)) {
			return;
		}
		const v = JSON.parse(JSON.stringify(u.snap)),
			bk = JSON.parse(JSON.stringify(S.tk[S._trk]));
		try {
			if (en === "FM") {
				S.alg = v.alg;
				S.fb = v.fb;
				v.ops.forEach((o, k) => Object.assign(S.ops[k], o));
				Object.assign(S.lfo, v.lfo);
				if (v.pegR) {
					S.pegR = v.pegR;
					S.pegL = v.pegL;
				}
				if (v.sync != null) {
					S.sync = v.sync;
				}
				if (v.tr != null) {
					S.tr = v.tr;
				}
			} else if (en === "ANA") {
				Object.assign(S.ana, v);
			} else if (en === "WAVE") {
				Object.assign(S.wt, { tab: 0 }, v);
			} else if (en === "SMP") {
				Object.assign(S.smp, v);
			} else {
				Object.assign(S.drum, v);
				if (!v.vo) {
					S.drum.vo = null;
				}
			}
			S.tk[S._trk] = parFit(bk, S.tk[S._trk], "");
		} catch (e) {
			/* a patch that holds junk (strings, NaN, an algorithm 99, a kit with a short voicing) keeps what it could read and the track's own value for the rest */
			S.tk[S._trk] = bk;
		}
		return;
	}
	if (en === "FM" && FMP[nm]) {
		const [alg, co, lv, R, sc, sm, fb, fi] = FMP[nm];
		S.alg = alg;
		S.fb = fb;
		S.pegR = [99, 99, 99, 99];
		S.pegL = [50, 50, 50, 50];
		S.tr = 0;
		S.sync = 1;
		S.ops.forEach((o) => {
			o.mode = 0;
			o.de = 0;
			o.ams = 0;
			o.kvs = 2;
			o.rs = 0;
			o.bp = 39;
			o.ld = 0;
			o.rd = 0;
			o.lc = 0;
			o.rc = 0;
		});
		S.ops.forEach((o, k) => {
			o.co = co[k];
			o.fi = fi ? fi[k] : 0;
			o.lv = lv[k];
			o.R = R.slice();
			const car = ALG[alg].c.includes(k + 1),
				sx = car ? sc : sm;
			o.L = [99, Math.max(sx, 70), sx, 0];
		});
	} else if (en === "ANA" && ANAP[nm]) {
		Object.assign(S.ana, ANAP[nm]);
	} else if (en === "WAVE" && WTP[nm]) {
		Object.assign(S.wt, { tab: 0 }, WTP[nm]);
	} else if (en === "SMP" && SMPP[nm]) {
		Object.assign(S.smp, SMPP[nm]);
	} else if (en === "SMP") {
		// VINYL LOOP has no SMPP entry: it is the sampler as it starts up, and it used to keep whatever the sample preset before it had set
		Object.assign(S.smp, { slice: 2, st: 0, pitch: 0, dir: 0 });
	} else if (en === "DRUM" && DRUMP[nm]) {
		const d = JSON.parse(JSON.stringify(DRUMP[nm]));
		S.drum.tune = d.tune;
		S.drum.dec = d.dec;
		S.drum.crush = d.crush;
		S.drum.vo = d.vo || null;
	} else if (en === "DRUM") {
		const br = nm === "BRUSH KIT";
		S.drum.dec = br ? [24, 26, 22, 30, 24, 8, 24, 22] : [38, 40, 14, 40, 38, 12, 25, 30];
		S.drum.tune = br ? [52, 44, 25, 28, 44, 40, 32, 38] : [58, 50, 46, 46, 50, 55, 52, 40];
		S.drum.crush = br ? [70, 62, 48, 42, 60, 65, 45, 60] : [40, 42, 25, 28, 38, 40, 30, 35];
		S.drum.vo = br ? JSON.parse(JSON.stringify(BRUSHVO)) : null;
	}
}

function fmPatch(trk) {
	const b = TK(trk),
		p = new Uint8Array(156);
	for (let ui = 0; ui < 6; ui++) {
		const o = b.ops[ui],
			off = (5 - ui) * 21,
			car = ALG[b.alg].c.includes(ui + 1);
		for (let i = 0; i < 4; i++) {
			p[off + i] = o.R[i];
			p[off + 4 + i] = o.L[i];
		}
		p[off + 8] = o.bp;
		p[off + 9] = o.ld;
		p[off + 10] = o.rd;
		p[off + 11] = o.lc;
		p[off + 12] = o.rc;
		p[off + 13] = o.rs;
		p[off + 14] = o.ams;
		p[off + 15] = o.kvs;
		p[off + 16] = o.lv;
		p[off + 17] = o.mode || 0;
		p[off + 18] = o.co;
		p[off + 19] = o.fi;
		p[off + 20] = o.de + 7;
	}
	for (let i = 0; i < 4; i++) {
		p[126 + i] = b.pegR[i];
		p[130 + i] = b.pegL[i];
	}
	p[136] = b.sync ? 1 : 0;
	p[134] = b.alg - 1;
	p[135] = b.fb;
	p[137] = b.lfo.sp;
	p[138] = b.lfo.dl;
	p[139] = b.lfo.pm;
	p[140] = b.lfo.am;
	p[141] = b.lfo.sy;
	p[142] = b.lfo.w;
	p[143] = b.lfo.ps;
	p[155] = 63;
	return p;
}
