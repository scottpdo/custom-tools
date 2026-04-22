// ── Audio Editor — project management, navigation & save ──────────────────────

function showAeView(name) {
  aeProjectsView.classList.toggle('ae-hidden', name !== 'projects');
  aeEditorView.classList.toggle('ae-hidden', name !== 'editor');
}

aeBackBtn.addEventListener('click', () => {
  stopPlayback();
  showAeView('projects');
  loadAeProjects();
});

async function loadAeProjects() {
  showAeView('projects');
  aeProjectsList.innerHTML = '<p class="muted">Loading…</p>';
  const cfg = await window.api.aws.getConfig();
  const result = await window.api.audio.listProjects({ bucket: cfg.bucket });

  if (!result.ok) {
    aeProjectsList.innerHTML = `<p class="muted">Error: ${escHtml(result.error)}</p>`;
    return;
  }

  if (result.projects.length === 0) {
    aeProjectsList.innerHTML = '<p class="muted">No projects yet. Create one above.</p>';
    return;
  }

  aeProjectsList.innerHTML = '';
  result.projects.forEach((project) => {
    const row = document.createElement('div');
    row.className = 've-project-row';
    const lastMod = project.lastModified ? new Date(project.lastModified).toLocaleString() : '';
    row.innerHTML = `
      <div class="ve-project-info">
        <span class="ve-project-name">${escHtml(project.name)}</span>
        <span class="ve-project-date">${escHtml(lastMod)}</span>
      </div>
      <button class="ae-open-btn">Open</button>
    `;
    row.querySelector('.ae-open-btn').addEventListener('click', () => {
      openAeProject({ bucket: cfg.bucket, prefix: project.prefix, name: project.name });
    });
    aeProjectsList.appendChild(row);
  });
}

aeCreateProjectBtn.addEventListener('click', async () => {
  const name = aeNewProjectInput.value.trim();
  if (!name) return;
  const cfg = await window.api.aws.getConfig();
  const result = await window.api.audio.createProject({ bucket: cfg.bucket, name });
  if (!result.ok) {
    alert('Failed to create project: ' + result.error);
    return;
  }
  aeNewProjectInput.value = '';
  openAeProject({ bucket: cfg.bucket, prefix: result.prefix, name });
});

async function openAeProject(project) {
  ae.project = project;
  const result = await window.api.audio.readProject({ bucket: project.bucket, prefix: project.prefix });
  if (!result.ok) {
    alert('Failed to open project: ' + result.error);
    return;
  }

  const m = result.manifest;
  ae.manifest = m;
  ae.bpm = m.bpm || 120;
  ae.bars = m.bars || 8;
  ae.tracks = m.tracks.slice(0, TRACK_COUNT);
  ae.activeTrack = 0;
  ae.dirty = false;

  aeProjectTitle.textContent = project.name;
  aeBpmInput.value = ae.bpm;
  aeBarsInput.value = ae.bars;
  aeSaveBtn.disabled = true;
  aeSaveBtn.textContent = 'Saved ✓';

  showAeView('editor');
  renderTrackList();
  resizeCanvases();
  redrawAll();

  for (let i = 0; i < ae.tracks.length; i++) {
    loadInstrument(i, ae.tracks[i].instrument, true);
  }
}

function markDirty() {
  ae.dirty = true;
  aeSaveBtn.disabled = false;
  aeSaveBtn.textContent = 'Save';
}

function buildManifest() {
  return { ...ae.manifest, bpm: ae.bpm, bars: ae.bars, tracks: ae.tracks };
}

aeSaveBtn.addEventListener('click', async () => {
  if (!ae.project) return;
  const result = await window.api.audio.saveProject({
    bucket: ae.project.bucket,
    prefix: ae.project.prefix,
    manifest: buildManifest(),
  });
  if (result.ok) {
    ae.dirty = false;
    aeSaveBtn.disabled = true;
    aeSaveBtn.textContent = 'Saved ✓';
  } else {
    alert('Save failed: ' + result.error);
  }
});
