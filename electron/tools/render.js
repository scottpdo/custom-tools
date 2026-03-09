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

  const totalSeconds = clips.reduce((s, c) => s + Math.max(0, c.trimOut - c.trimIn), 0);

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
 *  - Applies per-clip fade-in / fade-out if specified in transitions
 *  - Concatenates all clips in order
 */
function buildFilterComplex(clips, { width, height, fps }) {
  const filterParts = [];
  const vOuts = [];
  const aOuts = [];

  clips.forEach((clip, i) => {
    const clipDur  = clip.trimOut - clip.trimIn;
    const fadeIn   = getTransitionDuration(clip.transitions?.in);
    const fadeOut  = getTransitionDuration(clip.transitions?.out);

    // Video filter chain ──────────────────────────────────────────────────────
    const vChain = [
      // Letterbox to target resolution, then pad with black to fill exactly
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1',
      `fps=${fps}`,
    ];
    if (fadeIn  > 0) vChain.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    if (fadeOut > 0) vChain.push(`fade=t=out:st=${Math.max(0, clipDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);

    filterParts.push(`[${i}:v]${vChain.join(',')}[cv${i}]`);
    vOuts.push(`[cv${i}]`);

    // Audio filter chain ──────────────────────────────────────────────────────
    const aChain = [];
    if (fadeIn  > 0) aChain.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    if (fadeOut > 0) aChain.push(`afade=t=out:st=${Math.max(0, clipDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);

    if (aChain.length > 0) {
      filterParts.push(`[${i}:a]${aChain.join(',')}[ca${i}]`);
    } else {
      filterParts.push(`[${i}:a]anull[ca${i}]`);
    }
    aOuts.push(`[ca${i}]`);
  });

  // Concat all prepared streams — ffmpeg concat requires interleaved pairs: [v0][a0][v1][a1]...
  const interleavedStreams = clips.map((_, i) => `[cv${i}][ca${i}]`).join('');
  filterParts.push(`${interleavedStreams}concat=n=${clips.length}:v=1:a=1[outv][outa]`);

  return {
    filterComplex: filterParts.join(';'),
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
