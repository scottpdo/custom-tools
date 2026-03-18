/**
 * Video render module — wraps fluent-ffmpeg to compile a project manifest
 * into a single MP4.
 */
import ffmpeg from 'fluent-ffmpeg';
import type { FfmpegCommand } from 'fluent-ffmpeg';

interface ClipDescriptor {
  localPath: string;
  trimIn:    number;
  trimOut:   number;
  transitions?: {
    in?:  { type: string; duration: number };
    out?: { type: string; duration: number };
  };
  duration: number;
}

interface RenderSettings {
  frameRate?:  number;
  resolution?: { width: number; height: number };
}

interface RenderOptions {
  clips:       ClipDescriptor[];
  outputPath:  string;
  settings?:   RenderSettings;
}

interface ProgressData {
  pct:      number;
  timemark: string | null;
}

let activeCommand: FfmpegCommand | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

export async function startRender(
  { clips, outputPath, settings }: RenderOptions,
  onProgress: (data: ProgressData) => void,
): Promise<{ ok: true; outputPath: string } | { ok: false; cancelled?: true; error: string }> {
  if (!clips || clips.length === 0) {
    return { ok: false, error: 'No clips to render.' };
  }

  const target = {
    width:  settings?.resolution?.width  ?? 1920,
    height: settings?.resolution?.height ?? 1080,
    fps:    settings?.frameRate          ?? 30,
  };

  let totalSeconds = clips.reduce((s, c) => s + Math.max(0, c.trimOut - c.trimIn), 0);
  for (let i = 0; i < clips.length - 1; i++) {
    totalSeconds -= getTransitionDuration(clips[i].transitions?.out);
  }

  return new Promise((resolve) => {
    const cmd = ffmpeg();
    activeCommand = cmd;

    clips.forEach((clip) => {
      cmd.input(clip.localPath)
         .inputOptions([`-ss ${clip.trimIn}`, `-to ${clip.trimOut}`]);
    });

    const { filterComplex, vOut, aOut } = buildFilterComplex(clips, target);
    cmd.complexFilter(filterComplex);

    cmd.outputOptions([
      `-map ${vOut}`,
      `-map ${aOut}`,
      '-c:v libx264',
      '-preset fast',
      '-crf 22',
      '-c:a aac',
      '-b:a 192k',
      `-r ${target.fps}`,
      '-movflags +faststart',
      '-y',
    ]);

    cmd.on('start', (cmdline) => { console.log('[render] ffmpeg command:', cmdline); });

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
      if (err.message.includes('SIGTERM') || err.message.includes('killed')) {
        resolve({ ok: false, cancelled: true, error: 'Render cancelled.' });
      } else {
        resolve({ ok: false, error: err.message });
      }
    });

    cmd.save(outputPath);
  });
}

export function cancelRender(): void {
  if (activeCommand) {
    activeCommand.kill('SIGTERM');
    activeCommand = null;
  }
}

// ── Filter graph construction ─────────────────────────────────────────────────

function buildFilterComplex(
  clips: ClipDescriptor[],
  { width, height, fps }: { width: number; height: number; fps: number },
): { filterComplex: string; vOut: string; aOut: string } {
  const n  = clips.length;
  const fp: string[] = [];

  clips.forEach((_, i) => {
    fp.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[nv${i}]`,
    );
    fp.push(`[${i}:a]anull[na${i}]`);
  });

  const pv = clips.map((_, i) => `nv${i}`);
  const pa = clips.map((_, i) => `na${i}`);

  const firstFadeIn = getTransitionDuration(clips[0].transitions?.in);
  if (firstFadeIn > 0) {
    fp.push(`[nv0]fade=t=in:st=0:d=${firstFadeIn.toFixed(3)}[fiv0]`);
    fp.push(`[na0]afade=t=in:st=0:d=${firstFadeIn.toFixed(3)}[fia0]`);
    pv[0] = 'fiv0'; pa[0] = 'fia0';
  }

  const lastFadeOut = getTransitionDuration(clips[n - 1].transitions?.out);
  if (lastFadeOut > 0) {
    const lastDur = clips[n - 1].trimOut - clips[n - 1].trimIn;
    const st      = Math.max(0, lastDur - lastFadeOut);
    const srcV    = pv[n - 1];
    fp.push(`[${srcV}]fade=t=out:st=${st.toFixed(3)}:d=${lastFadeOut.toFixed(3)}[fov${n - 1}]`);
    fp.push(`[${pa[n - 1]}]afade=t=out:st=${st.toFixed(3)}:d=${lastFadeOut.toFixed(3)}[foa${n - 1}]`);
    pv[n - 1] = `fov${n - 1}`;
    pa[n - 1] = `foa${n - 1}`;
  }

  if (n === 1) {
    fp.push(`[${pv[0]}]null[outv]`);
    fp.push(`[${pa[0]}]anull[outa]`);
    return { filterComplex: fp.join(';'), vOut: '[outv]', aOut: '[outa]' };
  }

  const transitionDurs = clips.slice(0, n - 1).map((c) => getTransitionDuration(c.transitions?.out));

  const segments: number[][] = [[0]];
  for (let i = 0; i < n - 1; i++) {
    if (transitionDurs[i] > 0) {
      segments[segments.length - 1].push(i + 1);
    } else {
      segments.push([i + 1]);
    }
  }

  const segVOut: string[] = [];
  const segAOut: string[] = [];

  segments.forEach((seg, si) => {
    if (seg.length === 1) {
      segVOut.push(pv[seg[0]]);
      segAOut.push(pa[seg[0]]);
      return;
    }

    let curV = pv[seg[0]];
    let curA = pa[seg[0]];
    let accDur = clips[seg[0]].trimOut - clips[seg[0]].trimIn;

    for (let j = 1; j < seg.length; j++) {
      const ci      = seg[j];
      const tDur    = transitionDurs[ci - 1];
      const clipDur = clips[ci].trimOut - clips[ci].trimIn;
      const offset  = Math.max(0, accDur - tDur);
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

  if (segments.length === 1) {
    fp.push(`[${segVOut[0]}]null[outv]`);
    fp.push(`[${segAOut[0]}]anull[outa]`);
  } else {
    const concatIn = segments.map((_, si) => `[${segVOut[si]}][${segAOut[si]}]`).join('');
    fp.push(`${concatIn}concat=n=${segments.length}:v=1:a=1[outv][outa]`);
  }

  return { filterComplex: fp.join(';'), vOut: '[outv]', aOut: '[outa]' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTransitionDuration(transition?: { type?: string; duration?: number }): number {
  if (!transition?.type || transition.type !== 'fade') return 0;
  return Math.max(0, parseFloat(String(transition.duration)) || 0);
}

function timecodeToSeconds(tc: string): number {
  if (!tc) return 0;
  const parts = String(tc).split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}
