import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLES = ['admin', 'coordinator', 'staff', 'scholar'];
const STATUSES = ['Active', 'Pending Submission', 'For Verification', 'Compliant', 'With Deficiency', 'Probationary', 'For Renewal', 'Renewed', 'Disqualified'];

let me = null;
let programs = [];
let scholars = [];
let ownScholar = null;

const roleIs = (...roles) => roles.includes(me?.role);
const isCoordinator = () => roleIs('coordinator');
const canManageScholars = () => roleIs('staff', 'admin');
const canManagePrograms = () => roleIs('coordinator', 'admin');
const canVerify = () => roleIs('staff', 'admin');
const canEvaluate = () => roleIs('coordinator', 'admin');

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), 3500);
}

const opts = (list, val, label, sel, blank) =>
  (blank ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((x) => {
    const v = val(x);
    return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label(x))}</option>`;
  }).join('');

const tag = (s) =>
  `<span class="tag ${s === 'Compliant' || s === 'Verified' || s === 'Renewed' ? 'ok' : s === 'With Deficiency' || s === 'Disqualified' ? 'bad' : ''}">${esc(s || 'Pending')}</span>`;

const table = (heads, rows) => rows.length
  ? `<div class="wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : '<div class="wrap empty">Nothing here yet.</div>';

function roleLabel(role) {
  return ({
    admin: 'System Administrator',
    coordinator: 'Scholarship Coordinator',
    staff: 'Scholarship Staff',
    scholar: 'Scholar'
  })[role] ?? role;
}

async function loadRefs() {
  const [{ data: p, error: pe }, { data: s, error: se }] = await Promise.all([
    sb.from('scholarship_programs').select('*').order('program_name'),
    sb.from('scholars').select('*').order('full_name')
  ]);

  if (pe) throw pe;
  if (se) throw se;

  programs = p ?? [];
  scholars = s ?? [];

  ownScholar = roleIs('scholar')
    ? scholars.find((x) => x.user_id === me?.id) ?? null
    : null;
}

const progName = (id) => programs.find((p) => p.id === id)?.program_name ?? '';

/* ---------- auth ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    $('#login').hidden = false;
    $('#app').hidden = true;
    me = null;
    return;
  }

  // maybeSingle() returns null (not an error) when no profile row exists
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .maybeSingle();

  if (error) {
    toast(`Unable to load profile: ${error.message}`, true);
    return;
  }

  me = data ?? {
    id: session.user.id,
    role: 'scholar',
    full_name: session.user.email
  };

  if (!ROLES.includes(me.role)) {
    me.role = 'scholar';
  }

  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = `${me.full_name || 'User'} (${roleLabel(me.role)})`;

  setNavVisibility();

  try {
    await loadRefs();
  } catch (e) {
    toast(e.message, true);
  }

  show(me.role === 'scholar' ? 'submissions' : 'dashboard');
}

function setNavVisibility() {
  const allowed = {
    admin: ['dashboard', 'scholars', 'programs', 'submissions', 'compliance'],
    coordinator: ['dashboard', 'scholars', 'programs', 'submissions', 'compliance'],
    staff: ['dashboard', 'scholars', 'programs', 'submissions', 'compliance'],
    scholar: ['submissions', 'compliance']
  };

  document.querySelectorAll('nav button').forEach((b) => {
    b.hidden = !(allowed[me?.role] ?? ['submissions', 'compliance']).includes(b.dataset.view);
  });
}

$('#lf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({
    email: $('#em').value.trim(),
    password: $('#pw').value
  });
  if (error) return toast(error.message, true);
  await boot();
});

$('#su').addEventListener('click', async () => {
  const email = $('#em').value.trim();
  const password = $('#pw').value;

  if (!email || password.length < 6) {
    return toast('Enter an email and a password of 6+ characters.', true);
  }

  const { error } = await sb.auth.signUp({ email, password });
  if (error) return toast(error.message, true);

  toast('Account created. Sign in now (confirm your email first if required).');
});

$('#lo').addEventListener('click', async () => {
  await sb.auth.signOut();
  me = null;
  programs = [];
  scholars = [];
  ownScholar = null;
  $('#pw').value = '';
  boot();
});

document.querySelector('nav').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-view]');
  if (button && !button.hidden) show(button.dataset.view);
});

async function show(name) {
  const button = document.querySelector(`nav button[data-view="${CSS.escape(name)}"]`);
  if (button?.hidden) {
    return toast('You do not have permission to open this page.', true);
  }

  document.querySelectorAll('nav button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === name)
  );

  $('#view').innerHTML = '<p class="muted">Loading…</p>';

  try {
    await views[name]();
  } catch (e) {
    toast(e.message, true);
    $('#view').innerHTML = `<div class="panel"><h2>Unable to load</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

/* ---------- dashboard ---------- */
const count = async (tableName, filter) => {
  let q = sb.from(tableName).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
};

async function dashboard() {
  if (roleIs('scholar')) return scholarDashboard();

  const [total, pending, verified, ok, def] = await Promise.all([
    count('scholars', (q) => q.neq('status', 'Disqualified')),
    count('grade_submissions', (q) => q.eq('submission_status', 'Pending')),
    count('grade_submissions', (q) => q.eq('submission_status', 'Verified')),
    count('scholars', (q) => q.eq('status', 'Compliant')),
    count('scholars', (q) => q.eq('status', 'With Deficiency'))
  ]);

  const card = (n, l, c = '') => `<div class="stat ${c}"><b>${n}</b>${esc(l)}</div>`;

  $('#view').innerHTML = `
    <h2>Dashboard</h2>
    <p class="muted">${esc(roleLabel(me.role))}</p>
    <div class="stats">
      ${card(total, 'Total scholars')}
      ${card(pending, 'Pending grade submissions')}
      ${card(verified, 'Verified submissions')}
      ${card(ok, 'Compliant scholars')}
      ${card(def, 'With deficiency', 'bad')}
    </div>`;
}

async function scholarDashboard() {
  await loadRefs();
  const s = ownScholar;

  $('#view').innerHTML = s
    ? `<h2>My Scholarship</h2>
       <p class="muted">Welcome, ${esc(s.full_name)}.</p>
       <div class="stats">
         <div class="stat"><b>${esc(s.student_id)}</b>Student ID</div>
         <div class="stat"><b>${esc(s.year_level)}</b>Year level</div>
         <div class="stat"><b>${esc(progName(s.scholarship_id))}</b>Scholarship program</div>
         <div class="stat"><b>${tag(s.status)}</b>Current status</div>
       </div>
       <div class="bar"><button class="btn" data-go="submissions">View my submissions</button><button class="btn ghost" data-go="compliance">View compliance</button></div>`
    : `<div class="panel"><h2>Scholar account not linked</h2><p class="muted">Your account exists, but a scholar record has not yet been linked to it.</p></div>`;

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
}

/* ---------- scholars ---------- */
async function scholarsView() {
  await loadRefs();

  const manage = canManageScholars();
  const viewOnly = isCoordinator();

  $('#view').innerHTML = `
    <h2>Scholars</h2>
    <p class="muted">${manage ? 'Create and update scholar records.' : viewOnly ? 'View scholar records and compliance information.' : 'View your scholar record.'}</p>
    ${manage ? `<form id="sf" class="panel"><div class="grid">
      <input type="hidden" name="id">
      <label>Student ID<input name="student_id" required></label>
      <label>Full name<input name="full_name" required></label>
      <label>Degree program<input name="degree_program" required></label>
      <label>Year level<select name="year_level">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
      <label>Scholarship program<select name="scholarship_id">${opts(programs.filter((p) => p.active), (p) => p.id, (p) => p.program_name, '', 'Select…')}</select></label>
      <label>Status<select name="status">${opts(STATUSES, (s) => s, (s) => s, 'Active')}</select></label>
    </div><button class="btn">Save scholar</button> <button type="reset" class="btn ghost" id="sr">Clear</button></form>` : ''}
    ${(!roleIs('scholar')) ? `<div class="bar"><input id="q" placeholder="Search by Student ID or name">
      <select id="fp">${opts(programs, (p) => p.id, (p) => p.program_name, '', 'All programs')}</select>
      <select id="fs">${opts(STATUSES, (s) => s, (s) => s, '', 'All statuses')}</select>
    </div><div id="list"></div>` : `<div id="list"></div>`}`;

  const visibleScholars = roleIs('scholar')
    ? (ownScholar ? [ownScholar] : [])
    : scholars;

  const draw = () => {
    const q = $('#q')?.value.trim().toLowerCase() ?? '';
    const fp = $('#fp')?.value ?? '';
    const fs = $('#fs')?.value ?? '';

    const rows = visibleScholars
      .filter((s) =>
        (!q || s.student_id.toLowerCase().includes(q) || s.full_name.toLowerCase().includes(q)) &&
        (!fp || s.scholarship_id === fp) &&
        (!fs || s.status === fs)
      )
      .map((s) => `<tr>
        <td>${esc(s.student_id)}</td>
        <td>${esc(s.full_name)}</td>
        <td>${esc(s.degree_program)}</td>
        <td>${esc(s.year_level)}</td>
        <td>${esc(progName(s.scholarship_id))}</td>
        <td>${tag(s.status)}</td>
        ${manage ? `<td><button class="btn sm ghost" data-edit="${esc(s.id)}">Edit</button></td>` : ''}
      </tr>`);

    $('#list').innerHTML = table(
      ['Student ID', 'Name', 'Degree', 'Year', 'Scholarship', 'Status', ...(manage ? [''] : [])],
      rows
    );
  };

  $('#q')?.addEventListener('input', draw);
  $('#fp')?.addEventListener('input', draw);
  $('#fs')?.addEventListener('input', draw);
  draw();

  if (!manage) return;

  const f = $('#sf');

  $('#sr')?.addEventListener('click', () => {
    f.elements.id.value = '';
  });

  $('#list').addEventListener('click', (e) => {
    const id = e.target.dataset.edit;
    if (!id) return;

    const s = scholars.find((x) => x.id === id);
    if (!s) return;

    for (const k of ['id', 'student_id', 'full_name', 'degree_program', 'year_level', 'scholarship_id', 'status']) {
      f.elements[k].value = s[k] ?? '';
    }
    f.scrollIntoView({ behavior: 'smooth' });
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();

    const d = Object.fromEntries(new FormData(f));
    const id = d.id;
    delete d.id;

    d.student_id = d.student_id.trim();
    d.full_name = d.full_name.trim();
    d.degree_program = d.degree_program.trim();
    d.year_level = Number(d.year_level);

    if (!d.student_id || !d.full_name || !d.degree_program) {
      return toast('Please complete the scholar information.', true);
    }
    if (!d.scholarship_id) return toast('Select a scholarship program.', true);

    const result = id
      ? await sb.from('scholars').update(d).eq('id', id)
      : await sb.from('scholars').insert(d);

    if (result.error) {
      return toast(result.error.code === '23505' ? 'That Student ID already exists.' : result.error.message, true);
    }

    toast('Scholar saved.');
    await scholarsView();
  });
}

/* ---------- programs ---------- */
async function programsView() {
  await loadRefs();

  const manage = canManagePrograms();

  $('#view').innerHTML = `
    <h2>Scholarship Programs</h2>
    <p class="muted">GWA uses the 1.00 (highest) to 5.00 scale. A scholar meets the GWA rule when GWA is at or below the required value.</p>
    ${manage ? `<form id="pf" class="panel"><div class="grid">
      <label>Program name<input name="program_name" required></label>
      <label>Required GWA (max)<input name="required_gwa" type="number" step="0.01" min="1" max="5" required></label>
      <label>Minimum units<input name="min_units" type="number" min="0" required></label>
      <label>Failing grade<select name="allow_failing_grade"><option value="false">Not allowed</option><option value="true">Allowed</option></select></label>
    </div><button class="btn">Add program</button></form>` : ''}
    ${table(['Program', 'Required GWA', 'Min units', 'Failing grade', 'Active'], programs.map((p) =>
      `<tr><td>${esc(p.program_name)}</td><td>${esc(p.required_gwa)}</td><td>${esc(p.min_units)}</td><td>${p.allow_failing_grade ? 'Allowed' : 'Not allowed'}</td><td>${p.active ? 'Yes' : 'No'}</td></tr>`
    ))}`;

  $('#pf')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const d = Object.fromEntries(new FormData(e.target));
    d.program_name = d.program_name.trim();
    d.required_gwa = Number(d.required_gwa);
    d.min_units = Number(d.min_units);
    d.allow_failing_grade = d.allow_failing_grade === 'true';

    if (!d.program_name) return toast('Program name is required.', true);
    if (d.required_gwa < 1 || d.required_gwa > 5 || d.min_units < 0) {
      return toast('Enter a GWA from 1.00 to 5.00 and non-negative units.', true);
    }

    const { error } = await sb.from('scholarship_programs').insert(d);
    if (error) return toast(error.message, true);

    toast('Program added.');
    await programsView();
  });
}

/* ---------- grade submissions ---------- */
const SELECT_GS = '*, scholars(student_id, full_name, user_id, scholarship_programs(program_name, required_gwa, min_units, allow_failing_grade))';

async function submissionsView() {
  await loadRefs();

  const y = new Date().getFullYear();
  const years = [`${y - 1}-${y}`, `${y}-${y + 1}`, `${y - 2}-${y - 1}`];

  const canEnterForOthers = roleIs('staff', 'admin');
  const scholarList = roleIs('scholar') ? (ownScholar ? [ownScholar] : []) : scholars;

  $('#view').innerHTML = `
    <h2>Grade Submissions</h2>
    <p class="muted">${roleIs('scholar') ? 'Submit and view your own grades only.' : canEnterForOthers ? 'Enter grade submissions and verify pending submissions.' : 'View grade submissions. Verification is handled by staff.'}</p>

    ${scholarList.length > 0 ? `<form id="gf" class="panel"><div class="grid">
      <label>Scholar<select name="scholar_id" ${roleIs('scholar') ? 'disabled' : ''}>${opts(scholarList, (s) => s.id, (s) => `${s.student_id} – ${s.full_name}`, roleIs('scholar') ? ownScholar?.id : '', 'Select…')}</select></label>
      ${roleIs('scholar') ? `<input type="hidden" name="scholar_id" value="${esc(ownScholar?.id ?? '')}">` : ''}
      <label>Academic year<select name="academic_year">${years.map((a) => `<option value="${a}">${a}</option>`).join('')}</select></label>
      <label>Semester<select name="semester"><option>1st</option><option>2nd</option><option>Summer</option></select></label>
      <label>GWA<input name="gwa" type="number" step="0.01" min="1" max="5" required></label>
      <label>Units enrolled<input name="units_enrolled" type="number" min="0" required></label>
      <label>Failed subjects<input name="failed_subjects" type="number" min="0" value="0" required></label>
      <label>Incomplete subjects<input name="incomplete_subjects" type="number" min="0" value="0" required></label>
    </div><button class="btn">Submit grades</button></form>` : `<div class="panel"><h3>No scholar record linked</h3><p class="muted">Your account needs to be connected to a scholar record before grades can be submitted.</p></div>`}

    <div class="bar"><select id="fs"><option value="">All statuses</option><option>Pending</option><option>Verified</option><option>Returned</option></select></div>
    <div id="list"></div>`;

  const draw = async () => {
    let q = sb.from('grade_submissions').select(SELECT_GS).order('submitted_at', { ascending: false });
    if ($('#fs')?.value) q = q.eq('submission_status', $('#fs').value);

    const { data, error } = await q;
    if (error) return toast(error.message, true);

    const rows = (data ?? []).map((g) => {
      const canVerifyThis = canVerify() && g.submission_status === 'Pending';
      const action = canVerifyThis
        ? `<button class="btn sm" data-verify="${esc(g.id)}">Verify</button>`
        : g.evaluation_result
          ? `<span class="muted">${esc(g.evaluation_result)}</span>`
          : '';

      return `<tr>
        <td>${esc(g.scholars?.student_id)} – ${esc(g.scholars?.full_name)}</td>
        <td>${esc(g.academic_year)} ${esc(g.semester)}</td>
        <td>${esc(g.gwa)}</td>
        <td>${esc(g.units_enrolled)}</td>
        <td>${esc(g.failed_subjects)}</td>
        <td>${esc(g.incomplete_subjects)}</td>
        <td>${tag(g.submission_status)}</td>
        <td>${action}</td>
      </tr>`;
    });

    $('#list').innerHTML = table(
      ['Scholar', 'Term', 'GWA', 'Units', 'Failed', 'Incomplete', 'Status', ''],
      rows
    );
  };

  $('#fs').addEventListener('input', draw);

  $('#list').addEventListener('click', async (e) => {
    const id = e.target.dataset.verify;
    if (!id) return;
    if (!canVerify()) return toast('Only Scholarship Staff or Administrator can verify submissions.', true);
    if (!confirm('Verify this submission?')) return;

    const { error } = await sb.rpc('verify_submission', { p_submission_id: id });
    if (error) return toast(error.message, true);

    toast('Grade submission verified. It is now ready for compliance evaluation.');
    await draw();
  });

  $('#gf')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const d = Object.fromEntries(new FormData(e.target));

    if (!d.scholar_id) return toast('Select a scholar.', true);

    d.gwa = Number(d.gwa);
    d.units_enrolled = Number(d.units_enrolled);
    d.failed_subjects = Number(d.failed_subjects);
    d.incomplete_subjects = Number(d.incomplete_subjects);

    if (!(d.gwa >= 1 && d.gwa <= 5)) return toast('GWA must be between 1.00 and 5.00.', true);
    if ([d.units_enrolled, d.failed_subjects, d.incomplete_subjects].some((n) => n < 0 || !Number.isFinite(n))) {
      return toast('Units and subject counts cannot be negative.', true);
    }

    const { error } = await sb.from('grade_submissions').insert(d);
    if (error) {
      return toast(error.code === '23505' ? 'This scholar already has a submission for that term.' : error.message, true);
    }

    toast('Saved as Pending. Waiting for staff verification.');
    e.target.reset();
    await draw();
  });

  await draw();
}

/* ---------- compliance ---------- */
async function complianceView() {
  const { data, error } = await sb
    .from('grade_submissions')
    .select(SELECT_GS)
    .eq('submission_status', 'Verified')
    .order('verified_at', { ascending: false });

  if (error) throw error;

  $('#view').innerHTML = `
    <h2>Compliance</h2>
    <p class="muted">Compliance uses the scholarship program rules: GWA limit, minimum units, failing-grade policy, and incomplete-subject rule.</p>
    ${table(['Scholar', 'Term', 'Program rule', 'Result', 'Deficiencies', ...(canEvaluate() ? ['Action'] : [])], (data ?? []).map((g) => {
      const p = g.scholars?.scholarship_programs;
      const rule = p
        ? `${p.program_name}: GWA ≤ ${p.required_gwa}, ${p.min_units}+ units${p.allow_failing_grade ? '' : ', no fails'}`
        : 'Program rule unavailable';

      const action = canEvaluate()
        ? `<button class="btn sm" data-evaluate="${esc(g.id)}">Evaluate</button>`
        : '';

      return `<tr>
        <td>${esc(g.scholars?.student_id)} – ${esc(g.scholars?.full_name)}</td>
        <td>${esc(g.academic_year)} ${esc(g.semester)}</td>
        <td class="wrapt">${esc(rule)}</td>
        <td>${tag(g.evaluation_result)}</td>
        <td class="wrapt">${esc(g.deficiency_notes || '—')}</td>
        ${canEvaluate() ? `<td>${action}</td>` : ''}
      </tr>`;
    }))}`;

  document.querySelectorAll('[data-evaluate]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!canEvaluate()) return toast('Only Scholarship Coordinator or Administrator can evaluate compliance.', true);

      button.disabled = true;

      const { data: result, error: rpcError } = await sb.rpc('evaluate_compliance', {
        p_submission_id: button.dataset.evaluate
      });

      button.disabled = false;

      if (rpcError) return toast(rpcError.message, true);

      toast(`Compliance result: ${result}`);
      await complianceView();
    });
  });
}

const views = {
  dashboard,
  scholars: scholarsView,
  programs: programsView,
  submissions: submissionsView,
  compliance: complianceView
};

boot();
