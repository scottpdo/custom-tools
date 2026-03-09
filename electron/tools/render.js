/**
 * Video render module — wraps fluent-ffmpeg to compile a project manifest
 * into a single MP4.
 *
 * Requires ffmpeg to be available in $PATH.
 * NOTE: For distribution, consider bundling ffmpeg via the `ffmpeg-static`
 * package and pointing fluent-ffmpeg at it with ffmpeg.setFfmpegPath().
 * For now we rely on the system ffmpeg, which keeps the app lean and avoids
 * the ~80 MB binary bundled per platform.
 */

const ffmpeg = require('fluent-ffmpeg');

// The single active render command (only one render at a time for now)
let activeCommand = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render clips into an MP4 at outputPath.
 *
 * @param {object} opts
 * @param {Array}  opts.clips       - Ordered clip descriptors from the strip
 * @param {string} opts.outputPath  - Absolute local path for the output file
 * @param {object} [opts.settings]  - Project settings (frameRate, resolution)
 * @param {function} onProgress     - Called with { pct, timemark } during render
 * @returns {Promise<{ok, outputPath}|{ok, error}>}
 */
async function startRender({ clips, outputPath, settings }, onProgress) {
  if (!clips || clips.length === 0) {
    return { ok: false, error: 'No clips to render.' };
  }

  const target = {
    width:  settings?.resolution?.width  ?? 1920,
    height: settings?.resolution?.height ?? 1080,
    fps:    settings?.frameRate          ?? 30,
  };

  // Total output duration: subtract xfade overlaps between consecutive clips
  let totalSeconds = clips.reduce((s, c) => s + Math.max(0, c.trimOut - c.trimIn), 0);
  for (let i = 0; i < clips.length - 1; i++) {
    totalSeconds -= getTransitionDuration(clips[i].transitions?.out);
  }

  return new Promise((resolve) => {
    const cmd = ffmpeg();
    activeCommand = cmd;

    // ── Inputs (with trim via fast seeking) ──────────────────────────────────
    clips.forEach((clip) => {
      // -ss / -to before -i = fast keyframe seek (accurate enough for editing;
      // swap to trim/atrim filters in filter_complex for frame-accurate trimming)
      cmd.input(clip.localPath)
         .inputOptions([`-ss ${clip.trimIn}`, `-to ${clip.trimOut}`]);
    });

    // ── filter_complex ───────────────────────────────────────────────────────
    const { filterComplex, vOut, aOut } = buildFilterComplex(clips, target);
    cmd.complexFilter(filterComplex);

    // ── Output options ───────────────────────────────────────────────────────
    cmd.outputOptions([
      `-map ${vOut}`,
      `-map ${aOut}`,
      '-c:v libx264',
      '-preset fast',
      '-crf 22',         // good quality/size balance; lower = better quality
      '-c:a aac',
      '-b:a 192k',
      `-r ${target.fps}`,
      '-movflags +faststart', // moov atom at front — good for streaming/web
      '-y',              // overwrite output if it already exists
    ]);

    // ── Events ───────────────────────────────────────────────────────────────
    cmd.on('start', (cmdline) => {
      console.log('[render] ffmpeg command:', cmdline);
    });

    cmd.on('progress', (progress) => {
      const secs = timecodeToSeconds(progress.timemark);
      const pct  = totalSeconds > 0
        ? Math.min(99, Math.round((secs / totalSeconds) * 100))
        : 0;
      onProgress({ pct, timemark: progress.timemark });
    });

    cmd.on('end', () => {
      activeCommand = null;
      onProgress({ pct: 100, timemark: null });
      resolve({ ok: true, outputPath });
    });

    cmd.on('error', (err) => {
      activeCommand = null;
      // SIGTERM from cancelRender — treat as user-initiated, not an error
      if (err.message.includes('SIGTERM') || err.message.includes('killed')) {
        resolve({ ok: false, cancelled: true, error: 'Render cancelled.' });
      } else {
        resolve({ ok: false, error: err.message });
      }
    });

    cmd.save(outputPath);
  });
}

/** Terminate the active ffmpeg process. */
function cancelRender() {
  if (activeCommand) {
    activeCommand.kill('SIGTERM');
    activeCommand = null;
  }
}

// ── Filter graph construction ─────────────────────────────────────────────────

/**
 * Build a filter_complex string that:
 *  - Scales each clip to the target resolution (letterboxed)
 *  - Normalises frame rate
 *  - Applies standalone fade-in on the first clip and fade-out on the last clip
 *  - Uses xfade/acrossfade for crossfade transitions between adjacent clips
 *    (requires ffmpeg ≥ 4.3; future: could fall back to concat+fade for older versions)
 *  - Concatenates "cut" segments (clip groups not connected by transitions) together
 */
function buildFilterComplex(clips, { width, height, fps }) {
  const n = clips.length;
  const fp = [];

  // ── Step 1: Per-clip normalisation ────────────────────────────────────────
  clips.forEach((_, i) => {
    fp.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[nv${i}]`,
    );
    fp.push(`[${i}:a]anull[na${i}]`);
  });

  // ── Step 2: Standalone fade-in on first clip ───────────────────────────────
  // clips[0].transitions.in → fade from black at the very start of the output.
  const pv = clips.map((_, i) => `nv${i}`); // processed video label per clip
  const pa = clips.map((_, i) => `na${i}`); // processed audio label per clip

  const firstFadeIn = getTransitionDuration(clips[0].transitions?.in);
  if (firstFadeIn > 0) {
    fp.push(`[nv0]fade=t=in:st=0:d=${firstFadeIn.toFixed(3)}[fiv0]`);
    fp.push(`[na0]afade=t=in:st=0:d=${firstFadeIn.toFixed(3)}[fia0]`);
    pv[0] = 'fiv0';
    pa[0] = 'fia0';
  }

  // ── Step 3: Standalone fade-out on last clip ───────────────────────────────
  // clips[n-1].transitions.out → fade to black at the very end of the output.
  // For n===1 this is the same clip as the fade-in above, so chain from pv[0].
  const lastFadeOut = getTransitionDuration(clips[n - 1].transitions?.out);
  if (lastFadeOut > 0) {
    const lastDur = clips[n - 1].trimOut - clips[n - 1].trimIn;
    const st = Math.max(0, lastDur - lastFadeOut);
    const srcV = pv[n - 1]; // may already be 'fiv0' when n === 1
    fp.push(`[${srcV}]fade=t=out:st=${st.toFixed(3)}:d=${lastFadeOut.toFixed(3)}[fov${n - 1}]`);
    fp.push(`[${pa[n - 1]}]afade=t=out:st=${st.toFixed(3)}:d=${lastFadeOut.toFixed(3)}[foa${n - 1}]`);
    pv[n - 1] = `fov${n - 1}`;
    pa[n - 1] = `foa${n - 1}`;
  }

  // Single-clip shortcut ─────────────────────────────────────────────────────
  if (n === 1) {
    fp.push(`[${pv[0]}]null[outv]`);
    fp.push(`[${pa[0]}]anull[outa]`);
    return { filterComplex: fp.join(';'), vOut: '[outv]', aOut: '[outa]' };
  }

  // ── Step 4: Group clips into segments separated by hard cuts ──────────────
  // transitionDurs[i] = crossfade duration between clip i and clip i+1.
  // We use clips[i].transitions.out as the canonical value (the context menu
  // always writes both clips[i].transitions.out and clips[i+1].transitions.in
  // to the same duration).
  const transitionDurs = clips.slice(0, n - 1).map((c) =>
    getTransitionDuration(c.transitions?.out),
  );

  const segments = [[0]];
  for (let i = 0; i < n - 1; i++) {
    if (transitionDurs[i] > 0) {
      segments[segments.length - 1].push(i + 1);
    } else {
      segments.push([i + 1]);
    }
  }

  // ── Step 5: xfade chain within each segment ────────────────────────────────
  const segVOut = [];
  const segAOut = [];

  segments.forEach((seg, si) => {
    if (seg.length === 1) {
      segVOut.push(pv[seg[0]]);
      segAOut.push(pa[seg[0]]);
      return;
    }

    let curV = pv[seg[0]];
    let curA = pa[seg[0]];
    // Accumulated output duration within this xfade chain (used for offset calc)
    let accDur = clips[seg[0]].trimOut - clips[seg[0]].trimIn;

    for (let j = 1; j < seg.length; j++) {
      const ci     = seg[j];
      const tDur   = transitionDurs[ci - 1];
      const clipDur = clips[ci].trimOut - clips[ci].trimIn;
      // xfade offset = point in the accumulated output where the blend starts
      const offset = Math.max(0, accDur - tDur);

      const xvLabel = `xv${si}_${j}`;
      const xaLabel = `xa${si}_${j}`;

      fp.push(
        `[${curV}][${pv[ci]}]xfade=transition=fade:duration=${tDur.toFixed(3)}` +
        `:offset=${offset.toFixed(3)}[${xvLabel}]`,
      );
      fp.push(`[${curA}][${pa[ci]}]acrossfade=d=${tDur.toFixed(3)}:c1=tri:c2=tri[${xaLabel}]`);

      curV = xvLabel;
      curA = xaLabel;
      accDur = accDur + clipDur - tDur;
    }

    segVOut.push(curV);
    segAOut.push(curA);
  });

  // ── Step 6: Concat segments (hard cuts between groups) ────────────────────
  if (segments.length === 1) {
    fp.push(`[${segVOut[0]}]null[outv]`);
    fp.push(`[${segAOut[0]}]anull[outa]`);
  } else {
    const concatIn = segments.map((_, si) => `[${segVOut[si]}][${segAOut[si]}]`).join('');
    fp.push(`${concatIn}concat=n=${segments.length}:v=1:a=1[outv][outa]`);
  }

  return {
    filterComplex: fp.join(';'),
    vOut: '[outv]',
    aOut: '[outa]',
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract a transition duration in seconds, or 0 if not a valid fade. */
function getTransitionDuration(transition) {
  if (!transition?.type || transition.type !== 'fade') return 0;
  return Math.max(0, parseFloat(transition.duration) || 0);
}

/** Convert an ffmpeg timecode string "HH:MM:SS.ss" to total seconds. */
function timecodeToSeconds(tc) {
  if (!tc) return 0;
  const parts = String(tc).split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

module.exports = { startRender, cancelRender };
