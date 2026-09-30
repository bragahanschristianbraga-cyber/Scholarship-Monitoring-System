-- Scholarship Monitoring System: run once in Supabase > SQL Editor
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role text not null default 'scholar' check (role in ('admin','staff','scholar'))
);
create table scholarship_programs (
  id uuid primary key default gen_random_uuid(),
  program_name text not null unique,
  required_gwa numeric(3,2) not null check (required_gwa between 1 and 5), -- 1.00 best, 5.00 fail: GWA must be <= this
  min_units int not null check (min_units >= 0),
  allow_failing_grade boolean not null default false,
  active boolean not null default true
);
create table scholars (
  id uuid primary key default gen_random_uuid(),
  student_id text not null unique check (length(trim(student_id)) > 0),
  full_name text not null,
  degree_program text not null,
  year_level int not null check (year_level between 1 and 6),
  scholarship_id uuid not null references scholarship_programs(id),
  status text not null default 'Active' check (status in ('Active','Pending Submission','For Verification','Compliant','With Deficiency','Probationary','For Renewal','Renewed','Disqualified')),
  user_id uuid references auth.users  -- links a scholar login to this record
);
create table grade_submissions (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references scholars(id),
  academic_year text not null,
  semester text not null check (semester in ('1st','2nd','Summer')),
  gwa numeric(3,2) not null check (gwa between 1 and 5),
  units_enrolled int not null check (units_enrolled >= 0),
  failed_subjects int not null default 0 check (failed_subjects >= 0),
  incomplete_subjects int not null default 0 check (incomplete_subjects >= 0),
  submission_status text not null default 'Pending' check (submission_status in ('Pending','Verified','Returned')),
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users,
  verified_at timestamptz,
  evaluation_result text check (evaluation_result in ('Compliant','With Deficiency')),
  deficiency_notes text,
  unique (scholar_id, academic_year, semester)  -- BR-03
);
create table audit_log (  -- BR-08
  id bigserial primary key, table_name text, record_id uuid, action text,
  old_data jsonb, new_data jsonb, changed_by uuid default auth.uid(), changed_at timestamptz default now()
);

-- helpers
create function is_staff() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id = auth.uid() and role in ('admin','staff')) $$;

create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as
$$ begin insert into profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email)); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- new submissions always start Pending; scholar becomes For Verification
create function gs_before_insert() returns trigger language plpgsql as
$$ begin new.submission_status:='Pending'; new.verified_by:=null; new.verified_at:=null;
   new.evaluation_result:=null; new.deficiency_notes:=null; new.submitted_at:=now(); return new; end $$;
create trigger gs_bi before insert on grade_submissions for each row execute function gs_before_insert();
create function gs_after_insert() returns trigger language plpgsql security definer set search_path=public as
$$ begin update scholars set status='For Verification' where id=new.scholar_id; return new; end $$;
create trigger gs_ai after insert on grade_submissions for each row execute function gs_after_insert();

create function log_change() returns trigger language plpgsql security definer set search_path=public as
$$ begin insert into audit_log(table_name, record_id, action, old_data, new_data) values (tg_table_name, new.id, tg_op, to_jsonb(old), to_jsonb(new)); return new; end $$;
create trigger audit_scholars after update on scholars for each row execute function log_change();
create trigger audit_gs after update on grade_submissions for each row execute function log_change();

-- verification + compliance evaluation (BR-04, BR-05, BR-07, BR-09)
create function verify_submission(p_id uuid) returns grade_submissions language plpgsql security definer set search_path=public as $$
declare s grade_submissions; prog scholarship_programs; notes text[] := '{}'; res text;
begin
  if not is_staff() then raise exception 'Only authorized staff may verify submissions'; end if;
  select * into s from grade_submissions where id = p_id for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.submission_status <> 'Pending' then raise exception 'Submission is already %; it cannot be verified again', s.submission_status; end if;
  select sp.* into prog from scholarship_programs sp join scholars sc on sc.scholarship_id = sp.id where sc.id = s.scholar_id;
  if s.gwa > prog.required_gwa then notes := notes || format('GWA %s is above the required %s', s.gwa, prog.required_gwa); end if;
  if s.units_enrolled < prog.min_units then notes := notes || format('Units %s is below the minimum %s', s.units_enrolled, prog.min_units); end if;
  if s.failed_subjects > 0 and not prog.allow_failing_grade then notes := notes || format('%s failed subject(s); program allows none', s.failed_subjects); end if;
  if s.incomplete_subjects > 0 then notes := notes || format('%s incomplete subject(s)', s.incomplete_subjects); end if;
  res := case when cardinality(notes) = 0 then 'Compliant' else 'With Deficiency' end;
  update grade_submissions set submission_status='Verified', verified_by=auth.uid(), verified_at=now(),
    evaluation_result=res, deficiency_notes=array_to_string(notes, '; ') where id = p_id returning * into s;
  update scholars set status = res where id = s.scholar_id;
  return s;
end $$;

-- row level security (BR-10). No UPDATE policy on grade_submissions: only verify_submission() may change it.
alter table profiles enable row level security;
alter table scholarship_programs enable row level security;
alter table scholars enable row level security;
alter table grade_submissions enable row level security;
alter table audit_log enable row level security;
create policy p_read on profiles for select using (id = auth.uid() or is_staff());
create policy sp_read on scholarship_programs for select to authenticated using (true);
create policy sp_write on scholarship_programs for insert with check (is_staff());
create policy sp_upd on scholarship_programs for update using (is_staff());
create policy sc_read on scholars for select using (is_staff() or user_id = auth.uid());
create policy sc_ins on scholars for insert with check (is_staff());
create policy sc_upd on scholars for update using (is_staff());
create policy gs_read on grade_submissions for select using (is_staff() or exists (select 1 from scholars s where s.id = scholar_id and s.user_id = auth.uid()));
create policy gs_ins on grade_submissions for insert with check (is_staff() or exists (select 1 from scholars s where s.id = scholar_id and s.user_id = auth.uid()));
create policy al_read on audit_log for select using (is_staff());

-- sample rules (different GWA per program)
insert into scholarship_programs (program_name, required_gwa, min_units, allow_failing_grade) values
 ('University Academic Scholarship', 1.75, 18, false),
 ('Government Scholarship', 2.50, 15, false),
 ('Private Grant', 3.00, 12, true);

-- after you sign up in the app, make yourself admin:
-- update profiles set role='admin' where id=(select id from auth.users where email='YOU@EMAIL.COM');
-- link a scholar login to a scholar record:
-- update scholars set user_id=(select id from auth.users where email='SCHOLAR@EMAIL.COM') where student_id='2024-0001';
