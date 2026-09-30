import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUSES = ['Active', 'Pending Submission', 'For Verification', 'Compliant', 'With Deficiency', 'Probationary', 'For Renewal', 'Renewed', 'Disqualified'];
let me = null, programs = [], scholars = [];
const isStaff = () => ['admin', 'staff'].includes(me?.role);

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3500);
}
const opts = (list, val, label, sel, blank) =>
  (blank ? `<option value="">${blank}</option>` : '') + list.map((x) => `<option value="${esc(val(x))}" ${val(x) === sel ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const tag = (s) => `<span class="tag ${s === 'Compliant' || s === 'Verified' ? 'ok' : s === 'With Deficiency' ? 'bad' : ''}">${esc(s)}</span>`;
const table = (heads, rows) => rows.length
  ? `<div class="wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : '<div class="wrap empty">Nothing here yet.</div>';

async function loadRefs() {
  const [p, s] = await Promise.all([
    sb.from('scholarship_programs').select('*').order('program_name'),
    sb.from('scholars').select('*').order('full_name'),
  ]);
  if (p.error || s.error) throw (p.error || s.error);
  programs = p.data; scholars = s.data;
}
const progName = (id) => programs.find((p) => p.id === id)?.program_name ?? '';

/* ---------- auth ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('#login').hidden = false; $('#app').hidden = true; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  me = data ?? { id: session.user.id, role: 'scholar', full_name: session.user.email };
  $('#login').hidden = true; $('#app').hidden = false;
  $('#who').textContent = `${me.full_name || 'User'} (${me.role})`;
  document.querySelectorAll('nav button').forEach((b) => {
    b.hidden = !isStaff() && ['dashboard', 'scholars'].includes(b.dataset.view);
  });
  show(isStaff() ? 'dashboard' : 'submissions');
}
$('#lf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $('#em').value, password: $('#pw').value });
  error ? toast(error.message, true) : boot();
});
$('#su').addEventListener('click', async () => {
  if (!$('#em').value || $('#pw').value.length < 6) return toast('Enter an email and a password of 6+ characters.', true);
  const { error } = await sb.auth.signUp({ email: $('#em').value, password: $('#pw').value });
  error ? toast(error.message, true) : toast('Account created. Sign in now (confirm your email first if asked).');
});
$('#lo').addEventListener('click', async () => { await sb.auth.signOut(); me = null; boot(); });
document.querySelector('nav').addEventListener('click', (e) => { if (e.target.dataset.view) show(e.target.dataset.view); });

async function show(name) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  $('#view').innerHTML = '<p class="muted">Loading…</p>';
  try { await views[name](); } catch (e) { toast(e.message, true); }
}

/* ---------- dashboard ---------- */
const count = (t, f) => { let q = sb.from(t).select('*', { count: 'exact', head: true }); if (f) q = f(q); return q.then((r) => { if (r.error) throw r.error; return r.count ?? 0; }); };
async function dashboard() {
  const [total, pending, verified, ok, def] = await Promise.all([
    count('scholars', (q) => q.neq('status', 'Disqualified')),
    count('grade_submissions', (q) => q.eq('submission_status', 'Pending')),
    count('grade_submissions', (q) => q.eq('submission_status', 'Verified')),
    count('scholars', (q) => q.eq('status', 'Compliant')),
    count('scholars', (q) => q.eq('status', 'With Deficiency')),
  ]);
  const card = (n, l, c = '') => `<div class="stat ${c}"><b>${n}</b>${l}</div>`;
  $('#view').innerHTML = `<h2>Dashboard</h2><div class="stats">
    ${card(total, 'Total scholars')}${card(pending, 'Pending grade submissions')}${card(verified, 'Verified submissions')}
    ${card(ok, 'Compliant scholars')}${card(def, 'With deficiency', 'bad')}</div>`;
}

/* ---------- scholars ---------- */
async function scholarsView() {
  await loadRefs();
  const staff = isStaff();
  $('#view').innerHTML = `<h2>Scholars</h2>
  ${staff ? `<form id="sf" class="panel"><div class="grid">
    <input type="hidden" name="id">
    <label>Student ID<input name="student_id" required></label>
    <label>Full name<input name="full_name" required></label>
    <label>Degree program<input name="degree_program" required></label>
    <label>Year level<select name="year_level">${[1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join('')}</select></label>
    <label>Scholarship program<select name="scholarship_id">${opts(programs.filter((p) => p.active), (p) => p.id, (p) => p.program_name, '', 'Select…')}</select></label>
    <label>Status<select name="status">${opts(STATUSES, (s) => s, (s) => s, 'Active')}</select></label></div>
    <button class="btn">Save scholar</button> <button type="reset" class="btn ghost" id="sr">Clear</button></form>` : ''}
  <div class="bar"><input id="q" placeholder="Search by Student ID or name">
    <select id="fp">${opts(programs, (p) => p.id, (p) => p.program_name, '', 'All programs')}</select>
    <select id="fs">${opts(STATUSES, (s) => s, (s) => s, '', 'All statuses')}</select></div><div id="list"></div>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase(), fp = $('#fp').value, fs = $('#fs').value;
    const rows = scholars.filter((s) => (!q || s.student_id.toLowerCase().includes(q) || s.full_name.toLowerCase().includes(q)) && (!fp || s.scholarship_id === fp) && (!fs || s.status === fs))
      .map((s) => `<tr><td>${esc(s.student_id)}</td><td>${esc(s.full_name)}</td><td>${esc(s.degree_program)}</td><td>${s.year_level}</td><td>${esc(progName(s.scholarship_id))}</td><td>${tag(s.status)}</td>${staff ? `<td><button class="btn sm ghost" data-edit="${s.id}">Edit</button></td>` : ''}</tr>`);
    $('#list').innerHTML = table(['Student ID', 'Name', 'Degree', 'Year', 'Scholarship', 'Status', ...(staff ? [''] : [])], rows);
  };
  ['#q', '#fp', '#fs'].forEach((s) => $(s).addEventListener('input', draw));
  draw();
  if (!staff) return;
  const f = $('#sf');
  $('#list').addEventListener('click', (e) => {
    const s = scholars.find((x) => x.id === e.target.dataset.edit); if (!s) return;
    for (const k of ['id', 'student_id', 'full_name', 'degree_program', 'year_level', 'scholarship_id', 'status']) f.elements[k].value = s[k];
    f.scrollIntoView({ behavior: 'smooth' });
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f)); const id = d.id; delete d.id;
    d.student_id = d.student_id.trim(); d.year_level = +d.year_level;
    if (!d.student_id) return toast('Student ID cannot be blank.', true);
    if (!d.scholarship_id) return toast('Select a scholarship program.', true);
    const { error } = id ? await sb.from('scholars').update(d).eq('id', id) : await sb.from('scholars').insert(d);
    if (error) return toast(error.code === '23505' ? 'That Student ID already exists.' : error.message, true);
    toast('Scholar saved.'); scholarsView();
  });
}

/* ---------- programs ---------- */
async function programsView() {
  await loadRefs();
  const staff = isStaff();
  $('#view').innerHTML = `<h2>Scholarship Programs</h2>
  <p class="muted">GWA uses the 1.00 (highest) to 5.00 scale. A scholar meets the GWA rule when GWA is at or below the required value.</p>
  ${staff ? `<form id="pf" class="panel"><div class="grid">
    <label>Program name<input name="program_name" required></label>
    <label>Required GWA (max)<input name="required_gwa" type="number" step="0.01" min="1" max="5" required></label>
    <label>Minimum units<input name="min_units" type="number" min="0" required></label>
    <label>Failing grade<select name="allow_failing_grade"><option value="false">Not allowed</option><option value="true">Allowed</option></select></label></div>
    <button class="btn">Add program</button></form>` : ''}
  ${table(['Program', 'Required GWA', 'Min units', 'Failing grade', 'Active'], programs.map((p) => `<tr><td>${esc(p.program_name)}</td><td>${p.required_gwa}</td><td>${p.min_units}</td><td>${p.allow_failing_grade ? 'Allowed' : 'Not allowed'}</td><td>${p.active ? 'Yes' : 'No'}</td></tr>`))}`;
  $('#pf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.required_gwa = +d.required_gwa; d.min_units = +d.min_units; d.allow_failing_grade = d.allow_failing_grade === 'true';
    if (d.required_gwa < 1 || d.required_gwa > 5 || d.min_units < 0) return toast('Enter a GWA from 1.00 to 5.00 and non-negative units.', true);
    const { error } = await sb.from('scholarship_programs').insert(d);
    error ? toast(error.message, true) : (toast('Program added.'), programsView());
  });
}

/* ---------- grade submissions ---------- */
const SELECT_GS = '*, scholars(student_id, full_name, scholarship_programs(program_name, required_gwa, min_units, allow_failing_grade))';
async function submissionsView() {
  await loadRefs();
  const y = new Date().getFullYear(), years = [`${y - 1}-${y}`, `${y}-${y + 1}`, `${y - 2}-${y - 1}`];
  $('#view').innerHTML = `<h2>Grade Submissions</h2>
  <form id="gf" class="panel"><div class="grid">
    <label>Scholar<select name="scholar_id">${opts(scholars, (s) => s.id, (s) => `${s.student_id} – ${s.full_name}`, '', 'Select…')}</select></label>
    <label>Academic year<select name="academic_year">${years.map((a) => `<option>${a}</option>`).join('')}</select></label>
    <label>Semester<select name="semester"><option>1st</option><option>2nd</option><option>Summer</option></select></label>
    <label>GWA<input name="gwa" type="number" step="0.01" min="1" max="5" required></label>
    <label>Units enrolled<input name="units_enrolled" type="number" min="0" required></label>
    <label>Failed subjects<input name="failed_subjects" type="number" min="0" value="0" required></label>
    <label>Incomplete subjects<input name="incomplete_subjects" type="number" min="0" value="0" required></label></div>
    <button class="btn">Submit grades</button></form>
  <div class="bar"><select id="fs"><option value="">All statuses</option><option>Pending</option><option>Verified</option><option>Returned</option></select></div><div id="list"></div>`;
  const draw = async () => {
    let q = sb.from('grade_submissions').select(SELECT_GS).order('submitted_at', { ascending: false });
    if ($('#fs').value) q = q.eq('submission_status', $('#fs').value);
    const { data, error } = await q; if (error) return toast(error.message, true);
    $('#list').innerHTML = table(['Scholar', 'Term', 'GWA', 'Units', 'Failed', 'Incomplete', 'Status', ''], data.map((g) => `<tr>
      <td>${esc(g.scholars.student_id)} – ${esc(g.scholars.full_name)}</td><td>${esc(g.academic_year)} ${esc(g.semester)}</td><td>${g.gwa}</td><td>${g.units_enrolled}</td><td>${g.failed_subjects}</td><td>${g.incomplete_subjects}</td><td>${tag(g.submission_status)}</td>
      <td>${isStaff() && g.submission_status === 'Pending' ? `<button class="btn sm" data-verify="${g.id}">Verify</button>` : ''}</td></tr>`));
  };
  $('#fs').addEventListener('input', draw);
  $('#list').addEventListener('click', async (e) => {
    const id = e.target.dataset.verify; if (!id || !confirm('Verify this submission? It cannot be verified again.')) return;
    const { data, error } = await sb.rpc('verify_submission', { p_id: id });
    if (error) return toast(error.message, true);
    toast(`Verified. Result: ${data.evaluation_result}.`); draw();
  });
  $('#gf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!d.scholar_id) return toast('Select a scholar.', true);
    for (const k of ['gwa', 'units_enrolled', 'failed_subjects', 'incomplete_subjects']) d[k] = +d[k];
    if (!(d.gwa >= 1 && d.gwa <= 5)) return toast('GWA must be between 1.00 and 5.00.', true);
    if ([d.units_enrolled, d.failed_subjects, d.incomplete_subjects].some((n) => n < 0 || !Number.isFinite(n))) return toast('Units and subject counts cannot be negative.', true);
    const { error } = await sb.from('grade_submissions').insert(d);
    if (error) return toast(error.code === '23505' ? 'This scholar already has a submission for that term.' : error.message, true);
    toast('Saved as Pending. Waiting for staff verification.'); draw();
  });
  draw();
}

/* ---------- compliance ---------- */
async function complianceView() {
  const { data, error } = await sb.from('grade_submissions').select(SELECT_GS).eq('submission_status', 'Verified').order('verified_at', { ascending: false });
  if (error) throw error;
  $('#view').innerHTML = `<h2>Compliance</h2>
  <p class="muted">Compliant means GWA is at or below the program limit, units meet the minimum, failing grades follow the program policy, and there are no incomplete subjects.</p>
  ${table(['Scholar', 'Term', 'Program rule', 'Result', 'Deficiencies'], data.map((g) => {
    const p = g.scholars.scholarship_programs;
    return `<tr><td>${esc(g.scholars.student_id)} – ${esc(g.scholars.full_name)}</td><td>${esc(g.academic_year)} ${esc(g.semester)}</td>
    <td>${esc(p.program_name)}: GWA ≤ ${p.required_gwa}, ${p.min_units}+ units${p.allow_failing_grade ? '' : ', no fails'}</td><td>${tag(g.evaluation_result)}</td><td class="wrapt">${esc(g.deficiency_notes || '—')}</td></tr>`;
  }))}`;
}

const views = { dashboard, scholars: scholarsView, programs: programsView, submissions: submissionsView, compliance: complianceView };
boot();
